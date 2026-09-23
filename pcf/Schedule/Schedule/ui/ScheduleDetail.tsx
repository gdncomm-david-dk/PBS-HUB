import * as React from "react";
import { ScheduleRow } from "../core/types";
import { phaseOf, sortSessions, timeRange } from "../core/schedule";
import { buildTimeline, Step, StepId } from "../core/timeline";
import { formatDateLong } from "../core/time";
import { Banner, Button, Card, cx, Icon } from "./components";
import { Env, scheduleStatus, StatusBadge } from "./shared";
import { DeleteDialog } from "./Dialogs";

export function ScheduleDetail(props: { env: Env; schedule: ScheduleRow; onBack: () => void; onEdit: () => void; onDuplicate: () => void }): React.ReactElement {
    const { env, schedule: s } = props;
    const steps = React.useMemo(() => buildTimeline(s, env.ev, env.now), [s, env.ev, env.now]);
    const firstOpen = steps.find((x) => x.state === "active" || x.state === "failed")?.id ?? steps[steps.length - 1].id;
    const [sel, setSel] = React.useState<StepId>(firstOpen);
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const [reminding, setReminding] = React.useState(false);
    React.useEffect(() => setSel(firstOpen), [s.key]);

    const locked = env.ev.isLocked(s);
    const clash = env.conflicts.get(s.key) ?? [];
    const phase = phaseOf(s, env.now);
    const off = scheduleStatus(s.status).chip === "off";
    const step = steps.find((x) => x.id === sel) ?? steps[0];
    const studio = env.lk.studios.get(s.studioId.toLowerCase());

    const sameDay = env.schedules
        .filter((o) => o.key !== s.key && o.dateKey === s.dateKey && (o.hostId.toLowerCase() === s.hostId.toLowerCase() || o.studioId.toLowerCase() === s.studioId.toLowerCase()))
        .sort(sortSessions);

    const remind = async (st: Step): Promise<void> => {
        setReminding(true);
        try {
            const r = await env.request("REMIND_HOST", { scheduleId: s.scheduleId, hostId: s.hostId, hostName: s.hostName, step: st.id, reason: st.todo ?? st.detail });
            env.notify(r.status === "ok" ? "success" : "danger", r.status === "ok" ? r.message || `Pengingat dikirim ke ${s.hostName}.` : r.message || "Gagal mengirim pengingat.");
        } finally {
            setReminding(false);
        }
    };

    return (
        <>
            <button type="button" className="sc-back" onClick={props.onBack}>
                {Icon.left()} Schedule
            </button>

            <Card className="sc-record">
                <div className="sc-record__id sc-mono">{s.scheduleId || "ID belum terisi"}</div>
                <div className="sc-record__cell">
                    <span>Tanggal</span>
                    <b>{formatDateLong(s.dateKey)}</b>
                </div>
                <div className="sc-record__cell">
                    <span>Jam</span>
                    <b className="sc-mono">{timeRange(s)}</b>
                </div>
                <div className="sc-record__cell">
                    <span>Brand</span>
                    <b>{s.brandName}</b>
                </div>
                <div className="sc-record__cell">
                    <span>Host</span>
                    <b>{s.hostName || "—"}</b>
                </div>
                <div className="sc-record__cell">
                    <span>Studio</span>
                    <b>{s.studioId ? `${s.studioId}${studio?.namaStudio ? " · " + studio.namaStudio : ""}` : "—"}</b>
                </div>
                <div className="sc-record__end">
                    {phase === "live" && !off && <span className="sc-livetag sc-livetag--lg">Live sekarang</span>}
                    <StatusBadge status={s.status} />
                    {env.canEdit && (
                        <>
                            <Button variant="ghost" size="sm" icon={Icon.plus(14)} onClick={props.onDuplicate}>
                                Duplikat
                            </Button>
                            <Button variant="secondary" size="sm" icon={Icon.trash(14)} disabled={locked || !s.scheduleId} title={locked ? "Report sudah masuk — jadwal terkunci" : undefined} onClick={() => setConfirmDelete(true)}>
                                Hapus
                            </Button>
                            <Button variant="secondary" size="sm" icon={Icon.edit(14)} disabled={locked || !s.scheduleId} title={locked ? "Report sudah masuk — jadwal terkunci" : undefined} onClick={props.onEdit}>
                                Ubah
                            </Button>
                        </>
                    )}
                </div>
            </Card>

            {locked && (
                <Banner tone="info">
                    {Icon.lock(14)} Report host untuk sesi ini sudah masuk, jadi jadwal terkunci. Mengubah jam atau host sekarang akan membuat report tidak cocok lagi.
                </Banner>
            )}
            {clash.length > 0 && (
                <Banner tone="danger">
                    <b>Jadwal bentrok.</b>
                    <ul className="sc-bullets">
                        {clash.map((c, i) => (
                            <li key={i}>
                                {c.message}
                                {c.others[0] && c.kind !== "studio" && (
                                    <>
                                        {" "}
                                        <button type="button" className="sc-link sc-link--sm" onClick={() => env.open(c.others[0])}>
                                            lihat {c.others[0].scheduleId}
                                        </button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </Banner>
            )}

            <div className="sc-detail">
                <Card className="sc-timeline" title="Rantai bukti sesi">
                    <ol className="sc-steps">
                        {steps.map((x, i) => (
                            <li key={x.id} className={cx("sc-step", `is-${x.state}`, x.id === sel && "is-selected", i < steps.length - 1 && `sc-step--line-${nextLine(x, steps[i + 1])}`)}>
                                <button type="button" onClick={() => setSel(x.id)}>
                                    <span className="sc-step__dot" aria-hidden="true">
                                        {x.state === "done" ? Icon.check(14) : x.state === "failed" ? Icon.close(14) : x.state === "skipped" ? Icon.minus(14) : i + 1}
                                    </span>
                                    <span className="sc-step__body">
                                        <span className="sc-step__label">
                                            {x.label}
                                            {x.when && <span className="sc-step__when">{x.when}</span>}
                                        </span>
                                        <span className="sc-step__detail">{x.detail}</span>
                                        {x.todo && <span className={cx("sc-step__todo", x.state === "failed" && "is-danger")}>{x.todo}</span>}
                                    </span>
                                </button>
                                {x.remind && env.canEdit && x.id === sel && (
                                    <Button variant="ghost" size="sm" icon={Icon.bell(14)} className="sc-step__remind" disabled={reminding} onClick={() => void remind(x)}>
                                        {reminding ? "Mengirim…" : "Ingatkan host"}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ol>
                </Card>

                <div className="sc-stack">
                    <Card title={step.label} aside={<StepBadge step={step} />}>
                        {step.todo && (
                            <div className={cx("sc-todo", step.state === "failed" && "is-danger")}>
                                {step.state === "failed" ? Icon.alert(16) : Icon.info(16)}
                                <span>{step.todo}</span>
                                {step.remind && env.canEdit && (
                                    <Button variant="ghost" size="sm" icon={Icon.bell(14)} disabled={reminding} onClick={() => void remind(step)}>
                                        Ingatkan host
                                    </Button>
                                )}
                            </div>
                        )}
                        {step.record.length === 0 ? (
                            <p className="sc-emptyline">{step.state === "skipped" || step.state === "pending" ? step.detail : "Belum ada record untuk langkah ini."}</p>
                        ) : (
                            step.record.map((sec, i) => (
                                <section key={i} className="sc-kv">
                                    <h4>{sec.section}</h4>
                                    <dl className="sc-dl">
                                        {sec.rows.map(([k, v]) => (
                                            <React.Fragment key={k}>
                                                <dt>{k}</dt>
                                                <dd>{v}</dd>
                                            </React.Fragment>
                                        ))}
                                    </dl>
                                </section>
                            ))
                        )}
                    </Card>

                    <Card title={`Sesi lain ${formatDateLong(s.dateKey)}`} aside={<span className="sc-muted">host {s.hostName} atau studio {s.studioId}</span>}>
                        {sameDay.length === 0 ? (
                            <p className="sc-emptyline">Tidak ada sesi lain untuk host atau studio ini di hari yang sama.</p>
                        ) : (
                            <table className="sc-table sc-table--flat">
                                <tbody>
                                    {sameDay.map((o) => (
                                        <tr key={o.key} className="sc-row" onClick={() => env.open(o)}>
                                            <td className="sc-mono sc-nowrap">{timeRange(o)}</td>
                                            <td>
                                                <b>{o.brandName}</b>
                                                <div className="sc-muted sc-mono">{o.scheduleId}</div>
                                            </td>
                                            <td>{o.hostName}</td>
                                            <td>{o.studioId}</td>
                                            <td>
                                                <StatusBadge status={o.status} />
                                                {env.conflicts.has(o.key) && <i className="sc-conflictdot" />}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>
                </div>
            </div>
            {confirmDelete && <DeleteDialog env={env} schedule={s} onClose={() => setConfirmDelete(false)} onDeleted={() => { setConfirmDelete(false); props.onBack(); }} />}
        </>
    );
}

function nextLine(a: Step, b: Step): string {
    if (a.state === "done" && b.state === "done") return "done";
    if (b.state === "active") return "active";
    return "pending";
}

function StepBadge(props: { step: Step }): React.ReactElement {
    const map: Record<Step["state"], [string, string]> = {
        done: ["Selesai", "success"],
        active: ["Perlu tindakan", "info"],
        pending: ["Belum", "neutral"],
        failed: ["Bermasalah", "danger"],
        skipped: ["Tidak berlaku", "neutral"],
    };
    const [l, t] = map[props.step.state];
    return <span className={`sc-badge sc-badge--${t}`}>{l}</span>;
}
