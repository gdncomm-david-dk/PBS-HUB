// Reads rows from a PCF dataset or from a JSON fallback string and maps them to the DESIGN.md row shapes.
// Column lookup is tolerant: internal name, display name and alias all match, case-insensitively,
// because SharePoint internal names drift from display names (see the v2 data contract §2).

import { AbsenceRow, AccountRow, BrandRow, ClockRow, EvidenceRow, HostRow, ModuleContext, ReportRow, ScheduleRow, StudioRow } from "./types";
import { parseDateKey, parseTimeToMinutes } from "./time";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

export interface RawRecord {
    id: string;
    get(names: readonly string[]): unknown;
}

const norm = (s: string): string => s.toLowerCase().replace(/[\s_\-()]/g, "");

/** Flattens SharePoint complex values: Choice {Value}, Person {DisplayName}, Lookup {Value}, arrays. */
export function flatten(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (Array.isArray(v)) {
        const parts = v.map(flatten).filter((x) => x !== null && x !== "");
        if (parts.length === 0) return null;
        return parts.length === 1 ? parts[0] : parts.map(String).join(", ");
    }
    if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        for (const k of ["Value", "value", "DisplayName", "displayName", "name", "Name", "Title"]) {
            if (o[k] !== undefined && o[k] !== null) return flatten(o[k]);
        }
        return null;
    }
    return v;
}

export function toText(v: unknown): string {
    const f = flatten(v);
    if (f === null || f === undefined) return "";
    if (f instanceof Date) return f.toISOString();
    return String(f).trim();
}

export function toNum(v: unknown): number | null {
    const f = flatten(v);
    if (f === null || f === undefined || f === "") return null;
    if (typeof f === "number") return isFinite(f) ? f : null;
    if (typeof f === "boolean") return f ? 1 : 0;
    let s = String(f).trim().replace(/\s/g, "");
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    const n = Number(s);
    return isFinite(n) ? n : null;
}

export function toBool(v: unknown, fallback: boolean): boolean {
    const f = flatten(v);
    if (f === null || f === undefined || f === "") return fallback;
    if (typeof f === "boolean") return f;
    if (typeof f === "number") return f !== 0;
    const s = String(f).trim().toLowerCase();
    if (["true", "yes", "ya", "1", "aktif", "active", "on"].includes(s)) return true;
    if (["false", "no", "tidak", "0", "nonaktif", "inactive", "off"].includes(s)) return false;
    return fallback;
}

// ---------------------------------------------------------------------------------------------
// Sources

function isBound(ds: DataSet | undefined): ds is DataSet {
    return !!ds && Array.isArray(ds.sortedRecordIds);
}

export function datasetRecords(ds: DataSet | undefined): RawRecord[] {
    if (!isBound(ds)) return [];
    const colMap = new Map<string, string>();
    for (const c of ds.columns ?? []) {
        for (const label of [c.name, c.displayName, c.alias]) {
            if (label && !colMap.has(norm(label))) colMap.set(norm(label), c.name);
        }
    }
    return ds.sortedRecordIds.map((id) => {
        const rec = ds.records[id];
        return {
            id,
            get(names: readonly string[]): unknown {
                for (const n of names) {
                    const col = colMap.get(norm(n)) ?? n;
                    let v: unknown = null;
                    try {
                        v = rec.getValue(col);
                    } catch {
                        v = null;
                    }
                    if (v === null || v === undefined || v === "") {
                        try {
                            v = rec.getFormattedValue(col);
                        } catch {
                            v = null;
                        }
                    }
                    if (v !== null && v !== undefined && v !== "") return v;
                }
                return null;
            },
        };
    });
}

export function jsonRecords(raw: string | null | undefined): RawRecord[] | null {
    if (!raw || !raw.trim()) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    return parsed
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o, i) => {
            const keys = new Map<string, string>();
            for (const k of Object.keys(o)) if (!keys.has(norm(k))) keys.set(norm(k), k);
            return {
                id: `json-${i}`,
                get(names: readonly string[]): unknown {
                    for (const n of names) {
                        const k = keys.get(norm(n));
                        if (k !== undefined) {
                            const v = o[k];
                            if (v !== null && v !== undefined && v !== "") return v;
                        }
                    }
                    return null;
                },
            };
        });
}

/** JSON wins when it is non-empty; otherwise the dataset is used. */
export function pickSource(ds: DataSet | undefined, json: string | null | undefined): RawRecord[] {
    return jsonRecords(json) ?? datasetRecords(ds);
}

export function isLoading(ds: DataSet | undefined, json: string | null | undefined): boolean {
    if (jsonRecords(json)) return false;
    return !!ds && ds.loading === true;
}

// ---------------------------------------------------------------------------------------------
// Column names per list (DESIGN.md), with the common variants seen in v1.

export const C = {
    id: ["ID", "Id", "itemId"],
    title: ["Title"],
    status: ["Status"],
    date: ["Date", "Tanggal"],
    brandId: ["BrandID", "Brand ID"],
    studioId: ["StudioID", "Studio ID"],
    hostId: ["HostID", "Host ID"],
    account: ["Account", "AccountID", "Account ID"],
    startTime: ["StartTime", "Start Time", "JamMulai"],
    endTime: ["EndTime", "End Time", "JamSelesai"],
    jamLive: ["JamLive", "TotalLiveTime"],
    platform: ["Platform"],
    shift: ["Shift"],
    sesi: ["Sesi"],
    position: ["Position", "Posisi"],
    liveBreak: ["LiveBreak", "Live Break"],
    campaign: ["CampaignName", "Campaign"],
    totalAccount: ["TotalAccount", "Total Account"],
    namaBrand: ["NamaBrand", "BrandName"],
    namaStudio: ["NamaStudio", "Nama Studio", "StudioName"],
    kapasitas: ["KapasitasHost", "Kapasitas Host", "Kapasitas"],
    namaHost: ["NamaHost", "HostName", "HostCode"],
    accountName: ["AccountName", "Account Name"],
    accountBrand: ["BrandID", "Brand ID", "Brand"],
    scheduleId: ["ScheduleID", "Schedule ID"],
    liveDate: ["LiveDate", "Live Date", "Date"],
    durasi: ["Durasi_x0028_Min_x0029_0", "Durasi_x0028_Min_x0029_", "Durasi(Min)", "Durasi (Min)", "Durasi"],
} as const;

const INACTIVE_STATUS = /(non.?aktif|inactive|tidak aktif|closed|tutup|disabled|nonactive|resign|keluar)/i;

export function isActiveStatus(status: string): boolean {
    if (!status) return true;
    return !INACTIVE_STATUS.test(status);
}

const EXCLUDED_SCHEDULE_STATUS = /(cancel|batal|leave|cuti)/i;

/** Cancelled and Leave sessions free the host and the studio. */
export function occupies(status: string): boolean {
    return !EXCLUDED_SCHEDULE_STATUS.test(status);
}

const uniqueKey = (seen: Set<string>, id: string, recId: string): string => {
    const k = seen.has(id) ? `${id}#${recId}` : id;
    seen.add(id);
    return k;
};

export function mapBrands(recs: RawRecord[]): BrandRow[] {
    const seen = new Set<string>();
    const out: BrandRow[] = [];
    for (const r of recs) {
        const brandId = toText(r.get(C.title));
        if (!brandId) continue;
        const status = toText(r.get(C.status));
        out.push({ key: uniqueKey(seen, brandId, r.id), itemId: toNum(r.get(C.id)), brandId, namaBrand: toText(r.get(C.namaBrand)) || brandId, status, isActive: isActiveStatus(status) });
    }
    return out;
}

export function mapAccounts(recs: RawRecord[]): AccountRow[] {
    const seen = new Set<string>();
    const out: AccountRow[] = [];
    for (const r of recs) {
        const accountId = toText(r.get(C.title));
        if (!accountId) continue;
        out.push({
            key: uniqueKey(seen, accountId, r.id),
            itemId: toNum(r.get(C.id)),
            accountId,
            accountName: toText(r.get(C.accountName)) || accountId,
            brandId: toText(r.get(C.accountBrand)),
            platform: toText(r.get(C.platform)),
        });
    }
    return out;
}

export function mapStudios(recs: RawRecord[]): StudioRow[] {
    const seen = new Set<string>();
    const out: StudioRow[] = [];
    for (const r of recs) {
        const studioId = toText(r.get(C.title)) || toText(r.get(C.studioId));
        if (!studioId) continue;
        const status = toText(r.get(C.status));
        out.push({
            key: uniqueKey(seen, studioId, r.id),
            itemId: toNum(r.get(C.id)),
            studioId,
            namaStudio: toText(r.get(C.namaStudio)),
            kapasitasHost: Math.max(0, Math.round(toNum(r.get(C.kapasitas)) ?? 0)),
            status,
            isActive: isActiveStatus(status),
        });
    }
    return out;
}

export function mapHosts(recs: RawRecord[]): HostRow[] {
    const seen = new Set<string>();
    const out: HostRow[] = [];
    for (const r of recs) {
        const hostId = toText(r.get(C.title));
        if (!hostId) continue;
        const status = toText(r.get(C.status));
        out.push({ key: uniqueKey(seen, hostId, r.id), itemId: toNum(r.get(C.id)), hostId, name: toText(r.get(C.namaHost)) || hostId, status, isActive: isActiveStatus(status) });
    }
    return out;
}

export interface Lookups {
    brands: Map<string, BrandRow>;
    hosts: Map<string, HostRow>;
    studios: Map<string, StudioRow>;
    accounts: Map<string, AccountRow>;
}

const byLower = <T>(rows: T[], id: (r: T) => string): Map<string, T> => {
    const m = new Map<string, T>();
    for (const r of rows) {
        const k = id(r).toLowerCase();
        if (k && !m.has(k)) m.set(k, r);
    }
    return m;
};

export function buildLookups(brands: BrandRow[], hosts: HostRow[], studios: StudioRow[], accounts: AccountRow[]): Lookups {
    return {
        brands: byLower(brands, (b) => b.brandId),
        hosts: byLower(hosts, (h) => h.hostId),
        studios: byLower(studios, (s) => s.studioId),
        accounts: byLower(accounts, (a) => a.accountId),
    };
}

export function mapSchedules(recs: RawRecord[], lk: Lookups): ScheduleRow[] {
    const out: ScheduleRow[] = [];
    for (const r of recs) {
        const dateKey = parseDateKey(r.get(C.date));
        if (!dateKey) continue;
        const brandId = toText(r.get(C.brandId));
        const hostId = toText(r.get(C.hostId));
        const accountId = toText(r.get(C.account));
        const startRaw = r.get(C.startTime);
        const endRaw = r.get(C.endTime);
        const startMin = parseTimeToMinutes(flatten(startRaw));
        let endMin = parseTimeToMinutes(flatten(endRaw));
        const jamLive = toNum(r.get(C.jamLive)) ?? 0;
        if (startMin !== null && endMin === null && jamLive > 0) endMin = startMin + Math.round(jamLive * 60);
        if (startMin !== null && endMin !== null && endMin <= startMin) endMin += 1440; // overnight session
        out.push({
            key: r.id,
            itemId: toNum(r.get(C.id)),
            scheduleId: toText(r.get(C.title)),
            dateKey,
            brandId,
            brandName: lk.brands.get(brandId.toLowerCase())?.namaBrand || toText(r.get(["BrandName", "NamaBrand"])) || brandId,
            studioId: toText(r.get(C.studioId)),
            hostId,
            hostName: lk.hosts.get(hostId.toLowerCase())?.name || toText(r.get(["HostName", "NamaHost"])) || hostId,
            accountId,
            accountName: lk.accounts.get(accountId.toLowerCase())?.accountName || accountId,
            platform: toText(r.get(C.platform)),
            shift: toText(r.get(C.shift)),
            sesi: toText(r.get(C.sesi)),
            position: toText(r.get(C.position)),
            liveBreak: toText(r.get(C.liveBreak)),
            campaignName: toText(r.get(C.campaign)),
            totalAccount: toNum(r.get(C.totalAccount)),
            status: toText(r.get(C.status)),
            startMin,
            endMin,
            jamLive,
            startText: toText(startRaw),
            endText: toText(endRaw),
        });
    }
    return out;
}

export function mapReports(recs: RawRecord[]): ReportRow[] {
    const out: ReportRow[] = [];
    const seen = new Set<string>();
    for (const r of recs) {
        const scheduleId = toText(r.get(C.scheduleId));
        if (!scheduleId) continue;
        const reportId = toText(r.get(C.title));
        if (reportId && seen.has(reportId.toLowerCase())) continue;
        if (reportId) seen.add(reportId.toLowerCase());
        out.push({
            key: r.id,
            reportId,
            scheduleId,
            hostId: toText(r.get(C.hostId)),
            accountId: toText(r.get(["AccountID", "Account ID", "Account"])),
            platform: toText(r.get(C.platform)),
            dateKey: parseDateKey(r.get(C.liveDate)),
            penjualan: toNum(r.get(["Penjualan", "GMV"])),
            pesanan: toNum(r.get(["Pesanan"])),
            totalViewer: toNum(r.get(["TotalViewer", "Total Viewer"])),
            durasiMin: toNum(r.get(C.durasi)),
            approvalStatus: toText(r.get(["ApprovalStatus", "Approval Status"])),
            match: toText(r.get(["Match"])),
            approvalComment: toText(r.get(["ApprovalComment", "Approval Comment"])),
            createdText: toText(r.get(["CreatedDate", "Created"])),
        });
    }
    return out;
}

export function mapAbsences(recs: RawRecord[]): AbsenceRow[] {
    const out: AbsenceRow[] = [];
    for (const r of recs) {
        const scheduleId = toText(r.get(C.scheduleId));
        if (!scheduleId) continue;
        out.push({
            key: r.id,
            absId: toText(r.get(C.title)),
            scheduleId,
            hostId: toText(r.get(C.hostId)),
            status: toText(r.get(C.status)),
            keterangan: toText(r.get(["Keterangan"])),
            dateKey: parseDateKey(r.get(C.liveDate)),
        });
    }
    return out;
}

const toDate = (v: unknown): Date | null => {
    const f = flatten(v);
    if (f instanceof Date) return isNaN(f.getTime()) ? null : f;
    if (typeof f === "string" && /^\d{4}-\d{2}-\d{2}T/.test(f)) {
        const d = new Date(f);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};

/** Clock In. Only the columns the timeline needs; never bind the GPS or selfie columns. */
export function mapClockIns(recs: RawRecord[]): ClockRow[] {
    const out: ClockRow[] = [];
    for (const r of recs) {
        const checkInRaw = r.get(["CheckInTime", "Check In Time"]);
        const checkOutRaw = r.get(["CheckOutTime", "Check Out Time"]);
        const checkIn = toDate(checkInRaw);
        const dateKey = parseDateKey(r.get(["ClockInDate", "Clock In Date"])) || (checkIn ? parseDateKey(checkIn) : "");
        if (!dateKey) continue;
        const insideRaw = flatten(r.get(["IsInsideGeofence", "Is Inside Geofence"]));
        out.push({
            key: r.id,
            title: toText(r.get(C.title)),
            hostId: toText(r.get(C.hostId)),
            email: toText(r.get(["EmployeeEmail", "Employee Email"])),
            dateKey,
            checkIn,
            checkInText: toText(r.get(["ClockInTime", "Clock In Time"])) || (checkIn ? "" : toText(checkInRaw)),
            checkOut: toDate(checkOutRaw),
            checkOutText: toText(r.get(["ClockOutTime", "Clock Out Time"])) || toText(checkOutRaw),
            inside: insideRaw === null || insideRaw === "" ? null : toBool(insideRaw, true),
            office: toText(r.get(["CheckInOffice", "Check In Office"])),
            status: toText(r.get(["Status", "StatusAbsence"])),
        });
    }
    return out;
}

export function mapEvidence(recs: RawRecord[]): EvidenceRow[] {
    const out: EvidenceRow[] = [];
    for (const r of recs) {
        const scheduleId = toText(r.get(C.scheduleId));
        if (!scheduleId) continue;
        out.push({
            key: r.id,
            title: toText(r.get(C.title)),
            scheduleId,
            status: toText(r.get(C.status)),
            penjualan: toNum(r.get(["Penjualan"])),
            startHour: toText(r.get(["StartHour", "Start Hour"])),
            endHour: toText(r.get(["EndHour", "End Hour"])),
        });
    }
    return out;
}


// ---------------------------------------------------------------------------------------------
// Context

export const EMPTY_CONTEXT: ModuleContext = { userEmail: "", userName: "", roles: [], permissions: [], config: {} };

const list = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(flatten).filter((x): x is string => typeof x === "string" && !!x.trim()).map((s) => s.trim());
    if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
};

export function parseContext(raw: string | null | undefined): ModuleContext {
    if (!raw || !raw.trim()) return EMPTY_CONTEXT;
    try {
        const o = JSON.parse(raw) as unknown;
        if (!o || typeof o !== "object" || Array.isArray(o)) return EMPTY_CONTEXT;
        const r = o as Record<string, unknown>;
        return {
            userEmail: typeof r.userEmail === "string" ? r.userEmail : "",
            userName: typeof r.userName === "string" ? r.userName : "",
            roles: list(r.roles),
            permissions: list(r.permissions),
            config: r.config && typeof r.config === "object" && !Array.isArray(r.config) ? (r.config as Record<string, unknown>) : {},
        };
    } catch {
        return EMPTY_CONTEXT;
    }
}
