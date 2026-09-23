import * as React from "react";
import { StudioRow } from "../core/types";
import { formatDateLong, formatDateShort, formatDuration, formatMinutes, formatMonth, monthKeyOf, monthName, shiftDay, toMonthKey } from "../core/time";
import { effectiveCapacity, hourlySlots, hours, liveInfo, pct, studioDailySeries, studioDay, studioMonth } from "../core/utilization";
import { occupiesStudio } from "../core/data";
import { Badge, Bar, Button, Card, cx, DailyChart, Icon, Pill } from "./components";
import { Env } from "./App";
import { GeoCell, geoState, scheduleStatus, statusLabel } from "./shared";
import { GeofenceEditor } from "./GeofenceEditor";
import { MonthSwitcher } from "./StudioList";
import { GmvCard, GmvCell, MonthSchedule, ReportCell, UpcomingCard } from "./StudioGmv";
import { formatIdrShort, sessionGmv, studioGmv } from "../core/gmv";

type Tab = "ringkasan" | "geofence" | "jadwal";

export function StudioDetail(props: { env: Env; studio: StudioRow; onBack: () => void; onEdit: () => void }): React.ReactElement {
    const { env, studio } = props;
    const loc = env.locationOf(studio);
    const gs = geoState(loc);
    const [tab, setTab] = React.useState<Tab>(gs === "missing" && env.canEdit ? "geofence" : "ringkasan");
    const [dayKey, setDayKey] = React.useState(env.todayKey);
    const month = studioMonth(env.idx, studio, env.monthKey, env.op);
    const gmv = studioGmv(env.idx, env.reports, studio, env.monthKey, env.todayKey, env.nowMin);
    const pickDay = (d: string): void => {
        setDayKey(d);
        if (monthKeyOf(d) !== env.monthKey) env.setMonth(monthKeyOf(d));
    };

    // Keep the Jadwal day inside the selected month when the month changes.
    React.useEffect(() => {
        if (monthKeyOf(dayKey) !== env.monthKey) setDayKey(env.monthKey === toMonthKey(env.now) ? env.todayKey : `${env.monthKey}-01`);
    }, [env.monthKey]);

    return (
        <>
            <button type="button" className="sd-back" onClick={props.onBack}>
                {Icon.left(14)} Studio
            </button>

            <Card className="sd-record">
                <div className="sd-record__id sd-mono">{studio.studioId}</div>
                <div className="sd-record__cell">
                    <span>Nama studio</span>
                    <b>{studio.namaStudio || "—"}</b>
                </div>
                <div className="sd-record__cell">
                    <span>Kapasitas host</span>
                    <b>{studio.kapasitasHost > 0 ? `${studio.kapasitasHost} host per slot` : "Belum diisi"}</b>
                </div>
                <div className="sd-record__cell">
                    <span>Utilisasi {monthName(env.monthKey)}</span>
                    <b>
                        {hours(month.usedMin)} / {hours(month.capacityMin)} jam · {pct(month.ratio)}
                    </b>
                </div>
                <div className="sd-record__cell">
                    <span>GMV {monthName(env.monthKey)}</span>
                    <b>{env.reports.size === 0 ? "—" : formatIdrShort(gmv.total)}</b>
                </div>
                <div className="sd-record__cell">
                    <span>Geofence</span>
                    <b>
                        <GeoCell loc={loc} onFix={() => setTab("geofence")} />
                    </b>
                </div>
                <div className="sd-record__end">
                    <Pill tone={studio.isActive ? "success" : "neutral"}>{statusLabel(studio)}</Pill>
                    {env.canEdit && (
                        <Button size="sm" icon={Icon.edit(14)} onClick={props.onEdit} disabled={!!env.pending}>
                            Ubah
                        </Button>
                    )}
                </div>
            </Card>

            <div className="sd-tabs" role="tablist">
                {(
                    [
                        ["ringkasan", "Ringkasan"],
                        ["geofence", "Geofence"],
                        ["jadwal", "Jadwal"],
                    ] as [Tab, string][]
                ).map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={cx("sd-tab", tab === k && "is-on")} onClick={() => setTab(k)}>
                        {label}
                        {k === "geofence" && gs !== "ok" && <span className={cx("sd-tabdot", gs === "small" || gs === "inactive" ? "is-warn" : "is-danger")} aria-label="perlu tindakan" />}
                    </button>
                ))}
                <div className="sd-tabs__end">{tab !== "geofence" && <MonthSwitcher env={env} />}</div>
            </div>

            {tab === "ringkasan" && <Ringkasan env={env} studio={studio} onOpenDay={(d) => { pickDay(d); setTab("jadwal"); }} onGeofence={() => setTab("geofence")} />}
            {tab === "geofence" && <GeofenceEditor key={`${studio.key}-${loc?.key ?? "none"}`} env={env} studio={studio} location={loc} />}
            {tab === "jadwal" && <Jadwal env={env} studio={studio} dayKey={dayKey} setDayKey={pickDay} />}
        </>
    );
}

function Ringkasan(props: { env: Env; studio: StudioRow; onOpenDay: (d: string) => void; onGeofence: () => void }): React.ReactElement {
    const { env, studio } = props;
    const live = liveInfo(env.idx, studio, env.todayKey, env.nowMin);
    const today = studioDay(env.idx, studio, env.todayKey, env.op);
    const month = studioMonth(env.idx, studio, env.monthKey, env.op);
    const series = studioDailySeries(env.idx, studio, env.monthKey, env.op);
    const loc = env.locationOf(studio);
    const isLive = live.running.length > 0;

    return (
        <div className="sd-grid2">
            <div className="sd-stack">
                <Card
                    title="Sedang digunakan"
                    aside={
                        isLive ? (
                            <span className="sd-livebadge">
                                <span className="sd-livebadge__dot" /> Live · {formatMinutes(env.nowMin)}
                            </span>
                        ) : (
                            <Badge tone="neutral">Kosong</Badge>
                        )
                    }
                >
                    {!studio.isActive ? (
                        <div className="sd-emptyline">Studio nonaktif — tidak dipakai untuk jadwal.</div>
                    ) : isLive ? (
                        <div className="sd-nowlist">
                            {live.running.map((s) => (
                                <div key={s.key} className="sd-now">
                                    <div className="sd-now__brand">{s.brandName || "—"}</div>
                                    <div className="sd-now__host">
                                        {s.hostName || "—"}
                                        {s.platform && <span className="sd-muted"> · {s.platform}</span>}
                                        {s.account && <span className="sd-muted"> · {s.account}</span>}
                                    </div>
                                    <div className="sd-now__time">
                                        {s.startMin !== null ? formatMinutes(s.startMin) : s.startText}–{s.endMin !== null ? formatMinutes(s.endMin) : s.endText}
                                        {s.endMin !== null && ` · sisa ${formatDuration((s.dateKey === env.todayKey ? s.endMin : s.endMin - 1440) - env.nowMin)}`}
                                        {s.scheduleId && <span className="sd-mono sd-muted"> · {s.scheduleId}</span>}
                                    </div>
                                </div>
                            ))}
                            <div className={cx("sd-slots", live.slotsUsed > live.capacity && "is-over")}>
                                <div className="sd-slots__dots" aria-hidden="true">
                                    {Array.from({ length: Math.max(live.capacity, live.slotsUsed) }).map((_, i) => (
                                        <span key={i} className={cx("sd-slotdot", i < live.slotsUsed && "is-on", i >= live.capacity && "is-over")} />
                                    ))}
                                </div>
                                {live.slotsUsed} dari {live.capacity} slot host terpakai
                                {live.slotsUsed > live.capacity ? " · melebihi kapasitas" : live.slotsUsed === live.capacity ? " · penuh" : ""}
                            </div>
                        </div>
                    ) : (
                        <div className="sd-emptyline">
                            Tidak ada sesi yang sedang berjalan.
                            <br />
                            {live.next ? (
                                <>
                                    Sesi berikutnya: <b>{live.next.dateKey === env.todayKey ? "hari ini" : formatDateLong(live.next.dateKey)}</b>{" "}
                                    {live.next.startMin !== null ? formatMinutes(live.next.startMin) : live.next.startText} · {live.next.brandName} · {live.next.hostName}
                                </>
                            ) : (
                                "Belum ada sesi berikutnya di data yang dimuat."
                            )}
                        </div>
                    )}
                </Card>

                <div className="sd-kpis sd-kpis--2">
                    <Card className="sd-kpi">
                        <div className="sd-kpi__label">Utilisasi hari ini</div>
                        <div className="sd-kpi__value">
                            {pct(today.ratio)}
                            <span className="sd-kpi__unit">
                                {hours(today.usedMin)} / {hours(today.capacityMin)} jam slot
                            </span>
                        </div>
                        <Bar ratio={today.ratio} />
                        <div className="sd-kpi__foot">{today.sessions} sesi hari ini</div>
                    </Card>
                    <Card className="sd-kpi">
                        <div className="sd-kpi__label">Utilisasi {monthName(env.monthKey)}</div>
                        <div className="sd-kpi__value">
                            {pct(month.ratio)}
                            <span className="sd-kpi__unit">
                                {hours(month.usedMin)} / {hours(month.capacityMin)} jam slot
                            </span>
                        </div>
                        <Bar ratio={month.ratio} />
                        <div className="sd-kpi__foot">{month.sessions} sesi terjadwal</div>
                    </Card>
                </div>

                <GmvCard env={env} studio={studio} />

                <Card title={`Utilisasi harian · ${formatMonth(env.monthKey)}`} aside={<span className="sd-muted">klik batang untuk lihat jadwal hari itu</span>}>
                    <DailyChart
                        todayKey={env.todayKey}
                        onPick={props.onOpenDay}
                        points={series.map((p) => ({
                            dateKey: p.dateKey,
                            ratio: p.stat.ratio,
                            label: `${formatDateLong(p.dateKey)} — ${pct(p.stat.ratio)} (${hours(p.stat.usedMin)} / ${hours(p.stat.capacityMin)} jam, ${p.stat.sessions} sesi)`,
                        }))}
                    />
                </Card>
            </div>

            <div className="sd-stack">
                <UpcomingCard env={env} studio={studio} onOpenDay={props.onOpenDay} />
                <Card title="Detail studio">
                    <dl className="sd-dl">
                        <dt>StudioID</dt>
                        <dd className="sd-mono">{studio.studioId}</dd>
                        <dt>Nama studio</dt>
                        <dd>{studio.namaStudio || "—"}</dd>
                        <dt>Kapasitas host</dt>
                        <dd>{studio.kapasitasHost > 0 ? `${studio.kapasitasHost} host bersamaan` : <span className="sd-warntext">Belum diisi — utilisasi memakai kapasitas {effectiveCapacity(studio)}</span>}</dd>
                        <dt>Lokasi</dt>
                        <dd>{studio.lokasiStudio || "—"}</dd>
                        <dt>Status</dt>
                        <dd>{statusLabel(studio)}</dd>
                    </dl>
                    <p className="sd-footnote">Lokasi adalah alamat teks. Titik clock in host diambil dari geofence, bukan dari alamat ini.</p>
                </Card>
                <Card title="Geofence" aside={<button type="button" className="sd-link" onClick={props.onGeofence}>Buka</button>}>
                    {loc ? (
                        <dl className="sd-dl">
                            <dt>Nama lokasi</dt>
                            <dd>{loc.title || "—"}</dd>
                            <dt>Koordinat</dt>
                            <dd className="sd-mono">
                                {loc.latitude ?? "—"}, {loc.longitude ?? "—"}
                            </dd>
                            <dt>Radius</dt>
                            <dd>
                                <GeoCell loc={loc} onFix={props.onGeofence} />
                            </dd>
                            <dt>Status</dt>
                            <dd>{loc.isActive ? "Aktif — host bisa clock in" : "Nonaktif — host tidak bisa clock in"}</dd>
                        </dl>
                    ) : (
                        <div className="sd-emptyline sd-dangertext">Studio ini belum punya geofence. Host tidak bisa clock in di sini.</div>
                    )}
                </Card>
            </div>
        </div>
    );
}

function Jadwal(props: { env: Env; studio: StudioRow; dayKey: string; setDayKey: (d: string) => void }): React.ReactElement {
    const { env, studio, dayKey, setDayKey } = props;
    const sessions = env.idx.day(studio.studioId, dayKey);
    const slots = hourlySlots(env.idx, studio, dayKey, env.op);
    const day = studioDay(env.idx, studio, dayKey, env.op);
    const series = studioDailySeries(env.idx, studio, env.monthKey, env.op);
    const overSlots = slots.filter((s) => s.used > s.capacity);
    const isToday = dayKey === env.todayKey;
    const running = new Set(isToday ? liveInfo(env.idx, studio, env.todayKey, env.nowMin).running.map((s) => s.key) : []);

    return (
        <div className="sd-stack">
            <Card title={`Utilisasi harian · ${formatMonth(env.monthKey)}`} aside={<span className="sd-muted">pilih tanggal</span>}>
                <DailyChart
                    todayKey={env.todayKey}
                    selectedKey={dayKey}
                    onPick={setDayKey}
                    points={series.map((p) => ({
                        dateKey: p.dateKey,
                        ratio: p.stat.ratio,
                        label: `${formatDateLong(p.dateKey)} — ${pct(p.stat.ratio)} (${p.stat.sessions} sesi)`,
                    }))}
                />
            </Card>

            <Card
                title={
                    <span className="sd-dayhead">
                        <button type="button" className="sd-iconbtn" onClick={() => setDayKey(shiftDay(dayKey, -1))} aria-label="Hari sebelumnya">
                            {Icon.left()}
                        </button>
                        <span>{formatDateLong(dayKey)}</span>
                        <button type="button" className="sd-iconbtn" onClick={() => setDayKey(shiftDay(dayKey, 1))} aria-label="Hari berikutnya">
                            {Icon.right()}
                        </button>
                        {!isToday && (
                            <button type="button" className="sd-link" onClick={() => setDayKey(env.todayKey)}>
                                Hari ini
                            </button>
                        )}
                    </span>
                }
                aside={
                    <span className="sd-muted">
                        {day.sessions} sesi · utilisasi {pct(day.ratio)} ({hours(day.usedMin)} / {hours(day.capacityMin)} jam)
                    </span>
                }
            >
                <div className="sd-slotstrip" role="list" aria-label="Kapasitas per jam">
                    {slots.map((s) => {
                        const tone = s.used === 0 ? "empty" : s.used > s.capacity ? "over" : s.used === s.capacity ? "full" : "part";
                        const nowIn = isToday && env.nowMin >= s.startMin && env.nowMin < s.endMin;
                        return (
                            <div
                                key={s.startMin}
                                role="listitem"
                                className={cx("sd-slot", `sd-slot--${tone}`, nowIn && "is-now")}
                                title={`${formatMinutes(s.startMin)}–${formatMinutes(s.endMin)}: ${s.used} dari ${s.capacity} host${s.sessions.length ? " — " + s.sessions.map((x) => `${x.brandName} (${x.hostName})`).join(", ") : ""}`}
                            >
                                <span className="sd-slot__cap">
                                    {s.used}/{s.capacity}
                                </span>
                                <span className="sd-slot__cells" aria-hidden="true">
                                    {Array.from({ length: Math.max(s.capacity, s.used) }).map((_, i) => (
                                        <i key={i} className={cx(i < s.used && "is-on", i >= s.capacity && "is-over")} />
                                    ))}
                                </span>
                                <span className="sd-slot__time">{formatMinutes(s.startMin)}</span>
                            </div>
                        );
                    })}
                </div>
                <div className="sd-legend">
                    <span><i className="sd-dot sd-dot--empty" /> kosong</span>
                    <span><i className="sd-dot sd-dot--part" /> terisi sebagian</span>
                    <span><i className="sd-dot sd-dot--full" /> penuh</span>
                    <span><i className="sd-dot sd-dot--danger" /> melebihi kapasitas</span>
                </div>
                {overSlots.length > 0 && (
                    <div className="sd-inlinewarn">
                        {Icon.warn(14)} {overSlots.length} slot melebihi kapasitas {effectiveCapacity(studio)} host: {overSlots.map((s) => formatMinutes(s.startMin)).join(", ")}. Kapasitas tidak ditegakkan saat membuat jadwal — cek ulang di board jadwal.
                    </div>
                )}

                <div className="sd-tablewrap sd-tablewrap--inner">
                    <table className="sd-table">
                        <thead>
                            <tr>
                                <th>Jam</th>
                                <th>Brand</th>
                                <th>Host</th>
                                <th>Platform</th>
                                <th>Account</th>
                                <th>Shift</th>
                                <th>ScheduleID</th>
                                <th>Status</th>
                                <th className="sd-right">GMV</th>
                                <th>Report</th>
                            </tr>
                        </thead>
                        <tbody>
                            {env.loading.schedules && sessions.length === 0 ? (
                                <tr>
                                    <td colSpan={10}>
                                        <span className="sd-skel" style={{ width: "60%" }} />
                                    </td>
                                </tr>
                            ) : sessions.length === 0 ? (
                                <tr>
                                    <td colSpan={10}>
                                        <div className="sd-state sd-state--sm">
                                            <div className="sd-state__title">Tidak ada sesi di studio ini pada {formatDateShort(dayKey)}</div>
                                            <div className="sd-state__text">Jadwal dibuat dari board jadwal. Semua slot tersedia hari itu.</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                sessions.map((s) => {
                                    const st = scheduleStatus(s.status);
                                    const g = sessionGmv(env.reports, s, env.todayKey, env.nowMin);
                                    return (
                                        <tr key={s.key} className={cx(!occupiesStudio(s.status) && "is-inactive", running.has(s.key) && "is-live")}>
                                            <td className="sd-mono sd-timecell">
                                                {s.startMin !== null ? formatMinutes(s.startMin) : s.startText || "—"}–{s.endMin !== null ? formatMinutes(s.endMin) : s.endText || "—"}
                                                {running.has(s.key) && (
                                                    <span className="sd-livebadge sd-livebadge--sm">
                                                        <span className="sd-livebadge__dot" /> Live
                                                    </span>
                                                )}
                                            </td>
                                            <td className="sd-strong">{s.brandName || "—"}</td>
                                            <td>{s.hostName || "—"}</td>
                                            <td>{s.platform || "—"}</td>
                                            <td>{s.account || "—"}</td>
                                            <td>{s.shift || "—"}</td>
                                            <td className="sd-mono sd-muted">{s.scheduleId || "—"}</td>
                                            <td>
                                                <Badge tone={st.tone}>{st.label}</Badge>
                                            </td>
                                            <td className="sd-right">
                                                <GmvCell gmv={g.gmv} hasReport={g.reports.length > 0} />
                                            </td>
                                            <td>
                                                <ReportCell state={g.state} />
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                    {sessions.length > 0 && <div className="sd-tablefoot"><span className="sd-end">{sessions.length} sesi · semua sesi hari ini sudah ditampilkan</span></div>}
                </div>
            </Card>

            <MonthSchedule env={env} studio={studio} selectedDay={dayKey} onPickDay={setDayKey} />
        </div>
    );
}
