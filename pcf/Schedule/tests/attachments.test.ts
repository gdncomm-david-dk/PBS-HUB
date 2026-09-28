import { parseAttachments } from "../Schedule/core/attachments";

describe("parseAttachments", () => {
    it("groups schedule and report files, accepting SharePoint attachment field names", () => {
        const g = parseAttachments(
            {
                schedule: [{ DisplayName: "brief.pdf", AbsoluteUri: "https://x/brief.pdf" }],
                reports: [{ reportId: "REP-1", files: [{ name: "a.png", url: "https://x/a.png" }, { name: "no-url" }] }],
            },
            "SCD-1",
        );
        expect(g).toEqual([
            { source: "Jadwal SCD-1", files: [{ name: "brief.pdf", url: "https://x/brief.pdf" }] },
            { source: "Report REP-1", files: [{ name: "a.png", url: "https://x/a.png" }] },
        ]);
    });
    it("tolerates a missing or malformed reply", () => {
        expect(parseAttachments({}, "SCD-2")).toEqual([{ source: "Jadwal SCD-2", files: [] }]);
        expect(parseAttachments({ schedule: "x", reports: [null] }, "SCD-3")).toEqual([{ source: "Jadwal SCD-3", files: [] }, { source: "Report ", files: [] }]);
    });
});
