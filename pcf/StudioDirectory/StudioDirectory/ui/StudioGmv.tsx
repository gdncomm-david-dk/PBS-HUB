import * as React from "react";
import { ScheduleRow, StudioRow } from "../core/types";
import { formatIdr, formatIdrShort, ReportState, sessionGmv, studioGmv } from "../core/gmv";
import { hasColumn, occupiesStudio } from "../core/data";
import { formatDateShort, formatMinutes, formatMonth, HARI, dateKeyToDate, monthDateKeys, monthName, shiftMonth } from "../core/time";
import { Badge, Banner, Card, cx, Tone } from "./components";
import { Env } from "./App";
import { scheduleStatus } from "./shared";

export const REPORT_BADGE: Record<ReportState, { label: string; tone: Tone }> = {
    verified: { label: "Terverifikasi", tone: "success" },
    pending: { label: "Menunggu review", tone: "warning" },
    revision: { label: "Perlu revisi", tone: "danger" },
    missing: { label: "Belum ada report", tone: "danger" },
    notDue: { label: "—", tone: "neutral" },
    liveBreak: { label: "Live Break", tone: "neutral" },
    coHost: { label: "Co-Host", tone: "neutral" },
};

export function ReportCell(props: { state: ReportState }): React.ReactElement {
    const b = REPORT_BADGE[props.state];
    return props.state === "notDue" ? <span className="sd-muted">—</span> : <Badge tone={b.tone}>{b.label}</Badge>;
}

export function GmvCell(props: { gmv: number; hasReport: boolean }): React.ReactElement {
    return props.hasReport ? <span className="sd-gmvnum" title={formatIdr(props.gmv)}>{formatIdr(props.gmv)}</span> : <span className="sd-muted">—</span>;
}

const timeRange = (s: ScheduleRow): string =>
    `${s.startMin !== null ? formatMinutes(s.startMin) : s.startText || "—"}–${s.endMin !== null ? formatMinutes(s.endMin) : s.endText || "—"}`;

/** Ringkasan: how much GMV this studio generated in the selected month. */
export function GmvCard(props: { env: Env; studio: StudioRow }): React.ReactElement {
    const { env, studio } = props;
    const g = studioGmv(env.idx, env.reports, studio, env.monthKey, env.todayKey, env.nowMin);
    const prevKey = shiftMonth(env.monthKey, -1);
    const prev = env.idx.hasMonth(prevKey) ? studioGmv(env.idx, env.reports, studio, prevKey, env.todayKey, env.nowMin) : null;
    const delta = prev && prev.total > 0 ? Math.round(((g.total - prev.total) / prev.total) * 100) : null;
    const seg = (v: number): string => `${g.total > 0 ? (v / g.total) * 100 : 0}%`;
    const topMax = Math.max(1, ...g.byBrand.map((b) => b.gmv));

    return (
        <Card title={`GMV · ${formatMonth(env.monthKey)}`} aside={<span className="sd-muted">dari Penjualan di report host</span>}>
            {env.loading.reports && g.total === 0 ? (
                <span className="sd-skel" style={{ width: 180, height: 22 }} />
            ) : env.reports.size === 0 ? (
                <div className="sd-emptyline">
                    Data report belum terhubung. Ikat dataset <b>reports</b> ke <span className="sd-mono">Report - PBS Hub</span> untuk melihat GMV studio ini.
                </div>
            ) : (
                <>
                    <div className="sd-gmv__top">
                        <div>
                            <div className="sd-gmv__total">{formatIdr(g.total)}</div>
                            <div className="sd-kpi__foot">
                                {g.reportedSessions} dari {g.sessions - g.liveBreaks} sesi sudah ada report
                                {g.liveBreaks > 0 && ` · ${g.liveBreaks} tanpa report (live break / co-host)`}
                                {delta !== null && (
                                    <span className={cx("sd-kpi__delta", delta >= 0 ? "is-up" : "is-down")}>
                                        {" "}· {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% dari {monthName(prevKey)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="sd-gmv__stats">
                            <div>
                                <span>Rata-rata per sesi</span>
                                <b>{g.perSession === null ? "—" : formatIdrShort(g.perSession)}</b>
                            </div>
                            <div>
                                <span>Per jam live</span>
                                <b>{g.perHour === null ? "—" : formatIdrShort(g.perHour)}</b>
                            </div>
                        </div>
                    </div>

                    <div className="sd-stackbar" aria-hidden="true">
                        <span className="is-verified" style={{ width: seg(g.verified) }} />
                        <span className="is-pending" style={{ width: seg(g.pending) }} />
                        <span className="is-revision" style={{ width: seg(g.revision) }} />
                    </div>
                    <div className="sd-legend sd-legend--tight">
                        <span><i className="sd-dot sd-dot--success" /> Terverifikasi {formatIdrShort(g.verified)}</span>
                        <span><i className="sd-dot sd-dot--warning" /> Menunggu review {formatIdrShort(g.pending)}</span>
                        <span><i className="sd-dot sd-dot--danger" /> Perlu revisi {formatIdrShort(g.revision)}</span>
                    </div>

                    {g.missingReports > 0 && (
                        <div className="sd-inlinewarn">
                            ⚠ {g.missingReports} sesi yang sudah selesai belum punya report — GMV-nya belum terhitung.
                        </div>
                    )}

                    {g.byBrand.length > 0 && (
                        <div className="sd-gmv__brands">
                            <div className="sd-gmv__subtitle">GMV per brand</div>
                            {g.byBrand.slice(0, 6).map((b) => (
                                <div key={b.brandId || b.brandName} className="sd-gmv__brand">
                                    <span className="sd-gmv__bname" title={b.brandName}>{b.brandName}</span>
                                    <span className="sd-gmv__btrack">
                                        <span style={{ width: `${(b.gmv / topMax) * 100}%` }} />
                                    </span>
                                    <span className="sd-gmv__bval">{formatIdrShort(b.gmv)}</span>
                                    <span className="sd-muted sd-gmv__bsess">{b.sessions} sesi</span>
                                </div>
                            ))}
                            {g.byBrand.length > 6 && <div className="sd-muted">+{g.byBrand.length - 6} brand lainnya</div>}
                        </div>
                    )}
                    <p className="sd-footnote">
                        GMV = jumlah Penjualan dari report host yang ScheduleID-nya terjadwal di studio ini. Angka “Menunggu review” belum dicocokkan dengan bukti.
                    </p>
                </>
            )}
        </Card>
    );
}

/** Ringkasan: the next few sessions booked at this studio. */
export function UpcomingCard(props: { env: Env; studio: StudioRow; onOpenDay: (d: string) => void }): React.ReactElement {
    const { env, studio } = props;
    const upcoming = env.idx
        .forStudio(studio.studioId)
        .filter((s) => occupiesStudio(s.status))
        .filter((s) => s.dateKey > env.todayKey || (s.dateKey === env.todayKey && (s.endMin ?? 0) > env.nowMin))
        .slice(0, 6);
    return (
        <Card title="Jadwal berikutnya">
            {upcoming.length === 0 ? (
                <div className="sd-emptyline">Belum ada jadwal mendatang di data yang dimuat.</div>
            ) : (
                <ul className="sd-upcoming">
                    {upcoming.map((s) => (
                        <li key={s.key}>
                            <button type="button" onClick={() => props.onOpenDay(s.dateKey)}>
                                <span className="sd-upcoming__date">
                                    {s.dateKey === env.todayKey ? "Hari ini" : formatDateShort(s.dateKey)}
                                    <span className="sd-mono">{timeRange(s)}</span>
                                </span>
                                <span className="sd-upcoming__what">
                                    <b>{s.brandName || "—"}</b>
                                    <span className="sd-muted">
                                        {s.hostName || "—"}
                                        {s.platform ? ` · ${s.platform}` : ""}
                                    </span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

/** Why a live break can still read "Belum ada report": the column that says LiveBreak never reaches the control. */
function LiveBreakHint(props: { env: Env; schedHasLb: boolean; reportsHaveStatus: boolean }): React.ReactElement {
    const src = props.env.sources.schedules;
    const rep = props.env.sources.reports;
    const [open, setOpen] = React.useState(false);
    const where = (x: typeof src, prop: string, json: string): string =>
        x.from === "json" ? `di formula ${json} (ShowColumns)` : `di properti ${prop} → Edit fields`;
    const missing: React.ReactNode[] = [];
    if (!props.schedHasLb) missing.push(<span key="s">kolom <b>LiveBreak</b> di dataset <b>schedules</b> ({where(src, "schedules", "SchedulesJson")})</span>);
    if (!props.reportsHaveStatus) missing.push(<span key="r">kolom <b>ApprovalStatus</b> di dataset <b>reports</b> ({where(rep, "reports", "ReportsJson")})</span>);
    return (
        <Banner
            tone="info"
            action={
                <button type="button" className="sd-link" onClick={() => setOpen((o) => !o)}>
                    {open ? "Tutup detail" : "Lihat kolom"}
                </button>
            }
        >
            <div>
                Sesi <b>Live Break</b> tidak perlu report, tetapi control belum bisa membacanya, jadi live break masih terhitung
                "Belum ada report". Tambahkan{" "}
                {missing.map((m, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && " dan "}
                        {m}
                    </React.Fragment>
                ))}
                .
            </div>
            {open && (
                <div className="sd-diag">
                    <div>
                        <b>schedules</b> ({src.from}): {src.columns.join(", ") || "—"}
                    </div>
                    <div>
                        <b>reports</b> ({rep.from}): {rep.columns.join(", ") || "—"}
                    </div>
                </div>
            )}
        </Banner>
    );
}

type MonthFilter = "all" | "upcoming" | "done" | "missing" | "cancelled";
const PAGE = 25;

/** Jadwal: every session booked at this studio in the selected month, with its GMV and report state. */
export function MonthSchedule(props: { env: Env; studio: StudioRow; selectedDay: string; onPickDay: (d: string) => void }): React.ReactElement {
    const { env, studio } = props;
    const [filter, setFilter] = React.useState<MonthFilter>("all");
    const [shown, setShown] = React.useState(PAGE);
    React.useEffect(() => setShown(PAGE), [filter, env.monthKey, studio.studioId]);

    const all = monthDateKeys(env.monthKey).flatMap((d) => env.idx.day(studio.studioId, d));
    const rows = all
        .map((s) => ({ s, g: sessionGmv(env.reports, s, env.todayKey, env.nowMin) }))
        .filter(({ s, g }) => {
            const occupies = occupiesStudio(s.status);
            const future = s.dateKey > env.todayKey || (s.dateKey === env.todayKey && (s.endMin ?? 0) > env.nowMin);
            if (filter === "upcoming") return occupies && future;
            if (filter === "done") return occupies && !future;
            if (filter === "missing") return g.state === "missing";
            if (filter === "cancelled") return !occupies;
            return true;
        });
    const visible = rows.slice(0, shown);
    const counts = {
        all: all.length,
        upcoming: all.filter((s) => occupiesStudio(s.status) && (s.dateKey > env.todayKey || (s.dateKey === env.todayKey && (s.endMin ?? 0) > env.nowMin))).length,
        missing: all.filter((s) => sessionGmv(env.reports, s, env.todayKey, env.nowMin).state === "missing").length,
        cancelled: all.filter((s) => !occupiesStudio(s.status)).length,
    };
    const schedHasLb = hasColumn(env.sources.schedules.columns, ["LiveBreak", "Live Break", "IsLiveBreak"]);
    const reportsHaveStatus = env.sources.reports.from === "none" || hasColumn(env.sources.reports.columns, ["ApprovalStatus", "Approval Status"]);
    const totalGmv = rows.reduce((t, r) => t + r.g.gmv, 0);
    const brandCount = new Set(all.filter((s) => occupiesStudio(s.status)).map((s) => s.brandId || s.brandName)).size;
    const hostCount = new Set(all.filter((s) => occupiesStudio(s.status)).map((s) => s.hostId || s.hostName)).size;

    const chips: [MonthFilter, string][] = [
        ["all", `Semua ${counts.all}`],
        ["upcoming", `Mendatang ${counts.upcoming}`],
        ["done", "Sudah lewat"],
        ["missing", `Belum ada report ${counts.missing}`],
        ["cancelled", `Batal/cuti ${counts.cancelled}`],
    ];

    return (
        <Card
            title={`Semua jadwal · ${formatMonth(env.monthKey)}`}
            aside={
                <span className="sd-muted">
                    {counts.all} sesi · {brandCount} brand · {hostCount} host
                </span>
            }
        >
            {counts.missing > 0 && (!schedHasLb || !reportsHaveStatus) && <LiveBreakHint env={env} schedHasLb={schedHasLb} reportsHaveStatus={reportsHaveStatus} />}
            <div className="sd-chips sd-chips--left">
                {chips.map(([k, label]) => (
                    <button key={k} type="button" className={cx("sd-chip", filter === k && "is-on")} onClick={() => setFilter(k)} aria-pressed={filter === k}>
                        {label}
                    </button>
                ))}
            </div>
            <div className="sd-tablewrap sd-tablewrap--inner">
                <table className="sd-table">
                    <thead>
                        <tr>
                            <th>Tanggal</th>
                            <th>Jam</th>
                            <th>Brand</th>
                            <th>Host</th>
                            <th>ScheduleID</th>
                            <th>Platform · Account</th>
                            <th>Status</th>
                            <th className="sd-right">GMV</th>
                            <th>Report</th>
                        </tr>
                    </thead>
                    <tbody>
                        {env.loading.schedules && all.length === 0 ? (
                            [0, 1, 2].map((i) => (
                                <tr key={i} className="sd-skel-row">
                                    <td colSpan={9}>
                                        <span className="sd-skel" style={{ width: `${50 + i * 12}%` }} />
                                    </td>
                                </tr>
                            ))
                        ) : visible.length === 0 ? (
                            <tr>
                                <td colSpan={9}>
                                    <div className="sd-state sd-state--sm">
                                        <div className="sd-state__title">
                                            {all.length === 0 ? `Belum ada jadwal di studio ini pada ${formatMonth(env.monthKey)}` : "Tidak ada jadwal untuk filter ini"}
                                        </div>
                                        {all.length > 0 && (
                                            <button type="button" className="sd-link" onClick={() => setFilter("all")}>
                                                Tampilkan semua
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            visible.map(({ s, g }) => {
                                const st = scheduleStatus(s.status);
                                const d = dateKeyToDate(s.dateKey);
                                return (
                                    <tr
                                        key={s.key}
                                        className={cx("sd-row", !occupiesStudio(s.status) && "is-inactive", s.dateKey === props.selectedDay && "is-selected", s.dateKey === env.todayKey && "is-today")}
                                        onClick={() => props.onPickDay(s.dateKey)}
                                        title="Lihat slot kapasitas hari ini"
                                    >
                                        <td className="sd-nowrap">
                                            <b>{formatDateShort(s.dateKey)}</b> <span className="sd-muted">{HARI[d.getDay()].slice(0, 3)}</span>
                                        </td>
                                        <td className="sd-mono sd-nowrap">{timeRange(s)}</td>
                                        <td className="sd-strong">{s.brandName || "—"}</td>
                                        <td>
                                            {s.hostName || "—"}
                                            {s.coHost && <span className="sd-muted"> · Co-Host</span>}
                                        </td>
                                        <td className="sd-mono sd-muted sd-nowrap">{s.scheduleId || "—"}</td>
                                        <td>
                                            {s.platform || "—"}
                                            {s.account && <span className="sd-muted"> · {s.account}</span>}
                                        </td>
                                        <td>
                                            <Badge tone={st.tone}>{st.label}</Badge>
                                        </td>
                                        <td className="sd-right">
                                            <GmvCell gmv={g.gmv} hasReport={g.reports.length > 0 && g.state !== "liveBreak"} />
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
                {rows.length > 0 && (
                    <div className="sd-tablefoot">
                        <span>
                            Menampilkan 1–{visible.length} dari {rows.length} sesi · GMV {formatIdr(totalGmv)}
                            {visible.length >= rows.length && <span className="sd-end"> · semua jadwal bulan ini sudah ditampilkan</span>}
                        </span>
                        {visible.length < rows.length && (
                            <button type="button" className="sd-link" onClick={() => setShown((n) => n + PAGE)}>
                                Tampilkan {Math.min(PAGE, rows.length - visible.length)} lagi
                            </button>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
}
