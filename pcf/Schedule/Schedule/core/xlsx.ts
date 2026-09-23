// Minimal .xlsx reader for the bulk-schedule preview. PBS0001A reads "List rows present in Table1",
// so the preview reads the same Excel table when the file has one, else the first sheet's used range.
// Values come back raw: numbers stay numbers (Excel date serials, time fractions), strings stay strings.

import { unzipSync, strFromU8 } from "fflate";

export type Cell = string | number | boolean | null;

export interface SheetTable {
    source: string;        // "Table1" or the sheet name
    headers: string[];
    rows: Cell[][];
    firstRow: number;      // 1-based Excel row of rows[0]
}

const decode = (s: string): string =>
    s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return m ? decode(m[1]) : null;
};

/** Text of every <t> inside a fragment (rich text runs are concatenated; phonetic runs skipped). */
const texts = (frag: string): string => {
    const noPh = frag.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let out = "";
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noPh))) out += decode(m[1]);
    return out;
};

export function colIndex(ref: string): number {
    const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

const rowIndex = (ref: string): number => Number(/\d+/.exec(ref)?.[0] ?? "1");

function parseRange(ref: string): { c0: number; r0: number; c1: number; r1: number } {
    const [a, b = a] = ref.split(":");
    return { c0: colIndex(a), r0: rowIndex(a), c1: colIndex(b), r1: rowIndex(b) };
}

const resolve = (base: string, target: string): string => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
};

function rels(files: Record<string, Uint8Array>, path: string): Map<string, string> {
    const dir = path.split("/").slice(0, -1).join("/");
    const name = path.split("/").pop();
    const relPath = `${dir ? dir + "/" : ""}_rels/${name}.rels`;
    const m = new Map<string, string>();
    const f = files[relPath];
    if (!f) return m;
    const xml = strFromU8(f);
    const re = /<Relationship\b[^>]*>/g;
    let t: RegExpExecArray | null;
    while ((t = re.exec(xml))) {
        const id = attr(t[0], "Id");
        const target = attr(t[0], "Target");
        if (id && target) m.set(id, resolve(path, target));
    }
    return m;
}

function readSheet(xml: string, shared: string[]): Map<number, Map<number, Cell>> {
    const grid = new Map<number, Map<number, Cell>>();
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const head = " " + m[1];
        const body = m[2] ?? "";
        const ref = attr(head, "r");
        if (!ref) continue;
        const t = attr(head, "t") ?? "n";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val: Cell = null;
        if (t === "s") val = v !== undefined ? shared[Number(v)] ?? "" : null;
        else if (t === "inlineStr") val = texts(body);
        else if (t === "str") val = v !== undefined ? decode(v) : null;
        else if (t === "b") val = v === "1";
        else if (t === "e") val = null;
        else val = v !== undefined && v !== "" ? Number(v) : null;
        const r = rowIndex(ref);
        let row = grid.get(r);
        if (!row) grid.set(r, (row = new Map()));
        row.set(colIndex(ref), val);
    }
    return grid;
}

function extract(grid: Map<number, Map<number, Cell>>, range: { c0: number; r0: number; c1: number; r1: number }, source: string): SheetTable {
    const headers: string[] = [];
    const headRow = grid.get(range.r0);
    for (let c = range.c0; c <= range.c1; c++) headers.push(String(headRow?.get(c) ?? "").trim());
    const rows: Cell[][] = [];
    for (let r = range.r0 + 1; r <= range.r1; r++) {
        const row = grid.get(r);
        const cells: Cell[] = [];
        for (let c = range.c0; c <= range.c1; c++) cells.push(row?.get(c) ?? null);
        rows.push(cells);
    }
    return { source, headers, rows, firstRow: range.r0 + 1 };
}

/** Throws with a Bahasa Indonesia message when the file is not a readable workbook. */
export function readWorkbook(bytes: Uint8Array, preferTable = "Table1"): SheetTable {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(bytes);
    } catch {
        throw new Error("File bukan .xlsx yang valid (tidak bisa dibuka).");
    }
    const wbXml = files["xl/workbook.xml"];
    if (!wbXml) throw new Error("File bukan workbook Excel (.xlsx).");
    const shared: string[] = [];
    if (files["xl/sharedStrings.xml"]) {
        const ss = strFromU8(files["xl/sharedStrings.xml"]);
        const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(ss))) shared.push(texts(m[1]));
    }
    const wb = strFromU8(wbXml);
    const wbRels = rels(files, "xl/workbook.xml");
    const sheets: { name: string; path: string }[] = [];
    const sre = /<sheet\b[^>]*>/g;
    let s: RegExpExecArray | null;
    while ((s = sre.exec(wb))) {
        const rid = attr(s[0], "r:id");
        const path = rid ? wbRels.get(rid) : undefined;
        if (path && files[path]) sheets.push({ name: attr(s[0], "name") ?? path, path });
    }
    if (!sheets.length) throw new Error("Workbook tidak punya sheet.");

    // Excel tables, per sheet.
    const tables: { name: string; ref: string; sheet: { name: string; path: string } }[] = [];
    for (const sh of sheets) {
        for (const target of rels(files, sh.path).values()) {
            if (!/tables\/table\d+\.xml$/i.test(target) || !files[target]) continue;
            const tx = strFromU8(files[target]);
            const tag = /<table\b[^>]*>/.exec(tx)?.[0] ?? "";
            const ref = attr(tag, "ref");
            if (ref) tables.push({ name: attr(tag, "displayName") ?? attr(tag, "name") ?? "Table", ref, sheet: sh });
        }
    }
    const table = tables.find((t) => t.name.toLowerCase() === preferTable.toLowerCase()) ?? tables[0];
    if (table) {
        const grid = readSheet(strFromU8(files[table.sheet.path]), shared);
        return extract(grid, parseRange(table.ref), table.name);
    }
    const sh = sheets[0];
    const xml = strFromU8(files[sh.path]);
    const grid = readSheet(xml, shared);
    const dim = attr(/<dimension\b[^>]*>/.exec(xml)?.[0] ?? "", "ref");
    let range = dim && dim.includes(":") ? parseRange(dim) : null;
    if (!range) {
        const rs = Array.from(grid.keys());
        const cs = Array.from(grid.values()).flatMap((r) => Array.from(r.keys()));
        if (!rs.length) throw new Error("Sheet kosong.");
        range = { r0: Math.min(...rs), r1: Math.max(...rs), c0: Math.min(...cs), c1: Math.max(...cs) };
    }
    return extract(grid, range, sh.name);
}

/** Excel serial date (1900 system) → local yyyy-mm-dd. */
export function serialToDateKey(n: number): string {
    const ms = Math.round((n - 25569) * 86400000);
    const d = new Date(ms);
    const pad = (x: number): string => (x < 10 ? "0" + x : String(x));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Excel time fraction (or date+time serial) → minutes after midnight. */
export function serialToMinutes(n: number): number {
    const frac = n - Math.floor(n);
    return Math.round(frac * 1440) % 1440;
}
