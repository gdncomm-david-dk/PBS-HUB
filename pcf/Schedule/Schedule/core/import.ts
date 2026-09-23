// Bulk-schedule preview: map the template columns, check every row against the master lists and the
// sessions already scheduled. PBS0001A itself validates nothing (DESIGN.md UC-2), so this is the only gate.

import { ScheduleRow, StudioRow } from "./types";
import { Lookups, toText } from "./data";
import { Cell, SheetTable, serialToDateKey, serialToMinutes } from "./xlsx";
import { conflictsFor, Slot } from "./schedule";
import { formatMinutes, parseDateKey, parseTimeToMinutes } from "./time";

export type Field = "date" | "brandId" | "studioId" | "hostId" | "start" | "end" | "account" | "platform" | "shift" | "jamLive" | "campaign" | "sesi" | "position";

/** Header aliases, compared without spaces, underscores, dots and case. */
export const HEADER_ALIASES: Record<Field, string[]> = {
    date: ["date", "tanggal", "livedate", "tgl", "tanggallive"],
    brandId: ["brandid", "idbrand", "kodebrand"],
    studioId: ["studioid", "idstudio", "studio", "kodestudio"],
    hostId: ["hostid", "idhost", "host", "kodehost"],
    start: ["starttime", "start", "jammulai", "mulai", "startlive"],
    end: ["endtime", "end", "jamselesai", "selesai", "endlive"],
    account: ["account", "accountid", "idaccount", "akun"],
    platform: ["platform"],
    shift: ["shift"],
    jamLive: ["jamlive", "totallivetime", "durasi", "durasijam"],
    campaign: ["brand", "campaign", "campaignname", "namabrand"],
    sesi: ["sesi", "session"],
    position: ["position", "posisi"],
};

export const REQUIRED: Field[] = ["date", "brandId", "studioId", "hostId", "start", "end"];

export const FIELD_LABEL: Record<Field, string> = {
    date: "Date",
    brandId: "BrandID",
    studioId: "StudioID",
    hostId: "HostID",
    start: "StartTime",
    end: "EndTime",
    account: "Account",
    platform: "Platform",
    shift: "Shift",
    jamLive: "JamLive",
    campaign: "Brand",
    sesi: "Sesi",
    position: "Position",
};

const norm = (s: string): string => s.toLowerCase().replace(/[\s_.\-()/]/g, "");

export function mapHeaders(headers: string[]): { map: Partial<Record<Field, number>>; missing: Field[] } {
    const map: Partial<Record<Field, number>> = {};
    const normed = headers.map(norm);
    for (const f of Object.keys(HEADER_ALIASES) as Field[]) {
        for (const alias of HEADER_ALIASES[f]) {
            const i = normed.indexOf(alias);
            if (i >= 0 && !Object.values(map).includes(i)) {
                map[f] = i;
                break;
            }
        }
    }
    return { map, missing: REQUIRED.filter((f) => map[f] === undefined) };
}

export type Verdict = "valid" | "warning" | "rejected";

export interface ImportRow {
    no: number;               // 1-based row inside the table
    excelRow: number;         // Excel row number, for the error list
    file: string;
    dateKey: string;
    brandId: string;
    brandName: string;
    studioId: string;
    hostId: string;
    hostName: string;
    accountId: string;
    platform: string;
    startMin: number | null;
    endMin: number | null;
    verdict: Verdict;
    reasons: string[];
}

export interface FileCheck {
    file: string;
    source: string;           // table or sheet read
    missing: Field[];         // required columns not found
    headers: string[];        // header row as read
    rows: ImportRow[];
    counts: { total: number; valid: number; warning: number; rejected: number };
}

const cellDate = (v: Cell): string => {
    if (typeof v === "number") return v > 20000 && v < 80000 ? serialToDateKey(v) : "";
    if (typeof v === "string") return parseDateKey(v.trim());
    return "";
};

const cellTime = (v: Cell): number | null => {
    if (typeof v === "number") return v >= 0 && v < 1 ? serialToMinutes(v) : v >= 1 && v <= 24 && Number.isInteger(v) ? v * 60 : v > 20000 ? serialToMinutes(v) : null;
    if (typeof v === "string") return parseTimeToMinutes(v);
    return null;
};

const cellText = (v: Cell): string => (v === null ? "" : typeof v === "number" ? String(v) : toText(v));

export interface CheckContext {
    lk: Lookups;
    existing: ScheduleRow[];
    todayKey: string;
    studioName: (id: string) => string;
}

export function checkFile(file: string, t: SheetTable, cx: CheckContext): FileCheck {
    const { map, missing } = mapHeaders(t.headers);
    const get = (row: Cell[], f: Field): Cell => (map[f] === undefined ? null : row[map[f] as number] ?? null);
    const rows: ImportRow[] = [];
    let no = 0;
    t.rows.forEach((cells, i) => {
        if (cells.every((c) => c === null || (typeof c === "string" && !c.trim()))) return;
        no++;
        const reasons: string[] = [];
        let rejected = false;
        const reject = (m: string): void => {
            rejected = true;
            reasons.push(m);
        };

        const dateKey = cellDate(get(cells, "date"));
        if (!dateKey) reject("Tanggal kosong atau tidak terbaca");

        const brandId = cellText(get(cells, "brandId"));
        const brand = cx.lk.brands.get(brandId.toLowerCase());
        if (!brandId) reject("BrandID kosong");
        else if (!brand) reject(`BrandID ${brandId} tidak ada di master Brand`);
        else if (!brand.isActive) reasons.push(`Brand ${brand.namaBrand} tidak aktif`);

        const studioRaw = cellText(get(cells, "studioId"));
        let studio = cx.lk.studios.get(studioRaw.toLowerCase());
        if (!studio && studioRaw) studio = Array.from(cx.lk.studios.values()).find((s) => s.namaStudio.toLowerCase() === studioRaw.toLowerCase());
        if (!studioRaw) reject("StudioID kosong");
        else if (!studio) reject(`StudioID ${studioRaw} tidak ada di master Studio`);
        else if (!studio.isActive) reasons.push(`${studio.studioId} tidak aktif`);

        const hostRaw = cellText(get(cells, "hostId"));
        let host = cx.lk.hosts.get(hostRaw.toLowerCase());
        if (!host && hostRaw) host = Array.from(cx.lk.hosts.values()).find((h) => h.name.toLowerCase() === hostRaw.toLowerCase());
        if (!hostRaw) reject("HostID kosong");
        else if (!host) reject(`HostID ${hostRaw} tidak ada di master Host`);
        else if (!host.isActive) reasons.push(`Host ${host.name} tidak aktif`);

        const startMin = cellTime(get(cells, "start"));
        let endMin = cellTime(get(cells, "end"));
        if (startMin === null) reject("Jam mulai tidak terbaca");
        if (endMin === null) reject("Jam selesai tidak terbaca");
        if (startMin !== null && endMin !== null) {
            if (endMin === startMin) reject("Jam mulai sama dengan jam selesai");
            else if (endMin < startMin) {
                endMin += 1440;
                reasons.push("Sesi melewati tengah malam");
            }
        }

        const accountId = cellText(get(cells, "account"));
        const account = accountId ? cx.lk.accounts.get(accountId.toLowerCase()) : undefined;
        if (accountId && cx.lk.accounts.size && !account) reasons.push(`Account ${accountId} tidak ada di master Account`);
        if (account && brand && account.brandId && account.brandId.toLowerCase() !== brand.brandId.toLowerCase())
            reasons.push(`Account ${account.accountName} milik brand lain (${account.brandId})`);

        if (dateKey && dateKey < cx.todayKey) reasons.push("Tanggal sudah lewat");

        rows.push({
            no,
            excelRow: t.firstRow + i,
            file,
            dateKey,
            brandId: brand?.brandId ?? brandId,
            brandName: brand?.namaBrand || cellText(get(cells, "campaign")) || brandId,
            studioId: studio?.studioId ?? studioRaw,
            hostId: host?.hostId ?? hostRaw,
            hostName: host?.name ?? hostRaw,
            accountId: account?.accountId ?? accountId,
            platform: cellText(get(cells, "platform")) || account?.platform || "",
            startMin,
            endMin,
            verdict: rejected ? "rejected" : "valid",
            reasons,
        });
    });

    // Conflicts: against sessions already scheduled, and between rows of the same file.
    const asRow = (r: ImportRow): ScheduleRow => ({
        key: `import:${r.file}:${r.no}`,
        itemId: null,
        scheduleId: `${r.file} baris ${r.excelRow}`,
        dateKey: r.dateKey,
        brandId: r.brandId,
        brandName: r.brandName,
        brandKnown: true,
        hostKnown: true,
        studioId: r.studioId,
        hostId: r.hostId,
        hostName: r.hostName,
        accountId: r.accountId,
        accountName: r.accountId,
        platform: r.platform,
        shift: "",
        sesi: "",
        position: "",
        liveBreak: "",
        campaignName: "",
        totalAccount: null,
        status: "Planned",
        startMin: r.startMin,
        endMin: r.endMin,
        jamLive: 0,
        startText: "",
        endText: "",
    });
    const fileRows = rows.filter((r) => r.verdict !== "rejected").map(asRow);
    const pool = [...cx.existing, ...fileRows];
    const studios = cx.lk.studios as Map<string, StudioRow>;
    const seen = new Map<string, number>();
    for (const r of rows) {
        if (r.verdict === "rejected") continue;
        const sig = [r.dateKey, r.studioId, r.hostId, r.startMin, r.endMin].join("|").toLowerCase();
        const dup = seen.get(sig);
        if (dup !== undefined) r.reasons.push(`Duplikat baris ${dup}`);
        else seen.set(sig, r.excelRow);
        const slot: Slot = { key: `import:${r.file}:${r.no}`, dateKey: r.dateKey, studioId: r.studioId, hostId: r.hostId, accountId: r.accountId, startMin: r.startMin, endMin: r.endMin, status: "Planned" };
        const cs = conflictsFor(slot, pool, studios, { host: (o) => o.hostName || o.hostId, studio: cx.studioName });
        for (const c of cs) if (dup === undefined || c.kind !== "host") r.reasons.push(c.message);
        if (r.reasons.length) r.verdict = "warning";
    }

    const counts = { total: rows.length, valid: 0, warning: 0, rejected: 0 };
    for (const r of rows) counts[r.verdict]++;
    return { file, source: t.source, missing, headers: t.headers.filter(Boolean), rows, counts };
}

export const timeText = (r: { startMin: number | null; endMin: number | null }): string =>
    r.startMin !== null && r.endMin !== null ? `${formatMinutes(r.startMin)}–${formatMinutes(r.endMin)}` : "—";

/** CSV of every row that is not plainly valid, for "Unduh daftar error". */
export function errorCsv(checks: FileCheck[]): string {
    const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    const lines = [["File", "Baris Excel", "Verdict", "Tanggal", "BrandID", "StudioID", "HostID", "Jam", "Alasan"].map(q).join(",")];
    for (const c of checks) {
        if (c.missing.length) lines.push([c.file, "", "Ditolak", "", "", "", "", "", `Kolom tidak ditemukan: ${c.missing.map((f) => FIELD_LABEL[f]).join(", ")}`].map(q).join(","));
        for (const r of c.rows) {
            if (r.verdict === "valid") continue;
            lines.push([r.file, String(r.excelRow), r.verdict === "rejected" ? "Ditolak" : "Peringatan", r.dateKey, r.brandId, r.studioId, r.hostId, timeText(r), r.reasons.join("; ")].map(q).join(","));
        }
    }
    return "﻿" + lines.join("\r\n");
}

/**
 * File name as stored in the library. v1 prefixed Text(Now(), "ddmmyyhhmmss_"), whose hh is the 12-hour clock
 * (collides 12 hours apart, DESIGN.md UC-2). This keeps the shape with a 24-hour clock.
 */
export function uploadName(original: string, at: Date): string {
    const pad = (n: number): string => (n < 10 ? "0" + n : String(n));
    const stamp = `${pad(at.getDate())}${pad(at.getMonth() + 1)}${String(at.getFullYear()).slice(2)}${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
    const clean = original.replace(/[\\/:*?"<>|#%{}~&]/g, "_").replace(/\s+/g, " ").trim() || "schedule.xlsx";
    return `${stamp}_${clean}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    return btoa(bin);
}
