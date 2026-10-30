// Parsed sessions → Schedule rows: brand, account, studio and host are looked up in the master lists the app
// passes in (BrandsJson / AccountsJson / StudiosJson / HostsJson), never in a table written into the control.
// What cannot be decided for sure is left empty with the candidates, so the preview can ask.

import { AccountRow, BrandRow, HostRow, ScheduleRow, StudioRow } from "./types";
import { Lookups, occupies } from "./data";
import { checkFile, ImportRow, Verdict } from "./import";
import { RawSession } from "./layout";
import { Cell } from "./xlsx";

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: string): string[] =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(Boolean);
const pad = (n: number): string => (n < 10 ? "0" + n : String(n));
const hhmm = (min: number | null): string => (min === null ? "" : `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`);

export interface Resolved {
    id: string;
    raw: RawSession;
    brandId: string;
    brandName: string;
    platform: string;
    accountId: string;
    accountOptions: string[]; // candidates when more than one account fits
    studioId: string;
    studioFrom: "" | "dokumen" | "master" | "riwayat";
    studioOptions: string[];
    hostId: string;
    hostOptions: string[];
    shift: string;
    jamLive: number;
    campaign: string;
    notes: Partial<Record<"brand" | "account" | "studio" | "host" | "time", string>>;
}

export interface Overrides {
    hostId?: string;
    studioId?: string;
    accountId?: string;
    /** Corrections typed in the preview when the file is wrong: yyyy-mm-dd, minutes from midnight (end 0 = 24:00). */
    dateKey?: string;
    startMin?: number | null;
    endMin?: number | null;
}

export interface Flags {
    past: boolean;
    /** Host / account / studio clashes with loaded schedules or other parsed rows. */
    clash: string[];
    /** Same date, time, brand and host as an earlier row of the parsed files: where that row is. */
    dup: string;
    /** Same session already in Schedule: its ScheduleID. */
    exists: string;
}

export interface ParsedRow extends Resolved {
    verdict: Verdict;
    reasons: string[];
    flags: Flags;
    check: ImportRow | null;
}

export interface ResolveContext {
    lk: Lookups;
    brands: BrandRow[];
    hosts: HostRow[];
    studios: StudioRow[];
    accounts: AccountRow[];
    schedules: ScheduleRow[];
    platforms: string[];
}

export const shiftOf = (min: number | null): string => (min === null ? "" : min < 720 ? "Pagi" : min < 1020 ? "Siang" : "Malam");

/** The handle part of an account name: "milkita.id - Tiktok" → "milkitaid". */
const handle = (a: AccountRow): string => alnum(a.accountName.split(/\s+-\s+/)[0] ?? a.accountName);

function platformOf(text: string, platforms: string[]): string {
    const n = alnum(text);
    if (!n) return "";
    return platforms.find((p) => alnum(p) === n) ?? platforms.find((p) => n.includes(alnum(p)) && alnum(p).length >= 4) ?? text.trim();
}

/** Brand block title → brand, and the account when the title names one ("Milkita" = milkita.id). */
export function matchBrand(label: string, cx: ResolveContext): { brand?: BrandRow; account?: AccountRow; platformHint: string } {
    const paren = /\(([^)]*)\)/.exec(label)?.[1] ?? "";
    const platformHint = paren ? platformOf(paren, cx.platforms) : "";
    const hintOk = platformHint && cx.platforms.some((p) => alnum(p) === alnum(platformHint));
    const L = alnum(label.replace(/\([^)]*\)/g, ""));
    if (!L) return { platformHint: hintOk ? platformHint : "" };
    const brands = cx.brands;
    const byId = (id: string): BrandRow | undefined => cx.lk.brands.get(id.toLowerCase());
    let brand = brands.find((b) => alnum(b.brandId) === L || alnum(b.namaBrand) === L || (b.aliases ?? []).some((a) => alnum(a) === L));
    let account: AccountRow | undefined;
    if (!brand) {
        const acc = cx.accounts.filter((a) => handle(a) === L || (L.length >= 4 && handle(a).startsWith(L)));
        if (acc.length) {
            const withHint = hintOk ? acc.filter((a) => alnum(a.platform) === alnum(platformHint)) : acc;
            account = withHint.length === 1 ? withHint[0] : acc.length === 1 ? acc[0] : undefined;
            brand = byId((account ?? acc[0]).brandId);
        }
    }
    if (brand && !account) {
        // "Milkita" can be an Alias of UNIFAM and still name one of its accounts (milkita.id).
        const own = cx.accounts.filter((a) => a.brandId.toLowerCase() === brand?.brandId.toLowerCase() && (handle(a) === L || (L.length >= 4 && handle(a).startsWith(L))));
        const withHint = hintOk ? own.filter((a) => alnum(a.platform) === alnum(platformHint)) : own;
        if (withHint.length === 1) account = withHint[0];
    }
    if (!brand && L.length >= 4) {
        const near = brands.filter((b) => {
            const n = alnum(b.namaBrand);
            return n.length >= 4 && (n.startsWith(L) || L.startsWith(n));
        });
        if (near.length === 1) brand = near[0];
    }
    return { brand, account, platformHint: hintOk ? platformHint : "" };
}

/** matchBrand without its prefix guesses: for text that is not a brand title (page titles, file name words). */
function exactBrand(text: string, cx: ResolveContext): { brand?: BrandRow; account?: AccountRow; platformHint: string } {
    const L = alnum(text.replace(/\([^)]*\)/g, ""));
    if (L.length < 3) return { platformHint: "" };
    const byName = cx.brands.some((b) => alnum(b.brandId) === L || alnum(b.namaBrand) === L || (b.aliases ?? []).some((a) => alnum(a) === L));
    const byHandle = cx.accounts.some((a) => handle(a) === L);
    return byName || byHandle ? matchBrand(text, cx) : { platformHint: "" };
}

/** Host name or nickname → HostID. Full name, then Alias, then a unique prefix / first name / single name. */
export function matchHost(text: string, hosts: HostRow[]): { id: string; options: string[]; note: string } {
    const t = text.trim();
    if (!t) return { id: "", options: [], note: "Host kosong" };
    const n = alnum(t);
    const w = words(t);
    const pick = (xs: HostRow[], label: string): { id: string; options: string[]; note: string } | null => {
        if (!xs.length) return null;
        const active = xs.filter((h) => h.isActive);
        const set = active.length ? active : xs;
        if (set.length === 1) return { id: set[0].hostId, options: [], note: "" };
        return { id: "", options: set.map((h) => h.hostId), note: `"${t}" cocok dengan ${set.length} host (${label}) — pilih salah satu` };
    };
    const tries: [HostRow[], string][] = [
        [hosts.filter((h) => alnum(h.hostId) === n), "ID"],
        [hosts.filter((h) => alnum(h.name) === n), "nama"],
        [hosts.filter((h) => (h.aliases ?? []).some((a) => alnum(a) === n)), "alias"],
        [hosts.filter((h) => w.length > 1 && words(h.name).slice(0, w.length).join(" ") === w.join(" ")), "awal nama"],
        [hosts.filter((h) => w.length === 1 && words(h.name)[0] === w[0]), "nama depan"],
        [hosts.filter((h) => w.length === 1 && words(h.name).includes(w[0])), "bagian nama"],
    ];
    for (const [xs, label] of tries) {
        const r = pick(xs, label);
        if (r) return r;
    }
    return { id: "", options: [], note: `Host "${t}" tidak ada di master Host — pilih host atau tambahkan Alias` };
}

function matchStudio(text: string, studios: StudioRow[]): StudioRow[] {
    const n = alnum(text);
    if (!n) return [];
    const exact = studios.filter((s) => alnum(s.studioId) === n || alnum(s.namaStudio) === n);
    if (exact.length) return exact;
    return studios.filter((s) => (alnum(s.namaStudio).includes(n) || n.includes(alnum(s.namaStudio))) && alnum(s.namaStudio).length >= 4);
}

/** Studios named in the Brand list's Studio column, as master rows (an ID missing from the Studio list is skipped). */
export function brandStudios(brand: BrandRow, studios: StudioRow[]): StudioRow[] {
    const ids = new Set((brand.studios ?? []).map(alnum));
    return ids.size ? studios.filter((st) => ids.has(alnum(st.studioId))) : [];
}

/** Studio a brand usually goes live in: the most used studio over its last 30 sessions. */
function studioFromHistory(brandId: string, schedules: ScheduleRow[]): string {
    const recent = schedules
        .filter((s) => s.brandId.toLowerCase() === brandId.toLowerCase() && s.studioId)
        .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
        .slice(0, 30);
    const count = new Map<string, number>();
    for (const s of recent) count.set(s.studioId, (count.get(s.studioId) ?? 0) + 1);
    let best = "";
    let max = 0;
    for (const [id, c] of count) if (c > max) [best, max] = [id, c];
    return best;
}

export function resolveSession(s: RawSession, cx: ResolveContext): Resolved {
    const notes: Resolved["notes"] = {};
    let mb = matchBrand(s.label, cx);
    if (!mb.brand) {
        // The title names no brand (or none was found): other text above the table, then the file name, if one
        // of them is exactly a brand name, alias, BrandID or account handle.
        const words = s.file.replace(/\.[a-z0-9]+$/i, "").split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
        for (const h of [...(s.hints ?? []), ...words]) {
            const m = exactBrand(h, cx);
            if (m.brand) {
                mb = { ...m, platformHint: m.platformHint || mb.platformHint };
                break;
            }
        }
    }
    const brand = mb.brand;
    if (!brand) notes.brand = s.label ? `Brand "${s.label}" tidak dikenali — tambahkan Alias di list Brand` : "Judul brand tidak ditemukan di atas tabel";

    // Account and platform.
    let platform = s.platform ? platformOf(s.platform, cx.platforms) : mb.platformHint;
    let accountId = "";
    let accountOptions: string[] = [];
    if (brand) {
        const own = cx.accounts.filter((a) => a.brandId.toLowerCase() === brand.brandId.toLowerCase());
        const named = s.account ? cx.accounts.filter((a) => alnum(a.accountId) === alnum(s.account) || handle(a) === alnum(s.account) || alnum(a.accountName) === alnum(s.account)) : [];
        const samePlatform = (a: AccountRow): boolean => !platform || alnum(a.platform) === alnum(platform);
        let cands: AccountRow[];
        if (named.length) cands = named.filter(samePlatform);
        else if (mb.account && samePlatform(mb.account)) cands = [mb.account];
        else if (platform) cands = own.filter(samePlatform);
        else {
            // No platform in the document: the brand's TikTok account when it has exactly one.
            const tiktok = own.filter((a) => alnum(a.platform) === "tiktok");
            cands = tiktok.length === 1 ? tiktok : own;
        }
        if (cands.length === 1) {
            accountId = cands[0].accountId;
            if (!platform) platform = cands[0].platform;
        } else if (cands.length > 1) {
            accountOptions = cands.map((a) => a.accountId);
            notes.account = `${cands.length} akun ${brand.namaBrand}${platform ? " " + platform : ""} — pilih akun`;
        } else if (own.length) notes.account = `Tidak ada akun ${brand.namaBrand}${platform ? " di " + platform : ""}`;
        if (platform) platform = platformOf(platform, cx.platforms);
    }

    // Studio: written in the document, else the studio the master list places the brand in, else history.
    let studioId = "";
    let studioFrom: Resolved["studioFrom"] = "";
    let studioOptions: string[] = [];
    if (s.studio) {
        const m = matchStudio(s.studio, cx.studios);
        if (m.length === 1) [studioId, studioFrom] = [m[0].studioId, "dokumen"];
        else if (m.length > 1) studioOptions = m.map((x) => x.studioId);
        else notes.studio = `Studio "${s.studio}" tidak ada di master Studio`;
    }
    if (!studioId && !studioOptions.length && brand) {
        // The Studio column on the Brand list first, else the Brands column on the Studio list.
        const own = brandStudios(brand, cx.studios);
        const keys = new Set([alnum(brand.brandId), alnum(brand.namaBrand), ...(brand.aliases ?? []).map(alnum), alnum(s.label.replace(/\([^)]*\)/g, ""))].filter(Boolean));
        const placed = own.length ? own : cx.studios.filter((st) => (st.brands ?? []).some((b) => keys.has(alnum(b))));
        if (placed.length === 1) [studioId, studioFrom] = [placed[0].studioId, "master"];
        else if (placed.length > 1) studioOptions = placed.map((x) => x.studioId);
        else {
            const h = studioFromHistory(brand.brandId, cx.schedules);
            if (h) [studioId, studioFrom] = [h, "riwayat"];
        }
    }
    if (!studioId && !notes.studio) notes.studio = studioOptions.length ? `${studioOptions.length} studio cocok — pilih studio` : "Studio belum diketahui — pilih studio (atau isi kolom Studio di list Brand)";

    const host = matchHost(s.host, cx.hosts);
    if (host.note) notes.host = host.note;

    // Hours from the Duration column; from the times when the document has none.
    const span = s.startMin !== null && s.endMin !== null ? (((s.endMin - s.startMin + 1440) % 1440) || 1440) / 60 : null;
    const jamLive = s.duration ?? (span !== null ? Math.round(span * 100) / 100 : 0);
    if (s.duration !== null && span !== null && Math.abs(s.duration - span) > 0.05) notes.time = `Durasi ${s.duration} jam ≠ ${hhmm(s.startMin)}–${hhmm(s.endMin)} (${Math.round(span * 100) / 100} jam)`;

    return {
        id: `${s.file}|${s.order}`,
        raw: s,
        brandId: brand?.brandId ?? "",
        brandName: brand?.namaBrand ?? s.label,
        platform,
        accountId,
        accountOptions,
        studioId,
        studioFrom,
        studioOptions,
        hostId: host.id,
        hostOptions: host.options,
        shift: shiftOf(s.startMin),
        jamLive,
        campaign: s.label.replace(/\s+/g, " ").trim(),
        notes,
    };
}

/** Apply the user's picks, then run the same checks as the bulk upload (master lists, conflicts, duplicates). */
export function checkParsed(rows: Resolved[], picks: Record<string, Overrides>, cx: ResolveContext, ctx: { todayKey: string; studioName: (id: string) => string }): ParsedRow[] {
    const applied = rows.map((r) => {
        const o = picks[r.id] ?? {};
        const notes = { ...r.notes };
        const accountId = o.accountId ?? r.accountId;
        const acc = accountId ? cx.lk.accounts.get(accountId.toLowerCase()) : undefined;
        if (o.hostId !== undefined) delete notes.host;
        if (o.studioId !== undefined) delete notes.studio;
        if (o.accountId !== undefined) delete notes.account;
        // A corrected date or time replaces what the file said; hours then follow the corrected times.
        const timed = o.startMin !== undefined || o.endMin !== undefined;
        let raw = r.raw;
        let { jamLive, shift } = r;
        if (o.dateKey !== undefined || timed) {
            const startMin = o.startMin !== undefined ? o.startMin : r.raw.startMin;
            const endMin = o.endMin !== undefined ? o.endMin : r.raw.endMin;
            raw = { ...r.raw, dateKey: o.dateKey ?? r.raw.dateKey, startMin, endMin, startText: hhmm(startMin), endText: hhmm(endMin) };
            if (timed) {
                delete notes.time;
                jamLive = startMin !== null && endMin !== null ? Math.round(((((endMin - startMin + 1440) % 1440) || 1440) / 60) * 100) / 100 : 0;
                shift = shiftOf(startMin);
            }
        }
        return { ...r, raw, jamLive, shift, hostId: o.hostId ?? r.hostId, studioId: o.studioId ?? r.studioId, accountId, platform: acc?.platform || r.platform, notes };
    });
    const sig = (dateKey: string, start: number | null, end: number | null, brandId: string, hostId: string): string =>
        [dateKey, start, end === null ? null : end % 1440, brandId.toLowerCase(), hostId.toLowerCase()].join("|");
    const existing = new Map<string, string>();
    for (const x of cx.schedules) if (occupies(x.status)) existing.set(sig(x.dateKey, x.startMin, x.endMin, x.brandId, x.hostId), x.scheduleId || "jadwal lain");
    const seen = new Map<string, string>();
    const many = new Set(applied.map((r) => r.raw.file)).size > 1;
    const marks = applied.map((r) => {
        const key = sig(r.raw.dateKey, r.raw.startMin, r.raw.endMin, r.brandId, r.hostId);
        const complete = !!(r.raw.dateKey && r.hostId && r.brandId && r.raw.startMin !== null);
        const exists = complete ? existing.get(key) ?? "" : "";
        const dup = complete ? seen.get(key) ?? "" : "";
        if (complete && !dup) seen.set(key, many ? `${r.raw.where} · ${r.raw.file}` : r.raw.where);
        return { exists, dup };
    });

    // Clashes are checked among the rows that would really be new: a copy (already in Schedule, or repeated in
    // the files) would otherwise make its original look double-booked. The copies get the master-list checks only.
    const headers = ["Date", "StartHour", "EndHour", "BrandID", "StudioID", "HostID", "AccountID", "Platform", "Position"];
    const tableOf = (rows: typeof applied) => ({
        source: "parse",
        headers,
        firstRow: 1,
        rows: rows.map((r): Cell[] => [r.raw.dateKey || null, hhmm(r.raw.startMin) || null, hhmm(r.raw.endMin) || null, r.brandId || null, r.studioId || null, r.hostId || null, r.accountId || null, r.platform || null, "Main Host"]),
    });
    const isNew = (i: number): boolean => !marks[i].exists && !marks[i].dup;
    const fresh = applied.filter((_, i) => isNew(i));
    const copies = applied.filter((_, i) => !isNew(i));
    const fcNew = checkFile("parse", tableOf(fresh), { lk: cx.lk, existing: cx.schedules, todayKey: ctx.todayKey, studioName: ctx.studioName });
    const fcCopy = checkFile("parse", tableOf(copies), { lk: cx.lk, existing: [], todayKey: ctx.todayKey, studioName: ctx.studioName });
    const CLASH = /sudah dijadwalkan|sudah live|penuh:/;
    let ni = 0;
    let ci = 0;
    return applied.map((r, i) => {
        const { exists, dup } = marks[i];
        const c = (isNew(i) ? fcNew.rows[ni++] : fcCopy.rows[ci++]) ?? null;
        // A session ending at 00:00 is the normal end of the day here, not a warning. checkFile's own duplicate
        // note counts table rows, which mean nothing here; ours names the page or sheet row. A past date is fine
        // for a parsed schedule (late uploads, month sheets), so it is no warning either.
        let reasons = (c?.reasons ?? []).filter((x) => !(x === "Sesi melewati tengah malam" && r.raw.endMin === 0) && !/^Duplikat baris/.test(x) && x !== "Tanggal sudah lewat");
        if (!isNew(i)) reasons = reasons.filter((x) => !CLASH.test(x));
        const clash = reasons.filter((x) => CLASH.test(x));
        const own = Object.values(r.notes).filter((x): x is string => !!x);
        // checkFile's "…kosong" says the same as our note: keep ours, it says what to do.
        const merged = [...(exists ? [`Sudah ada di Schedule (${exists})`] : []), ...(dup ? [`Duplikat dari ${dup}`] : []), ...own, ...reasons.filter((x) => !(own.length && /kosong$/.test(x)))];
        const verdict: Verdict = c?.verdict === "rejected" ? "rejected" : merged.length ? "warning" : "valid";
        const flags: Flags = { past: !!r.raw.dateKey && r.raw.dateKey < ctx.todayKey, clash, dup, exists };
        return { ...r, verdict, reasons: merged, flags, check: c };
    });
}

/** BULK_CREATE_SCHEDULE item, same shape as the duplicate dialog plus shift and campaign. */
export function createItem(r: ParsedRow): Record<string, unknown> {
    return {
        date: r.raw.dateKey,
        brandId: r.brandId,
        accountId: r.accountId,
        studioId: r.studioId,
        hostId: r.hostId,
        platform: r.platform,
        startTime: hhmm(r.raw.startMin),
        endTime: hhmm(r.raw.endMin),
        jamLive: r.jamLive,
        position: "Main Host",
        totalAccount: 1,
        status: "Planned",
        shift: r.shift,
        campaign: r.campaign,
        source: `${r.raw.file} · ${r.raw.where}`,
    };
}
