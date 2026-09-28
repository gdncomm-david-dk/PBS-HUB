import * as React from "react";
import { ScheduleRow } from "../core/types";
import { Banner, Button, Icon, Modal } from "./components";
import { Env } from "./shared";
import { Group, parseAttachments } from "../core/attachments";

export function AttachmentsDialog(props: { env: Env; schedule: ScheduleRow; onClose: () => void }): React.ReactElement {
    const { env, schedule: s } = props;
    const [state, setState] = React.useState<{ loading: boolean; error: string; groups: Group[] }>({ loading: true, error: "", groups: [] });

    React.useEffect(() => {
        let alive = true;
        const load = async (): Promise<void> => {
            const reports = env.ev.realReportsFor(s);
            const r = await env.request(
                "OPEN_ATTACHMENTS",
                {
                    scheduleId: s.scheduleId,
                    scheduleItemId: s.itemId,
                    reportIds: reports.map((x) => x.reportId),
                    reportItemIds: reports.map((x) => x.itemId).filter((x) => x !== null),
                },
                30000,
            );
            if (!alive) return;
            if (r.status === "ok") setState({ loading: false, error: "", groups: parseAttachments(r.data, s.scheduleId) });
            else
                setState({
                    loading: false,
                    groups: [],
                    error: r.data.timeout ? "Aplikasi belum membalas. Pastikan cabang OPEN_ATTACHMENTS sudah ada di OnChange (SETUP § C4)." : r.message || "Lampiran tidak bisa dimuat.",
                });
        };
        void load();
        return () => {
            alive = false;
        };
    }, [s.key]);

    const total = state.groups.reduce((n, g) => n + g.files.length, 0);
    return (
        <Modal
            title={`Lampiran ${s.scheduleId}`}
            width={560}
            onClose={props.onClose}
            footer={
                <Button variant="primary" onClick={props.onClose}>
                    Tutup
                </Button>
            }
        >
            {state.loading ? (
                <p className="sc-muted">Memuat lampiran dari SharePoint…</p>
            ) : state.error ? (
                <Banner tone="danger">{state.error}</Banner>
            ) : total === 0 ? (
                <p className="sc-emptyline">Belum ada lampiran di jadwal ini maupun di report-nya.</p>
            ) : (
                <div className="sc-attach">
                    {state.groups
                        .filter((g) => g.files.length > 0)
                        .map((g) => (
                            <section key={g.source} className="sc-kv">
                                <h4>
                                    {g.source} · {g.files.length} file
                                </h4>
                                {g.files.map((f, i) => (
                                    <div key={`${f.url}-${i}`} className="sc-attach__row">
                                        {Icon.file(16)}
                                        <span className="sc-ellipsis" title={f.name}>
                                            {f.name || f.url}
                                        </span>
                                        <Button variant="secondary" size="sm" onClick={() => env.openUrl(f.url)}>
                                            Buka
                                        </Button>
                                    </div>
                                ))}
                            </section>
                        ))}
                </div>
            )}
        </Modal>
    );
}
