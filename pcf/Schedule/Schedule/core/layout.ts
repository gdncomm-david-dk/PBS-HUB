// Schedule tables laid out for people, not machines: a Day/Date column merged over every session of the day,
// then one block per brand (Start Hour · End Hour · Duration · Host · Platform) under a brand title.
// The same reading works for the PDF export (positions + table lines) and for the Excel source (cells + merges).

import { Cell, Merge, SheetGrid, serialToDateKey } from "./xlsx";
import { parseTimeToMinutes } from "./time";

export interface PdfItem {
    x0: number;
    x1: number;
    y: number; // top-down, roughly the middle of the text line
    h: number;
    str: string;
}
export interface PdfPage {
    no: number;
    width: number;
    height: number;
    items: PdfItem[];
    h: { y: number; x0: number; x1: number }[]; // horizontal borders, top-down y
    v: { x: number; y0: number; y1: number }[]; // vertical borders, top-down y0 < y1
}

/** One session as read from the document, before any lookup against the master lists. */
export interface RawSession {
    file: string;
    group: string; // sheet name, or "PDF"
    where: string; // "Hal. 2" / "September baris 12", for the preview
    order: number;
    label: string; // brand block title ("Milkita", "Sidomuncul")
    /** Other text above the table (and the file name is tried too) when the title alone names no brand. */
    hints?: string[];
    dateKey: string;
    dateText: string;
    startMin: number | null;
    endMin: number | null;
    startText: string;
    endText: string;
    duration: number | null; // hours, from the Duration column
    host: string;
    platform: string;
    studio: string;
    account: string;
}

export interface LayoutResult {
    sessions: RawSession[];
    /** Lines that look like a session but could not be read (time missing or unreadable). */
    skipped: { where: string; text: string }[];
    /** Why nothing was found, when nothing was found. */
    problem: string;
}

type Field = "date" | "day" | "start" | "end" | "duration" | "host" | "platform" | "studio" | "account";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function headerField(text: string): Field | null {
    const n = norm(text);
    if (!n) return null;
    if (/^(start|mulai|jammulai|jamawal)/.test(n)) return "start";
    if (/^(end|selesai|jamselesai|jamakhir|finish)/.test(n)) return "end";
    if (/^(durat|durasi|jamlive|totallive|lama)/.test(n)) return "duration";
    if (/^(host|namahost|talent|streamer|presenter)/.test(n)) return "host";
    if (/^(platform|channel)/.test(n)) return "platform";
    if (/^(studio|lokasi|ruang)/.test(n)) return "studio";
    if (/^(account|akun|toko|store)/.test(n)) return "account";
    if (/^(date|tanggal|tgl)/.test(n)) return "date";
    if (/^(day|hari)$/.test(n)) return "day";
    return null;
}

const MONTHS: Record<string, number> = {
    jan: 1, january: 1, januari: 1,
    feb: 2, february: 2, februari: 2, pebruari: 2,
    mar: 3, march: 3, maret: 3,
    apr: 4, april: 4,
    may: 5, mei: 5,
    jun: 6, june: 6, juni: 6,
    jul: 7, july: 7, juli: 7,
    aug: 8, agu: 8, agt: 8, agus: 8, august: 8, agustus: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, okt: 10, october: 10, oktober: 10,
    nov: 11, nop: 11, november: 11, nopember: 11,
    dec: 12, des: 12, december: 12, desember: 12,
};
const pad = (n: number): string => (n < 10 ? "0" + n : String(n));

/** "5 October", "Senin, 18 Agustus 2026", "05/10/2026", "2026-10-05", "Oct 5" → yyyy-mm-dd ("" when not a date). */
export function parseLooseDate(v: Cell, year: number): string {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return v > 20000 && v < 80000 ? serialToDateKey(v) : "";
    const s = String(v).toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim();
    const ok = (y: number, m: number, d: number): string => {
        if (m < 1 || m > 12 || d < 1 || d > 31) return "";
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : "";
    };
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(s);
    if (m && !/[a-z]/.test(s.replace(/^[a-z']+ /, ""))) {
        const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
        return ok(y, Number(m[2]), Number(m[1]));
    }
    m = /(\d{1,2})\s*[-\s]?\s*([a-z]{3,9})\.?(?:\s+(\d{2,4}))?/.exec(s);
    if (m && MONTHS[m[2]] !== undefined) {
        const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
        return ok(y, MONTHS[m[2]], Number(m[1]));
    }
    m = /([a-z]{3,9})\.?\s+(\d{1,2})(?:\s+(\d{4}))?/.exec(s);
    if (m && MONTHS[m[1]] !== undefined) return ok(m[3] ? Number(m[3]) : year, MONTHS[m[1]], Number(m[2]));
    return "";
}

/** Hours from "5", "1,5", "1.5", "2 jam", "1 jam 30 menit", "45 menit", "1:30". */
export function parseHours(v: Cell): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) / 100 : null;
    const s = String(v).toLowerCase().trim();
    const hm = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (hm) return Math.round((Number(hm[1]) + Number(hm[2]) / 60) * 100) / 100;
    const jam = /(\d+(?:[.,]\d+)?)\s*(?:jam|j|h|hours?|hrs?)\b/.exec(s);
    const menit = /(\d+)\s*(?:menit|mnt|min|m)\b/.exec(s);
    if (jam || menit) return Math.round(((jam ? Number(jam[1].replace(",", ".")) : 0) + (menit ? Number(menit[1]) / 60 : 0)) * 100) / 100;
    const n = /^\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : NaN;
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Excel time cell: a day fraction (0.79166 = 19:00), 1 = midnight at the end of the day, or a text time. */
function sheetTime(v: Cell): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") {
        if (v < 0) return null;
        if (v <= 1) return Math.round(v * 1440) % 1440;
        if (v > 20000) return Math.round((v - Math.floor(v)) * 1440) % 1440;
        return null;
    }
    return parseTimeToMinutes(String(v).trim());
}

const timeText = (v: Cell, min: number | null): string => (min !== null ? `${pad(Math.floor(min / 60))}:${pad(min % 60)}` : v === null ? "" : String(v));

// ---------------------------------------------------------------------------------------------
// Excel

const cellText = (v: Cell): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : String(v).replace(/\s+/g, " ").trim());

export function sheetSessions(file: string, sheets: SheetGrid[], year: number): LayoutResult {
    const sessions: RawSession[] = [];
    const skipped: LayoutResult["skipped"] = [];
    let order = 0;
    let headerSeen = false;
    for (const sh of sheets) {
        const rowsSorted = Array.from(sh.grid.keys()).sort((a, b) => a - b);
        const at = (r: number, c: number): Cell => {
            const v = sh.grid.get(r)?.get(c);
            if (v !== null && v !== undefined && v !== "") return v;
            const mg = sh.merges.find((m: Merge) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1);
            return mg && (mg.r0 !== r || mg.c0 !== c) ? sh.grid.get(mg.r0)?.get(mg.c0) ?? null : null;
        };
        // Header rows: a "Start…" and an "End…" cell in the same row.
        const headers: { row: number; cols: { c: number; f: Field }[] }[] = [];
        for (const r of rowsSorted) {
            const cols: { c: number; f: Field }[] = [];
            for (const [c, v] of sh.grid.get(r) ?? new Map<number, Cell>()) {
                if (typeof v !== "string") continue;
                const f = headerField(v);
                if (f) cols.push({ c, f });
            }
            if (cols.some((x) => x.f === "start") && cols.some((x) => x.f === "end")) headers.push({ row: r, cols: cols.sort((a, b) => a.c - b.c) });
        }
        headers.forEach((hd, hi) => {
            headerSeen = true;
            const lastRow = hi + 1 < headers.length ? headers[hi + 1].row - 1 : rowsSorted[rowsSorted.length - 1] ?? hd.row;
            const dateCol = hd.cols.find((x) => x.f === "date")?.c ?? null;
            const sharedCols = hd.cols.filter((x) => x.f === "studio" || x.f === "account" || x.f === "platform" || x.f === "host");
            const starts = hd.cols.filter((x) => x.f === "start");
            const blocks = starts.map((s, i) => {
                const until = i + 1 < starts.length ? starts[i + 1].c : Infinity;
                const cols = hd.cols.filter((x) => x.c >= s.c && x.c < until && x.f !== "date" && x.f !== "day");
                const pick = (f: Field): number | null => cols.find((x) => x.f === f)?.c ?? (starts.length === 1 ? sharedCols.find((x) => x.f === f && x.c < s.c)?.c ?? null : null);
                const c1 = cols.length ? cols[cols.length - 1].c : s.c;
                // Brand title: the nearest text above the header over the block (often a merged cell).
                let label = "";
                for (let r = hd.row - 1; r >= Math.max(1, hd.row - 4) && !label; r--) {
                    for (let c = s.c; c <= c1 && !label; c++) {
                        const t = cellText(at(r, c));
                        if (t && !headerField(t)) label = t;
                    }
                }
                return { start: s.c, end: pick("end"), duration: pick("duration"), host: pick("host"), platform: pick("platform"), studio: pick("studio"), account: pick("account"), label };
            });
            let lastDate = "";
            let lastDateText = "";
            for (const r of rowsSorted) {
                if (r <= hd.row || r > lastRow) continue;
                if (dateCol !== null) {
                    const dv = at(r, dateCol);
                    const dk = parseLooseDate(dv, year);
                    if (dk) {
                        lastDate = dk;
                        lastDateText = typeof dv === "number" ? "" : cellText(dv);
                    }
                }
                for (const b of blocks) {
                    const sv = at(r, b.start);
                    const ev = b.end !== null ? at(r, b.end) : null;
                    const host = b.host !== null ? cellText(at(r, b.host)) : "";
                    if ((sv === null || sv === "") && (ev === null || ev === "")) continue;
                    const startMin = sheetTime(sv);
                    const endMin = sheetTime(ev);
                    const where = `${sh.name} baris ${r}`;
                    if (startMin === null && endMin === null) {
                        skipped.push({ where, text: [cellText(sv), cellText(ev), host].filter(Boolean).join(" · ") });
                        continue;
                    }
                    let duration = b.duration !== null ? parseHours(at(r, b.duration)) : null;
                    // A duration typed as a time (0.0833 = 2 hours) instead of a number of hours.
                    if (duration !== null && duration > 0 && duration < 1 && startMin !== null && endMin !== null) {
                        const span = (((endMin - startMin + 1440) % 1440) || 1440) / 60;
                        if (Math.abs(duration * 24 - span) < 0.05) duration = Math.round(duration * 2400) / 100;
                    }
                    sessions.push({
                        file,
                        group: sh.name,
                        where,
                        order: order++,
                        label: b.label,
                        dateKey: lastDate,
                        dateText: lastDateText,
                        startMin,
                        endMin,
                        startText: timeText(sv, startMin),
                        endText: timeText(ev, endMin),
                        duration,
                        host,
                        platform: b.platform !== null ? cellText(at(r, b.platform)) : "",
                        studio: b.studio !== null ? cellText(at(r, b.studio)) : "",
                        account: b.account !== null ? cellText(at(r, b.account)) : "",
                    });
                }
            }
        });
    }
    return { sessions, skipped, problem: sessions.length ? "" : headerSeen ? "Header ditemukan, tetapi tidak ada baris jadwal di bawahnya." : "Tidak menemukan header Start/End Hour di sheet mana pun." };
}

// ---------------------------------------------------------------------------------------------
// PDF

interface Col {
    x0: number;
    x1: number;
    f: Field;
}
interface PdfLayout {
    cols: Col[];
    blocks: { cols: Col[]; label: string; hints: string[] }[];
    date: Col | null;
}

const cx = (it: PdfItem): number => (it.x0 + it.x1) / 2;
const uniq = (xs: number[], tol: number): number[] => {
    const out: number[] = [];
    for (const x of [...xs].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
    return out;
};

/** Horizontal borders that cross x, sorted top-down. */
const linesAt = (pg: PdfPage, x: number, yMin = -Infinity, yMax = Infinity): number[] =>
    uniq(
        pg.h.filter((l) => l.x0 - 0.5 <= x && l.x1 + 0.5 >= x && l.y > yMin && l.y < yMax).map((l) => l.y),
        1.5,
    );

/** Items grouped into text lines (left to right), nearest to the table (lowest on the page) first. */
function textLines(items: PdfItem[]): string[] {
    const rows: { y: number; its: PdfItem[] }[] = [];
    for (const it of [...items].sort((a, b) => b.y - a.y)) {
        const row = rows.find((r) => Math.abs(r.y - it.y) < 3);
        if (row) row.its.push(it);
        else rows.push({ y: it.y, its: [it] });
    }
    return rows.map((r) => r.its.sort((a, b) => a.x0 - b.x0).map((it) => it.str).join(" ").trim()).filter(Boolean);
}

function findHeader(pg: PdfPage): { layout: PdfLayout; top: number; bottom: number } | null {
    const starts = pg.items.filter((it) => headerField(it.str) === "start");
    for (const s of starts) {
        const hasEnd = pg.items.some((it) => headerField(it.str) === "end" && Math.abs(it.y - s.y) < 30 && it.x0 > s.x0);
        if (!hasEnd) continue;
        const above = linesAt(pg, cx(s), -Infinity, s.y).pop();
        const below = linesAt(pg, cx(s), s.y).shift();
        const top = above !== undefined && s.y - above < 45 ? above : s.y - 30;
        const bottom = below !== undefined && below - s.y < 45 ? below : s.y + 30;
        const head = pg.items.filter((it) => it.y > top && it.y < bottom);
        // Column boundaries: vertical borders through the header band, else gaps between header words.
        const mid = (top + bottom) / 2;
        let bounds = uniq(
            pg.v.filter((l) => l.y0 - 1 <= mid && l.y1 + 1 >= mid).map((l) => l.x),
            1.5,
        );
        if (bounds.length < 3) {
            const centers = uniq(head.map(cx), 10);
            bounds = [centers[0] - 40, ...centers.slice(1).map((c, i) => (c + centers[i]) / 2), centers[centers.length - 1] + 40];
        }
        const cols: Col[] = [];
        for (let i = 0; i + 1 < bounds.length; i++) {
            const [x0, x1] = [bounds[i], bounds[i + 1]];
            const text = head
                .filter((it) => cx(it) >= x0 && cx(it) < x1)
                .sort((a, b) => a.y - b.y || a.x0 - b.x0)
                .map((it) => it.str)
                .join(" ");
            const f = headerField(text);
            if (f) cols.push({ x0, x1, f });
        }
        if (!cols.some((c) => c.f === "start") || !cols.some((c) => c.f === "end")) continue;
        const startCols = cols.filter((c) => c.f === "start");
        const blocks = startCols.map((s, i) => {
            const until = i + 1 < startCols.length ? startCols[i + 1].x0 : Infinity;
            const bc = cols.filter((c) => c.x0 >= s.x0 && c.x0 < until && c.f !== "date" && c.f !== "day");
            const x1 = bc[bc.length - 1].x1;
            let label = pg.items
                .filter((it) => it.y < top - 0.5 && it.y > top - 70 && cx(it) >= s.x0 && cx(it) <= x1 && !headerField(it.str))
                .sort((a, b) => a.y - b.y || a.x0 - b.x0)
                .map((it) => it.str)
                .join(" ");
            // Text lines above the table, nearest first: over the block, else (one block only) anywhere above.
            const over = textLines(pg.items.filter((it) => it.y < top - 0.5 && it.x1 >= s.x0 && it.x0 <= x1 && !headerField(it.str)));
            const anywhere = startCols.length === 1 ? textLines(pg.items.filter((it) => it.y < top - 0.5 && !headerField(it.str))) : [];
            const lines = [...over, ...anywhere.filter((l) => !over.includes(l))];
            // A title further up, or centred over a merged cell wider than the block, still counts.
            if (!label) label = lines[0] ?? "";
            return { cols: bc, label, hints: lines.filter((l) => l !== label) };
        });
        return { layout: { cols, blocks, date: cols.find((c) => c.f === "date") ?? null }, top, bottom };
    }
    return null;
}

/** Group values into rows: by the table's horizontal borders when there are any, else by line height. */
function rowsOf(items: PdfItem[], lines: number[]): PdfItem[][] {
    const rows = new Map<number, PdfItem[]>();
    if (lines.length >= 2) {
        for (const it of items) {
            const k = lines.filter((y) => y < it.y).length;
            if (!rows.has(k)) rows.set(k, []);
            (rows.get(k) as PdfItem[]).push(it);
        }
        return Array.from(rows.entries())
            .sort((a, b) => a[0] - b[0])
            .map((e) => e[1]);
    }
    const sorted = [...items].sort((a, b) => a.y - b.y);
    const out: PdfItem[][] = [];
    for (const it of sorted) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0].y - it.y) <= Math.max(3, it.h * 0.6)) last.push(it);
        else out.push([it]);
    }
    return out;
}

export function pdfSessions(file: string, pages: PdfPage[], year: number): LayoutResult {
    const sessions: RawSession[] = [];
    const skipped: LayoutResult["skipped"] = [];
    let layout: PdfLayout | null = null;
    let order = 0;
    let lastDate = "";
    let lastDateText = "";
    for (const pg of pages) {
        const found = findHeader(pg);
        if (found) layout = found.layout;
        if (!layout) continue;
        const top = found ? found.bottom : -Infinity;
        const body = pg.items.filter((it) => it.y > top);
        const inCol = (c: Col) => (it: PdfItem): boolean => cx(it) >= c.x0 && cx(it) < c.x1;

        // Day blocks: borders across the Date column split the page; the date label sits somewhere inside.
        const dateCol = layout.date;
        const dateLines = dateCol ? linesAt(pg, (dateCol.x0 + dateCol.x1) / 2, top) : [];
        const labels = dateCol
            ? body
                  .filter(inCol(dateCol))
                  .map((it) => ({ y: it.y, key: parseLooseDate(it.str, year), text: it.str }))
                  .filter((l) => l.key)
            : [];
        const band = (y: number): number => dateLines.filter((l) => l < y).length;
        const labelOfBand = new Map<number, { key: string; text: string }>();
        for (const l of labels) if (!labelOfBand.has(band(l.y))) labelOfBand.set(band(l.y), l);
        const dateFor = (y: number): { key: string; text: string } | null => {
            if (dateLines.length) return labelOfBand.get(band(y)) ?? null;
            if (!labels.length) return null;
            return labels.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
        };

        const found2: { y: number; s: RawSession }[] = [];
        for (const b of layout.blocks) {
            const col = (f: Field): Col | undefined => b.cols.find((c) => c.f === f) ?? (layout && layout.blocks.length === 1 ? layout.cols.find((c) => c.f === f && c.f !== "start") : undefined);
            const startCol = col("start") as Col;
            const x0 = Math.min(...b.cols.map((c) => c.x0));
            const x1 = Math.max(...b.cols.map((c) => c.x1));
            const items = body.filter((it) => cx(it) >= x0 && cx(it) < x1);
            const lines = linesAt(pg, (startCol.x0 + startCol.x1) / 2, top);
            for (const row of rowsOf(items, lines)) {
                const text = (f: Field): string => {
                    const c = col(f);
                    return c
                        ? row
                              .filter(inCol(c))
                              .sort((a, b2) => a.x0 - b2.x0)
                              .map((it) => it.str)
                              .join(" ")
                              .trim()
                        : "";
                };
                const st = text("start");
                const et = text("end");
                const host = text("host");
                if (!st && !et) continue;
                const startMin = parseTimeToMinutes(st);
                const endMin = parseTimeToMinutes(et);
                const y = Math.min(...row.map((it) => it.y));
                if (startMin === null && endMin === null) {
                    skipped.push({ where: `Hal. ${pg.no}`, text: [st, et, host].filter(Boolean).join(" · ") });
                    continue;
                }
                found2.push({
                    y,
                    s: {
                        file,
                        group: "PDF",
                        where: `Hal. ${pg.no}`,
                        order: 0,
                        label: b.label,
                        hints: b.hints,
                        dateKey: "",
                        dateText: "",
                        startMin,
                        endMin,
                        startText: startMin !== null ? timeText(st, startMin) : st,
                        endText: endMin !== null ? timeText(et, endMin) : et,
                        duration: parseHours(text("duration")),
                        host,
                        platform: text("platform"),
                        studio: text("studio"),
                        account: text("account"),
                    },
                });
            }
        }
        // Top-down, so a day block that started on the previous page carries over.
        found2.sort((a, b) => a.y - b.y);
        for (const { y, s } of found2) {
            const d = dateFor(y);
            if (d) {
                lastDate = d.key;
                lastDateText = d.text;
            }
            sessions.push({ ...s, dateKey: lastDate, dateText: lastDateText, order: order++ });
        }
        // The last labelled day on this page continues on the next one.
        if (labels.length) {
            const last = labels.reduce((a, b) => (b.y > a.y ? b : a));
            if (!found2.length || last.y > found2[found2.length - 1].y) {
                lastDate = last.key;
                lastDateText = last.text;
            }
        }
    }
    const problem = sessions.length
        ? ""
        : layout
          ? "Header ditemukan, tetapi tidak ada baris jadwal yang terbaca."
          : pages.every((p) => p.items.length === 0)
            ? "PDF tidak berisi teks (hasil scan/foto). Ekspor ulang dari Excel/Sheets sebagai PDF."
            : "Tidak menemukan header Start/End Hour di PDF.";
    return { sessions, skipped, problem };
}

/** Year for dates written without one ("5 October"): a 20xx in the file name, else the current year. */
export function yearHint(fileName: string, now: Date): number {
    const m = /(20\d{2})/.exec(fileName);
    return m ? Number(m[1]) : now.getFullYear();
}
