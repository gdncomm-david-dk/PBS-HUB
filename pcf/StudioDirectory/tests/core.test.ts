import { jsonRecords, locationForStudio, mapLocations, mapSchedules, mapStudios, occupiesStudio, parseContext, toNum } from "../StudioDirectory/core/data";
import { parseDateKey, parseTimeToMinutes } from "../StudioDirectory/core/time";
import {
    hourlySlots,
    hours,
    liveInfo,
    monthDeltaPoints,
    overallDay,
    overallMonth,
    ScheduleIndex,
    studioDay,
    studioMonth,
} from "../StudioDirectory/core/utilization";
import { fromMeters, parseLatLonPair, toMeters } from "../StudioDirectory/core/geo";

const OP = { startMin: 8 * 60, endMin: 22 * 60 }; // 14 h

const studios = mapStudios(
    jsonRecords(
        JSON.stringify([
            { ID: 1, Title: "CWG-05", NamaStudio: "Studio Kemang B", KapasitasHost: 2, LokasiStudio: "Kemang", Status: { Value: "Active" } },
            { ID: 2, Title: "CWG-07", NamaStudio: "Studio Tebet", KapasitasHost: 1, Status: "Active" },
            { ID: 3, Title: "CWG-01", NamaStudio: "Studio Lama", KapasitasHost: 2, Status: { Value: "Inactive" } },
        ]),
    ) ?? [],
);

const brands = new Map([["br-01", "Hanasui"]]);
const hostsMap = new Map([["hst-001", "Dinda Maharani"], ["hst-002", "Rani Salsabila"]]);

function sched(rows: Record<string, unknown>[]) {
    return mapSchedules(jsonRecords(JSON.stringify(rows)) ?? [], brands, hostsMap);
}

describe("parsing", () => {
    it("parses the text time formats v1 stores", () => {
        expect(parseTimeToMinutes("14:00")).toBe(840);
        expect(parseTimeToMinutes("14.30")).toBe(870);
        expect(parseTimeToMinutes("08:00:00")).toBe(480);
        expect(parseTimeToMinutes("2:30 PM")).toBe(870);
        expect(parseTimeToMinutes("12 am")).toBe(0);
        expect(parseTimeToMinutes("0930")).toBe(570);
        expect(parseTimeToMinutes("24:00")).toBe(1440);
        expect(parseTimeToMinutes("25:00")).toBeNull();
        expect(parseTimeToMinutes("")).toBeNull();
    });

    it("keeps date-only strings literal and converts ISO datetimes to local", () => {
        expect(parseDateKey("2026-09-15")).toBe("2026-09-15");
        expect(parseDateKey("15/09/2026")).toBe("2026-09-15");
        expect(parseDateKey(new Date(2026, 8, 15, 23, 30))).toBe("2026-09-15");
        expect(parseDateKey(null)).toBe("");
    });

    it("reads comma decimals and SharePoint choice objects", () => {
        expect(toNum("-6,263991")).toBeCloseTo(-6.263991);
        expect(toNum({ Value: "12" })).toBe(12);
        expect(toNum("abc")).toBeNull();
    });

    it("maps studios with status to isActive", () => {
        expect(studios.map((s) => [s.studioId, s.isActive])).toEqual([
            ["CWG-05", true],
            ["CWG-07", true],
            ["CWG-01", false],
        ]);
        expect(studios[0].kapasitasHost).toBe(2);
    });

    it("resolves brand and host names, and handles overnight sessions", () => {
        const [s] = sched([{ Title: "SCD-1", Date: "2026-09-15", StudioID: "CWG-05", BrandID: "BR-01", HostID: "HST-001", StartTime: "22:00", EndTime: "01:00" }]);
        expect(s.brandName).toBe("Hanasui");
        expect(s.hostName).toBe("Dinda Maharani");
        expect(s.endMin).toBe(25 * 60);
    });

    it("falls back to JamLive when EndTime is missing", () => {
        const [s] = sched([{ Date: "2026-09-15", StudioID: "CWG-05", StartTime: "10:00", JamLive: 2.5 }]);
        expect(s.endMin).toBe(12 * 60 + 30);
    });

    it("excludes cancelled and leave sessions from occupancy", () => {
        expect(occupiesStudio("Planned")).toBe(true);
        expect(occupiesStudio("Waiting Report")).toBe(true);
        expect(occupiesStudio("Cancelled")).toBe(false);
        expect(occupiesStudio("Leave")).toBe(false);
    });

    it("parses context with comma-separated permissions and survives garbage", () => {
        expect(parseContext(JSON.stringify({ permissions: "STUDIO_VIEW, STUDIO_EDIT" })).permissions).toEqual(["STUDIO_VIEW", "STUDIO_EDIT"]);
        expect(parseContext("{not json").permissions).toEqual([]);
        expect(parseContext("").roles).toEqual([]);
    });
});

describe("utilization", () => {
    const rows = sched([
        // CWG-05 (cap 2) on the 15th: two hosts 10–12, one host 20–23 (clipped to 22)
        { Date: "2026-09-15", StudioID: "CWG-05", HostID: "HST-001", BrandID: "BR-01", StartTime: "10:00", EndTime: "12:00", Status: "Done" },
        { Date: "2026-09-15", StudioID: "CWG-05", HostID: "HST-002", BrandID: "BR-01", StartTime: "10:00", EndTime: "12:00", Status: "Done" },
        { Date: "2026-09-15", StudioID: "CWG-05", HostID: "HST-001", BrandID: "BR-01", StartTime: "20:00", EndTime: "23:00", Status: "Done" },
        { Date: "2026-09-15", StudioID: "CWG-05", HostID: "HST-002", BrandID: "BR-01", StartTime: "14:00", EndTime: "18:00", Status: "Cancelled" },
        // CWG-07 (cap 1) on the 15th: 7 hours
        { Date: "2026-09-15", StudioID: "cwg-07", HostID: "HST-002", StartTime: "08:00", EndTime: "15:00", Status: "Planned" },
        // Inactive studio — must not count in overall
        { Date: "2026-09-15", StudioID: "CWG-01", HostID: "HST-002", StartTime: "08:00", EndTime: "22:00", Status: "Planned" },
        // Previous month
        { Date: "2026-08-10", StudioID: "CWG-05", HostID: "HST-001", StartTime: "08:00", EndTime: "22:00", Status: "Done" },
    ]);
    const idx = new ScheduleIndex(rows);
    const [kemang, tebet] = studios;

    it("computes one studio's day: hours clipped to the operating window, cancelled excluded", () => {
        const d = studioDay(idx, kemang, "2026-09-15", OP);
        expect(d.usedMin).toBe((2 + 2 + 2) * 60);
        expect(d.capacityMin).toBe(2 * 14 * 60);
        expect(d.ratio).toBeCloseTo(6 / 28);
        expect(d.sessions).toBe(3);
    });

    it("matches StudioID case-insensitively", () => {
        expect(studioDay(idx, tebet, "2026-09-15", OP).ratio).toBeCloseTo(7 / 14);
    });

    it("computes overall day across active studios only", () => {
        const o = overallDay(idx, studios, "2026-09-15", OP);
        expect(o.usedMin).toBe((6 + 7) * 60);
        expect(o.capacityMin).toBe((2 + 1) * 14 * 60);
    });

    it("computes month utilization against capacity × hours × days", () => {
        const m = studioMonth(idx, kemang, "2026-09", OP);
        expect(m.capacityMin).toBe(2 * 14 * 60 * 30);
        expect(m.usedMin).toBe(6 * 60);
        const all = overallMonth(idx, studios, "2026-09", OP);
        expect(all.capacityMin).toBe(3 * 14 * 60 * 30);
    });

    it("reports month-over-month delta only when the previous month is loaded", () => {
        expect(monthDeltaPoints(idx, studios, "2026-09", OP)).not.toBeNull();
        expect(monthDeltaPoints(idx, studios, "2026-08", OP)).toBeNull();
    });

    it("finds who is using the studio right now", () => {
        const live = liveInfo(idx, kemang, "2026-09-15", 11 * 60);
        expect(live.running).toHaveLength(2);
        expect(live.hosts).toEqual(["Dinda Maharani", "Rani Salsabila"]);
        expect(live.brands).toEqual(["Hanasui"]);
        expect(live.slotsUsed).toBe(2);
        expect(live.remainingMin).toBe(60);
        expect(live.next).toBeNull();
    });

    it("excludes a cancelled session from 'now' and points to the next session", () => {
        const live = liveInfo(idx, kemang, "2026-09-15", 15 * 60);
        expect(live.running).toHaveLength(0);
        expect(live.next?.startMin).toBe(20 * 60);
    });

    it("counts an overnight session from yesterday as running after midnight", () => {
        const night = new ScheduleIndex(sched([{ Date: "2026-09-14", StudioID: "CWG-05", HostID: "HST-001", StartTime: "22:00", EndTime: "02:00" }]));
        expect(liveInfo(night, kemang, "2026-09-15", 60).running).toHaveLength(1);
        expect(liveInfo(night, kemang, "2026-09-15", 3 * 60).running).toHaveLength(0);
    });

    it("computes per-hour slot usage with over-capacity", () => {
        const over = new ScheduleIndex(
            sched(["HST-001", "HST-002", "HST-003"].map((h) => ({ Date: "2026-09-15", StudioID: "CWG-05", HostID: h, StartTime: "09:00", EndTime: "10:00" }))),
        );
        const slots = hourlySlots(over, kemang, "2026-09-15", OP);
        expect(slots).toHaveLength(14);
        expect(slots[1]).toMatchObject({ startMin: 540, used: 3, capacity: 2 });
        expect(slots[0].used).toBe(0);
    });

    it("formats hours the Indonesian way", () => {
        expect(hours(60 * 1526.5)).toBe("1.526,5");
        expect(hours(60 * 27)).toBe("27");
    });
});

describe("geofence", () => {
    it("links Studio Location by StudioID column, Title = StudioID, or Title = NamaStudio", () => {
        const locs = mapLocations(
            jsonRecords(
                JSON.stringify([
                    { ID: 1, Title: "Studio Kemang B", Latitude: -6.26, Longitude: 106.81, RadiusMeter: 100, IsActive: false },
                    { ID: 2, Title: "Kemang B (baru)", StudioID: "CWG-05", Latitude: -6.26, Longitude: 106.81, RadiusMeter: 80, IsActive: true },
                    { ID: 3, Title: "CWG-07", Latitude: -6.22, Longitude: 106.85, RadiusMeter: 20 },
                ]),
            ) ?? [],
        );
        expect(locationForStudio(studios[0], locs)?.itemId).toBe(2);
        expect(locationForStudio(studios[1], locs)?.itemId).toBe(3);
        expect(locationForStudio(studios[1], locs)?.isActive).toBe(true); // missing IsActive defaults to active
        expect(locationForStudio(studios[2], locs)).toBeNull();
    });

    it("round-trips metre offsets", () => {
        const o = { lat: -6.263991, lon: 106.813294 };
        const p = fromMeters(o, 100, -50);
        const m = toMeters(o, p);
        expect(m.x).toBeCloseTo(100, 6);
        expect(m.y).toBeCloseTo(-50, 6);
    });

    it("parses a pasted 'lat, long' pair", () => {
        expect(parseLatLonPair("-6.263991, 106.813294")).toEqual({ lat: -6.263991, lon: 106.813294 });
        expect(parseLatLonPair("https://maps.google.com/?q=-6.2,106.8")).toEqual({ lat: -6.2, lon: 106.8 });
        expect(parseLatLonPair("hello")).toBeNull();
    });
});
