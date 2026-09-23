import { buildDashboard, DashboardInput } from "../shared/dashboard";

const now = new Date(2026, 8, 14, 11, 42); // Monday 14 Sep 2026 11:42 local
const base: DashboardInput = {
  schedules: [], reports: [], evidence: [], clockIns: [], hosts: [], studios: [], brands: [], payrolls: [],
  now, maxShiftHours: 12, missingReportDays: 2, reconcile: { tolerancePct: 5, confidenceThreshold: 0.85 },
};

describe("buildDashboard", () => {
  it("classifies today's sessions", () => {
    const m = buildDashboard({
      ...base,
      schedules: [
        { ID: 1, Title: "SCD-1", Date: "2026-09-14", StartTime: "10:00", EndTime: "12:00", HostID: "H1", StudioID: "S1", BrandID: "B1" },
        { ID: 2, Title: "SCD-2", Date: "2026-09-14", StartTime: "09:00", EndTime: "11:00", HostID: "H2", StudioID: "S2" },
        { ID: 3, Title: "SCD-3", Date: "2026-09-14", StartTime: "16:00", EndTime: "18:00", HostID: "H1", StudioID: "S1" },
        { ID: 4, Title: "SCD-4", Date: "2026-09-14", StartTime: "07:00", EndTime: "08:00", HostID: "H3", StudioID: "S1" },
        { ID: 5, Title: "SCD-5", Date: "2026-09-14", StartTime: "13:00", EndTime: "14:00", Status: { Value: "Cancelled" } },
      ],
      reports: [{ Title: "R-4", ScheduleID: "SCD-4", ApprovalStatus: "Done" }],
      brands: [{ Title: "B1", NamaBrand: "Hanasui" }],
      hosts: [{ Title: "H1", NamaHost: "Dinda Maharani", Status: "Active" }],
    });
    const byId = Object.fromEntries(m.sessions.map((s) => [s.title, s]));
    expect(byId["SCD-1"]).toMatchObject({ state: "live", remaining: 18, brand: "Hanasui", host: "Dinda Maharani" });
    expect(byId["SCD-2"]!.state).toBe("waitingReport");
    expect(byId["SCD-3"]!.state).toBe("notStarted");
    expect(byId["SCD-4"]!.state).toBe("reported");
    expect(byId["SCD-5"]!.state).toBe("cancelled");
    expect(m.sessionSummary.count).toBe(4);
  });

  it("counts reports missing after N days, and ignores cancelled sessions", () => {
    const m = buildDashboard({
      ...base,
      schedules: [
        { ID: 10, Title: "SCD-10", Date: "2026-09-11" },
        { ID: 11, Title: "SCD-11", Date: "2026-09-12" },
        { ID: 12, Title: "SCD-12", Date: "2026-09-13" },
        { ID: 13, Title: "SCD-13", Date: "2026-09-10", Status: "Cancelled" },
        { ID: 14, Title: "SCD-14", Date: "2026-09-09" },
      ],
      reports: [{ Title: "x", ScheduleID: "14" }],
    });
    expect(m.missingReport.count).toBe(2); // SCD-10, SCD-11
  });

  it("detects host double-booking and studio over capacity this week", () => {
    const m = buildDashboard({
      ...base,
      studios: [{ Title: "S1", NamaStudio: "CWG-03", KapasitasHost: 1, Status: "Active" }],
      schedules: [
        { Title: "SCD-20", Date: "2026-09-17", StartTime: "14:00", EndTime: "16:00", HostID: "H1", StudioID: "S2" },
        { Title: "SCD-21", Date: "2026-09-17", StartTime: "15:00", EndTime: "17:00", HostID: "H1", StudioID: "S3" },
        { Title: "SCD-22", Date: "2026-09-18", StartTime: "10:00", EndTime: "12:00", HostID: "H2", StudioID: "S1" },
        { Title: "SCD-23", Date: "2026-09-18", StartTime: "11:00", EndTime: "13:00", HostID: "H3", StudioID: "S1" },
        { Title: "SCD-24", Date: "2026-09-22", StartTime: "11:00", EndTime: "13:00", HostID: "H3", StudioID: "S1" },
      ],
    });
    expect(m.conflicts.map((c) => c.kind)).toEqual(["HOST_DOUBLE", "STUDIO_OVER"]);
  });

  it("builds the review, GPS, open-shift and payroll counts", () => {
    const m = buildDashboard({
      ...base,
      reports: [
        { ID: 1, Title: "RPT-1", ApprovalStatus: "Waiting Approval", Created: "2026-09-10T08:00:00" },
        { ID: 2, Title: "RPT-2", ApprovalStatus: "Done" },
      ],
      clockIns: [
        { HostID: "H1", ClockInDate: "2026-09-14", CheckInTime: "2026-09-14T08:00:00", IsInsideGeofence: false },
        { HostID: "H1", ClockInDate: "2026-09-13", CheckInTime: "2026-09-13T08:00:00", CheckOutTime: "2026-09-13T17:00:00", IsInsideGeofence: true, Streak: 75000 },
        { HostID: "H2", ClockInDate: "2026-09-12", CheckInTime: "2026-09-12T08:00:00", IsInsideGeofence: true },
      ],
      hosts: [
        { Title: "H1", Status: "Active", HasRekening: true },
        { Title: "H2", Status: "Active", HasRekening: false },
        { Title: "H3", Status: { Value: "Active" }, HasRekening: true },
        { Title: "H4", Status: "Inactive" },
      ],
      payrolls: [
        { ID: 117, Title: "PAY-117", Periode: "Jul 2026", Status: "Done", Created: "2026-08-01" },
        { ID: 118, Title: "PAY-118", Periode: "Aug 2026", Status: "Done", Created: "2026-09-01" },
      ],
    });
    expect(m.review).toMatchObject({ count: 1, overdue: 1 });
    expect(m.review.breakdown).toEqual([{ reason: "EVIDENCE_MISSING", count: 1 }]);
    expect(m.gps).toEqual({ count: 1, today: 1 });
    expect(m.openShift.count).toBe(1); // H2 since 12 Sep; H1 today is only 3h 42m old
    expect(m.automation.streakHosts).toBe(1);
    expect(m.payroll).toMatchObject({ activeHosts: 3, withAttendance: 2, withoutAttendance: 1, hostsWithoutBank: 1, openRun: false });
    expect(m.payroll.lastRun?.title).toBe("PAY-118");
  });
});
