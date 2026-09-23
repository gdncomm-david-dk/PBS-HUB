// Studio utilization and "who is using the studio right now".
//
// Utilization = scheduled host-hours ÷ (KapasitasHost × operating hours × days).
// - Only sessions that occupy the studio count (Cancelled / Leave are excluded).
// - A session's hours are clipped to the operating window, so the ratio stays comparable across studios.
// - Each Schedule row is one host in one session (DESIGN.md: Schedule carries a single HostID),
//   so two rows at the same studio and time use two of the studio's host slots.
// This is a display metric only; nothing that money depends on is computed here.

import { OperatingHours, ScheduleRow, StudioRow } from "./types";
import { occupiesStudio } from "./data";
import { daysInMonth, monthDateKeys, shiftDay, shiftMonth } from "./time";

export interface UtilStat {
    usedMin: number;
    capacityMin: number;
    /** 0..n (can exceed 1 when a studio is over-booked). null when there is no capacity to measure against. */
    ratio: number | null;
    sessions: number;
}

export const effectiveCapacity = (s: StudioRow): number => (s.kapasitasHost > 0 ? s.kapasitasHost : 1);

export function operatingMinutes(op: OperatingHours): number {
    return Math.max(0, op.endMin - op.startMin);
}

/** Minutes of a session that fall inside the operating window of its own date. */
export function sessionMinutes(s: ScheduleRow, op: OperatingHours): number {
    if (s.startMin === null || s.endMin === null) {
        return Math.min(Math.max(0, s.jamLive * 60), operatingMinutes(op));
    }
    const a = Math.max(s.startMin, op.startMin);
    const b = Math.min(s.endMin, op.endMin);
    return Math.max(0, b - a);
}

const ratio = (used: number, cap: number): number | null => (cap > 0 ? used / cap : null);

export class ScheduleIndex {
    /** studioId(lower) → dateKey → sessions */
    private byStudio = new Map<string, Map<string, ScheduleRow[]>>();
    readonly all: ScheduleRow[];

    constructor(rows: ScheduleRow[]) {
        this.all = rows;
        for (const r of rows) {
            const sk = r.studioId.toLowerCase();
            let days = this.byStudio.get(sk);
            if (!days) {
                days = new Map();
                this.byStudio.set(sk, days);
            }
            const list = days.get(r.dateKey);
            if (list) list.push(r);
            else days.set(r.dateKey, [r]);
        }
        for (const days of this.byStudio.values()) {
            for (const list of days.values()) list.sort(bySessionTime);
        }
    }

    day(studioId: string, dateKey: string): ScheduleRow[] {
        return this.byStudio.get(studioId.toLowerCase())?.get(dateKey) ?? [];
    }

    forStudio(studioId: string): ScheduleRow[] {
        const days = this.byStudio.get(studioId.toLowerCase());
        if (!days) return [];
        const out: ScheduleRow[] = [];
        for (const list of days.values()) out.push(...list);
        return out.sort(bySessionTime);
    }

    hasMonth(monthKey: string): boolean {
        return this.all.some((r) => r.dateKey.startsWith(monthKey));
    }
}

export function bySessionTime(a: ScheduleRow, b: ScheduleRow): number {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    return (a.startMin ?? 9999) - (b.startMin ?? 9999);
}

export function studioDay(idx: ScheduleIndex, studio: StudioRow, dateKey: string, op: OperatingHours): UtilStat {
    const sessions = idx.day(studio.studioId, dateKey).filter((s) => occupiesStudio(s.status));
    const usedMin = sessions.reduce((t, s) => t + sessionMinutes(s, op), 0);
    const capacityMin = effectiveCapacity(studio) * operatingMinutes(op);
    return { usedMin, capacityMin, ratio: ratio(usedMin, capacityMin), sessions: sessions.length };
}

export function studioMonth(idx: ScheduleIndex, studio: StudioRow, monthKey: string, op: OperatingHours): UtilStat {
    let usedMin = 0;
    let sessions = 0;
    for (const d of monthDateKeys(monthKey)) {
        const st = studioDay(idx, studio, d, op);
        usedMin += st.usedMin;
        sessions += st.sessions;
    }
    const capacityMin = effectiveCapacity(studio) * operatingMinutes(op) * daysInMonth(monthKey);
    return { usedMin, capacityMin, ratio: ratio(usedMin, capacityMin), sessions };
}

function sum(stats: UtilStat[]): UtilStat {
    const usedMin = stats.reduce((t, s) => t + s.usedMin, 0);
    const capacityMin = stats.reduce((t, s) => t + s.capacityMin, 0);
    return { usedMin, capacityMin, ratio: ratio(usedMin, capacityMin), sessions: stats.reduce((t, s) => t + s.sessions, 0) };
}

/** Overall = active studios only, so a closed studio does not dilute the figure. */
export function overallDay(idx: ScheduleIndex, studios: StudioRow[], dateKey: string, op: OperatingHours): UtilStat {
    return sum(studios.filter((s) => s.isActive).map((s) => studioDay(idx, s, dateKey, op)));
}

export function overallMonth(idx: ScheduleIndex, studios: StudioRow[], monthKey: string, op: OperatingHours): UtilStat {
    return sum(studios.filter((s) => s.isActive).map((s) => studioMonth(idx, s, monthKey, op)));
}

export interface DailyPoint {
    dateKey: string;
    stat: UtilStat;
}

export function dailySeries(
    idx: ScheduleIndex,
    studios: StudioRow[],
    monthKey: string,
    op: OperatingHours,
): DailyPoint[] {
    return monthDateKeys(monthKey).map((dateKey) => ({ dateKey, stat: overallDay(idx, studios, dateKey, op) }));
}

export function studioDailySeries(idx: ScheduleIndex, studio: StudioRow, monthKey: string, op: OperatingHours): DailyPoint[] {
    return monthDateKeys(monthKey).map((dateKey) => ({ dateKey, stat: studioDay(idx, studio, dateKey, op) }));
}

/** Month-over-month change in percentage points, or null when the previous month is not loaded. */
export function monthDeltaPoints(
    idx: ScheduleIndex,
    studios: StudioRow[],
    monthKey: string,
    op: OperatingHours,
): number | null {
    const prevKey = shiftMonth(monthKey, -1);
    if (!idx.hasMonth(prevKey)) return null;
    const cur = overallMonth(idx, studios, monthKey, op).ratio;
    const prev = overallMonth(idx, studios, prevKey, op).ratio;
    if (cur === null || prev === null) return null;
    return Math.round((cur - prev) * 100);
}

// ---------------------------------------------------------------------------------------------
// Now playing

export interface LiveInfo {
    running: ScheduleRow[];
    brands: string[];
    hosts: string[];
    startMin: number;
    endMin: number;
    remainingMin: number;
    slotsUsed: number;
    capacity: number;
    next: ScheduleRow | null;
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)));

/** A session is running when today's date matches and start ≤ now < end (overnight sessions from yesterday count). */
export function runningSessions(idx: ScheduleIndex, studioId: string, todayKey: string, nowMin: number): ScheduleRow[] {
    const today = idx
        .day(studioId, todayKey)
        .filter((s) => s.startMin !== null && s.endMin !== null && s.startMin <= nowMin && nowMin < s.endMin);
    const yesterday = idx
        .day(studioId, shiftDay(todayKey, -1))
        .filter((s) => s.endMin !== null && s.endMin > 1440 && nowMin + 1440 < s.endMin);
    return [...yesterday, ...today].filter((s) => occupiesStudio(s.status));
}

export function nextSession(idx: ScheduleIndex, studioId: string, todayKey: string, nowMin: number): ScheduleRow | null {
    const future = idx
        .forStudio(studioId)
        .filter((s) => occupiesStudio(s.status))
        .filter((s) => s.dateKey > todayKey || (s.dateKey === todayKey && (s.startMin ?? -1) > nowMin));
    return future[0] ?? null;
}

export function liveInfo(idx: ScheduleIndex, studio: StudioRow, todayKey: string, nowMin: number): LiveInfo {
    const running = runningSessions(idx, studio.studioId, todayKey, nowMin);
    const offset = (s: ScheduleRow): number => (s.dateKey === todayKey ? 0 : -1440);
    const starts = running.map((s) => (s.startMin ?? 0) + offset(s));
    const ends = running.map((s) => (s.endMin ?? 0) + offset(s));
    const endMin = ends.length ? Math.max(...ends) : 0;
    const hostKeys = uniq(running.map((s) => s.hostId || s.key));
    return {
        running,
        brands: uniq(running.map((s) => s.brandName)),
        hosts: uniq(running.map((s) => s.hostName)),
        startMin: starts.length ? Math.min(...starts) : 0,
        endMin,
        remainingMin: running.length ? Math.max(0, endMin - nowMin) : 0,
        slotsUsed: hostKeys.length,
        capacity: effectiveCapacity(studio),
        next: running.length ? null : nextSession(idx, studio.studioId, todayKey, nowMin),
    };
}

// ---------------------------------------------------------------------------------------------
// Capacity per time slot (SD-2 Jadwal: "capacity indicator per slot")

export interface SlotInfo {
    startMin: number;
    endMin: number;
    used: number;
    capacity: number;
    sessions: ScheduleRow[];
}

export function hourlySlots(
    idx: ScheduleIndex,
    studio: StudioRow,
    dateKey: string,
    op: OperatingHours,
    slotMinutes = 60,
): SlotInfo[] {
    const sessions = idx.day(studio.studioId, dateKey).filter((s) => occupiesStudio(s.status));
    const out: SlotInfo[] = [];
    for (let t = op.startMin; t < op.endMin; t += slotMinutes) {
        const end = Math.min(t + slotMinutes, op.endMin);
        const inSlot = sessions.filter((s) => s.startMin !== null && s.endMin !== null && s.startMin < end && s.endMin > t);
        out.push({
            startMin: t,
            endMin: end,
            used: uniq(inSlot.map((s) => s.hostId || s.key)).length,
            capacity: effectiveCapacity(studio),
            sessions: inSlot,
        });
    }
    return out;
}

export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);
/** Hours in Indonesian number format: 1.526,5 */
export const hours = (min: number): string => {
    const h = Math.round((min / 60) * 10) / 10;
    const [int, dec] = String(Math.abs(h)).split(".");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (h < 0 ? "-" : "") + grouped + (dec ? "," + dec : "");
};
