import { Row, clockText, date, localDayKey, nameIndex, noReportReason, num, parseClock, reportScheduleId, rowId, startOfDay, str } from "./data";
import { clockInAt, clockInDay } from "./payroll";
import { sessionStatus } from "./host";
import { ALL_METRICS, MetricDef, NO_STATUS, ReviewState, Tone, isResubmitted, readMetric, reviewState } from "./reconcile";

/**
 * Host self-service (pbs_Host.*): what a host has to do right now. Everything here is derived from
 * the host's own rows — Schedule, Clock In, Host Absence and Report — which canvas filters to the
 * signed-in host before sending.
 *
 * The v1 rule is kept: a report needs a clock-in on the live day and an absen (Host Absence row) for
 * the session. v2 shows the missing step up front instead of after the form is filled.
 */

export interface HostOptions {
  /** Minutes before the start when absen opens. */
  absenLeadMin: number;
  /** Days after the live date a report is still on time. */
  reportDeadlineDays: number;
  /** A shift open longer than this probably missed its clock-out. */
  maxShiftHours: number;
  /** false when the tenant does not use Host Absence: clock-in alone unlocks the report. */
  requireAbsen: boolean;
  /** Report opens only while Schedule.Status is Waiting Report (canvas sets it on absen). */
  requireWaitingStatus: boolean;
  /** Schedule.Status written while report parts are still owed, and once the session is complete. */
  waitingStatus: string;
  doneStatus: string;
  /** Report.Playbook choices for the dropdown (canvas may send Choices(...) instead). */
  playbooks: string[];
}

export const DEFAULT_PLAYBOOKS = ["Flash Sale", "Payday", "Launching Produk", "Reguler"];

export const DEFAULT_HOST_OPTIONS: HostOptions = {
  absenLeadMin: 30,
  reportDeadlineDays: 2,
  maxShiftHours: 12,
  requireAbsen: true,
  requireWaitingStatus: true,
  waitingStatus: "Waiting Report",
  doneStatus: "Done",
  playbooks: DEFAULT_PLAYBOOKS,
};

const off = (v: unknown) => v === false || v === "false";
const text = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);

/** A list from config: an array of strings / {Value} rows, or "a, b, c". */
export function choiceList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const t = (x && typeof x === "object" ? String((x as Record<string, unknown>).Value ?? (x as Record<string, unknown>).Title ?? "") : String(x ?? "")).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function hostOptions(config: Record<string, unknown>): HostOptions {
  const n = (k: string, d: number) => {
    const v = Number(config[k]);
    return config[k] !== undefined && config[k] !== "" && Number.isFinite(v) ? v : d;
  };
  return {
    absenLeadMin: n("absenLeadMin", DEFAULT_HOST_OPTIONS.absenLeadMin),
    reportDeadlineDays: n("reportDeadlineDays", DEFAULT_HOST_OPTIONS.reportDeadlineDays),
    maxShiftHours: n("maxShiftHours", DEFAULT_HOST_OPTIONS.maxShiftHours),
    requireAbsen: !off(config.requireAbsen),
    requireWaitingStatus: !off(config.requireWaitingStatus),
    waitingStatus: text(config.scheduleWaitingStatus, DEFAULT_HOST_OPTIONS.waitingStatus),
    doneStatus: text(config.scheduleDoneStatus, DEFAULT_HOST_OPTIONS.doneStatus),
    playbooks: choiceList(config.playbooks).length ? choiceList(config.playbooks) : DEFAULT_PLAYBOOKS,
  };
}

// ---- Shift (Clock In) ---------------------------------------------------------------------------

export type ShiftState = "NOT_IN" | "IN" | "OUT";

export interface Shift {
  state: ShiftState;
  since: Date | null;
  until: Date | null;
  minutes: number;
  overdue: boolean;
  office: string;
  row: Row | undefined;
}

const checkIn = (c: Row): Date | null => clockInAt(c);
const checkOut = (c: Row): Date | null => date(c, "CheckOutTime") ?? withClock(date(c, "ClockOutDate") ?? clockInDay(c), str(c, "ClockOutTime"));

function withClock(day: Date | null, clock: string): Date | null {
  const m = parseClock(clock);
  if (!day || m === null) return null;
  const d = startOfDay(day);
  d.setMinutes(m);
  return d;
}

/** Days that have a clock-in, local yyyy-mm-dd. */
export function clockedDays(clockIns: Row[]): Set<string> {
  const s = new Set<string>();
  for (const c of clockIns) {
    const d = clockInDay(c);
    if (d) s.add(localDayKey(d));
  }
  return s;
}

export function shiftToday(clockIns: Row[], now: Date, opts: HostOptions = DEFAULT_HOST_OPTIONS): Shift {
  const today = localDayKey(now);
  const rows = clockIns.filter((c) => {
    const d = clockInDay(c);
    return d && localDayKey(d) === today;
  });
  // A shift still open from yesterday counts too: that is the forgotten clock-out case.
  const open = clockIns.find((c) => checkIn(c) && !checkOut(c) && (now.getTime() - (checkIn(c)?.getTime() ?? 0)) / 36e5 < 36);
  const row = open ?? rows.sort((a, b) => (checkIn(b)?.getTime() ?? 0) - (checkIn(a)?.getTime() ?? 0))[0];
  if (!row)
    return {
      state: "NOT_IN",
      since: null,
      until: null,
      minutes: 0,
      overdue: false,
      office: "",
      row: undefined,
    };
  const since = checkIn(row);
  const until = checkOut(row);
  const office = str(row, "CheckInOffice", "Office", "StudioName");
  if (!until) {
    const minutes = since ? Math.max(0, Math.round((now.getTime() - since.getTime()) / 60000)) : 0;
    return {
      state: "IN",
      since,
      until: null,
      minutes,
      overdue: minutes >= opts.maxShiftHours * 60,
      office,
      row,
    };
  }
  const minutes = since ? Math.max(0, Math.round((until.getTime() - since.getTime()) / 60000)) : 0;
  return { state: "OUT", since, until, minutes, overdue: false, office, row };
}

/** Consecutive distinct clock-in days ending today (or yesterday, when today is not in yet). */
export function streakDays(clockIns: Row[], now: Date): number {
  const days = clockedDays(clockIns);
  const d = startOfDay(now);
  if (!days.has(localDayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDayKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---- Report status as the host sees it ----------------------------------------------------------

export const HOST_REPORT_STATE: Record<ReviewState, { label: string; tone: Tone }> = {
  WAITING: { label: "Menunggu review", tone: "neutral" },
  REVISION: { label: "Perlu revisi", tone: "danger" },
  DONE_AUTO: { label: "Otomatis disetujui", tone: "info" },
  DONE_MANUAL: { label: "Selesai", tone: "success" },
  LIVE_BREAK: { label: "Live break", tone: "warning" },
  OTHER: { label: "Lainnya", tone: "neutral" },
};

/** Host wording, with the corrected report (`Waiting Approval Revision`) told apart. */
export function hostReportBadge(report: Row | undefined, state: ReviewState): { label: string; tone: Tone } {
  if (state === "WAITING" && isResubmitted(report)) return { label: "Menunggu review ulang", tone: "info" };
  if (state === "OTHER" && !str(report, "ApprovalStatus")) return NO_STATUS;
  return HOST_REPORT_STATE[state];
}

// ---- Sessions -----------------------------------------------------------------------------------

export type SessionPhase =
  | "UPCOMING" // before absen opens
  | "NOW" // absen window open or live now, nothing done yet
  | "NEEDS_CLOCKIN" // session started/passed, no clock-in that day
  | "NEEDS_ABSEN" // clocked in, no absen for this session
  | "NEEDS_REPORT" // absen done, no report yet (or the parts sent so far do not cover the session)
  | "NO_REPORT" // absen done, live break or Co-Host: no report owed
  | "REVISION" // report sent back to the host
  | "REPORTED" // report submitted: waiting or done
  | "CANCELLED";

export const PHASE_LABEL: Record<SessionPhase, { label: string; tone: Tone }> = {
  UPCOMING: { label: "Belum dimulai", tone: "neutral" },
  NOW: { label: "Sekarang", tone: "info" },
  NEEDS_CLOCKIN: { label: "Belum clock in", tone: "warning" },
  NEEDS_ABSEN: { label: "Perlu absen", tone: "info" },
  NEEDS_REPORT: { label: "Belum dikirim", tone: "warning" },
  NO_REPORT: { label: "Tanpa report", tone: "success" },
  REVISION: { label: "Perlu revisi", tone: "danger" },
  REPORTED: { label: "Report masuk", tone: "success" },
  CANCELLED: { label: "Dibatalkan", tone: "neutral" },
};

export interface HostSession {
  row: Row;
  id: string;
  title: string;
  day: Date | null;
  dayKey: string;
  start: Date | null;
  end: Date | null;
  startText: string;
  endText: string;
  brandId: string;
  brand: string;
  studioId: string;
  studio: string;
  platform: string;
  accountId: string;
  account: string;
  phase: SessionPhase;
  clockedIn: boolean;
  absence: Row | undefined;
  /** The report the host acts on: the one sent back for revision, else the newest. */
  report: Row | undefined;
  reportState: ReviewState | null;
  /** Every report of this session, oldest first. A live that dropped is reported in parts. */
  reports: Row[];
  /** Scheduled minutes (EndTime − StartTime, else JamLive); null when unknown. */
  requiredMin: number | null;
  /** Durasi(Min) summed over the reports. */
  reportedMin: number;
  /** Minutes still to report; 0 once the parts cover the session (or it ended as live break). */
  remainingMin: number;
  /** Some parts are in, but not enough minutes yet: another report is owed. */
  partial: boolean;
  /** Live break or Co-Host: this schedule needs no report. */
  noReport: "LIVE_BREAK" | "CO_HOST" | null;
  /** Report deadline (end of live day + reportDeadlineDays). */
  due: Date | null;
  late: boolean;
  /** Absen can be pressed now. */
  canAbsen: boolean;
}

const byKey = (rows: Row[], key: (r: Row) => string): Map<string, Row> => {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r).toLowerCase();
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
};

export interface HostData {
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  brands: Row[];
  studios: Row[];
}

export function buildHostSessions(d: HostData, now: Date, opts: HostOptions = DEFAULT_HOST_OPTIONS): HostSession[] {
  const brands = nameIndex(d.brands, ["NamaBrand", "BrandName"]);
  const studios = nameIndex(d.studios, ["NamaStudio", "StudioName"]);
  const days = clockedDays(d.clockIns);
  const absBySchedule = byKey(d.absences, (a) => str(a, "ScheduleID"));
  const repBySchedule = reportsBySchedule(d.reports);
  const t = now.getTime();

  return d.schedules
    .map((s): HostSession => {
      const day = date(s, "Date", "Tanggal");
      const dayKey = day ? localDayKey(day) : "";
      const startText = clockText(str(s, "StartTime", "JamMulai"));
      const endText = clockText(str(s, "EndTime", "JamSelesai"));
      const start = withClock(day, startText);
      let end = withClock(day, endText);
      if (start && end && end <= start) end = new Date(end.getTime() + 864e5); // past midnight
      const title = str(s, "Title");
      const absence = absBySchedule.get(title.toLowerCase());
      const reports = repBySchedule.get(title.toLowerCase()) ?? [];
      const report = reports.find((r) => reviewState(r) === "REVISION") ?? reports[reports.length - 1];
      const reportState = report ? reviewState(report) : null;
      const cover = reportCoverage(reports, scheduledMin(start, end, s));
      const noReport = noReportReason(s);
      const clockedIn = !!dayKey && days.has(dayKey);
      const brandId = str(s, "BrandID");
      const studioId = str(s, "StudioID");
      const opens = start ? start.getTime() - opts.absenLeadMin * 60000 : day ? startOfDay(day).getTime() : Infinity;
      const endT = end?.getTime() ?? (day ? startOfDay(day).getTime() + 864e5 - 1 : Infinity);
      const due = day ? new Date(startOfDay(day).getTime() + (opts.reportDeadlineDays + 1) * 864e5 - 1) : null;

      let phase: SessionPhase;
      const hasAbsen = !!absence || !opts.requireAbsen;
      if (sessionStatus(s) === "CANCELLED") phase = "CANCELLED";
      else if (report && reportState === "REVISION") phase = "REVISION";
      else if (report && !cover.partial) phase = "REPORTED";
      else if (report)
        phase = "NEEDS_REPORT"; // a part is in; the rest of the minutes are owed
      else if (t < opens) phase = "UPCOMING";
      else if (noReport && sessionStatus(s) === "DONE")
        phase = "NO_REPORT"; // closed by ops, nothing owed
      else if (hasAbsen && clockedIn) phase = noReport ? "NO_REPORT" : "NEEDS_REPORT";
      else if (!clockedIn) phase = t <= endT ? "NOW" : "NEEDS_CLOCKIN";
      else phase = t <= endT && !absence ? "NOW" : "NEEDS_ABSEN";

      return {
        row: s,
        id: rowId(s),
        title,
        day,
        dayKey,
        start,
        end,
        startText,
        endText,
        brandId,
        brand: brands.get(brandId) ?? (str(s, "BrandName", "NamaBrand") || brandId || "—"),
        studioId,
        studio: studios.get(studioId) ?? (str(s, "StudioName", "NamaStudio") || studioId || "—"),
        platform: str(s, "Platform"),
        accountId: str(s, "AccountID", "Account"),
        account: str(s, "AccountName", "Account") || str(s, "AccountID"),
        phase,
        clockedIn,
        absence,
        report,
        reportState,
        reports,
        ...cover,
        noReport,
        due,
        late: !!due && phase === "NEEDS_REPORT" && t > due.getTime(),
        canAbsen: opts.requireAbsen && !absence && !report && clockedIn && t >= opens && phase !== "CANCELLED",
      };
    })
    .sort((a, b) => (a.start?.getTime() ?? a.day?.getTime() ?? 0) - (b.start?.getTime() ?? b.day?.getTime() ?? 0));
}

const created = (r: Row) => date(r, "Created", "CreatedDate")?.getTime() ?? 0;

/** Reports per schedule (lower-case Title), oldest first. */
export function reportsBySchedule(reports: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of [...reports].sort((a, b) => created(a) - created(b))) {
    const k = reportScheduleId(r).toLowerCase();
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function scheduledMin(start: Date | null, end: Date | null, s: Row): number | null {
  if (start && end) return Math.round((end.getTime() - start.getTime()) / 60000);
  const h = num(s, "JamLive", "TotalLiveTime");
  return h === null || h <= 0 ? null : Math.round(h * 60);
}

const DURASI = ALL_METRICS.find((d) => d.key === "Durasi");
/** Durasi(Min) of one report; null when blank. */
export const reportMinutes = (r: Row): number | null => (DURASI ? readMetric(r, DURASI) : null);

/**
 * How far the reports cover the scheduled minutes. A live that dropped halfway is reported in
 * parts: 120 scheduled, 60 reported → 60 still owed and the schedule stays Waiting Report. A live
 * break report closes the session whatever its minutes; without a scheduled duration one report does.
 */
export function reportCoverage(
  reports: Row[],
  requiredMin: number | null,
): {
  requiredMin: number | null;
  reportedMin: number;
  remainingMin: number;
  partial: boolean;
} {
  const reportedMin = reports.reduce((a, r) => a + (reportMinutes(r) ?? 0), 0);
  // Live break closes the session; so does an older report sent before Durasi was required.
  const closed = reports.some((r) => reviewState(r) === "LIVE_BREAK" || reportMinutes(r) === null);
  const remainingMin = !reports.length ? (requiredMin ?? 0) : closed || requiredMin === null ? 0 : Math.max(0, requiredMin - reportedMin);
  return {
    requiredMin,
    reportedMin,
    remainingMin,
    partial: reports.length > 0 && remainingMin > 0,
  };
}

/** Schedule.Status after a report of `minutes` (Durasi) is added to the ones already in. */
export function statusAfterReport(
  s: HostSession,
  minutes: number,
  opts: HostOptions,
  replacing?: Row,
): {
  status: string;
  complete: boolean;
  totalMin: number;
  remainingMin: number;
} {
  const others = replacing ? s.reports.filter((r) => r !== replacing) : s.reports;
  const totalMin = others.reduce((a, r) => a + (reportMinutes(r) ?? 0), 0) + minutes;
  const remainingMin = s.requiredMin === null ? 0 : Math.max(0, s.requiredMin - totalMin);
  const complete = remainingMin === 0;
  return {
    status: complete ? opts.doneStatus : opts.waitingStatus,
    complete,
    totalMin,
    remainingMin,
  };
}

/** Schedule.Status allows a report: Waiting Report (or the check is off in config). */
export const statusAllowsReport = (s: HostSession, opts: HostOptions): boolean => !opts.requireWaitingStatus || sessionStatus(s.row) === "WAITING_REPORT";

export type ReportBlocker = "CLOCKIN" | "ABSEN" | "NOT_STARTED" | "STATUS" | "NO_REPORT" | "COMPLETE";

/** What blocks a (next) report for this session, in the order the host has to fix it. */
export function reportBlocker(s: HostSession, opts: HostOptions = DEFAULT_HOST_OPTIONS): ReportBlocker | null {
  if (s.noReport) return "NO_REPORT";
  if (s.phase === "UPCOMING") return "NOT_STARTED";
  if (!s.clockedIn) return "CLOCKIN";
  if (opts.requireAbsen && !s.absence) return "ABSEN";
  if (s.reports.length && !s.partial) return "COMPLETE";
  if (!statusAllowsReport(s, opts)) return "STATUS";
  return null;
}

export const BLOCKER_TEXT: Record<ReportBlocker, string> = {
  CLOCKIN: "Belum ada clock in di hari sesi ini",
  ABSEN: "Absen sesi ini belum tercatat",
  NOT_STARTED: "Sesi belum dimulai",
  STATUS: "Status jadwal belum Waiting Report",
  NO_REPORT: "Sesi ini tidak perlu report",
  COMPLETE: "Durasi sesi sudah terpenuhi",
};

export const fmtMinutes = (m: number): string => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h && r ? `${h} jam ${r} menit` : h ? `${h} jam` : `${r} menit`;
};

// ---- Absen --------------------------------------------------------------------------------------

/**
 * ABSEN payload. `liveBreak` comes from the popup: a live break owes no report, but canvas still
 * creates a Report row with every metric 0 and ApprovalStatus LiveBreak so the list stays complete.
 * `scheduleStatus` is what canvas writes to Schedule.Status: Waiting Report when a report is owed,
 * Done for a live break or a Co-Host.
 */
export function absenPayload(s: HostSession, host: Row | undefined, liveBreak = false, opts: HostOptions = DEFAULT_HOST_OPTIONS): Record<string, unknown> {
  const coHost = noReportReason(s.row) === "CO_HOST";
  const hostId = str(host, "Title") || str(s.row, "HostID");
  const zeros = metricColumns(Object.fromEntries(ALL_METRICS.map((d) => [d.key, 0])));
  return {
    scheduleId: s.title,
    scheduleItemId: s.id,
    hostId,
    hostName: str(host, "NamaHost", "HostName"),
    liveDate: s.dayKey,
    brandId: s.brandId,
    studioId: s.studioId,
    platform: s.platform,
    account: s.accountId,
    accountName: s.account,
    position: str(s.row, "Position"),
    liveBreak,
    scheduleStatus: liveBreak || coHost ? opts.doneStatus : opts.waitingStatus,
    report: liveBreak
      ? {
          approvalStatus: "LiveBreak",
          metrics: zeros,
          liveId: "",
          playbook: "",
          durationMin: 0,
          fileName: "",
        }
      : null,
  };
}

// ---- Revision: which numbers the reviewer flagged -----------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The ops console writes "Metrik yang perlu dibetulkan: Penjualan, CTOR" into ApprovalComment (no
 * column holds the list). Labels or keys are both accepted.
 */
export function flaggedFromComment(comment: string): MetricDef[] {
  const m = /metrik yang perlu dibetulkan\s*:\s*([^\n]+)/i.exec(comment);
  if (!m?.[1]) return [];
  const names = m[1]
    .split(/[,;]/)
    .map((x) => norm(x))
    .filter(Boolean);
  return ALL_METRICS.filter((d) => names.includes(norm(d.label)) || names.includes(norm(d.key)) || d.fields.some((f) => names.includes(norm(f))));
}

/** The reviewer's note without the machine-written metric line. */
export function reviewerNote(comment: string): string {
  return comment
    .split("\n")
    .filter((l) => !/^\s*metrik yang perlu dibetulkan\s*:/i.test(l) && !/^\s*\[sanggahan host\]/i.test(l))
    .join("\n")
    .replace(/^\s*\[(eskalasi|tanpa bukti)\]\s*/i, "")
    .trim();
}

export function disputeOf(comment: string): string | null {
  const m = /\[sanggahan host\]\s*([^\n]*)/i.exec(comment);
  return m ? m[1]?.trim() || "" : null;
}

// ---- Submit form --------------------------------------------------------------------------------

export type MetricValues = Record<string, number | null>;

export function metricsFrom(row: Row | undefined): MetricValues {
  const out: MetricValues = {};
  for (const d of ALL_METRICS) out[d.key] = row ? readMetric(row, d) : null;
  return out;
}

/** "4.820.000", "4,8", "3,2%" → number. Empty → null. Indonesian separators first. */
export function parseMetricInput(text: string, def: MetricDef): number | null {
  const s = text.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  let v: number;
  // Percent: a comma is the decimal mark; without one, a single dot is too ("3.6" is 3,6%, not 36%).
  if (def.format === "pct") v = Number(s.includes(",") || (s.match(/\./g) ?? []).length > 1 ? s.replace(/\./g, "").replace(",", ".") : s);
  else v = Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export interface SanityWarning {
  key: string;
  text: string;
}

/** Warnings only — the host can still submit (brief 33). */
export function sanityWarnings(v: MetricValues, history: MetricValues[]): SanityWarning[] {
  const out: SanityWarning[] = [];
  const g = (k: string) => v[k] ?? null;
  for (const k of ["CTR", "CTOR"]) {
    const x = g(k);
    if (x !== null && (x < 0 || x > 100))
      out.push({
        key: k,
        text: `${k} ${x}% di luar 0–100%. Periksa lagi, mungkin salah ketik koma.`,
      });
  }
  const orders = g("Pesanan");
  const buyers = g("JumlahPembeli");
  const sold = g("ProdukTerjual");
  if (orders !== null && buyers !== null && buyers > orders)
    out.push({
      key: "JumlahPembeli",
      text: "Jumlah pembeli lebih besar dari pesanan — biasanya satu pembeli membuat minimal satu pesanan.",
    });
  if (orders !== null && sold !== null && sold < orders)
    out.push({
      key: "ProdukTerjual",
      text: "Produk terjual lebih kecil dari pesanan — setiap pesanan berisi minimal satu produk.",
    });
  const peak = g("PeakViewer");
  const total = g("TotalViewer");
  if (peak !== null && total !== null && total > 0 && peak > total)
    out.push({
      key: "PeakViewer",
      text: "Peak viewer lebih besar dari total viewer.",
    });
  const sales = g("Penjualan");
  if (sales !== null && sales > 0 && orders === 0) out.push({ key: "Pesanan", text: "Ada penjualan tapi pesanan 0." });
  // Far from the host's own average (last reports) — the design's "Rata-rata kamu 1,8% — cek lagi".
  for (const k of ["CTR", "CTOR", "Penjualan"]) {
    const x = g(k);
    const past = history.map((h) => h[k]).filter((n): n is number => n !== null && n !== undefined && n > 0);
    if (x === null || x <= 0 || past.length < 3) continue;
    const avg = past.reduce((a, b) => a + b, 0) / past.length;
    if (x > avg * 3)
      out.push({
        key: k,
        text: `${labelOf(k)} jauh di atas rata-rata kamu (${fmtAvg(avg, k)}). Peringatan ini tidak memblokir submit — periksa dulu screenshot-nya.`,
      });
  }
  return out;
}

const labelOf = (k: string) => ALL_METRICS.find((d) => d.key === k)?.label ?? k;
const fmtAvg = (n: number, k: string) => (k === "Penjualan" ? `Rp${Math.round(n).toLocaleString("id-ID")}` : `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

/** Filled metrics, missing required ones. Durasi … Share may stay empty. */
export function missingMetrics(v: MetricValues, required: MetricDef[]): MetricDef[] {
  return required.filter((d) => v[d.key] === null || v[d.key] === undefined);
}

/** The payload keys canvas patches: SharePoint column names, not display labels. */
export function metricColumns(v: MetricValues): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of ALL_METRICS) out[d.fields[0] ?? d.key] = v[d.key] ?? null;
  return out;
}

/**
 * v1 depended on the uploader naming the screenshot `ReportID_Platform_AccountID` (defect O1). The
 * host now only picks an image; this builds the name. For a new report the ID does not exist yet,
 * so canvas substitutes it after the Report row is created.
 */
export function evidenceFileName(reportTitle: string, platform: string, accountId: string, ext: string): string {
  const clean = (s: string) => s.trim().replace(/[\\/:*?"<>|#%\s]+/g, "-");
  return `${clean(reportTitle || "REP-{ID}")}_${clean(platform || "Platform")}_${clean(accountId || "Akun")}.${ext}`;
}

export function avg(rows: MetricValues[], key: string): number | null {
  const xs = rows.map((r) => r[key]).filter((n): n is number => typeof n === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export const hostName = (host: Row | undefined, ctxName: string): string => str(host, "NamaHost", "HostName") || ctxName;

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

export const scoreOf = (host: Row | undefined): number | null => num(host, "CurrentScore", "Score", "InitialScore");

// ---- Report form fields -------------------------------------------------------------------------

export const isShopee = (platform: string): boolean => /shopee/i.test(platform);

/** The order of the report form (Seller Center). AddToCart only exists on Shopee; Share is not asked. */
const FORM_ORDER = ["AddToCart", "Pesanan", "Penjualan", "ProdukTerjual", "JumlahPembeli", "CTR", "PeakViewer", "TotalViewer", "CTOR", "Comment"];

/** Metric inputs of the report form for this platform, Durasi excluded (it sits with Live ID). */
export function reportMetricDefs(platform: string): MetricDef[] {
  return FORM_ORDER.filter((k) => k !== "AddToCart" || isShopee(platform))
    .map((k) => ALL_METRICS.find((d) => d.key === k))
    .filter((d): d is MetricDef => !!d);
}

/** Every metric the host must fill: Durasi plus the platform's inputs. */
export function requiredReportDefs(platform: string): MetricDef[] {
  const durasi = ALL_METRICS.find((d) => d.key === "Durasi");
  return [...(durasi ? [durasi] : []), ...reportMetricDefs(platform)];
}

/** Report.LiveID (text). */
export const reportLiveId = (r: Row | undefined): string => str(r, "LiveID", "LiveId", "Live ID", "Live_x0020_ID");

let lastPlaybooks: { raw: string; list: string[] } = { raw: "", list: [] };
/** PlaybooksJson: Choices(...) rows, a JSON string array, or "a, b". Stable array per input. */
export function parsePlaybooks(raw: string | null | undefined): string[] {
  const s = raw ?? "";
  if (s === lastPlaybooks.raw) return lastPlaybooks.list;
  let v: unknown = s;
  try {
    v = JSON.parse(s);
  } catch {
    /* plain text list */
  }
  const list = choiceList(Array.isArray(v) ? v : v && typeof v === "object" ? (v as Record<string, unknown>).value : v);
  lastPlaybooks = { raw: s, list };
  return list;
}
