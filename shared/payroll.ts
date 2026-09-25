import { Row, bool, date, dateTime, num, parseClock, rowId, str } from "./data";
import { monthName } from "./format";
import { reviewState, Tone } from "./reconcile";

/**
 * Payroll model for the v1 lists (DESIGN.md → Database Schema):
 *
 *   Payroll - PBS Hub     Title (PAY-<ID>), PayrollName, Periode, Status, Trigger, TotalPayroll, TotalHost,
 *                         PBSApproval/HCApproval/FASApproval/FinanceApproval + …Comment, Created, Modified
 *   Payroll Data          Title, payroll_id (= Payroll.Title), Employee_Name, Employee_Email, Periode,
 *                         JumlahHari, UangKehadiran, Mingguan, Tier1/2/3, PPh21, TotalGaji, NetTHP, Bank, Norek
 *   Clock In - PBS Hub    HostID, ClockInDate, CheckInTime, CheckOutTime, HKTugas, Insentif, Tier, Streak
 *
 * v1 facts the model has to live with (DESIGN.md UC-6, P1–P13):
 *   - `Payroll.Periode` is the RUN month (utcNow) while the data is the PREVIOUS month (P8), so the data
 *     period is the label month + `labelOffset` (default −1).
 *   - `TotalPayroll` / `TotalHost` are never written (P9): totals come from `Payroll Data`.
 *   - `Payroll Data.Periode` is a hard-coded literal (P2): compared against the run, never trusted.
 *   - `Status` is one Choice column that the gates overwrite in turn, and the two parallel gates
 *     (Head of PBS ∥ FAS) race on it; the …Approval text columns fill in what the status loses.
 *   - Nothing records payslip delivery in v1: the payslip view only works when canvas sends a log.
 */

// ---- periods --------------------------------------------------------------------------------------

export interface Period {
  year: number;
  /** 0–11 */
  month: number;
}

const MONTH_ALIASES: Record<string, number> = {};
[
  ["jan", "januari", "january"],
  ["feb", "februari", "february", "pebruari"],
  ["mar", "maret", "march"],
  ["apr", "april"],
  ["mei", "may"],
  ["jun", "juni", "june"],
  ["jul", "juli", "july"],
  ["agu", "agt", "ags", "agustus", "aug", "august"],
  ["sep", "sept", "september"],
  ["okt", "oktober", "oct", "october"],
  ["nov", "nopember", "november"],
  ["des", "desember", "dec", "december"],
].forEach((names, i) => names.forEach((n) => (MONTH_ALIASES[n] = i)));

/** "Sep 2026", "September 2026", "Agustus 2026", "August-2026", "2026-08", "08/2026" → Period. */
export function parsePeriod(text: string): Period | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/(\d{4})[-/.](\d{1,2})(?!\d)/);
  if (m) {
    const month = Number(m[2]) - 1;
    if (month >= 0 && month < 12) return { year: Number(m[1]), month };
  }
  // No lookbehind: older iOS WebViews in the Power Apps player cannot parse it.
  m = s.match(/(^|\D)(\d{1,2})[-/.](\d{4})/);
  if (m) {
    const month = Number(m[2]) - 1;
    if (month >= 0 && month < 12) return { year: Number(m[3]), month };
  }
  const year = s.match(/(^|\D)(\d{4})(?!\d)/);
  if (!year) return null;
  for (const word of s.split(/[^a-z]+/)) {
    const month = MONTH_ALIASES[word];
    if (word && month !== undefined) return { year: Number(year[2]), month };
  }
  return null;
}

export const periodKey = (p: Period): string => `${p.year}-${String(p.month + 1).padStart(2, "0")}`;
export const fmtPeriod = (p: Period | null): string => (p ? `${monthName(p.month)} ${p.year}` : "—");
export const samePeriod = (a: Period | null, b: Period | null): boolean => !!a && !!b && a.year === b.year && a.month === b.month;

export function addMonths(p: Period, n: number): Period {
  const t = p.year * 12 + p.month + n;
  return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 };
}

export const periodOf = (d: Date): Period => ({ year: d.getFullYear(), month: d.getMonth() });

export function inPeriod(d: Date | null, p: Period): boolean {
  return !!d && d.getFullYear() === p.year && d.getMonth() === p.month;
}

// ---- approval gates -------------------------------------------------------------------------------

export type GateKey = "PBS_INTERNAL" | "HC" | "HEAD_PBS" | "FAS" | "FINANCE";
export type GateState = "done" | "active" | "pending" | "rejected" | "skipped";

export interface Gate {
  key: GateKey;
  label: string;
  state: GateState;
  approver: string;
  comment: string;
  /** Only the gate that produced the current Status has a time (Modified); v1 stores no other. */
  at: Date | null;
}

export const GATE_LABEL: Record<GateKey, string> = {
  PBS_INTERNAL: "PBS internal",
  HC: "HC",
  HEAD_PBS: "Head of PBS",
  FAS: "FAS",
  FINANCE: "Finance",
};

const GATE_ORDER: GateKey[] = ["PBS_INTERNAL", "HC", "HEAD_PBS", "FAS", "FINANCE"];

/** "Approved by Asih" → {decision: "done", who: "Asih"}. */
function readDecision(text: string): { decision: "done" | "rejected" | null; who: string } {
  const t = text.trim();
  if (!t) return { decision: null, who: "" };
  const m = t.match(/^(approved|rejected|disetujui|ditolak)(?:\s+(?:by|oleh))?\s*[:-]?\s*(.*)$/i);
  if (m) {
    const verb = (m[1] ?? "").toLowerCase();
    return { decision: verb.startsWith("approv") || verb === "disetujui" ? "done" : "rejected", who: (m[2] ?? "").trim() };
  }
  if (/reject|tolak/i.test(t)) return { decision: "rejected", who: "" };
  if (/approv|setuju/i.test(t)) return { decision: "done", who: "" };
  return { decision: null, who: t };
}

/** Which gate a status suffix names: "HC" / "PBS" / "FAS" / "Finance", else a person (gate 1). */
function gateOfWho(who: string): GateKey | null {
  const w = who.trim().toLowerCase();
  if (/^hc\b/.test(w)) return "HC";
  if (/^(pbs|head of pbs)\b/.test(w)) return "HEAD_PBS";
  if (/^fas\b/.test(w)) return "FAS";
  if (/^finance\b/.test(w)) return "FINANCE";
  return null;
}

export interface GateReading {
  gates: Gate[];
  rejectedAt: GateKey | null;
  done: boolean;
  /** Status text the reader could not place; the run is shown with the raw text. */
  unknown: boolean;
}

export function readGates(run: Row): GateReading {
  const status = str(run, "Status");
  const s = status.toLowerCase();
  const modified = date(run, "Modified");
  const g: Record<GateKey, Gate> = {} as Record<GateKey, Gate>;
  for (const k of GATE_ORDER) g[k] = { key: k, label: GATE_LABEL[k], state: "pending", approver: "", comment: "", at: null };

  const pass = (...keys: GateKey[]) => keys.forEach((k) => (g[k].state = "done"));
  let unknown = false;
  let current: GateKey | null = null;

  if (s === "" || s.startsWith("waiting pbs") || s.startsWith("waiting")) {
    g.PBS_INTERNAL.state = "active";
  } else if (s === "done" || s.startsWith("selesai")) {
    pass(...GATE_ORDER);
    current = "FINANCE";
  } else {
    const { decision, who } = readDecision(status);
    const gate = gateOfWho(who);
    if (decision === "rejected") {
      if (gate === "HC") {
        pass("PBS_INTERNAL");
        g.HC.state = "rejected";
      } else if (gate === "HEAD_PBS" || gate === "FAS") {
        pass("PBS_INTERNAL", "HC");
        g[gate].state = "rejected";
      } else if (gate === "FINANCE") {
        pass("PBS_INTERNAL", "HC", "HEAD_PBS", "FAS");
        g.FINANCE.state = "rejected";
      } else {
        g.PBS_INTERNAL.state = "rejected";
        g.PBS_INTERNAL.approver = who;
      }
      current = gate ?? "PBS_INTERNAL";
    } else if (decision === "done") {
      if (gate === "HC") {
        pass("PBS_INTERNAL", "HC");
      } else if (gate === "HEAD_PBS") {
        pass("PBS_INTERNAL", "HC", "HEAD_PBS");
      } else if (gate === "FAS") {
        pass("PBS_INTERNAL", "HC", "FAS");
      } else if (gate === "FINANCE") {
        pass("PBS_INTERNAL", "HC", "HEAD_PBS", "FAS", "FINANCE");
      } else {
        // Gate 1 and (P7) the HC gate both write "Approved by <person>": the HC column tells them apart.
        pass("PBS_INTERNAL");
        g.PBS_INTERNAL.approver = who;
      }
      current = gate ?? "PBS_INTERNAL";
    } else {
      unknown = true;
      g.PBS_INTERNAL.state = "active";
    }
  }

  // The audit columns carry what the single Status column overwrote.
  const columns: [GateKey, string, string][] = [
    ["HC", "HCApproval", "HCComment"],
    ["HEAD_PBS", "PBSApproval", "PBSComment"],
    ["FAS", "FASApproval", "FASComment"],
    ["FINANCE", "FinanceApproval", "FinanceComment"],
  ];
  for (const [k, col, comment] of columns) {
    const { decision, who } = readDecision(str(run, col));
    if (who) g[k].approver = who;
    g[k].comment = str(run, comment);
    if (decision && (g[k].state === "pending" || g[k].state === "active")) {
      g[k].state = decision;
      // A later gate cannot have decided unless the earlier ones passed.
      const idx = GATE_ORDER.indexOf(k);
      for (const prev of GATE_ORDER.slice(0, Math.min(idx, 2))) if (g[prev].state !== "rejected") g[prev].state = "done";
    }
  }

  const rejectedAt = GATE_ORDER.find((k) => g[k].state === "rejected") ?? null;
  if (rejectedAt) {
    // The flow terminates on a rejection: everything still open is cancelled.
    for (const k of GATE_ORDER) if (g[k].state === "pending" || g[k].state === "active") g[k].state = "skipped";
  } else {
    // Activate the next open gate(s). Head of PBS and FAS run in parallel after HC.
    if (g.PBS_INTERNAL.state === "done" && g.HC.state === "pending") g.HC.state = "active";
    if (g.HC.state === "done") {
      if (g.HEAD_PBS.state === "pending") g.HEAD_PBS.state = "active";
      if (g.FAS.state === "pending") g.FAS.state = "active";
    }
    if (g.HEAD_PBS.state === "done" && g.FAS.state === "done" && g.FINANCE.state === "pending") g.FINANCE.state = "active";
  }
  if (current && (g[current].state === "done" || g[current].state === "rejected")) g[current].at = modified;

  const done = GATE_ORDER.every((k) => g[k].state === "done");
  return { gates: GATE_ORDER.map((k) => g[k]), rejectedAt, done, unknown };
}

// ---- runs -----------------------------------------------------------------------------------------

export type RunPhase = "ASSEMBLING" | "WAITING" | "DONE" | "REJECTED";

export interface SlipSummary {
  total: number;
  generated: number;
  sent: number;
  failed: number;
  bounced: number;
}

export interface RunModel {
  id: string;
  title: string;
  name: string;
  /** Periode as written (the run month in v1). */
  label: string;
  labelPeriod: Period | null;
  /** The month the attendance data covers. */
  dataPeriod: Period | null;
  status: string;
  phase: RunPhase;
  statusText: string;
  tone: Tone;
  gates: Gate[];
  rejectedAt: GateKey | null;
  created: Date | null;
  modified: Date | null;
  manual: boolean;
  /** Sum of Payroll Data.TotalGaji for this run (null when no line exists). */
  lineTotal: number | null;
  lineCount: number;
  /** Payroll.TotalPayroll / TotalHost, never written by the v1 flow (P9). */
  fieldTotal: number | null;
  fieldHosts: number | null;
  slips: SlipSummary | null;
}

export interface RunOptions {
  now: Date;
  /** Months between the Periode label and the data period. v1: −1 (P8). */
  labelOffset: number;
  /** A run younger than this with gate 1 still open is shown as "Sedang disusun". */
  assemblyMinutes: number;
}

export const DEFAULT_RUN_OPTIONS = (now: Date): RunOptions => ({ now, labelOffset: -1, assemblyMinutes: 30 });

export type SlipState = "GENERATED" | "SENT" | "FAILED" | "BOUNCED" | "UNKNOWN";

export function slipState(row: Row): SlipState {
  const s = str(row, "Status").toLowerCase();
  if (/bounce/.test(s)) return "BOUNCED";
  if (/gagal|fail|error/.test(s)) return "FAILED";
  if (/terkirim|sent|deliver|kirim/.test(s)) return "SENT";
  if (/dibuat|generat|created|pdf/.test(s)) return "GENERATED";
  return "UNKNOWN";
}

export const SLIP_LABEL: Record<SlipState, { label: string; tone: Tone }> = {
  GENERATED: { label: "Dibuat", tone: "neutral" },
  SENT: { label: "Terkirim", tone: "success" },
  FAILED: { label: "Gagal", tone: "danger" },
  BOUNCED: { label: "Bounce", tone: "warning" },
  UNKNOWN: { label: "—", tone: "neutral" },
};

const runKey = (row: Row): string => str(row, "payroll_id", "PayrollID", "PayrollTitle");

function summariseSlips(rows: Row[], lineCount: number): SlipSummary | null {
  if (rows.length === 0) return null;
  const s: SlipSummary = { total: Math.max(lineCount, rows.length), generated: 0, sent: 0, failed: 0, bounced: 0 };
  for (const r of rows) {
    const st = slipState(r);
    if (st === "SENT") s.sent++;
    else if (st === "FAILED") s.failed++;
    else if (st === "BOUNCED") s.bounced++;
    else s.generated++;
  }
  return s;
}

function groupBy(rows: Row[], key: (r: Row) => string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function lineGross(line: Row): number | null {
  return num(line, "TotalGaji", "Bruto", "NetTHP");
}

export function buildRun(run: Row, lines: Row[], slips: Row[], opts: RunOptions): RunModel {
  const title = str(run, "Title");
  const label = str(run, "Periode") || str(run, "PayrollName");
  const labelPeriod = parsePeriod(label);
  const reading = readGates(run);
  const created = date(run, "Created");
  const status = str(run, "Status");

  let phase: RunPhase;
  if (reading.rejectedAt) phase = "REJECTED";
  else if (reading.done) phase = "DONE";
  else if (reading.gates[0]?.state === "active" && created && opts.now.getTime() - created.getTime() < opts.assemblyMinutes * 60000) phase = "ASSEMBLING";
  else phase = "WAITING";

  const active = reading.gates.filter((g) => g.state === "active").map((g) => g.label);
  const statusText =
    phase === "REJECTED"
      ? `Ditolak di ${GATE_LABEL[reading.rejectedAt as GateKey]}`
      : phase === "DONE"
        ? "Selesai"
        : phase === "ASSEMBLING"
          ? "Sedang disusun"
          : reading.unknown
            ? status
            : `Menunggu ${active.join(" & ") || "approval"}`;
  const tone: Tone = phase === "REJECTED" ? "danger" : phase === "DONE" ? "success" : phase === "ASSEMBLING" ? "info" : "warning";

  let lineTotal: number | null = null;
  for (const l of lines) {
    const v = lineGross(l);
    if (v !== null) lineTotal = (lineTotal ?? 0) + v;
  }

  return {
    id: rowId(run),
    title,
    name: str(run, "PayrollName"),
    label,
    labelPeriod,
    dataPeriod: labelPeriod ? addMonths(labelPeriod, opts.labelOffset) : null,
    status,
    phase,
    statusText,
    tone,
    gates: reading.gates,
    rejectedAt: reading.rejectedAt,
    created,
    modified: date(run, "Modified"),
    manual: /manual/i.test(str(run, "PayrollName")) || /manual/i.test(str(run, "Trigger")),
    lineTotal,
    lineCount: lines.length,
    fieldTotal: num(run, "TotalPayroll"),
    fieldHosts: num(run, "TotalHost"),
    slips: summariseSlips(slips, lines.length),
  };
}

export function buildRuns(runs: Row[], lines: Row[], slips: Row[], opts: RunOptions): RunModel[] {
  const byRunLines = groupBy(lines, runKey);
  const byRunSlips = groupBy(slips, runKey);
  return runs
    .map((r) => {
      const t = str(r, "Title");
      return buildRun(r, byRunLines.get(t) ?? [], byRunSlips.get(t) ?? [], opts);
    })
    .sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0) || Number(b.id) - Number(a.id));
}

export const isOpen = (r: RunModel): boolean => r.phase === "ASSEMBLING" || r.phase === "WAITING";

// ---- preflight ------------------------------------------------------------------------------------

export type CheckLevel = "pass" | "warn" | "block";

export interface PreflightCheck {
  code: string;
  level: CheckLevel;
  text: string;
  /** Where "lihat" goes: a NAV target for canvas, or a run to open. */
  link?: { target: string; label?: string; payrollId?: string; title?: string };
}

export interface Rates {
  manday: number | null;
  tier1: number | null;
  tier2: number | null;
  tier3: number | null;
  streak: number | null;
}

export interface PreflightResult {
  period: Period;
  checks: PreflightCheck[];
  blocked: boolean;
  warnings: string[];
  rates: Rates;
  /** What the flow would pay: HKTugas + Insentif + Streak over the active hosts' rows. */
  estimate: number;
  activeHosts: number;
  hostsWithAttendance: number;
}

export interface PreflightInput {
  period: Period;
  now: Date;
  runs: RunModel[];
  hosts: Row[];
  clockIns: Row[];
  reports: Row[];
  /** v1's flow always processes the month before the run date and takes no period input. */
  previousMonthOnly: boolean;
}

const isActiveHost = (h: Row): boolean => /^(active|aktif)$/i.test(str(h, "Status"));

function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN || (n === bestN && best !== null && v > best)) [best, bestN] = [v, n];
  return best;
}

export function tierOf(row: Row): 1 | 2 | 3 | null {
  const t = str(row, "Tier").match(/[123]/);
  return t ? (Number(t[0]) as 1 | 2 | 3) : null;
}

export const clockInDay = (c: Row): Date | null => date(c, "ClockInDate", "CheckInTime");

const onDay = (day: Date | null, clock: string): Date | null => {
  const m = parseClock(clock);
  if (!day || m === null) return null;
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setMinutes(m);
  return d;
};

/** Clock-in moment: CheckInTime (GPS), else ClockInTime (Date and Time, or a text clock on ClockInDate). */
export const clockInAt = (c: Row | undefined): Date | null =>
  !c ? null : dateTime(c, "CheckInTime", "ClockInTime") ?? date(c, "CheckInTime") ?? onDay(clockInDay(c), str(c, "ClockInTime", "JamMasuk"));

/** Clock-out moment, same fallbacks; a text clock earlier than clock-in is read as past midnight. */
export function clockOutAt(c: Row | undefined): Date | null {
  if (!c) return null;
  const out = dateTime(c, "CheckOutTime", "ClockOutTime") ?? date(c, "CheckOutTime") ?? onDay(date(c, "ClockOutDate") ?? clockInDay(c), str(c, "ClockOutTime", "JamKeluar"));
  const inAt = clockInAt(c);
  return out && inAt && out < inAt ? new Date(out.getTime() + 864e5) : out;
}

export function clockInValue(c: Row): number {
  return (num(c, "HKTugas") ?? 0) + (num(c, "Insentif") ?? 0) + (num(c, "Streak") ?? 0);
}

export function hasBank(host: Row): boolean | null {
  const flag = bool(host, "HasRekening");
  if (flag !== null) return flag;
  if ("NorekLast4" in host || "Bank" in host) return str(host, "NorekLast4") !== "" || str(host, "Bank") !== "";
  return null;
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const { period } = input;
  const checks: PreflightCheck[] = [];
  const hostName = new Map(input.hosts.map((h) => [str(h, "Title"), str(h, "NamaHost")]));
  const active = input.hosts.filter(isActiveHost);
  const activeIds = new Set(active.map((h) => str(h, "Title")).filter(Boolean));
  const rows = input.clockIns.filter((c) => inPeriod(clockInDay(c), period));
  const activeRows = rows.filter((c) => activeIds.has(str(c, "HostID")));
  const attended = new Set(activeRows.map((c) => str(c, "HostID")));
  const label = fmtPeriod(period);

  // Run state first: these block regardless of the data.
  const previous = addMonths(periodOf(input.now), -1);
  if (input.previousMonthOnly && !samePeriod(period, previous)) {
    checks.push({
      code: "FLOW_PERIOD",
      level: "block",
      text: `Flow payroll v1 selalu memproses bulan lalu (${fmtPeriod(previous)}) dan tidak menerima periode lain.`,
    });
  }
  const same = input.runs.filter((r) => samePeriod(r.dataPeriod, period));
  const dup = same.find((r) => r.phase !== "REJECTED");
  if (dup) {
    checks.push({
      code: "DUPLICATE",
      level: "block",
      text: `Periode ini sudah dijalankan: ${dup.title}, status ${dup.statusText}.`,
      link: { target: "OPEN_RUN", payrollId: dup.id, title: dup.title },
    });
  }
  const open = input.runs.find((r) => isOpen(r) && r !== dup);
  if (open) {
    checks.push({
      code: "OPEN_RUN",
      level: "block",
      text: `Masih ada run terbuka: ${open.title} (${open.statusText}). Selesaikan atau tolak dulu.`,
      link: { target: "OPEN_RUN", payrollId: open.id, title: open.title },
    });
  }
  const rejected = same.find((r) => r.phase === "REJECTED");
  if (rejected && !dup) {
    checks.push({
      code: "REJECTED_BEFORE",
      level: "warn",
      text: `Periode ini pernah dijalankan dan ${rejected.statusText.toLowerCase()} (${rejected.title}).`,
      link: { target: "OPEN_RUN", payrollId: rejected.id, title: rejected.title },
    });
  }

  // Hosts and attendance.
  checks.push(
    active.length > 0
      ? { code: "ACTIVE_HOSTS", level: "pass", text: `${active.length} host aktif` }
      : { code: "ACTIVE_HOSTS", level: "block", text: "Tidak ada host aktif di list Host." },
  );
  if (attended.size > 0) {
    checks.push({ code: "ATTENDANCE", level: "pass", text: `${attended.size} punya catatan kehadiran di ${label}` });
  } else if (active.length > 0) {
    checks.push({ code: "ATTENDANCE", level: "block", text: `Belum ada catatan kehadiran di ${label}.`, link: { target: "CLOCKIN" } });
  }
  const without = active.length - attended.size;
  if (attended.size > 0 && without > 0) {
    checks.push({
      code: "NO_ATTENDANCE",
      level: "warn",
      text: `${without} host aktif tanpa kehadiran: flow tetap membuat baris Rp0 untuk mereka.`,
      link: { target: "CLOCKIN", label: "lihat" },
    });
  }
  const noBank = active.filter((h) => attended.has(str(h, "Title")) && hasBank(h) === false);
  if (noBank.length > 0) {
    const names = noBank.slice(0, 3).map((h) => str(h, "NamaHost") || str(h, "Title"));
    checks.push({
      code: "NO_BANK",
      level: "block",
      text: `${noBank.length} host dibayar tanpa data rekening (${names.join(", ")}${noBank.length > 3 ? ", …" : ""}).`,
      link: { target: "HOSTS", label: "lengkapi" },
    });
  }
  const inactiveRows = rows.filter((c) => !activeIds.has(str(c, "HostID")) && str(c, "HostID") !== "");
  const inactiveHosts = new Set(inactiveRows.map((c) => str(c, "HostID")));
  if (inactiveHosts.size > 0) {
    const names = [...inactiveHosts].slice(0, 3).map((id) => hostName.get(id) || id);
    checks.push({
      code: "INACTIVE_ATTENDANCE",
      level: "warn",
      text: `${inactiveHosts.size} host nonaktif punya kehadiran dan tidak ikut dibayar (${names.join(", ")}${inactiveHosts.size > 3 ? ", …" : ""}).`,
      link: { target: "HOSTS", label: "lihat" },
    });
  }
  const openShifts = activeRows.filter((c) => str(c, "CheckInTime") !== "" && str(c, "CheckOutTime") === "" && str(c, "ClockOutTime") === "");
  if (openShifts.length > 0) {
    checks.push({
      code: "OPEN_SHIFT",
      level: "warn",
      text: `${openShifts.length} shift tanpa clock out tetap dihitung sebagai hari kerja.`,
      link: { target: "CLOCKIN", label: "lihat" },
    });
  }
  const outside = activeRows.filter((c) => bool(c, "IsInsideGeofence") === false);
  if (outside.length > 0) {
    checks.push({
      code: "OUTSIDE_GEOFENCE",
      level: "warn",
      text: `${outside.length} clock in di luar geofence tetap dihitung.`,
      link: { target: "CLOCKIN", label: "lihat" },
    });
  }
  const unreviewed = input.reports.filter((r) => inPeriod(date(r, "LiveDate"), period) && ["WAITING", "REVISION"].includes(reviewState(r)));
  if (unreviewed.length > 0) {
    checks.push({ code: "UNREVIEWED", level: "warn", text: `${unreviewed.length} report ${label} belum direview.`, link: { target: "REVIEW", label: "lihat" } });
  } else if (input.reports.length > 0 || attended.size > 0) {
    checks.push({ code: "UNREVIEWED", level: "pass", text: `Semua report ${label} sudah direview` });
  }

  const order: Record<CheckLevel, number> = { block: 0, warn: 1, pass: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);

  const byTier = (t: 1 | 2 | 3) => mode(rows.filter((c) => tierOf(c) === t).map((c) => num(c, "Insentif") ?? 0));
  return {
    period,
    checks,
    blocked: checks.some((c) => c.level === "block"),
    warnings: checks.filter((c) => c.level === "warn").map((c) => c.code),
    rates: {
      manday: mode(rows.map((c) => num(c, "HKTugas") ?? 0)),
      tier1: byTier(1),
      tier2: byTier(2),
      tier3: byTier(3),
      streak: mode(rows.map((c) => num(c, "Streak") ?? 0)),
    },
    estimate: activeRows.reduce((s, c) => s + clockInValue(c), 0),
    activeHosts: active.length,
    hostsWithAttendance: attended.size,
  };
}

/** Data periods offered in the picker: the last `count` complete months, newest first. */
export function periodOptions(now: Date, count = 6): Period[] {
  const last = addMonths(periodOf(now), -1);
  return Array.from({ length: count }, (_, i) => addMonths(last, -i));
}

// ---- run detail lines -----------------------------------------------------------------------------

export type LineFlag = "NO_BANK" | "ZERO_ATTENDANCE" | "SOURCE_MISMATCH";

export interface PayLine {
  id: string;
  name: string;
  email: string;
  hostId: string;
  hk: number | null;
  uangKehadiran: number | null;
  mingguan: number | null;
  tier1: number | null;
  tier2: number | null;
  tier3: number | null;
  bruto: number | null;
  pph21: number | null;
  net: number | null;
  bank: string;
  norekLast4: string;
  hasBank: boolean | null;
  periodeLabel: string;
  linePeriod: Period | null;
  slip: SlipState | null;
  slipRow: Row | undefined;
  flags: LineFlag[];
  clockIns: Row[];
  /** HKTugas + Insentif + Streak over this host's rows in the data period (null without ClockInJson). */
  sourceTotal: number | null;
}

export interface LineTotals {
  hk: number;
  uangKehadiran: number;
  mingguan: number;
  tier1: number;
  tier2: number;
  tier3: number;
  bruto: number;
  pph21: number;
  net: number;
}

export interface RunDetail {
  run: RunModel | null;
  lines: PayLine[];
  totals: LineTotals;
  /** Payroll Data rows stamped with a period other than the run's data period (P2). */
  periodMismatch: { labels: string[]; count: number };
  /** TotalPayroll written and not equal to the lines. */
  totalMismatch: boolean;
  pphAllZero: boolean;
  attention: number;
  slipsTracked: boolean;
}

const lower = (s: string) => s.trim().toLowerCase();

export function buildRunDetail(runRow: Row | undefined, lineRows: Row[], clockIns: Row[], slips: Row[], opts: RunOptions): RunDetail {
  const run = runRow ? buildRun(runRow, lineRows, slips, opts) : null;
  const dataPeriod = run?.dataPeriod ?? null;
  const periodRows = dataPeriod ? clockIns.filter((c) => inPeriod(clockInDay(c), dataPeriod)) : clockIns;
  const byHost = new Map<string, Row[]>();
  for (const c of periodRows) {
    const k = str(c, "HostID");
    if (!k) continue;
    const list = byHost.get(k);
    if (list) list.push(c);
    else byHost.set(k, [c]);
  }
  for (const list of byHost.values()) list.sort((a, b) => (clockInDay(a)?.getTime() ?? 0) - (clockInDay(b)?.getTime() ?? 0));
  const haveClockIns = clockIns.length > 0;

  const slipIndex = new Map<string, Row>();
  for (const s of slips) {
    for (const k of [str(s, "LineID", "payroll_item_id", "Title"), str(s, "Employee_Email", "Email"), str(s, "HostID")]) {
      if (k && !slipIndex.has(lower(k))) slipIndex.set(lower(k), s);
    }
  }

  const mismatchLabels = new Set<string>();
  let mismatchCount = 0;
  const lines: PayLine[] = lineRows.map((l) => {
    const id = str(l, "Title", "payroll_item_id") || rowId(l);
    const email = str(l, "Employee_Email", "Email");
    const hostId = str(l, "HostID");
    const rows = byHost.get(hostId) ?? [];
    const periodeLabel = str(l, "Periode");
    const linePeriod = parsePeriod(periodeLabel);
    const slipRow = slipIndex.get(lower(id)) ?? (email ? slipIndex.get(lower(email)) : undefined) ?? (hostId ? slipIndex.get(lower(hostId)) : undefined);
    const bruto = lineGross(l);
    const hk = num(l, "JumlahHari", "HK");
    const bank = str(l, "Bank");
    const norekLast4 = str(l, "NorekLast4");
    const flagBank = bool(l, "HasRekening");
    const lineHasBank = flagBank !== null ? flagBank : "Bank" in l || "NorekLast4" in l ? bank !== "" && norekLast4 !== "" : null;
    const sourceTotal = haveClockIns && hostId ? rows.reduce((s, c) => s + clockInValue(c), 0) : null;

    const flags: LineFlag[] = [];
    if (lineHasBank === false) flags.push("NO_BANK");
    if ((hk ?? 0) === 0 && (bruto ?? 0) === 0) flags.push("ZERO_ATTENDANCE");
    // Run-level problem (P2 stamps every row alike): reported once as a banner, not on each line.
    if (periodeLabel && dataPeriod && linePeriod && !samePeriod(linePeriod, dataPeriod)) {
      mismatchLabels.add(periodeLabel);
      mismatchCount++;
    }
    if (sourceTotal !== null && bruto !== null && Math.abs(sourceTotal - bruto) >= 1) flags.push("SOURCE_MISMATCH");

    return {
      id,
      name: str(l, "Employee_Name", "NamaHost") || email || id,
      email,
      hostId,
      hk,
      uangKehadiran: num(l, "UangKehadiran"),
      mingguan: num(l, "Mingguan"),
      tier1: num(l, "Tier1"),
      tier2: num(l, "Tier2"),
      tier3: num(l, "Tier3"),
      bruto,
      pph21: num(l, "PPh21"),
      net: num(l, "NetTHP"),
      bank,
      norekLast4,
      hasBank: lineHasBank,
      periodeLabel,
      linePeriod,
      slip: slipRow ? slipState(slipRow) : null,
      slipRow,
      flags,
      clockIns: rows,
      sourceTotal,
    };
  });

  lines.sort((a, b) => a.name.localeCompare(b.name));
  const sum = (f: (l: PayLine) => number | null) => lines.reduce((s, l) => s + (f(l) ?? 0), 0);
  const totals: LineTotals = {
    hk: sum((l) => l.hk),
    uangKehadiran: sum((l) => l.uangKehadiran),
    mingguan: sum((l) => l.mingguan),
    tier1: sum((l) => l.tier1),
    tier2: sum((l) => l.tier2),
    tier3: sum((l) => l.tier3),
    bruto: sum((l) => l.bruto),
    pph21: sum((l) => l.pph21),
    net: sum((l) => l.net),
  };

  return {
    run,
    lines,
    totals,
    periodMismatch: { labels: [...mismatchLabels], count: mismatchCount },
    totalMismatch: !!run && run.fieldTotal !== null && lines.length > 0 && Math.abs(run.fieldTotal - totals.bruto) >= 1,
    pphAllZero: lines.length > 0 && lines.every((l) => (l.pph21 ?? 0) === 0),
    attention: lines.filter((l) => l.flags.length > 0).length,
    slipsTracked: slips.length > 0,
  };
}

export const LINE_FLAG: Record<LineFlag, { label: string; tone: Tone; hint: string }> = {
  NO_BANK: { label: "Tanpa rekening", tone: "danger", hint: "Host tidak punya data bank: transfer dan slip gagal. Lengkapi di list Host sebelum approval." },
  ZERO_ATTENDANCE: { label: "Tanpa kehadiran", tone: "warning", hint: "Baris Rp0: host aktif tanpa Clock In di periode ini." },
  SOURCE_MISMATCH: { label: "Tidak cocok Clock In", tone: "danger", hint: "Bruto berbeda dari jumlah HKTugas + Insentif + Streak di Clock In periode ini." },
};
