import * as React from "react";
import { bytesToBase64, uploadName } from "../core/import";
import { Badge, Bar, Button, cx, Icon, Modal } from "./components";
import { Env, UNCONFIRMED } from "./shared";
import { fmtSize } from "./BulkUpload";

interface Item {
    id: string;
    file: File;
    error?: string;
    state: "ready" | "uploading" | "ok" | "unconfirmed" | "error";
    message?: string;
    storedAs?: string;
}

/**
 * AI-assisted schedule: the file goes to the AI folder only. v1 calls no flow here — PBS0002A is expected to
 * trigger on file creation (DESIGN.md UC-2, not exported, so unverified). The control therefore reports
 * "uploaded", never "schedules created".
 */
export function AiUpload(props: { env: Env; onClose: () => void }): React.ReactElement {
    const { env } = props;
    const [items, setItems] = React.useState<Item[]>([]);
    const [note, setNote] = React.useState("");
    const [drag, setDrag] = React.useState(false);
    const [phase, setPhase] = React.useState<"pick" | "uploading" | "done">("pick");
    const [done, setDone] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const exts = env.config.aiAccept
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const maxBytes = env.config.maxUploadMb * 1048576;

    const add = (list: FileList | null): void => {
        if (!list) return;
        const fresh = Array.from(list).map((file, i): Item => {
            const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
            const error = exts.length && !exts.includes(ext) ? `Tipe ${ext} tidak didukung` : file.size > maxBytes ? `Lebih dari ${env.config.maxUploadMb} MB` : file.size === 0 ? "File kosong" : undefined;
            return { id: `${Date.now()}-${i}-${file.name}`, file, error, state: "ready" };
        });
        setItems((xs) => [...xs.filter((x) => !fresh.some((n) => n.file.name === x.file.name)), ...fresh]);
    };

    const ready = items.filter((i) => !i.error);
    const patch = (id: string, p: Partial<Item>): void => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

    const submit = async (): Promise<void> => {
        if (!ready.length) return;
        setPhase("uploading");
        setDone(0);
        const batchId = `AI-${Date.now()}`;
        const at = new Date();
        for (let i = 0; i < ready.length; i++) {
            const it = ready[i];
            patch(it.id, { state: "uploading" });
            const fileName = uploadName(it.file.name, at);
            let r;
            try {
                const bytes = new Uint8Array(await it.file.arrayBuffer());
                r = await env.request(
                    "UPLOAD_SCHEDULE_FILE",
                    {
                        kind: "AI",
                        batchId,
                        index: i + 1,
                        total: ready.length,
                        folder: env.config.aiFolder,
                        fileName,
                        originalName: it.file.name,
                        mimeType: it.file.type || "application/octet-stream",
                        sizeBytes: it.file.size,
                        note: note.trim(),
                        contentBase64: bytesToBase64(bytes),
                    },
                    180000,
                );
            } catch {
                r = { requestId: "", status: "error" as const, message: "File tidak bisa dibaca dari perangkat.", data: {} };
            }
            patch(it.id, { state: r.status === "ok" ? "ok" : r.data.timeout ? "unconfirmed" : "error", storedAs: fileName, message: r.data.timeout ? UNCONFIRMED : r.status === "ok" ? r.message || "Terunggah" : r.message || "Gagal mengunggah" });
            setDone(i + 1);
        }
        setPhase("done");
    };

    const ok = items.filter((i) => i.state === "ok").length;
    const failed = items.filter((i) => i.state === "error" && !i.error).length;
    const unconfirmed = items.filter((i) => i.state === "unconfirmed").length;

    return (
        <Modal
            title="AI Schedule"
            width={680}
            onClose={phase === "uploading" ? () => undefined : props.onClose}
            footer={
                phase === "done" ? (
                    <Button variant="primary" onClick={props.onClose}>
                        Selesai
                    </Button>
                ) : (
                    <>
                        <Button variant="ghost" onClick={props.onClose} disabled={phase === "uploading"}>
                            Batal
                        </Button>
                        <Button variant="primary" icon={Icon.sparkle(14)} disabled={phase !== "pick" || !ready.length} onClick={() => void submit()}>
                            {phase === "uploading" ? "Mengunggah…" : ready.length ? `Kirim ${ready.length} file ke AI` : "Kirim ke AI"}
                        </Button>
                    </>
                )
            }
        >
            <p className="sc-muted">
                Unggah brief atau permintaan jadwal dari brand. File disimpan di folder <b>{env.config.aiFolder}</b>, lalu flow AI Schedule (<b>PBS0002A</b>) membaca file dan membuat jadwal.
                Hasilnya muncul di daftar setelah flow selesai — periksa lagi sebelum sesi berjalan, jadwal dari AI tidak divalidasi di sini.
            </p>

            {phase === "pick" && (
                <>
                    <div
                        className={cx("sc-drop", "sc-drop--ai", drag && "is-drag")}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDrag(true);
                        }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDrag(false);
                            add(e.dataTransfer.files);
                        }}
                    >
                        <span className="sc-drop__icon">{Icon.sparkle(22)}</span>
                        <b>Tarik file ke sini</b>
                        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                            Pilih file
                        </Button>
                        <span className="sc-muted">
                            {exts.join(" ")} · maks {env.config.maxUploadMb} MB per file
                        </span>
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            accept={env.config.aiAccept}
                            hidden
                            onChange={(e) => {
                                add(e.target.files);
                                e.target.value = "";
                            }}
                        />
                    </div>
                    <label className="sc-field">
                        <span className="sc-field__label">Catatan untuk AI (opsional)</span>
                        <textarea className="sc-input" rows={2} value={note} maxLength={500} placeholder="mis. Semua sesi di studio CWG-05, host bergantian tiap 3 jam" onChange={(e) => setNote(e.target.value)} />
                        <span className="sc-field__hint">Dikirim ke canvas bersama file; dipakai bila flow AI membacanya.</span>
                    </label>
                </>
            )}

            {phase !== "pick" && (
                <div className="sc-progress">
                    <div className="sc-progress__head">
                        <b>{phase === "uploading" ? `Mengunggah ${Math.min(done + 1, ready.length)} dari ${ready.length} file…` : failed || unconfirmed ? [`${ok} file terkirim`, unconfirmed && `${unconfirmed} belum dikonfirmasi`, failed && `${failed} gagal`].filter(Boolean).join(", ") : `${ok} file terkirim ke AI Schedule`}</b>
                    </div>
                    <Bar ratio={done / Math.max(1, ready.length)} tone={failed || unconfirmed ? "warning" : "primary"} height={6} />
                    {phase === "done" && ok > 0 && <p className="sc-muted">Flow AI berjalan di latar belakang. Jadwal baru akan terlihat setelah daftar dimuat ulang.</p>}
                </div>
            )}

            {items.length > 0 && (
                <ul className="sc-files">
                    {items.map((it) => (
                        <li key={it.id} className={cx("sc-file", it.error && "is-error")}>
                            <span className="sc-file__icon">{Icon.file(16)}</span>
                            <div className="sc-file__main">
                                <b>{it.file.name}</b>
                                <span className="sc-muted">
                                    {fmtSize(it.file.size)}
                                    {it.storedAs ? ` · disimpan sebagai ${it.storedAs}` : ""}
                                </span>
                                {it.error && <span className="sc-dangertext">{it.error}</span>}
                                {it.message && <span className={it.state === "error" ? "sc-dangertext" : it.state === "unconfirmed" ? "sc-warntext" : "sc-successtext"}>{it.message}</span>}
                            </div>
                            <div className="sc-file__state">
                                {it.state === "uploading" ? (
                                    <span className="sc-muted">Mengunggah…</span>
                                ) : it.state === "ok" ? (
                                    <Badge tone="success">{Icon.check(12)} Terkirim</Badge>
                                ) : it.state === "unconfirmed" ? (
                                    <Badge tone="warning">Belum dikonfirmasi</Badge>
                                ) : it.state === "error" && !it.error ? (
                                    <Badge tone="danger">Gagal</Badge>
                                ) : it.error ? (
                                    <Badge tone="danger">Tidak bisa</Badge>
                                ) : (
                                    <Badge tone="info">Siap</Badge>
                                )}
                                {phase === "pick" && (
                                    <button type="button" className="sc-iconbtn" aria-label={`Hapus ${it.file.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                                        {Icon.close(14)}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}
