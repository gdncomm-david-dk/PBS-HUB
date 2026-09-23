// Local flat-earth conversions — accurate to well under a metre at studio-sized distances.

const M_PER_DEG_LAT = 110574;
const mPerDegLon = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);

export interface LatLon {
    lat: number;
    lon: number;
}

/** Offset in metres (east, north) of `p` from `origin`. */
export function toMeters(origin: LatLon, p: LatLon): { x: number; y: number } {
    return {
        x: (p.lon - origin.lon) * mPerDegLon(origin.lat),
        y: (p.lat - origin.lat) * M_PER_DEG_LAT,
    };
}

export function fromMeters(origin: LatLon, x: number, y: number): LatLon {
    return {
        lat: origin.lat + y / M_PER_DEG_LAT,
        lon: origin.lon + x / mPerDegLon(origin.lat),
    };
}

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function isValidLat(n: number | null): n is number {
    return n !== null && isFinite(n) && n >= -90 && n <= 90;
}

export function isValidLon(n: number | null): n is number {
    return n !== null && isFinite(n) && n >= -180 && n <= 180;
}

/** Parses "-6.263991, 106.813294" or a Google Maps URL containing "@lat,lon" / "q=lat,lon". */
export function parseLatLonPair(s: string): LatLon | null {
    const m = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    return isValidLat(lat) && isValidLon(lon) ? { lat, lon } : null;
}

/** Half-widths (metres) the schematic map can show. */
export const ZOOM_STEPS = [50, 100, 150, 250, 400, 700, 1200, 2500, 5000];

export function zoomFor(radius: number): number {
    const need = Math.max(250, radius * 2.5);
    return ZOOM_STEPS.find((z) => z >= need) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/** A round grid step giving ~4 cells per half-width. */
export function gridStep(halfWidth: number): number {
    const raw = halfWidth / 3;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
    return 10 * pow;
}
