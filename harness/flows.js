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
  await b.close();
})();
