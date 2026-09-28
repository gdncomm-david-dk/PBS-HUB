// File links for the Lampiran dialog, read from the Report list's Attachment column.

export interface FileLink {
    name: string;
    url: string;
}
const URL_RE = /https?:\/\/[^\s,;"'<>\]]+/gi;

const nameOf = (url: string): string => {
    const last = url.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? url;
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
};

/**
 * File links from a Report column such as `Attachment`: a Hyperlink ({Url, Description}), an Image column
 * ({serverUrl, serverRelativeUrl, fileName}), JSON text of either, or multiple lines of text (plain or rich)
 * holding one or more URLs.
 */
export function linksFrom(v: unknown, depth = 0): FileLink[] {
    if (v === null || v === undefined || depth > 4) return [];
    if (Array.isArray(v)) return dedupe(v.flatMap((x) => linksFrom(x, depth + 1)));
    if (typeof v === "string") {
        const t = v.trim();
        if (!t) return [];
        if (/^[[{]/.test(t)) {
            try {
                return linksFrom(JSON.parse(t), depth + 1);
            } catch {
                // not JSON; fall through to URL scan
            }
        }
        // Rich text (Enhanced multiple lines of text) escapes & inside href.
        const text = t.replace(/&amp;/gi, "&");
        return dedupe((text.match(URL_RE) ?? []).map((url) => ({ name: nameOf(url), url })));
    }
    if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        const s = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
        const label = s("Description") || s("description") || s("fileName") || s("FileName") || s("DisplayName") || s("Name") || s("name");
        const direct = s("Url") || s("url") || s("AbsoluteUri") || s("Full") || s("Value") || s("value");
        const server = s("serverUrl") && s("serverRelativeUrl") ? s("serverUrl").replace(/\/$/, "") + s("serverRelativeUrl") : "";
        const url = server || (/^https?:\/\//i.test(direct) ? direct : "");
        if (url) return [{ name: label && !/^https?:/i.test(label) ? label : nameOf(url), url }];
        return dedupe(Object.values(o).flatMap((x) => linksFrom(x, depth + 1)));
    }
    return [];
}

function dedupe(xs: FileLink[]): FileLink[] {
    const seen = new Set<string>();
    return xs.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}
