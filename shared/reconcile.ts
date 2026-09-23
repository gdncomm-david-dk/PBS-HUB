/**
 * Report ↔ Report Automation reconciliation, for DISPLAY only.
 *
 * Mirrors what PBS0005A does (DESIGN.md UC-4) so the reviewer sees the same verdict the flow
 * computed, and adds the six "Alasan" categories the Ops Console design asks for. Nothing here
 * writes a verdict: the reviewer's decision is emitted as an action and canvas patches the list.
 *
 * Data mapping (DESIGN.md → Database Schema):
 *   Report - PBS Hub             = the host's CLAIM
 *   Report Automation - PBS Hub  = the AI-extracted EVIDENCE
 *   Join: ReportAutomation.Title = Report.Title, or the numeric tail of ReportAutomation.Title =
 *         Report.ID (the `int(last(split(Title,'-')))` trick PBS0005A uses).
 */
import { Row, date, num, rowId, str } from "./data";

export type MetricFormat = "idr" | "int" | "pct" | "min";

export interface MetricDef {
  key: string;
  label: string;
  format: MetricFormat;
  /** Column-name aliases, first is canonical. */
  fields: string[];
}

/** The seven metrics PBS0005A compares, in the order the design shows them. */
export const COMPARED_METRICS: MetricDef[] = [
  { key: "Penjualan", label: "Penjualan", format: "idr", fields: ["Penjualan"] },
  { key: "Pesanan", label: "Pesanan", format: "int", fields: ["Pesanan"] },
  { key: "ProdukTerjual", label: "Produk terjual", format: "int", fields: ["ProdukTerjual", "Produk_x0020_Terjual"] },
  { key: "JumlahPembeli", label: "Jumlah pembeli", format: "int", fields: ["JumlahPembeli", "Jumlah_x0020_Pembeli"] },
  { key: "CTR", label: "CTR", format: "pct", fields: ["CTR"] },
  { key: "CTOR", label: "CTOR", format: "pct", fields: ["CTOR"] },
  { key: "PeakViewer", label: "Peak viewer", format: "int", fields: ["PeakViewer", "Peak_x0020_Viewer"] },
];

/** Captured on both sides but not compared by PBS0005A (finding M1). The reviewer compares them too. */
export const UNCOMPARED_METRICS: MetricDef[] = [
  { key: "Durasi", label: "Durasi", format: "min", fields: ["Durasi(Min)", "Durasi_x0028_Min_x0029_", "DurasiMin", "Durasi"] },
  { key: "AddToCart", label: "AddToCart", format: "int", fields: ["AddToCart", "Add_x0020_To_x0020_Cart"] },
  { key: "TotalViewer", label: "TotalViewer", format: "int", fields: ["TotalViewer", "Total_x0020_Viewer"] },
  { key: "Comment", label: "Comment", format: "int", fields: ["Comment"] },
  { key: "Share", label: "Share", format: "int", fields: ["Share"] },
];

/** Every metric the host reports and the AI reads, in display order. All of them are compared. */
export const ALL_METRICS: MetricDef[] = [...COMPARED_METRICS, ...UNCOMPARED_METRICS];

/** Claim and evidence are identical (0 % difference): nothing for the host to fix. */
export function sameValue(m: { claim: number | null; evidence: number | null }): boolean {
  return m.claim !== null && m.evidence !== null && Math.abs(m.claim - m.evidence) < 1e-9;
}

export type ReasonCode =
  | "OUT_OF_TOLERANCE"
  | "EVIDENCE_MISSING"
  | "LOW_CONFIDENCE"
  | "METRIC_EMPTY"
  | "ZERO_ZERO"
  | "ORPHAN_EVIDENCE"
  | "ALL_MATCH";

export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export const REASONS: Record<ReasonCode, { label: string; tone: Tone }> = {
  OUT_OF_TOLERANCE: { label: "Di luar toleransi", tone: "warning" },
  EVIDENCE_MISSING: { label: "Bukti belum ada", tone: "neutral" },
  LOW_CONFIDENCE: { label: "Confidence rendah", tone: "warning" },
  METRIC_EMPTY: { label: "Metrik kosong", tone: "warning" },
  ZERO_ZERO: { label: "Nol lawan nol", tone: "danger" },
  ORPHAN_EVIDENCE: { label: "Bukti yatim", tone: "danger" },
  ALL_MATCH: { label: "Semua cocok", tone: "success" },
};

export type ReviewState = "WAITING" | "REVISION" | "DONE_AUTO" | "DONE_MANUAL" | "OTHER";

export const REVIEW_STATES: Record<ReviewState, { label: string; tone: Tone }> = {
  WAITING: { label: "Menunggu review", tone: "neutral" },
  REVISION: { label: "Perlu revisi", tone: "danger" },
  DONE_AUTO: { label: "Otomatis disetujui", tone: "info" },
  DONE_MANUAL: { label: "Selesai", tone: "success" },
  OTHER: { label: "Lainnya", tone: "neutral" },
};

/**
 * Report.ApprovalStatus vocabulary. v1 writes two different words for the same "rejected" state:
 * PBS0005A writes `Waiting Approval`, the canvas manual reject writes `Need Revision` (finding M7).
 * `Waiting Approval` needs the reviewer; `Need Revision` is waiting on the host.
 */
export function reviewState(report: Row): ReviewState {
  const s = str(report, "ApprovalStatus").toLowerCase();
  if (s === "" || s.startsWith("waiting") || s === "menunggu" || s === "pending" || s === "menunggu review") return "WAITING";
  if (s.includes("revis") || s === "rejected" || s === "ditolak") return "REVISION";
  if (s === "done" || s === "approved" || s === "selesai" || s === "disetujui") {
    return isAutomatedDecision(report) ? "DONE_AUTO" : "DONE_MANUAL";
  }
  return "OTHER";
}

/** PBS0005A stamps "Automated Match by AI" / "Automated Rejected by AI" into ApprovalComment. */
export function isAutomatedDecision(report: Row): boolean {
  return /automated/i.test(str(report, "ApprovalComment"));
}

export interface MetricComparison {
  def: MetricDef;
  claim: number | null;
  evidence: number | null;
  /** (claim − evidence) / evidence; null when the evidence is 0 or either side is blank. */
  ratio: number | null;
  /** Result of PBS0005A's rule: evidence×(1−t) ≤ claim ≤ evidence×(1+t). */
  within: boolean;
  /** Why it is not comparable, if it is not. */
  note: "" | "claim-empty" | "evidence-empty" | "evidence-zero" | "zero-zero";
}

export function readMetric(row: Row | undefined, def: MetricDef): number | null {
  return num(row, ...def.fields);
}

export function compareMetric(def: MetricDef, report: Row, evidence: Row | undefined, tolerancePct: number): MetricComparison {
  const t = tolerancePct / 100;
  const claim = readMetric(report, def);
  const ev = evidence ? readMetric(evidence, def) : null;
  if (ev === null) return { def, claim, evidence: ev, ratio: null, within: false, note: "evidence-empty" };
  if (claim === null) return { def, claim, evidence: ev, ratio: null, within: false, note: "claim-empty" };
  if (ev === 0) {
    // The band collapses to [0,0] (finding M4): only an exact zero matches.
    return { def, claim, evidence: ev, ratio: null, within: claim === 0, note: claim === 0 ? "zero-zero" : "evidence-zero" };
  }
  const within = claim <= ev * (1 + t) + 1e-9 && claim >= ev * (1 - t) - 1e-9;
  return { def, claim, evidence: ev, ratio: (claim - ev) / ev, within, note: "" };
}

/** Numeric tail of a Title: "RPT-20863" → "20863", "SCD-12_Tiktok" → "12". */
export function numericTail(title: string): string {
  const parts = title.split("-");
  const last = parts[parts.length - 1] ?? "";
  const m = /^(\d+)/.exec(last);
  return m ? String(Number(m[1])) : "";
}

export interface EvidenceIndex {
  byTitle: Map<string, Row[]>;
  byTail: Map<string, Row[]>;
}

export function indexEvidence(evidence: Row[]): EvidenceIndex {
  const byTitle = new Map<string, Row[]>();
  const byTail = new Map<string, Row[]>();
  for (const e of evidence) {
    const title = str(e, "Title");
    if (!title) continue;
    const k = title.toLowerCase();
    byTitle.set(k, [...(byTitle.get(k) ?? []), e]);
    const tail = numericTail(title);
    if (tail) byTail.set(tail, [...(byTail.get(tail) ?? []), e]);
  }
  return { byTitle, byTail };
}

const createdAt = (r: Row): number => (date(r, "Created", "CreatedDate", "Modified")?.getTime() ?? 0);

/** Finds this report's evidence. Several rows can exist for one report (finding R6): newest wins. */
export function findEvidence(report: Row, idx: EvidenceIndex): { evidence: Row | undefined; count: number } {
  const title = str(report, "Title").toLowerCase();
  let hits = title ? idx.byTitle.get(title) ?? [] : [];
  if (hits.length === 0) {
    const id = rowId(report);
    if (id) hits = idx.byTail.get(String(Number(id))) ?? [];
  }
  if (hits.length === 0) return { evidence: undefined, count: 0 };
  const sorted = [...hits].sort((a, b) => createdAt(b) - createdAt(a));
  return { evidence: sorted[0], count: hits.length };
}

/**
 * The resolved evidence row must describe the same session. PBS0005A never checks (finding M6), so a
 * mis-named screenshot reconciles the wrong report. Any soft key present on BOTH sides that differs
 * makes the evidence an orphan.
 */
export function identityMismatch(report: Row, evidence: Row): string[] {
  const out: string[] = [];
  for (const key of ["HostID", "ScheduleID", "AccountID", "BrandID"]) {
    const a = str(report, key);
    const b = str(evidence, key);
    if (a && b && a.toLowerCase() !== b.toLowerCase()) out.push(key);
  }
  return out;
}

export interface ReconcileOptions {
  tolerancePct: number;
  confidenceThreshold: number;
}

export const DEFAULT_OPTIONS: ReconcileOptions = { tolerancePct: 5, confidenceThreshold: 0.85 };

export interface Reconciliation {
  reason: ReasonCode;
  /** e.g. "Penjualan +12,9%" for OUT_OF_TOLERANCE; the mismatching key for ORPHAN_EVIDENCE. */
  metrics: MetricComparison[];
  outOfTolerance: MetricComparison[];
  allWithin: boolean;
  confidence: number | null;
  evidence: Row | undefined;
  evidenceCount: number;
  mismatchedKeys: string[];
}

export function readConfidence(evidence: Row | undefined): number | null {
  const c = num(evidence, "Confidence", "ConfidenceScore", "AIConfidence");
  if (c === null) return null;
  return c > 1 ? c / 100 : c;
}

export function reconcile(report: Row, idx: EvidenceIndex, opts: ReconcileOptions = DEFAULT_OPTIONS): Reconciliation {
  const { evidence, count } = findEvidence(report, idx);
  return reconcileWith(report, evidence, count, opts);
}

export function reconcileWith(report: Row, evidence: Row | undefined, evidenceCount: number, opts: ReconcileOptions = DEFAULT_OPTIONS): Reconciliation {
  // The seven PBS0005A metrics always; the other five whenever either side carries a value.
  const metrics = ALL_METRICS.map((d) => compareMetric(d, report, evidence, opts.tolerancePct)).filter(
    (m) => COMPARED_METRICS.includes(m.def) || m.claim !== null || m.evidence !== null,
  );
  const outOfTolerance = metrics.filter((m) => !m.within);
  const allWithin = outOfTolerance.length === 0;
  const confidence = readConfidence(evidence);
  const base = { metrics, outOfTolerance, allWithin, confidence, evidence, evidenceCount };

  if (!evidence) return { ...base, reason: "EVIDENCE_MISSING", mismatchedKeys: [] };
  const mismatchedKeys = identityMismatch(report, evidence);
  if (mismatchedKeys.length > 0) return { ...base, reason: "ORPHAN_EVIDENCE", mismatchedKeys };
  if (metrics.some((m) => m.note === "evidence-empty")) return { ...base, reason: "METRIC_EMPTY", mismatchedKeys };
  // Zero sales on every core metric is suspicious even when duration/viewers are filled.
  if (metrics.filter((m) => COMPARED_METRICS.includes(m.def)).every((m) => m.note === "zero-zero")) return { ...base, reason: "ZERO_ZERO", mismatchedKeys };
  if (confidence !== null && confidence < opts.confidenceThreshold) return { ...base, reason: "LOW_CONFIDENCE", mismatchedKeys };
  if (!allWithin) return { ...base, reason: "OUT_OF_TOLERANCE", mismatchedKeys };
  return { ...base, reason: "ALL_MATCH", mismatchedKeys };
}

/** Short detail shown next to the reason badge ("Penjualan +12,9%", "cocok", "HostID beda"). */
export function reasonDetail(r: Reconciliation, fmtSignedPct: (x: number | null) => string): string {
  switch (r.reason) {
    case "OUT_OF_TOLERANCE": {
      const worst = [...r.outOfTolerance].sort((a, b) => Math.abs(b.ratio ?? 0) - Math.abs(a.ratio ?? 0))[0];
      if (!worst) return "";
      const extra = r.outOfTolerance.length > 1 ? ` +${r.outOfTolerance.length - 1}` : "";
      return worst.ratio === null ? `${worst.def.label}${extra}` : `${worst.def.label} ${fmtSignedPct(worst.ratio)}${extra}`;
    }
    case "LOW_CONFIDENCE":
      return r.allWithin ? "cocok" : `${r.outOfTolerance.length} metrik beda`;
    case "METRIC_EMPTY": {
      const n = r.metrics.filter((m) => m.note === "evidence-empty").length;
      return `${n} dari ${r.metrics.length} kosong`;
    }
    case "ORPHAN_EVIDENCE":
      return `${r.mismatchedKeys.join(", ")} beda`;
    default:
      return "";
  }
}

/** When the report entered the reviewer's queue: its creation, falling back to the live date. */
export function waitingSince(report: Row): Date | null {
  return date(report, "Created", "CreatedDate") ?? date(report, "LiveDate");
}
