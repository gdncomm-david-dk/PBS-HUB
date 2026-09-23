// Interaction checks against the built bundles: node harness/flows.js <shotDir>
const { chromium } = require("playwright");
const path = require("path");
const assert = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1120, height: 1100 } });
  p.on("pageerror", (e) => { console.log("PAGEERROR", e.message); process.exitCode = 1; });
  const go = async (q) => { await p.goto("file://" + path.join(__dirname, "index.html") + "?" + q); await p.waitForTimeout(400); };
  const payloads = () => p.evaluate(() => window.__payloads);
  const shot = (n) => p.$("#stage").then((e) => e.screenshot({ path: path.join(out, n + ".png") }));

  // Approve: locks while pending, then success banner and summary.
  await go("c=ReportDetail&r=RPT-20862&delay=1500");
  await p.getByRole("button", { name: "Setujui", exact: true }).click();
  await p.waitForTimeout(200);
  await shot("f-submitting");
  assert(await p.getByText("Mengirim keputusan…").isVisible(), "submitting state visible");
  let pl = await payloads();
  assert(pl.length === 1 && pl[0].action === "APPROVE" && pl[0].payload.approvalStatus === "Done" && pl[0].payload.match === "Match" && pl[0].payload.reportId === "20862", "APPROVE payload maps to Report.ApprovalStatus/Match");
  await p.waitForTimeout(1600);
  assert(await p.getByText("Keputusan tersimpan: report disetujui.").isVisible(), "success banner after ActionResult ok");
  assert((await p.getByRole("button", { name: "Setujui", exact: true }).count()) === 0, "decision bar gone after decision");
  await shot("f-approved");

  // Conflict reply from canvas.
  await go("c=ReportDetail&r=RPT-20862&reply=conflict&delay=200");
  await p.getByRole("button", { name: "Setujui", exact: true }).click();
  await p.waitForTimeout(600);
  assert(await p.getByText(/sudah diputuskan oleh Bayu Prasetyo/).isVisible(), "conflict banner names the other reviewer");
  await shot("f-conflict");

  // Error reply keeps the bar and shows a persistent error.
  await go("c=ReportDetail&r=RPT-20862&reply=error&delay=200");
  await p.getByRole("button", { name: "Setujui", exact: true }).click();
  await p.waitForTimeout(600);
  assert(await p.getByText("Gagal menyimpan. Coba lagi.").isVisible(), "error banner on status=error");
  assert((await p.getByRole("button", { name: "Setujui", exact: true }).count()) === 1, "decision bar still available after error");

  // Revision needs a metric and a note.
  await go("c=ReportDetail&r=RPT-20862");
  await p.getByRole("button", { name: "Perlu revisi" }).click();
  const send = p.getByRole("button", { name: "Kirim permintaan" });
  assert(await send.isDisabled(), "Kirim permintaan disabled without a note");
  await p.locator("#pbs-rev-note").fill("Penjualan dan CTOR beda jauh dari screenshot.");
  assert(await send.isEnabled(), "enabled with metrics + note");
  await send.click();
  pl = await payloads();
  const rv = pl.find((x) => x.action === "REQUEST_REVISION");
  assert(rv && rv.payload.approvalStatus === "Need Revision" && rv.payload.flaggedMetrics.join() === "Penjualan,CTOR", "REQUEST_REVISION payload with flagged metrics");

  // No evidence.
  await go("c=ReportDetail&r=RPT-20865");
  assert(await p.getByText(/Menunggu bukti sejak/).isVisible(), "no-evidence column text");
  assert(await p.getByRole("button", { name: "Setujui tanpa bukti" }).isDisabled(), "approve-without-evidence needs a comment");
  await shot("f-noevidence");

  // Decided by someone else.
  await go("c=ReportDetail&r=RPT-20870");
  assert(await p.getByText(/sudah diputuskan oleh Bayu Prasetyo 5 menit lalu/).isVisible(), "decided-elsewhere banner");
  await shot("f-decided");

  // Orphan evidence note.
  await go("c=ReportDetail&r=RPT-20861");
  assert(await p.getByText(/HostID yang berbeda/).isVisible(), "orphan evidence warning");

  // Bulk approve only for low-confidence matching rows.
  await go("c=ReportReview&delay=600");
  const boxes = p.locator("tbody input[type=checkbox]");
  assert((await boxes.count()) === 2, "only the 2 low-confidence matching rows are selectable");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await p.waitForTimeout(100);
  await shot("f-bulk");
  await p.getByRole("button", { name: "Setujui 2 baris" }).click();
  pl = await payloads();
  const bulk = pl.find((x) => x.action === "BULK_APPROVE");
  assert(bulk && bulk.payload.items.length === 2, "BULK_APPROVE with 2 items");
  await p.waitForTimeout(900);
  assert((await p.getByRole("button", { name: /Setujui \d baris/ }).count()) === 0, "selection cleared after ok");

  // Filters: reason filter and empty-filtered state.
  await go("c=ReportReview");
  await p.getByLabel("Alasan").selectOption("ZERO_ZERO");
  assert((await p.locator("tbody tr").count()) === 1, "reason filter narrows to 1 row");
  await p.getByLabel("Brand").selectOption({ label: "Hanasui" });
  await p.getByLabel("Alasan").selectOption("LOW_CONFIDENCE");
  assert(await p.getByText("Tidak ada report yang cocok dengan filter").isVisible(), "empty-filtered state");
  await shot("f-emptyfiltered");
  await p.getByRole("button", { name: "Tinjau" }).count();

  // Open report emits the row reference.
  await go("c=ReportReview");
  await p.getByRole("button", { name: "Tinjau" }).nth(2).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_REPORT" && x.payload.title === "RPT-20862"), "OPEN_REPORT payload");

  // Paging: pageSize 10 local, then LOAD_MORE when HasMore.
  await go("c=ReportReview&tab=All");
  await p.evaluate(() => window.__rerender({ HasMore: true }));
  await p.waitForTimeout(100);
  await p.getByRole("button", { name: "Muat lebih banyak" }).click();
  await p.waitForTimeout(100);
  pl = await payloads();
  assert(pl.some((x) => x.action === "LOAD_MORE"), "LOAD_MORE emitted when HasMore");

  // Dashboard navigation.
  await go("c=Dashboard");
  await p.getByRole("button", { name: /Report menunggu review/ }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "NAV" && x.payload.target === "REVIEW"), "queue card navigates to REVIEW");

  // Loading / empty states.
  for (const [n, q] of [["f-dash-loading", "c=Dashboard&s=loading"], ["f-dash-empty", "c=Dashboard&s=empty"], ["f-rr-loading", "c=ReportReview&s=loading"], ["f-rr-empty", "c=ReportReview&s=empty"], ["f-rd-loading", "c=ReportDetail&r=none&s=loading"]]) {
    await go(q);
    await shot(n);
  }
  // ---- Payroll ----------------------------------------------------------------------------------
  // An open run locks "Jalankan payroll".
  await go("c=PayrollRuns");
  assert(await p.getByRole("button", { name: "Jalankan payroll" }).isDisabled(), "Jalankan payroll disabled while PAY-118 is open");
  assert(await p.getByText("Menunggu FAS").first().isVisible(), "parallel gate state shown on the list");

  // Preflight: explicit period, loading, warnings need acknowledgement, then RUN_PAYROLL.
  await go("c=PayrollRuns&pay=none&delay=600&pfdelay=500");
  await p.getByRole("button", { name: "Jalankan payroll" }).click();
  const runBtn = () => p.getByRole("dialog").getByRole("button", { name: "Jalankan payroll" });
  assert(await runBtn().isDisabled(), "run disabled until a period is chosen");
  await p.selectOption("#pbs-pf-period", "2026-08");
  await p.waitForTimeout(150);
  pl = await payloads();
  assert(pl.some((x) => x.action === "PREFLIGHT_PERIOD" && x.payload.period === "2026-08"), "PREFLIGHT_PERIOD asks canvas for the chosen month");
  assert(await p.getByRole("status", { name: "Memeriksa" }).isVisible(), "preflight shows skeleton while canvas loads");
  await shot("f-pf-loading");
  await p.waitForTimeout(600);
  assert(await p.getByText(/host aktif tanpa kehadiran/).isVisible(), "warning: hosts without attendance");
  assert(await p.getByText(/host nonaktif punya kehadiran/).isVisible(), "warning: inactive host with attendance");
  assert((await p.locator(".pbs-checks li.block").count()) === 0, "no blocking item for a clean month");
  assert(await runBtn().isDisabled(), "warnings require acknowledgement");
  await shot("f-pf-warnings");
  await p.locator(".pbs-ack input").check();
  assert(!(await runBtn().isDisabled()), "run enabled after acknowledgement");
  await runBtn().click();
  await p.waitForTimeout(150);
  assert(await p.getByText("Menjalankan…").isVisible(), "running state while waiting for canvas");
  pl = await payloads();
  const run = pl.find((x) => x.action === "RUN_PAYROLL");
  assert(run && run.payload.period === "2026-08" && run.payload.acknowledgedWarnings.includes("NO_ATTENDANCE") && run.payload.estimateTotal > 0, "RUN_PAYROLL payload carries period and acknowledged warnings");
  await p.waitForTimeout(800);
  assert((await p.getByRole("dialog").count()) === 0 && (await p.getByText(/Payroll dijalankan/).isVisible()), "modal closes and success banner after ok");

  // Error reply keeps the modal open with the reason.
  await go("c=PayrollRuns&pay=none&reply=error&delay=200&pfdelay=100");
  await p.getByRole("button", { name: "Jalankan payroll" }).click();
  await p.selectOption("#pbs-pf-period", "2026-08");
  await p.waitForTimeout(300);
  await p.locator(".pbs-ack input").check();
  await runBtn().click();
  await p.waitForTimeout(500);
  assert((await p.getByRole("dialog").count()) === 1 && (await p.getByText(/Payroll tidak berjalan/).isVisible()), "error keeps modal open with a reason");

  // Blocked: the period already ran, and a paid host has no bank details; another month is blocked by the v1 flow.
  await go("c=PayrollRuns&pay=done&pf=block&pfdelay=100");
  await p.getByRole("button", { name: "Jalankan payroll" }).click();
  await p.selectOption("#pbs-pf-period", "2026-08");
  await p.waitForTimeout(300);
  assert(await p.getByText(/Periode ini sudah dijalankan: PAY-118/).isVisible(), "duplicate period blocks (P11)");
  assert(await p.getByText(/tanpa data rekening/).isVisible(), "host without bank blocks");
  assert(await runBtn().isDisabled(), "run disabled while blocked");
  await shot("f-pf-blocked");
  await p.selectOption("#pbs-pf-period", "2026-07");
  await p.waitForTimeout(300);
  assert(await p.getByText(/selalu memproses bulan lalu/).isVisible(), "v1 flow period constraint blocks other months");

  // Run detail: expand a line to its Clock In rows; the mismatching line says by how much.
  await go("c=PayrollRunDetail&run=118");
  assert(await p.getByText("2 host tanpa data rekening.").isVisible(), "no-bank banner on run detail");
  await p.getByRole("button", { name: "Rincian kehadiran Vina Anggraini" }).click();
  await p.waitForTimeout(100);
  assert(await p.getByText(/Selisih Rp180\.000 dari bruto/).isVisible(), "expanded line reconciles against Clock In");
  await shot("f-pd-expanded");
  await p.getByRole("tab", { name: "Approval" }).click();
  assert(await p.getByText("paralel: keduanya harus setuju").isVisible(), "parallel gates drawn");

  // Payslip resend only for the failed ones.
  await go("c=PayrollRunDetail&run=117&slips=1&tab=Payslip&delay=300");
  await p.getByRole("button", { name: /Kirim ulang yang gagal/ }).click();
  await p.waitForTimeout(100);
  pl = await payloads();
  const rs = pl.find((x) => x.action === "RESEND_PAYSLIPS");
  assert(rs && rs.payload.items.length === 2 && rs.payload.payrollId === "117", "RESEND_PAYSLIPS carries only failed + bounced");
  await go("c=PayrollRunDetail&run=117&tab=Payslip");
  assert(await p.getByText("Status slip belum tercatat").isVisible(), "v1 without a payslip log says so");
  await go("c=PayrollRunDetail&run=116");
  assert(await p.getByText(/PBS0003M\) memang tidak menulis Payroll Data/).isVisible(), "manual run without lines explained");

  for (const [n, q] of [["f-pr-loading", "c=PayrollRuns&s=loading"], ["f-pr-empty", "c=PayrollRuns&s=empty"], ["f-pr-assembling", "c=PayrollRuns&pay=assembling"], ["f-pd-loading", "c=PayrollRunDetail&s=loading"]]) {
    await go(q);
    await shot(n);
  }
  // ---- Host ------------------------------------------------------------------------------------
  await go("c=HostList");
  assert((await p.locator("tbody tr").count()) === 12, "host list shows every host");
  assert((await p.getByRole("img", { name: /Data bank belum lengkap/ }).count()) === 2, "hosts without bank flagged amber");
  await p.getByRole("button", { name: "Tampilkan" }).click();
  await p.waitForTimeout(150);
  assert((await p.locator("tbody tr").count()) === 2, "Tampilkan filters to active hosts without bank");
  await p.getByRole("searchbox").fill("zzz");
  await p.waitForTimeout(150);
  assert(await p.getByText("Tidak ada host yang cocok dengan filter").isVisible(), "empty-filtered state");
  await go("c=HostList");
  await p.getByLabel("Band skor").selectOption("BAND-1");
  await p.waitForTimeout(150);
  assert((await p.locator("tbody tr").count()) === 1, "band filter");
  await p.getByRole("button", { name: "Buka" }).first().click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_HOST" && x.payload.hostId === "HST-007"), "OPEN_HOST carries the HostID");
  await go("c=HostList&s=empty");
  assert(await p.getByText("Belum ada host").isVisible(), "empty host list");

  await go("c=HostDetail&h=HST-003");
  assert(await p.getByText("Skor tersimpan tidak cocok dengan ledger.").isVisible(), "ledger drift warning");
  assert((await p.locator("tr.void").count()) === 1, "voided transaction struck through");
  await go("c=HostDetail&h=HST-012");
  assert(await p.getByText(/Host nonaktif sejak 5 Sep 2026/).isVisible(), "deactivated host names the date");
  assert(await p.getByText("2 kehadiran (Rp360.000) · 1 jadwal belum berjalan").isVisible(), "affected period lists attendance and sessions");
  await go("c=HostDetail&h=HST-001&role=FAS_Team");
  assert((await p.getByRole("tab", { name: "Data pribadi" }).count()) === 0 && (await p.getByRole("tab", { name: "Payroll" }).count()) === 0, "no permission: Data pribadi and Payroll tabs absent");
  await go("c=HostDetail&h=HST-001&tab=Personal");
  assert(await p.getByText("••••••••1234").isVisible(), "KTP masked by default");
  assert((await p.getByText("317405").count()) === 0, "raw KTP not in the DOM before reveal");
  await p.getByRole("button", { name: "Lihat" }).first().click();
  await p.waitForTimeout(700);
  pl = await payloads();
  assert(pl.some((x) => x.action === "REVEAL_PII" && x.payload.field === "KTP" && x.payload.hostId === "HST-001"), "REVEAL_PII names host and field");
  assert(await p.getByText(/^3174051203901234/).isVisible(), "revealed value shown after canvas reply");
  await shot("f-host-pii-open");
  await p.getByRole("button", { name: "Sembunyikan" }).click();
  await p.waitForTimeout(200);
  pl = await payloads();
  assert(pl.some((x) => x.action === "HIDE_PII") && (await p.getByText(/^3174051203901234/).count()) === 0, "Sembunyikan hides and tells canvas");
  await go("c=HostDetail&h=HST-001&leak=1");
  assert(await p.getByText(/HostJson memuat kolom sensitif/).isVisible(), "raw KTP in HostJson is called out");
  await go("c=HostDetail&h=HST-001&delay=300");
  await p.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
  await p.waitForTimeout(150);
  assert(await p.getByRole("button", { name: "Nonaktifkan host" }).isDisabled(), "deactivate needs a reason");
  await p.locator("#pbs-hs-reason").fill("Kontrak selesai");
  await p.getByRole("button", { name: "Nonaktifkan host" }).click();
  await p.waitForTimeout(600);
  pl = await payloads();
  const hs = pl.find((x) => x.action === "SET_HOST_STATUS");
  assert(hs && hs.payload.status === "Inactive" && hs.payload.reason === "Kontrak selesai" && hs.payload.upcomingSchedules.length === 4, "SET_HOST_STATUS carries reason and sessions to reassign");
  assert((await p.getByRole("dialog").count()) === 0, "modal closes on ok");
  for (const [n, q] of [["f-hl-loading", "c=HostList&s=loading"], ["f-hd-loading", "c=HostDetail&s=loading"]]) {
    await go(q);
    await shot(n);
  }
  await b.close();
})();