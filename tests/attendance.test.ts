import { buildAttendance, payrollLock, tierRates } from "../shared/attendance";
import { RunModel } from "../shared/payroll";

const rows = [
  { ID: 1, HostID: "H1", ClockInDate: "2026-08-03", CheckInTime: "2026-08-03T08:00:00", CheckOutTime: "2026-08-03T17:10:00", HKTugas: 180000, Tier: "Tier 1", Insentif: 75000, Streak: 0 },
  { ID: 2, HostID: "H1", ClockInDate: "2026-08-04", CheckInTime: "2026-08-04T08:00:00", HKTugas: 180000, Tier: "Tier 2", Insentif: 65000, Streak: 75000, IsInsideGeofence: false },
  { ID: 3, HostID: "H1", ClockInDate: "2026-08-05", ClockInTime: "19:00", ClockOutTime: "01:00", HKTugas: 30000, AdjustedBy: "Annisa", AdjustReason: "lupa" },
  { ID: 4, HostID: "H2", ClockInDate: "2026-08-05", HKTugas: 180000 },
];

describe("buildAttendance", () => {
  const days = buildAttendance(rows, "H1", {});
  it("keeps the host's rows, newest first, with totals from the Clock In row", () => {
    expect(days.map((d) => d.id)).toEqual(["3", "2", "1"]);
    expect(days[2]).toMatchObject({ tier: 1, insentif: 75000, streak: 0, total: 255000, minutes: 550, status: "Hadir - Tugas" });
  });
  it("reads open shifts, manual text times past midnight, geofence and audit", () => {
    expect(days[1]).toMatchObject({ outAt: null, minutes: null, outsideGeofence: true, total: 320000 });
    expect(days[0]).toMatchObject({ manual: true, minutes: 360, status: "Hadir - Retainer" });
    expect(days[0]?.adjusted?.by).toBe("Annisa");
  });
});

describe("tierRates", () => {
  it("prefers config, falls back to the most common amount in the data", () => {
    expect(tierRates({}, rows)).toEqual({ 1: 75000, 2: 65000, 3: null, weekly: 75000 });
    expect(tierRates({ tierRates: { tier3: 55000 }, weeklyBonus: 50000 }, rows)).toEqual({ 1: 75000, 2: 65000, 3: 55000, weekly: 50000 });
  });
});

describe("payrollLock", () => {
  const run = (id: string, phase: RunModel["phase"], created: string) => ({ id, title: `PAY-${id}`, label: "Sep 2026", dataPeriod: { year: 2026, month: 7 }, phase, statusText: phase, created: new Date(created) }) as unknown as RunModel;
  it("warns for a run in approval and blocks-with-error once paid", () => {
    expect(payrollLock([run("118", "WAITING", "2026-09-01")], { year: 2026, month: 7 })?.level).toBe("warn");
    expect(payrollLock([run("117", "DONE", "2026-09-01")], { year: 2026, month: 7 })?.level).toBe("err");
    expect(payrollLock([run("115", "REJECTED", "2026-09-01")], { year: 2026, month: 7 })).toBeNull();
    expect(payrollLock([run("118", "WAITING", "2026-09-01")], { year: 2026, month: 8 })).toBeNull();
  });
});
