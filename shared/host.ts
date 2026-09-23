import { Row, bool, date, num, rowId, startOfDay, str } from "./data";
import { Period, RunModel, addMonths, clockInDay, hasBank, inPeriod, parsePeriod, periodKey, periodOf } from "./payroll";
import { ReviewState, Tone, reviewState } from "./reconcile";

/**
 * Host directory (HD-1, HD-2) and credit score (DESIGN.md → `Host - PBS Hub`,
 * `[FAS STUDIO] HostScoreTransactions`, `HostScoreThreshold`, `ScoreConfig`).
 *
 * Personal data never reaches these controls in the clear. Canvas sends masking hints
 * (`KtpLast4`, `NorekLast4`, `PhoneLast4`, `HasAlamat`, `HasPersonalEmail`, `HasNamaRekening`) and
 * the full value only after an explicit, logged `REVEAL_PII`. If a screen sends a raw column by
 * mistake, the control still masks it and tells the admin (`sensitiveKeys`).
 */

// ---- score bands ------------------------------------------------------------------------------

export interface ScoreBand {
  id: string;
  label: string;
  description: string;
  min: number | null;
  max: number | null;
  tone: Tone;
  sort: number;
}

/** HostScoreThreshold.Tone is a Choice whose values nobody listed; accept colour words in both languages. */
export function toneFromText(s: string): Tone {
  const t = s.trim().toLowerCase();
  if (/success|green|hijau|good|baik|excellent/.test(t)) return "success";
  if (/danger|red|merah|bad|buruk|critical|error/.test(t)) return "danger";
  if (/warn|yellow|kuning|amber|orange|caution/.test(t)) return "warning";
  if (/info|blue|biru|primary/.test(t)) return "info";
  return "neutral";
}

export function parseBands(rows: Row[]): ScoreBand[] {
  return rows
    .filter((r) => bool(r, "Active") !== false)
    .map((r, i) => ({
      id: str(r, "ThresholdID", "Title") || String(i),
      label: str(r, "Label", "Name", "Title") || str(r, "ThresholdID"),
      description: str(r, "Description"),
      min: num(r, "MinimumScore", "MinScore"),
      max: num(r, "MaximumScore", "MaxScore"),
      tone: toneFromText(str(r, "Tone")),
      sort: num(r, "SortOrder") ?? i,
    }))
    .sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity) || a.sort - b.sort);
}

/** First band whose bounds hold the score. Nothing validates that bands do not overlap or leave gaps. */
export function bandOf(score: number | null, bands: ScoreBand[]): ScoreBand | null {
  if (score === null) return null;
  return bands.find((b) => (b.min === null || score >= b.min) && (b.max === null || score <= b.max)) ?? null;
}

export interface ScoreDefaults {
  initial: number | null;
  min: number | null;
  max: number | null;
}

const cfgNum = (config: Record<string, unknown>, key: string): number | null => {
  const v = config[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** `[FAS STUDIO] ScoreConfig` (read as First() in v1), handed in through Context.config. */
export function scoreDefaults(config: Record<string, unknown>): ScoreDefaults {
  return { initial: cfgNum(config, "scoreInitial"), min: cfgNum(config, "scoreMin"), max: cfgNum(config, "scoreMax") };
}

export function clamp(v: number, min: number | null, max: number | null): number {
  let x = v;
  if (min !== null && x < min) x = min;
  if (max !== null && x > max) x = max;
  return x;
}

// ---- host -------------------------------------------------------------------------------------

export type HostStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";

export const HOST_STATUS: Record<HostStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Aktif", tone: "success" },
  INACTIVE: { label: "Nonaktif", tone: "neutral" },
  UNKNOWN: { label: "Tanpa status", tone: "warning" },
};

export function hostStatus(row: Row): HostStatus {
  const s = str(row, "Status").toLowerCase();
  if (/^(active|aktif)$/.test(s)) return "ACTIVE";
  if (/inactive|nonaktif|non-aktif|tidak aktif|resign|keluar/.test(s)) return "INACTIVE";
  return "UNKNOWN";
}

/** Raw sensitive columns. Their presence in a row means the screen serialised too much. */
export const SENSITIVE_KEYS = ["KTP", "NIK", "NoRekening", "Norek", "NamaRekening", "Alamat", "PhoneNumber", "PersonalEmail", "Employee_ID"];

export function sensitiveKeysIn(row: Row): string[] {
  const lower = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));
  return Object.keys(row).filter((k) => lower.has(k.toLowerCase()) && str(row, k) !== "");
}

export interface HostModel {
  row: Row;
  id: string;
  hostId: string;
  code: string;
  name: string;
  pkg: string;
  status: HostStatus;
  statusText: string;
  email: string;
  joined: Date | null;
  registered: Date | null;
  registeredBy: string;
  hasBank: boolean | null;
  bank: string;
  /** CurrentScore, else the initial score. */
  score: number | null;
  storedScore: number | null;
  initial: number | null;
  min: number | null;
  max: number | null;
  band: ScoreBand | null;
  /** Optional ledger sum computed by canvas for the list (SL-1 defensive warning). */
  ledgerScore: number | null;
  drift: boolean;
  deactivatedAt: Date | null;
  sensitiveKeys: string[];
  modified: string;
}

export function buildHost(row: Row, bands: ScoreBand[], defaults: ScoreDefaults): HostModel {
  const hostId = str(row, "Title", "HostID");
  const storedScore = num(row, "CurrentScore");
  const initial = num(row, "InitialScore") ?? defaults.initial;
  const score = storedScore ?? initial;
  const ledgerScore = num(row, "LedgerScore");
  const status = hostStatus(row);
  const emailPerson = row.Email;
  const email =
    emailPerson && typeof emailPerson === "object" && !Array.isArray(emailPerson) && typeof (emailPerson as Row).Email === "string"
      ? String((emailPerson as Row).Email)
      : str(row, "Email", "WorkEmail");
  return {
    row,
    id: rowId(row),
    hostId,
    code: str(row, "HostCode") || hostId,
    name: str(row, "NamaHost", "HostName") || str(row, "HostCode") || hostId,
    pkg: str(row, "Package", "Paket"),
    status,
    statusText: str(row, "Status"),
    email,
    joined: date(row, "JoinDate", "RegistrationDate", "Created"),
    registered: date(row, "RegistrationDate"),
    registeredBy: str(row, "RegisteredBy"),
    hasBank: hasBank(row) ?? (("NoRekening" in row || "Norek" in row) ? str(row, "NoRekening", "Norek") !== "" && str(row, "Bank") !== "" : null),
    bank: str(row, "Bank"),
    score,
    storedScore,
    initial,
    min: num(row, "MinimumScore") ?? defaults.min,
    max: num(row, "MaximumScore") ?? defaults.max,
    band: bandOf(score, bands),
    ledgerScore,
    drift: storedScore !== null && ledgerScore !== null && Math.abs(storedScore - ledgerScore) >= 0.5,
    deactivatedAt: date(row, "DeactivatedDate", "InactiveDate", "StatusChangedDate"),
    sensitiveKeys: sensitiveKeysIn(row),
    modified: str(row, "Modified"),
  };
}

export function buildHosts(rows: Row[], bands: ScoreBand[], defaults: ScoreDefaults): HostModel[] {
  return rows.map((r) => buildHost(r, bands, defaults)).filter((h) => h.hostId !== "");
}

// ---- score ledger -----------------------------------------------------------------------------

export type TxType = "REWARD" | "PENALTY" | "OTHER";

export interface ScoreTx {
  row: Row;
  id: string;
  txId: string;
  when: Date | null;
  ruleId: string;
  rule: string;
  type: TxType;
  point: number | null;
  before: number | null;
  after: number | null;
  notes: string;
  by: string;
  active: boolean;
  statusText: string;
}

function txType(row: Row, point: number | null): TxType {
  const t = str(row, "TransactionType", "RuleType").toLowerCase();
  if (/reward|bonus|tambah|plus|positif/.test(t)) return "REWARD";
  if (/penalt|potong|kurang|minus|negatif/.test(t)) return "PENALTY";
  if (point !== null) return point >= 0 ? "REWARD" : "PENALTY";
  return "OTHER";
}

export function buildLedger(rows: Row[]): ScoreTx[] {
  return rows
    .map((r) => {
      const point = num(r, "Point", "Points");
      const statusText = str(r, "Status");
      const by = r.CreatedBy ?? r.Author;
      const byName =
        by && typeof by === "object" && !Array.isArray(by) ? String((by as Row).DisplayName ?? (by as Row).Email ?? "") : str(r, "CreatedBy", "Author");
      return {
        row: r,
        id: rowId(r),
        txId: str(r, "TransactionID", "Title"),
        when: date(r, "CreatedDate", "Created"),
        ruleId: str(r, "RuleID"),
        rule: str(r, "Reason", "RuleName") || str(r, "RuleID") || "—",
        type: txType(r, point),
        point,
        before: num(r, "ScoreBefore"),
        after: num(r, "ScoreAfter"),
        notes: str(r, "Notes", "Catatan"),
        by: byName,
        // Only Active rows count (DESIGN.md). A blank Status is the v1 default, so it counts.
        active: statusText === "" || /^(active|aktif)$/i.test(statusText),
        statusText,
      };
    })
    .sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));
}

export interface LedgerCheck {
  /** clamp(Initial + Σ Active points) — what v1 would compute for the next transaction. */
  expected: number | null;
  sum: number;
  activeCount: number;
  voidedCount: number;
  /** Stored CurrentScore minus the ledger reading. */
  diff: number | null;
  drift: boolean;
}

export function checkLedger(host: HostModel, txs: ScoreTx[]): LedgerCheck {
  const active = txs.filter((t) => t.active);
  const sum = active.reduce((s, t) => s + (t.point ?? 0), 0);
  const expected = host.initial === null ? null : clamp(host.initial + sum, host.min, host.max);
  const diff = expected !== null && host.storedScore !== null ? host.storedScore - expected : null;
  return { expected, sum, activeCount: active.length, voidedCount: txs.length - active.length, diff, drift: diff !== null && Math.abs(diff) >= 0.5 };
}

// ---- sessions, reports, payroll for one host ---------------------------------------------------

export type SessionStatus = "PLANNED" | "DONE" | "WAITING_REPORT" | "CANCELLED" | "OTHER";

export const SESSION_STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  PLANNED: { label: "Terjadwal", tone: "info" },
  DONE: { label: "Selesai", tone: "success" },
  WAITING_REPORT: { label: "Menunggu report", tone: "warning" },
  CANCELLED: { label: "Dibatalkan", tone: "neutral" },
  OTHER: { label: "Lainnya", tone: "neutral" },
};

export function sessionStatus(row: Row): SessionStatus {
  const s = str(row, "Status").toLowerCase();
  if (s === "" || /plan|terjadwal|scheduled/.test(s)) return "PLANNED";
  if (/cancel|batal/.test(s)) return "CANCELLED";
  if (/waiting|menunggu/.test(s)) return "WAITING_REPORT";
  if (/done|selesai|complete/.test(s)) return "DONE";
  return "OTHER";
}

export interface HostSession {
  row: Row;
  id: string;
  title: string;
  day: Date | null;
  start: string;
  end: string;
  brandId: string;
  brand: string;
  studio: string;
  platform: string;
  status: SessionStatus;
  upcoming: boolean;
  clockIn: Date | null;
}

export function buildSessions(schedules: Row[], clockIns: Row[], brands: Map<string, string>, studios: Map<string, string>, now: Date): HostSession[] {
  const today = startOfDay(now).getTime();
  const firstIn = new Map<string, Date>();
  for (const c of clockIns) {
    const d = clockInDay(c);
    const t = date(c, "CheckInTime") ?? d;
    if (!d || !t) continue;
    const k = startOfDay(d).toDateString();
    const prev = firstIn.get(k);
    if (!prev || t < prev) firstIn.set(k, t);
  }
  return schedules
    .map((s) => {
      const day = date(s, "Date", "Tanggal");
      const brandId = str(s, "BrandID");
      const studioId = str(s, "StudioID");
      const status = sessionStatus(s);
      return {
        row: s,
        id: rowId(s),
        title: str(s, "Title"),
        day,
        start: str(s, "StartTime", "JamMulai"),
        end: str(s, "EndTime", "JamSelesai"),
        brandId,
        brand: brands.get(brandId) ?? (str(s, "BrandName", "NamaBrand") || brandId || "—"),
        studio: studios.get(studioId) ?? (str(s, "StudioName", "NamaStudio") || studioId || "—"),
        platform: str(s, "Platform"),
        status,
        upcoming: !!day && day.getTime() >= today && status !== "CANCELLED" && status !== "DONE",
        clockIn: day ? firstIn.get(startOfDay(day).toDateString()) ?? null : null,
      };
    })
    .sort((a, b) => (a.day?.getTime() ?? 0) - (b.day?.getTime() ?? 0) || a.start.localeCompare(b.start));
}

export interface HostReport {
  row: Row;
  id: string;
  title: string;
  liveDate: Date | null;
  brand: string;
  platform: string;
  sales: number | null;
  state: ReviewState;
  modified: string;
}

export function buildHostReports(reports: Row[], brands: Map<string, string>): HostReport[] {
  return reports
    .map((r) => {
      const brandId = str(r, "BrandID");
      return {
        row: r,
        id: rowId(r),
        title: str(r, "Title"),
        liveDate: date(r, "LiveDate"),
        brand: brands.get(brandId) ?? (str(r, "BrandName", "NamaBrand") || brandId || "—"),
        platform: str(r, "Platform"),
        sales: num(r, "Penjualan"),
        state: reviewState(r),
        modified: str(r, "Modified"),
      };
    })
    .sort((a, b) => (b.liveDate?.getTime() ?? 0) - (a.liveDate?.getTime() ?? 0));
}

export interface HostPayLine {
  id: string;
  runTitle: string;
  run: RunModel | null;
  /** The run's data period (label − 1, P8); the line's own Periode when the run is unknown. */
  period: Period | null;
  hk: number | null;
  bruto: number | null;
  pph21: number | null;
  net: number | null;
  bank: string;
  norekLast4: string;
  hasBank: boolean | null;
}

export function buildHostPayLines(lines: Row[], runs: RunModel[]): HostPayLine[] {
  const byTitle = new Map(runs.map((r) => [r.title, r]));
  return lines
    .map((l) => {
      const runTitle = str(l, "payroll_id", "PayrollID", "PayrollTitle");
      const run = byTitle.get(runTitle) ?? null;
      const bank = str(l, "Bank");
      const norekLast4 = str(l, "NorekLast4");
      const flag = bool(l, "HasRekening");
      return {
        id: str(l, "Title", "payroll_item_id") || rowId(l),
        runTitle,
        run,
        period: run?.dataPeriod ?? parsePeriod(str(l, "Periode")),
        hk: num(l, "JumlahHari", "HK"),
        bruto: num(l, "TotalGaji", "Bruto"),
        pph21: num(l, "PPh21"),
        net: num(l, "NetTHP"),
        bank,
        norekLast4,
        hasBank: flag !== null ? flag : "Bank" in l || "NorekLast4" in l ? bank !== "" && norekLast4 !== "" : null,
      };
    })
    .sort((a, b) => (b.period ? b.period.year * 12 + b.period.month : 0) - (a.period ? a.period.year * 12 + a.period.month : 0) || b.runTitle.localeCompare(a.runTitle));
}

// ---- deactivation impact ----------------------------------------------------------------------

export interface AffectedPeriod {
  period: Period;
  key: string;
  clockIns: number;
  /** HKTugas + Insentif + Streak over those rows. */
  value: number;
  upcoming: number;
  /** Runs (not rejected) whose data period is this one and that carry a line for this host. */
  paidIn: string[];
  /** A run for this period exists but has no line for the host. */
  runWithoutLine: string[];
}

export interface DeactivationImpact {
  since: Date | null;
  periods: AffectedPeriod[];
  upcoming: HostSession[];
}

/**
 * What a deactivation mid-period leaves behind. v1 payroll reads **all** hosts without filtering
 * on Status (DESIGN.md), so attendance after the switch is still paid and future sessions still
 * point at the host. Without a deactivation date, the current and previous month are the ones at
 * stake (the previous month is the next payroll run).
 */
export function deactivationImpact(host: HostModel, sessions: HostSession[], clockIns: Row[], payLines: HostPayLine[], runs: RunModel[], now: Date): DeactivationImpact {
  const since = host.deactivatedAt;
  const current = periodOf(now);
  const windowStart = since ? startOfDay(since) : new Date(addMonths(current, -1).year, addMonths(current, -1).month, 1);
  const map = new Map<string, AffectedPeriod>();
  const slot = (p: Period): AffectedPeriod => {
    const k = periodKey(p);
    let a = map.get(k);
    if (!a) {
      a = { period: p, key: k, clockIns: 0, value: 0, upcoming: 0, paidIn: [], runWithoutLine: [] };
      map.set(k, a);
    }
    return a;
  };
  for (const c of clockIns) {
    const d = clockInDay(c);
    if (!d || d < windowStart) continue;
    const a = slot(periodOf(d));
    a.clockIns++;
    a.value += (num(c, "HKTugas") ?? 0) + (num(c, "Insentif") ?? 0) + (num(c, "Streak") ?? 0);
  }
  // Sessions not yet run that still point at the host (a Done one is covered by its Clock In).
  const upcoming = sessions.filter((s) => s.upcoming || (!!since && !!s.day && s.day >= windowStart && s.status !== "CANCELLED" && s.status !== "DONE"));
  for (const s of upcoming) if (s.day) slot(periodOf(s.day)).upcoming++;
  for (const a of map.values()) {
    const periodRuns = runs.filter((r) => r.phase !== "REJECTED" && r.dataPeriod && r.dataPeriod.year === a.period.year && r.dataPeriod.month === a.period.month);
    for (const r of periodRuns) {
      if (payLines.some((l) => l.runTitle === r.title)) a.paidIn.push(r.title);
      else a.runWithoutLine.push(r.title);
    }
  }
  const periods = [...map.values()].filter((a) => a.clockIns > 0 || a.upcoming > 0).sort((a, b) => a.key.localeCompare(b.key));
  return { since, periods, upcoming };
}

// ---- this month at a glance -------------------------------------------------------------------

export interface HostActivity {
  sessionsPlanned: number;
  sessionsDone: number;
  clockIns: number;
  clockInValue: number;
  reportsWaiting: number;
  reportsRevision: number;
}

export function hostActivity(sessions: HostSession[], clockIns: Row[], reports: HostReport[], now: Date): HostActivity {
  const p = periodOf(now);
  const monthSessions = sessions.filter((s) => inPeriod(s.day, p) && s.status !== "CANCELLED");
  const monthIns = clockIns.filter((c) => inPeriod(clockInDay(c), p));
  return {
    sessionsPlanned: monthSessions.length,
    sessionsDone: monthSessions.filter((s) => s.status === "DONE").length,
    clockIns: monthIns.length,
    clockInValue: monthIns.reduce((s, c) => s + (num(c, "HKTugas") ?? 0) + (num(c, "Insentif") ?? 0) + (num(c, "Streak") ?? 0), 0),
    reportsWaiting: reports.filter((r) => r.state === "WAITING").length,
    reportsRevision: reports.filter((r) => r.state === "REVISION").length,
  };
}

// ---- personal data ----------------------------------------------------------------------------

export type PiiField = "KTP" | "NoRekening" | "NamaRekening" | "Alamat" | "PhoneNumber" | "PersonalEmail";

export const PII_ORDER: PiiField[] = ["KTP", "NoRekening", "NamaRekening", "Alamat", "PhoneNumber", "PersonalEmail"];

export const PII_LABEL: Record<PiiField, string> = {
  KTP: "KTP",
  NoRekening: "No rekening",
  NamaRekening: "Nama rekening",
  Alamat: "Alamat",
  PhoneNumber: "Telepon",
  PersonalEmail: "Email pribadi",
};

const digits = (s: string) => s.replace(/\D/g, "");

function tail(row: Row, hint: string, raw: string): string {
  const h = digits(str(row, hint));
  if (h) return h.slice(-4);
  return digits(str(row, raw)).slice(-4);
}

function present(row: Row, hint: string, raw: string): boolean | null {
  const h = bool(row, hint);
  if (h !== null) return h;
  if (raw in row) return str(row, raw) !== "";
  return null;
}

/** Masked display text; `null` = not filled in, `undefined` = canvas sent no hint for it. */
export function maskedPii(row: Row, field: PiiField): string | null | undefined {
  switch (field) {
    case "KTP": {
      const t = tail(row, "KtpLast4", "KTP");
      if (t) return `••••••••${t}`;
      const p = present(row, "HasKTP", "KTP");
      return p === null ? undefined : p ? "••••••••••••" : null;
    }
    case "NoRekening": {
      const t = tail(row, "NorekLast4", "NoRekening");
      const bank = str(row, "Bank");
      if (t) return `${bank ? bank + " " : ""}••••${t}`;
      const p = bool(row, "HasRekening");
      return p === null ? undefined : p ? `${bank ? bank + " " : ""}••••••` : null;
    }
    case "PhoneNumber": {
      const t = tail(row, "PhoneLast4", "PhoneNumber");
      if (t) return `••••••${t}`;
      const p = present(row, "HasPhone", "PhoneNumber");
      return p === null ? undefined : p ? "••••••••" : null;
    }
    case "NamaRekening":
    case "Alamat":
    case "PersonalEmail": {
      const p = present(row, `Has${field}`, field);
      return p === null ? undefined : p ? "••••••" : null;
    }
  }
}

/** RevealedJson: `{hostId, field, value}` rows set by canvas after it logged the access. */
export function revealedFor(rows: Row[], hostId: string): Map<PiiField, string> {
  const m = new Map<PiiField, string>();
  for (const r of rows) {
    const h = str(r, "hostId", "HostID");
    const f = str(r, "field", "Field") as PiiField;
    if (h && h !== hostId) continue;
    if (!PII_ORDER.includes(f)) continue;
    m.set(f, str(r, "value", "Value"));
  }
  return m;
}
