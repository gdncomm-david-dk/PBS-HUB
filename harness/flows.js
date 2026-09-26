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
  // Absen asks "Live Break?" first; answer and send.
  const absenDialog = async (liveBreak) => {
    const d = p.getByRole("dialog");
    await d.getByText(liveBreak ? "Ya, Live Break" : "Tidak, live seperti biasa").click();
    await d.getByRole("button", { name: "Absen", exact: true }).click();
    await p.waitForTimeout(700);
  };
  const fillReport = async (v) => {
    for (const [k, x] of Object.entries(v)) {
      if (k === "Playbook") await p.selectOption("#hc-m-Playbook", x);
      else await p.fill(`#hc-m-${k}`, x);
    }
  };

  // Approve: locks while pending, then success banner and summary.
  await go("c=ReportDetail&r=REP-20862&delay=1500");
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
  await go("c=ReportDetail&r=REP-20862&reply=conflict&delay=200");
  await p.getByRole("button", { name: "Setujui", exact: true }).click();
  await p.waitForTimeout(600);
  assert(await p.getByText(/sudah diputuskan oleh Bayu Prasetyo/).isVisible(), "conflict banner names the other reviewer");
  await shot("f-conflict");

  // Error reply keeps the bar and shows a persistent error.
  await go("c=ReportDetail&r=REP-20862&reply=error&delay=200");
  await p.getByRole("button", { name: "Setujui", exact: true }).click();
  await p.waitForTimeout(600);
  assert(await p.getByText("Gagal menyimpan. Coba lagi.").isVisible(), "error banner on status=error");
  assert((await p.getByRole("button", { name: "Setujui", exact: true }).count()) === 1, "decision bar still available after error");

  // Revision needs a metric and a note.
  await go("c=ReportDetail&r=REP-20862");
  await p.getByRole("button", { name: "Perlu revisi" }).click();
  const send = p.getByRole("button", { name: "Kirim permintaan" });
  assert(await send.isDisabled(), "Kirim permintaan disabled without a note");
  await p.locator("#pbs-rev-note").fill("Penjualan dan CTOR beda jauh dari screenshot.");
  assert(await send.isEnabled(), "enabled with metrics + note");
  await send.click();
  pl = await payloads();
  const rv = pl.find((x) => x.action === "REQUEST_REVISION");
  assert(rv && rv.payload.approvalStatus === "Need Revision" && rv.payload.flaggedMetrics.join() === "Penjualan,Pesanan,ProdukTerjual,JumlahPembeli,CTR,CTOR,PeakViewer", "REQUEST_REVISION flags every differing metric");
  assert(!rv.payload.flaggedMetrics.some((m) => ["Durasi(Min)", "Durasi", "AddToCart", "TotalViewer", "Comment", "Share"].includes(m)), "0% metrics never flagged");

  // All metrics in one table; 0% rows cannot be checked; unchecking narrows the payload.
  await go("c=ReportDetail&r=REP-20862");
  assert((await p.locator(".pbs-table tbody tr").first().locator("xpath=ancestor::table").locator("tbody tr").count()) === 12, "all 12 metrics in the table");
  assert((await p.getByText("Tidak dibandingkan").count()) === 0, "no uncompared section");
  await p.getByRole("button", { name: "Perlu revisi" }).click();
  assert(await p.getByRole("checkbox", { name: /Durasi/ }).isDisabled(), "0% metric checkbox disabled");
  await p.getByRole("checkbox", { name: /Pesanan/ }).uncheck();
  await p.locator("#pbs-rev-note").fill("Cek ulang.");
  await p.getByRole("button", { name: "Kirim permintaan" }).click();
  pl = await payloads();
  assert(!pl.find((x) => x.action === "REQUEST_REVISION").payload.flaggedMetrics.includes("Pesanan"), "unchecked metric left out");

  // Identical claim and evidence: nothing to revise.
  await go("c=ReportDetail&r=REP-20860");
  assert(await p.getByRole("button", { name: "Perlu revisi" }).isDisabled(), "Perlu revisi disabled when every metric matches");

  // No evidence.
  await go("c=ReportDetail&r=REP-20865");
  assert(await p.getByText(/Menunggu bukti sejak/).isVisible(), "no-evidence column text");
  assert(await p.getByRole("button", { name: "Setujui tanpa bukti" }).isDisabled(), "approve-without-evidence needs a comment");
  await shot("f-noevidence");

  // Decided by someone else.
  await go("c=ReportDetail&r=REP-20870");
  assert(await p.getByText(/sudah diputuskan oleh Bayu Prasetyo 5 menit lalu/).isVisible(), "decided-elsewhere banner");
  await shot("f-decided");

  // Orphan evidence note.
  await go("c=ReportDetail&r=REP-20861");
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

  // Row actions: Detail opens the report screen.
  await go("c=ReportReview");
  await p.getByRole("button", { name: "Detail", exact: true }).nth(2).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_REPORT" && x.payload.title === "REP-20862"), "Detail emits OPEN_REPORT");

  // Row actions: Review opens a popup; approving there closes it and shows the banner.
  await go("c=ReportReview&delay=300");
  await p.getByRole("button", { name: "Review", exact: true }).nth(2).click();
  const dlg = p.getByRole("dialog");
  assert(await dlg.getByText("Review REP-20862").isVisible(), "review popup opens");
  await shot("f-rr-popup");
  await dlg.getByRole("button", { name: "Setujui", exact: true }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "APPROVE" && x.payload.title === "REP-20862"), "APPROVE from popup");
  await p.waitForTimeout(600);
  assert((await p.getByRole("dialog").count()) === 0, "popup closes after ok");
  assert(await p.getByText("Keputusan tersimpan: report disetujui.").isVisible(), "list shows success banner");

  // Popup "Lihat detail" goes to the report screen.
  await go("c=ReportReview");
  await p.getByRole("button", { name: "Review", exact: true }).nth(1).click();
  await p.getByRole("dialog").getByRole("button", { name: "Lihat detail" }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_REPORT"), "Lihat detail emits OPEN_REPORT");

  // New columns and the corrected report (Waiting Approval Revision) in the waiting queue.
  await go("c=ReportReview");
  const heads = await p.locator("thead th").allInnerTexts();
  assert(["Rep ID", "Schedule ID", "Tanggal & jam live", "Playbook", "Status", "Menunggu"].every((h) => heads.includes(h)) && !heads.includes("Status review"), "list headers: Rep ID, Schedule ID, Jam live, Playbook, Status");
  const revRow = p.locator("tbody tr", { hasText: "SCD-3225" });
  assert((await revRow.count()) === 1 && (await revRow.getByText("Waiting Approval Revision").isVisible()), "Waiting Approval Revision report is in the Menunggu review tab");
  assert(await revRow.getByText("10:00–12:00").isVisible(), "live window looked up from the schedule");
  assert((await p.locator("tbody tr", { hasText: "SCD-3226" }).count()) === 0, "blank ApprovalStatus is not in Menunggu review");
  await p.getByRole("tab", { name: /Semua/ }).click();
  const blankRow = p.locator("tbody tr", { hasText: "SCD-3226" });
  assert((await blankRow.count()) === 1 && (await blankRow.getByText("Belum ada status").isVisible()), "blank ApprovalStatus shows under Semua as Belum ada status");
  await p.getByRole("tab", { name: /Menunggu review/ }).click();
  await revRow.getByRole("button", { name: "Review", exact: true }).click();
  const rdlg = p.getByRole("dialog");
  assert((await rdlg.getByText("SCD-3225").first().isVisible()) && (await rdlg.getByText("Waiting Approval Revision").first().isVisible()) && (await rdlg.getByText("Jam live").isVisible()), "popup header shows Schedule ID, Jam live and Status");
  await shot("f-rr-revision");
  await go("c=ReportDetail&r=REP-20862");
  assert((await p.getByText("SCD-3212").first().isVisible()) && (await p.getByText("19:00–21:00").isVisible()) && (await p.getByText("Playbook").first().isVisible()) && (await p.getByText("Payday", { exact: true }).first().isVisible()), "detail shows Schedule ID, live window and the Playbook choice");

  // No local paging: every loaded report is rendered with its total; LOAD_MORE only when canvas has more.
  await go("c=ReportReview&tab=All");
  const nRep = await p.evaluate(() => window.PBS_SAMPLE.reports.length);
  assert((await p.locator("tbody tr").count()) === nRep && (await p.getByText(`Total ${nRep} report`).isVisible()), `all ${nRep} reports rendered with the total`);
  assert((await p.getByRole("button", { name: "Muat lebih banyak" }).count()) === 0, "no Muat lebih banyak without HasMore");
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
  // ---- Manual clock-in -------------------------------------------------------------------------
  await go("c=HostList&delay=300");
  await p.getByRole("button", { name: "Clock in" }).nth(1).click();
  let ci = p.getByRole("dialog");
  assert(await ci.getByText("Clock in manual · PBSH-002").isVisible(), "clock-in popup opens from the list row");
  const save = ci.getByRole("button", { name: "Simpan clock in" });
  assert(await save.isDisabled(), "save disabled until all fields are filled");
  await p.selectOption("#pbs-ci-date", "2026-09-14");
  assert((await p.inputValue("#pbs-ci-in")) === String(7 * 60) && (await p.inputValue("#pbs-ci-out")) === String(21 * 60), "times prefilled from the schedule");
  await p.selectOption("#pbs-ci-out", String(6 * 60));
  assert(await ci.getByText("Jam clock out harus setelah jam clock in.").isVisible(), "clock-out before clock-in is rejected");
  await p.selectOption("#pbs-ci-out", String(21 * 60));
  await p.selectOption("#pbs-ci-status", "Hadir - Tugas");
  assert(await ci.getByText("HKTugas Rp180.000").isVisible(), "HKTugas shown for the status");
  await shot("f-clockin");
  await save.click();
  pl = await payloads();
  const add = pl.find((x) => x.action === "ADD_CLOCK_IN");
  assert(add && add.payload.hostId === "HST-002" && add.payload.clockInDate === "2026-09-14" && add.payload.clockInTime === "07:00" && add.payload.clockOutTime === "21:00" && add.payload.status === "Hadir - Tugas" && add.payload.hkTugas === 180000, "ADD_CLOCK_IN payload");
  await p.waitForTimeout(600);
  assert((await p.getByRole("dialog").count()) === 0, "popup closes after ok");
  assert(await p.getByText(/Clock in tersimpan: CLK-9001/).isVisible(), "canvas message shown in the banner");
  await p.getByRole("button", { name: "Clock in" }).nth(1).click();
  assert(await p.getByText(/sudah clock in di semua jadwalnya/).isVisible(), "day is no longer offered after the clock-in");

  // Host detail: the same popup; no missed day means "already clocked in".
  await go("c=HostDetail&h=HST-001");
  await p.getByRole("button", { name: /Clock in/ }).click();
  assert(await p.getByText(/Dinda Maharani sudah clock in di semua jadwalnya/).isVisible(), "host detail: already clocked in");
  await go("c=HostDetail&h=HST-006&reply=error");
  await p.getByRole("button", { name: /Clock in/ }).click();
  await p.selectOption("#pbs-ci-date", { index: 1 });
  await p.selectOption("#pbs-ci-status", "Hadir - Retainer");
  await p.getByRole("button", { name: "Simpan clock in" }).click();
  await p.waitForTimeout(600);
  assert(await p.getByRole("dialog").getByText("Gagal menyimpan: akses ditolak.").isVisible(), "error stays inside the popup");

  // ---- Host detail: attendance adjustments (Clock In row: times, HK, Tier, Weekly) -------------
  await go("c=HostDetail&h=HST-001&tab=Attendance&delay=300");
  await p.selectOption("select[aria-label='Bulan kehadiran']", "2026-08");
  await p.waitForTimeout(150);
  assert(await p.getByText(/sudah memakai kehadiran Agustus 2026/).isVisible(), "payroll run using August is named before editing");
  const augRow = p.locator("tr", { hasText: "Senin, 3 Agustus" });
  await augRow.getByRole("button", { name: "Edit", exact: true }).click();
  const adj = p.getByRole("dialog");
  const saveAdj = adj.getByRole("button", { name: "Simpan perubahan" });
  assert(await saveAdj.isDisabled(), "save disabled until something changes");
  await p.fill("#pbs-adj-out", "21:00");
  assert((await p.inputValue("#pbs-adj-tier")) === "1" && (await p.inputValue("#pbs-adj-ins")) === "Rp75.000", "current tier + insentif prefilled");
  assert(await p.locator("#pbs-adj-ins").isDisabled(), "insentif is not typed, it follows the tier");
  await p.selectOption("#pbs-adj-tier", "2");
  assert((await p.inputValue("#pbs-adj-ins")) === "Rp65.000", "Tier 2 = Rp65.000");
  await p.selectOption("#pbs-adj-tier", "");
  assert((await p.inputValue("#pbs-adj-ins")) === "Rp0", "no tier = Rp0");
  await p.selectOption("#pbs-adj-tier", "2");
  await adj.getByRole("checkbox", { name: "Dapat bonus weekly" }).check();
  assert(await saveAdj.isDisabled(), "reason still required");
  await p.fill("#pbs-adj-reason", "Lupa clock out, live sampai 21:00; tier 2 sesuai rekap.");
  assert(await adj.getByText(/Total hari ini/).isVisible(), "change summary with the day total");
  await shot("f-adjust");
  await saveAdj.click();
  pl = await payloads();
  const aj = pl.find((x) => x.action === "ADJUST_CLOCK_IN");
  assert(aj && aj.payload.clockInDate === "2026-08-03" && aj.payload.clockOutTime === "21:00" && aj.payload.checkOutAt === "2026-08-03T21:00:00" && aj.payload.tier === "Tier 2" && aj.payload.insentif === 65000 && aj.payload.streak === 75000 && aj.payload.hkTugas === 180000, "ADJUST_CLOCK_IN payload");
  assert(aj && aj.payload.changes.map((c) => c.field).join() === "CheckOutTime,Tier,Insentif,Streak" && aj.payload.payrollRun && aj.payload.payrollRun.id === "118", "changes list + affected payroll run");
  await p.waitForTimeout(500);
  assert((await p.getByRole("dialog").count()) === 0, "modal closes after ok");
  assert(await p.getByText(/Kehadiran 2026-08-03 disesuaikan/).isVisible(), "canvas message shown");
  assert(await p.locator("tr", { hasText: "Senin, 3 Agustus" }).getByText("Disesuaikan").isVisible(), "row marked as adjusted");
  await go("c=HostDetail&h=HST-001&tab=Attendance");
  await p.locator("tr", { hasText: "Senin, 14 September" }).getByRole("button", { name: "Edit", exact: true }).click();
  await p.fill("#pbs-adj-in", "10:00");
  await p.fill("#pbs-adj-out", "02:00");
  assert(await p.getByText(/lewat tengah malam/).isVisible(), "clock out before clock in means the next day");

  // Player container narrower and shorter than the control (the Review REP-1159 screenshot): the
  // popup must fit what is visible, close button included.
  await go("c=ReportReview&w=1060&ht=1400&clip=760x520");
  await p.getByRole("button", { name: "Review", exact: true }).nth(2).click();
  await p.waitForTimeout(200);
  const fit = await p.evaluate(() => {
    const box = document.getElementById("clipbox").getBoundingClientRect();
    const host = document.querySelector("#stage div");
    const dlg = (host.shadowRoot || document).querySelector("[role=dialog]").getBoundingClientRect();
    const x = (host.shadowRoot || document).querySelector("[role=dialog] .pbs-x, [role=dialog] [aria-label=Tutup]").getBoundingClientRect();
    return dlg.left >= box.left - 1 && dlg.right <= box.right + 1 && dlg.top >= box.top - 1 && dlg.bottom <= box.bottom + 1 && x.right <= box.right + 1;
  });
  assert(fit, "review popup fits a clipped player container (width and height)");
  await shot("f-rr-popup-clip");
  await p.keyboard.press("Escape");

  // Popups open where the user is looking, not at the top of the content.
  const inView = async () => p.getByRole("dialog").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.height > 100; });
  await go("c=HostDetail&h=HST-001&tab=Attendance");
  await p.selectOption("select[aria-label='Bulan kehadiran']", "2026-08");
  await p.locator("tr", { hasText: "Sabtu, 1 Agustus" }).getByRole("button", { name: "Edit", exact: true }).click();
  await p.waitForTimeout(150);
  assert(await inView(), "edit popup for a row far down is inside the visible area");
  await shot("f-adjust-lowrow");
  await p.keyboard.press("Escape");
  await go("c=HostDetail&h=HST-001&tab=Attendance&ht=700");
  await p.selectOption("select[aria-label='Bulan kehadiran']", "2026-08");
  await p.locator("tr", { hasText: "Sabtu, 1 Agustus" }).getByRole("button", { name: "Edit", exact: true }).click();
  await p.waitForTimeout(150);
  assert(await inView(), "same when the control scrolls inside a short screen");
  await p.keyboard.press("Escape");
  assert((await p.getByRole("dialog").count()) === 0, "Escape closes the popup");
  await go("c=HostDetail&h=HST-001&role=HOST");
  assert((await p.getByRole("tab", { name: "Kehadiran" }).count()) === 0, "no Kehadiran tab without HOST_CLOCKIN / PAYROLL_VIEW");


  // ---- Live break / Co-Host: no report owed; Schedule ID + account name; ClockInTime-only rows -------
  await go("c=HostDetail&h=HST-011&tab=Schedule");
  await p.getByRole("button", { name: "Semua" }).click().catch(() => {});
  const lb = p.locator("tbody tr", { hasText: "SCD-3227" });
  const co = p.locator("tbody tr", { hasText: "SCD-3228" });
  assert((await lb.getByText("Finished").isVisible()) && (await lb.getByText("Live break").isVisible()), "Waiting Report + LiveBreak Yes reads Finished · Live break");
  assert((await co.getByText("Finished").isVisible()) && (await co.getByText("Co-Host").isVisible()), "Co-Host with LiveBreak No reads Finished · Co-Host");
  assert(await lb.getByText("brand002.official").isVisible(), "Jadwal shows AccountName, not AccountID");
  assert((await p.locator("thead th", { hasText: "Schedule ID" }).count()) === 1, "Jadwal has a Schedule ID column");
  await shot("f-hd-nolive");
  await go("c=HostDetail&h=HST-011&tab=Attendance");
  assert((await p.getByText("08:05").first().isVisible()) && (await p.getByText("17:20").first().isVisible()), "ClockInTime / ClockOutTime (Date and Time) fill the attendance times");

  // ---- Host app: dashboard ---------------------------------------------------------------------
  await go("c=HostDashboard");
  assert(await p.getByText("Selamat siang, Dinda").isVisible(), "host dashboard greets the host");
  assert(await p.getByText("Shift berjalan 4j 47m").isVisible(), "open shift shows elapsed time");
  assert(await p.getByText("Report Scarlett Whitening perlu revisi").isVisible(), "revision is the first to-do");
  assert(await p.getByText("Report WINGS belum dikirim").isVisible() && (await p.getByText(/Sudah lewat batas waktu/).isVisible()), "late unsent report flagged");
  assert(await p.getByText("Report Emina belum lengkap — kurang 2 jam").isVisible(), "split live short of minutes is a to-do");
  assert((await p.locator(".hc-wk-d").count()) === 7 && (await p.locator(".hc-split .hc-aside").getByText("Skor saya").isVisible()), "desktop: week strip in the main column, score in the context column");
  await p.getByRole("button", { name: "Absen", exact: true }).click();
  assert(await p.getByRole("dialog").getByText(/Apakah sesi ini/).isVisible(), "absen asks whether the session is a live break");
  assert(await p.getByRole("dialog").getByRole("button", { name: "Absen", exact: true }).isDisabled(), "absen needs an answer first");
  await absenDialog(false);
  pl = await payloads();
  const ab = pl.find((x) => x.action === "ABSEN");
  assert(ab && ab.payload.scheduleId === "SCD-3201" && ab.payload.hostId === "HST-001" && ab.payload.liveDate === "2026-09-14" && ab.payload.liveBreak === false && ab.payload.scheduleStatus === "Waiting Report" && ab.payload.report === null, "ABSEN payload for the live session (not a live break: Waiting Report)");
  assert((await p.getByRole("button", { name: "Absen", exact: true }).count()) === 0, "absen button gone once canvas returns the row");
  await p.getByRole("button", { name: "Clock out" }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "CLOCK_OUT"), "CLOCK_OUT hands off to the clock-in screen");
  await go("c=HostDashboard&shift=none");
  assert(await p.getByText("Clock in dulu").isVisible(), "session asks for clock-in first when not clocked in");
  await p.getByRole("button", { name: "Clock in" }).click();
  assert((await payloads()).some((x) => x.action === "CLOCK_IN"), "CLOCK_IN fired");

  // ---- Host app: my reports --------------------------------------------------------------------
  await go("c=MyReports");
  assert(await p.getByText("Total 8 report pada September 2026").isVisible(), "MyReports footer shows the total");
  assert((await p.locator(".hc-row:not(.head)").count()) === 8, "8 rows in September: Report rows only");
  assert((await p.locator(".hc-row", { hasText: "Belum dikirim" }).count()) === 0, "no schedule-only rows in the report list");
  assert((await p.locator(".hc-kpi", { hasText: "Belum dikirim" }).locator(".v").textContent()).startsWith("4"), "summary card counts sessions still owing a report (split live included)");
  assert(await p.locator(".hc-row", { hasText: "REP-20905" }).getByText("13:00–15:00").isVisible() && (await p.locator(".hc-row", { hasText: "REP-20905" }).getByText("SCD-3312").isVisible()), "report row shows its schedule looked up by ScheduleID");
  assert(await p.getByText("Waiting Approval Revision", { exact: true }).isVisible() && (await p.getByText("LiveBreak", { exact: true }).first().isVisible()), "Status column shows the stored ApprovalStatus (Waiting Approval Revision, LiveBreak)");
  assert((await p.getByText(/^Playbook: /).count()) > 0, "report rows show the Playbook");
  await p.getByRole("tab", { name: /Perlu revisi/ }).click();
  assert((await p.locator(".hc-row:not(.head)").count()) === 1, "revision filter");
  await p.getByRole("button", { name: "Perbaiki", exact: true }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_REPORT" && x.payload.title === "REP-20901"), "OPEN_REPORT from the list");
  await p.getByRole("tab", { name: /Live break/ }).click();
  assert((await p.locator(".hc-row:not(.head)").count()) === 1, "LiveBreak filter");
  await p.getByRole("tab", { name: /Semua/ }).click();
  await p.selectOption("select[aria-label=Bulan]", "2026-07");
  await p.waitForTimeout(200);
  assert(await p.getByText("Belum ada report di Juli 2026").isVisible(), "empty month after PERIOD_CHANGED");

  // ---- Host app: submit report with screenshot --------------------------------------------------
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 600, height: 900 } });
  await go("c=MyReportDetail&sch=SCD-3302");
  const submit = p.getByRole("button", { name: "Send Report", exact: true });
  assert(await submit.isDisabled(), "submit disabled on an empty form");
  assert((await p.locator("#hc-m-AddToCart").count()) === 0 && (await p.locator("#hc-m-Share").count()) === 0, "TikTok: no AddToCart, no Share");
  const vals = { LiveID: "7400112233", Durasi: "120", Playbook: "Payday", Pesanan: "120", Penjualan: "4.250.000", ProdukTerjual: "150", JumlahPembeli: "101", CTR: "3,6", PeakViewer: "1300", TotalViewer: "15800", CTOR: "8,9", Comment: "420" };
  await fillReport({ ...vals, Comment: "" });
  assert(await p.getByText(/Belum bisa submit: .*Isi Comment/).isVisible(), "every listed metric is required");
  await fillReport({ Comment: "420" });
  assert(await submit.isDisabled(), "still disabled without a screenshot");
  await p.setInputFiles("input[type=file]", { name: "Screenshot 2026-09-12.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(600);
  assert(await p.getByText("SCD-3302_TikTok_ACC-005.jpg").isVisible() || (await p.getByText(/REP-\{ID\}_TikTok_ACC-005\.jpg|_TikTok_ACC-005\.jpg/).count()) > 0, "file name generated from platform + account");
  await shot("f-host-submit");
  await p.waitForTimeout(300); // let the page settle after the element screenshot scrolled it
  assert(await submit.isEnabled(), "submit enabled with metrics + screenshot");
  await submit.click();
  await p.waitForTimeout(800);
  pl = await payloads();
  const sb = pl.find((x) => x.action === "SUBMIT_REPORT");
  assert(sb && sb.payload.scheduleId === "SCD-3302" && sb.payload.metrics.Penjualan === 4250000 && sb.payload.metrics.CTR === 3.6 && sb.payload.metrics["Durasi(Min)"] === 120 && sb.payload.metrics.AddToCart === null && sb.payload.file.ext === "jpg", "SUBMIT_REPORT payload uses SharePoint column names");
  assert(sb && sb.payload.liveId === "7400112233" && sb.payload.playbook === "Payday" && sb.payload.complete === true && sb.payload.scheduleStatus === "Done" && sb.payload.part === 1, "LiveID, Playbook, and Done once Durasi covers the session");
  assert(await p.getByText(/UploadData \d+ KB base64 JPEG/).isVisible(), "screenshot sent on UploadData, not in ActionPayload");
  assert(JSON.stringify(sb).length < 4000, "ActionPayload stays small");
  assert((await p.getByText(/terkirim/).first().isVisible()) && (await p.getByText("Menunggu review").first().isVisible()), "after submit the screen shows the sent report, waiting for review");

  // Draft survives a reload (device only).
  await go("c=MyReportDetail&sch=SCD-3303");
  await p.fill("#hc-m-Penjualan", "999.000");
  await p.getByRole("button", { name: "Simpan draft" }).click();
  await go("c=MyReportDetail&sch=SCD-3303");
  assert(await p.getByText(/draft/i).first().isVisible(), "draft restore offered after reload");

  // Blockers.
  await go("c=MyReportDetail&sch=SCD-3304");
  assert(await p.getByText("Sesi ini tidak punya catatan clock in").isVisible(), "no clock-in blocks the report");
  await go("c=MyReportDetail&sch=SCD-3201");
  await p.getByRole("button", { name: "Absen sekarang" }).click();
  await absenDialog(false);
  assert(await p.getByText("Absen tercatat untuk SCD-3201.").isVisible(), "absen from the report screen");

  // ---- Host app: revision + dispute -------------------------------------------------------------
  await go("c=MyReportDetail&r=REP-20901");
  assert(await p.getByText("Ada 2 angka yang perlu kamu cek").isVisible(), "revision headline counts flagged metrics");
  await p.getByRole("button", { name: "Perbaiki report" }).click();
  const kirim = p.getByRole("button", { name: "Kirim revisi" });
  assert(await kirim.isDisabled(), "resubmit disabled until something changes");
  await p.fill("#hc-m-Penjualan", "6.980.000");
  await p.fill("#hc-m-CTOR", "11,6");
  assert(await kirim.isDisabled() && (await p.getByText(/Lengkapi dulu: Live ID, Playbook/).isVisible()), "revision also needs Live ID and Playbook");
  await fillReport({ LiveID: "7400998877", Playbook: "Flash Sale" });
  await kirim.click();
  await p.waitForTimeout(700);
  pl = await payloads();
  const rsb = pl.find((x) => x.action === "RESUBMIT_REPORT");
  assert(rsb && rsb.payload.reportId === "20901" && rsb.payload.metrics.Penjualan === 6980000 && rsb.payload.changed.join() === "Penjualan,CTOR,LiveID,Playbook" && rsb.payload.file === null && rsb.payload.liveId === "7400998877" && rsb.payload.scheduleStatus === "Done", "RESUBMIT_REPORT payload");
  await go("c=MyReportDetail&r=REP-20901");
  await p.getByRole("button", { name: "Saya rasa angka saya benar" }).click();
  const dsend = p.getByRole("dialog").getByRole("button", { name: /Kirim sanggahan/ });
  assert(await dsend.isDisabled(), "dispute needs a reason");
  await p.fill("#hc-dp-reason", "Angka penjualan di seller center memang 7,35 juta setelah refresh.");
  await dsend.click();
  await p.waitForTimeout(700);
  pl = await payloads();
  assert(pl.some((x) => x.action === "DISPUTE_REVIEW" && x.payload.reason.startsWith("Angka penjualan")), "DISPUTE_REVIEW payload");
  await go("c=MyReportDetail&r=REP-20902");
  assert((await p.getByRole("button", { name: "Perbaiki report" }).count()) === 0, "done report is read-only");

  // ---- Host app: my schedule --------------------------------------------------------------------
  await go("c=MySchedule");
  const schRows = () => p.locator(".hc-row.sch:not(.head)").count();
  assert((await schRows()) === 20, "20 sessions in September, cancelled included");
  assert(await p.getByText("Planned").first().isVisible() && (await p.getByText("Finished").first().isVisible()), "Planned / Finished status words");
  await p.selectOption("select[aria-label=Status]", "ACTION");
  assert((await schRows()) === 7, "Perlu tindakan filter");
  await p.selectOption("select[aria-label=Status]", "");
  await p.fill("input[aria-label='Cari jadwal']", "wings");
  assert((await schRows()) === 3, "search by brand");
  await p.fill("input[aria-label='Cari jadwal']", "SCD-3302");
  await p.getByRole("button", { name: "SCD-3302" }).click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_SCHEDULE" && x.payload.scheduleId === "SCD-3302" && x.payload.liveDate === "2026-09-12"), "OPEN_SCHEDULE from the table");
  await p.getByRole("button", { name: "Reset" }).click();
  assert((await schRows()) === 20, "reset clears the filters");
  await p.getByRole("button", { name: "Absen", exact: true }).click();
  await absenDialog(false);
  pl = await payloads();
  assert(pl.some((x) => x.action === "ABSEN" && x.payload.scheduleId === "SCD-3201" && x.payload.hostId === "HST-001"), "ABSEN from the today strip");
  assert(await p.getByRole("button", { name: "Kirim report" }).isVisible(), "today strip moves on to Kirim report after absen");
  await p.selectOption("select[aria-label=Bulan]", "2026-07");
  await p.waitForTimeout(200);
  assert(await p.getByText("Belum ada jadwal di Juli 2026").isVisible(), "empty month after PERIOD_CHANGED");
  await go("c=MySchedule&w=390");
  const over = await p.evaluate(() => { const st = document.getElementById("stage"); return st.scrollWidth - st.clientWidth; });
  assert(over <= 0, "mobile table has no horizontal scroll");
  await go("c=HostDashboard");
  await p.getByRole("button", { name: "Hanasui" }).first().click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_SCHEDULE" && x.payload.scheduleId === "SCD-3201"), "dashboard session opens the schedule detail");

  // ---- Host app: schedule detail ----------------------------------------------------------------
  await go("c=ScheduleDetail&sch=SCD-3201");
  assert(await p.getByText("Sesi sedang live — absen sekarang").isVisible(), "live session asks for absen");
  assert(await p.getByRole("button", { name: "Send Report", exact: true }).isDisabled(), "Send Report disabled before absen (Schedule.Status still Planned)");
  await p.getByRole("button", { name: "Absen", exact: true }).first().click();
  await absenDialog(false);
  assert(await p.getByText("Absen tercatat untuk SCD-3201.").isVisible() && (await p.getByText("Kirim report sesi ini").isVisible()), "after absen the next step is the report");
  assert((await p.locator("#hc-report").count()) === 0, "the form stays closed until Send Report");
  await p.locator(".hc-ph-a").getByRole("button", { name: "Send Report" }).click();
  await p.waitForTimeout(200);
  assert((await p.locator("#hc-report").count()) === 1 && (await p.locator("#hc-m-LiveID").isVisible()), "Send Report opens the form");
  const sdSubmit = p.locator("#hc-report").getByRole("button", { name: "Send Report", exact: true });
  await fillReport(vals);
  await p.setInputFiles("input[type=file]", { name: "Screenshot 2026-09-14.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(600);
  assert(await sdSubmit.isEnabled(), "report form on the detail: submit enabled after absen + metrics + screenshot");
  await sdSubmit.click();
  await p.waitForTimeout(800);
  pl = await payloads();
  const sds = pl.find((x) => x.action === "SUBMIT_REPORT");
  assert(sds && sds.payload.scheduleId === "SCD-3201" && sds.payload.metrics.Penjualan === 4250000 && sds.payload.absId === "ABS-8899", "SUBMIT_REPORT from the schedule detail");
  assert(await p.getByText(/UploadData \d+ KB base64 JPEG/).isVisible(), "detail sends the screenshot on UploadData");
  assert(await p.getByText("Report terkirim, menunggu review").isVisible() && (await p.getByText(/Durasi sesi terpenuhi/).isVisible()), "sent: duration covered, waiting for review");
  assert((await p.locator(".hc-ph-a").getByRole("button", { name: /Send Report/ }).count()) === 0, "Send Report gone once Durasi covers the session");
  await p.getByRole("button", { name: /16:00–18:00/ }).click();
  await p.waitForTimeout(200);
  assert(await p.getByRole("heading", { name: /Somethinc/ }).isVisible(), "other session of the day opens in place");
  await p.getByRole("button", { name: "Jadwal saya" }).click();
  assert((await payloads()).some((x) => x.action === "BACK"), "BACK to the list");
  await go("c=ScheduleDetail&sch=SCD-3301");
  await p.getByRole("button", { name: "Perbaiki report" }).click();
  await p.fill("#hc-m-Penjualan", "6.980.000");
  await fillReport({ LiveID: "7400998877", Playbook: "Live Reguler" });
  await p.getByRole("button", { name: "Kirim revisi" }).click();
  await p.waitForTimeout(700);
  assert((await payloads()).some((x) => x.action === "RESUBMIT_REPORT" && x.payload.reportId === "20901" && x.payload.changed.join() === "Penjualan,LiveID,Playbook" && x.payload.playbook === "Live Reguler"), "revision fixed in place from the detail (Playbook from PlaybooksJson)");
  await go("c=ScheduleDetail&sch=SCD-3304");
  assert(await p.getByText("Tidak ada clock in di hari ini", { exact: true }).isVisible(), "missing clock-in explained");
  await go("c=ScheduleDetail&sch=SCD-3307");
  assert(await p.getByText(/Sesi ini dibatalkan/).isVisible(), "cancelled session");
  await go("c=ScheduleDetail&sch=SCD-9999");
  assert(await p.getByText("Jadwal tidak ditemukan").isVisible(), "unknown schedule");
  await go("c=ScheduleDetail&sch=SCD-3309");
  assert(await p.getByText("Co Host").first().isVisible() && (await p.getByText(/Mulai .* lagi/).isVisible()), "planned session shows position and countdown");

  // Split live: 240 minutes scheduled, one report of 120 in. Report in parts until the minutes are covered.
  await go("c=ScheduleDetail&sch=SCD-3313");
  assert(await p.getByText("Report belum lengkap — kurang 2 jam").isVisible() && (await p.getByText("Kurang 120 menit").isVisible()), "short of minutes: still Waiting Report, how much is missing");
  assert((await p.locator(".hc-part").count()) === 1 && (await p.getByText(/120 dari 240 menit/).first().isVisible()), "the parts sent so far are listed");
  await p.locator(".hc-ph-a").getByRole("button", { name: "Send Report berikutnya" }).click();
  await p.waitForTimeout(200);
  assert(await p.locator("#hc-m-AddToCart").isVisible(), "Shopee: AddToCart asked");
  const shopee = { ...vals, AddToCart: "380", Durasi: "60" };
  await fillReport({ ...shopee, LiveID: "7412093385" });
  assert(await p.getByText("Live ID ini sudah dipakai report sebelumnya.").isVisible(), "the Live ID of an earlier part is refused");
  await fillReport({ LiveID: "7412093386" });
  assert(await p.getByText(/Setelah ini masih kurang 1 jam — status tetap Waiting Report/).isVisible(), "footer says what stays owed");
  await p.setInputFiles("#hc-report input[type=file]", { name: "part2.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(600);
  await p.locator("#hc-report").getByRole("button", { name: "Send Report", exact: true }).click();
  await p.waitForTimeout(800);
  pl = await payloads();
  let part = pl.filter((x) => x.action === "SUBMIT_REPORT").pop();
  assert(part && part.payload.part === 2 && part.payload.remainingMin === 60 && part.payload.complete === false && part.payload.scheduleStatus === "Waiting Report" && part.payload.metrics.AddToCart === 380, "part 2 of 240 min: 60 still owed, Waiting Report");
  assert(await p.getByText(/masih kurang/).first().isVisible() && (await p.getByText("Report ke-2 terkirim").isVisible()), "sent card: minutes still missing, send the next");
  await p.getByRole("button", { name: "Kirim report berikutnya" }).click();
  await p.waitForTimeout(200);
  assert((await p.inputValue("#hc-m-LiveID")) === "" && (await p.locator(".hc-part").count()) === 2, "next part starts blank, two parts listed");
  await fillReport({ ...shopee, LiveID: "7412093399", Durasi: "75" });
  await p.setInputFiles("#hc-report input[type=file]", { name: "part3.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(600);
  await p.locator("#hc-report").getByRole("button", { name: "Send Report", exact: true }).click();
  await p.waitForTimeout(800);
  pl = await payloads();
  part = pl.filter((x) => x.action === "SUBMIT_REPORT").pop();
  assert(part && part.payload.part === 3 && part.payload.complete === true && part.payload.scheduleStatus === "Done" && part.payload.reportedMin === 255, "part 3 covers the session (255 of 240): Done");
  assert((await p.locator(".hc-ph-a").getByRole("button", { name: /Send Report/ }).count()) === 0, "no more Send Report once covered");
  await shot("f-host-split");

  // Report opens only while Schedule.Status is Waiting Report.
  await go("c=ScheduleDetail&sch=SCD-3314");
  assert(await p.getByText("Menunggu status Waiting Report").isVisible() && (await p.getByRole("button", { name: "Send Report", exact: true }).isDisabled()), "absen done but status Planned: Send Report disabled");

  // Live break: absen "Ya" = no report, but a Report row of zeros with ApprovalStatus LiveBreak.
  await go("c=ScheduleDetail&sch=SCD-3201");
  await p.getByRole("button", { name: "Absen", exact: true }).first().click();
  await absenDialog(true);
  pl = await payloads();
  const lbAbs = pl.filter((x) => x.action === "ABSEN").pop();
  assert(lbAbs && lbAbs.payload.liveBreak === true && lbAbs.payload.scheduleStatus === "Done" && lbAbs.payload.report.approvalStatus === "LiveBreak" && Object.values(lbAbs.payload.report.metrics).every((v) => v === 0), "LiveBreak ABSEN payload: Done + report of zeros");
  assert((await p.locator(".hc-ph-a").getByRole("button", { name: /Send Report/ }).count()) === 0 && (await p.getByText("Live break · tanpa report").isVisible()), "live break: no Send Report");
  assert(await p.locator(".hc-part").getByText("Live break").isVisible(), "the LiveBreak report row is listed");

  // MySchedule calendar view: toggle, day cells, day list opens the session.
  await go("c=MySchedule");
  await p.getByRole("button", { name: "Kalender" }).click();
  await p.waitForTimeout(200);
  pl = await payloads();
  assert(pl.some((x) => x.action === "VIEW_CHANGED" && x.payload.view === "Calendar"), "VIEW_CHANGED on toggle");
  assert((await p.locator(".hc-cal-d").count()) === 35 && (await p.locator(".hc-cal-d.today .n").textContent()) === "14", "month grid with today marked");
  assert((await p.getByText(/Hari ini · Senin, 14 September 2026/).isVisible()) && (await p.locator(".hc-cal-day .hc-cal-item").count()) === 3, "today selected with its sessions");
  await p.getByRole("gridcell", { name: /Sabtu, 12 September 2026/ }).click();
  assert((await p.locator(".hc-cal-day .hc-cal-item").count()) === 1 && (await p.locator(".hc-cal-day").getByText("Y.O.U Beauty").isVisible()), "picking a day lists its sessions");
  await p.locator(".hc-cal-day .hc-cal-item").first().click();
  pl = await payloads();
  assert(pl.some((x) => x.action === "OPEN_SCHEDULE" && x.payload.scheduleId === "SCD-3302"), "calendar item opens the session");
  await go("c=MySchedule&view=Calendar&w=390");
  assert(await p.locator(".hc-cal-d .dots i").first().isVisible() && !(await p.locator(".hc-cal-ev").first().isVisible()), "phone shows dots instead of chips");
  await p.getByRole("button", { name: "Daftar" }).click();
  assert(await p.locator(".hc-list").isVisible(), "back to list view");

  // Host Clock In: position + selfie, reason only outside the radius, selfie on UploadData.
  const selfiePng = await p.screenshot({ clip: { x: 0, y: 0, width: 300, height: 400 } });
  await go("c=ClockIn&shift=none&w=390");
  const ciBtn = p.getByRole("button", { name: "Clock in sekarang" });
  assert(await ciBtn.isDisabled(), "clock in disabled before location and selfie");
  await p.getByRole("button", { name: "Cek lokasi" }).click();
  await p.waitForTimeout(400);
  assert(await p.getByText("Di dalam radius", { exact: true }).isVisible() && (await p.getByText(/Jarak 44 m dari titik studio \(radius 150 m\)/).isVisible()), "inside radius with distance");
  assert((await p.locator("#hc-ci-reason").count()) === 0, "no reason field inside the radius");
  await p.setInputFiles("input[type=file]", { name: "selfie.png", mimeType: "image/png", buffer: selfiePng });
  await p.waitForTimeout(600);
  assert(await p.getByText("Selfie siap").isVisible() && (await ciBtn.isEnabled()), "selfie ready enables clock in");
  await shot("f-clockin-ready");
  await ciBtn.click();
  await p.waitForTimeout(900);
  pl = await payloads();
  const kIn = pl.find((x) => x.action === "CLOCK_IN");
  assert(kIn && kIn.payload.hostId === "HST-001" && kIn.payload.clockInDate === "2026-09-14" && kIn.payload.clockInTime === "11:42" && kIn.payload.office === "Studio CWG Jakarta" && kIn.payload.locationId === "LOC-01" && kIn.payload.inside === true && kIn.payload.distance === 44 && kIn.payload.accuracy === 12 && kIn.payload.hkTugas === 180000 && kIn.payload.status === "Hadir - Tugas" && kIn.payload.reason === "", "CLOCK_IN payload maps to Clock In columns");
  assert(kIn && /^HST-001_20260914_IN_1142\.jpg$/.test(kIn.payload.file.name) && kIn.payload.selfieSource === "Camera", "selfie file name and source");
  assert(await p.getByText("Clock in tersimpan. Selamat bekerja!").isVisible() && (await p.getByRole("button", { name: "Clock out sekarang" }).isVisible()), "after clock in the screen turns to clock out");
  await shot("f-clockin-done");

  await go("c=ClockIn&shift=none&geo=-6.2300,106.8031,35&w=390");
  await p.getByRole("button", { name: "Cek lokasi" }).click();
  await p.waitForTimeout(400);
  await p.setInputFiles("input[type=file]", { name: "selfie.png", mimeType: "image/png", buffer: selfiePng });
  await p.waitForTimeout(600);
  assert(await p.locator(".pbs-badge", { hasText: "Di luar radius" }).isVisible() && (await p.getByRole("button", { name: "Clock in sekarang" }).isDisabled()), "outside radius blocks until a reason");
  await p.locator("#hc-ci-reason").fill("Live di gudang brand hari ini");
  assert(await p.getByRole("button", { name: "Clock in sekarang" }).isEnabled(), "reason unlocks clock in outside the radius");
  await shot("f-clockin-outside");
  await p.getByRole("button", { name: "Clock in sekarang" }).click();
  await p.waitForTimeout(700);
  pl = await payloads();
  const kOut = pl.find((x) => x.action === "CLOCK_IN");
  assert(kOut && kOut.payload.inside === false && kOut.payload.reason === "Live di gudang brand hari ini" && kOut.payload.distance > 150, "outside CLOCK_IN carries the reason");

  await go("c=ClockIn&shift=none&geo=deny");
  await p.getByRole("button", { name: "Cek lokasi" }).click();
  await p.waitForTimeout(400);
  assert(await p.getByText(/Izin lokasi ditolak\. /).isVisible(), "denied location explained");
  await go("c=ClockIn&shift=none&geo=deny&cloc=-6.2246,106.8031");
  await p.getByRole("button", { name: "Cek lokasi" }).click();
  await p.waitForTimeout(400);
  assert(await p.getByText(/lokasi dari Power Apps/).isVisible() && (await p.getByText("Di dalam radius", { exact: true }).isVisible()), "falls back to the canvas Location signal");
  await go("c=ClockIn&shift=none&locs=none");
  assert(await p.getByText(/Lokasi studio belum diatur \(/).isVisible(), "no studio locations explained");

  // Clock out: the open shift of 14 Sep (06:55), counts for ScheduleCount / TotalReports.
  await go("c=ClockIn");
  assert(await p.getByText(/Shift berjalan/).isVisible(), "open shift shows clock out");
  await p.getByRole("button", { name: "Cek lokasi" }).click();
  await p.waitForTimeout(400);
  await p.setInputFiles("input[type=file]", { name: "selfie.png", mimeType: "image/png", buffer: selfiePng });
  await p.waitForTimeout(600);
  await shot("f-clockout-ready");
  await p.getByRole("button", { name: "Clock out sekarang" }).click();
  await p.waitForTimeout(700);
  pl = await payloads();
  const kDone = pl.find((x) => x.action === "CLOCK_OUT");
  assert(kDone && kDone.payload.clockInId && kDone.payload.workingMinutes === 287 && kDone.payload.clockOutTime === "11:42" && typeof kDone.payload.scheduleCount === "number" && typeof kDone.payload.totalReports === "number" && /_OUT_/.test(kDone.payload.file.name), "CLOCK_OUT payload with duration and counts");
  assert(await p.getByText("Clock out tersimpan. Terima kasih!").isVisible() && (await p.getByText(/Shift selesai/).count()) > 0, "after clock out the shift reads finished");
  await shot("f-clockout-done");

  await b.close();
})();