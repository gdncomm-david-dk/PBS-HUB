import { Row, bool, date, localDayKey, num, reportScheduleId, str } from "./data";
import { sessionStatus } from "./host";
import { clockInStatuses } from "./clockIn";

/**
 * Host clock in / clock out (H-0). The control reads the device position, finds the nearest active
 * row of `Studio Location - PBS`, takes a selfie, and emits CLOCK_IN / CLOCK_OUT. Canvas writes the
 * `Clock In - PBS Hub` row. Outside the radius the host may still clock in, but must give a reason.
 */

export interface StudioLocation {
  id: string; // LocationID, else Title
  title: string;
  lat: number;
  lng: number;
  radius: number; // metres
}

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number | null; // metres; null when canvas supplied the position
  source: "device" | "canvas";
  at: Date;
}

export interface GeofenceResult {
  location: StudioLocation | null;
  distance: number | null; // metres, rounded
  inside: boolean;
}

export interface ClockInOptions {
  defaultRadiusM: number;
  /** Accuracy (m) above which the fix is flagged as weak. It never blocks. */
  weakAccuracyM: number;
  /** Status choice written on clock in, and the HKTugas it pays. */
  status: string;
  hkTugas: number;
  /** Optional StatusAbsence choice written on clock out; blank = not written. */
  statusAbsence: string;
  minReasonChars: number;
  selfieMaxPx: number;
  selfieMaxKb: number;
}

export const DEFAULT_CLOCKIN_OPTIONS: ClockInOptions = {
  defaultRadiusM: 100,
  weakAccuracyM: 100,
  status: "Hadir - Tugas",
  hkTugas: 180000,
  statusAbsence: "",
  minReasonChars: 10,
  selfieMaxPx: 960,
  selfieMaxKb: 350,
};

const cfgNum = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const cfgStr = (v: unknown, fallback: string): string => (typeof v === "string" ? v.trim() : fallback);

export function clockInOptions(config: Record<string, unknown>): ClockInOptions {
  const d = DEFAULT_CLOCKIN_OPTIONS;
  const status = cfgStr(config.clockInStatus, d.status) || d.status;
  // HKTugas follows the status table used by manual clock in, unless given outright.
  const hk = clockInStatuses(config).find((s) => s.label === status)?.hk;
  return {
    defaultRadiusM: cfgNum(config.defaultRadiusM, d.defaultRadiusM),
    weakAccuracyM: cfgNum(config.weakAccuracyM, d.weakAccuracyM),
    status,
    hkTugas: cfgNum(config.hkTugas, hk ?? d.hkTugas),
    statusAbsence: cfgStr(config.statusAbsence, d.statusAbsence),
    minReasonChars: cfgNum(config.minReasonChars, d.minReasonChars),
    selfieMaxPx: cfgNum(config.selfieMaxPx, d.selfieMaxPx),
    selfieMaxKb: cfgNum(config.selfieMaxKb, d.selfieMaxKb),
  };
}

/** Active rows with usable coordinates. IsActive blank counts as active. */
export function parseLocations(rows: Row[], defaultRadiusM = DEFAULT_CLOCKIN_OPTIONS.defaultRadiusM): StudioLocation[] {
  const out: StudioLocation[] = [];
  for (const r of rows) {
    if (bool(r, "IsActive", "Active") === false) continue;
    const lat = num(r, "Latitude", "Lat");
    const lng = num(r, "Longitude", "Lng", "Long");
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    const radius = num(r, "RadiusMeter", "Radius", "RadiusM");
    const title = str(r, "Title", "LocationName", "Name");
    out.push({ id: str(r, "LocationID", "LocationId") || title, title: title || str(r, "LocationID"), lat, lng, radius: radius && radius > 0 ? radius : defaultRadiusM });
  }
  return out;
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The location the host is in, else the nearest one. Inside means distance ≤ RadiusMeter; when two
 * radii overlap the closer centre wins.
 */
export function checkGeofence(fix: { lat: number; lng: number }, locations: StudioLocation[]): GeofenceResult {
  let best: { loc: StudioLocation; d: number } | null = null;
  let bestInside: { loc: StudioLocation; d: number } | null = null;
  for (const loc of locations) {
    const d = distanceM(fix, loc);
    if (!best || d < best.d) best = { loc, d };
    if (d <= loc.radius && (!bestInside || d < bestInside.d)) bestInside = { loc, d };
  }
  const pick = bestInside ?? best;
  if (!pick) return { location: null, distance: null, inside: false };
  return { location: pick.loc, distance: Math.round(pick.d), inside: !!bestInside };
}

export const fmtDistance = (m: number | null): string =>
  m === null ? "—" : m >= 1000 ? `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;

/** Today's sessions of this host that are not cancelled (ScheduleCount). */
export function todaySchedules(schedules: Row[], hostId: string, now: Date): Row[] {
  const key = localDayKey(now);
  return schedules.filter((s) => {
    const d = date(s, "Date", "LiveDate");
    if (!d || localDayKey(d) !== key) return false;
    if (hostId && str(s, "HostID") && str(s, "HostID") !== hostId) return false;
    return sessionStatus(s) !== "CANCELLED";
  });
}

/** Reports for those sessions (TotalReports): by ScheduleID, else by LiveDate when ScheduleID is blank. */
export function todayReports(reports: Row[], sessions: Row[], hostId: string, now: Date): Row[] {
  const ids = new Set(sessions.map((s) => str(s, "Title")).filter(Boolean));
  const key = localDayKey(now);
  return reports.filter((r) => {
    if (hostId && str(r, "HostID") && str(r, "HostID") !== hostId) return false;
    const sid = reportScheduleId(r);
    if (sid) return ids.has(sid);
    const d = date(r, "LiveDate");
    return !!d && localDayKey(d) === key;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const compactDay = (d: Date): string => localDayKey(d).replace(/-/g, "");

/** `HST-001_20260925_IN.jpg`: one selfie per host, day and direction. */
export function selfieFileName(hostId: string, at: Date, kind: "IN" | "OUT"): string {
  const safe = (hostId || "HOST").replace(/[^A-Za-z0-9_-]/g, "");
  return `${safe}_${compactDay(at)}_${kind}_${pad(at.getHours())}${pad(at.getMinutes())}.jpg`;
}

export interface SelfieMeta {
  name: string;
  bytes: number;
  width: number;
  height: number;
  source: string; // SelfieSource: "Camera" (capture) or "Gallery"
}

export interface GeoPayload {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  distance: number | null;
  office: string;
  locationId: string;
  inside: boolean;
  radius: number | null;
  positionSource: "device" | "canvas";
}

export function geoPayload(fix: GeoFix, g: GeofenceResult): GeoPayload {
  return {
    latitude: Number(fix.lat.toFixed(7)),
    longitude: Number(fix.lng.toFixed(7)),
    accuracy: fix.accuracy === null ? null : Math.round(fix.accuracy),
    distance: g.distance,
    office: g.location?.title ?? "",
    locationId: g.location?.id ?? "",
    inside: g.inside,
    radius: g.location?.radius ?? null,
    positionSource: fix.source,
  };
}

export interface ClockInInput {
  host: Row | undefined;
  ctxEmail: string;
  ctxName: string;
  schedules: Row[];
  fix: GeoFix;
  geofence: GeofenceResult;
  reason: string;
  selfie: SelfieMeta;
  now: Date;
  opts: ClockInOptions;
}

export function clockInPayload(i: ClockInInput): Record<string, unknown> {
  const hostId = str(i.host, "Title", "HostCode");
  const name = str(i.host, "NamaHost", "HostName") || i.ctxName;
  return {
    hostId,
    hostName: name,
    employeeName: name,
    employeeEmail: str(i.host, "Email", "EmployeeEmail") || i.ctxEmail,
    clockInDate: localDayKey(i.now),
    checkInTime: i.now.toISOString(),
    clockInTime: hhmm(i.now),
    status: i.opts.status,
    hkTugas: i.opts.hkTugas,
    scheduleCount: todaySchedules(i.schedules, hostId, i.now).length,
    ...geoPayload(i.fix, i.geofence),
    reason: i.geofence.inside ? "" : i.reason.trim(),
    selfieSource: i.selfie.source,
    file: { name: i.selfie.name, ext: "jpg", contentType: "image/jpeg", bytes: i.selfie.bytes, width: i.selfie.width, height: i.selfie.height },
  };
}

export interface ClockOutInput extends Omit<ClockInInput, "host" | "ctxEmail" | "ctxName"> {
  host: Row | undefined;
  clockIn: Row;
  since: Date | null;
  reports: Row[];
}

export function clockOutPayload(i: ClockOutInput): Record<string, unknown> {
  const hostId = str(i.host, "Title", "HostCode") || str(i.clockIn, "HostID");
  // ScheduleCount / TotalReports belong to the shift day, which is the clock-in day after midnight.
  const day = i.since ?? i.now;
  const sessions = todaySchedules(i.schedules, hostId, day);
  const minutes = i.since ? Math.max(0, Math.round((i.now.getTime() - i.since.getTime()) / 60000)) : null;
  const prevReason = str(i.clockIn, "Reason");
  const reason = i.geofence.inside ? "" : i.reason.trim();
  return {
    clockInId: str(i.clockIn, "ID"),
    clockInTitle: str(i.clockIn, "Title"),
    hostId,
    clockOutDate: localDayKey(i.now),
    checkOutTime: i.now.toISOString(),
    clockOutTime: hhmm(i.now),
    workingMinutes: minutes,
    workingHours: minutes === null ? null : Math.round((minutes / 60) * 100) / 100,
    scheduleCount: sessions.length,
    totalReports: todayReports(i.reports, sessions, hostId, day).length,
    statusAbsence: i.opts.statusAbsence,
    ...geoPayload(i.fix, i.geofence),
    // Reason is one column for both ends: an outside clock-out appends to the clock-in reason.
    reason,
    reasonText: reason ? (prevReason ? `${prevReason}\n[Clock out] ${reason}` : `[Clock out] ${reason}`) : prevReason,
    selfieSource: i.selfie.source,
    file: { name: i.selfie.name, ext: "jpg", contentType: "image/jpeg", bytes: i.selfie.bytes, width: i.selfie.width, height: i.selfie.height },
  };
}

/** What still stops the submit button, in the order the host fixes it. */
export function clockBlockers(p: { fix: GeoFix | null; locations: number; geofence: GeofenceResult | null; selfie: boolean; reason: string; minReasonChars: number }): string[] {
  const out: string[] = [];
  if (p.locations === 0) out.push("Lokasi studio belum diatur. Hubungi tim PBS.");
  if (!p.fix) out.push("Cek lokasi dulu");
  if (!p.selfie) out.push("Ambil selfie");
  if (p.fix && p.geofence && !p.geofence.inside && p.reason.trim().length < p.minReasonChars) out.push(`Isi alasan di luar radius (min. ${p.minReasonChars} karakter)`);
  return out;
}
