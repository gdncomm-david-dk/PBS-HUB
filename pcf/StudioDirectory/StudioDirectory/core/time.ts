// Date and time helpers. Schedule.StartTime / EndTime are TEXT in v1 (DESIGN.md), so they are parsed here.

export const BULAN = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
export const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const pad = (n: number): string => (n < 10 ? "0" + n : String(n));

/** Local yyyy-mm-dd. */
export function toDateKey(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateKeyToDate(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

/** yyyy-mm */
export function toMonthKey(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthKeyOf(dateKey: string): string {
    return dateKey.slice(0, 7);
}

export function shiftMonth(monthKey: string, delta: number): string {
    const [y, m] = monthKey.split("-").map(Number);
    return toMonthKey(new Date(y, m - 1 + delta, 1));
}

export function daysInMonth(monthKey: string): number {
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m, 0).getDate();
}

export function monthDateKeys(monthKey: string): string[] {
    const n = daysInMonth(monthKey);
    const out: string[] = [];
    for (let i = 1; i <= n; i++) out.push(`${monthKey}-${pad(i)}`);
    return out;
}

export function shiftDay(dateKey: string, delta: number): string {
    const d = dateKeyToDate(dateKey);
    d.setDate(d.getDate() + delta);
    return toDateKey(d);
}

/**
 * Parse any value SharePoint / canvas hands us for a Date column into a local date key.
 * - Date objects (dataset getValue) use their local calendar date.
 * - "2026-09-15" date-only strings are taken literally (no UTC shift).
 * - ISO strings with a time part (Power Fx JSON() emits UTC) are converted to local.
 */
export function parseDateKey(v: unknown): string {
    if (v === null || v === undefined || v === "") return "";
    if (v instanceof Date) return isNaN(v.getTime()) ? "" : toDateKey(v);
    if (typeof v === "number") return toDateKey(new Date(v));
    const s = String(v).trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dateOnly) return s;
    const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : toDateKey(d);
}

/**
 * Parse a text time into minutes after midnight.
 * Accepts "14:00", "14.00", "14:00:00", "1400", "9", "2:30 PM", "02.30 pm", Date objects and ISO datetimes.
 */
export function parseTimeToMinutes(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getHours() * 60 + v.getMinutes();
    const s = String(v).trim().toLowerCase();
    if (/^\d{4}-\d{2}-\d{2}t/.test(s)) {
        const d = new Date(String(v));
        return isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
    }
    const m = /^(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(s);
    let h: number;
    let min: number;
    if (m) {
        h = Number(m[1]);
        min = m[2] ? Number(m[2]) : 0;
        if (m[4] === "pm" && h < 12) h += 12;
        if (m[4] === "am" && h === 12) h = 0;
    } else {
        const compact = /^(\d{2})(\d{2})$/.exec(s);
        if (!compact) return null;
        h = Number(compact[1]);
        min = Number(compact[2]);
    }
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
    return h * 60 + min;
}

export function formatMinutes(min: number): string {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function formatDuration(min: number): string {
    const m = Math.max(0, Math.round(min));
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h === 0) return `${r} m`;
    if (r === 0) return `${h} j`;
    return `${h} j ${r} m`;
}

export function formatDateLong(dateKey: string): string {
    const d = dateKeyToDate(dateKey);
    return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(dateKey: string): string {
    const d = dateKeyToDate(dateKey);
    return `${d.getDate()} ${BULAN_PENDEK[d.getMonth()]}`;
}

export function formatMonth(monthKey: string): string {
    const [y, m] = monthKey.split("-").map(Number);
    return `${BULAN[m - 1]} ${y}`;
}

export function monthName(monthKey: string): string {
    return BULAN[Number(monthKey.split("-")[1]) - 1];
}

export function minutesOfDay(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}
