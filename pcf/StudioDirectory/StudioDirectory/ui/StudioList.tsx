import * as React from "react";
import { StudioRow } from "../core/types";
import { formatDateLong, formatDateShort, formatDuration, formatMinutes, formatMonth, monthName, shiftMonth } from "../core/time";
import {
    dailySeries,
    hours,
    liveInfo,
    LiveInfo,
    monthDeltaPoints,
    overallDay,
    overallMonth,
    pct,
    studioDay,
    studioMonth,
} from "../core/utilization";
import { Badge, Bar, Button, Card, cx, DailyChart, Icon, SkeletonRows, utilTone } from "./components";
import { Env } from "./App";
import { GeoCell, geoState, MIN_SAFE_RADIUS, needsAction, StudioStatusBadge } from "./shared";

type Filter = "all" | "active" | "inactive" | "action";

export function MonthSwitcher(props: { env: Env }): React.ReactElement {
    const { monthKey, setMonth } = props.env;
    return (
        <div className="sd-month" role="group" aria-label="Pilih bulan">
            <button type="button" className="sd-iconbtn" onClick={() => setMonth(shiftMonth(monthKey, -1))} aria-label="Bulan sebelumnya">
                {Icon.left()}
            </button>
            <span className="sd-month__label">{formatMonth(monthKey)}</span>
            <button type="button" className="sd-iconbtn" onClick={() => setMonth(shiftMonth(monthKey, 1))} aria-label="Bulan berikutnya">
                {Icon.right()}
            </button>
        </div>
    );
}

export function LiveTile(props: { env: Env; studio: StudioRow; live: LiveInfo }): React.ReactElement {
    const { studio, live } = props;
    const isLive = live.running.length > 0;
    const full = live.slotsUsed >= live.capacity;
    return (
        <button type="button" className={cx("sd-live", isLive && "is-live")} onClick={() => props.env.openStudio(studio.studioId)}>
            <div className="sd-live__top">
                <span className="sd-mono sd-live__id">{studio.studioId}</span>
                {isLive ? (
                    <span className="sd-livebadge">
                        <span className="sd-livebadge__dot" /> Live
                    </span>
                ) : (
                    <Badge tone="neutral">Kosong</Badge>
                )}
            </div>
            {isLive ? (
                <>
                    <div className="sd-live__brand">{live.brands.join(" · ") || "Brand tidak diketahui"}</div>
                    <div className="sd-live__sub">{live.hosts.join(" · ") || "Host tidak diketahui"}</div>
                    <div className="sd-live__meta">
                        {formatMinutes(live.startMin)}–{formatMinutes(live.endMin)} · sisa {formatDuration(live.remainingMin)}
                    </div>
                    <div className={cx("sd-live__meta", full && "is-strong")}>
                        {live.slotsUsed} dari {live.capacity} slot terpakai{full ? (live.slotsUsed > live.capacity ? " · melebihi kapasitas" : " · penuh") : ""}
                    </div>
                </>
            ) : (
                <>
                    <div className="sd-live__brand">Tidak ada sesi</div>
                    <div className="sd-live__sub">{studio.namaStudio || "—"}</div>
                    <div className="sd-live__meta">
                        {live.next
                            ? `Sesi berikutnya ${live.next.dateKey === props.env.todayKey ? "hari ini" : formatDateShort(live.next.dateKey)} ${live.next.startMin !== null ? formatMinutes(live.next.startMin) : live.next.startText}`
                            : "Belum ada sesi berikutnya"}
                    </div>
                    <div className="sd-live__meta">0 dari {live.capacity} slot terpakai</div>
                </>
            )}
        </button>
    );
}

export function StudioList(props: { env: Env; onCreate: () => void }): React.ReactElement {
    const { env } = props;
    const { studios, idx, op, todayKey, nowMin, monthKey, locationOf } = env;
    const [query, setQuery] = React.useState("");
    const [filter, setFilter] = React.useState<Filter>("all");

    const active = studios.filter((s) => s.isActive);
    const today = overallDay(idx, studios, todayKey, op);
    const month = overallMonth(idx, studios, monthKey, op);
    const delta = monthDeltaPoints(idx, studios, monthKey, op);
    const lives = active.map((s) => ({ studio: s, live: liveInfo(idx, s, todayKey, nowMin) }));
    const liveCount = lives.filter((l) => l.live.running.length > 0).length;
    lives.sort((a, b) => Number(b.live.running.length > 0) - Number(a.live.running.length > 0) || a.studio.studioId.localeCompare(b.studio.studioId));

    const issues = active
        .map((s) => ({ s, st: geoState(locationOf(s)), r: locationOf(s)?.radiusMeter }))
        .filter((x) => x.st !== "ok");
    const missingGeo = studios.filter((s) => geoState(locationOf(s)) === "missing").length;

    const q = query.trim().toLowerCase();
    const rows = studios.filter((s) => {
        if (filter === "active" && !s.isActive) return false;
        if (filter === "inactive" && s.isActive) return false;
        if (filter === "action" && !needsAction(s, locationOf(s))) return false;
        if (!q) return true;
        return [s.studioId, s.namaStudio, s.lokasiStudio].some((v) => v.toLowerCase().includes(q));
    });
    const filtered = filter !== "all" || !!q;
    const loadingFirst = env.loading.studios && studios.length === 0;
    const loadingMore = env.loading.studios && studios.length > 0;
    const scheduleLoading = env.loading.schedules;

    const series = dailySeries(idx, studios, monthKey, op);
    const inMonth = series.filter((p) => p.stat.ratio !== null);
    const avg = inMonth.length ? inMonth.reduce((t, p) => t + (p.stat.ratio ?? 0), 0) / inMonth.length : null;
    const peak = inMonth.reduce<(typeof series)[number] | null>((b, p) => (!b || (p.stat.ratio ?? 0) > (b.stat.ratio ?? 0) ? p : b), null);
    const opLabel = `${formatMinutes(op.startMin)}–${formatMinutes(op.endMin)}`;
    const COLS = 10;

    return (
        <>
            <div className="sd-pagehead">
                <div>
                    <div className="sd-crumb">Master data</div>
                    <h1 className="sd-h1">Studio</h1>
                    <div className="sd-sub">
                        {studios.length} studio · {missingGeo} belum punya geofence · {formatDateLong(todayKey)} · {formatMinutes(nowMin)}
                    </div>
                </div>
                <div className="sd-pagehead__actions">
                    <MonthSwitcher env={env} />
                    {env.canEdit && (
                        <Button variant="primary" icon={Icon.plus()} onClick={props.onCreate} disabled={!!env.pending}>
                            Tambah studio
                        </Button>
                    )}
                </div>
            </div>

            <div className="sd-kpis">
                <Card className="sd-kpi">
                    <div className="sd-kpi__label">Utilisasi hari ini</div>
                    <div className="sd-kpi__value">
                        {scheduleLoading ? <span className="sd-skel" style={{ width: 60 }} /> : pct(today.ratio)}
                        <span className="sd-kpi__unit">
                            {hours(today.usedMin)} / {hours(today.capacityMin)} jam slot
                        </span>
                    </div>
                    <Bar ratio={today.ratio} tone="success" />
                    <div className="sd-kpi__foot">
                        {active.length} studio aktif · jam operasional {opLabel}
                    </div>
                </Card>
                <Card className="sd-kpi">
                    <div className="sd-kpi__label">Utilisasi {monthName(monthKey)}</div>
                    <div className="sd-kpi__value">
                        {scheduleLoading ? <span className="sd-skel" style={{ width: 60 }} /> : pct(month.ratio)}
                        {delta !== null && (
                            <span className={cx("sd-kpi__delta", delta >= 0 ? "is-up" : "is-down")}>
                                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pt dari {monthName(shiftMonth(monthKey, -1))}
                            </span>
                        )}
                    </div>
                    <Bar ratio={month.ratio} tone="success" />
                    <div className="sd-kpi__foot">
                        {hours(month.usedMin)} dari {hours(month.capacityMin)} jam slot terjadwal
                    </div>
                </Card>
                <Card className="sd-kpi">
                    <div className="sd-kpi__label">Sedang digunakan</div>
                    <div className="sd-kpi__value">
                        {liveCount}
                        <span className="sd-kpi__unit">dari {active.length} studio aktif</span>
                    </div>
                    <div className="sd-segs" aria-hidden="true">
                        {lives.map((l) => (
                            <span key={l.studio.key} className={cx("sd-seg", l.live.running.length > 0 && "is-on")} />
                        ))}
                    </div>
                    <div className="sd-kpi__foot">{active.length - liveCount} studio kosong sekarang</div>
                </Card>
                <Card className="sd-kpi">
                    <div className="sd-kpi__label">Perlu tindakan</div>
                    <div className="sd-kpi__value">
                        {issues.length}
                        <span className="sd-kpi__unit">studio</span>
                    </div>
                    {issues.length === 0 ? (
                        <div className="sd-kpi__foot">Semua studio aktif punya geofence yang aman.</div>
                    ) : (
                        <ul className="sd-issues">
                            {issues.slice(0, 3).map((x) => (
                                <li key={x.s.key}>
                                    <button type="button" className={cx("sd-issue", x.st === "small" || x.st === "inactive" ? "is-warn" : "is-danger")} onClick={() => env.openStudio(x.s.studioId)}>
                                        {Icon.warn(13)}
                                        <span>
                                            {x.s.studioId}{" "}
                                            {x.st === "missing"
                                                ? "belum ada geofence"
                                                : x.st === "small"
                                                  ? `radius ${x.r} m`
                                                  : x.st === "inactive"
                                                    ? "geofence nonaktif"
                                                    : "koordinat tidak valid"}
                                        </span>
                                    </button>
                                </li>
                            ))}
                            {issues.length > 3 && <li className="sd-kpi__foot">+{issues.length - 3} lainnya</li>}
                        </ul>
                    )}
                </Card>
            </div>

            <Card title="Sedang digunakan sekarang" aside={<span className="sd-muted">diperbarui {formatMinutes(nowMin)}</span>} className="sd-livecard">
                {loadingFirst || scheduleLoading ? (
                    <div className="sd-livegrid">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="sd-live sd-live--skel">
                                <span className="sd-skel" style={{ width: "40%" }} />
                                <span className="sd-skel" style={{ width: "70%" }} />
                                <span className="sd-skel" style={{ width: "55%" }} />
                            </div>
                        ))}
                    </div>
                ) : lives.length === 0 ? (
                    <div className="sd-emptyline">Belum ada studio aktif.</div>
                ) : (
                    <div className="sd-livegrid">
                        {lives.map((l) => (
                            <LiveTile key={l.studio.key} env={env} studio={l.studio} live={l.live} />
                        ))}
                    </div>
                )}
                <p className="sd-footnote">
                    “Live” diturunkan dari jadwal yang tanggalnya hari ini dan jam sekarang berada di antara jam mulai dan jam selesai sesi. Sesi berstatus Cancelled atau Leave tidak dihitung.
                </p>
            </Card>

            <Card
                title={`Utilisasi harian · ${formatMonth(monthKey)}`}
                aside={
                    <span className="sd-muted">
                        rata-rata {pct(avg)}
                        {peak && peak.stat.ratio ? ` · tertinggi ${pct(peak.stat.ratio)} (${formatDateShort(peak.dateKey)})` : ""}
                    </span>
                }
            >
                <DailyChart
                    todayKey={todayKey}
                    points={series.map((p) => ({
                        dateKey: p.dateKey,
                        ratio: p.stat.ratio,
                        label: `${formatDateLong(p.dateKey)} — ${pct(p.stat.ratio)} (${hours(p.stat.usedMin)} / ${hours(p.stat.capacityMin)} jam, ${p.stat.sessions} sesi)`,
                    }))}
                />
                <div className="sd-legend">
                    <span><i className="sd-dot sd-dot--warning" /> di bawah 40%</span>
                    <span><i className="sd-dot sd-dot--success" /> 40–89%</span>
                    <span><i className="sd-dot sd-dot--danger" /> 90% ke atas</span>
                    <span><i className="sd-dot sd-dot--today" /> hari ini</span>
                </div>
            </Card>

            <div className="sd-toolbar">
                <div className="sd-search">
                    {Icon.search(14)}
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari StudioID, nama, atau lokasi" aria-label="Cari studio" />
                </div>
                <div className="sd-chips" role="tablist" aria-label="Filter studio">
                    {(
                        [
                            ["all", "Semua"],
                            ["active", "Aktif"],
                            ["inactive", "Nonaktif"],
                            ["action", "Perlu tindakan"],
                        ] as [Filter, string][]
                    ).map(([k, label]) => (
                        <button key={k} type="button" role="tab" aria-selected={filter === k} className={cx("sd-chip", filter === k && "is-on")} onClick={() => setFilter(k)}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="sd-tablewrap">
                <table className="sd-table">
                    <thead>
                        <tr>
                            <th>StudioID</th>
                            <th>Nama studio</th>
                            <th>Kapasitas</th>
                            <th>Lokasi</th>
                            <th>Hari ini</th>
                            <th>Utilisasi {monthName(monthKey)}</th>
                            <th>Sedang dipakai</th>
                            <th>Status</th>
                            <th>Geofence</th>
                            <th aria-label="Aksi" />
                        </tr>
                    </thead>
                    <tbody>
                        {loadingFirst ? (
                            <SkeletonRows rows={5} cols={COLS} />
                        ) : studios.length === 0 ? (
                            <tr>
                                <td colSpan={COLS}>
                                    <div className="sd-state">
                                        <span className="sd-state__icon">{Icon.studio(28)}</span>
                                        <div className="sd-state__title">Belum ada studio</div>
                                        <div className="sd-state__text">Tambahkan studio supaya bisa dipakai di jadwal live dan untuk clock in host.</div>
                                        {env.canEdit && (
                                            <Button variant="primary" icon={Icon.plus()} onClick={props.onCreate}>
                                                Tambah studio
                                            </Button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={COLS}>
                                    <div className="sd-state">
                                        <span className="sd-state__icon">{Icon.search(28)}</span>
                                        <div className="sd-state__title">Tidak ada studio yang cocok dengan filter ini</div>
                                        <div className="sd-state__text">Ubah kata kunci atau hapus filter untuk melihat semua studio.</div>
                                        <Button
                                            onClick={() => {
                                                setQuery("");
                                                setFilter("all");
                                            }}
                                        >
                                            Hapus filter
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            rows.map((s) => {
                                const loc = locationOf(s);
                                const d = studioDay(idx, s, todayKey, op);
                                const m = studioMonth(idx, s, monthKey, op);
                                const live = liveInfo(idx, s, todayKey, nowMin);
                                return (
                                    <tr key={s.key} className={cx("sd-row", !s.isActive && "is-inactive")} onClick={() => env.openStudio(s.studioId)}>
                                        <td className="sd-mono">{s.studioId}</td>
                                        <td className="sd-strong">{s.namaStudio || "—"}</td>
                                        <td>{s.kapasitasHost > 0 ? `${s.kapasitasHost} host` : <span className="sd-warntext" title="KapasitasHost kosong — utilisasi dihitung dengan kapasitas 1">— host</span>}</td>
                                        <td className="sd-ellipsis" title={s.lokasiStudio}>
                                            {s.lokasiStudio || "—"}
                                        </td>
                                        <td>
                                            <span className={cx("sd-pct", `sd-pct--${utilTone(d.ratio)}`)}>{s.isActive ? pct(d.ratio) : "—"}</span>
                                        </td>
                                        <td className="sd-utilcell">
                                            <div className={cx("sd-utilcell__num", utilTone(m.ratio) === "danger" && "is-danger")}>
                                                {hours(m.usedMin)} / {hours(m.capacityMin)} jam
                                            </div>
                                            <Bar ratio={m.ratio} />
                                        </td>
                                        <td className="sd-nowcell">
                                            {live.running.length ? (
                                                <>
                                                    <span className="sd-livebadge sd-livebadge--sm">
                                                        <span className="sd-livebadge__dot" /> Live
                                                    </span>
                                                    <span className="sd-nowcell__text" title={`${live.brands.join(", ")} — ${live.hosts.join(", ")}`}>
                                                        <b>{live.brands.join(", ")}</b> · {live.hosts.join(", ")}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="sd-muted">—</span>
                                            )}
                                        </td>
                                        <td>
                                            <StudioStatusBadge studio={s} />
                                        </td>
                                        <td onClick={(e) => e.stopPropagation()}>
                                            <GeoCell loc={loc} onFix={() => env.openStudio(s.studioId)} />
                                        </td>
                                        <td className="sd-right">
                                            <button type="button" className="sd-link" onClick={(e) => { e.stopPropagation(); env.openStudio(s.studioId); }}>
                                                Buka
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                        {loadingMore && <SkeletonRows rows={2} cols={COLS} />}
                    </tbody>
                </table>
                {!loadingFirst && studios.length > 0 && (
                    <div className="sd-tablefoot">
                        <span>
                            Menampilkan {rows.length === 0 ? 0 : 1}–{rows.length} dari {studios.length} studio · {active.length} aktif
                            {!loadingMore && <span className="sd-end"> · semua data sudah dimuat</span>}
                        </span>
                        <span>
                            Utilisasi = jam terjadwal ÷ (kapasitas × jam operasional {opLabel}). Radius di bawah {MIN_SAFE_RADIUS} m ditandai.
                        </span>
                    </div>
                )}
            </div>
        </>
    );
}
