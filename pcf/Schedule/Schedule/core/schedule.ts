// Scheduling rules the v1 app never enforced (DESIGN.md): host double-booking, studio capacity,
// account double-booking. The control only warns; canvas and flows still accept the write.

import { AbsenceRow, ClockRow, EvidenceRow, ReportRow, ScheduleRow, StudioRow } from "./types";
import { approvalKind, occupies } from "./data";
import { dateKeyToDate, formatMinutes, shiftDay, toDateKey } from "./time";

const low = (s: string): string => s.trim().toLowerCase();

export type ConflictKind = "host" | "studio" | "account";

export interface Conflict {
    kind: ConflictKind;
    message: string;
    others: ScheduleRow[];
}

/** The part of a session that matters for overlap checks. */
export interface Slot {
    key?: string;
    dateKey: string;
    studioId: string;
    hostId: string;
    accountId: string;
    startMin: number | null;
    endMin: number | null;
    status: string;
}

/** Absolute minutes from an arbitrary epoch day, so overnight sessions overlap the next day correctly. */
function span(s: Slot): [number, number] | null {
    if (s.startMin === null || s.endMin === null) return null;
    const day = Math.round(dateKeyToDate(s.dateKey).getTime() / 86400000);
    return [day * 1440 + s.startMin, day * 1440 + s.endMin];
}

export const overlaps = (a: Slot, b: Slot): boolean => {
    const x = span(a);
    const y = span(b);
    return !!x && !!y && x[0] < y[1] && y[0] < x[1];
};

export const timeRange = (s: { startMin: number | null; endMin: number | null; startText?: string; endText?: string }): string =>
    s.startMin !== null && s.endMin !== null ? `${formatMinutes(s.startMin)}–${formatMinutes(s.endMin)}` : `${s.startText || "?"}–${s.endText || "?"}`;

/**
 * Warnings for one session against a set of others (existing sessions, or other rows of an import file).
 * Studio capacity counts distinct hosts present at the busiest moment of the candidate's window.
 */
export function conflictsFor(
    cand: Slot,
    pool: ScheduleRow[],
    studios: Map<string, StudioRow>,
    names: { host: (s: ScheduleRow) => string; studio: (id: string) => string },
): Conflict[] {
    if (!occupies(cand.status)) return [];
    const near = pool.filter((o) => o.key !== cand.key && occupies(o.status) && Math.abs(dayDiff(o.dateKey, cand.dateKey)) <= 1 && overlaps(cand, o));
    const out: Conflict[] = [];

    const hostClash = cand.hostId ? near.filter((o) => low(o.hostId) === low(cand.hostId)) : [];
    if (hostClash.length) {
        const o = hostClash[0];
        out.push({ kind: "host", others: hostClash, message: `Host ${names.host(o)} sudah dijadwalkan ${timeRange(o)} di ${names.studio(o.studioId)}` });
    }

    const accClash = cand.accountId ? near.filter((o) => low(o.accountId) === low(cand.accountId)) : [];
    if (accClash.length) {
        const o = accClash[0];
        out.push({ kind: "account", others: accClash, message: `Account ${o.accountName || o.accountId} sudah live ${timeRange(o)} di ${names.studio(o.studioId)}` });
    }

    const studio = cand.studioId ? studios.get(low(cand.studioId)) : undefined;
    if (studio && cand.startMin !== null && cand.endMin !== null) {
        const cap = Math.max(1, studio.kapasitasHost || 1);
        const same = near.filter((o) => low(o.studioId) === low(cand.studioId));
        const peak = peakHosts(cand, same);
        if (peak.count > cap) {
            out.push({
                kind: "studio",
                others: same,
                message: `${names.studio(cand.studioId)} penuh: ${peak.count} host pada ${formatMinutes(peak.atMin)}, kapasitas ${cap}`,
            });
        }
    }
    return out;
}

function dayDiff(a: string, b: string): number {
    return Math.round((dateKeyToDate(a).getTime() - dateKeyToDate(b).getTime()) / 86400000);
}

/** Distinct hosts (candidate included) at the busiest start boundary inside the candidate's window. */
function peakHosts(cand: Slot, others: ScheduleRow[]): { count: number; atMin: number } {
    const c = span(cand);
    if (!c) return { count: 0, atMin: 0 };
    const spans = others.map((o) => ({ o, s: span(o) })).filter((x): x is { o: ScheduleRow; s: [number, number] } => !!x.s);
    const points = [c[0], ...spans.map((x) => x.s[0]).filter((t) => t > c[0] && t < c[1])];
    let best = { count: 0, atMin: cand.startMin ?? 0 };
    for (const t of points) {
        const hosts = new Set<string>([low(cand.hostId) || "__cand"]);
        for (const x of spans) if (x.s[0] <= t && t < x.s[1]) hosts.add(low(x.o.hostId) || `__${x.o.key}`);
        if (hosts.size > best.count) best = { count: hosts.size, atMin: ((t % 1440) + 1440) % 1440 };
    }
    return best;
}

/** All conflicts across a set of sessions, keyed by ScheduleRow.key. */
export function conflictIndex(rows: ScheduleRow[], studios: Map<string, StudioRow>, studioName: (id: string) => string): Map<string, Conflict[]> {
    const byDay = new Map<string, ScheduleRow[]>();
    for (const r of rows) {
        const a = byDay.get(r.dateKey);
        if (a) a.push(r);
        else byDay.set(r.dateKey, [r]);
    }
    const out = new Map<string, Conflict[]>();
    for (const r of rows) {
        const pool = [...(byDay.get(shiftDay(r.dateKey, -1)) ?? []), ...(byDay.get(r.dateKey) ?? []), ...(byDay.get(shiftDay(r.dateKey, 1)) ?? [])];
        const c = conflictsFor(r, pool, studios, { host: (o) => o.hostName || o.hostId, studio: studioName });
        if (c.length) out.set(r.key, c);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Joins

export class Evidence {
    readonly reports = new Map<string, ReportRow[]>();
    readonly absences = new Map<string, AbsenceRow[]>();
    readonly evidence = new Map<string, EvidenceRow[]>();
    private readonly evidenceByTitle = new Map<string, EvidenceRow[]>();
    private readonly clocks = new Map<string, ClockRow[]>();

    constructor(reports: ReportRow[], absences: AbsenceRow[], clocks: ClockRow[], evidence: EvidenceRow[]) {
        const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
            const a = m.get(k);
            if (a) a.push(v);
            else m.set(k, [v]);
        };
        for (const r of reports) push(this.reports, low(r.scheduleId), r);
        for (const a of absences) push(this.absences, low(a.scheduleId), a);
        for (const e of evidence) {
            if (e.scheduleId) push(this.evidence, low(e.scheduleId), e);
            if (e.title) push(this.evidenceByTitle, low(e.title), e);
        }
        for (const c of clocks) if (c.hostId) push(this.clocks, `${low(c.hostId)}|${c.dateKey}`, c);
    }

    reportsFor(s: ScheduleRow): ReportRow[] {
        return s.scheduleId ? this.reports.get(low(s.scheduleId)) ?? [] : [];
    }

    /** A session with a submitted report is locked: editing it would orphan the report (DESIGN.md). */
    isLocked(s: ScheduleRow): boolean {
        return this.reportsFor(s).length > 0;
    }

    absencesFor(s: ScheduleRow): AbsenceRow[] {
        return s.scheduleId ? this.absences.get(low(s.scheduleId)) ?? [] : [];
    }

    /** Report Automation rows of the session: by ScheduleID, and by Title = the Title of one of its reports. */
    evidenceFor(s: ScheduleRow): EvidenceRow[] {
        const out = new Map<string, EvidenceRow>();
        for (const e of s.scheduleId ? this.evidence.get(low(s.scheduleId)) ?? [] : []) out.set(e.key, e);
        for (const r of this.reportsFor(s)) for (const e of this.evidenceForReport(r)) out.set(e.key, e);
        return Array.from(out.values());
    }

    /** Report Automation.Title = Report.Title. */
    evidenceForReport(r: ReportRow): EvidenceRow[] {
        return r.reportId ? this.evidenceByTitle.get(low(r.reportId)) ?? [] : [];
    }

    /** Reports that are real submissions (a LiveBreak row is a placeholder). */
    realReportsFor(s: ScheduleRow): ReportRow[] {
        return this.reportsFor(s).filter((r) => approvalKind(r.approvalStatus) !== "livebreak");
    }

    /** Why the session needs no report, or null when it does: a live break, or a Co-Host whose main host reports. */
    noReportReason(s: ScheduleRow): "livebreak" | "cohost" | null {
        if (this.realReportsFor(s).length > 0) return null;
        if (s.isLiveBreak || this.reportsFor(s).length > 0) return "livebreak";
        if (s.isCoHost) return "cohost";
        return null;
    }

    /** Clock In has no ScheduleID: the shift is matched by host and business date. */
    clockFor(s: ScheduleRow): ClockRow | null {
        const rows = this.clocks.get(`${low(s.hostId)}|${s.dateKey}`) ?? [];
        return rows.find((c) => c.checkIn || c.checkInText) ?? rows[0] ?? null;
    }
}

// ---------------------------------------------------------------------------------------------
// Time of a session relative to now

export function sessionStart(s: ScheduleRow): Date | null {
    if (s.startMin === null) return null;
    const d = dateKeyToDate(s.dateKey);
    d.setMinutes(s.startMin);
    return d;
}

export function sessionEnd(s: ScheduleRow): Date | null {
    if (s.endMin === null) {
        const d = dateKeyToDate(s.dateKey);
        d.setDate(d.getDate() + 1);
        return d;
    }
    const d = dateKeyToDate(s.dateKey);
    d.setMinutes(s.endMin);
    return d;
}

export type Phase = "upcoming" | "live" | "ended";

export function phaseOf(s: ScheduleRow, now: Date): Phase {
    const st = sessionStart(s);
    const en = sessionEnd(s);
    if (st && now < st) return "upcoming";
    if (en && now < en) return st ? "live" : "upcoming";
    return "ended";
}

export const hoursOf = (s: ScheduleRow): number =>
    s.startMin !== null && s.endMin !== null ? (s.endMin - s.startMin) / 60 : s.jamLive || 0;

// ---------------------------------------------------------------------------------------------
// Weeks (Monday first)

export function weekStart(dateKey: string): string {
    const d = dateKeyToDate(dateKey);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return toDateKey(d);
}

export function rangeKeys(from: string, to: string): string[] {
    const out: string[] = [];
    for (let k = from; k <= to && out.length < 400; k = shiftDay(k, 1)) out.push(k);
    return out;
}

// ---------------------------------------------------------------------------------------------
// Filters

export interface Filters {
    from: string;
    to: string;
    brandId: string;
    hostId: string;
    studioId: string;
    platform: string;
    status: string;
    q: string;
    only: "" | "conflict" | "noreport";
}

export const hasActiveFilter = (f: Filters): boolean => !!(f.brandId || f.hostId || f.studioId || f.platform || f.status || f.q.trim() || f.only);

export function applyFilters(rows: ScheduleRow[], f: Filters, extra: { conflicts: Map<string, Conflict[]>; missingReport: (s: ScheduleRow) => boolean }): ScheduleRow[] {
    const q = low(f.q);
    return rows.filter((s) => {
        if (s.dateKey < f.from || s.dateKey > f.to) return false;
        if (f.brandId && low(s.brandId) !== low(f.brandId)) return false;
        if (f.hostId && low(s.hostId) !== low(f.hostId)) return false;
        if (f.studioId && low(s.studioId) !== low(f.studioId)) return false;
        if (f.platform && low(s.platform) !== low(f.platform)) return false;
        if (f.status && low(s.status) !== low(f.status)) return false;
        if (f.only === "conflict" && !extra.conflicts.has(s.key)) return false;
        if (f.only === "noreport" && !extra.missingReport(s)) return false;
        if (q) {
            const hay = [s.scheduleId, s.brandName, s.brandId, s.hostName, s.hostId, s.studioId, s.accountName, s.accountId, s.campaignName, s.platform].join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

export const sortSessions = (a: ScheduleRow, b: ScheduleRow): number =>
    a.dateKey.localeCompare(b.dateKey) || (a.startMin ?? 9999) - (b.startMin ?? 9999) || a.studioId.localeCompare(b.studioId) || a.scheduleId.localeCompare(b.scheduleId);

/** Distinct non-empty values, case-insensitively, first spelling wins. */
export function distinct(values: string[]): string[] {
    const m = new Map<string, string>();
    for (const v of values) {
        const t = v.trim();
        if (t && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t);
    }
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
}
