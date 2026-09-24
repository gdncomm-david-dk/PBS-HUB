import { hasPermission, parseContext } from "../shared/contract";
import { availableClockInDates, clockInStatuses } from "../shared/clockIn";
import { bandOf, buildHost, buildLedger, buildSessions, checkLedger, deactivationImpact, maskedPii, parseBands, revealedFor, sensitiveKeysIn, sessionStatus, toneFromText } from "../shared/host";

const NOW = new Date("2026-09-14T11:42:00");
const bands = parseBands([
  { ThresholdID: "B2", Label: "Perlu perhatian", MinimumScore: 60, MaximumScore: 84, Tone: { Value: "Warning" }, Active: true },
  { ThresholdID: "B1", Label: "Kritis", MinimumScore: 0, MaximumScore: 59, Tone: "Danger" },
  { ThresholdID: "B3", Label: "Baik", MinimumScore: 85, MaximumScore: 200, Tone: "Hijau" },
  { ThresholdID: "OLD", Label: "Lama", MinimumScore: 0, MaximumScore: 200, Active: false },
]);
const defaults = { initial: 100, min: 0, max: 200 };

describe("score bands", () => {
  it("drops inactive bands and sorts by minimum", () => {
    expect(bands.map((b) => b.id)).toEqual(["B1", "B2", "B3"]);
  });
  it("finds the band holding a score, null outside every band", () => {
    expect(bandOf(59, bands)?.id).toBe("B1");
    expect(bandOf(60, bands)?.id).toBe("B2");
    expect(bandOf(250, bands)).toBeNull();
    expect(bandOf(null, bands)).toBeNull();
  });
  it("maps tone words in both languages", () => {
    expect(["Danger", "Kuning", "hijau", "Blue", "x"].map(toneFromText)).toEqual(["danger", "warning", "success", "info", "neutral"]);
  });
});

describe("buildHost", () => {
  it("reads v1 columns, falls back to the initial score and the config bounds", () => {
    const h = buildHost({ ID: 3, Title: "HST-003", HostCode: "PBSH-003", NamaHost: "Bagus", Status: { Value: "Active" }, Package: { Value: "Premium" }, Email: { Email: "b@x.id" }, HasRekening: false }, bands, defaults);
    expect(h).toMatchObject({ hostId: "HST-003", code: "PBSH-003", pkg: "Premium", status: "ACTIVE", email: "b@x.id", hasBank: false, score: 100, storedScore: null, min: 0, max: 200 });
    expect(h.band?.id).toBe("B3");
  });
  it("flags drift only when canvas sends a ledger sum that differs", () => {
    expect(buildHost({ Title: "H", CurrentScore: 92, LedgerScore: 90 }, bands, defaults).drift).toBe(true);
    expect(buildHost({ Title: "H", CurrentScore: 92 }, bands, defaults).drift).toBe(false);
  });
  it("detects raw sensitive columns sent by mistake", () => {
    expect(sensitiveKeysIn({ Title: "H", KTP: "3174", NoRekening: "", KtpLast4: "1234", HasAlamat: true })).toEqual(["KTP"]);
  });
});

describe("ledger", () => {
  const txs = buildLedger([
    { ID: 1, Point: -10, TransactionType: { Value: "Penalty" }, Status: { Value: "Active" }, CreatedDate: "2026-08-01T10:00:00" },
    { ID: 2, Point: 5, Status: "", CreatedDate: "2026-08-10T10:00:00" },
    { ID: 3, Point: 2, TransactionType: "Reward", Status: { Value: "Void" }, CreatedDate: "2026-09-01T10:00:00" },
  ]);
  it("sorts newest first and only Active (or blank) rows count", () => {
    expect(txs.map((t) => [t.id, t.active, t.type])).toEqual([["3", false, "REWARD"], ["2", true, "REWARD"], ["1", true, "PENALTY"]]);
  });
  it("compares the stored score to clamp(initial + Σ active)", () => {
    const h = buildHost({ Title: "H", InitialScore: 100, CurrentScore: 97, MinimumScore: 0, MaximumScore: 200 }, bands, defaults);
    expect(checkLedger(h, txs)).toMatchObject({ expected: 95, diff: 2, drift: true, activeCount: 2, voidedCount: 1 });
    const clamped = buildHost({ Title: "H", InitialScore: 3, CurrentScore: 0, MinimumScore: 0 }, bands, defaults);
    expect(checkLedger(clamped, txs)).toMatchObject({ expected: 0, drift: false });
  });
});

describe("deactivationImpact", () => {
  const host = buildHost({ Title: "HST-012", Status: "Inactive", DeactivatedDate: "2026-09-05" }, bands, defaults);
  const sessions = buildSessions(
    [
      { ID: 1, Title: "SCD-1", Date: "2026-09-18", StartTime: "19:00", Status: "Planned" },
      { ID: 2, Title: "SCD-2", Date: "2026-09-04", Status: "Done" },
      { ID: 3, Title: "SCD-3", Date: "2026-09-20", Status: "Cancelled" },
    ],
    [],
    new Map(),
    new Map(),
    NOW,
  );
  it("lists periods with attendance after the switch and sessions still pointing at the host", () => {
    const clockIns = [
      { HostID: "HST-012", ClockInDate: "2026-09-03", HKTugas: 180000 },
      { HostID: "HST-012", ClockInDate: "2026-09-08", HKTugas: 180000, Streak: 75000 },
    ];
    const r = deactivationImpact(host, sessions, clockIns, [], [], NOW);
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]).toMatchObject({ key: "2026-09", clockIns: 1, value: 255000, upcoming: 1, paidIn: [] });
    expect(r.upcoming.map((s) => s.title)).toEqual(["SCD-1"]);
  });
});

describe("personal data", () => {
  it("masks from hints, and from raw values without ever returning them", () => {
    expect(maskedPii({ KtpLast4: "1234" }, "KTP")).toBe("••••••••1234");
    expect(maskedPii({ KTP: "3174051203901234" }, "KTP")).toBe("••••••••1234");
    expect(maskedPii({ Bank: "BCA", NorekLast4: "5678" }, "NoRekening")).toBe("BCA ••••5678");
    expect(maskedPii({ HasAlamat: false }, "Alamat")).toBeNull();
    expect(maskedPii({}, "Alamat")).toBeUndefined();
  });
  it("keeps only revealed values for this host", () => {
    const m = revealedFor([{ hostId: "HST-001", field: "KTP", value: "x" }, { hostId: "HST-002", field: "Alamat", value: "y" }, { hostId: "HST-001", field: "Bogus", value: "z" }], "HST-001");
    expect([...m.entries()]).toEqual([["KTP", "x"]]);
  });
  it("v1 fallback: FAS_Team gets no personal data, PBS_Team does", () => {
    expect(hasPermission(parseContext(JSON.stringify({ roles: "FAS_Team" })), "HOST_PII_VIEW")).toBe(false);
    expect(hasPermission(parseContext(JSON.stringify({ roles: "FAS_Team" })), "HOST_EDIT")).toBe(true);
    expect(hasPermission(parseContext(JSON.stringify({ roles: "PBS_Team" })), "HOST_PII_VIEW")).toBe(true);
  });
});


describe("manual clock-in", () => {
  const sch = [
    { Title: "SCD-1", HostID: "HST-001", Date: "2026-09-10", StartTime: "10:00", EndTime: "12:00" },
    { Title: "SCD-2", HostID: "HST-001", Date: "2026-09-12", StartTime: "13:00", EndTime: "15:00" },
    { Title: "SCD-3", HostID: "HST-001", Date: "2026-09-12", StartTime: "19:00", EndTime: "21:00" },
    { Title: "SCD-4", HostID: "HST-001", Date: "2026-09-13", StartTime: "10:00", EndTime: "12:00", Status: "Cancelled" },
    { Title: "SCD-5", HostID: "HST-001", Date: "2026-09-20", StartTime: "10:00", EndTime: "12:00" },
    { Title: "SCD-6", HostID: "HST-002", Date: "2026-09-11", StartTime: "10:00", EndTime: "12:00" },
    { Title: "SCD-7", HostID: "HST-001", Date: "2026-09-14", StartTime: "08:00", EndTime: "09:00" },
  ];
  const ins = [{ HostID: "HST-001", ClockInDate: "2026-09-10T00:00:00" }, { HostID: "HST-002", ClockInDate: "2026-09-12" }];
  it("offers scheduled days without a clock-in, up to today, oldest first", () => {
    const d = availableClockInDates(sch, ins, "HST-001", NOW);
    expect(d.map((x) => x.key)).toEqual(["2026-09-12", "2026-09-14"]);
    expect(d[0]).toMatchObject({ start: 13 * 60, end: 21 * 60 });
    expect(d[0]?.sessions.map((s) => s.title)).toEqual(["SCD-2", "SCD-3"]);
  });
  it("is empty when every scheduled day already has a clock-in", () => {
    expect(availableClockInDates(sch, [...ins, { HostID: "hst-001", ClockInDate: "2026-09-12" }, { HostID: "HST-001", CheckInTime: "2026-09-14T08:05:00" }], "HST-001", NOW)).toEqual([]);
  });
  it("maps status to HKTugas, overridable from config", () => {
    expect(clockInStatuses({})).toEqual([{ label: "Hadir - Tugas", hk: 180000 }, { label: "Hadir - Retainer", hk: 30000 }]);
    expect(clockInStatuses({ clockInStatuses: ["Hadir - Tugas", "Izin"] })).toEqual([{ label: "Hadir - Tugas", hk: 180000 }, { label: "Izin", hk: 0 }]);
    expect(clockInStatuses({ clockInStatuses: [{ label: "Hadir - Tugas", hk: 200000 }] })[0]?.hk).toBe(200000);
  });
});

describe("sessionStatus", () => {
  it("treats Finished (v1 final status) and legacy Done as done", () => {
    expect(sessionStatus({ Status: { Value: "Finished" } })).toBe("DONE");
    expect(sessionStatus({ Status: "Done" })).toBe("DONE");
    expect(sessionStatus({ Status: "Planned" })).toBe("PLANNED");
    expect(sessionStatus({ Status: "Waiting Report" })).toBe("WAITING_REPORT");
    expect(sessionStatus({ Status: "Leave" })).toBe("CANCELLED");
  });
});
