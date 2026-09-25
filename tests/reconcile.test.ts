import { COMPARED_METRICS, compareMetric, sameValue, indexEvidence, reconcile, reviewState, numericTail, reasonDetail, isResubmitted, reviewBadge } from "../shared/reconcile";
import { fmtSignedPct } from "../shared/format";

const claim = { ID: 20863, Title: "REP-20863", HostID: "HST-1", Penjualan: 12400000, Pesanan: 340, ProdukTerjual: 512, JumlahPembeli: 288, CTR: 4.8, CTOR: 11.4, PeakViewer: 3120, ApprovalStatus: "Waiting Approval" };
const ev = { Title: "REP-20863", HostID: "HST-1", Penjualan: 10980000, Pesanan: 331, ProdukTerjual: 498, JumlahPembeli: 284, CTR: 4.62, CTOR: 9.85, PeakViewer: 3080, Status: "Unmatch" };
const opts = { tolerancePct: 5, confidenceThreshold: 0.85 };

describe("compareMetric — PBS0005A rule", () => {
  const pen = COMPARED_METRICS[0]!;
  it("is inclusive at exactly ±5%", () => {
    expect(compareMetric(pen, { Penjualan: 105 }, { Penjualan: 100 }, 5).within).toBe(true);
    expect(compareMetric(pen, { Penjualan: 95 }, { Penjualan: 100 }, 5).within).toBe(true);
    expect(compareMetric(pen, { Penjualan: 105.01 }, { Penjualan: 100 }, 5).within).toBe(false);
  });
  it("collapses the band at zero evidence (M4)", () => {
    expect(compareMetric(pen, { Penjualan: 0 }, { Penjualan: 0 }, 5)).toMatchObject({ within: true, note: "zero-zero" });
    expect(compareMetric(pen, { Penjualan: 1 }, { Penjualan: 0 }, 5)).toMatchObject({ within: false, note: "evidence-zero" });
  });
  it("treats a blank evidence value as empty, not zero", () => {
    expect(compareMetric(pen, { Penjualan: 5 }, { Penjualan: "" }, 5).note).toBe("evidence-empty");
  });
});

describe("reconcile — reason codes", () => {
  it("joins on Title and flags out-of-tolerance metrics", () => {
    const r = reconcile(claim, indexEvidence([ev]), opts);
    expect(r.reason).toBe("OUT_OF_TOLERANCE");
    expect(r.outOfTolerance.map((m) => m.def.key)).toEqual(["Penjualan", "CTOR"]);
    expect(reasonDetail(r, fmtSignedPct)).toBe("CTOR +15,7% +1");
  });
  it("falls back to the numeric tail of the evidence Title = Report.ID", () => {
    const r = reconcile({ ...claim, Title: "Report 1" }, indexEvidence([{ ...ev, Title: "REP-20863" }]), opts);
    expect(r.evidence).toBeDefined();
  });
  it("prefers the newest evidence row when there are duplicates (R6)", () => {
    const older = { ...ev, Created: "2026-09-12T10:00:00Z", Penjualan: 1 };
    const newer = { ...ev, Created: "2026-09-12T11:00:00Z" };
    const r = reconcile(claim, indexEvidence([older, newer]), opts);
    expect(r.evidenceCount).toBe(2);
    expect(r.evidence).toBe(newer);
  });
  it("EVIDENCE_MISSING when nothing joins", () => {
    expect(reconcile(claim, indexEvidence([]), opts).reason).toBe("EVIDENCE_MISSING");
  });
  it("ORPHAN_EVIDENCE when the evidence belongs to another host (M6)", () => {
    const r = reconcile(claim, indexEvidence([{ ...ev, HostID: "HST-9" }]), opts);
    expect(r.reason).toBe("ORPHAN_EVIDENCE");
    expect(r.mismatchedKeys).toEqual(["HostID"]);
  });
  it("METRIC_EMPTY when the AI left a compared metric blank", () => {
    expect(reconcile(claim, indexEvidence([{ ...ev, CTR: null }]), opts).reason).toBe("METRIC_EMPTY");
  });
  it("ZERO_ZERO when every compared metric is zero on both sides", () => {
    const zeros = Object.fromEntries(COMPARED_METRICS.map((m) => [m.key, 0]));
    expect(reconcile({ ...claim, ...zeros }, indexEvidence([{ ...ev, ...zeros }]), opts).reason).toBe("ZERO_ZERO");
  });
  it("ZERO_ZERO still applies when only the extra metrics carry values", () => {
    const zeros = { ...Object.fromEntries(COMPARED_METRICS.map((m) => [m.key, 0])), "Durasi(Min)": 120, TotalViewer: 400 };
    expect(reconcile({ ...claim, ...zeros }, indexEvidence([{ ...ev, ...zeros }]), opts).reason).toBe("ZERO_ZERO");
  });
  it("LOW_CONFIDENCE only when a confidence value is present and below the threshold", () => {
    const matching = { ...ev, ...Object.fromEntries(COMPARED_METRICS.map((m) => [m.key, (claim as Record<string, unknown>)[m.key]])) };
    expect(reconcile(claim, indexEvidence([{ ...matching, Confidence: 0.6 }]), opts).reason).toBe("LOW_CONFIDENCE");
    expect(reconcile(claim, indexEvidence([{ ...matching, Confidence: 91 }]), opts).reason).toBe("ALL_MATCH");
    expect(reconcile(claim, indexEvidence([matching]), opts).reason).toBe("ALL_MATCH");
  });
});

describe("reconcile — all metrics", () => {
  it("compares the five extra metrics when they are sent, and skips them when neither side has them", () => {
    const withExtra = reconcile({ ...claim, "Durasi(Min)": 60, AddToCart: 10 }, indexEvidence([{ ...ev, "Durasi(Min)": 181, AddToCart: 10 }]), opts);
    expect(withExtra.metrics.map((m) => m.def.key)).toEqual(["Penjualan", "Pesanan", "ProdukTerjual", "JumlahPembeli", "CTR", "CTOR", "PeakViewer", "Durasi", "AddToCart"]);
    expect(withExtra.outOfTolerance.map((m) => m.def.key)).toContain("Durasi");
    expect(reconcile(claim, indexEvidence([ev]), opts).metrics).toHaveLength(7);
  });
  it("sameValue marks exact matches (0 %) only", () => {
    expect(sameValue({ claim: 7, evidence: 7 })).toBe(true);
    expect(sameValue({ claim: 0, evidence: 0 })).toBe(true);
    expect(sameValue({ claim: 7, evidence: 7.1 })).toBe(false);
    expect(sameValue({ claim: 7, evidence: null })).toBe(false);
  });
});

describe("reviewState — M7 vocabulary", () => {
  it("maps both rejected vocabularies apart", () => {
    expect(reviewState({ ApprovalStatus: "Waiting Approval" })).toBe("WAITING");
    expect(reviewState({ ApprovalStatus: { Value: "Need Revision" } })).toBe("REVISION");
    expect(reviewState({ ApprovalStatus: "Done", ApprovalComment: "Automated Match by AI" })).toBe("DONE_AUTO");
    expect(reviewState({ ApprovalStatus: "Done", ApprovalComment: "ok" })).toBe("DONE_MANUAL");
    expect(reviewState({})).toBe("WAITING");
  });
  it("numericTail", () => {
    expect(numericTail("REP-20863")).toBe("20863");
    expect(numericTail("SCD-0012")).toBe("12");
    expect(numericTail("abc")).toBe("");
  });
});

describe("Report.ApprovalStatus choices", () => {
  const r = (ApprovalStatus: string, extra: Record<string, unknown> = {}) => ({ ApprovalStatus: { Value: ApprovalStatus }, ...extra });
  it("reads all five v1 values", () => {
    expect(reviewState(r("Waiting Approval"))).toBe("WAITING");
    expect(reviewState(r("Waiting Approval Revision"))).toBe("WAITING");
    expect(reviewState(r("Need Revision"))).toBe("REVISION");
    expect(reviewState(r("Done"))).toBe("DONE_MANUAL");
    expect(reviewState(r("Done", { ApprovalComment: "Automated Match by AI" }))).toBe("DONE_AUTO");
    expect(reviewState(r("LiveBreak"))).toBe("LIVE_BREAK");
    expect(reviewState(r("Live Break"))).toBe("LIVE_BREAK");
  });
  it("tells the corrected report apart from a first review", () => {
    expect(isResubmitted(r("Waiting Approval Revision"))).toBe(true);
    expect(isResubmitted(r("Waiting Revision Approval"))).toBe(true);
    expect(reviewState(r("Waiting Revision Approval"))).toBe("WAITING");
    expect(isResubmitted(r("Waiting Approval"))).toBe(false);
    expect(reviewBadge(r("Waiting Approval Revision"), "WAITING").label).toBe("Menunggu review (revisi)");
    expect(reviewBadge(r("Waiting Approval"), "WAITING").label).toBe("Menunggu review");
    expect(reviewBadge(r("LiveBreak"), "LIVE_BREAK").label).toBe("Live break");
  });
});
