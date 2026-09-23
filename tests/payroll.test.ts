import { addMonths, buildRunDetail, buildRuns, DEFAULT_RUN_OPTIONS, parsePeriod, periodOptions, readGates, runPreflight } from "../shared/payroll";

const NOW = new Date("2026-09-14T11:42:00");
const opts = DEFAULT_RUN_OPTIONS(NOW);
const states = (row: Record<string, unknown>) => readGates(row).gates.map((g) => `${g.key}:${g.state}`).join(" ");

describe("parsePeriod", () => {
  it.each([
    ["Sep 2026", 2026, 8],
    ["September 2026", 2026, 8],
    ["Agustus 2026", 2026, 7],
    ["August-2026", 2026, 7],
    ["Agu 2026", 2026, 7],
    ["2026-08", 2026, 7],
    ["08/2026", 2026, 7],
    ["[Manual Trigger] Pembayaran Mitra - Host (Jul 2026)", 2026, 6],
  ])("%s", (text, year, month) => {
    expect(parsePeriod(text)).toEqual({ year, month });
  });
  it("returns null for text without a period", () => {
    expect(parsePeriod("")).toBeNull();
    expect(parsePeriod("Pembayaran Mitra")).toBeNull();
  });
  it("adds months across a year boundary", () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2025, month: 11 }, 1)).toEqual({ year: 2026, month: 0 });
  });
  it("offers complete months only, newest first", () => {
    expect(periodOptions(NOW, 2)).toEqual([{ year: 2026, month: 7 }, { year: 2026, month: 6 }]);
  });
});

describe("readGates", () => {
  it("waiting for gate 1", () => {
    expect(states({ Status: "Waiting PBS Approval" })).toBe("PBS_INTERNAL:active HC:pending HEAD_PBS:pending FAS:pending FINANCE:pending");
  });
  it("gate 1 approved by a person, HC next", () => {
    const r = readGates({ Status: "Approved by Annisa Hanifah" });
    expect(r.gates[0]).toMatchObject({ state: "done", approver: "Annisa Hanifah" });
    expect(r.gates[1]?.state).toBe("active");
  });
  it("HC approved opens both parallel gates", () => {
    expect(states({ Status: "Approved by HC" })).toBe("PBS_INTERNAL:done HC:done HEAD_PBS:active FAS:active FINANCE:pending");
  });
  it("P7: HC writes a person's name into Status; the HC column tells it apart", () => {
    expect(states({ Status: "Approved by Asih", HCApproval: "Approved by Asih" })).toBe("PBS_INTERNAL:done HC:done HEAD_PBS:active FAS:active FINANCE:pending");
  });
  it("one parallel gate done, the other still waiting", () => {
    expect(states({ Status: "Approved by PBS" })).toBe("PBS_INTERNAL:done HC:done HEAD_PBS:done FAS:active FINANCE:pending");
  });
  it("both parallel gates done (the column fills the one Status overwrote) → Finance active", () => {
    expect(states({ Status: "Approved by FAS", PBSApproval: "Approved by George" })).toBe("PBS_INTERNAL:done HC:done HEAD_PBS:done FAS:done FINANCE:active");
  });
  it("rejected at FAS is terminal: the other branch and Finance are cancelled", () => {
    const r = readGates({ Status: "Rejected by FAS", FASComment: "Nominal tier 2 salah" });
    expect(r.rejectedAt).toBe("FAS");
    expect(r.gates.map((g) => g.state)).toEqual(["done", "done", "skipped", "rejected", "skipped"]);
    expect(r.gates[3]?.comment).toBe("Nominal tier 2 salah");
  });
  it("rejected at gate 1 by a person", () => {
    const r = readGates({ Status: "Rejected by David" });
    expect(r.rejectedAt).toBe("PBS_INTERNAL");
    expect(r.gates[0]?.approver).toBe("David");
  });
  it("Done means every gate passed", () => {
    expect(readGates({ Status: "Done" }).done).toBe(true);
  });
});

const runs = [
  { ID: 118, Title: "PAY-118", Periode: "Sep 2026", Status: "Done", Created: "2026-09-01T12:00:00" },
  { ID: 117, Title: "PAY-117", Periode: "Aug 2026", Status: "Rejected by HC", Created: "2026-08-01T12:00:00" },
];
const lines = [
  { Title: "L1", payroll_id: "PAY-118", TotalGaji: 1000000 },
  { Title: "L2", payroll_id: "PAY-118", TotalGaji: 500000 },
];

describe("buildRuns", () => {
  it("derives the data period (label month − 1, P8) and totals from the lines (P9)", () => {
    const [r] = buildRuns(runs, lines, [], opts);
    expect(r?.dataPeriod).toEqual({ year: 2026, month: 7 });
    expect(r?.lineTotal).toBe(1500000);
    expect(r?.lineCount).toBe(2);
    expect(r?.phase).toBe("DONE");
  });
  it("a fresh run with gate 1 open is assembling", () => {
    const [r] = buildRuns([{ ID: 119, Title: "PAY-119", Periode: "Sep 2026", Status: "Waiting PBS Approval", Created: "2026-09-14T11:30:00" }], [], [], opts);
    expect(r?.phase).toBe("ASSEMBLING");
  });
});

const hosts = [
  { Title: "HST-001", NamaHost: "Dinda", Status: "Active", HasRekening: true },
  { Title: "HST-002", NamaHost: "Rani", Status: "Active", HasRekening: false },
  { Title: "HST-003", NamaHost: "Bagus", Status: "Active", HasRekening: true },
  { Title: "HST-009", NamaHost: "Old", Status: "Inactive", HasRekening: true },
];
const clockIns = [
  { HostID: "HST-001", ClockInDate: "2026-08-03", CheckInTime: "2026-08-03T08:00:00", CheckOutTime: "2026-08-03T17:00:00", HKTugas: 180000, Insentif: 75000, Tier: "Tier 1", Streak: 0 },
  { HostID: "HST-001", ClockInDate: "2026-08-04", CheckInTime: "2026-08-04T08:00:00", CheckOutTime: "2026-08-04T17:00:00", HKTugas: 180000, Insentif: 75000, Tier: "Tier 1", Streak: 75000 },
  { HostID: "HST-002", ClockInDate: "2026-08-04", CheckInTime: "2026-08-04T08:00:00", CheckOutTime: "", HKTugas: 180000, Insentif: 0, Streak: 0 },
  { HostID: "HST-009", ClockInDate: "2026-08-05", CheckInTime: "2026-08-05T08:00:00", CheckOutTime: "2026-08-05T17:00:00", HKTugas: 180000 },
];

describe("runPreflight", () => {
  const built = buildRuns(runs, lines, [], opts);
  it("blocks a period that already ran, and a host without bank details", () => {
    const res = runPreflight({ period: { year: 2026, month: 7 }, now: NOW, runs: built, hosts, clockIns, reports: [], previousMonthOnly: true });
    const codes = res.checks.map((c) => `${c.level}:${c.code}`);
    expect(res.blocked).toBe(true);
    expect(codes).toContain("block:DUPLICATE");
    expect(codes).toContain("block:NO_BANK");
    expect(codes).toContain("warn:NO_ATTENDANCE");
    expect(codes).toContain("warn:INACTIVE_ATTENDANCE");
    expect(codes).toContain("warn:OPEN_SHIFT");
    expect(res.hostsWithAttendance).toBe(2);
    expect(res.estimate).toBe(180000 * 3 + 75000 * 2 + 75000);
    expect(res.rates).toMatchObject({ manday: 180000, tier1: 75000, streak: 75000 });
  });
  it("blocks any period other than last month while the v1 flow takes no period", () => {
    const res = runPreflight({ period: { year: 2026, month: 6 }, now: NOW, runs: [], hosts, clockIns, reports: [], previousMonthOnly: true });
    expect(res.checks.find((c) => c.code === "FLOW_PERIOD")?.level).toBe("block");
  });
  it("a previously rejected run is a warning, not a block", () => {
    const res = runPreflight({ period: { year: 2026, month: 6 }, now: NOW, runs: built, hosts, clockIns, reports: [], previousMonthOnly: false });
    expect(res.checks.find((c) => c.code === "REJECTED_BEFORE")?.level).toBe("warn");
    expect(res.checks.find((c) => c.code === "DUPLICATE")).toBeUndefined();
  });
});

describe("buildRunDetail", () => {
  it("flags missing bank, zero attendance, P2 period labels and lines that disagree with Clock In", () => {
    const d = buildRunDetail(
      runs[0],
      [
        { Title: "L1", payroll_id: "PAY-118", Employee_Name: "Dinda", HostID: "HST-001", Periode: "August-2026", JumlahHari: 2, TotalGaji: 585000, NetTHP: 585000, PPh21: 0, Bank: "BCA", NorekLast4: "1234" },
        { Title: "L2", payroll_id: "PAY-118", Employee_Name: "Rani", HostID: "HST-002", Periode: "July-2026", JumlahHari: 1, TotalGaji: 999, NetTHP: 999, PPh21: 0, Bank: "", NorekLast4: "" },
        { Title: "L3", payroll_id: "PAY-118", Employee_Name: "Bagus", HostID: "HST-003", Periode: "August-2026", JumlahHari: 0, TotalGaji: 0, NetTHP: 0, PPh21: 0, Bank: "BCA", NorekLast4: "9" },
      ],
      clockIns,
      [],
      opts,
    );
    const by = Object.fromEntries(d.lines.map((l) => [l.name, l.flags]));
    expect(by.Dinda).toEqual([]);
    expect(by.Rani).toEqual(["NO_BANK", "SOURCE_MISMATCH"]);
    expect(by.Bagus).toEqual(["ZERO_ATTENDANCE"]);
    expect(d.totals.bruto).toBe(585999);
    expect(d.pphAllZero).toBe(true);
    expect(d.periodMismatch).toEqual({ labels: ["July-2026"], count: 1 });
  });
});
