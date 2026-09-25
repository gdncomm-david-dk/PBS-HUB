import { strToU8, zipSync } from "fflate";
import { approvalKind, buildLookups, jsonRecords, mapAccounts, mapBrands, mapEvidence, mapHosts, mapReports, mapSchedules, mapStudios } from "../Schedule/core/data";
import { applyFilters, conflictIndex, conflictsFor, Evidence, phaseOf, weekStart } from "../Schedule/core/schedule";
import { buildTimeline } from "../Schedule/core/timeline";
import { compareReport } from "../Schedule/core/review";
import { readWorkbook, serialToDateKey, serialToMinutes } from "../Schedule/core/xlsx";
import { bytesToBase64, checkFile, errorCsv, mapHeaders, uploadName } from "../Schedule/core/import";

const recs = (rows: Record<string, unknown>[]) => jsonRecords(JSON.stringify(rows)) ?? [];

const brands = mapBrands(recs([{ Title: "BR-01", NamaBrand: "Aruna" }, { Title: "BR-02", NamaBrand: "Kirana", Status: "Inactive" }]));
const hosts = mapHosts(recs([{ Title: "HST-1", NamaHost: "Dinda" }, { Title: "HST-2", NamaHost: "Rani" }, { Title: "HST-3", NamaHost: "Sari" }]));
const studios = mapStudios(recs([{ Title: "CWG-05", NamaStudio: "Kemang B", KapasitasHost: 2 }, { Title: "BSD-02", NamaStudio: "BSD", KapasitasHost: 1 }]));
const accounts = mapAccounts(recs([{ Title: "ACC-1", AccountName: "aruna.official", BrandID: "BR-01", Platform: "TikTok" }, { Title: "ACC-2", AccountName: "kirana.id", BrandID: "BR-02", Platform: "Shopee" }]));
const lk = buildLookups(brands, hosts, studios, accounts);
const studioName = (id: string) => lk.studios.get(id.toLowerCase())?.namaStudio || id;

const sched = (rows: Record<string, unknown>[]) => mapSchedules(recs(rows), lk);

describe("mapSchedules", () => {
    it("resolves names and parses text times, overnight included", () => {
        const [a, b] = sched([
            { Title: "SCD-1", Date: "2026-09-23", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-1", Account: "ACC-1", StartTime: "14.00", EndTime: "16:30", Status: { Value: "Planned" } },
            { Title: "SCD-2", Date: "2026-09-23", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-1", StartTime: "22:00", EndTime: "02:00" },
        ]);
        expect(a.brandName).toBe("Aruna");
        expect(a.hostName).toBe("Dinda");
        expect(a.accountName).toBe("aruna.official");
        expect([a.startMin, a.endMin]).toEqual([840, 990]);
        expect(a.status).toBe("Planned");
        expect([b.startMin, b.endMin]).toEqual([1320, 1560]);
    });
});

describe("conflicts", () => {
    const rows = sched([
        { Title: "SCD-1", Date: "2026-09-23", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-1", StartTime: "14:00", EndTime: "16:00" },
        { Title: "SCD-2", Date: "2026-09-23", BrandID: "BR-01", StudioID: "BSD-02", HostID: "HST-1", StartTime: "15:00", EndTime: "17:00" },
        { Title: "SCD-3", Date: "2026-09-23", BrandID: "BR-01", StudioID: "BSD-02", HostID: "HST-2", StartTime: "16:00", EndTime: "18:00" },
        { Title: "SCD-4", Date: "2026-09-23", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-3", StartTime: "16:00", EndTime: "18:00" },
        { Title: "SCD-5", Date: "2026-09-23", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-2", StartTime: "14:00", EndTime: "16:00", Status: "Cancelled" },
    ]);
    const idx = conflictIndex(rows, lk.studios, studioName);

    it("flags a host booked twice at overlapping times", () => {
        expect(idx.get(rows[0].key)?.map((c) => c.kind)).toEqual(["host"]);
        expect(idx.get(rows[0].key)?.[0].message).toContain("Dinda");
    });
    it("flags a studio over its host capacity", () => {
        // BSD-02 holds 1 host: HST-1 15-17 and HST-2 16-18 overlap at 16:00.
        const c = idx.get(rows[2].key) ?? [];
        expect(c.map((x) => x.kind)).toEqual(["studio"]);
        expect(c[0].message).toContain("kapasitas 1");
    });
    it("back-to-back sessions and cancelled sessions do not conflict", () => {
        expect(idx.has(rows[3].key)).toBe(false);
        expect(idx.has(rows[4].key)).toBe(false);
    });
    it("catches an overnight session clashing with the next morning", () => {
        const r = sched([
            { Title: "A", Date: "2026-09-23", StudioID: "CWG-05", HostID: "HST-1", StartTime: "23:00", EndTime: "03:00" },
            { Title: "B", Date: "2026-09-24", StudioID: "BSD-02", HostID: "HST-1", StartTime: "01:00", EndTime: "04:00" },
        ]);
        const c = conflictsFor({ ...r[1] }, r, lk.studios, { host: (o) => o.hostName, studio: studioName });
        expect(c.map((x) => x.kind)).toEqual(["host"]);
    });
    it("filters to conflicting sessions only", () => {
        const f = { from: "2026-09-01", to: "2026-09-30", brandId: "", hostId: "", studioId: "", platform: "", status: "", q: "", only: "conflict" as const };
        expect(applyFilters(rows, f, { conflicts: idx, missingReport: () => false }).map((s) => s.scheduleId)).toEqual(["SCD-1", "SCD-2", "SCD-3"]);
    });
});

describe("week and phase", () => {
    it("starts weeks on Monday", () => {
        expect(weekStart("2026-09-23")).toBe("2026-09-21");
        expect(weekStart("2026-09-27")).toBe("2026-09-21");
        expect(weekStart("2026-09-28")).toBe("2026-09-28");
    });
    it("knows upcoming, live and ended", () => {
        const [s] = sched([{ Title: "X", Date: "2026-09-23", StudioID: "CWG-05", HostID: "HST-1", StartTime: "14:00", EndTime: "16:00" }]);
        expect(phaseOf(s, new Date(2026, 8, 23, 13, 0))).toBe("upcoming");
        expect(phaseOf(s, new Date(2026, 8, 23, 15, 0))).toBe("live");
        expect(phaseOf(s, new Date(2026, 8, 23, 16, 0))).toBe("ended");
    });
});

describe("timeline", () => {
    const [s] = sched([{ Title: "SCD-9", Date: "2026-09-20", BrandID: "BR-01", StudioID: "CWG-05", HostID: "HST-1", StartTime: "10:00", EndTime: "12:00" }]);
    it("stalls at Report host with a reminder when no report came in", () => {
        const ev = new Evidence([], [], [], []);
        const steps = buildTimeline(s, ev, new Date(2026, 8, 22, 9, 0));
        const rep = steps.find((x) => x.id === "report");
        expect(rep?.state).toBe("active");
        expect(rep?.todo).toBe("Report belum masuk — host belum submit, 1 hari setelah sesi.");
        expect(rep?.remind).toBe(true);
        expect(ev.isLocked(s)).toBe(false);
    });
    it("completes and locks the session once the report is approved", () => {
        const reports = mapReports(recs([{ Title: "RPT-1", ScheduleID: "SCD-9", Penjualan: 1500000, ApprovalStatus: "Done", Match: "Match" }]));
        const ev = new Evidence(reports, [{ key: "a", absId: "ABS-1", scheduleId: "SCD-9", hostId: "HST-1", status: "Present", keterangan: "", dateKey: "2026-09-20" }], [], [{ key: "e", itemId: 7, title: "RPT-1", scheduleId: "SCD-9", status: "Match", penjualan: 1500000, pesanan: null, totalViewer: null, durasiMin: null, startHour: "10:00", endHour: "12:00" }]);
        const steps = buildTimeline(s, ev, new Date(2026, 8, 22, 9, 0));
        expect(steps.map((x) => x.state)).toEqual(["done", "failed", "done", "done", "done", "done", "pending"]);
        expect(ev.isLocked(s)).toBe(true);
    });
    it("skips every later step for a cancelled session", () => {
        const [c] = sched([{ Title: "SCD-10", Date: "2026-09-20", StudioID: "CWG-05", HostID: "HST-1", StartTime: "10:00", EndTime: "12:00", Status: "Cancelled" }]);
        const steps = buildTimeline(c, new Evidence([], [], [], []), new Date(2026, 8, 22));
        expect(steps.slice(1).every((x) => x.state === "skipped")).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------
// xlsx

type C = string | number | null;
function makeXlsx(rows: C[][], opts: { table?: string } = {}): Uint8Array {
    const shared: string[] = [];
    const si = (s: string) => {
        let i = shared.indexOf(s);
        if (i < 0) i = shared.push(s) - 1;
        return i;
    };
    const col = (i: number) => String.fromCharCode(65 + i);
    const sheetRows = rows
        .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === null ? "" : typeof v === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join("")}</row>`)
        .join("");
    const ref = `A1:${col(rows[0].length - 1)}${rows.length}`;
    const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Jadwal" sheetId="1" r:id="rId1"/></sheets></workbook>`),
        "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
        "xl/worksheets/sheet1.xml": strToU8(`<worksheet><dimension ref="${ref}"/><sheetData>${sheetRows}</sheetData></worksheet>`),
        "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`),
    };
    if (opts.table) {
        files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(`<Relationships><Relationship Id="rId9" Target="../tables/table1.xml"/></Relationships>`);
        files["xl/tables/table1.xml"] = strToU8(`<table id="1" name="${opts.table}" displayName="${opts.table}" ref="${opts.table === "Table1" ? `A2:${col(rows[0].length - 1)}${rows.length}` : ref}"/>`);
    }
    return zipSync(files);
}

describe("xlsx reader", () => {
    it("converts Excel serials", () => {
        expect(serialToDateKey(46288)).toBe("2026-09-23");
        expect(serialToMinutes(0.583333333)).toBe(840);
        expect(serialToMinutes(46288.75)).toBe(1080);
    });
    it("reads Table1 when present, ignoring a title row above it", () => {
        const bytes = makeXlsx(
            [
                ["Jadwal September", null, null],
                ["Date", "BrandID", "HostID"],
                [46288, "BR-01", "HST-1"],
            ],
            { table: "Table1" },
        );
        const t = readWorkbook(bytes);
        expect(t.source).toBe("Table1");
        expect(t.headers).toEqual(["Date", "BrandID", "HostID"]);
        expect(t.rows).toEqual([[46288, "BR-01", "HST-1"]]);
        expect(t.firstRow).toBe(3);
    });
    it("falls back to the first sheet and rejects non-xlsx bytes", () => {
        const t = readWorkbook(makeXlsx([["A"], ["x & y"]]));
        expect(t.source).toBe("Jadwal");
        expect(t.rows[0][0]).toBe("x & y");
        expect(() => readWorkbook(strToU8("not a zip"))).toThrow(/bukan/i);
    });
});

describe("bulk import check", () => {
    const head = ["Tanggal", "Brand ID", "Studio ID", "Host ID", "Start Time", "End Time", "Account", "Brand"];
    const existing = sched([{ Title: "SCD-50", Date: "2026-09-30", BrandID: "BR-01", StudioID: "BSD-02", HostID: "HST-2", StartTime: "10:00", EndTime: "12:00" }]);
    const cx = { lk, existing, todayKey: "2026-09-23", studioName };

    it("maps header aliases and reports missing required columns", () => {
        expect(mapHeaders(head).missing).toEqual([]);
        expect(mapHeaders(["Date", "HostID"]).missing).toEqual(["brandId", "studioId", "start", "end"]);
    });

    it("gives each row a verdict with reasons", () => {
        const bytes = makeXlsx([
            head,
            [46295, "BR-01", "CWG-05", "HST-1", 0.4166667, 0.5, "ACC-1", "Aruna Sept"], // valid (Sep 30 10-12)
            [46295, "BR-99", "CWG-05", "HST-1", "10:00", "12:00", null, null], // unknown brand
            [46295, "BR-01", "BSD-02", "HST-2", "11:00", "13:00", "ACC-2", null], // host clash + account of other brand
            [46288, "BR-01", "Kemang B", "Dinda", "08:00", "08:00", null, null], // start = end, names resolve
            [null, null, null, null, null, null, null, null], // blank row, skipped
            [46280, "BR-02", "CWG-05", "HST-3", "20:00", "22:00", null, null], // past + inactive brand
        ]);
        const c = checkFile("sept.xlsx", readWorkbook(bytes), cx);
        expect(c.counts).toEqual({ total: 5, valid: 1, warning: 2, rejected: 2 });
        expect(c.rows[0]).toMatchObject({ verdict: "valid", dateKey: "2026-09-30", startMin: 600, endMin: 720, brandName: "Aruna" });
        expect(c.rows[1].reasons).toEqual(["BrandID BR-99 tidak ada di master Brand"]);
        expect(c.rows[2].verdict).toBe("warning");
        expect(c.rows[2].reasons.join(" | ")).toMatch(/milik brand lain.*Host Rani sudah dijadwalkan 10:00–12:00/);
        expect(c.rows[3]).toMatchObject({ verdict: "rejected", studioId: "CWG-05", hostId: "HST-1" });
        expect(c.rows[4].reasons).toEqual(["Brand Kirana tidak aktif", "Tanggal sudah lewat"]);
        expect(c.rows[1].excelRow).toBe(3);
        const csv = errorCsv([c]);
        expect(csv.split("\r\n")).toHaveLength(1 + 4);
    });

    it("flags two rows of the same file that clash with each other", () => {
        const bytes = makeXlsx([head, [46295, "BR-01", "CWG-05", "HST-1", "14:00", "16:00"], [46295, "BR-01", "CWG-05", "HST-1", "15:00", "17:00"]]);
        const c = checkFile("f.xlsx", readWorkbook(bytes), cx);
        expect(c.rows.map((r) => r.verdict)).toEqual(["warning", "warning"]);
    });
});

describe("upload helpers", () => {
    it("stamps file names with a 24-hour clock and strips unsafe characters", () => {
        expect(uploadName("jadwal: sept#1.xlsx", new Date(2026, 8, 23, 18, 5, 9))).toBe("230926180509_jadwal_ sept_1.xlsx");
    });
    it("base64-encodes bytes in chunks", () => {
        const big = new Uint8Array(100000).map((_, i) => i % 256);
        expect(Buffer.from(bytesToBase64(big), "base64").equals(Buffer.from(big))).toBe(true);
    });
});

describe("brand and host names", () => {
    it("resolves names when the key is a BrandID/HostID column, a lookup, or the SharePoint ID", () => {
        const b = mapBrands(recs([{ ID: 7, Title: "Aruna Beauty", BrandID: "BR-07" }]));
        const h = mapHosts(recs([{ ID: 9, Title: "HST-9", HostName: "Dinda Maharani" }]));
        const l = buildLookups(b, h, [], []);
        const [a, c, d, e] = mapSchedules(
            recs([
                { Title: "SCD-1", Date: "2026-09-24", BrandID: "BR-07", HostID: "HST-9", StartTime: "08:00", EndTime: "10:00" },
                { Title: "SCD-2", Date: "2026-09-24", BrandID: { Id: 7, Value: "whatever" }, HostID: { Id: 9, Value: "x" }, StartTime: "08:00", EndTime: "10:00" },
                { Title: "SCD-3", Date: "2026-09-24", BrandID: "Aruna Beauty", HostID: "HST-9", StartTime: "08:00", EndTime: "10:00" },
                { Title: "SCD-4", Date: "2026-09-24", BrandID: "BR-99", HostID: "HST-0", StartTime: "08:00", EndTime: "10:00" },
            ]),
            l,
        );
        expect([a.brandName, a.hostName, a.brandKnown]).toEqual(["Aruna Beauty", "Dinda Maharani", true]);
        expect([c.brandName, c.brandId, c.hostName]).toEqual(["Aruna Beauty", "BR-07", "Dinda Maharani"]);
        expect([d.brandName, d.brandId]).toEqual(["Aruna Beauty", "BR-07"]);
        expect([e.brandName, e.brandKnown, e.hostKnown]).toEqual(["BR-99", false, false]);
    });
});

describe("live break, Co-Host and review", () => {
    const base = { Date: "2026-09-20", StudioID: "CWG-05", HostID: "HST-1", StartTime: "10:00", EndTime: "12:00", Status: "Finished" };
    const now = new Date(2026, 8, 22, 9, 0);
    it("needs no report for LiveBreak = Yes or Position = Co-Host", () => {
        const [lb, co, main] = sched([
            { ...base, Title: "SCD-20", LiveBreak: { Value: "Yes" }, Position: { Value: "Main Host" } },
            { ...base, Title: "SCD-21", LiveBreak: { Value: "No" }, Position: { Value: "Co-Host" } },
            { ...base, Title: "SCD-22", LiveBreak: { Value: "No" }, Position: { Value: "Main Host" } },
        ]);
        const ev = new Evidence([], [], [], []);
        expect([lb, co, main].map((x) => ev.noReportReason(x))).toEqual(["livebreak", "cohost", null]);
        expect(buildTimeline(lb, ev, now).find((x) => x.id === "report")?.state).toBe("skipped");
        expect(buildTimeline(co, ev, now).find((x) => x.id === "report")?.when).toBe("Co-Host");
    });
    it("treats a LiveBreak report row as no report, and a real report on a Co-Host session normally", () => {
        const [a, b] = sched([
            { ...base, Title: "SCD-30" },
            { ...base, Title: "SCD-31", Position: { Value: "Co-Host" } },
        ]);
        const ev = new Evidence(
            mapReports(recs([
                { Title: "REP-30", ScheduleID: "SCD-30", Penjualan: 0, ApprovalStatus: "LiveBreak" },
                { Title: "REP-31", ScheduleID: "SCD-31", Penjualan: 100, ApprovalStatus: "Waiting Approval" },
            ])),
            [], [], [],
        );
        expect(ev.noReportReason(a)).toBe("livebreak");
        expect(ev.noReportReason(b)).toBeNull();
    });
    it("reads the five approval statuses", () => {
        expect(["Done", "LiveBreak", "Need Revision", "Waiting Approval", "Waiting Approval Revision"].map(approvalKind)).toEqual(["done", "livebreak", "revision", "waiting", "waitingRevision"]);
    });
    it("joins Report Automation by Title and compares host vs AI", () => {
        const [s1] = sched([{ ...base, Title: "SCD-40" }]);
        const reports = mapReports(recs([{ ID: 5, Title: "REP-120", ScheduleID: "SCD-40", Penjualan: 1000000, Pesanan: 10, ApprovalStatus: "Waiting Approval" }]));
        const evidence = mapEvidence(recs([{ ID: 9, Title: "REP-120", Status: "Unmatch", Penjualan: 800000, Pesanan: 10, StartHour: "10:00", EndHour: "12:00" }]));
        const ev = new Evidence(reports, [], [], evidence);
        expect(ev.evidenceFor(s1).map((e) => e.itemId)).toEqual([9]);
        const lines = compareReport(reports[0], ev.evidenceForReport(reports[0])[0], s1);
        expect(lines.find((l) => l.label === "Penjualan (GMV)")?.same).toBe(false);
        expect(lines.find((l) => l.label === "Pesanan")?.same).toBe(true);
        expect(lines.find((l) => l.label === "Jam live")?.same).toBe(true);
        const steps = buildTimeline(s1, ev, now);
        expect(steps.find((x) => x.id === "verdict")?.when).toBe("Waiting Approval");
    });
});
