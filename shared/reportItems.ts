import { Row, date, nameIndex, rowId, str } from "./data";
import { ReconcileOptions, Reconciliation, ReviewState, indexEvidence, reconcile, reviewState, waitingSince } from "./reconcile";

/** One `Report - PBS Hub` row joined to its `Report Automation - PBS Hub` evidence. */
export interface ReportItem {
  row: Row;
  id: string;
  title: string;
  liveDate: Date | null;
  brandId: string;
  brand: string;
  hostId: string;
  host: string;
  platform: string;
  account: string;
  state: ReviewState;
  rec: Reconciliation;
  since: Date | null;
  /** Bulk approve is only for low confidence where every compared metric is within tolerance. */
  bulkEligible: boolean;
  /** Report.Modified at load time — canvas compares it before writing (optimistic concurrency). */
  modified: string;
}

export function buildReportItems(reports: Row[], evidence: Row[], brands: Row[], hosts: Row[], opts: ReconcileOptions): ReportItem[] {
  const idx = indexEvidence(evidence);
  const brandNames = nameIndex(brands, ["NamaBrand", "BrandName"]);
  const hostNames = nameIndex(hosts, ["NamaHost", "HostName", "HostCode"]);
  return reports.map((r) => {
    const rec = reconcile(r, idx, opts);
    const brandId = str(r, "BrandID");
    const hostId = str(r, "HostID");
    return {
      row: r,
      id: rowId(r),
      title: str(r, "Title"),
      liveDate: date(r, "LiveDate"),
      brandId,
      brand: brandNames.get(brandId) ?? (str(r, "BrandName", "NamaBrand") || brandId || "—"),
      hostId,
      host: hostNames.get(hostId) ?? (str(r, "HostName", "NamaHost") || hostId || "—"),
      platform: str(r, "Platform") || str(rec.evidence, "Platform"),
      account: str(r, "Account", "AccountName") || str(r, "AccountID"),
      state: reviewState(r),
      rec,
      since: waitingSince(r),
      bulkEligible: rec.reason === "LOW_CONFIDENCE" && rec.allWithin,
      modified: str(r, "Modified"),
    };
  });
}

/** The fields canvas needs to address both rows in a write. */
export function itemRef(it: ReportItem): Record<string, unknown> {
  return {
    reportId: it.id,
    title: it.title,
    evidenceId: it.rec.evidence ? rowId(it.rec.evidence) : "",
    evidenceTitle: it.rec.evidence ? str(it.rec.evidence, "Title") : "",
    expectedModified: it.modified,
  };
}
