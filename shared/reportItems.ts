import { Row, date, nameIndex, parseClock, rowId, str } from "./data";
import { fmtClock } from "./format";
import { ReconcileOptions, Reconciliation, ReviewState, indexEvidence, numericTail, reconcile, reviewState, waitingSince } from "./reconcile";

/** Schedule rows by Title (SCD-xxx), ID and numeric tail, so Report.ScheduleID finds its row either way. */
export function indexSchedules(schedules: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const s of schedules) {
    const title = str(s, "Title").trim().toLowerCase();
    if (title && !m.has(title)) m.set(title, s);
    const id = rowId(s);
    if (id && !m.has(`#${id}`)) m.set(`#${id}`, s);
    const tail = numericTail(title);
    if (tail && !m.has(`#${tail}`)) m.set(`#${tail}`, s);
  }
  return m;
}

export function scheduleFor(idx: Map<string, Row>, scheduleId: string): Row | undefined {
  const key = scheduleId.trim().toLowerCase();
  if (!key) return undefined;
  return idx.get(key) ?? idx.get(`#${numericTail(key) || key}`);
}

/** "10:00–12:00" from Schedule.StartTime/EndTime (report's own fields as a fallback); "" when unknown. */
export function liveWindow(schedule: Row | undefined, report?: Row): string {
  const clock = (...fields: string[]) => {
    const raw = str(schedule, ...fields) || str(report, ...fields);
    const m = parseClock(raw);
    return m === null ? raw : fmtClock(m);
  };
  const start = clock("StartTime", "JamMulai");
  const end = clock("EndTime", "JamSelesai");
  return start || end ? `${start || "?"}–${end || "?"}` : "";
}

/** One `Report - PBS Hub` row joined to its `Report Automation - PBS Hub` evidence. */
export interface ReportItem {
  row: Row;
  id: string;
  title: string;
  scheduleId: string;
  schedule: Row | undefined;
  /** "10:00–12:00" from the schedule; "" when unknown. */
  liveTime: string;
  /** Report.ApprovalStatus as stored (the choice value); "" when blank. */
  approvalStatus: string;
  playbook: string;
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

export function buildReportItems(reports: Row[], evidence: Row[], brands: Row[], hosts: Row[], opts: ReconcileOptions, schedules: Row[] = []): ReportItem[] {
  const idx = indexEvidence(evidence);
  const sched = indexSchedules(schedules);
  const brandNames = nameIndex(brands, ["NamaBrand", "BrandName"]);
  const hostNames = nameIndex(hosts, ["NamaHost", "HostName", "HostCode"]);
  return reports.map((r) => {
    const rec = reconcile(r, idx, opts);
    const brandId = str(r, "BrandID");
    const hostId = str(r, "HostID");
    const scheduleId = str(r, "ScheduleID");
    const schedule = scheduleFor(sched, scheduleId);
    return {
      row: r,
      id: rowId(r),
      title: str(r, "Title"),
      scheduleId,
      schedule,
      liveTime: liveWindow(schedule, r),
      approvalStatus: str(r, "ApprovalStatus").trim(),
      playbook: str(r, "Playbook").trim(),
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
