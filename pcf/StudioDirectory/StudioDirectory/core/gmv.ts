// GMV per studio. Report - PBS Hub has no StudioID (DESIGN.md), so a report is attributed to a studio
// through Report.ScheduleID → Schedule.Title → Schedule.StudioID. A session can carry several reports
// (one per streamed account), so a session's GMV is the sum of its reports.
//
// Report.Penjualan is the host-submitted claim. It is split by ApprovalStatus so the page never
// presents unreviewed numbers as verified. Display only — nothing that money depends on is computed here.

import { ReportRow, ScheduleRow, StudioRow } from "./types";
import { isLiveBreakText, occupiesStudio } from "./data";
import { monthDateKeys } from "./time";
import { ScheduleIndex } from "./utilization";

/** liveBreak: the session is a live break (ApprovalStatus = LiveBreak), so no report is expected. */
export type ReportState = "verified" | "pending" | "revision" | "missing" | "notDue" | "liveBreak" | "coHost";

export class ReportIndex {
    private bySchedule = new Map<string, ReportRow[]>();

    constructor(rows: ReportRow[]) {
        for (const r of rows) {
            const k = r.scheduleId.toLowerCase();
            const list = this.bySchedule.get(k);
            if (list) list.push(r);
            else this.bySchedule.set(k, [r]);
        }
    }

    forSchedule(scheduleId: string): ReportRow[] {
        return scheduleId ? this.bySchedule.get(scheduleId.toLowerCase()) ?? [] : [];
    }

    get size(): number {
        return this.bySchedule.size;
    }
}

export function approvalState(status: string): "verified" | "pending" | "revision" {
    const l = status.toLowerCase();
    if (l === "done" || l === "approved") return "verified";
    if (l.includes("revis")) return "revision";
    return "pending";
}

/** Whether the session has ended, so a missing report is overdue rather than not yet due. */
export function sessionEnded(s: ScheduleRow, todayKey: string, nowMin: number): boolean {
    if (s.dateKey < todayKey) return true;
    if (s.dateKey > todayKey) return false;
    return s.endMin !== null ? s.endMin <= nowMin : false;
}

export interface SessionGmv {
    gmv: number;
    reports: ReportRow[];
    state: ReportState;
}

export function sessionGmv(reports: ReportIndex, s: ScheduleRow, todayKey: string, nowMin: number): SessionGmv {
    const rs = reports.forSchedule(s.scheduleId);
    const gmv = rs.reduce((t, r) => t + r.penjualan, 0);
    let state: ReportState;
    // Report rows with ApprovalStatus = LiveBreak are placeholders for a break, not a submitted report.
    const real = rs.filter((r) => !isLiveBreakText(r.approvalStatus));
    if (real.length === 0 && (s.liveBreak || rs.length > 0)) state = "liveBreak";
    else if (real.length === 0 && s.coHost) state = "coHost";
    else if (real.length === 0) state = occupiesStudio(s.status) && sessionEnded(s, todayKey, nowMin) ? "missing" : "notDue";
    else {
        const states = real.map((r) => approvalState(r.approvalStatus));
        state = states.includes("revision") ? "revision" : states.every((x) => x === "verified") ? "verified" : "pending";
    }
    return { gmv, reports: rs, state };
}

export interface BrandGmv {
    brandId: string;
    brandName: string;
    gmv: number;
    sessions: number;
}

export interface StudioGmv {
    total: number;
    verified: number;
    pending: number;         // Waiting Approval or no status yet
    revision: number;        // Need Revision
    sessions: number;        // sessions that occupy the studio in the month
    reportedSessions: number;
    missingReports: number;  // ended sessions with no report
    liveBreaks: number;      // live-break and Co-Host sessions (no report expected)
    liveHours: number;       // hours of the sessions that have a report
    perSession: number | null;
    perHour: number | null;
    byBrand: BrandGmv[];
}

export function studioGmv(
    idx: ScheduleIndex,
    reports: ReportIndex,
    studio: StudioRow,
    monthKey: string,
    todayKey: string,
    nowMin: number,
): StudioGmv {
    const res: StudioGmv = {
        total: 0, verified: 0, pending: 0, revision: 0, sessions: 0, reportedSessions: 0,
        missingReports: 0, liveBreaks: 0, liveHours: 0, perSession: null, perHour: null, byBrand: [],
    };
    const brands = new Map<string, BrandGmv>();
    for (const d of monthDateKeys(monthKey)) {
        for (const s of idx.day(studio.studioId, d)) {
            if (!occupiesStudio(s.status)) continue;
            res.sessions++;
            const g = sessionGmv(reports, s, todayKey, nowMin);
            if (g.state === "missing") res.missingReports++;
            if (g.state === "liveBreak" || g.state === "coHost") {
                res.liveBreaks++;   // no report expected, and no sales to count
                continue;
            }
            if (g.reports.length === 0) continue;
            res.reportedSessions++;
            res.liveHours += s.startMin !== null && s.endMin !== null ? (s.endMin - s.startMin) / 60 : s.jamLive;
            for (const r of g.reports) {
                res.total += r.penjualan;
                const st = approvalState(r.approvalStatus);
                if (st === "verified") res.verified += r.penjualan;
                else if (st === "revision") res.revision += r.penjualan;
                else res.pending += r.penjualan;
            }
            const bk = (s.brandId || s.brandName).toLowerCase();
            const b = brands.get(bk) ?? { brandId: s.brandId, brandName: s.brandName || s.brandId || "—", gmv: 0, sessions: 0 };
            b.gmv += g.gmv;
            b.sessions++;
            brands.set(bk, b);
        }
    }
    res.perSession = res.reportedSessions ? res.total / res.reportedSessions : null;
    res.perHour = res.liveHours > 0 ? res.total / res.liveHours : null;
    res.byBrand = Array.from(brands.values()).sort((a, b) => b.gmv - a.gmv);
    return res;
}

export function studioDailyGmv(
    idx: ScheduleIndex,
    reports: ReportIndex,
    studio: StudioRow,
    monthKey: string,
): { dateKey: string; gmv: number }[] {
    return monthDateKeys(monthKey).map((dateKey) => ({
        dateKey,
        gmv: idx
            .day(studio.studioId, dateKey)
            .filter((s) => occupiesStudio(s.status))
            .reduce((t, s) => t + reports.forSchedule(s.scheduleId).reduce((u, r) => u + r.penjualan, 0), 0),
    }));
}

// ---------------------------------------------------------------------------------------------

const group = (n: number): string => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Rp 4.820.000 */
export function formatIdr(n: number): string {
    return `${n < 0 ? "-" : ""}Rp ${group(n)}`;
}

/** Rp 4,8 jt · Rp 1,2 M · Rp 820 rb */
export function formatIdrShort(n: number): string {
    const a = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    const one = (v: number): string => (Math.round(v * 10) / 10).toString().replace(".", ",");
    if (a >= 1e9) return `${sign}Rp ${one(a / 1e9)} M`;
    if (a >= 1e6) return `${sign}Rp ${one(a / 1e6)} jt`;
    if (a >= 1e3) return `${sign}Rp ${Math.round(a / 1e3)} rb`;
    return `${sign}Rp ${group(a)}`;
}
