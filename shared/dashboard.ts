/**
 * Dashboard aggregation (pbs_Ops.Dashboard). Read-only: every number is a count over rows canvas
 * already loaded; every card is a door into the module that owns the decision.
 *
 * Data mapping (DESIGN.md → Database Schema):
 *   Schedule - PBS Hub          Title (SCD-<ID>), Date, BrandID, StudioID, HostID, Platform,
 *                               StartTime, EndTime, Status, JamLive, Account
 *   Report - PBS Hub            Title, ScheduleID, HostID, BrandID, ApprovalStatus, Match,
 *                               ApprovalComment, Created
 *   Report Automation - PBS Hub Title, Status (Match/Unmatch), Created
 *   Clock In - PBS Hub          HostID, ClockInDate, CheckInTime, CheckOutTime, ClockOutTime,
 *                               IsInsideGeofence, Streak, EmployeeName
 *   Host - PBS Hub              Title (HostID), NamaHost, Status, HasRekening (computed in canvas —
 *                               never send NoRekening/KTP into a control)
 *   Studio - PBS Hub            Title (StudioID), NamaStudio, KapasitasHost, Status
 *   Brand - PBS Hub             Title (BrandID), NamaBrand
 *   Payroll - PBS Hub           Title (PAY-<ID>), Periode, Status, Created
 */
import { Row, bool, date, localDayKey, nameIndex, noReportReason, num, parseClock, reportScheduleId, rowId, startOfDay, str } from "./data";
import { EvidenceIndex, ReasonCode, ReconcileOptions, indexEvidence, numericTail, reconcile, reviewState } from "./reconcile";
import { monthName } from "./format";

export interface DashboardInput {
  schedules: Row[];
  reports: Row[];
  evidence: Row[];
  clockIns: Row[];
  hosts: Row[];
  studios: Row[];
  brands: Row[];
  payrolls: Row[];
  now: Date;
  maxShiftHours: number;
  missingReportDays: number;
  reconcile: ReconcileOptions;
}

export type SessionState = "live" | "waitingReport" | "notStarted" | "reported" | "cancelled";

export interface SessionToday {
  id: string;
  title: string;
  start: number | null;
  end: number | null;
  brand: string;
  host: string;
  studio: string;
  platform: string;
  state: SessionState;
  /** Minutes left, for live sessions. */
  remaining: number | null;
  rawStatus: string;
}

export interface Conflict {
  kind: "HOST_DOUBLE" | "STUDIO_OVER";
  day: Date;
  title: string;
  detail: string;
  scheduleIds: string[];
}

export interface DashboardModel {
  now: Date;
  review: { count: number; overdue: number; breakdown: { reason: ReasonCode; count: number }[] };
  gps: { count: number; today: number };
  openShift: { count: number; hours: number };
  missingReport: { count: number; days: number };
  totalWaiting: number;
  sessions: SessionToday[];
  sessionSummary: { count: number; liveHours: number; studiosUsed: number; studiosActive: number; waitingReport: number };
  conflicts: Conflict[];
  automation: { evidenceToday: number; autoMatchToday: number; autoUnmatchToday: number; streakHosts: number; lastStreakRun: Date };
  payroll: {
    periodLabel: string;
    activeHosts: number;
    withAttendance: number;
    withoutAttendance: number;
    reportsNotReviewed: number;
    hostsWithoutBank: number | null;
    lastRun: { title: string; periode: string; status: string; created: Date | null } | null;
    openRun: boolean;
  };
}

const CANCELLED = ["cancelled", "canceled", "batal", "dibatalkan", "leave", "cuti"];
const DONE = ["done", "finished", "selesai"];

function isActive(row: Row): boolean {
  const s = str(row, "Status").toLowerCase();
  return s === "" || s === "active" || s === "aktif";
}

function dayOf(row: Row, ...keys: string[]): Date | null {
  const d = date(row, ...keys);
  return d ? startOfDay(d) : null;
}

/** Report lookup by the schedule it belongs to — Report.ScheduleID holds `SCD-<ID>` or the bare ID. */
function reportedScheduleKeys(reports: Row[]): Set<string> {
  const s = new Set<string>();
  for (const r of reports) {
    const sid = reportScheduleId(r);
    if (!sid) continue;
    s.add(sid.toLowerCase());
    const tail = numericTail(sid);
    if (tail) s.add(`#${tail}`);
  }
  return s;
}

function scheduleHasReport(s: Row, keys: Set<string>): boolean {
  const title = str(s, "Title").toLowerCase();
  if (title && keys.has(title)) return true;
  const id = rowId(s);
  if (id && keys.has(`#${Number(id)}`)) return true;
  const tail = numericTail(title);
  return !!tail && keys.has(`#${tail}`);
}

function timeRange(s: Row): { start: number | null; end: number | null } {
  let start = parseClock(str(s, "StartTime", "Start", "JamMulai"));
  let end = parseClock(str(s, "EndTime", "End", "JamSelesai"));
  if (start === null) {
    // Some bulk rows carry the time on the Date column itself.
    const d = date(s, "Date");
    if (d && (d.getHours() !== 0 || d.getMinutes() !== 0)) start = d.getHours() * 60 + d.getMinutes();
  }
  if (start !== null && end === null) {
    const jam = num(s, "JamLive", "TotalLiveTime");
    if (jam !== null) end = start + Math.round(jam * 60);
  }
  if (start !== null && end !== null && end <= start) end += 24 * 60; // crosses midnight
  return { start, end };
}

function weekBounds(now: Date): { from: Date; to: Date } {
  const d = startOfDay(now);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return { from, to };
}

export function buildDashboard(input: DashboardInput): DashboardModel {
  const { now } = input;
  const today = startOfDay(now);
  const todayKey = localDayKey(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const brands = nameIndex(input.brands, ["NamaBrand", "BrandName"]);
  const hosts = nameIndex(input.hosts, ["NamaHost", "HostName", "HostCode"]);
  const studioNames = nameIndex(input.studios, ["NamaStudio", "StudioName"]);
  const capacity = new Map<string, number>();
  for (const st of input.studios) {
    const c = num(st, "KapasitasHost", "Kapasitas");
    if (str(st, "Title") && c !== null && c > 0) capacity.set(str(st, "Title"), c);
  }
  const label = (m: Map<string, string>, k: string) => (k ? m.get(k) ?? k : "—");

  // ---- review queue --------------------------------------------------------------------------
  const idx: EvidenceIndex = indexEvidence(input.evidence);
  const waiting = input.reports.filter((r) => reviewState(r) === "WAITING");
  const counts = new Map<ReasonCode, number>();
  let overdue = 0;
  for (const r of waiting) {
    const rec = reconcile(r, idx, input.reconcile);
    counts.set(rec.reason, (counts.get(rec.reason) ?? 0) + 1);
    const since = date(r, "Created", "CreatedDate") ?? date(r, "LiveDate");
    if (since && now.getTime() - since.getTime() >= 3 * 86400000) overdue++;
  }
  const order: ReasonCode[] = ["OUT_OF_TOLERANCE", "EVIDENCE_MISSING", "LOW_CONFIDENCE", "METRIC_EMPTY", "ZERO_ZERO", "ORPHAN_EVIDENCE", "ALL_MATCH"];
  const breakdown = order.filter((k) => counts.has(k)).map((k) => ({ reason: k, count: counts.get(k) ?? 0 }));

  // ---- clock in ------------------------------------------------------------------------------
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const inMonth = input.clockIns.filter((c) => {
    const d = dayOf(c, "ClockInDate", "CheckInTime", "Created");
    return d !== null && d >= monthStart && d <= today;
  });
  const outside = inMonth.filter((c) => bool(c, "IsInsideGeofence") === false);
  const gpsToday = outside.filter((c) => {
    const d = dayOf(c, "ClockInDate", "CheckInTime", "Created");
    return d !== null && localDayKey(d) === todayKey;
  }).length;

  const openShifts = input.clockIns.filter((c) => {
    const inAt = date(c, "CheckInTime") ?? date(c, "ClockInDate");
    if (!inAt) return false;
    const out = str(c, "CheckOutTime") || str(c, "ClockOutTime") || str(c, "ClockOutDate");
    if (out) return false;
    return now.getTime() - inAt.getTime() > input.maxShiftHours * 3600000;
  });

  // ---- schedule ------------------------------------------------------------------------------
  const reported = reportedScheduleKeys(input.reports);
  const missingCutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - input.missingReportDays);
  const missing = input.schedules.filter((s) => {
    const d = dayOf(s, "Date");
    if (!d || d > missingCutoff) return false;
    if (CANCELLED.includes(str(s, "Status").toLowerCase())) return false;
    if (noReportReason(s)) return false; // live break or Co-Host: nothing owed
    return !scheduleHasReport(s, reported);
  });

  const sessions: SessionToday[] = input.schedules
    .filter((s) => {
      const d = dayOf(s, "Date");
      return d !== null && localDayKey(d) === todayKey;
    })
    .map((s) => {
      const { start, end } = timeRange(s);
      const raw = str(s, "Status");
      const low = raw.toLowerCase();
      let state: SessionState;
      let remaining: number | null = null;
      if (CANCELLED.includes(low)) state = "cancelled";
      else if (scheduleHasReport(s, reported)) state = "reported";
      else if (DONE.includes(low) || low === "waiting report") state = "waitingReport";
      else if (start !== null && end !== null && nowMin >= start && nowMin < end) {
        state = "live";
        remaining = end - nowMin;
      } else if (end !== null && nowMin >= end) state = "waitingReport";
      else state = "notStarted";
      return {
        id: rowId(s),
        title: str(s, "Title"),
        start,
        end,
        brand: label(brands, str(s, "BrandID")),
        host: label(hosts, str(s, "HostID")),
        studio: label(studioNames, str(s, "StudioID")),
        platform: str(s, "Platform"),
        state,
        remaining,
        rawStatus: raw,
      };
    })
    .sort((a, b) => (a.start ?? 9999) - (b.start ?? 9999));

  const running = sessions.filter((s) => s.state !== "cancelled");
  const liveMinutes = running.reduce((acc, s) => acc + (s.start !== null && s.end !== null ? s.end - s.start : 0), 0);
  const studiosUsed = new Set(running.map((s) => s.studio)).size;
  const studiosActive = input.studios.filter(isActive).length;

  // ---- conflicts this week -------------------------------------------------------------------
  const { from, to } = weekBounds(now);
  const week = input.schedules.filter((s) => {
    const d = dayOf(s, "Date");
    return d !== null && d >= from && d < to && !CANCELLED.includes(str(s, "Status").toLowerCase());
  });
  const conflicts: Conflict[] = [];
  const groupBy = (key: (s: Row) => string) => {
    const g = new Map<string, Row[]>();
    for (const s of week) {
      const k = key(s);
      if (!k) continue;
      g.set(k, [...(g.get(k) ?? []), s]);
    }
    return g;
  };
  const fmtRange = (s: Row) => {
    const { start, end } = timeRange(s);
    const c = (m: number | null) => (m === null ? "?" : `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    return `${c(start)}–${c(end)}`;
  };
  for (const [k, rows] of groupBy((s) => (str(s, "HostID") ? `${str(s, "HostID")}|${localDayKey(dayOf(s, "Date") as Date)}` : ""))) {
    const sorted = rows.map((s) => ({ s, ...timeRange(s) })).filter((x) => x.start !== null && x.end !== null).sort((a, b) => (a.start as number) - (b.start as number));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if ((cur.start as number) < (prev.end as number)) {
        const hostId = k.split("|")[0] ?? "";
        conflicts.push({
          kind: "HOST_DOUBLE",
          day: dayOf(cur.s, "Date") as Date,
          title: `${label(hosts, hostId)} terjadwal dobel`,
          detail: `${fmtRange(prev.s)} di ${label(studioNames, str(prev.s, "StudioID"))} dan ${fmtRange(cur.s)} di ${label(studioNames, str(cur.s, "StudioID"))}`,
          scheduleIds: [str(prev.s, "Title"), str(cur.s, "Title")].filter(Boolean),
        });
      }
    }
  }
  for (const [k, rows] of groupBy((s) => (str(s, "StudioID") ? `${str(s, "StudioID")}|${localDayKey(dayOf(s, "Date") as Date)}` : ""))) {
    const studioId = k.split("|")[0] ?? "";
    const cap = capacity.get(studioId);
    if (!cap) continue;
    const events: [number, number][] = [];
    for (const s of rows) {
      const { start, end } = timeRange(s);
      if (start === null || end === null) continue;
      events.push([start, 1], [end, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let peak = 0;
    for (const [, delta] of events) {
      cur += delta;
      peak = Math.max(peak, cur);
    }
    if (peak > cap) {
      conflicts.push({
        kind: "STUDIO_OVER",
        day: dayOf(rows[0] as Row, "Date") as Date,
        title: `${label(studioNames, studioId)} lewat kapasitas`,
        detail: `${peak} sesi bersamaan, KapasitasHost ${cap}`,
        scheduleIds: rows.map((s) => str(s, "Title")).filter(Boolean),
      });
    }
  }
  conflicts.sort((a, b) => a.day.getTime() - b.day.getTime());

  // ---- automation ----------------------------------------------------------------------------
  const isToday = (r: Row, ...keys: string[]) => {
    const d = dayOf(r, ...keys);
    return d !== null && localDayKey(d) === todayKey;
  };
  const evidenceToday = input.evidence.filter((e) => isToday(e, "Created"));
  const autoMatchToday = evidenceToday.filter((e) => str(e, "Status").toLowerCase() === "match").length;
  const autoUnmatchToday = evidenceToday.filter((e) => str(e, "Status").toLowerCase() === "unmatch").length;
  // PBS0001B runs Sunday 23:00 and stamps Streak on the host's most recent row of the week.
  const lastSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const streakFrom = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() - 6);
  const streakHosts = new Set(
    input.clockIns
      .filter((c) => {
        const d = dayOf(c, "ClockInDate", "CheckInTime");
        return d !== null && d >= streakFrom && d <= lastSunday && (num(c, "Streak") ?? 0) > 0;
      })
      .map((c) => str(c, "HostID") || str(c, "EmployeeEmail")),
  ).size;

  // ---- payroll preflight ---------------------------------------------------------------------
  const active = input.hosts.filter(isActive);
  const activeIds = new Set(active.map((h) => str(h, "Title")).filter(Boolean));
  const attended = new Set(inMonth.map((c) => str(c, "HostID")).filter((id) => activeIds.has(id)));
  let hostsWithoutBank: number | null = null;
  if (active.some((h) => bool(h, "HasRekening") !== null || str(h, "NoRekening") !== "")) {
    hostsWithoutBank = active.filter((h) => {
      const flag = bool(h, "HasRekening");
      return flag === null ? str(h, "NoRekening") === "" : !flag;
    }).length;
  }
  const runs = [...input.payrolls].sort((a, b) => (date(b, "Created")?.getTime() ?? 0) - (date(a, "Created")?.getTime() ?? 0) || Number(rowId(b)) - Number(rowId(a)));
  const last = runs[0];
  const lastStatus = last ? str(last, "Status") : "";

  const totalWaiting = waiting.length + outside.length + openShifts.length + missing.length;

  return {
    now,
    review: { count: waiting.length, overdue, breakdown },
    gps: { count: outside.length, today: gpsToday },
    openShift: { count: openShifts.length, hours: input.maxShiftHours },
    missingReport: { count: missing.length, days: input.missingReportDays },
    totalWaiting,
    sessions,
    sessionSummary: {
      count: running.length,
      liveHours: Math.round((liveMinutes / 60) * 10) / 10,
      studiosUsed,
      studiosActive,
      waitingReport: sessions.filter((s) => s.state === "waitingReport").length,
    },
    conflicts,
    automation: { evidenceToday: evidenceToday.length, autoMatchToday, autoUnmatchToday, streakHosts, lastStreakRun: lastSunday },
    payroll: {
      periodLabel: `${monthName(today.getMonth())} ${today.getFullYear()}`,
      activeHosts: active.length,
      withAttendance: attended.size,
      withoutAttendance: Math.max(0, active.length - attended.size),
      reportsNotReviewed: waiting.length,
      hostsWithoutBank,
      lastRun: last ? { title: str(last, "Title"), periode: str(last, "Periode", "PayrollName"), status: lastStatus, created: date(last, "Created") } : null,
      openRun: !!last && !/^(done|rejected)/i.test(lastStatus),
    },
  };
}
