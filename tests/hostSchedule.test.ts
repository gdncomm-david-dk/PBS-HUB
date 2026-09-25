import { buildHostSessions, DEFAULT_HOST_OPTIONS, HostData } from "../shared/hostApp";
import { clockInOf, durationMin, fmtHours, matchesQuery, scheduleKpis, scheduleState, sessionSteps, todayFocus } from "../shared/hostSchedule";
import { inPeriod } from "../shared/payroll";

const now = new Date(2026, 8, 14, 11, 0); // Monday 14 Sep 2026 11:00 local
const sch = (id: number, date: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ ID: id, Title: `SCD-${id}`, Date: date, StartTime: start, EndTime: end, HostID: "H1", BrandID: "B1", StudioID: "S1", Platform: "TikTok", ...extra });
const base: HostData = { schedules: [], clockIns: [], absences: [], reports: [], brands: [{ Title: "B1", NamaBrand: "Hanasui" }, { Title: "B2", NamaBrand: "WINGS" }], studios: [{ Title: "S1", NamaStudio: "CWG-05" }] };

const clockIns = [
  { ID: 1, ClockInDate: "2026-09-14", CheckInTime: "2026-09-14T09:40:00", CheckInOffice: "CWG-05" },
  { ID: 2, ClockInDate: "2026-09-12", CheckInTime: "2026-09-12T08:00:00", CheckOutTime: "2026-09-12T22:00:00" },
  { ID: 3, ClockInDate: "2026-09-01", CheckInTime: "2026-09-01T08:00:00" }, // a day without a session
];
const schedules = [
  sch(1, "2026-09-14", "10:00", "12:00"), // live, clocked in, no absen
  sch(2, "2026-09-14", "16:00", "18:00", { BrandID: "B2", AccountID: "ACC-008", Platform: "Shopee" }), // later today
  sch(3, "2026-09-12", "13:00", "15:00", { Status: "Finished" }), // reported, done
  sch(4, "2026-09-12", "15:00", "17:00"), // reported, waiting
  sch(5, "2026-09-10", "10:00", "12:00"), // no clock-in
  sch(6, "2026-09-12", "19:00", "21:00"), // absen, no report
  sch(7, "2026-09-11", "10:00", "12:00", { Status: "Cancelled" }),
  sch(8, "2026-09-21", "08:00", "13:00"),
];
const absences = [{ ScheduleID: "SCD-3" }, { ScheduleID: "SCD-4" }, { ScheduleID: "SCD-6", CheckInTime: "2026-09-12T18:40:00", Title: "ABS-6" }];
const reports = [
  { ID: 30, Title: "REP-30", ScheduleID: "SCD-3", ApprovalStatus: "Done", Created: "2026-09-12T16:00:00" },
  { ID: 40, Title: "REP-40", ScheduleID: "SCD-4", ApprovalStatus: "Waiting Approval", Created: "2026-09-12T18:00:00" },
];
const sessions = (at = now) => buildHostSessions({ ...base, schedules, clockIns, absences, reports }, at, DEFAULT_HOST_OPTIONS);
const byTitle = (at = now) => Object.fromEntries(sessions(at).map((s) => [s.title, s]));

describe("scheduleState", () => {
  it("uses the host's words: Planned, Finished, plus the missing step", () => {
    const st = Object.fromEntries(sessions().map((s) => [s.title, scheduleState(s, now)]));
    expect(st).toEqual({
      "SCD-1": "LIVE",
      "SCD-2": "PLANNED",
      "SCD-3": "FINISHED",
      "SCD-4": "WAITING",
      "SCD-5": "NEEDS_CLOCKIN",
      "SCD-6": "NEEDS_REPORT",
      "SCD-7": "CANCELLED",
      "SCD-8": "PLANNED",
    });
  });

  it("marks an unsent report late after the deadline", () => {
    const later = new Date(2026, 8, 16, 9, 0);
    expect(scheduleState(byTitle(later)["SCD-6"]!, later)).toBe("LATE");
  });
});

describe("scheduleKpis", () => {
  it("counts sessions, hours, today's absen and clock-in days on scheduled days", () => {
    const k = scheduleKpis(sessions(), clockIns, now, (d) => inPeriod(d, { year: 2026, month: 8 }));
    expect(k.sessions).toBe(7); // cancelled left out
    expect(k.upcoming).toBe(2);
    expect(k.totalMin).toBe(6 * 120 + 300);
    expect(k.doneMin).toBe(4 * 120); // SCD-3,4,5,6 ended
    expect(k.today).toBe(2);
    expect(k.absenToday).toBe(0);
    expect(k.workDays).toBe(3); // 10, 12, 14 Sep
    expect(k.clockDays).toBe(2); // 12 and 14 Sep; 1 Sep has no session
    expect(k.action).toBe(3); // live, no clock-in, unsent
  });
});

describe("filters and helpers", () => {
  it("filters by platform, status group and search", () => {
    const all = sessions().map((s) => ({ s, st: scheduleState(s, now) }));
    const n = (q: Parameters<typeof matchesQuery>[2]) => all.filter((r) => matchesQuery(r.s, r.st, q)).length;
    expect(n({ platform: "Shopee", status: "", search: "" })).toBe(1);
    expect(n({ platform: "", status: "ACTION", search: "" })).toBe(3);
    expect(n({ platform: "", status: "FINISHED", search: "" })).toBe(2);
    expect(n({ platform: "", status: "", search: "wings" })).toBe(1);
    expect(n({ platform: "", status: "", search: "acc-008" })).toBe(1);
    expect(n({ platform: "", status: "", search: "scd-5" })).toBe(1);
  });

  it("durations fall back to JamLive", () => {
    const [s] = buildHostSessions({ ...base, schedules: [sch(9, "2026-09-14", "", "", { JamLive: 1.5 })] }, now);
    expect(durationMin(s!)).toBe(90);
    expect(fmtHours(90)).toBe("1,5 jam");
    expect(fmtHours(300)).toBe("5 jam");
  });

  it("today focus picks the session that needs the host first", () => {
    expect(todayFocus(sessions(), now)?.title).toBe("SCD-1");
    expect(todayFocus(sessions(), new Date(2026, 8, 14, 7, 0))?.title).toBe("SCD-1"); // both upcoming: the first
    expect(todayFocus(sessions(), new Date(2026, 8, 15, 9, 0))).toBeUndefined();
  });
});

describe("sessionSteps", () => {
  const fmt = { time: (d: Date | null) => (d ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : "—"), day: (d: Date | null) => (d ? `${d.getDate()}/${d.getMonth() + 1}` : "—") };
  const steps = (title: string, at = now) => {
    const s = byTitle(at)[title]!;
    return sessionSteps(s, clockInOf(s, clockIns), at, DEFAULT_HOST_OPTIONS, fmt).map((x) => `${x.key}:${x.state}`);
  };

  it("live session: clock-in done, absen now", () => {
    expect(steps("SCD-1")).toEqual(["CLOCKIN:done", "ABSEN:now", "REPORT:todo", "REVIEW:todo"]);
    const s = byTitle()["SCD-1"]!;
    expect(sessionSteps(s, clockInOf(s, clockIns), now, DEFAULT_HOST_OPTIONS, fmt)[0]?.text).toBe("Clock in 9:40 · CWG-05");
  });

  it("past sessions", () => {
    expect(steps("SCD-3")).toEqual(["CLOCKIN:done", "ABSEN:done", "REPORT:done", "REVIEW:done"]);
    expect(steps("SCD-4")).toEqual(["CLOCKIN:done", "ABSEN:done", "REPORT:done", "REVIEW:now"]);
    expect(steps("SCD-5")).toEqual(["CLOCKIN:missing", "ABSEN:missing", "REPORT:missing", "REVIEW:todo"]);
    expect(steps("SCD-6")).toEqual(["CLOCKIN:done", "ABSEN:done", "REPORT:now", "REVIEW:todo"]);
    expect(steps("SCD-7")).toEqual(["CLOCKIN:skip", "ABSEN:skip", "REPORT:skip", "REVIEW:skip"]);
  });

  it("absen step is skipped when the tenant does not use Host Absence", () => {
    const s = byTitle()["SCD-1"]!;
    expect(sessionSteps(s, undefined, now, { ...DEFAULT_HOST_OPTIONS, requireAbsen: false }, fmt)[1]?.state).toBe("skip");
  });
});
