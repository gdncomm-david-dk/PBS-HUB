import * as React from "react";
import { ReportRow, ScheduleRow } from "../core/types";
import { approvalKind } from "../core/data";
import { compareReport } from "../core/review";
import { Badge, Button, Card, cx, Icon, Tone } from "./components";
import { Env } from "./shared";

const APPROVAL_TONE: Record<ReturnType<typeof approvalKind>, Tone> = {
    done: "success",
    livebreak: "neutral",
    revision: "danger",
    waitingRevision: "info",
    waiting: "warning",
};

export function ReportReview(props: { env: Env; schedule: ScheduleRow }): React.ReactElement | null {
    const { env, schedule: s } = props;
    const reports = env.ev.realReportsFor(s);
    if (reports.length === 0) return null;
    return (
        <Card title="Report host vs AI" aside={<span className="sc-muted">Report ↔ Report Automation (Title sama)</span>}>
            <div className="sc-review">
                {reports.map((r) => (
                    <OneReport key={r.key} env={env} schedule={s} report={r} />
                ))}
            </div>
        </Card>
    );
}

function OneReport(props: { env: Env; schedule: ScheduleRow; report: ReportRow }): React.ReactElement {
    const { env, schedule: s, report: r } = props;
    const evs = env.ev.evidenceForReport(r);
    const e = evs[0] ?? null;
    const lines = compareReport(r, e, s);
    const diffs = lines.filter((l) => l.same === false);
    const aiUnmatch = !!e && /unmatch/i.test(e.status);
    const kind = approvalKind(r.approvalStatus);
    const [comment, setComment] = React.useState("");
    const [busy, setBusy] = React.useState<"" | "approve" | "revision">("");
    const inputId = `sc-review-${r.key}`;

    const submit = async (decision: "approve" | "revision"): Promise<void> => {
        setBusy(decision);
        try {
            const res = await env.request("REVIEW_REPORT", {
                decision,
                reportId: r.reportId,
                reportItemId: r.itemId,
                scheduleId: s.scheduleId,
                comment: comment.trim(),
                automationTitle: r.reportId,
                automationItemIds: evs.map((x) => x.itemId).filter((x) => x !== null),
                mismatches: diffs.map((l) => `${l.label}: host ${l.host}, AI ${l.ai}`),
            });
            if (res.status === "ok") {
                env.notify("success", res.message || (decision === "approve" ? `${r.reportId} disetujui.` : `${r.reportId} dikembalikan ke host untuk revisi.`));
                setComment("");
            } else env.notify("danger", res.message || "Keputusan belum tersimpan.");
        } finally {
            setBusy("");
        }
    };

    return (
        <section className="sc-review__item">
            <header className="sc-review__head">
                <b className="sc-mono">{r.reportId || "Report"}</b>
                <span className="sc-muted">
                    {[r.accountId, r.platform].filter(Boolean).join(" · ")}
                </span>
                <span className="sc-review__badges">
                    <Badge tone={APPROVAL_TONE[kind]}>{r.approvalStatus || "Waiting Approval"}</Badge>
                    {r.match && <Badge tone={/unmatch/i.test(r.match) ? "danger" : "success"}>{r.match}</Badge>}
                </span>
            </header>

            {!e ? (
                <p className="sc-emptyline">
                    Belum ada hasil AI dengan Title <span className="sc-mono">{r.reportId}</span> di Report Automation. Perbandingan muncul setelah OCR selesai.
                </p>
            ) : (
                <div className="sc-tablewrap">
                    <table className="sc-table sc-table--flat sc-vs">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Report host</th>
                                <th>AI (Report Automation)</th>
                                <th>Hasil</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((l) => (
                                <tr key={l.label} className={cx(l.same === false && "is-diff")}>
                                    <th scope="row">{l.label}</th>
                                    <td className="sc-num">{l.host}</td>
                                    <td className="sc-num">{l.ai}</td>
                                    <td>
                                        {l.same === null ? (
                                            <span className="sc-muted">—</span>
                                        ) : l.same ? (
                                            <Badge tone="success">Sesuai</Badge>
                                        ) : (
                                            <Badge tone="danger">Beda{l.diff ? ` ${l.diff}` : ""}</Badge>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            <tr>
                                <th scope="row">Status AI</th>
                                <td className="sc-muted">—</td>
                                <td>{e.status || "—"}</td>
                                <td>{e.status ? <Badge tone={aiUnmatch ? "danger" : "success"}>{aiUnmatch ? "Unmatch" : "Match"}</Badge> : <span className="sc-muted">—</span>}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
            {evs.length > 1 && <p className="sc-muted sc-small">{evs.length} baris Report Automation dengan Title ini; yang dibandingkan baris pertama.</p>}

            <div className={cx("sc-verdictline", diffs.length > 0 || aiUnmatch ? "is-danger" : e ? "is-ok" : "")}>
                {diffs.length > 0 || aiUnmatch ? Icon.alert(16) : Icon.info(16)}
                <span>
                    {!e
                        ? "Belum bisa dibandingkan."
                        : diffs.length > 0
                          ? `Tidak sesuai: ${diffs.map((l) => l.label).join(", ")}.`
                          : aiUnmatch
                            ? "Angka sama, tetapi AI menandai Unmatch."
                            : "Semua angka yang terbaca sesuai."}
                </span>
            </div>

            {(r.approvalComment || r.approverEmail) && (
                <dl className="sc-dl sc-review__prev">
                    {r.approvalComment && (
                        <>
                            <dt>Komentar</dt>
                            <dd>{r.approvalComment}</dd>
                        </>
                    )}
                    {r.approverEmail && (
                        <>
                            <dt>Approver</dt>
                            <dd>{r.approverEmail}</dd>
                        </>
                    )}
                </dl>
            )}

            {env.canEdit && (
                <div className="sc-judge">
                    <label className="sc-field" htmlFor={inputId}>
                        <span className="sc-field__label">Komentar untuk host</span>
                        <textarea
                            id={inputId}
                            className="sc-input"
                            rows={2}
                            value={comment}
                            placeholder={diffs.length ? `Contoh: ${diffs[0].label} di report ${diffs[0].host}, di screenshot ${diffs[0].ai}. Mohon dicek ulang.` : "Wajib diisi saat meminta revisi"}
                            onChange={(ev) => setComment(ev.target.value)}
                            disabled={!!busy}
                        />
                    </label>
                    <div className="sc-judge__actions">
                        <Button variant="secondary" size="sm" icon={Icon.close(14)} disabled={!!busy || !comment.trim()} title={!comment.trim() ? "Isi komentar dulu" : undefined} onClick={() => void submit("revision")}>
                            {busy === "revision" ? "Menyimpan…" : "Tidak sesuai — minta revisi"}
                        </Button>
                        <Button variant="primary" size="sm" icon={Icon.check(14)} disabled={!!busy || kind === "done"} onClick={() => void submit("approve")}>
                            {busy === "approve" ? "Menyimpan…" : kind === "done" ? "Sudah disetujui" : "Sesuai — setujui"}
                        </Button>
                    </div>
                    <p className="sc-muted sc-small">
                        Minta revisi: Report jadi <b>Need Revision</b>, Match jadi <b>Unmatch</b>, komentar dan email kamu disimpan, dan Status di Report Automation jadi <b>Unmatch</b>. Setelah host submit ulang, status menjadi <b>Waiting Approval Revision</b>.
                    </p>
                </div>
            )}
        </section>
    );
}
