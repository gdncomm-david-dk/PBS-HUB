// Canvas reply for OPEN_ATTACHMENTS → groups of file links. The control cannot read SharePoint attachments itself.

export interface FileLink {
    name: string;
    url: string;
}
export interface Group {
    source: string;
    files: FileLink[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const files = (v: unknown): FileLink[] =>
    (Array.isArray(v) ? v : [])
        .map((f: Record<string, unknown>) => ({ name: str(f?.name ?? f?.DisplayName), url: str(f?.url ?? f?.AbsoluteUri) }))
        .filter((f) => f.url);

/** Reads the canvas reply: { schedule: [{name,url}], reports: [{reportId, files: [{name,url}]}] }. */
export function parseAttachments(data: Record<string, unknown>, scheduleId: string): Group[] {
    const out: Group[] = [{ source: `Jadwal ${scheduleId}`, files: files(data.schedule) }];
    for (const r of Array.isArray(data.reports) ? (data.reports as Record<string, unknown>[]) : []) out.push({ source: `Report ${str(r?.reportId)}`, files: files(r?.files) });
    return out;
}
