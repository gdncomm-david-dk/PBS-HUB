// Host report vs Report Automation (AI OCR): the fields both carry, side by side.

import { EvidenceRow, Metric, ReportRow, ScheduleRow } from "./types";
import { timeRange } from "./schedule";
import { isMoney, KNOWN_METRIC } from "./metrics";

const rp = (n: number | null): string => (n === null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null): string => (n === null ? "—" : n.toLocaleString("id-ID"));

export interface Line {
    label: string;
    host: string;
    ai: string;
    /** true = same, false = differs, null = one side is missing */
    same: boolean | null;
    diff?: string;
}

function numLine(label: string, h: number | null, a: number | null, fmt: (n: number | null) => string): Line {
    if (h === null || a === null) return { label, host: fmt(h), ai: fmt(a), same: null };
    const d = a - h;
    return { label, host: fmt(h), ai: fmt(a), same: d === 0, diff: d === 0 ? undefined : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d)).replace(/^Rp /, "Rp ")}` };
}

const hhmm = (t: string): string => {
    const m = /(\d{1,2})[:.](\d{2})/.exec(t);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : t.trim();
};

/** Host report vs Report Automation (AI OCR), field by field. */
export function compareReport(r: ReportRow, e: EvidenceRow | null, s: ScheduleRow): Line[] {
    // A fixed line falls back to any column of the same family when the usual name is not there
    // (e.g. Report Automation calls it "Durasi Live").
    const fam = (ms: Metric[] | undefined, test: (k: string) => boolean): number | null => ms?.find((m) => test(m.key))?.value ?? null;
    const isDur = (k: string): boolean => k.startsWith("durasi");
    const lines = [
        numLine("Penjualan (GMV)", r.penjualan, e?.penjualan ?? null, rp),
        numLine("Pesanan", r.pesanan, e?.pesanan ?? null, num),
        numLine("Total viewer", r.totalViewer, e?.totalViewer ?? null, num),
        numLine("Durasi (menit)", r.durasiMin ?? fam(r.metrics, isDur), e ? e.durasiMin ?? fam(e.metrics, isDur) : null, num),
    ];
    const aiTime = e && (e.startHour || e.endHour) ? `${hhmm(e.startHour)}–${hhmm(e.endHour)}` : "—";
    const planned = timeRange(s);
    lines.push({ label: "Jam live", host: planned, ai: aiTime, same: aiTime === "—" ? null : aiTime === planned.replace(/\s/g, "") });

    // Every other numeric column either list carries, paired by name (Report first, then Report Automation).
    const host = new Map(r.metrics.map((m) => [m.key, m]));
    const ai = new Map((e?.metrics ?? []).map((m) => [m.key, m]));
    const keys = [...new Set([...host.keys(), ...ai.keys()])].filter((k) => !KNOWN_METRIC(k));
    for (const k of keys) {
        const label = (host.get(k) ?? ai.get(k))!.label;
        lines.push(numLine(label, host.get(k)?.value ?? null, ai.get(k)?.value ?? null, isMoney(k) ? rp : num));
    }
    return lines;
}

