import * as React from "react";
import { ScheduleRow } from "../core/types";
import { applyFilters, distinct, Filters, hasActiveFilter, hoursOf, phaseOf, rangeKeys, sortSessions, timeRange, weekStart } from "../core/schedule";
import { BULAN_PENDEK, dateKeyToDate, formatDateShort, HARI, shiftDay, toDateKey } from "../core/time";
import { Banner, Button, Card, cx, Icon, SkeletonRows } from "./components";
import { Env, scheduleStatus, StatusBadge } from "./shared";
import { DeleteDialog } from "./Dialogs";

const PAGE = 50;
const formatHours = (h: number): string => (Math.round(h * 10) / 10).toLocaleString("id-ID");

type View = "calendar" | "list";
type Lanes = "brand" | "studio";

const byName = (a: string, b: string): number => a.localeCompare(b, "id", { sensitivity: "base" });
/** Grouped by brand name (A–Z), then by date and start time. */
export const sortByBrand = (a: ScheduleRow, b: ScheduleRow): number => byName(a.brandName, b.brandName) || sortSessions(a, b);

const monthRange = (todayKey: string): [string, string] => {
    const d = dateKeyToDate(todayKey);
    return [toDateKey(new Date(d.getFullYear(), d.getMonth(), 1)), toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
};

export function rangeLabel(from: string, to: string): string {
    const a = dateKeyToDate(from);
    const b = dateKeyToDate(to);
    if (from === to) return `${a.getDate()} ${BULAN_PENDEK[a.getMonth()]} ${a.getFullYear()}`;
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${BULAN_PENDEK[a.getMonth()]} ${a.getFullYear()}`;
    return `${a.getDate()} ${BULAN_PENDEK[a.getMonth()]} – ${b.getDate()} ${BULAN_PENDEK[b.getMonth()]} ${b.getFullYear()}`;
}

export function ScheduleList(props: {
    env: Env;
    onCreate: (preset?: Partial<ScheduleRow>) => void;
    onEdit: (s: ScheduleRow) => void;
    onBulk: () => void;
    onAi: () => void;
}): React.ReactElement {
    const { env } = props;
    const [view, setView] = React.useState<View>("calendar");
    const [lanes, setLanes] = React.useState<Lanes>("brand");
    const wk = weekStart(env.todayKey);
    const [f, setF] = React.useState<Filters>({ from: wk, to: shiftDay(wk, 6), brandId: "", hostId: "", studioId: "", platform: "", status: "", q: "", only: "" });
    const [limit, setLimit] = React.useState(PAGE);
    const [confirmDelete, setConfirmDelete] = React.useState<ScheduleRow | null>(null);

    // Canvas re-queries Schedule for the period (delegable Filter on Date).
    const lastRange = React.useRef("");
    React.useEffect(() => {
        const k = `${f.from}|${f.to}`;
        if (k === lastRange.current) return;
        lastRange.current = k;
        env.emit("SET_FILTER", { periodStart: f.from, periodEnd: f.to });
        setLimit(PAGE);
    }, [f.from, f.to]);

    const set = (patch: Partial<Filters>): void => {
        setF((p) => ({ ...p, ...patch }));
        setLimit(PAGE);
    };
    const setRange = (from: string, to: string): void => set(from <= to ? { from, to } : { from: to, to: from });
    const setWeek = (anyDay: string): void => {
        const s = weekStart(anyDay);
        setRange(s, shiftDay(s, 6));
    };
    const switchView = (v: View): void => {
        setView(v);
        if (v === "calendar") setWeek(f.from);
    };

    const missingReport = React.useCallback((s: ScheduleRow) => scheduleStatus(s.status).chip !== "off" && phaseOf(s, env.now) === "ended" && !env.ev.isLocked(s) && !env.ev.noReportReason(s), [env.now, env.ev]);
    const inRange = React.useMemo(() => env.schedules.filter((s) => s.dateKey >= f.from && s.dateKey <= f.to), [env.schedules, f.from, f.to]);
    const rows = React.useMemo(
        () => applyFilters(env.schedules, f, { conflicts: env.conflicts, missingReport }).sort(sortByBrand),
        [env.schedules, f, env.conflicts, missingReport],
    );

    const active = inRange.filter((s) => scheduleStatus(s.status).chip !== "off");
    const liveNow = env.schedules.filter((s) => scheduleStatus(s.status).chip !== "off" && phaseOf(s, env.now) === "live");
    const clash = inRange.filter((s) => env.conflicts.has(s.key));
    const noReport = inRange.filter(missingReport);
    const totalHours = active.reduce((t, s) => t + hoursOf(s), 0);
    const unknownBrand = distinct(inRange.filter((s) => !s.brandKnown && s.brandId).map((s) => s.brandId));
    const unknownHost = distinct(inRange.filter((s) => !s.hostKnown && s.hostId).map((s) => s.hostId));
    const groups = React.useMemo(() => {
        const m = new Map<string, { count: number; hours: number }>();
        for (const s of rows) {
            const g = m.get(s.brandName) ?? { count: 0, hours: 0 };
            g.count++;
            if (scheduleStatus(s.status).chip !== "off") g.hours += hoursOf(s);
            m.set(s.brandName, g);
        }
        return m;
    }, [rows]);

    const brandOpts = env.brands.map((b) => ({ v: b.brandId, l: b.namaBrand })).sort((a, b) => byName(a.l, b.l));
    const hostOpts = env.hosts.map((h) => ({ v: h.hostId, l: h.name })).sort((a, b) => byName(a.l, b.l));
    const studioOpts = distinct([...env.studios.map((s) => s.studioId), ...inRange.map((s) => s.studioId)]).map((id) => ({ v: id, l: `${id}${env.lk.studios.get(id.toLowerCase())?.namaStudio ? " · " + env.studioName(id) : ""}` }));
    const platformOpts = distinct([...env.config.platforms, ...inRange.map((s) => s.platform)]).map((p) => ({ v: p, l: p }));
    const statusOpts = distinct([...env.config.statuses, ...inRange.map((s) => s.status)]).map((s) => ({ v: s, l: scheduleStatus(s).label }));

    const filtered = hasActiveFilter(f);
    const [mFrom, mTo] = monthRange(env.todayKey);

    return (
        <>
            <div className="sc-pagehead">
                <div>
                    <div className="sc-crumb">Operasional</div>
                    <h1 className="sc-h1">Schedule</h1>
                    <div className="sc-sub">
                        {env.loading ? "Memuat jadwal…" : `${inRange.length} sesi · ${rangeLabel(f.from, f.to)}`}
                    </div>
                </div>
                {env.canEdit && (
                    <div className="sc-pagehead__actions">
                        <Button variant="secondary" icon={Icon.sparkle()} onClick={props.onAi}>
                            AI Schedule
                        </Button>
                        <Button variant="secondary" icon={Icon.upload()} onClick={props.onBulk}>
                            Upload massal
                        </Button>
                        <Button variant="primary" icon={Icon.plus()} onClick={() => props.onCreate()}>
                            Buat jadwal
                        </Button>
                    </div>
                )}
            </div>

            <div className="sc-kpis">
                <Card className="sc-kpi">
                    <span className="sc-kpi__label">Sesi di rentang ini</span>
                    <span className="sc-kpi__value">
                        {active.length}
                        <span className="sc-kpi__unit">{totalHours.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam live</span>
                    </span>
                    <span className="sc-kpi__foot">{inRange.length - active.length} dibatalkan / cuti</span>
                </Card>
                <Card className="sc-kpi">
                    <span className="sc-kpi__label">Sedang live sekarang</span>
                    <span className="sc-kpi__value">
                        {liveNow.length}
                        <span className="sc-kpi__unit">sesi</span>
                    </span>
                    <span className="sc-kpi__foot">{distinct(liveNow.map((s) => s.studioId)).length} studio terpakai</span>
                </Card>
                <Card className={cx("sc-kpi", clash.length > 0 && "is-alert")}>
                    <span className="sc-kpi__label">Bentrok jadwal</span>
                    <span className={cx("sc-kpi__value", clash.length > 0 && "sc-dangertext")}>
                        {clash.length}
                        <span className="sc-kpi__unit">sesi</span>
                    </span>
                    {clash.length > 0 ? (
                        <button type="button" className="sc-link sc-link--sm" onClick={() => set({ only: f.only === "conflict" ? "" : "conflict" })}>
                            {f.only === "conflict" ? "Tampilkan semua" : "Lihat yang bentrok"}
                        </button>
                    ) : (
                        <span className="sc-kpi__foot">Host, account dan kapasitas studio aman</span>
                    )}
                </Card>
                <Card className="sc-kpi">
                    <span className="sc-kpi__label">Belum ada report</span>
                    <span className={cx("sc-kpi__value", noReport.length > 0 && "sc-warntext")}>
                        {noReport.length}
                        <span className="sc-kpi__unit">sesi selesai</span>
                    </span>
                    {noReport.length > 0 ? (
                        <button type="button" className="sc-link sc-link--sm" onClick={() => set({ only: f.only === "noreport" ? "" : "noreport" })}>
                            {f.only === "noreport" ? "Tampilkan semua" : "Lihat sesinya"}
                        </button>
                    ) : (
                        <span className="sc-kpi__foot">Semua sesi selesai sudah dilaporkan</span>
                    )}
                </Card>
            </div>

            <Card className="sc-filters">
                <div className="sc-filters__row">
                    <div className="sc-range">
                        <input className="sc-input sc-input--date" type="date" value={f.from} aria-label="Dari tanggal" onChange={(e) => e.target.value && setRange(e.target.value, view === "calendar" ? shiftDay(weekStart(e.target.value), 6) : f.to)} />
                        <span className="sc-muted">–</span>
                        <input className="sc-input sc-input--date" type="date" value={f.to} aria-label="Sampai tanggal" disabled={view === "calendar"} onChange={(e) => e.target.value && setRange(f.from, e.target.value)} />
                    </div>
                    <div className="sc-chips">
                        <button type="button" className={cx("sc-chip", f.from === env.todayKey && f.to === env.todayKey && "is-on")} onClick={() => { setView("list"); setRange(env.todayKey, env.todayKey); }}>
                            Hari ini
                        </button>
                        <button type="button" className={cx("sc-chip", f.from === wk && f.to === shiftDay(wk, 6) && "is-on")} onClick={() => setWeek(env.todayKey)}>
                            Minggu ini
                        </button>
                        <button type="button" className={cx("sc-chip", f.from === mFrom && f.to === mTo && "is-on")} onClick={() => { setView("list"); setRange(mFrom, mTo); }}>
                            Bulan ini
                        </button>
                    </div>
                    <div className="sc-search">
                        {Icon.search()}
                        <input value={f.q} placeholder="Cari SCD, brand, host, account…" onChange={(e) => set({ q: e.target.value })} aria-label="Cari jadwal" />
                    </div>
                </div>
                <div className="sc-filters__row">
                    <Select label="Brand" value={f.brandId} options={brandOpts} onChange={(v) => set({ brandId: v })} />
                    <Select label="Host" value={f.hostId} options={hostOpts} onChange={(v) => set({ hostId: v })} />
                    <Select label="Studio" value={f.studioId} options={studioOpts} onChange={(v) => set({ studioId: v })} />
                    <Select label="Platform" value={f.platform} options={platformOpts} onChange={(v) => set({ platform: v })} />
                    <Select label="Status" value={f.status} options={statusOpts} onChange={(v) => set({ status: v })} />
                    {filtered && (
                        <button type="button" className="sc-link" onClick={() => set({ brandId: "", hostId: "", studioId: "", platform: "", status: "", q: "", only: "" })}>
                            Hapus filter
                        </button>
                    )}
                </div>
            </Card>

            <div className="sc-toolbar">
                <div className="sc-viewtoggle" role="tablist" aria-label="Tampilan">
                    <button type="button" role="tab" aria-selected={view === "calendar"} className={cx(view === "calendar" && "is-on")} onClick={() => switchView("calendar")}>
                        {Icon.calendar(14)} Kalender
                    </button>
                    <button type="button" role="tab" aria-selected={view === "list"} className={cx(view === "list" && "is-on")} onClick={() => switchView("list")}>
                        {Icon.list(14)} List
                    </button>
                </div>
                {view === "calendar" && (
                    <div className="sc-viewtoggle sc-viewtoggle--sm" role="tablist" aria-label="Baris kalender">
                        <button type="button" role="tab" aria-selected={lanes === "brand"} className={cx(lanes === "brand" && "is-on")} onClick={() => setLanes("brand")}>
                            Per brand
                        </button>
                        <button type="button" role="tab" aria-selected={lanes === "studio"} className={cx(lanes === "studio" && "is-on")} onClick={() => setLanes("studio")}>
                            Per studio
                        </button>
                    </div>
                )}
                {view === "calendar" && (
                    <div className="sc-month">
                        <button type="button" className="sc-iconbtn" aria-label="Minggu sebelumnya" onClick={() => setWeek(shiftDay(f.from, -7))}>
                            {Icon.left()}
                        </button>
                        <span className="sc-month__label">{rangeLabel(f.from, f.to)}</span>
                        <button type="button" className="sc-iconbtn" aria-label="Minggu berikutnya" onClick={() => setWeek(shiftDay(f.from, 7))}>
                            {Icon.right()}
                        </button>
                    </div>
                )}
                <div className="sc-legend sc-legend--inline">
                    <span><i className="sc-dot sc-dot--planned" /> Terjadwal</span>
                    <span><i className="sc-dot sc-dot--waiting" /> Menunggu report</span>
                    <span><i className="sc-dot sc-dot--done" /> Selesai</span>
                    <span><i className="sc-dot sc-dot--off" /> Batal / cuti</span>
                    <span><i className="sc-conflictdot" /> Bentrok</span>
                    <span>{Icon.lock(12)} Report masuk</span>
                </div>
            </div>

            {(unknownBrand.length > 0 || unknownHost.length > 0) && !env.loading && (
                <Banner tone="warning">
                    Nama tidak ditemukan untuk{" "}
                    {[unknownBrand.length ? `${unknownBrand.length} brand (${unknownBrand.slice(0, 5).join(", ")}${unknownBrand.length > 5 ? ", …" : ""})` : "", unknownHost.length ? `${unknownHost.length} host (${unknownHost.slice(0, 5).join(", ")}${unknownHost.length > 5 ? ", …" : ""})` : ""].filter(Boolean).join(" dan ")}
                    , jadi ID yang ditampilkan. Pastikan dataset <b>brands</b> dan <b>hosts</b> di-bind dengan kolom ID dan nama (BrandID/Title + NamaBrand, HostID/Title + NamaHost).
                </Banner>
            )}

            {view === "calendar" ? (
                <Calendar env={env} from={f.from} rows={rows} filtered={filtered} lanes={lanes} onCreate={props.onCreate} />
            ) : (
                <div className="sc-tablewrap">
                    <table className="sc-table">
                        <thead>
                            <tr>
                                <th>Tanggal</th>
                                <th>Jam</th>
                                <th>Account</th>
                                <th>Host</th>
                                <th>Studio</th>
                                <th>Platform</th>
                                <th>Status</th>
                                <th aria-label="Aksi" />
                            </tr>
                        </thead>
                        <tbody>
                            {env.loading && rows.length === 0 ? (
                                <SkeletonRows rows={8} cols={8} />
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <EmptyState env={env} filtered={filtered} onClear={() => set({ brandId: "", hostId: "", studioId: "", platform: "", status: "", q: "", only: "" })} onCreate={() => props.onCreate()} />
                                    </td>
                                </tr>
                            ) : (
                                rows.slice(0, limit).map((s, i, shown) => (
                                    <React.Fragment key={s.key}>
                                        {(i === 0 || shown[i - 1].brandName !== s.brandName) && (
                                            <tr className="sc-group">
                                                <td colSpan={8}>
                                                    <b>{s.brandName || "Tanpa brand"}</b>
                                                    <span className="sc-muted">
                                                        {groups.get(s.brandName)?.count ?? 0} sesi · {formatHours(groups.get(s.brandName)?.hours ?? 0)} jam
                                                    </span>
                                                </td>
                                            </tr>
                                        )}
                                        <ListRow env={env} s={s} onEdit={() => props.onEdit(s)} onDelete={() => setConfirmDelete(s)} />
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                    {rows.length > 0 && (
                        <div className="sc-tablefoot">
                            <span>
                                Menampilkan 1–{Math.min(limit, rows.length)} dari {rows.length}
                                {env.loading ? " · memuat halaman berikutnya…" : ""}
                            </span>
                            {limit < rows.length ? (
                                <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                                    Muat lebih banyak
                                </Button>
                            ) : (
                                <span className="sc-end">Semua jadwal sudah ditampilkan</span>
                            )}
                        </div>
                    )}
                </div>
            )}
            {confirmDelete && <DeleteDialog env={env} schedule={confirmDelete} onClose={() => setConfirmDelete(null)} onDeleted={() => setConfirmDelete(null)} />}
        </>
    );
}

function Select(props: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }): React.ReactElement {
    return (
        <label className={cx("sc-select", props.value && "is-set")}>
            <span>{props.label}</span>
            <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
                <option value="">Semua</option>
                {props.options.map((o) => (
                    <option key={o.v} value={o.v}>
                        {o.l}
                    </option>
                ))}
            </select>
        </label>
    );
}

function EmptyState(props: { env: Env; filtered: boolean; onClear: () => void; onCreate: () => void }): React.ReactElement {
    return props.filtered ? (
        <div className="sc-state">
            <div className="sc-state__icon">{Icon.search(24)}</div>
            <div className="sc-state__title">Tidak ada jadwal yang cocok</div>
            <div className="sc-state__text">Coba longgarkan filter atau ubah rentang tanggal.</div>
            <Button variant="secondary" size="sm" onClick={props.onClear}>
                Hapus filter
            </Button>
        </div>
    ) : (
        <div className="sc-state">
            <div className="sc-state__icon">{Icon.calendar(24)}</div>
            <div className="sc-state__title">Belum ada jadwal di rentang ini</div>
            <div className="sc-state__text">Buat satu jadwal, atau unggah file Excel untuk banyak sesi sekaligus.</div>
            {props.env.canEdit && (
                <Button variant="primary" size="sm" icon={Icon.plus(14)} onClick={props.onCreate}>
                    Buat jadwal
                </Button>
            )}
        </div>
    );
}

function ListRow(props: { env: Env; s: ScheduleRow; onEdit: () => void; onDelete: () => void }): React.ReactElement {
    const { env, s } = props;
    const locked = env.ev.isLocked(s);
    const clash = env.conflicts.get(s.key);
    const live = phaseOf(s, env.now) === "live" && scheduleStatus(s.status).chip !== "off";
    return (
        <tr className={cx("sc-row", s.dateKey === env.todayKey && "is-today", live && "is-live", scheduleStatus(s.status).chip === "off" && "is-inactive")} onClick={() => env.open(s)}>
            <td className="sc-nowrap">
                <b>{formatDateShort(s.dateKey)}</b>
                <div className="sc-muted">{HARI[dateKeyToDate(s.dateKey).getDay()]}</div>
            </td>
            <td className="sc-nowrap sc-mono">
                {timeRange(s)}
                {clash && <i className="sc-conflictdot" title={clash.map((c) => c.message).join("\n")} />}
            </td>
            <td className="sc-ellipsis" title={s.accountName}>
                {s.accountName || "—"}
                <div className="sc-muted sc-mono">{s.scheduleId || "ID belum terisi"}</div>
            </td>
            <td>
                <b>{s.hostName || "—"}</b>
                {s.position && <div className="sc-muted">{s.position}</div>}
            </td>
            <td className="sc-nowrap">{s.studioId || "—"}</td>
            <td>{s.platform || "—"}</td>
            <td className="sc-nowrap">
                <StatusBadge status={s.status} />
                {live && <span className="sc-livetag">Live</span>}
                {locked && <span className="sc-lock" title="Report sudah masuk — jadwal terkunci">{Icon.lock(13)}</span>}
            </td>
            <td className="sc-right" onClick={(e) => e.stopPropagation()}>
                <RowMenu env={env} locked={locked} onOpen={() => env.open(s)} onEdit={props.onEdit} onDelete={props.onDelete} />
            </td>
        </tr>
    );
}

function RowMenu(props: { env: Env; locked: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void }): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent): void => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);
    const lockedWhy = "Report sudah masuk — jadwal terkunci";
    return (
        <div className="sc-menu" ref={ref}>
            <button type="button" className="sc-iconbtn" aria-label="Menu baris" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {Icon.more()}
            </button>
            {open && (
                <div className="sc-menu__panel" role="menu">
                    <button type="button" role="menuitem" onClick={props.onOpen}>
                        {Icon.eye(14)} Lihat detail
                    </button>
                    {props.env.canEdit && (
                        <>
                            <button type="button" role="menuitem" disabled={props.locked} title={props.locked ? lockedWhy : undefined} onClick={() => { setOpen(false); props.onEdit(); }}>
                                {Icon.edit(14)} Ubah
                            </button>
                            <button type="button" role="menuitem" className="is-danger" disabled={props.locked} title={props.locked ? lockedWhy : undefined} onClick={() => { setOpen(false); props.onDelete(); }}>
                                {Icon.trash(14)} Hapus
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------
// Calendar: week columns × studio lanes

function Calendar(props: { env: Env; from: string; rows: ScheduleRow[]; filtered: boolean; lanes: Lanes; onCreate: (preset?: Partial<ScheduleRow>) => void }): React.ReactElement {
    const { env } = props;
    const byBrand = props.lanes === "brand";
    const days = rangeKeys(props.from, shiftDay(props.from, 6));
    const laneOf = (s: ScheduleRow): string => (byBrand ? s.brandName : s.studioId) || "—";
    const laneIds = byBrand
        ? distinct(props.rows.map(laneOf)).sort(byName)
        : distinct([...(props.filtered ? [] : env.studios.filter((s) => s.isActive).map((s) => s.studioId)), ...props.rows.map(laneOf)]);
    const brandOfLane = new Map<string, ScheduleRow>();
    for (const s of props.rows) if (!brandOfLane.has(laneOf(s).toLowerCase())) brandOfLane.set(laneOf(s).toLowerCase(), s);
    const cell = new Map<string, ScheduleRow[]>();
    for (const s of props.rows) {
        const k = `${laneOf(s).toLowerCase()}|${s.dateKey}`;
        const a = cell.get(k);
        if (a) a.push(s);
        else cell.set(k, [s]);
    }

    if (env.loading && props.rows.length === 0) {
        return (
            <div className="sc-tablewrap">
                <table className="sc-table">
                    <tbody>
                        <SkeletonRows rows={5} cols={8} />
                    </tbody>
                </table>
            </div>
        );
    }
    if (laneIds.length === 0) {
        return (
            <div className="sc-tablewrap">
                <div className="sc-state">
                    <div className="sc-state__icon">{Icon.calendar(24)}</div>
                    <div className="sc-state__title">{props.filtered ? "Tidak ada jadwal yang cocok minggu ini" : "Belum ada studio atau jadwal"}</div>
                    <div className="sc-state__text">{props.filtered ? "Ubah filter atau pindah minggu." : "Tambahkan studio di Studio Directory, lalu buat jadwal."}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="sc-cal">
            <div className="sc-cal__row sc-cal__row--head">
                <div className="sc-cal__lane">{byBrand ? "Brand" : "Studio"}</div>
                {days.map((d) => {
                    const dt = dateKeyToDate(d);
                    return (
                        <div key={d} className={cx("sc-cal__dayhead", d === env.todayKey && "is-today")}>
                            <span>{HARI[dt.getDay()].slice(0, 3)}</span>
                            <b>{dt.getDate()}</b>
                        </div>
                    );
                })}
            </div>
            {laneIds.map((id) => {
                const st = byBrand ? undefined : env.lk.studios.get(id.toLowerCase());
                const first = brandOfLane.get(id.toLowerCase());
                const laneCount = props.rows.filter((s) => laneOf(s).toLowerCase() === id.toLowerCase()).length;
                return (
                    <div key={id} className="sc-cal__row">
                        <div className="sc-cal__lane">
                            {byBrand ? (
                                <>
                                    <b>{id}</b>
                                    <span className="sc-muted">{laneCount} sesi minggu ini</span>
                                </>
                            ) : (
                                <>
                                    <b className="sc-mono">{id}</b>
                                    <span className="sc-muted">{st ? `${st.namaStudio || ""} · ${Math.max(1, st.kapasitasHost || 1)} host` : "Tidak ada di master Studio"}</span>
                                </>
                            )}
                        </div>
                        {days.map((d) => {
                            const items = (cell.get(`${id.toLowerCase()}|${d}`) ?? []).sort(sortSessions);
                            return (
                                <div key={d} className={cx("sc-cal__cell", d === env.todayKey && "is-today", d < env.todayKey && "is-past")}>
                                    {items.map((s) => (
                                        <CalChip key={s.key} env={env} s={s} lane={props.lanes} />
                                    ))}
                                    {env.canEdit && d >= env.todayKey && (st || (byBrand && first)) && (
                                        <button
                                            type="button"
                                            className="sc-cal__add"
                                            aria-label={`Buat jadwal ${id} ${d}`}
                                            onClick={() => props.onCreate(st ? { studioId: st.studioId, dateKey: d } : { brandId: first?.brandId ?? "", dateKey: d })}
                                        >
                                            {Icon.plus(12)}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

function CalChip(props: { env: Env; s: ScheduleRow; lane: Lanes }): React.ReactElement {
    const { env, s } = props;
    const st = scheduleStatus(s.status);
    const clash = env.conflicts.get(s.key);
    const locked = env.ev.isLocked(s);
    const live = st.chip !== "off" && phaseOf(s, env.now) === "live";
    const title = [`${s.scheduleId || "ID belum terisi"} · ${st.label}`, `${timeRange(s)} · ${s.brandName}`, `${s.hostName} · ${s.platform}${s.accountName ? " · " + s.accountName : ""}`, ...(clash ?? []).map((c) => "⚠ " + c.message)].join("\n");
    return (
        <button type="button" className={cx("sc-calchip", `sc-calchip--${st.chip}`, live && "is-live")} title={title} onClick={() => env.open(s)}>
            <span className="sc-calchip__top">
                <span className="sc-mono">{timeRange(s)}</span>
                {locked && <span className="sc-calchip__lock">{Icon.lock(11)}</span>}
                {clash && <i className="sc-conflictdot" />}
            </span>
            {props.lane === "brand" ? (
                <>
                    <b className="sc-calchip__brand">{s.hostName || "—"}</b>
                    <span className="sc-calchip__meta">
                        {s.studioId}
                        {s.platform ? ` · ${s.platform}` : ""}
                    </span>
                </>
            ) : (
                <>
                    <b className="sc-calchip__brand">{s.brandName}</b>
                    <span className="sc-calchip__meta">
                        {s.hostName}
                        {s.platform ? ` · ${s.platform}` : ""}
                    </span>
                </>
            )}
        </button>
    );
}
