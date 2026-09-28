import { linksFrom } from "../Schedule/core/attachments";

describe("linksFrom (Report.Attachment)", () => {
    it("reads a Hyperlink column", () => {
        expect(linksFrom({ Url: "https://x.sharepoint.com/a/REP-1.png", Description: "Bukti REP-1" })).toEqual([{ name: "Bukti REP-1", url: "https://x.sharepoint.com/a/REP-1.png" }]);
    });
    it("reads an Image column, as object or JSON text", () => {
        const img = { serverUrl: "https://x.sharepoint.com", serverRelativeUrl: "/sites/s/Lists/Report/Attachments/1/shot.png", fileName: "shot.png" };
        const want = [{ name: "shot.png", url: "https://x.sharepoint.com/sites/s/Lists/Report/Attachments/1/shot.png" }];
        expect(linksFrom(img)).toEqual(want);
        expect(linksFrom(JSON.stringify(img))).toEqual(want);
    });
    it("reads one or more URLs from plain text", () => {
        expect(linksFrom("https://x/a%20b.pdf; https://x/c.png\nhttps://x/c.png")).toEqual([
            { name: "a b.pdf", url: "https://x/a%20b.pdf" },
            { name: "c.png", url: "https://x/c.png" },
        ]);
    });
    it("reads rich text from an enhanced multiple lines of text column", () => {
        expect(linksFrom('<div><a href="https://x/f.png?a=1&amp;b=2">f.png</a><br>https://x/g.pdf</div>')).toEqual([
            { name: "f.png", url: "https://x/f.png?a=1&b=2" },
            { name: "g.pdf", url: "https://x/g.pdf" },
        ]);
    });
    it("returns nothing for empty or non-link values", () => {
        expect(linksFrom(null)).toEqual([]);
        expect(linksFrom("")).toEqual([]);
        expect(linksFrom("belum ada")).toEqual([]);
        expect(linksFrom(12)).toEqual([]);
    });
});
