import * as React from "react";
import { ActionName, ActionResult, LocationRow, ModuleContext, OperatingHours, ReportRow, ScheduleRow, StudioRow } from "../core/types";
import { ReportIndex } from "../core/gmv";
import { linkLocation, LocationLink } from "../core/data";
import { LatLon } from "../core/geo";
import { minutesOfDay, shiftMonth, toDateKey, toMonthKey } from "../core/time";
import { ScheduleIndex } from "../core/utilization";
import { Banner } from "./components";
import { StudioList } from "./StudioList";
import { StudioDetail } from "./StudioDetail";
import { StudioForm, StudioFormValues } from "./StudioForm";

export interface AppProps {
    studios: StudioRow[];
    locations: LocationRow[];
    schedules: ScheduleRow[];
    reports: ReportRow[];
    /** Which columns the studios / locations sources carry — used to explain a missing LocationID link. */
    sources: { studios: SourceInfo; locations: SourceInfo; schedules: SourceInfo; reports: SourceInfo };
    loading: { studios: boolean; locations: boolean; schedules: boolean; reports: boolean };
    ctx: ModuleContext;
    mode: "Admin" | "ReadOnly";
    actionResult: ActionResult | null;
    op: OperatingHours;
    selectedStudioId: string;
    height: number;
    emit: (action: ActionName, payload: Record<string, unknown>) => string;
    onSelectStudio: (studioId: string) => void;
    getPosition: () => Promise<LatLon>;
}

export interface SourceInfo {
    from: "json" | "dataset" | "none";
    columns: string[];
}

export interface Pending {
    requestId: string;
    action: ActionName;
    startedAt: number;
}

/** Everything a page needs, computed once per render of the app. */
export interface Env {
    studios: StudioRow[];
    locations: LocationRow[];
    locationOf: (s: StudioRow) => LocationRow | null;
    sources: AppProps["sources"];
    /** The studio's location and how it was matched (lookup, legacy name match, broken LocationID, none). */
    linkOf: (s: StudioRow) => { loc: LocationRow | null; link: LocationLink };
    /** Studios that share a location — one Studio Location row can serve many studios. */
    studiosAt: (loc: LocationRow) => StudioRow[];
    idx: ScheduleIndex;
    reports: ReportIndex;
    op: OperatingHours;
    now: Date;
    todayKey: string;
    nowMin: number;
    monthKey: string;
    setMonth: (monthKey: string) => void;
    canEdit: boolean;
    pending: Pending | null;
    maxAccuracy: number;
    loading: AppProps["loading"];
    run: (action: ActionName, payload: Record<string, unknown>) => void;
    openStudio: (studioId: string) => void;
    getPosition: () => Promise<LatLon>;
}

const REQUEST_TIMEOUT_MS = 30000;

/** Shown on the page so the app maker can see which build the canvas app is running. Keep in step with the manifest. */
export const CONTROL_VERSION = "pbs_Ops.StudioHub 1.5.1";

const SUCCESS_TEXT: Partial<Record<ActionName, string>> = {
    CREATE_STUDIO: "Studio berhasil ditambahkan.",
    EDIT_STUDIO: "Perubahan studio tersimpan.",
    SET_GEOFENCE: "Geofence tersimpan. Host memakai radius baru saat clock in berikutnya.",
    TOGGLE_GEOFENCE_ACTIVE: "Status geofence diperbarui.",
    SET_STUDIO_LOCATION: "Lokasi studio diperbarui.",
};

function useNow(intervalMs: number): Date {
    const [now, setNow] = React.useState(() => new Date());
    React.useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), intervalMs);
        return () => window.clearInterval(t);
    }, [intervalMs]);
    return now;
}

export function App(props: AppProps): React.ReactElement {
    const now = useNow(30000);
    const todayKey = toDateKey(now);
    const [monthKey, setMonthKey] = React.useState(() => toMonthKey(new Date()));
    const [openId, setOpenId] = React.useState(props.selectedStudioId || "");
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [banner, setBanner] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
    const [form, setForm] = React.useState<{ mode: "create" | "edit"; studio?: StudioRow; error?: string } | null>(null);

    // Canvas can deep-link by changing SelectedStudioId.
    const lastInput = React.useRef(props.selectedStudioId);
    React.useEffect(() => {
        if (props.selectedStudioId !== lastInput.current) {
            lastInput.current = props.selectedStudioId;
            setOpenId(props.selectedStudioId || "");
        }
    }, [props.selectedStudioId]);

    const canEdit =
        props.mode === "Admin" && (props.ctx.permissions.length === 0 || props.ctx.permissions.some((p) => p.toUpperCase() === "STUDIO_EDIT"));
    const maxAccuracy = Number(props.ctx.config.maxAccuracyMeters) > 0 ? Number(props.ctx.config.maxAccuracyMeters) : 100;

    const idx = React.useMemo(() => new ScheduleIndex(props.schedules), [props.schedules]);
    const reportIdx = React.useMemo(() => new ReportIndex(props.reports), [props.reports]);
    const links = React.useMemo(() => {
        const byStudio = new Map<string, { loc: LocationRow | null; link: LocationLink }>();
        const byLocation = new Map<string, StudioRow[]>();
        for (const s of props.studios) {
            const l = linkLocation(s, props.locations);
            byStudio.set(s.key, l);
            if (l.loc) byLocation.set(l.loc.key, [...(byLocation.get(l.loc.key) ?? []), s]);
        }
        return { byStudio, byLocation };
    }, [props.studios, props.locations]);
    const linkOf = React.useCallback(
        (s: StudioRow) => links.byStudio.get(s.key) ?? linkLocation(s, props.locations),
        [links, props.locations],
    );
    const locationOf = React.useCallback((s: StudioRow) => linkOf(s).loc, [linkOf]);
    const studiosAt = React.useCallback((loc: LocationRow) => links.byLocation.get(loc.key) ?? [], [links]);

    const run = React.useCallback(
        (action: ActionName, payload: Record<string, unknown>) => {
            if (pending) return;
            const requestId = props.emit(action, payload);
            setBanner(null);
            setPending({ requestId, action, startedAt: Date.now() });
        },
        [pending, props.emit],
    );

    // Correlate the canvas reply with our own request; ignore stale or foreign ones.
    const pendingRef = React.useRef(pending);
    pendingRef.current = pending;
    React.useEffect(() => {
        const r = props.actionResult;
        const p = pendingRef.current;
        if (!r || !p || r.requestId !== p.requestId) return;
        setPending(null);
        if (r.status === "ok") {
            setBanner({ tone: "success", text: r.message || SUCCESS_TEXT[p.action] || "Tersimpan." });
            if (p.action === "CREATE_STUDIO" || p.action === "EDIT_STUDIO") {
                setForm(null);
                const id = typeof r.data.studioId === "string" ? r.data.studioId : "";
                if (p.action === "CREATE_STUDIO" && id) {
                    setOpenId(id);
                    props.onSelectStudio(id);
                }
            }
        } else {
            const msg = r.message || "Gagal menyimpan. Coba lagi.";
            if (p.action === "CREATE_STUDIO" || p.action === "EDIT_STUDIO") setForm((f) => (f ? { ...f, error: msg } : f));
            else setBanner({ tone: "danger", text: msg });
        }
    }, [props.actionResult]);

    React.useEffect(() => {
        if (!pending) return;
        const t = window.setTimeout(() => {
            setPending((p) => (p && p.requestId === pending.requestId ? null : p));
            setBanner({ tone: "warning", text: "Aplikasi tidak membalas dalam 30 detik. Periksa apakah perubahan tersimpan sebelum mencoba lagi." });
        }, REQUEST_TIMEOUT_MS);
        return () => window.clearTimeout(t);
    }, [pending]);

    const setMonth = React.useCallback(
        (mk: string) => {
            setMonthKey(mk);
            const [y, m] = mk.split("-").map(Number);
            const prev = shiftMonth(mk, -1);
            props.emit("SET_FILTER", {
                month: mk,
                periodStart: `${prev}-01`,
                periodEnd: toDateKey(new Date(y, m, 0)),
            });
        },
        [props.emit],
    );

    const openStudio = React.useCallback(
        (studioId: string) => {
            setOpenId(studioId);
            setBanner(null);
            props.onSelectStudio(studioId);
            if (studioId) props.emit("NAV_STUDIO_DETAIL", { studioId });
        },
        [props.onSelectStudio, props.emit],
    );

    const env: Env = {
        studios: props.studios,
        locations: props.locations,
        locationOf,
        sources: props.sources,
        linkOf,
        studiosAt,
        idx,
        reports: reportIdx,
        op: props.op,
        now,
        todayKey,
        nowMin: minutesOfDay(now),
        monthKey,
        setMonth,
        canEdit,
        pending,
        maxAccuracy,
        loading: props.loading,
        run,
        openStudio,
        getPosition: props.getPosition,
    };

    const open = openId ? props.studios.find((s) => s.studioId.toLowerCase() === openId.toLowerCase()) : undefined;

    const submitForm = (v: StudioFormValues): void => {
        if (!form) return;
        run(form.mode === "create" ? "CREATE_STUDIO" : "EDIT_STUDIO", {
            studioId: v.studioId,
            itemId: form.studio?.itemId ?? null,
            namaStudio: v.namaStudio,
            kapasitasHost: v.kapasitasHost,
            lokasiStudio: v.lokasiStudio,
            status: v.status,
            locationId: v.location ? v.location.locationId || v.location.title : null,
            locationItemId: v.location?.itemId ?? null,
        });
        setForm({ ...form, error: undefined });
    };

    return (
        <div className="pbs-sd" style={props.height > 0 ? { height: props.height } : undefined}>
            <div className="sd-page">
                {banner && (
                    <Banner tone={banner.tone} onClose={() => setBanner(null)}>
                        {banner.text}
                    </Banner>
                )}
                {openId && !open && !props.loading.studios ? (
                    <div className="sd-notfound">
                        <Banner tone="warning" action={<button type="button" className="sd-link" onClick={() => openStudio("")}>Kembali ke daftar studio</button>}>
                            Studio “{openId}” tidak ditemukan di data yang dimuat.
                        </Banner>
                    </div>
                ) : open ? (
                    <StudioDetail env={env} studio={open} onBack={() => openStudio("")} onEdit={() => setForm({ mode: "edit", studio: open })} />
                ) : (
                    <StudioList env={env} onCreate={() => setForm({ mode: "create" })} />
                )}
            </div>
            {form && (
                <StudioForm
                    mode={form.mode}
                    studio={form.studio}
                    locations={props.locations}
                    current={form.studio ? locationOf(form.studio) : null}
                    countAt={(l) => studiosAt(l).length}
                    existingIds={props.studios.map((s) => s.studioId)}
                    statusOptions={Array.from(new Set(["Active", "Inactive", ...props.studios.map((s) => s.status).filter(Boolean)]))}
                    saving={!!pending && (pending.action === "CREATE_STUDIO" || pending.action === "EDIT_STUDIO")}
                    error={form.error}
                    onCancel={() => setForm(null)}
                    onSubmit={submitForm}
                />
            )}
        </div>
    );
}
