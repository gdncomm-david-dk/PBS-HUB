import * as React from "react";
import { ScheduleRow } from "../core/types";
import { timeRange } from "../core/schedule";
import { formatDateLong, formatDateShort, shiftDay } from "../core/time";
import { Banner, Button, cx, Modal, Pager, usePaged } from "./components";
import { Env } from "./shared";

export function DeleteDialog(props: { env: Env; schedule: ScheduleRow; onClose: () => void; onDeleted: () => void }): React.ReactElement {
    const { env, schedule: s } = props;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const reports = env.ev.realReportsFor(s);
    const go = async (): Promise<void> => {
        setBusy(true);
        setError("");
        try {
            const r = await env.request("DELETE_SCHEDULE", { scheduleId: s.scheduleId, itemId: s.itemId });
            if (r.status === "ok") {
                env.hide([s]);
                env.notify("success", `Jadwal ${s.scheduleId} dihapus.`);
                props.onDeleted();
            } else setError(r.message || "Gagal menghapus jadwal.");
        } finally {
            setBusy(false);
        }
    };
    return (
        <Modal
            title="Hapus jadwal?"
            width={480}
            onClose={busy ? () => undefined : props.onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={props.onClose} disabled={busy}>
                        Batal
                    </Button>
                    <Button variant="primary" className="sc-btn--danger" disabled={busy || !s.scheduleId} onClick={() => void go()}>
                        {busy ? "Menghapus…" : "Hapus jadwal"}
                    </Button>
                </>
            }
        >
            <p>
                <b>{s.scheduleId}</b> · {s.brandName} · {s.hostName}
                <br />
                <span className="sc-muted">
                    {formatDateLong(s.dateKey)} · {timeRange(s)} · {s.studioId}
                </span>
            </p>
            <p className="sc-muted">Jadwal dihapus dari Schedule - PBS Hub. Host tidak lagi melihatnya di aplikasi host.</p>
            {reports.length > 0 && (
                <Banner tone="warning">
                    Report host untuk jadwal ini sudah masuk ({reports.map((r) => r.reportId).join(", ")}). Report-nya tidak ikut terhapus, tapi tidak punya jadwal lagi.
                </Banner>
            )}
            {reports.length === 0 && env.ev.isLiveBreak(s) && <Banner tone="info">Sesi Live Break. Baris LiveBreak di list Report tidak ikut terhapus.</Banner>}
            {error && <Banner tone="danger">{error}</Banner>}
        </Modal>
    );
}

// ---------------------------------------------------------------------------------------------
// Bulk actions from the List view

/** CREATE_SCHEDULE fields for a copy of `s` on `dateKey`; status always starts at Planned. */
export function copyPayload(s: ScheduleRow, dateKey: string): Record<string, unknown> {
    return {
        sourceScheduleId: s.scheduleId,
        date: dateKey,
        brandId: s.brandId,
        accountId: s.accountId,
        studioId: s.studioId,
        hostId: s.hostId,
        platform: s.platform,
        startTime: s.startText,
        endTime: s.endText,
        jamLive: s.jamLive,
        position: s.position || "Main Host",
        totalAccount: s.totalAccount ?? (s.accountId ? 1 : 0),
        status: "Planned",
    };
}

export function BulkDuplicateDialog(props: { env: Env; rows: ScheduleRow[]; onClose: () => void; onDone: () => void }): React.ReactElement {
    const { env, rows } = props;
    const [mode, setMode] = React.useState<"shift" | "date">("shift");
    const [days, setDays] = React.useState(7);
    const [date, setDate] = React.useState(shiftDay(env.todayKey, 1));
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const target = (s: ScheduleRow): string => (mode === "shift" ? shiftDay(s.dateKey, days) : date);
    const past = rows.filter((s) => target(s) < env.todayKey).length;
    const pg = usePaged(rows, `${mode}|${days}|${date}`);
    const valid = mode === "shift" ? Number.isFinite(days) && days !== 0 : !!date;

    const go = async (): Promise<void> => {
        setBusy(true);
        setError("");
        try {
            const r = await env.request("BULK_CREATE_SCHEDULE", { items: rows.map((s) => copyPayload(s, target(s))), count: rows.length }, 60000 + rows.length * 2000);
            if (r.status === "ok") {
                const n = typeof r.data.created === "number" ? r.data.created : rows.length;
                env.notify("success", r.message || `${n} jadwal berhasil diduplikat.`);
                props.onDone();
            } else setError(r.message || "Gagal menduplikat jadwal.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`Duplikat ${rows.length} jadwal`}
            width={640}
            onClose={busy ? () => undefined : props.onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={props.onClose} disabled={busy}>
                        Batal
                    </Button>
                    <Button variant="primary" disabled={busy || !valid || rows.length === 0} onClick={() => void go()}>
                        {busy ? "Menduplikat…" : `Duplikat ${rows.length} jadwal`}
                    </Button>
                </>
            }
        >
            <div className="sc-chips">
                <button type="button" className={cx("sc-chip", mode === "shift" && "is-on")} onClick={() => setMode("shift")}>
                    Geser tanggal
                </button>
                <button type="button" className={cx("sc-chip", mode === "date" && "is-on")} onClick={() => setMode("date")}>
                    Pindah ke satu tanggal
                </button>
            </div>
            {mode === "shift" ? (
                <label className="sc-field">
                    <span className="sc-field__label">Geser berapa hari</span>
                    <input className="sc-input" type="number" value={days} onChange={(e) => setDays(Math.trunc(Number(e.target.value)))} />
                    <span className="sc-muted sc-small">7 = minggu depan di hari yang sama. Angka minus untuk mundur.</span>
                </label>
            ) : (
                <label className="sc-field">
                    <span className="sc-field__label">Tanggal baru untuk semua jadwal</span>
                    <input className="sc-input sc-input--date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
            )}
            <p className="sc-muted sc-small">Jam, brand, account, host, studio, platform dan posisi ikut disalin. Status jadwal baru: Planned.</p>
            {past > 0 && <Banner tone="warning">{past} jadwal baru jatuh di tanggal yang sudah lewat.</Banner>}
            <div className="sc-tablewrap">
                <table className="sc-table sc-table--flat">
                    <thead>
                        <tr>
                            <th>Jadwal asal</th>
                            <th>Brand · Host</th>
                            <th>Jam</th>
                            <th>Tanggal baru</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pg.rows.map((s) => (
                            <tr key={s.key}>
                                <td className="sc-nowrap">
                                    <span className="sc-mono">{s.scheduleId}</span>
                                    <div className="sc-muted">{formatDateShort(s.dateKey)}</div>
                                </td>
                                <td>
                                    <b>{s.brandName}</b>
                                    <div className="sc-muted">{s.hostName}</div>
                                </td>
                                <td className="sc-mono sc-nowrap">{timeRange(s)}</td>
                                <td className={cx("sc-nowrap", target(s) < env.todayKey && "sc-warntext")}>{valid ? formatDateShort(target(s)) : "—"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <Pager {...pg} onPage={pg.setPage} unit="jadwal" />
            </div>
            {error && <Banner tone="danger">{error}</Banner>}
        </Modal>
    );
}

export function BulkDeleteDialog(props: { env: Env; rows: ScheduleRow[]; onClose: () => void; onDone: () => void }): React.ReactElement {
    const { env } = props;
    const locked = props.rows.filter((s) => !s.scheduleId);
    const rows = props.rows.filter((s) => !locked.includes(s));
    const withReport = rows.filter((s) => env.ev.realReportsFor(s).length > 0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const pg = usePaged(rows);

    const go = async (): Promise<void> => {
        setBusy(true);
        setError("");
        try {
            const r = await env.request("BULK_DELETE_SCHEDULE", { scheduleIds: rows.map((s) => s.scheduleId), itemIds: rows.map((s) => s.itemId), count: rows.length }, 60000 + rows.length * 1000);
            if (r.status === "ok") {
                env.hide(rows);
                env.notify("success", r.message || `${rows.length} jadwal dihapus.`);
                props.onDone();
            } else setError(r.message || "Gagal menghapus jadwal.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`Hapus ${rows.length} jadwal?`}
            width={600}
            onClose={busy ? () => undefined : props.onClose}
            footer={
                <>
                    <Button variant="ghost" onClick={props.onClose} disabled={busy}>
                        Batal
                    </Button>
                    <Button variant="primary" className="sc-btn--danger" disabled={busy || rows.length === 0} onClick={() => void go()}>
                        {busy ? "Menghapus…" : `Hapus ${rows.length} jadwal`}
                    </Button>
                </>
            }
        >
            {locked.length > 0 && (
                <Banner tone="warning">
                    {locked.length} jadwal dilewati karena ID-nya belum terisi.
                </Banner>
            )}
            {withReport.length > 0 && (
                <Banner tone="warning">
                    {withReport.length} jadwal sudah punya report host: {withReport.slice(0, 5).map((s) => s.scheduleId).join(", ")}
                    {withReport.length > 5 ? ", …" : ""}. Report-nya tidak ikut terhapus, tapi tidak punya jadwal lagi.
                </Banner>
            )}
            {rows.length > 0 ? (
                <div className="sc-tablewrap">
                    <table className="sc-table sc-table--flat">
                        <tbody>
                            {pg.rows.map((s) => (
                                <tr key={s.key}>
                                    <td className="sc-mono sc-nowrap">{s.scheduleId}</td>
                                    <td className="sc-nowrap">{formatDateShort(s.dateKey)}</td>
                                    <td className="sc-mono sc-nowrap">{timeRange(s)}</td>
                                    <td>
                                        <b>{s.brandName}</b> · {s.hostName}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <Pager {...pg} onPage={pg.setPage} unit="jadwal" />
                </div>
            ) : (
                <p className="sc-muted">Tidak ada jadwal yang bisa dihapus dari pilihan ini.</p>
            )}
            <p className="sc-muted">Jadwal dihapus dari Schedule - PBS Hub dan tidak bisa dikembalikan.</p>
            {error && <Banner tone="danger">{error}</Banner>}
        </Modal>
    );
}
