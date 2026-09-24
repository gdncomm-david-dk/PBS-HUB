import {
  buildHostSessions,
  disputeOf,
  evidenceFileName,
  flaggedFromComment,
  HostData,
  metricColumns,
  missingMetrics,
  parseMetricInput,
  reportBlocker,
  reviewerNote,
  sanityWarnings,
  shiftToday,
  streakDays,
  DEFAULT_HOST_OPTIONS,
} from "../shared/hostApp";
import { base64Bytes, fitSize } from "../shared/hostImage";
import { ALL_METRICS, COMPARED_METRICS } from "../shared/reconcile";

const now = new Date(2026, 8, 14, 11, 42); // Monday 14 Sep 2026 11:42 local
const def = (k: string) => ALL_METRICS.find((d) => d.key === k)!;
const sch = (id: number, date: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ ID: id, Title: `SCD-${id}`, Date: date, StartTime: start, EndTime: end, HostID: "H1", BrandID: "B1", StudioID: "S1", ...extra });
const empty: HostData = { schedules: [], clockIns: [], absences: [], reports: [], brands: [{ Title: "B1", NamaBrand: "Hanasui" }], studios: [] };
const phases = (d: Partial<HostData>, at = now, opts = DEFAULT_HOST_OPTIONS) => Object.fromEntries(buildHostSessions({ ...empty, ...d }, at, opts).map((s) => [s.title, s.phase]));

describe("buildHostSessions", () => {
  const clockIns = [{ HostID: "H1", ClockInDate: "2026-09-14", CheckInTime: "2026-09-14T06:55:00" }, { HostID: "H1", ClockInDate: "2026-09-12", CheckInTime: "2026-09-12T08:00:00", CheckOutTime: "2026-09-12T22:00:00" }];
  it("walks a session through clock-in, absen and report", () => {
    const schedules = [
      sch(1, "2026-09-14", "16:00", "18:00"), // later today
      sch(2, "2026-09-14", "10:00", "12:00"), // live, no absen yet
      sch(3, "2026-09-12", "19:00", "21:00"), // past, clocked in + absen, no report
      sch(4, "2026-09-10", "10:00", "12:00"), // past, no clock-in
      sch(5, "2026-09-12", "10:00", "12:00"), // past, clocked in, no absen
      sch(6, "2026-09-12", "13:00", "15:00"), // reported
      sch(7, "2026-09-12", "15:00", "17:00"), // revision
      sch(8, "2026-09-12", "17:00", "18:00", { Status: { Value: "Cancelled" } }),
    ];
    const absences = [{ ScheduleID: "SCD-3" }, { ScheduleID: "scd-6" }];
    const reports = [
      { Title: "R6", ScheduleID: "SCD-6", ApprovalStatus: { Value: "Waiting Approval" } },
      { Title: "R7", ScheduleID: "SCD-7", ApprovalStatus: { Value: "Need Revision" } },
    ];
    expect(phases({ schedules, clockIns, absences, reports })).toEqual({
      "SCD-1": "UPCOMING", "SCD-2": "NOW", "SCD-3": "NEEDS_REPORT", "SCD-4": "NEEDS_CLOCKIN", "SCD-5": "NEEDS_ABSEN", "SCD-6": "REPORTED", "SCD-7": "REVISION", "SCD-8": "CANCELLED",
    });
  });
  it("opens the absen window before the start and marks late reports", () => {
    const s = buildHostSessions({ ...empty, schedules: [sch(1, "2026-09-14", "12:05", "14:00"), sch(2, "2026-09-10", "10:00", "12:00")], clockIns: [...clockIns, { ClockInDate: "2026-09-10", CheckInTime: "2026-09-10T08:00:00" }], absences: [{ ScheduleID: "SCD-2" }] }, now);
    const [late, soon] = s;
    expect(soon?.canAbsen).toBe(true); // 23 min before start, inside the 30 min lead
    expect(late?.phase).toBe("NEEDS_REPORT");
    expect(late?.late).toBe(true); // due end of 12 Sep
    expect(soon?.brand).toBe("Hanasui");
  });
  it("requireAbsen=false unlocks the report on clock-in alone", () => {
    const opts = { ...DEFAULT_HOST_OPTIONS, requireAbsen: false };
    const s = buildHostSessions({ ...empty, schedules: [sch(5, "2026-09-12", "10:00", "12:00")], clockIns }, now, opts)[0]!;
    expect(s.phase).toBe("NEEDS_REPORT");
    expect(reportBlocker(s, opts)).toBeNull();
  });
  it("names the blocker in the order the host fixes it", () => {
    const [noClock, noAbsen, upcoming] = buildHostSessions({ ...empty, schedules: [sch(4, "2026-09-10", "10:00", "12:00"), sch(5, "2026-09-12", "10:00", "12:00"), sch(1, "2026-09-14", "16:00", "18:00")], clockIns }, now);
    expect(reportBlocker(noClock!)).toBe("CLOCKIN");
    expect(reportBlocker(noAbsen!)).toBe("ABSEN");
    expect(reportBlocker(upcoming!)).toBe("NOT_STARTED");
  });
});

describe("shift and streak", () => {
  it("reads an open shift, a closed one and none", () => {
    const open = shiftToday([{ ClockInDate: "2026-09-14", CheckInTime: "2026-09-14T06:55:00" }], now);
    expect(open.state).toBe("IN");
    expect(open.minutes).toBe(287);
    const closed = shiftToday([{ ClockInDate: "2026-09-14", ClockInTime: "07:00", ClockOutTime: "11:00" }], now);
    expect(closed.state).toBe("OUT");
    expect(closed.minutes).toBe(240);
    expect(shiftToday([], now).state).toBe("NOT_IN");
  });
  it("flags a shift left open past the limit, even from yesterday", () => {
    const s = shiftToday([{ ClockInDate: "2026-09-13", CheckInTime: "2026-09-13T20:00:00" }], now);
    expect(s.state).toBe("IN");
    expect(s.overdue).toBe(true);
  });
  it("counts consecutive days, starting yesterday when today is not in yet", () => {
    const rows = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].map((d) => ({ ClockInDate: d }));
    expect(streakDays(rows, now)).toBe(4);
    expect(streakDays([...rows, { ClockInDate: "2026-09-14" }], now)).toBe(5);
    expect(streakDays([{ ClockInDate: "2026-09-11" }], now)).toBe(0);
  });
});

describe("revision comment", () => {
  const c = "Angka penjualan beda dengan screenshot.\nMetrik yang perlu dibetulkan: Penjualan, CTOR, Peak viewer\n[Sanggahan host] Angka saya dari seller center";
  it("parses flagged metrics by label or key", () => {
    expect(flaggedFromComment(c).map((d) => d.key)).toEqual(["Penjualan", "CTOR", "PeakViewer"]);
    expect(flaggedFromComment("metrik yang perlu dibetulkan: ProdukTerjual; Durasi(Min)").map((d) => d.key)).toEqual(["ProdukTerjual", "Durasi"]);
    expect(flaggedFromComment("Tolong cek")).toEqual([]);
  });
  it("separates the reviewer note and the host dispute", () => {
    expect(reviewerNote(c)).toBe("Angka penjualan beda dengan screenshot.");
    expect(reviewerNote("[Eskalasi] Cek ulang")).toBe("Cek ulang");
    expect(disputeOf(c)).toBe("Angka saya dari seller center");
    expect(disputeOf("Oke")).toBeNull();
  });
});

describe("submit form", () => {
  it("reads Indonesian number input", () => {
    expect(parseMetricInput("4.820.000", def("Penjualan"))).toBe(4820000);
    expect(parseMetricInput("Rp 4.820.000", def("Penjualan"))).toBe(4820000);
    expect(parseMetricInput("3,6", def("CTR"))).toBe(3.6);
    expect(parseMetricInput("3,6%", def("CTR"))).toBe(3.6);
    expect(parseMetricInput("3.6", def("CTR"))).toBe(3.6);
    expect(parseMetricInput("1.234,5", def("CTR"))).toBe(1234.5);
    expect(parseMetricInput("", def("Pesanan"))).toBeNull();
    expect(parseMetricInput("abc", def("Pesanan"))).toBeNull();
  });
  it("warns without blocking", () => {
    const v = { Penjualan: 5e6, Pesanan: 10, JumlahPembeli: 20, ProdukTerjual: 5, CTR: 180, CTOR: 9, PeakViewer: 100, TotalViewer: 50 };
    expect(sanityWarnings(v, []).map((w) => w.key)).toEqual(["CTR", "JumlahPembeli", "ProdukTerjual", "PeakViewer"]);
    const hist = [{ CTOR: 2 }, { CTOR: 2.5 }, { CTOR: 1.5 }];
    expect(sanityWarnings({ CTOR: 9 }, hist).map((w) => w.key)).toEqual(["CTOR"]);
    expect(sanityWarnings({ CTOR: 9 }, hist.slice(0, 2))).toEqual([]);
  });
  it("lists missing required metrics and maps to column names", () => {
    expect(missingMetrics({ Penjualan: 1, Pesanan: 0 }, COMPARED_METRICS).map((d) => d.key)).toEqual(["ProdukTerjual", "JumlahPembeli", "CTR", "CTOR", "PeakViewer"]);
    const cols = metricColumns({ Penjualan: 1, Durasi: 120 });
    expect(cols["Durasi(Min)"]).toBe(120);
    expect(cols.Penjualan).toBe(1);
    expect(Object.keys(cols)).toHaveLength(12);
  });
  it("builds the evidence file name", () => {
    expect(evidenceFileName("RPT-20901", "Shopee", "ACC-003", "jpg")).toBe("RPT-20901_Shopee_ACC-003.jpg");
    expect(evidenceFileName("", "TikTok", "wings official/store", "jpg")).toBe("RPT-{ID}_TikTok_wings-official-store.jpg");
  });
});

describe("image sizing", () => {
  it("keeps the long edge within the limit", () => {
    expect(fitSize(1170, 2532, 2000)).toEqual({ width: 924, height: 2000 });
    expect(fitSize(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
  it("decodes base64 length", () => {
    expect(base64Bytes(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(base64Bytes(Buffer.from("hell").toString("base64"))).toBe(4);
    expect(base64Bytes(Buffer.from("hel").toString("base64"))).toBe(3);
  });
});
