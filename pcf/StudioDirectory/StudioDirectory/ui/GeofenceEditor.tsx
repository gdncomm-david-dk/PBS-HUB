import * as React from "react";
import { LocationRow, StudioRow } from "../core/types";
import { fromMeters, gridStep, isValidLat, isValidLon, LatLon, parseLatLonPair, round6, toMeters, ZOOM_STEPS, zoomFor } from "../core/geo";
import { Banner, Button, Card, cx, Field, Icon, Toggle } from "./components";
import { Env } from "./App";
import { MIN_SAFE_RADIUS } from "./shared";

// The map is schematic (no tiles): a to-scale grid around the centre, so 20 m and 100 m look different.
// The SVG viewBox tracks the container's pixel size, so one SVG unit is one CSS pixel and the scale bar is true.
// The pin and the radius handle are draggable; the numeric fields mirror them and stay editable.

const MAX_RADIUS = 5000;

const numOrNull = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
};

export function GeofenceEditor(props: { env: Env; studio: StudioRow; location: LocationRow | null }): React.ReactElement {
    const { env, studio, location } = props;
    const initial = {
        title: location?.title || studio.namaStudio || studio.studioId,
        lat: location?.latitude !== null && location?.latitude !== undefined ? String(location.latitude) : "",
        lon: location?.longitude !== null && location?.longitude !== undefined ? String(location.longitude) : "",
        radius: location?.radiusMeter ? String(location.radiusMeter) : "100",
        isActive: location ? location.isActive : true,
    };
    const [title, setTitle] = React.useState(initial.title);
    const [latS, setLatS] = React.useState(initial.lat);
    const [lonS, setLonS] = React.useState(initial.lon);
    const [radS, setRadS] = React.useState(initial.radius);
    const [isActive, setIsActive] = React.useState(initial.isActive);
    const [locating, setLocating] = React.useState(false);
    const [locError, setLocError] = React.useState("");

    const lat = numOrNull(latS);
    const lon = numOrNull(lonS);
    const radius = numOrNull(radS);
    const hasCenter = isValidLat(lat) && isValidLon(lon);
    const radiusValid = radius !== null && radius > 0 && radius <= MAX_RADIUS;
    const center: LatLon | null = hasCenter ? { lat: lat as number, lon: lon as number } : null;

    const [view, setView] = React.useState<LatLon | null>(center);
    const [halfWidth, setHalfWidth] = React.useState(() => zoomFor(radius ?? 100));
    React.useEffect(() => {
        if (!view && center) setView(center);
    }, [center?.lat, center?.lon]);

    const dirty =
        title !== initial.title || latS !== initial.lat || lonS !== initial.lon || radS !== initial.radius || isActive !== initial.isActive;
    const onlyToggle = !!location && isActive !== initial.isActive && latS === initial.lat && lonS === initial.lon && radS === initial.radius && title === initial.title;
    const saving = !!env.pending && (env.pending.action === "SET_GEOFENCE" || env.pending.action === "TOGGLE_GEOFENCE_ACTIVE");
    const canSave = env.canEdit && dirty && hasCenter && radiusValid && !!title.trim() && !env.pending;
    const readOnly = !env.canEdit;

    const reset = (): void => {
        setTitle(initial.title);
        setLatS(initial.lat);
        setLonS(initial.lon);
        setRadS(initial.radius);
        setIsActive(initial.isActive);
        setView(initial.lat && initial.lon ? { lat: Number(initial.lat), lon: Number(initial.lon) } : null);
    };

    const save = (): void => {
        if (!canSave || !center || radius === null) return;
        if (onlyToggle && location) {
            env.run("TOGGLE_GEOFENCE_ACTIVE", {
                studioId: studio.studioId,
                locationId: location.title,
                locationItemId: location.itemId,
                isActive,
            });
            return;
        }
        env.run("SET_GEOFENCE", {
            studioId: studio.studioId,
            locationId: location?.title ?? null,
            locationItemId: location?.itemId ?? null,
            title: title.trim(),
            latitude: round6(center.lat),
            longitude: round6(center.lon),
            radiusMeter: Math.round(radius),
            isActive,
        });
    };

    const setCenter = (p: LatLon): void => {
        setLatS(String(round6(p.lat)));
        setLonS(String(round6(p.lon)));
    };

    const onLatChange = (v: string): void => {
        const pair = parseLatLonPair(v);
        if (pair && /,/.test(v)) {
            setCenter(pair);
            setView(pair);
        } else setLatS(v);
    };

    const useDevice = (): void => {
        setLocating(true);
        setLocError("");
        void (async () => {
            try {
                const p = await env.getPosition();
                setCenter(p);
                setView(p);
            } catch {
                setLocError("Lokasi perangkat tidak tersedia. Izinkan akses lokasi atau isi koordinat manual.");
            } finally {
                setLocating(false);
            }
        })();
    };

    // ---- map geometry
    const mapRef = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState({ w: 720, h: 420 });
    React.useEffect(() => {
        const el = mapRef.current;
        if (!el) return;
        const measure = (): void => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) > 1 || Math.abs(s.h - r.height) > 1 ? { w: r.width, h: r.height } : s));
        };
        measure();
        const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
        if (!RO) return;
        const ro = new RO(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const W = size.w;
    const H = size.h;
    const mpu = halfWidth / (Math.min(W, H) / 2); // metres per SVG unit (= per CSS pixel); halfWidth spans the shorter side
    const origin = view ?? center;
    const pinXY = origin && center ? (() => {
        const m = toMeters(origin, center);
        return { x: W / 2 + m.x / mpu, y: H / 2 - m.y / mpu };
    })() : null;
    const rUnits = radiusValid ? (radius as number) / mpu : 0;
    const step = gridStep(halfWidth);
    const small = radiusValid && (radius as number) < MIN_SAFE_RADIUS;

    const svgRef = React.useRef<SVGSVGElement>(null);
    const drag = React.useRef<"pin" | "radius" | null>(null);

    const toSvg = (e: React.PointerEvent): { x: number; y: number } | null => {
        const svg = svgRef.current;
        const ctm = svg?.getScreenCTM();
        if (!svg || !ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
    };

    const onPointerMove = (e: React.PointerEvent): void => {
        if (!drag.current || !origin) return;
        const p = toSvg(e);
        if (!p) return;
        if (drag.current === "pin") {
            setCenter(fromMeters(origin, (p.x - W / 2) * mpu, (H / 2 - p.y) * mpu));
        } else if (pinXY) {
            const d = Math.hypot(p.x - pinXY.x, p.y - pinXY.y) * mpu;
            setRadS(String(Math.max(5, Math.min(MAX_RADIUS, Math.round(d / 5) * 5))));
        }
    };

    const startDrag = (kind: "pin" | "radius") => (e: React.PointerEvent): void => {
        if (readOnly) return;
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = kind;
    };
    const endDrag = (): void => {
        drag.current = null;
    };

    const onMapClick = (e: React.MouseEvent): void => {
        if (readOnly || !origin || drag.current) return;
        if ((e.target as Element).closest?.("[data-handle]")) return;
        const svg = svgRef.current;
        const ctm = svg?.getScreenCTM();
        if (!svg || !ctm) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const p = pt.matrixTransform(ctm.inverse());
        setCenter(fromMeters(origin, (p.x - W / 2) * mpu, (H / 2 - p.y) * mpu));
    };

    const zoom = (dir: 1 | -1): void => {
        const i = ZOOM_STEPS.indexOf(halfWidth);
        const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 3 : i) + dir))];
        setHalfWidth(next);
    };

    const gridLines: React.ReactElement[] = [];
    if (origin) {
        for (let k = -Math.ceil(halfWidth / step) - 1; k <= Math.ceil(halfWidth / step) + 1; k++) {
            const x = W / 2 + (k * step) / mpu;
            const y = H / 2 + (k * step) / mpu;
            gridLines.push(<line key={`v${k}`} x1={x} y1={0} x2={x} y2={H} className={k === 0 ? "sd-map__axis" : "sd-map__grid"} />);
            gridLines.push(<line key={`h${k}`} x1={0} y1={y} x2={W} y2={y} className={k === 0 ? "sd-map__axis" : "sd-map__grid"} />);
        }
    }
    const scaleUnits = step / mpu;
    const circleTone = !isActive ? "inactive" : small ? "warn" : "ok";

    return (
        <div className="sd-stack">
            {!location && (
                <Banner tone="danger">Studio ini belum punya geofence. Host tidak bisa clock in di sini.</Banner>
            )}
            {location && !initial.isActive && (
                <Banner tone="warning">Geofence nonaktif. Host tidak bisa clock in di studio ini sampai geofence diaktifkan kembali.</Banner>
            )}
            {small && (
                <Banner tone="warning">
                    Radius {Math.round(radius as number)} m lebih kecil dari akurasi GPS ponsel pada umumnya ({env.maxAccuracy} m). Host kemungkinan gagal clock in.
                </Banner>
            )}

            <div className="sd-geo-layout">
                <div className="sd-map" ref={mapRef}>
                    {origin ? (
                        <>
                            <svg
                                ref={svgRef}
                                viewBox={`0 0 ${W} ${H}`}
                                preserveAspectRatio="none"
                                className={cx("sd-map__svg", !readOnly && "is-editable")}
                                onPointerMove={onPointerMove}
                                onPointerUp={endDrag}
                                onPointerLeave={endDrag}
                                onClick={onMapClick}
                                role="img"
                                aria-label={`Peta skematis geofence, radius ${radius ?? "-"} meter`}
                            >
                                <rect x={0} y={0} width={W} height={H} className="sd-map__bg" />
                                {gridLines}
                                {pinXY && radiusValid && (
                                    <>
                                        <circle cx={pinXY.x} cy={pinXY.y} r={Math.max(rUnits, 2)} className={cx("sd-map__circle", `is-${circleTone}`)} />
                                        <g transform={`translate(${pinXY.x}, ${pinXY.y - Math.max(rUnits, 6) - 16})`}>
                                            <rect x={-44} y={-12} width={88} height={22} rx={6} className={cx("sd-map__chip", `is-${circleTone}`)} />
                                            <text x={0} y={3} textAnchor="middle" className="sd-map__chiptext">
                                                radius {Math.round(radius as number)} m
                                            </text>
                                        </g>
                                        {!readOnly && (
                                            <g data-handle="radius" onPointerDown={startDrag("radius")} className="sd-map__handle" transform={`translate(${pinXY.x + rUnits}, ${pinXY.y})`}>
                                                <circle r={12} className="sd-map__hit" />
                                                <circle r={6} className="sd-map__knob" />
                                            </g>
                                        )}
                                    </>
                                )}
                                {pinXY && (
                                    <g data-handle="pin" onPointerDown={startDrag("pin")} className="sd-map__pin" transform={`translate(${pinXY.x}, ${pinXY.y})`}>
                                        <circle r={14} className="sd-map__hit" />
                                        <circle r={7} className="sd-map__dot" />
                                    </g>
                                )}
                            </svg>
                            <div className="sd-map__tl">
                                {!readOnly && <span className="sd-map__hint">Geser pin untuk memindahkan pusat · geser titik tepi untuk radius</span>}
                            </div>
                            <div className="sd-map__zoom">
                                <button type="button" onClick={() => zoom(-1)} aria-label="Perbesar">
                                    {Icon.plus(14)}
                                </button>
                                <button type="button" onClick={() => zoom(1)} aria-label="Perkecil">
                                    {Icon.minus(14)}
                                </button>
                                <button type="button" onClick={() => center && setView(center)} aria-label="Pusatkan ke pin" title="Pusatkan ke pin">
                                    {Icon.locate(14)}
                                </button>
                            </div>
                            <div className="sd-map__scale">
                                <span className="sd-map__scalebar" style={{ width: scaleUnits }} />
                                {step >= 1000 ? `${step / 1000} km` : `${step} m`}
                            </div>
                            <div className="sd-map__note">Peta skematis sesuai skala — bukan peta jalan</div>
                        </>
                    ) : (
                        <div className="sd-map__empty">
                            <span className="sd-map__emptyicon">{Icon.pin(28)}</span>
                            <div className="sd-state__title">Pusat geofence belum ditentukan</div>
                            <div className="sd-state__text">Masukkan koordinat di panel kanan (bisa tempel “lat, long” dari Google Maps), atau pakai lokasi perangkat ini saat berada di studio.</div>
                            {!readOnly && (
                                <Button variant="secondary" icon={Icon.locate(14)} onClick={useDevice} disabled={locating}>
                                    {locating ? "Mencari lokasi…" : "Pakai lokasi perangkat ini"}
                                </Button>
                            )}
                            {locError && <div className="sd-field__hint sd-field__hint--danger">{locError}</div>}
                        </div>
                    )}
                </div>

                <Card className="sd-geoform" title="Koordinat geofence">
                    <Field label="Nama lokasi" hint={location ? "Nama yang tercatat di Clock In (CheckInOffice)." : "Dipakai sebagai Title di Studio Location dan tampil di catatan clock in."}>
                        <input className="sd-input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly || !!location} />
                    </Field>
                    <Field label="Latitude" hint={latS && !isValidLat(lat) ? "Latitude harus antara -90 dan 90." : undefined} hintTone="danger">
                        <input className={cx("sd-input", latS && !isValidLat(lat) && "is-danger")} inputMode="decimal" placeholder="Belum diisi" value={latS} onChange={(e) => onLatChange(e.target.value)} disabled={readOnly} />
                    </Field>
                    <Field label="Longitude" hint={lonS && !isValidLon(lon) ? "Longitude harus antara -180 dan 180." : undefined} hintTone="danger">
                        <input className={cx("sd-input", lonS && !isValidLon(lon) && "is-danger")} inputMode="decimal" placeholder="Belum diisi" value={lonS} onChange={(e) => setLonS(e.target.value)} disabled={readOnly} />
                    </Field>
                    <Field
                        label="Radius (meter)"
                        hint={
                            !radiusValid
                                ? `Radius harus lebih dari 0 dan maksimal ${MAX_RADIUS} m.`
                                : small
                                  ? "Disarankan minimal 50 m."
                                  : `Akurasi GPS ponsel yang diterima aplikasi maksimum ${env.maxAccuracy} m.`
                        }
                        hintTone={!radiusValid ? "danger" : small ? "warning" : undefined}
                    >
                        <input
                            className={cx("sd-input", !radiusValid && "is-danger", small && "is-warning")}
                            inputMode="numeric"
                            value={radS}
                            onChange={(e) => setRadS(e.target.value.replace(/[^\d.,]/g, ""))}
                            onBlur={() => radiusValid && setHalfWidth((h) => (rUnits * 2 > H * 0.9 || rUnits < 20 ? zoomFor(radius as number) : h))}
                            disabled={readOnly}
                        />
                    </Field>
                    {hasCenter && !readOnly && (
                        <button type="button" className="sd-link sd-link--sm" onClick={useDevice} disabled={locating}>
                            {Icon.locate(13)} {locating ? "Mencari lokasi…" : "Pakai lokasi perangkat ini"}
                        </button>
                    )}
                    <div className="sd-divider" />
                    <Toggle
                        checked={isActive}
                        onChange={setIsActive}
                        disabled={readOnly}
                        label="Geofence aktif"
                        description={isActive ? "Host bisa clock in di studio ini" : "Host tidak bisa clock in di studio ini"}
                    />
                    {!readOnly && (
                        <div className="sd-geoform__foot">
                            <Button variant="ghost" onClick={reset} disabled={!dirty || saving}>
                                Batal
                            </Button>
                            <Button variant="primary" onClick={save} disabled={!canSave}>
                                {saving ? "Menyimpan…" : "Simpan geofence"}
                            </Button>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
