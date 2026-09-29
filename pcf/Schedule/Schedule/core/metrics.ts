// Every numeric column of a Report / Report Automation row, so the comparison is not limited to the
// columns the control knows by name. Columns are paired across the two lists by a normalised name.

import { Metric } from "./types";

/** "Durasi_x0028_Min_x0029_0" → "durasimin0", "Total Viewer" → "totalviewer". */
export function metricKey(name: string): string {
    return name
        .replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/** Identity, lookup, status, date and SharePoint system columns: never a metric. */
const NOT_METRIC = new Set([
    "id", "title", "scheduleid", "reportid", "accountid", "account", "hostid", "brandid", "studioid", "platform",
    "status", "approvalstatus", "match", "approvalcomment", "approveremail", "attachment", "attachments", "lampiran",
    "livedate", "date", "tanggal", "created", "modified", "createddate", "author", "editor", "createdby", "modifiedby",
    "contenttype", "contenttypeid", "version", "uiversionstring", "owshiddenversion", "itemtype", "path", "filename",
    "name", "link", "identifier", "thumbnail", "starthour", "endhour", "starttime", "endtime", "livebreak",
    "keterangan", "comment", "complianceassetid", "appauthor", "appeditor", "guid", "uniqueid", "fsobjtype",
    "folderchildcount", "itemchildcount", "position", "shift", "sesi",
]);

/** Columns the fixed comparison lines already cover. */
export const KNOWN_METRIC = (key: string): boolean =>
    key === "penjualan" || key === "gmv" || key === "pesanan" || key === "totalviewer" || key.startsWith("durasi");

const flat = (v: unknown): unknown => (v && typeof v === "object" && !(v instanceof Date) && "Value" in (v as Record<string, unknown>) ? (v as Record<string, unknown>).Value : v);

function asNumber(v: unknown): number | null {
    const f = flat(v);
    if (typeof f === "number") return isFinite(f) ? f : null;
    if (typeof f !== "string") return null;
    const s = f.trim().replace(/\s/g, "");
    if (!/^-?\d+([.,]\d+)*$/.test(s)) return null;
    // 1.234.567 / 1,234,567 are thousands; a single , or . with 1–2 decimals is a decimal mark.
    const n = /^-?\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, "")) : Number(s.replace(",", "."));
    return isFinite(n) ? n : null;
}

/**
 * Columns shown under another name. The lists call the same number differently, so both names share one
 * key and are compared on one line.
 */
const ALIAS: Record<string, { key: string; label: string }> = {
    peakviewer: { key: "avgviewduration", label: "Avg View Duration" },
    peakviewers: { key: "avgviewduration", label: "Avg View Duration" },
    avgviewduration: { key: "avgviewduration", label: "Avg View Duration" },
    averageviewduration: { key: "avgviewduration", label: "Avg View Duration" },
};

export function metricsFrom(fields: { label: string; value: unknown }[]): Metric[] {
    const out: Metric[] = [];
    const seen = new Set<string>();
    for (const f of fields) {
        if (/^[{@_]|^odata/i.test(f.label)) continue;
        const raw = metricKey(f.label);
        const alias = ALIAS[raw];
        const key = alias?.key ?? raw;
        if (!key || seen.has(key) || NOT_METRIC.has(raw) || raw.endsWith("id")) continue;
        const value = asNumber(f.value);
        if (value === null) continue;
        seen.add(key);
        out.push({ key, label: alias?.label ?? f.label.replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/_/g, " ").trim(), value });
    }
    return out;
}

/** Money columns are shown in Rupiah. */
export const isMoney = (key: string): boolean => /penjualan|gmv|omzet|omset|revenue|sales|nilai|rupiah|harga|price|komisi|biaya/.test(key);
