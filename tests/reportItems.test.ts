import { buildReportItems, indexSchedules, liveWindow, scheduleFor } from "../shared/reportItems";

const opts = { tolerancePct: 5, confidenceThreshold: 0.85 };
const schedules = [
  { ID: 3210, Title: "SCD-3210", StartTime: "10:00", EndTime: "12:00" },
  { ID: 3211, Title: "SCD-3211", StartTime: "1300", EndTime: "3:00 PM" },
];

describe("report ↔ schedule", () => {
  it("finds the schedule by Title, plain number or ID", () => {
    const idx = indexSchedules(schedules);
    expect(scheduleFor(idx, "SCD-3210")?.ID).toBe(3210);
    expect(scheduleFor(idx, "scd-3211")?.ID).toBe(3211);
    expect(scheduleFor(idx, "3211")?.ID).toBe(3211);
    expect(scheduleFor(idx, "SCD-9999")).toBeUndefined();
    expect(scheduleFor(idx, "")).toBeUndefined();
    expect(scheduleFor(indexSchedules([{ ID: 7, Title: "Sesi pagi", ScheduleID: "SCD-7001" }]), "SCD-7001")?.ID).toBe(7);
  });

  it("formats the live window, falling back to the report's own times", () => {
    expect(liveWindow(schedules[0])).toBe("10:00–12:00");
    expect(liveWindow(schedules[1])).toBe("13:00–15:00");
    expect(liveWindow(undefined, { StartTime: "19:00" })).toBe("19:00–?");
    expect(liveWindow(undefined, {})).toBe("");
    // SharePoint Date and Time columns arrive as ISO; shown in local time.
    const start = new Date(2026, 8, 14, 10, 0).toISOString();
    const end = new Date(2026, 8, 14, 12, 30).toISOString();
    expect(liveWindow({ StartTime: start, EndTime: end })).toBe("10:00–12:30");
    expect(liveWindow({ StartTime: 19, EndTime: "21" })).toBe("19:00–21:00");
  });

  it("items carry Schedule ID, live time, the stored ApprovalStatus and Playbook", () => {
    const reports = [
      { ID: 1, Title: "REP-1", ScheduleID: "SCD-3211", ApprovalStatus: { Value: "Waiting Approval Revision" }, Playbook: { Value: "Flash sale" } },
      { ID: 2, Title: "REP-2", ScheduleID: "SCD-0404" },
    ];
    const [a, b] = buildReportItems(reports, [], [], [], opts, schedules);
    expect(a).toMatchObject({ scheduleId: "SCD-3211", liveTime: "13:00–15:00", approvalStatus: "Waiting Approval Revision", playbook: "Flash sale", state: "WAITING" });
    expect(b).toMatchObject({ scheduleId: "SCD-0404", liveTime: "", approvalStatus: "", playbook: "", state: "OTHER" });
  });
});
