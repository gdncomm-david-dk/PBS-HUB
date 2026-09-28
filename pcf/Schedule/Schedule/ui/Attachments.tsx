import * as React from "react";
import { ScheduleRow } from "../core/types";
import { Button, Icon, Modal } from "./components";
import { Env } from "./shared";

/** Links from the Report list's Attachment column, read straight from the `reports` dataset. */
export function AttachmentsDialog(props: { env: Env; schedule: ScheduleRow; onClose: () => void }): React.ReactElement {
    const { env, schedule: s } = props;
    const groups = env.ev.realReportsFor(s).map((r) => ({ source: `Report ${r.reportId}`, files: r.attachments }));
    const total = groups.reduce((n, g) => n + g.files.length, 0);
    return (
        <Modal
            title={`Lampiran report ${s.scheduleId}`}
            width={560}
            onClose={props.onClose}
            footer={
                <Button variant="primary" onClick={props.onClose}>
                    Tutup
                </Button>
            }
        >
            {total === 0 ? (
                <div className="sc-emptyline">
                    Report sesi ini belum punya lampiran.
                    <div className="sc-muted sc-small">
                        Kalau seharusnya ada, pastikan kolom <b>Attachment</b> ikut di dataset <b>reports</b> (Fields → Edit, atau di ShowColumns / reportFiltered).
                    </div>
                </div>
            ) : (
                <div className="sc-attach">
                    {groups
                        .filter((g) => g.files.length > 0)
                        .map((g) => (
                            <section key={g.source} className="sc-kv">
                                <h4>
                                    {g.source} · {g.files.length} file
                                </h4>
                                {g.files.map((f, i) => (
                                    <div key={`${f.url}-${i}`} className="sc-attach__row">
                                        {Icon.file(16)}
                                        <span className="sc-ellipsis" title={f.url}>
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
