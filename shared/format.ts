/** Bahasa Indonesia formatting. Written by hand rather than via Intl so the output is identical in
 * every Power Apps player (the Android/iOS WebViews ship uneven `id-ID` locale data). */

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function monthName(m: number): string {
  return MONTHS[m] ?? "";
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 12400000 → "12.400.000"; 4.8 (decimals 2) → "4,80". */
export function fmtNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [i, f] = fixed.split(".");
  return `${neg ? "−" : ""}${group(i ?? "0")}${f ? "," + f : ""}`;
}

export function fmtRupiah(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `Rp${fmtNumber(Math.round(n))}`;
}

export function fmtPercentValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${fmtNumber(n, 2)}%`;
}

/** 0.129 → "+12,9%". */
export function fmtSignedPct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${fmtNumber(Math.abs(rounded), 1)}%`;
}

export function fmtDayMonth(d: Date | null): string {
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(d: Date | null): string {
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtLongDate(d: Date): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDateTimeShort(d: Date | null): string {
  if (!d) return "—";
  return `${fmtDayMonth(d)} ${fmtTime(d)}`;
}

export function fmtClock(minutes: number | null): string {
  if (minutes === null) return "—";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Age since `from`: "14 jam", "2 hari", "5 menit". */
export function fmtAge(from: Date | null, now: Date): string {
  if (!from) return "—";
  const ms = now.getTime() - from.getTime();
  if (ms < 0) return "baru saja";
  const min = Math.floor(ms / 60000);
  if (min < 60) return min <= 1 ? "baru saja" : `${min} menit`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam`;
  return `${Math.floor(h / 24)} hari`;
}

/** "5 menit lalu", "2 hari lalu". */
export function fmtAgo(from: Date | null, now: Date): string {
  const a = fmtAge(from, now);
  if (a === "—" || a === "baru saja") return a;
  return `${a} lalu`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** "Dinda Maharani" → "Dinda M." for dense lanes. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1]?.[0] ?? ""}.`;
}
