import { buildAttendance } from "../shared/attendance";
import { availableClockInDates } from "../shared/clockIn";
import { addDaysKey, localDayKey } from "../shared/data";
import { buildHostSessions, shiftCovers, shiftToday } from "../shared/hostApp";
import { clockOutAt } from "../shared/payroll";

// Schedule 28 Sep 22:00 → 29 Sep 03:00: ClockInDate is the 28th, ClockOutDate the 29th.
const open = {
  ID: 1,
  Title: "CLK-1",
  HostID: "H1",
  ClockInDate: "2026-09-28",
  CheckInTime: "2026-09-28T21:55:00",
  ClockInTime: "21:55",
};
const closed = {
  ...open,
  CheckOutTime: "2026-09-29T03:04:00",
  ClockOutDate: "2026-09-29",
  ClockOutTime: "03:04",
};
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);

describe("shift past midnight", () => {
  it("reads the clock-out on ClockOutDate, also from a text clock only", () => {
    expect(clockOutAt(closed)).toEqual(new Date("2026-09-29T03:04:00"));
    const textOnly = {
      HostID: "H1",
      ClockInDate: "2026-09-28",
      ClockInTime: "22:00",
      ClockOutDate: "2026-09-29",
      ClockOutTime: "03:00",
    };
    expect(clockOutAt(textOnly)).toEqual(at(29, 3));
    // No ClockOutDate but the clock is earlier than clock-in: still the next day.
    expect(clockOutAt({ ...textOnly, ClockOutDate: "" })).toEqual(at(29, 3));
  });

  it("the open shift is still running at 02:00 on the 29th; after clock-out the 29th is free", () => {
    const s = shiftToday([open], at(29, 2));
    expect([s.state, s.since?.getDate()]).toEqual(["IN", 28]);
    const done = shiftToday([closed], at(28, 23, 59));
    expect([done.state, done.minutes]).toEqual(["OUT", 309]);
    // On the 29th the 28th's row does not count as today's clock-in: a new shift can start.
    expect(shiftToday([closed], at(29, 9)).state).toBe("NOT_IN");
  });

  it("attendance keeps the row on the clock-in day with the full duration", () => {
    const [d] = buildAttendance([closed], "H1", {});
    expect([d?.key, d?.minutes, d?.outAt && localDayKey(d.outAt)]).toEqual([
      "2026-09-28",
      309,
      "2026-09-29",
    ]);
  });

  it("a session after midnight inside the shift counts as clocked in", () => {
    expect(shiftCovers([closed], at(29, 0, 30))).toBe(true);
    expect(shiftCovers([closed], at(29, 10))).toBe(false);
    const data = {
      schedules: [
        {
          Title: "SCD-9",
          HostID: "H1",
          Date: "2026-09-29",
          StartTime: "00:30",
          EndTime: "02:30",
          Status: "Planned",
        },
      ],
      clockIns: [closed],
      absences: [],
      reports: [],
      brands: [],
      studios: [],
    };
    expect(buildHostSessions(data, at(29, 1))[0]?.clockedIn).toBe(true);
  });

  it("manual clock-in: an overnight schedule ends on the next day", () => {
    const [d] = availableClockInDates(
      [
        {
          Title: "SCD-1",
          HostID: "H1",
          Date: "2026-09-28",
          StartTime: "22:00",
          EndTime: "03:00",
        },
      ],
      [],
      "H1",
      at(29, 9),
    );
    expect([d?.key, d?.start, d?.end]).toEqual(["2026-09-28", 1320, 1620]);
    expect(addDaysKey("2026-09-30", 1)).toBe("2026-10-01");
  });
});
