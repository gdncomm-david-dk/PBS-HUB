// Reads rows from a PCF dataset or from a JSON fallback string and maps them to the DESIGN.md row shapes.
// Column lookup is tolerant: internal name, display name and alias all match, case-insensitively,
// because SharePoint internal names drift from display names (see the v2 data contract §2).

import { LocationRow, ModuleContext, ReportRow, ScheduleRow, StudioRow } from "./types";
import { parseDateKey, parseTimeToMinutes } from "./time";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

export interface RawRecord {
    id: string;
    get(names: readonly string[]): unknown;
    /** Every value the record carries, whatever its column name. */
    values?(): unknown[];
}

// SharePoint encodes spaces and symbols in internal names (Location_x0020_ID); decode before comparing.
const norm = (s: string): string =>
    s
        .replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .toLowerCase()
        .replace(/[\s_\-()]/g, "");

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
            values(): unknown[] {
                return (ds.columns ?? []).map((c) => {
                    try {
                        const v = rec.getValue(c.name);
                        return v === null || v === undefined || v === "" ? rec.getFormattedValue(c.name) : v;
                    } catch {
                        return null;
                    }
                });
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
                values: (): unknown[] => Object.values(o),
            };
        });
}

/** Column names the source actually carries (JSON keys, or the dataset columns added in Fields). */
export function sourceColumns(ds: DataSet | undefined, json: string | null | undefined): { from: "json" | "dataset" | "none"; columns: string[] } {
    if (json && json.trim()) {
        try {
            const parsed: unknown = JSON.parse(json);
            if (Array.isArray(parsed)) {
                const keys = new Set<string>();
                for (const o of parsed.slice(0, 50)) if (o && typeof o === "object") Object.keys(o as object).forEach((k) => keys.add(k));
                return { from: "json", columns: Array.from(keys) };
            }
        } catch {
            /* fall through to the dataset */
        }
    }
    if (!isBound(ds)) return { from: "none", columns: [] };
    return { from: "dataset", columns: (ds.columns ?? []).map((c) => c.name) };
}

/** True when one of the columns answers to the LocationID aliases. */
export const hasLocationColumn = (columns: string[]): boolean => columns.some((c) => (C.locationId as readonly string[]).some((a) => norm(a) === norm(c)));

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

const C = {
    id: ["ID", "Id", "itemId"],
    title: ["Title"],
    studioId: ["StudioID", "Studio ID", "Studio"],
    namaStudio: ["NamaStudio", "Nama Studio", "StudioName"],
    kapasitas: ["KapasitasHost", "Kapasitas Host", "Kapasitas"],
    lokasi: ["LokasiStudio", "Lokasi Studio", "Lokasi"],
    status: ["Status"],
    latitude: ["Latitude", "Lat"],
    longitude: ["Longitude", "Lon", "Lng"],
    radius: ["RadiusMeter", "Radius Meter", "Radius"],
    isActive: ["IsActive", "Is Active", "Active"],
    locationId: ["LocationID", "Location ID", "LocationId", "LocationID0", "Location", "StudioLocation", "Studio Location"],
    date: ["Date", "LiveDate", "Tanggal"],
    brandId: ["BrandID", "Brand ID"],
    hostId: ["HostID", "Host ID"],
    startTime: ["StartTime", "Start Time", "JamMulai"],
    endTime: ["EndTime", "End Time", "JamSelesai"],
    jamLive: ["JamLive", "TotalLiveTime"],
    platform: ["Platform"],
    account: ["Account", "AccountName"],
    shift: ["Shift"],
    campaign: ["CampaignName", "Campaign"],
    brandName: ["BrandName", "NamaBrand", "Brand"],
    hostName: ["NamaHost", "HostName", "Host"],
    namaBrand: ["NamaBrand", "BrandName"],
    namaHost: ["NamaHost", "HostName", "HostCode"],
} as const;

const INACTIVE_STATUS = /(non.?aktif|inactive|tidak aktif|closed|tutup|disabled|nonactive)/i;

export function isActiveStatus(status: string): boolean {
    if (!status) return true;
    return !INACTIVE_STATUS.test(status);
}

const LIVE_BREAK = /live\s*-?_?break/i;

/** A live-break value: "LiveBreak", "Live Break", "live_break". */
export const isLiveBreakText = (v: string): boolean => LIVE_BREAK.test(v);

const LIVE_BREAK_VALUE = /^\s*live\s*-?_?break\s*$/i;

/**
 * A schedule is a live break when its LiveBreak choice is Yes, when ApprovalStatus / Status says so, or
 * when any of its columns holds exactly "LiveBreak". Its report, if any, carries ApprovalStatus = LiveBreak.
 */
export function isLiveBreakRecord(r: RawRecord): boolean {
    if (isLiveBreakText(toText(r.get(["ApprovalStatus", "Approval Status", "Status"])))) return true;
    if (toBool(r.get(["LiveBreak", "Live Break", "IsLiveBreak"]), false)) return true;
    return (r.values?.() ?? []).some((v) => LIVE_BREAK_VALUE.test(toText(v)));
}

/** True when the source carries a column named like one of the given names. */
export const hasColumn = (columns: string[], names: string[]): boolean => columns.some((c) => names.some((n) => norm(n) === norm(c)));

const EXCLUDED_SCHEDULE_STATUS = /(cancel|batal|leave|cuti)/i;

/** Cancelled and Leave sessions do not occupy the studio. */
export function occupiesStudio(status: string): boolean {
    return !EXCLUDED_SCHEDULE_STATUS.test(status);
}

/**
 * A SharePoint lookup arrives as { Id, Value } (canvas JSON), as an EntityReference { id: { guid }, name }
 * (PCF dataset), or as plain text. Returns the shown value and the looked-up item ID when present.
 */
export function readLookup(v: unknown): { text: string; id: number | null } {
    if (v === null || v === undefined || v === "") return { text: "", id: null };
    if (Array.isArray(v)) return v.length ? readLookup(v[0]) : { text: "", id: null };
    if (typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>;
        const rawId = o.Id ?? o.ID ?? o.LookupId ?? o.lookupId ?? (o.id && typeof o.id === "object" ? (o.id as Record<string, unknown>).guid : o.id);
        const id = toNum(rawId);
        const text = toText(o.Value ?? o.value ?? o.LookupValue ?? o.name ?? o.Name ?? o.DisplayName ?? "");
        return { text, id: id !== null && Number.isInteger(id) && id > 0 ? id : null };
    }
    return { text: toText(v), id: null };
}

export function mapStudios(recs: RawRecord[]): StudioRow[] {
    const out: StudioRow[] = [];
    const seen = new Set<string>();
    for (const r of recs) {
        const studioId = toText(r.get(C.title)) || toText(r.get(C.studioId));
        if (!studioId) continue;
        const status = toText(r.get(C.status));
        const key = seen.has(studioId) ? `${studioId}#${r.id}` : studioId;
        seen.add(studioId);
        out.push({
            key,
            itemId: toNum(r.get(C.id)),
            studioId,
            namaStudio: toText(r.get(C.namaStudio)),
            kapasitasHost: Math.max(0, Math.round(toNum(r.get(C.kapasitas)) ?? 0)),
            lokasiStudio: toText(r.get(C.lokasi)),
            ...(() => {
                const lk = readLookup(r.get(C.locationId));
                const extraId = toNum(r.get(["LocationIDId", "LocationID_Id", "LocationIdLookupId"]));
                return { locationRef: lk.text, locationLookupId: lk.id ?? (extraId && extraId > 0 ? extraId : null) };
            })(),
            status,
            isActive: isActiveStatus(status),
        });
    }
    return out;
}

export function mapLocations(recs: RawRecord[]): LocationRow[] {
    return recs.map((r) => ({
        key: r.id,
        itemId: toNum(r.get(C.id)),
        title: toText(r.get(C.title)),
        locationId: toText(r.get(C.locationId)),
        studioId: toText(r.get(C.studioId)),
        latitude: toNum(r.get(C.latitude)),
        longitude: toNum(r.get(C.longitude)),
        radiusMeter: toNum(r.get(C.radius)),
        isActive: toBool(r.get(C.isActive), true),
    }));
}

export function buildNameMap(recs: RawRecord[], nameCols: readonly string[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of recs) {
        const id = toText(r.get(C.title));
        const name = toText(r.get(nameCols));
        if (id && name) m.set(id.toLowerCase(), name);
    }
    return m;
}

export const BRAND_NAME_COLS = C.namaBrand;
export const HOST_NAME_COLS = C.namaHost;

export function mapSchedules(
    recs: RawRecord[],
    brandNames: Map<string, string>,
    hostNames: Map<string, string>,
): ScheduleRow[] {
    const out: ScheduleRow[] = [];
    for (const r of recs) {
        const dateKey = parseDateKey(r.get(C.date));
        const studioId = toText(r.get(C.studioId));
        if (!dateKey || !studioId) continue;
        const brandId = toText(r.get(C.brandId));
        const hostId = toText(r.get(C.hostId));
        const startRaw = r.get(C.startTime);
        const endRaw = r.get(C.endTime);
        const startMin = parseTimeToMinutes(flatten(startRaw));
        let endMin = parseTimeToMinutes(flatten(endRaw));
        const jamLive = toNum(r.get(C.jamLive)) ?? 0;
        if (startMin !== null && endMin === null && jamLive > 0) endMin = startMin + Math.round(jamLive * 60);
        if (startMin !== null && endMin !== null && endMin <= startMin) endMin += 1440; // overnight session
        const projectedBrand = toText(r.get(["BrandName", "NamaBrand"]));
        const projectedHost = toText(r.get(["HostName", "NamaHost"]));
        out.push({
            key: r.id,
            itemId: toNum(r.get(C.id)),
            scheduleId: toText(r.get(C.title)),
            dateKey,
            studioId,
            brandId,
            brandName: brandNames.get(brandId.toLowerCase()) || projectedBrand || toText(r.get(C.campaign)) || brandId,
            hostId,
            hostName: hostNames.get(hostId.toLowerCase()) || projectedHost || hostId,
            platform: toText(r.get(C.platform)),
            account: toText(r.get(C.account)),
            shift: toText(r.get(C.shift)),
            campaignName: toText(r.get(C.campaign)),
            status: toText(r.get(C.status)),
            approvalStatus: toText(r.get(["ApprovalStatus", "Approval Status"])),
            liveBreak: isLiveBreakRecord(r),
            startMin,
            endMin,
            jamLive,
            startText: toText(startRaw),
            endText: toText(endRaw),
        });
    }
    return out;
}

/** Report - PBS Hub. Rows without a ScheduleID cannot be attributed to a studio and are dropped. */
export function mapReports(recs: RawRecord[]): ReportRow[] {
    const out: ReportRow[] = [];
    const seen = new Set<string>();
    for (const r of recs) {
        const scheduleId = toText(r.get(["ScheduleID", "Schedule ID"]));
        if (!scheduleId) continue;
        const reportId = toText(r.get(C.title));
        // A report row appears once; the same Title twice is a duplicate, not a second account.
        if (reportId && seen.has(reportId.toLowerCase())) continue;
        if (reportId) seen.add(reportId.toLowerCase());
        out.push({
            key: r.id,
            reportId,
            scheduleId,
            dateKey: parseDateKey(r.get(["LiveDate", "Live Date", "Date"])),
            penjualan: toNum(r.get(["Penjualan", "GMV"])) ?? 0,
            approvalStatus: toText(r.get(["ApprovalStatus", "Approval Status"])),
            match: toText(r.get(["Match"])),
            brandId: toText(r.get(C.brandId)),
        });
    }
    return out;
}

const same = (a: string, b: string): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** How a studio was matched to its location — shown in the UI so a wrong link is visible. */
export type LocationLink = "lookup" | "legacy" | "broken" | "none";

/**
 * Studio → Studio Location through the Studio.LocationID lookup: the lookup item ID when the source carries it,
 * else the shown value against Studio Location.LocationID (or Title). Studios without a LocationID fall back to
 * the v1 heuristics (a StudioID column, Title = StudioID, Title = NamaStudio). An active row wins.
 */
export function linkLocation(studio: StudioRow, locations: LocationRow[]): { loc: LocationRow | null; link: LocationLink } {
    const pick = (xs: LocationRow[]): LocationRow | null => (xs.length ? xs.find((l) => l.isActive) ?? xs[0] : null);
    if (studio.locationLookupId !== null || studio.locationRef) {
        const byId = studio.locationLookupId !== null ? locations.filter((l) => l.itemId === studio.locationLookupId) : [];
        const byKey = studio.locationRef ? locations.filter((l) => same(l.locationId, studio.locationRef)) : [];
        const byTitle = studio.locationRef ? locations.filter((l) => same(l.title, studio.locationRef)) : [];
        const loc = pick(byId) ?? pick(byKey) ?? pick(byTitle);
        return { loc, link: loc ? "lookup" : "broken" };
    }
    const tiers = [
        locations.filter((l) => same(l.studioId, studio.studioId)),
        locations.filter((l) => same(l.title, studio.studioId)),
        locations.filter((l) => same(l.title, studio.namaStudio)),
    ];
    for (const t of tiers) if (t.length) return { loc: pick(t), link: "legacy" };
    return { loc: null, link: "none" };
}

export function locationForStudio(studio: StudioRow, locations: LocationRow[]): LocationRow | null {
    return linkLocation(studio, locations).loc;
}

/** Display key of a location: its LocationID, else its Title. */
export const locationKey = (l: LocationRow): string => l.locationId || l.title;

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
