import { jsonRecords, mapReports, mapSchedules, mapStudios } from "../StudioDirectory/core/data";
import { formatIdr, formatIdrShort, ReportIndex, sessionGmv, studioGmv } from "../StudioDirectory/core/gmv";
import { ScheduleIndex } from "../StudioDirectory/core/utilization";

const rec = (rows: Record<string, unknown>[]) => jsonRecords(JSON.stringify(rows)) ?? [];
const [studio] = mapStudios(rec([{ Title: "CWG-05", NamaStudio: "Kemang B", KapasitasHost: 2 }]));
const schedules = mapSchedules(
    rec([
        { Title: "SCD-1", Date: "2026-09-10", StudioID: "CWG-05", BrandID: "BR-01", HostID: "H1", StartTime: "10:00", EndTime: "12:00", Status: "Done" },
        { Title: "SCD-2", Date: "2026-09-10", StudioID: "CWG-05", BrandID: "BR-02", HostID: "H2", StartTime: "14:00", EndTime: "16:00", Status: "Done" },
        { Title: "SCD-3", Date: "2026-09-11", StudioID: "CWG-05", BrandID: "BR-01", HostID: "H1", StartTime: "10:00", EndTime: "12:00", Status: "Done" },
        { Title: "SCD-4", Date: "2026-09-12", StudioID: "CWG-05", BrandID: "BR-01", HostID: "H1", StartTime: "10:00", EndTime: "12:00", Status: "Cancelled" },
        { Title: "SCD-5", Date: "2026-09-30", StudioID: "CWG-05", BrandID: "BR-02", HostID: "H2", StartTime: "10:00", EndTime: "12:00", Status: "Planned" },
        { Title: "SCD-9", Date: "2026-09-10", StudioID: "CWG-07", BrandID: "BR-01", HostID: "H3", StartTime: "10:00", EndTime: "12:00", Status: "Done" },
    ]),
    new Map([["br-01", "Hanasui"], ["br-02", "WINGS"]]),
    new Map(),
);
const reports = new ReportIndex(
    mapReports(
        rec([
            // SCD-1 streamed on two accounts → two reports, summed
            { Title: "R1", ScheduleID: "SCD-1", Penjualan: 10000000, ApprovalStatus: { Value: "Done" } },
            { Title: "R2", ScheduleID: "SCD-1", Penjualan: 5000000, ApprovalStatus: { Value: "Done" } },
            { Title: "R2", ScheduleID: "SCD-1", Penjualan: 5000000, ApprovalStatus: { Value: "Done" } }, // duplicate row
            { Title: "R3", ScheduleID: "scd-2", Penjualan: 4000000, ApprovalStatus: { Value: "Waiting Approval" } },
            { Title: "R4", ScheduleID: "SCD-9", Penjualan: 99000000, ApprovalStatus: "Done" }, // other studio
            { Title: "R5", Penjualan: 1 }, // no ScheduleID → unattributable
        ]),
    ),
);
const idx = new ScheduleIndex(schedules);

describe("studio GMV", () => {
    const g = studioGmv(idx, reports, studio, "2026-09", "2026-09-20", 600);

    it("sums reports through ScheduleID and ignores other studios and duplicates", () => {
        expect(g.total).toBe(19000000);
        expect(g.verified).toBe(15000000);
        expect(g.pending).toBe(4000000);
    });

    it("counts sessions, reported sessions and overdue reports; cancelled sessions are excluded", () => {
        expect(g.sessions).toBe(4);
        expect(g.reportedSessions).toBe(2);
        expect(g.missingReports).toBe(1); // SCD-3 ended without a report; SCD-5 is not due yet
        expect(g.perSession).toBe(9500000);
        expect(g.perHour).toBe(19000000 / 4);
    });

    it("ranks brands by GMV", () => {
        expect(g.byBrand.map((b) => [b.brandName, b.gmv])).toEqual([["Hanasui", 15000000], ["WINGS", 4000000]]);
    });

    it("labels each session's report state", () => {
        const byId = (id: string) => schedules.find((s) => s.scheduleId === id)!;
        expect(sessionGmv(reports, byId("SCD-1"), "2026-09-20", 600).state).toBe("verified");
        expect(sessionGmv(reports, byId("SCD-2"), "2026-09-20", 600).state).toBe("pending");
        expect(sessionGmv(reports, byId("SCD-3"), "2026-09-20", 600).state).toBe("missing");
        expect(sessionGmv(reports, byId("SCD-5"), "2026-09-20", 600).state).toBe("notDue");
    });

    it("formats rupiah", () => {
        expect(formatIdr(1759842000)).toBe("Rp 1.759.842.000");
        expect(formatIdrShort(1759842000)).toBe("Rp 1,8 M");
        expect(formatIdrShort(13100000)).toBe("Rp 13,1 jt");
        expect(formatIdrShort(820000)).toBe("Rp 820 rb");
    });
});

describe("live break", () => {
    const lb = mapSchedules(
        rec([
            { Title: "SCD-20", Date: "2026-09-10", StudioID: "CWG-05", BrandID: "BR-01", HostID: "H1", StartTime: "12:00", EndTime: "13:00", Status: "Finished", ApprovalStatus: { Value: "LiveBreak" } },
            { Title: "SCD-21", Date: "2026-09-10", StudioID: "CWG-05", BrandID: "BR-01", HostID: "H1", StartTime: "13:00", EndTime: "14:00", Status: "Finished" },
        ]),
        new Map(),
        new Map(),
    );
    const none = new ReportIndex([]);

    it("shows Live Break instead of a missing report", () => {
        expect(sessionGmv(none, lb[0], "2026-09-20", 600).state).toBe("liveBreak");
        expect(sessionGmv(none, lb[1], "2026-09-20", 600).state).toBe("missing");
    });

    it("does not count live breaks as missing reports", () => {
        const g = studioGmv(new ScheduleIndex(lb), none, studio, "2026-09", "2026-09-20", 600);
        expect(g.missingReports).toBe(1);
        expect(g.liveBreaks).toBe(1);
    });
});

describe("live break in any column", () => {
    it("reads LiveBreak from an unexpected column name and ignores LiveBreak = No", () => {
        const rows = mapSchedules(
            rec([
                { Title: "SCD-30", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "12:00", EndTime: "13:00", Status: "Finished", Approval_x0020_Status0: { Value: "LiveBreak" } },
                { Title: "SCD-31", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "13:00", EndTime: "14:00", Status: "Finished", LiveBreak: { Value: "No" } },
                { Title: "SCD-32", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "14:00", EndTime: "15:00", Status: "Live Break" },
            ]),
            new Map(),
            new Map(),
        );
        expect(rows.map((r) => r.liveBreak)).toEqual([true, false, true]);
    });
});

describe("live break as in the tenant: Schedule.LiveBreak = Yes (choice), Report.ApprovalStatus = LiveBreak", () => {
    const rows = mapSchedules(
        rec([
            { Title: "SCD-40", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "12:00", EndTime: "13:00", Status: "Finished", LiveBreak: { Value: "Yes" } },
            { Title: "SCD-41", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "13:00", EndTime: "14:00", Status: "Finished", LiveBreak: { Value: "No" } },
            { Title: "SCD-42", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "14:00", EndTime: "15:00", Status: "Finished" },
            { Title: "SCD-43", Date: "2026-09-10", StudioID: "CWG-05", StartTime: "15:00", EndTime: "16:00", Status: "Finished" },
        ]),
        new Map(),
        new Map(),
    );
    const reps = new ReportIndex(
        mapReports(
            rec([
                { Title: "R40", ScheduleID: "SCD-40", Penjualan: 0, ApprovalStatus: { Value: "LiveBreak" } },
                { Title: "R42", ScheduleID: "SCD-42", Penjualan: 0, ApprovalStatus: { Value: "LiveBreak" } },
                { Title: "R43a", ScheduleID: "SCD-43", Penjualan: 0, ApprovalStatus: { Value: "LiveBreak" } },
                { Title: "R43b", ScheduleID: "SCD-43", Penjualan: 3000000, ApprovalStatus: { Value: "Done" } },
            ]),
        ),
    );
    const st = (i: number) => sessionGmv(reps, rows[i], "2026-09-20", 600).state;

    it("reads the LiveBreak choice (Yes / No)", () => {
        expect(rows.map((r) => r.liveBreak)).toEqual([true, false, false, false]);
    });
    it("shows Live Break from the schedule flag or from a LiveBreak report", () => {
        expect(st(0)).toBe("liveBreak");
        expect(st(1)).toBe("missing");
        expect(st(2)).toBe("liveBreak");
    });
    it("judges a session on its real reports when a LiveBreak row sits next to them", () => {
        expect(st(3)).toBe("verified");
    });
});
