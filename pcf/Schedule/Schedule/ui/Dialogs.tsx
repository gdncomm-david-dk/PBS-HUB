import * as React from "react";
import { ScheduleRow } from "../core/types";
import { timeRange } from "../core/schedule";
import { formatDateLong } from "../core/time";
import { Banner, Button, Modal } from "./components";
import { Env } from "./shared";

export function DeleteDialog(props: { env: Env; schedule: ScheduleRow; onClose: () => void; onDeleted: () => void }): React.ReactElement {
    const { env, schedule: s } = props;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const locked = env.ev.isLocked(s);
    const go = async (): Promise<void> => {
        setBusy(true);
        setError("");
        try {
            const r = await env.request("DELETE_SCHEDULE", { scheduleId: s.scheduleId, itemId: s.itemId });
            if (r.status === "ok") {
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
                    <Button variant="primary" className="sc-btn--danger" disabled={busy || locked || !s.scheduleId} onClick={() => void go()}>
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
            {locked ? (
                <Banner tone="warning">Report untuk sesi ini sudah masuk. Jadwal tidak bisa dihapus — batalkan lewat status jika perlu.</Banner>
            ) : (
                <p className="sc-muted">Jadwal dihapus dari Schedule - PBS Hub. Host tidak lagi melihatnya di aplikasi host.</p>
            )}
            {error && <Banner tone="danger">{error}</Banner>}
        </Modal>
    );
}
