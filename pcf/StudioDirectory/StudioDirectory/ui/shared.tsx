import * as React from "react";
import { LocationRow, StudioRow } from "../core/types";
import { LocationLink } from "../core/data";
import { isValidLat, isValidLon } from "../core/geo";
import { Badge, Icon, Tone } from "./components";

/** Below this radius phone GPS (≈100 m accuracy) will routinely fail the check — v2 spec §6A.3. */
export const MIN_SAFE_RADIUS = 25;

export type GeoState = "ok" | "small" | "inactive" | "missing" | "invalid" | "broken";

/** "broken": the studio names a LocationID that no Studio Location row carries. */
export function geoState(loc: LocationRow | null, link?: LocationLink): GeoState {
    if (!loc) return link === "broken" ? "broken" : "missing";
    if (!isValidLat(loc.latitude) || !isValidLon(loc.longitude) || !loc.radiusMeter || loc.radiusMeter <= 0) return "invalid";
    if (!loc.isActive) return "inactive";
    if (loc.radiusMeter < MIN_SAFE_RADIUS) return "small";
    return "ok";
}

export const needsAction = (s: StudioRow, loc: LocationRow | null, link?: LocationLink): boolean => s.isActive && geoState(loc, link) !== "ok";

export function GeoCell(props: { loc: LocationRow | null; link?: LocationLink; onFix?: () => void }): React.ReactElement {
    const st = geoState(props.loc, props.link);
    const r = props.loc?.radiusMeter ?? 0;
    switch (st) {
        case "ok":
            return (
                <span className="sd-geo sd-geo--ok">
                    {Icon.check(14)} {r} m
                </span>
            );
        case "small":
            return (
                <span className="sd-geo sd-geo--warn" title={`Radius ${r} m di bawah ${MIN_SAFE_RADIUS} m`}>
                    {Icon.warn(14)} {r} m
                </span>
            );
        case "inactive":
            return <span className="sd-geo sd-geo--muted">Nonaktif</span>;
        case "invalid":
            return (
                <button type="button" className="sd-geo sd-geo--danger sd-link-plain" onClick={props.onFix}>
                    {Icon.alert(14)} Koordinat tidak valid
                </button>
            );
        case "broken":
            return (
                <button type="button" className="sd-geo sd-geo--danger sd-link-plain" onClick={props.onFix} title="LocationID di studio ini tidak ada di Studio Location">
                    {Icon.alert(14)} LocationID tidak ditemukan
                </button>
            );
        default:
            return (
                <button type="button" className="sd-geo sd-geo--danger sd-link-plain" onClick={props.onFix}>
                    {Icon.warn(14)} Belum diatur
                </button>
            );
    }
}

export function studioStatusTone(s: StudioRow): Tone {
    return s.isActive ? "success" : "neutral";
}

export function statusLabel(s: StudioRow): string {
    if (!s.status) return "Aktif";
    const l = s.status.toLowerCase();
    if (l === "active" || l === "aktif") return "Aktif";
    if (!s.isActive && (l === "inactive" || l === "nonaktif" || l === "non aktif")) return "Nonaktif";
    return s.status;
}

export function StudioStatusBadge(props: { studio: StudioRow }): React.ReactElement {
    return <Badge tone={studioStatusTone(props.studio)}>{statusLabel(props.studio)}</Badge>;
}

/** Schedule.Status values (DESIGN.md) to Bahasa Indonesia labels and tones. Unknown values render verbatim. */
export function scheduleStatus(status: string): { label: string; tone: Tone } {
    const l = status.toLowerCase();
    if (!l) return { label: "—", tone: "neutral" };
    if (l === "planned") return { label: "Terjadwal", tone: "info" };
    if (l === "done" || l === "finished") return { label: "Selesai", tone: "success" };
    if (l === "waiting report") return { label: "Menunggu report", tone: "warning" };
    if (l.includes("cancel")) return { label: "Dibatalkan", tone: "neutral" };
    if (l === "leave") return { label: "Cuti", tone: "neutral" };
    return { label: status, tone: "neutral" };
}

/** Short issue text for a geofence state, used in the Perlu tindakan list. */
export function geoIssueText(st: GeoState, radius: number | null | undefined): string {
    switch (st) {
        case "missing":
            return "belum ada geofence";
        case "broken":
            return "LocationID tidak ditemukan";
        case "small":
            return `radius ${radius} m`;
        case "inactive":
            return "geofence nonaktif";
        default:
            return "koordinat tidak valid";
    }
}
