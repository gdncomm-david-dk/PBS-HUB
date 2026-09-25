import { clockText, noReportReason, reportPlaybook, reportScheduleId } from "../shared/data";
import { buildSessions } from "../shared/host";
import { buildHostSessions, DEFAULT_HOST_OPTIONS } from "../shared/hostApp";
import { scheduleState } from "../shared/hostSchedule";
import { clockInAt, clockOutAt } from "../shared/payroll";

const sch = (id: number, extra: Record<string, unknown> = {}) => ({ ID: id, Title: `SCD-${id}`, Date: "2026-09-14", StartTime: "10:00", EndTime: "12:00", HostID: "H1", BrandID: "B1", ...extra });

describe("no report owed: live break or Co-Host", () => {
  it("reads LiveBreak and Position", () => {
    expect(noReportReason({ LiveBreak: true })).toBe("LIVE_BREAK");
    expect(noReportReason({ LiveBreak: { Value: "Yes" } })).toBe("LIVE_BREAK");
    expect(noReportReason({ LiveBreak: "No", Position: { Value: "Co-Host" } })).toBe("CO_HOST");
    expect(noReportReason({ Position: "Co Host" })).toBe("CO_HOST");
    expect(noReportReason({ LiveBreak: "No", Position: "Host" })).toBeNull();
    expect(noReportReason({})).toBeNull();
  });

  it("Ops host detail: Waiting Report becomes Finished when nothing is owed", () => {
    const now = new Date(2026, 8, 15, 9, 0);
    const rows = [
      sch(1, { Status: "Waiting Report", LiveBreak: "Yes" }),
      sch(2, { Status: "Waiting Report", LiveBreak: "No", Position: "Co-Host" }),
      sch(3, { Status: "Waiting Report" }),
      sch(4, { Status: "Waiting Report" }),
      sch(5, { Status: "Finished", LiveBreak: "Yes", AccountID: "ACC-9", AccountName: "wingsofficialstore" }),
    ];
    const s = buildSessions(rows, [], new Map(), new Map(), now, [{ ScheduleID: "SCD-4" }]);
    expect(s.map((x) => x.status)).toEqual(["DONE", "DONE", "WAITING_REPORT", "DONE", "DONE"]);
    expect(s.map((x) => x.noReport)).toEqual(["LIVE_BREAK", "CO_HOST", null, null, "LIVE_BREAK"]);
    expect(s[4]!.account).toBe("wingsofficialstore");
  });

  it("host app: no report step, the session is Finished", () => {
    const now = new Date(2026, 8, 14, 13, 0);
    const clockIns = [{ ClockInDate: "2026-09-14", CheckInTime: "2026-09-14T09:40:00" }];
    const absences = [{ ScheduleID: "SCD-1" }, { ScheduleID: "SCD-2" }, { ScheduleID: "SCD-3" }];
    const schedules = [sch(1, { LiveBreak: "Yes" }), sch(2, { Position: "Co-Host" }), sch(3)];
    const out = buildHostSessions({ schedules, clockIns, absences, reports: [], brands: [], studios: [] }, now, DEFAULT_HOST_OPTIONS);
    expect(out.map((x) => x.phase)).toEqual(["NO_REPORT", "NO_REPORT", "NEEDS_REPORT"]);
    expect(out.map((x) => scheduleState(x, now))).toEqual(["FINISHED", "FINISHED", "NEEDS_REPORT"]);
  });
});

describe("clock-in columns", () => {
  it("reads ClockInTime / ClockOutTime as Date and Time or a text clock", () => {
    const iso = new Date(2026, 8, 14, 9, 40).toISOString();
    const isoOut = new Date(2026, 8, 14, 18, 5).toISOString();
    expect(clockInAt({ ClockInDate: "2026-09-14", ClockInTime: iso })?.getHours()).toBe(9);
    expect(clockOutAt({ ClockInDate: "2026-09-14", ClockInTime: iso, ClockOutTime: isoOut })?.getMinutes()).toBe(5);
    const text = { ClockInDate: "2026-09-14", ClockInTime: "22:00", ClockOutTime: "02:15" };
    expect(clockInAt(text)?.getHours()).toBe(22);
    expect(clockOutAt(text)?.getDate()).toBe(15); // past midnight
    expect(clockText("09.40.12")).toBe("09:40");
  });
});

describe("report column aliases", () => {
  it("reads ScheduleID and Playbook under SharePoint names", () => {
    expect(reportScheduleId({ Schedule_x0020_ID: "SCD-1" })).toBe("SCD-1");
    expect(reportScheduleId({ ScheduleID: { Id: 3, Value: "SCD-3" } })).toBe("SCD-3");
    expect(reportPlaybook({ Playbook: { Value: "Flash Sale" } })).toBe("Flash Sale");
    expect(reportPlaybook({ Playbook: [{ Value: "A" }, { Value: "B" }] })).toBe("A, B");
  });
});
