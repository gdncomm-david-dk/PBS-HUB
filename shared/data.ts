/**
 * Defensive readers for rows that canvas hands to the controls as JSON text.
 *
 * Canvas serialises SharePoint rows with `JSON()`. Depending on how the screen shapes them, a
 * Choice column arrives as "Done" or as {"Value":"Done"}, a Person column as
 * {"DisplayName":…,"Email":…}, and a column with a special character (`Durasi(Min)`) may arrive
 * under its encoded internal name (`Durasi_x0028_Min_x0029_`). Every reader here accepts all of
 * those forms and never throws, because a control that crashes on a blank property is unusable in
 * Studio (canvas hands "" on first render).
 */

export type Row = Record<string, unknown>;

/** Parses a JSON array of rows. A single object is treated as a one-row array. Never throws. */
export function parseRows(raw: string | null | undefined): Row[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((r): r is Row => typeof r === "object" && r !== null && !Array.isArray(r));
  }
  if (typeof parsed === "object" && parsed !== null) {
    const o = parsed as Row;
    // Power Fx `JSON(Table)` never wraps, but some screens send {"value":[…]} from a flow response.
    if (Array.isArray(o.value)) return parseRows(JSON.stringify(o.value));
    return [o];
  }
  return [];
}

/** Returns the first key present on the row, trying every alias in order. */
function pick(row: Row | undefined, keys: readonly string[]): unknown {
  if (!row) return undefined;
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== undefined) return row[k];
  }
  // Case-insensitive fallback: SharePoint internal names and display names differ in case at times.
  const lower = keys.map((k) => k.toLowerCase());
  for (const k of Object.keys(row)) {
    if (lower.includes(k.toLowerCase()) && row[k] !== null && row[k] !== undefined) return row[k];
  }
  return undefined;
}

/** Unwraps a Choice / Lookup / Person value to its display text. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Row;
    for (const k of ["Value", "DisplayName", "Title", "Email", "Name"]) {
      if (typeof o[k] === "string" || typeof o[k] === "number") return o[k];
    }
  }
  if (Array.isArray(v)) {
    // Multi-choice: join the display values.
    return v.map((x) => unwrap(x)).filter((x) => x !== undefined && x !== null && x !== "").join(", ");
  }
  return v;
}

export function str(row: Row | undefined, ...keys: string[]): string {
  const v = unwrap(pick(row, keys));
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Person column: prefers the display name, falls back to the e-mail. */
export function person(row: Row | undefined, ...keys: string[]): { name: string; email: string } {
  const v = pick(row, keys);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Row;
    const email = typeof o.Email === "string" ? o.Email : "";
    const name = typeof o.DisplayName === "string" ? o.DisplayName : email;
    return { name, email };
  }
  const s = str(row, ...keys);
  return { name: s, email: s.includes("@") ? s : "" };
}

/**
 * Numeric reader. Returns `null` for blank — blank and zero mean different things in reconciliation
 * (a blank AI metric is "Metrik kosong", a zero is a real reading). Accepts "12.400.000",
 * "4,8", "4.8%", "Rp12.400.000".
 */
export function num(row: Row | undefined, ...keys: string[]): number | null {
  const v = unwrap(pick(row, keys));
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string") return null;
  let s = v.replace(/rp/i, "").replace(/%/g, "").replace(/\s/g, "");
  if (s === "" || s === "-") return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // Whichever separator comes last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "12.400.000" — Indonesian thousands separators, not a decimal.
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function bool(row: Row | undefined, ...keys: string[]): boolean | null {
  const v = unwrap(pick(row, keys));
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "ya", "1"].includes(s)) return true;
  if (["false", "no", "tidak", "0"].includes(s)) return false;
  return null;
}

/**
 * Date reader. A date-only string ("2026-09-14") is read as a LOCAL date, not UTC midnight —
 * otherwise every Schedule.Date shifts one day back for a viewer west of UTC. Timestamps with a
 * zone are honoured.
 */
export function date(row: Row | undefined, ...keys: string[]): Date | null {
  const v = unwrap(pick(row, keys));
  return toDate(v);
}

export function toDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "10:00", "10.00", "1000", "10:00:00", "10:00 AM", a whole hour "10", or a SharePoint Date and Time
 * value ("2026-09-14T03:00:00Z", read in local time) → minutes after midnight.
 */
export function parseClock(v: string): number | null {
  const s = v.trim().toUpperCase();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(s)) {
    const d = new Date(v.trim().replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
  }
  if (/^\d{1,2}$/.test(s)) return Number(s) <= 24 ? Number(s) * 60 : null;
  const m = /^(\d{1,2})[:.]?(\d{2})(?:[:.]\d{2})?\s*(AM|PM)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3] === "PM" && h < 12) h += 12;
  if (m[3] === "AM" && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** SharePoint item ID. Canvas sends it as `ID`; some shaped rows use `Id`. */
export function rowId(row: Row | undefined): string {
  return str(row, "ID", "Id", "id");
}

/** Builds a Title→display-name lookup from a master list (Brand, Host, Studio). */
export function nameIndex(rows: Row[], nameKeys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const key = str(r, "Title");
    const name = str(r, ...nameKeys);
    if (key) m.set(key, name || key);
  }
  return m;
}

/** Clock value as "HH:mm" for display; the raw text when it is not a time; "" when blank. */
export function clockText(v: string): string {
  const m = parseClock(v);
  if (m === null) return v.trim();
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Schedule.Position (Host / Co-Host). */
export const schedulePosition = (row: Row | undefined): string => str(row, "Position", "HostPosition", "Posisi", "HostRole");

/**
 * Why a schedule needs no report: LiveBreak = Yes, or the host is Co-Host (a Co-Host never reports,
 * whatever LiveBreak says). null when a report is expected.
 */
export function noReportReason(row: Row | undefined): "LIVE_BREAK" | "CO_HOST" | null {
  if (bool(row, "LiveBreak", "Live Break", "IsLiveBreak") === true) return "LIVE_BREAK";
  if (/^co[\s_-]*host$/i.test(schedulePosition(row))) return "CO_HOST";
  return null;
}

export const NO_REPORT_LABEL: Record<"LIVE_BREAK" | "CO_HOST", string> = { LIVE_BREAK: "Live break", CO_HOST: "Co-Host" };

/** A full date-time column value ("2026-09-14T02:40:00Z", "2026-09-14 09:40"); null for a bare clock or blank. */
export function dateTime(row: Row | undefined, ...keys: string[]): Date | null {
  for (const k of keys) {
    const v = str(row, k);
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(v)) continue;
    const d = new Date(v.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Report.ScheduleID under the names canvas may send (field name, SharePoint internal name, lookup). */
export const reportScheduleId = (r: Row | undefined): string => str(r, "ScheduleID", "Schedule ID", "Schedule_x0020_ID", "ScheduleId", "Schedule");

/** Report.Playbook (Choice; multi-choice joined). */
export const reportPlaybook = (r: Row | undefined): string => str(r, "Playbook", "PlayBook", "Play_x0020_Book");
