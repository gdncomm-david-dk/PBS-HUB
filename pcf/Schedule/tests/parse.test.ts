import { buildLookups, jsonRecords, mapAccounts, mapBrands, mapHosts, mapSchedules, mapStudios } from "../Schedule/core/data";
import { headerField, parseHours, parseLooseDate, PdfPage, pdfSessions, sheetSessions, yearHint } from "../Schedule/core/layout";
import { checkParsed, createItem, matchBrand, matchHost, ResolveContext, resolveSession, shiftOf } from "../Schedule/core/parseResolve";
import { Cell, SheetGrid } from "../Schedule/core/xlsx";

const recs = (rows: Record<string, unknown>[]) => jsonRecords(JSON.stringify(rows)) ?? [];

// Made-up master lists in the shape of the real ones.
const brands = mapBrands(recs([
    { Title: "BRND-0001", NamaBrand: "ARUNA", Alias: "Arunakids" },
    { Title: "BRND-0003", NamaBrand: "SEMBADA" },
    { Title: "BRND-0004", NamaBrand: "KIRANA" },
]));
const accounts = mapAccounts(recs([
    { Title: "AC-001", AccountName: "arunakids.id - Tiktok", BrandID: "BRND-0001", Platform: "Tiktok" },
    { Title: "AC-002", AccountName: "arunajajan - Tiktok", BrandID: "BRND-0001", Platform: "Tiktok" },
    { Title: "AC-003", AccountName: "arunaofficial - Shopee", BrandID: "BRND-0001", Platform: "Shopee" },
    { Title: "AC-005", AccountName: "sembadastore - Tiktok", BrandID: "BRND-0003", Platform: "Tiktok" },
    { Title: "AC-006", AccountName: "sembadastore - Shopee", BrandID: "BRND-0003", Platform: "Shopee" },
    { Title: "AC-007", AccountName: "sembadanatural - Shopee", BrandID: "BRND-0003", Platform: "Shopee" },
    { Title: "AC-008", AccountName: "kirana - Tiktok", BrandID: "BRND-0004", Platform: "Tiktok" },
]));
const studios = mapStudios(recs([
    { Title: "CWG-04", NamaStudio: "Studio 4 Cawang", KapasitasHost: 1, Brands: "Arunakids, Inlite" },
    { Title: "CWG-05", NamaStudio: "Studio 5 Cawang", KapasitasHost: 1, Brands: "SEMBADA" },
    { Title: "TBN-02", NamaStudio: "Studio 2 Tubun", KapasitasHost: 1 },
]));
const hosts = mapHosts(recs([
    { Title: "HOST-0003", NamaHost: "Umi Nur Zakia", Alias: "Kia" },
    { Title: "HOST-0004", NamaHost: "Rina Maharani", Alias: "Uci" },
    { Title: "HOST-0012", NamaHost: "Nayla Armani" },
    { Title: "HOST-0031", NamaHost: "Nayla Bintari" },
    { Title: "FL-001", NamaHost: "Nayla Hana" },
    { Title: "HOST-0014", NamaHost: "Hana Nurhaliza" },
    { Title: "HOST-0028", NamaHost: "Wulan Anggun Putri" },
    { Title: "HOST-0005", NamaHost: "Azkia Putri" },
]));
const lk = buildLookups(brands, hosts, studios, accounts);
const schedules = mapSchedules(
    recs([{ Title: "SCD-1", Date: "2026-08-20", BrandID: "BRND-0004", StudioID: "TBN-02", HostID: "HOST-0004", StartTime: "10:00", EndTime: "12:00" }]),
    lk,
);
const cx: ResolveContext = { lk, brands, hosts, studios, accounts, schedules, platforms: ["Tiktok", "Shopee"] };
const studioName = (id: string) => id;

describe("layout helpers", () => {
    it("reads header words", () => {
        expect(["Start Hour", "End Hour", "Duratio n (in hours)", "Host", "Platform", "Date", "Day"].map(headerField)).toEqual(["start", "end", "duration", "host", "platform", "date", "day"]);
        expect(headerField("Aruna")).toBeNull();
    });
    it("parses loose dates", () => {
        expect(parseLooseDate("5 October", 2026)).toBe("2026-10-05");
        expect(parseLooseDate("Senin, 18 Agustus 2026", 2025)).toBe("2026-08-18");
        expect(parseLooseDate("05/10/2026", 2026)).toBe("2026-10-05");
        expect(parseLooseDate("Oct 9", 2026)).toBe("2026-10-09");
        expect(parseLooseDate(46266, 2026)).toBe("2026-09-01");
        expect(parseLooseDate("Selasa", 2026)).toBe("");
        expect(parseLooseDate("31 February", 2026)).toBe("");
    });
    it("parses hours", () => {
        expect([parseHours("5"), parseHours("1,5"), parseHours("1 jam 30 menit"), parseHours("45 menit"), parseHours(2.0000000000000009), parseHours("")]).toEqual([5, 1.5, 1.5, 0.75, 2, null]);
    });
    it("takes the year from the file name", () => {
        expect(yearHint("aruna_5-9_okt_2027.pdf", new Date(2026, 9, 1))).toBe(2027);
        expect(yearHint("aruna.pdf", new Date(2026, 9, 1))).toBe(2026);
    });
    it("names shifts by start time", () => {
        expect([shiftOf(0), shiftOf(719), shiftOf(720), shiftOf(1019), shiftOf(1020)]).toEqual(["Pagi", "Pagi", "Siang", "Siang", "Malam"]);
    });
});

describe("Excel layout", () => {
    // Row 1: brand titles merged over each block; row 3: headers; Day/Date merged over the sessions of a day.
    const g = new Map<number, Map<number, Cell>>();
    const set = (r: number, c: number, v: Cell): void => {
        if (!g.has(r)) g.set(r, new Map());
        (g.get(r) as Map<number, Cell>).set(c, v);
    };
    set(1, 4, "Arunakids");
    set(1, 10, "Sembada");
    ["Day", "Date"].forEach((h, i) => set(3, 1 + i, h));
    ["Start Hour", "End Hour", "Duration (in hours)", "Host", "Platform"].forEach((h, i) => {
        set(3, 4 + i, h);
        set(3, 10 + i, h);
    });
    set(4, 1, "Selasa");
    set(4, 2, 46266); // 2026-09-01
    set(4, 4, 0.79166666666666663); // 19:00
    set(4, 5, 1); // 24:00
    set(4, 6, 5.0000000000000009);
    set(4, 7, "Kia");
    set(4, 8, "Tiktok");
    set(4, 10, 0.375);
    set(4, 11, 0.54166666666666663);
    set(4, 12, 3.9999999999999991);
    set(4, 13, "Rina Maharani");
    set(4, 14, "Shopee");
    set(5, 10, 0.54166666666666663);
    set(5, 11, 0.66666666666666663);
    set(5, 12, 3);
    set(5, 13, "Azkia");
    set(5, 14, "Tiktok");
    set(6, 1, "Rabu");
    set(6, 2, 46267);
    set(6, 10, 0.375);
    set(6, 11, 0.5);
    set(6, 12, 3);
    set(6, 13, "Nayla");
    set(6, 14, "Tiktok");
    set(7, 4, "TOTAL HOURS");
    set(7, 5, "TOTAL HOURS");
    set(5, 30, 0.25); // scratch area right of the table, no header above
    const sheet: SheetGrid = { name: "September", grid: g, merges: [{ r0: 1, c0: 4, r1: 2, c1: 8 }, { r0: 1, c0: 10, r1: 2, c1: 14 }, { r0: 4, c0: 1, r1: 5, c1: 1 }, { r0: 4, c0: 2, r1: 5, c1: 2 }] };
    const r = sheetSessions("all.xlsx", [sheet], 2026);

    it("reads every block of every day", () => {
        expect(r.sessions.map((s) => [s.label, s.dateKey, s.startText, s.endText, s.duration, s.host, s.platform])).toEqual([
            ["Arunakids", "2026-09-01", "19:00", "00:00", 5, "Kia", "Tiktok"],
            ["Sembada", "2026-09-01", "09:00", "13:00", 4, "Rina Maharani", "Shopee"],
            ["Sembada", "2026-09-01", "13:00", "16:00", 3, "Azkia", "Tiktok"],
            ["Sembada", "2026-09-02", "09:00", "12:00", 3, "Nayla", "Tiktok"],
        ]);
        expect(r.skipped).toEqual([{ where: "September baris 7", text: "TOTAL HOURS · TOTAL HOURS" }]);
        expect(r.problem).toBe("");
    });

    it("resolves and checks the sessions", () => {
        const rows = r.sessions.map((s) => resolveSession(s, cx));
        const [a, b, c, d] = rows;
        // Title "Arunakids" names the account arunakids.id; the studio comes from Studio.Brands.
        expect([a.brandId, a.accountId, a.platform, a.studioId, a.studioFrom, a.hostId, a.shift, a.jamLive]).toEqual(["BRND-0001", "AC-001", "Tiktok", "CWG-04", "master", "HOST-0003", "Malam", 5]);
        // Two Sembada Shopee accounts: left for the user.
        expect([b.brandId, b.accountId, b.accountOptions, b.hostId]).toEqual(["BRND-0003", "", ["AC-006", "AC-007"], "HOST-0004"]);
        expect([c.accountId, c.hostId, c.studioId]).toEqual(["AC-005", "HOST-0005", "CWG-05"]);
        expect([d.hostId, d.hostOptions.length]).toEqual(["", 3]);

        const checked = checkParsed(rows, {}, cx, { todayKey: "2026-08-01", studioName });
        expect(checked.map((x) => x.verdict)).toEqual(["valid", "warning", "valid", "rejected"]);
        expect(checked[0].reasons).toEqual([]); // ends at 00:00: not a warning
        expect(checked[3].reasons[0]).toMatch(/cocok dengan 3 host/);

        const fixed = checkParsed(rows, { [d.id]: { hostId: "HOST-0012" }, [b.id]: { accountId: "AC-006" } }, cx, { todayKey: "2026-08-01", studioName });
        expect(fixed.map((x) => x.verdict)).toEqual(["valid", "valid", "valid", "valid"]);
        expect(createItem(fixed[0])).toMatchObject({ date: "2026-09-01", brandId: "BRND-0001", accountId: "AC-001", studioId: "CWG-04", hostId: "HOST-0003", platform: "Tiktok", startTime: "19:00", endTime: "00:00", jamLive: 5, position: "Main Host", totalAccount: 1, shift: "Malam", campaign: "Arunakids" });
    });
});

describe("PDF layout", () => {
    // Two pages of a one-brand export: the date label is centred in its merged cell, the sessions sit at the top,
    // and the third day starts at the bottom of page 1 and continues on page 2.
    const T = (x0: number, y: number, str: string) => ({ x0, x1: x0 + str.length * 5, y, h: 9, str });
    const H = (y: number, x0 = 50, x1 = 580) => ({ y, x0, x1 });
    const cols = [50, 100, 182, 237, 288, 340, 405, 518, 580];
    const V = (y0: number, y1: number) => cols.map((x) => ({ x, y0, y1 }));
    const page1: PdfPage = {
        no: 1,
        width: 842,
        height: 595,
        items: [
            T(380, 77, "Arunakids"),
            T(64, 128, "Day"), T(130, 128, "Date"),
            T(250, 118, "Start"), T(250, 139, "Hour"), T(302, 118, "End"), T(302, 139, "Hour"), T(346, 118, "Duration"), T(346, 139, "(in hours)"), T(452, 128, "Host"), T(527, 128, "Platform"),
            T(252, 168, "19:00"), T(305, 168, "0:00"), T(371, 168, "5"), T(426, 168, "Kia"), T(538, 168, "Tiktok"),
            T(63, 211, "Senin"), T(120, 211, "5 October"),
            T(252, 270, "21:00"), T(305, 270, "23:00"), T(371, 270, "2"), T(426, 270, "Rina Maharani"), T(538, 270, "Tiktok"),
            T(60, 336, "Selasa"), T(120, 336, "6 October"),
            T(252, 421, "19:00"), T(305, 421, "21:00"), T(371, 421, "2"), T(426, 421, "Azkia Putri"), T(538, 421, "Tiktok"),
            T(64, 503, "Rabu"), T(120, 503, "7 October"),
        ],
        h: [H(96, 237), H(159), H(178, 182), H(261), H(280, 182), H(410), H(430, 182), H(520, 182)],
        v: V(96, 560),
    };
    const page2: PdfPage = {
        no: 2,
        width: 842,
        height: 595,
        items: [T(64, 35, "Rabu"), T(120, 35, "7 October"), T(252, 136, "22:00"), T(304, 136, "0:00"), T(371, 136, "2"), T(426, 136, "Kia"), T(538, 136, "Tiktok"), T(62, 209, "Kamis"), T(120, 209, "8 October")],
        h: [H(60, 182), H(125), H(145, 182), H(290)],
        v: V(20, 300),
    };

    it("puts each session under the day block it sits in, across pages", () => {
        const r = pdfSessions("arunakids_5-8_okt_2026.pdf", [page1, page2], 2026);
        expect(r.sessions.map((s) => [s.where, s.label, s.dateKey, s.startText, s.endText, s.duration, s.host, s.platform])).toEqual([
            ["Hal. 1", "Arunakids", "2026-10-05", "19:00", "00:00", 5, "Kia", "Tiktok"],
            ["Hal. 1", "Arunakids", "2026-10-06", "21:00", "23:00", 2, "Rina Maharani", "Tiktok"],
            ["Hal. 1", "Arunakids", "2026-10-07", "19:00", "21:00", 2, "Azkia Putri", "Tiktok"],
            ["Hal. 2", "Arunakids", "2026-10-08", "22:00", "00:00", 2, "Kia", "Tiktok"],
        ]);
    });

    it("says why a scanned PDF gives nothing", () => {
        expect(pdfSessions("scan.pdf", [{ ...page2, items: [], h: [], v: [] }], 2026).problem).toMatch(/hasil scan/);
    });
});

describe("matching", () => {
    it("matches hosts by name, alias, first name and prefix", () => {
        expect(matchHost("Umi Nur Zakia", hosts).id).toBe("HOST-0003");
        expect(matchHost("uci", hosts).id).toBe("HOST-0004");
        expect(matchHost("Hana", hosts).id).toBe("HOST-0014"); // first name; "Nayla Hana" has it last
        expect(matchHost("Wulan Anggun", hosts).id).toBe("HOST-0028");
        expect(matchHost("Nayla", hosts)).toMatchObject({ id: "", options: ["HOST-0012", "HOST-0031", "FL-001"] });
        expect(matchHost("Budi", hosts).note).toMatch(/tidak ada di master Host/);
    });
    it("matches brands by name, alias and account handle, with a platform hint in brackets", () => {
        expect(matchBrand("SEMBADA", cx).brand?.brandId).toBe("BRND-0003");
        expect(matchBrand("Arunakids", cx).brand?.brandId).toBe("BRND-0001");
        expect(matchBrand("arunajajan", cx).account?.accountId).toBe("AC-002");
        expect(matchBrand("Aruna (Shopee)", cx)).toMatchObject({ platformHint: "Shopee" });
        expect(matchBrand("Requested", cx).brand).toBeUndefined();
    });
    it("takes the studio from history when Studio.Brands has nothing", () => {
        const s = resolveSession(
            { file: "f", group: "PDF", where: "Hal. 1", order: 0, label: "Kirana", dateKey: "2026-10-01", dateText: "", startMin: 600, endMin: 720, startText: "10:00", endText: "12:00", duration: null, host: "Uci", platform: "", studio: "", account: "" },
            cx,
        );
        expect([s.studioId, s.studioFrom, s.accountId, s.platform, s.jamLive]).toEqual(["TBN-02", "riwayat", "AC-008", "Tiktok", 2]);
    });
});

describe("conflict check", () => {
    it("warns when a parsed session overlaps one already scheduled", () => {
        const s = resolveSession(
            { file: "f", group: "PDF", where: "Hal. 1", order: 0, label: "Kirana", dateKey: "2026-08-20", dateText: "", startMin: 660, endMin: 780, startText: "11:00", endText: "13:00", duration: 2, host: "Uci", platform: "Tiktok", studio: "", account: "" },
            cx,
        );
        const [r] = checkParsed([s], {}, cx, { todayKey: "2026-08-01", studioName });
        expect(r.verdict).toBe("warning");
        expect(r.reasons.join(" ")).toMatch(/sudah dijadwalkan 10:00–12:00/);
    });
});

describe("duplicates and clashes", () => {
    const sess = (order: number, start: number, end: number, host: string, label = "Kirana") =>
        resolveSession({ file: "f.pdf", group: "PDF", where: `Hal. ${order + 1}`, order, label, dateKey: "2026-08-20", dateText: "", startMin: start, endMin: end, startText: "", endText: "", duration: null, host, platform: "Tiktok", studio: "", account: "" }, cx);

    it("flags a session already in Schedule, a repeated row and a host double-booking", () => {
        const rows = checkParsed(
            [sess(0, 600, 720, "Uci"), sess(1, 840, 960, "Kia"), sess(2, 840, 960, "Kia"), sess(3, 900, 1020, "Kia", "Arunakids")],
            {},
            cx,
            { todayKey: "2026-08-01", studioName },
        );
        expect(rows[0].flags).toMatchObject({ exists: "SCD-1", dup: "", clash: [] });
        expect(rows[0].reasons[0]).toBe("Sudah ada di Schedule (SCD-1)");
        expect(rows[1].flags).toMatchObject({ exists: "", dup: "" });
        expect(rows[2].flags.dup).toBe("Hal. 2");
        expect(rows[3].flags.clash.join(" ")).toMatch(/sudah dijadwalkan/);
        expect(rows.map((r) => r.flags.past)).toEqual([false, false, false, false]);
    });
});
