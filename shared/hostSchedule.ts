import { NO_REPORT_LABEL, Row, date, localDayKey, num, schedulePosition, str } from "./data";
import { clockInAt, clockInDay } from "./payroll";
import { sessionStatus } from "./host";
import { HostOptions, HostSession, clockedDays, hostReportBadge } from "./hostApp";
import { Tone } from "./reconcile";

/**
 * Host schedule (pbs_HostApp.MySchedule / pbs_HostApp.ScheduleDetail). Built on the same session phases as
 * the dashboard, with the words the host already knows from the v1 schedule screen: Planned and
 * Finished (Schedule.Status), plus the one step still missing.
 */

export type ScheduleState =
  | "PLANNED"
  | "SOON" // absen window open, not started yet
  | "LIVE"
  | "NEEDS_CLOCKIN"
  | "NEEDS_ABSEN"
  | "NEEDS_REPORT"
  | "LATE"
  | "REVISION"
  | "WAITING"
  | "FINISHED"
  | "CANCELLED";

export const SCHEDULE_STATE: Record<ScheduleState, { label: string; tone: Tone }> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  SOON: { label: "Segera mulai", tone: "info" },
  LIVE: { label: "Sedang live", tone: "info" },
  NEEDS_CLOCKIN: { label: "Tanpa clock in", tone: "warning" },
  NEEDS_ABSEN: { label: "Perlu absen", tone: "info" },
  NEEDS_REPORT: { label: "Belum report", tone: "warning" },
  LATE: { label: "Report terlambat", tone: "danger" },
  REVISION: { label: "Perlu revisi", tone: "danger" },
  WAITING: { label: "Menunggu review", tone: "info" },
  FINISHED: { label: "Finished", tone: "success" },
  CANCELLED: { label: "Dibatalkan", tone: "neutral" },
};

export const isLive = (s: HostSession, now: Date): boolean => !!s.start && !!s.end && s.start <= now && now <= s.end;

export function scheduleState(s: HostSession, now: Date): ScheduleState {
  switch (s.phase) {
    case "CANCELLED":
      return "CANCELLED";
    case "UPCOMING":
      return "PLANNED";
    case "NOW":
      return isLive(s, now) ? "LIVE" : "SOON";
    case "NEEDS_CLOCKIN":
      return "NEEDS_CLOCKIN";
    case "NEEDS_ABSEN":
      return "NEEDS_ABSEN";
    case "NEEDS_REPORT":
      return s.late ? "LATE" : "NEEDS_REPORT";
    case "NO_REPORT":
      return "FINISHED";
    case "REVISION":
      return "REVISION";
    default:
      // A report is in. Finished once ops decided it (or canvas already closed the schedule).
      return s.reportState === "DONE_AUTO" || s.reportState === "DONE_MANUAL" || s.reportState === "LIVE_BREAK" || (s.reportState !== "WAITING" && sessionStatus(s.row) === "DONE")
        ? "FINISHED"
        : "WAITING";
  }
}

/** Status filter on My schedule: groups of states, not every state on its own. */
export type StatusFilter = "" | "ACTION" | "PLANNED" | "FINISHED" | "CANCELLED";

export const STATUS_FILTERS: { value: Exclude<StatusFilter, "">; label: string; states: ScheduleState[] }[] = [
  { value: "ACTION", label: "Perlu tindakan", states: ["SOON", "LIVE", "NEEDS_CLOCKIN", "NEEDS_ABSEN", "NEEDS_REPORT", "LATE", "REVISION"] },
  { value: "PLANNED", label: "Planned", states: ["PLANNED"] },
  { value: "FINISHED", label: "Finished / menunggu review", states: ["WAITING", "FINISHED"] },
  { value: "CANCELLED", label: "Dibatalkan", states: ["CANCELLED"] },
];

export const needsAction = (st: ScheduleState): boolean => STATUS_FILTERS[0]?.states.includes(st) ?? false;

/** Scheduled minutes: end − start, else JamLive hours. */
export function durationMin(s: HostSession): number | null {
  if (s.start && s.end) return Math.round((s.end.getTime() - s.start.getTime()) / 60000);
  const h = num(s.row, "JamLive", "TotalLiveTime");
  return h === null ? null : Math.round(h * 60);
}

export const fmtHours = (min: number | null): string => {
  if (min === null) return "—";
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
};

/** Main Host / Co Host when the tenant keeps it on Schedule. */
export const positionOf = (row: Row): string => schedulePosition(row);

export interface ScheduleQuery {
  platform: string;
  status: StatusFilter;
  search: string;
}

export function matchesQuery(s: HostSession, st: ScheduleState, q: ScheduleQuery): boolean {
  if (q.platform && s.platform.toLowerCase() !== q.platform.toLowerCase()) return false;
  if (q.status && !STATUS_FILTERS.find((f) => f.value === q.status)?.states.includes(st)) return false;
  const t = q.search.trim().toLowerCase();
  if (!t) return true;
  return [s.title, s.brand, s.account, s.accountId, s.studio, s.platform].some((x) => x.toLowerCase().includes(t));
}

export interface ScheduleKpis {
  /** Sessions in the period, cancelled excluded. */
  sessions: number;
  upcoming: number;
  /** Scheduled minutes already past / all scheduled minutes in the period. */
  doneMin: number;
  totalMin: number;
  /** Today: sessions with an absen / sessions today. */
  absenToday: number;
  today: number;
  /** Days with a session up to today that have a clock-in / all those days. */
  clockDays: number;
  workDays: number;
  /** Sessions that still need something from the host. */
  action: number;
}

export function scheduleKpis(sessions: HostSession[], clockIns: Row[], now: Date, inRange: (d: Date | null) => boolean): ScheduleKpis {
  const live = sessions.filter((s) => s.phase !== "CANCELLED" && inRange(s.day));
  const todayKey = localDayKey(now);
  const today = live.filter((s) => s.dayKey === todayKey);
  const t = now.getTime();
  let doneMin = 0;
  let totalMin = 0;
  const workDays = new Set<string>();
  for (const s of live) {
    const m = durationMin(s) ?? 0;
    totalMin += m;
    if (s.end && s.end.getTime() <= t) doneMin += m;
    if (s.day && s.dayKey <= todayKey) workDays.add(s.dayKey);
  }
  const clocked = clockedDays(clockIns.filter((c) => inRange(clockInDay(c))));
  return {
    sessions: live.length,
    upcoming: live.filter((s) => s.phase === "UPCOMING").length,
    doneMin,
    totalMin,
    absenToday: today.filter((s) => !!s.absence).length,
    today: today.length,
    clockDays: [...workDays].filter((k) => clocked.has(k)).length,
    workDays: workDays.size,
    action: live.filter((s) => needsAction(scheduleState(s, now))).length,
  };
}

/** The session the "Hari ini" strip offers: the first one today that needs the host, else the next one today. */
export function todayFocus(sessions: HostSession[], now: Date): HostSession | undefined {
  const key = localDayKey(now);
  const today = sessions.filter((s) => s.dayKey === key && s.phase !== "CANCELLED");
  return (
    today.find((s) => ["NOW", "NEEDS_ABSEN", "NEEDS_REPORT", "REVISION"].includes(s.phase)) ??
    today.find((s) => s.phase === "UPCOMING") ??
    today.find((s) => s.phase === "NEEDS_CLOCKIN")
  );
}

// ---- Schedule detail: the steps of one session ---------------------------------------------------

export type StepState = "done" | "now" | "todo" | "missing" | "bad" | "skip";

export interface SessionStep {
  key: "CLOCKIN" | "ABSEN" | "REPORT" | "REVIEW";
  label: string;
  state: StepState;
  text: string;
}

/** The Clock In row of the session day (the newest one when there are several). */
export function clockInOf(s: HostSession, clockIns: Row[]): Row | undefined {
  return clockIns
    .filter((c) => {
      const d = clockInDay(c);
      return !!d && localDayKey(d) === s.dayKey;
    })
    .sort((a, b) => (clockInAt(b)?.getTime() ?? 0) - (clockInAt(a)?.getTime() ?? 0))[0];
}

export function sessionSteps(
  s: HostSession,
  clockIn: Row | undefined,
  now: Date,
  opts: HostOptions,
  fmt: { time: (d: Date | null) => string; day: (d: Date | null) => string },
): SessionStep[] {
  const st = scheduleState(s, now);
  const cancelled = st === "CANCELLED";
  const opensAt = s.start ? new Date(s.start.getTime() - opts.absenLeadMin * 60000) : null;
  const inAt = clockInAt(clockIn);
  const office = str(clockIn, "CheckInOffice", "Office");
  const outside = clockIn ? clockIn.IsInsideGeofence === false || str(clockIn, "IsInsideGeofence").toLowerCase() === "false" : false;

  const clock: SessionStep = {
    key: "CLOCKIN",
    label: "Clock in",
    state: cancelled ? "skip" : s.clockedIn ? "done" : st === "NEEDS_CLOCKIN" ? "missing" : s.phase === "UPCOMING" ? "todo" : "now",
    text: s.clockedIn
      ? `${inAt ? `Clock in ${fmt.time(inAt)}` : str(clockIn, "ClockInTime") ? `Clock in ${str(clockIn, "ClockInTime")}` : "Tercatat"}${office ? ` · ${office}` : ""}${outside ? " · di luar radius studio" : ""}`
      : st === "NEEDS_CLOCKIN"
        ? "Tidak ada clock in di hari ini. Kalau kamu memang live, minta tim PBS menambahkan clock in manual."
        : "Clock in di studio sebelum sesi mulai.",
  };

  const absen: SessionStep = !opts.requireAbsen
    ? { key: "ABSEN", label: "Absen", state: "skip", text: "Tidak dipakai — clock in saja membuka report." }
    : {
        key: "ABSEN",
        label: "Absen",
        state: cancelled ? "skip" : s.absence ? "done" : s.report ? "done" : s.canAbsen ? "now" : st === "NEEDS_CLOCKIN" ? "missing" : "todo",
        text: s.absence
          ? `Tercatat ${fmt.time(date(s.absence, "CheckInTime", "Created"))}${str(s.absence, "Title") ? ` · ${str(s.absence, "Title")}` : ""}`
          : s.report
            ? "Report sudah masuk."
            : s.canAbsen
              ? "Absen sekarang supaya report sesi ini bisa dikirim."
              : !s.clockedIn && s.phase !== "UPCOMING"
                ? "Bisa absen setelah clock in."
                : opensAt
                  ? `Dibuka ${fmt.time(opensAt)}, ${opts.absenLeadMin} menit sebelum sesi mulai.`
                  : "Dibuka saat sesi dimulai.",
      };

  const exempt = s.noReport && !s.report ? NO_REPORT_LABEL[s.noReport] : "";
  const report: SessionStep = {
    key: "REPORT",
    label: "Report",
    state:
      cancelled || exempt
        ? "skip"
        : s.report
          ? st === "REVISION"
            ? "bad"
            : s.partial
              ? st === "LATE"
                ? "bad"
                : "now"
              : "done"
          : st === "LATE"
            ? "bad"
            : st === "NEEDS_REPORT"
              ? "now"
              : st === "NEEDS_CLOCKIN"
                ? "missing"
                : "todo",
    text: exempt
      ? `Tidak perlu report · ${exempt}.`
      : s.partial
        ? `${s.reports.length} report · ${s.reportedMin} dari ${s.requiredMin} menit. Kirim report berikutnya untuk ${s.remainingMin} menit sisanya.`
        : s.report
          ? `${s.reports.length > 1 ? `${s.reports.length} report, terakhir ` : ""}${str(s.report, "Title") || "Report"} dikirim ${fmt.day(date(s.report, "Created", "CreatedDate"))}${st === "REVISION" ? " · dikembalikan untuk revisi" : ""}`
          : st === "LATE"
            ? `Lewat batas ${fmt.day(s.due)}. Kirim sekarang dan jelaskan di catatan.`
            : st === "NEEDS_REPORT"
              ? `Kirim sebelum ${fmt.day(s.due)}.`
              : `Setelah sesi selesai${s.due ? `, paling lambat ${fmt.day(s.due)}` : ""}.`,
  };

  const reviewer = str(s.report, "ApproverName") || (s.report && typeof s.report.Approver === "object" && s.report.Approver ? str(s.report.Approver as Row, "DisplayName") : "");
  const review: SessionStep = {
    key: "REVIEW",
    label: "Review tim PBS",
    state: cancelled || exempt ? "skip" : st === "FINISHED" ? "done" : st === "REVISION" ? "bad" : st === "WAITING" ? "now" : "todo",
    text: exempt
      ? "Tidak ada report untuk direview."
      : st === "FINISHED"
        ? `${s.reportState ? hostReportBadge(s.report, s.reportState).label : "Selesai"}${reviewer ? ` · ${reviewer}` : ""}`
        : st === "REVISION"
          ? `Perlu revisi${reviewer ? ` dari ${reviewer}` : ""}. Perbaiki angka yang ditandai.`
          : st === "WAITING"
            ? "Menunggu review."
            : "Setelah report dikirim.",
  };
  return [clock, absen, report, review];
}

// ---- calendar ------------------------------------------------------------------------------------

export interface CalendarDay {
  key: string; // yyyy-mm-dd, local
  date: Date;
  inMonth: boolean;
}

/** Monday-first weeks that cover the month: 4–6 rows of 7 days. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - lead);
  const last = new Date(year, month + 1, 0);
  const cells = Math.ceil((lead + last.getDate()) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]?.push({ key: localDayKey(date), date, inMonth: date.getMonth() === month });
  }
  return weeks;
}

/** Sessions per local day, in start-time order. */
export function sessionsByDay<T extends { s: HostSession }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.s.dayKey) continue;
    const list = m.get(r.s.dayKey) ?? [];
    list.push(r);
    m.set(r.s.dayKey, list);
  }
  for (const list of m.values()) list.sort((a, b) => (a.s.start?.getTime() ?? 0) - (b.s.start?.getTime() ?? 0));
  return m;
}

/** The day the calendar opens on: today in the current month, else the first day with a session, else the 1st. */
export function initialCalendarDay(year: number, month: number, now: Date, days: Iterable<string>): string {
  if (now.getFullYear() === year && now.getMonth() === month) return localDayKey(now);
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const first = [...days].filter((k) => k.startsWith(prefix)).sort()[0];
  return first ?? `${prefix}01`;
}

// ---- week board (design 11a) and month summary (design 10b) ------------------------------------------

/** Monday 00:00 of the week holding d. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function weekDays(monday: Date): CalendarDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { key: localDayKey(date), date, inMonth: true };
  });
}

/** The week the board opens on: this week in the current month, else the week of the 1st. */
export function initialWeek(year: number, month: number, now: Date): Date {
  if (now.getFullYear() === year && now.getMonth() === month) return weekStart(now);
  return weekStart(new Date(year, month, 1));
}

/** Board legend (design 11a): next session, planned, report in review, approved, report missing. */
export type BoardTone = "next" | "planned" | "review" | "done" | "missing" | "off";

export const BOARD_LEGEND: { tone: BoardTone; label: string }[] = [
  { tone: "next", label: "Berikutnya" },
  { tone: "planned", label: "Terjadwal" },
  { tone: "review", label: "Report direview" },
  { tone: "done", label: "Report disetujui" },
  { tone: "missing", label: "Report belum dikirim" },
];

export function boardTone(st: ScheduleState, isNext: boolean): BoardTone {
  if (st === "CANCELLED") return "off";
  if (isNext || st === "LIVE" || st === "SOON" || st === "NEEDS_ABSEN") return "next";
  if (st === "PLANNED") return "planned";
  if (st === "WAITING") return "review";
  if (st === "FINISHED") return "done";
  return "missing";
}

/** The session the host has to be at next: live now, else the first one that has not started. */
export function nextSession(sessions: HostSession[], now: Date): HostSession | undefined {
  const t = now.getTime();
  const live = sessions.filter((s) => s.phase !== "CANCELLED" && s.start && s.end);
  return (
    live.find((s) => (s.start?.getTime() ?? 0) <= t && (s.end?.getTime() ?? 0) > t) ??
    live.filter((s) => (s.start?.getTime() ?? 0) > t).sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))[0]
  );
}

/**
 * National holidays from Context.config.holidays: ["2026-08-17", …] or the JSON of a canvas date
 * table ([{Value: "2026-08-17"}]). Anything else is ignored.
 */
export function holidaySet(config: Record<string, unknown>): Set<string> {
  const raw = config.holidays;
  const out = new Set<string>();
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\s]+/) : [];
  for (const v of list) {
    const text = typeof v === "string" ? v : v && typeof v === "object" ? String((v as Row).Value ?? (v as Row).Date ?? "") : "";
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return out;
}

export interface SpanStats {
  sessions: number;
  minutes: number;
  brands: string[];
  /** Sessions still owing the host a step: no report, late, revision, no clock in. */
  pending: number;
  pendingFirst: HostSession | undefined;
}

/** Totals for the sessions whose day passes inSpan (a week of the board, or a month). */
export function spanStats(rows: { s: HostSession; st: ScheduleState }[], inSpan: (s: HostSession) => boolean): SpanStats {
  const live = rows.filter((r) => r.st !== "CANCELLED" && inSpan(r.s));
  const brands: string[] = [];
  for (const r of live) if (r.s.brand && r.s.brand !== "—" && !brands.includes(r.s.brand)) brands.push(r.s.brand);
  const pend = live.filter((r) => ["NEEDS_REPORT", "LATE", "REVISION", "NEEDS_CLOCKIN"].includes(r.st));
  return {
    sessions: live.length,
    minutes: live.reduce((a, r) => a + (durationMin(r.s) ?? 0), 0),
    brands,
    pending: pend.length,
    pendingFirst: pend.map((r) => r.s).sort((a, b) => (a.day?.getTime() ?? 0) - (b.day?.getTime() ?? 0))[0],
  };
}
