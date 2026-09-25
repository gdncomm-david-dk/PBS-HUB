import {
  DEFAULT_CLOCKIN_OPTIONS,
  checkGeofence,
  clockBlockers,
  clockInOptions,
  clockInPayload,
  clockOutPayload,
  distanceM,
  parseLocations,
  selfieFileName,
  todayReports,
  todaySchedules,
} from "../shared/clockInApp";

const LOCS = [
  { Title: "Studio CWG", LocationID: "LOC-01", Latitude: -6.2244, Longitude: 106.8031, RadiusMeter: 150, IsActive: true },
  { Title: "Studio BSD", LocationID: "LOC-02", Latitude: -6.3015, Longitude: 106.6527, RadiusMeter: 100, IsActive: true },
  { Title: "Lama", LocationID: "LOC-03", Latitude: -6.2245, Longitude: 106.8032, RadiusMeter: 500, IsActive: false },
  { Title: "Tanpa titik", LocationID: "LOC-04", Latitude: null, Longitude: null, RadiusMeter: 100 },
];
const now = new Date(2026, 8, 25, 8, 3);
const fixAt = (lat: number, lng: number, accuracy: number | null = 12) => ({ lat, lng, accuracy, source: "device" as const, at: now });

describe("studio locations", () => {
  test("keeps active rows with coordinates, default radius when blank", () => {
    const l = parseLocations([...LOCS, { Title: "X", Latitude: "-6.1", Longitude: "106.9", RadiusMeter: null }], 80);
    expect(l.map((x) => x.id)).toEqual(["LOC-01", "LOC-02", "X"]);
    expect(l[2]?.radius).toBe(80);
  });

  test("haversine distance", () => {
    // ~111 m per 0.001° latitude
    expect(Math.round(distanceM({ lat: -6.2244, lng: 106.8031 }, { lat: -6.2254, lng: 106.8031 }))).toBe(111);
  });

  test("inside the nearest radius, outside reports the nearest studio", () => {
    const l = parseLocations(LOCS);
    const inside = checkGeofence(fixAt(-6.2248, 106.8031), l);
    expect(inside).toMatchObject({ inside: true, distance: 44 });
    expect(inside.location?.id).toBe("LOC-01");
    const out = checkGeofence(fixAt(-6.2300, 106.8031), l);
    expect(out.inside).toBe(false);
    expect(out.location?.title).toBe("Studio CWG");
    expect(out.distance).toBeGreaterThan(150);
    expect(checkGeofence(fixAt(0, 0), [])).toEqual({ location: null, distance: null, inside: false });
  });
});

describe("options", () => {
  test("defaults: Hadir - Tugas pays 180000, StatusAbsence not written", () => {
    expect(clockInOptions({})).toEqual(DEFAULT_CLOCKIN_OPTIONS);
    expect(clockInOptions({ clockInStatus: "Hadir - Retainer" }).hkTugas).toBe(30000);
    expect(clockInOptions({ hkTugas: "200000" }).hkTugas).toBe(200000);
  });
});

const schedules = [
  { Title: "SCD-1", Date: "2026-09-25", StartTime: "10:00", EndTime: "12:00", HostID: "HST-001", Status: { Value: "Planned" } },
  { Title: "SCD-2", Date: "2026-09-25", StartTime: "19:00", EndTime: "21:00", HostID: "HST-001", Status: { Value: "Planned" } },
  { Title: "SCD-3", Date: "2026-09-25", StartTime: "14:00", EndTime: "16:00", HostID: "HST-001", Status: { Value: "Cancelled" } },
  { Title: "SCD-4", Date: "2026-09-24", StartTime: "10:00", EndTime: "12:00", HostID: "HST-001", Status: { Value: "Finished" } },
];
const reports = [
  { Title: "REP-1", ScheduleID: "SCD-1", HostID: "HST-001", LiveDate: "2026-09-25" },
  { Title: "REP-4", ScheduleID: "SCD-4", HostID: "HST-001", LiveDate: "2026-09-24" },
];
const host = { Title: "HST-001", NamaHost: "Nadia Putri", Email: "nadia@example.com" };
const selfie = { name: "HST-001_20260925_IN_0803.jpg", bytes: 40000, width: 720, height: 960, source: "Camera" };

describe("counts", () => {
  test("ScheduleCount skips cancelled and other days; TotalReports by ScheduleID", () => {
    const t = todaySchedules(schedules, "HST-001", now);
    expect(t.map((s) => s.Title)).toEqual(["SCD-1", "SCD-2"]);
    expect(todayReports(reports, t, "HST-001", now).map((r) => r.Title)).toEqual(["REP-1"]);
  });
});

describe("payloads", () => {
  const l = parseLocations(LOCS);
  test("clock in inside the radius", () => {
    const fix = fixAt(-6.2248, 106.8031);
    const p = clockInPayload({ host, ctxEmail: "", ctxName: "", schedules, fix, geofence: checkGeofence(fix, l), reason: "ignored", selfie, now, opts: DEFAULT_CLOCKIN_OPTIONS });
    expect(p).toMatchObject({
      hostId: "HST-001",
      hostName: "Nadia Putri",
      employeeEmail: "nadia@example.com",
      clockInDate: "2026-09-25",
      clockInTime: "08:03",
      status: "Hadir - Tugas",
      hkTugas: 180000,
      scheduleCount: 2,
      latitude: -6.2248,
      longitude: 106.8031,
      accuracy: 12,
      distance: 44,
      office: "Studio CWG",
      locationId: "LOC-01",
      inside: true,
      reason: "",
      selfieSource: "Camera",
    });
    expect((p.file as { name: string }).name).toBe(selfie.name);
  });

  test("clock out outside the radius appends to the clock-in reason", () => {
    const fix = fixAt(-6.2300, 106.8031, null);
    const out = new Date(2026, 8, 25, 17, 33);
    const clockIn = { ID: 77, Title: "CLK-0077", HostID: "HST-001", Reason: "Live di gudang brand" };
    const p = clockOutPayload({ host, clockIn, since: now, schedules, reports, fix, geofence: checkGeofence(fix, l), reason: " Pulang dari gudang ", selfie, now: out, opts: DEFAULT_CLOCKIN_OPTIONS });
    expect(p).toMatchObject({
      clockInId: "77",
      clockOutDate: "2026-09-25",
      clockOutTime: "17:33",
      workingMinutes: 570,
      workingHours: 9.5,
      scheduleCount: 2,
      totalReports: 1,
      inside: false,
      accuracy: null,
      reason: "Pulang dari gudang",
      reasonText: "Live di gudang brand\n[Clock out] Pulang dari gudang",
      statusAbsence: "",
    });
  });

  test("clock out after midnight counts the clock-in day", () => {
    const fix = fixAt(-6.2248, 106.8031);
    const since = new Date(2026, 8, 24, 18, 0);
    const p = clockOutPayload({ host, clockIn: { ID: 5 }, since, schedules, reports, fix, geofence: checkGeofence(fix, l), reason: "", selfie, now: new Date(2026, 8, 25, 0, 30), opts: DEFAULT_CLOCKIN_OPTIONS });
    expect(p).toMatchObject({ clockOutDate: "2026-09-25", scheduleCount: 1, totalReports: 1, workingMinutes: 390 });
  });
});

describe("blockers", () => {
  const g = { location: null, distance: 300, inside: false };
  test("location, selfie, and a reason only when outside", () => {
    expect(clockBlockers({ fix: null, locations: 2, geofence: null, selfie: false, reason: "", minReasonChars: 10 })).toEqual(["Cek lokasi dulu", "Ambil selfie"]);
    const fix = fixAt(1, 1);
    expect(clockBlockers({ fix, locations: 2, geofence: g, selfie: true, reason: "short", minReasonChars: 10 })).toEqual(["Isi alasan di luar radius (min. 10 karakter)"]);
    expect(clockBlockers({ fix, locations: 2, geofence: g, selfie: true, reason: "live di gudang brand", minReasonChars: 10 })).toEqual([]);
    expect(clockBlockers({ fix, locations: 2, geofence: { ...g, inside: true }, selfie: true, reason: "", minReasonChars: 10 })).toEqual([]);
  });

  test("selfie file name", () => {
    expect(selfieFileName("HST-001", now, "OUT")).toBe("HST-001_20260925_OUT_0803.jpg");
  });
});
