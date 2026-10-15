// PDF → positioned text and table lines, read in the browser with pdf.js (no AI, no flow).
// The worker module is bundled and registered on globalThis, so pdf.js runs on the main thread: a PCF bundle
// cannot ship a separate worker file. Schedule PDFs are a few pages, so this stays fast.

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { PdfPage } from "./layout";

const register = (): void => {
    (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
};
register();

/** Rejects with `label` when `p` does not settle within `ms`: a stuck step must end in a message, not a spinner. */
function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_resolve, reject) => {
        t = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([p, late]).finally(() => clearTimeout(t));
}
const STEP_MS = 20000;
/** Lets the browser paint between pages (pdf.js runs on the main thread here). */
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Seg = { t: "r"; x: number; y: number; w: number; h: number; stroke: boolean } | { t: "l"; x1: number; y1: number; x2: number; y2: number };

/** Matrix product a·b for PDF 6-element matrices. */
const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Opens the PDF. Throws with a Bahasa Indonesia message when it is not a readable PDF. */
async function openDoc(bytes: Uint8Array): Promise<pdfjs.PDFDocumentProxy> {
    // Set again per open: another script on the page may have replaced the global with its own pdf.js.
    register();
    // pdf.js may take ownership of the buffer it is given; each open gets its own copy.
    const task = pdfjs.getDocument({
        data: bytes.slice(),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
        verbosity: 0,
    });
    try {
        return await within(task.promise, STEP_MS, "timeout");
    } catch (e) {
        void task.destroy();
        const msg = e instanceof Error ? e.message : "";
        throw new Error(
            /password/i.test(msg)
                ? "PDF dikunci password."
                : msg === "timeout"
                  ? "PDF tidak selesai dibuka dalam 20 detik di browser ini. Coba upload versi Excel-nya, atau simpan ulang PDF-nya (Print → Save as PDF) lalu upload lagi."
                  : `File bukan PDF yang valid (tidak bisa dibuka)${msg ? `: ${msg}` : ""}.`,
        );
    }
}

const close = (doc: pdfjs.PDFDocumentProxy): Promise<void> => within(doc.destroy(), 5000, "close").catch(() => undefined);

/**
 * Reads every page with its own freshly opened document: in some Power Apps hosts a second page read from the same
 * document never settles, while a first read always does. A page that still times out is tried once more. Every
 * pdf.js step has a time limit; when only the table borders cannot be read, the page is read from its text alone
 * (layout falls back to text gaps).
 */
export async function readPdf(bytes: Uint8Array, onPage?: (page: number, total: number) => void): Promise<PdfPage[]> {
    let doc: pdfjs.PDFDocumentProxy | null = await openDoc(bytes);
    const total = doc.numPages;
    const pages: PdfPage[] = [];
    try {
        for (let p = 1; p <= total; p++) {
            onPage?.(p, total);
            await breathe();
            for (let attempt = 1; ; attempt++) {
                const cur: pdfjs.PDFDocumentProxy = doc ?? (await openDoc(bytes));
                doc = null;
                try {
                    pages.push(await readPage(cur, p));
                    break;
                } catch (err) {
                    if (attempt >= 2) throw err;
                } finally {
                    await close(cur);
                }
            }
        }
    } finally {
        if (doc) await close(doc);
    }
    return pages;
}

async function readPage(doc: pdfjs.PDFDocumentProxy, p: number): Promise<PdfPage> {
    const OPS = pdfjs.OPS;
    const page = await within(doc.getPage(p), STEP_MS, `Halaman ${p} tidak bisa dibuka (melebihi 20 detik).`);
    const vp = page.getViewport({ scale: 1 });
    const H = vp.height;
    const tc = await within(page.getTextContent(), STEP_MS, `Teks halaman ${p} tidak terbaca (melebihi 20 detik).`);
    const items: PdfPage["items"] = [];
    for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [a, b, c, d, e, f] = it.transform as number[];
        const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 8;
        const x0 = e;
        items.push({ x0, x1: x0 + (it.width || size * it.str.length * 0.5), y: H - f - size * 0.3, h: size, str: it.str.trim() });
    }

    // Table borders: Excel/Sheets exports draw them as thin filled rectangles or stroked lines.
    // Borders only help; a page whose drawing cannot be read in time is read from its text alone.
    const ol = await within(page.getOperatorList(), STEP_MS, "ops").catch(() => ({ fnArray: [] as number[], argsArray: [] as unknown[] }));
    const segs: Seg[] = [];
    let pending: Seg[] = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i];
        const args = ol.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(args as number[], ctm);
        else if (fn === OPS.constructPath) {
            const ops = args[0] as number[];
            const co = args[1] as number[];
            let k = 0;
            let cx = 0;
            let cy = 0;
            for (const op of ops) {
                if (op === OPS.rectangle) {
                    const [x, y, w, h] = co.slice(k, k + 4);
                    k += 4;
                    const [px, py] = apply(ctm, x, y);
                    const [qx, qy] = apply(ctm, x + w, y + h);
                    pending.push({ t: "r", x: Math.min(px, qx), y: Math.min(py, qy), w: Math.abs(qx - px), h: Math.abs(qy - py), stroke: false });
                } else if (op === OPS.moveTo) {
                    [cx, cy] = apply(ctm, co[k], co[k + 1]);
                    k += 2;
                } else if (op === OPS.lineTo) {
                    const [x, y] = apply(ctm, co[k], co[k + 1]);
                    k += 2;
                    pending.push({ t: "l", x1: cx, y1: cy, x2: x, y2: y });
                    cx = x;
                    cy = y;
                } else if (op === OPS.curveTo) k += 6;
                else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
            }
        } else if (fn === OPS.stroke || fn === OPS.closeStroke) {
            for (const s of pending) segs.push(s.t === "r" ? { ...s, stroke: true } : s);
            pending = [];
        } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
            for (const s of pending) segs.push(s);
            pending = [];
        } else if (fn === OPS.endPath) pending = [];
    }
    const h: PdfPage["h"] = [];
    const v: PdfPage["v"] = [];
    for (const s of segs) {
        if (s.t === "l") {
            if (Math.abs(s.y1 - s.y2) < 0.6 && Math.abs(s.x1 - s.x2) > 3) h.push({ y: H - s.y1, x0: Math.min(s.x1, s.x2), x1: Math.max(s.x1, s.x2) });
            else if (Math.abs(s.x1 - s.x2) < 0.6 && Math.abs(s.y1 - s.y2) > 3) v.push({ x: s.x1, y0: H - Math.max(s.y1, s.y2), y1: H - Math.min(s.y1, s.y2) });
        } else if (s.stroke) {
            // A stroked rectangle is four borders.
            h.push({ y: H - s.y, x0: s.x, x1: s.x + s.w }, { y: H - s.y - s.h, x0: s.x, x1: s.x + s.w });
            v.push({ x: s.x, y0: H - s.y - s.h, y1: H - s.y }, { x: s.x + s.w, y0: H - s.y - s.h, y1: H - s.y });
        } else if (s.h < 2.5 && s.w > 3) h.push({ y: H - s.y - s.h / 2, x0: s.x, x1: s.x + s.w });
        else if (s.w < 2.5 && s.h > 3) v.push({ x: s.x + s.w / 2, y0: H - s.y - s.h, y1: H - s.y });
    }
    return { no: p, width: vp.width, height: H, items, h, v };
}
