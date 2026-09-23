import * as React from "react";
import { readWorkbook } from "../core/xlsx";
import { bytesToBase64, checkFile, errorCsv, FIELD_LABEL, FileCheck, ImportRow, timeText, uploadName } from "../core/import";
import { formatDateShort } from "../core/time";
import { Badge, Banner, Bar, Button, cx, Icon, Modal } from "./components";
import { Env } from "./shared";

interface Item {
    id: string;
    name: string;
    size: number;
    type: string;
    bytes?: Uint8Array;
    check?: FileCheck;
    error?: string;
    ackWarnings: boolean;
    ackUnchecked: boolean;
    state: "reading" | "ready" | "uploading" | "ok" | "error" | "skipped";
    message?: string;
    storedAs?: string;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const fmtSize = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function downloadText(name: string, text: string, mime: string): void {
    try {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
        // Download blocked by the host; the list stays visible in the dialog.
    }
}

/** Why a file cannot be uploaded yet, or "" when it can. */
function blocker(it: Item): string {
    if (it.state === "reading") return "Sedang dibaca";
    if (it.error) return it.error;
    const c = it.check;
    if (!c) return "Belum dibaca";
    if (c.counts.total === 0) return "Tidak ada baris data";
    if (c.missing.length && !it.ackUnchecked) return "Kolom wajib tidak dikenali";
    if (c.counts.rejected > 0) return `${c.counts.rejected} baris ditolak — perbaiki di file lalu pilih ulang`;
    if (c.counts.warning > 0 && !it.ackWarnings) return "Peringatan belum dicentang";
    return "";
}

export function BulkUpload(props: { env: Env; onClose: () => void }): React.ReactElement {
    const { env } = props;
    const [items, setItems] = React.useState<Item[]>([]);
    const [drag, setDrag] = React.useState(false);
    const [phase, setPhase] = React.useState<"pick" | "uploading" | "done">("pick");
    const [progress, setProgress] = React.useState({ done: 0, total: 0 });
    const [show, setShow] = React.useState<"all" | "rejected" | "warning">("all");
    const [limit, setLimit] = React.useState(100);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const maxBytes = env.config.maxUploadMb * 1048576;

    const patch = (id: string, p: Partial<Item>): void => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

    const add = (list: FileList | null): void => {
        if (!list) return;
        const files = Array.from(list);
        const fresh: Item[] = files.map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, type: f.type, ackWarnings: false, ackUnchecked: false, state: "reading" }));
        setItems((xs) => [...xs.filter((x) => !fresh.some((n) => n.name === x.name)), ...fresh]);
        fresh.forEach((it, i) => {
            const f = files[i];
            if (!/\.xlsx$/i.test(f.name)) {
                patch(it.id, { state: "ready", error: "Bukan file .xlsx" });
                return;
            }
            if (f.size > maxBytes) {
                patch(it.id, { state: "ready", error: `Lebih dari ${env.config.maxUploadMb} MB` });
                return;
            }
            void (async () => {
                try {
                    const bytes = new Uint8Array(await f.arrayBuffer());
                    const table = readWorkbook(bytes, env.config.bulkTable);
                    const check = checkFile(f.name, table, { lk: env.lk, existing: env.schedules, todayKey: env.todayKey, studioName: env.studioName });
                    patch(it.id, { bytes, check, state: "ready" });
                } catch (e) {
                    patch(it.id, { state: "ready", error: e instanceof Error ? e.message : "File tidak bisa dibaca" });
                }
            })();
        });
    };

    const checks = items.map((i) => i.check).filter((c): c is FileCheck => !!c);
    const totals = checks.reduce((t, c) => ({ total: t.total + c.counts.total, valid: t.valid + c.counts.valid, warning: t.warning + c.counts.warning, rejected: t.rejected + c.counts.rejected }), { total: 0, valid: 0, warning: 0, rejected: 0 });
    const eligible = items.filter((i) => !blocker(i));
    const eligibleRows = eligible.reduce((t, i) => t + (i.check?.counts.total ?? 0), 0);
    const reading = items.some((i) => i.state === "reading");
    const hasProblems = totals.rejected + totals.warning > 0 || checks.some((c) => c.missing.length);

    const allRows: ImportRow[] = checks.flatMap((c) => c.rows).filter((r) => show === "all" || r.verdict === show);

    const submit = async (): Promise<void> => {
        const queue = eligible;
        if (!queue.length) return;
        setPhase("uploading");
        setProgress({ done: 0, total: queue.length });
        const batchId = `BULK-${Date.now()}`;
        const at = new Date();
        for (const it of items) if (!queue.includes(it)) patch(it.id, { state: "skipped" });
        for (let i = 0; i < queue.length; i++) {
            const it = queue[i];
            patch(it.id, { state: "uploading" });
            const fileName = uploadName(it.name, at);
            const r = await env.request(
                "UPLOAD_SCHEDULE_FILE",
                {
                    kind: "BULK",
                    batchId,
                    index: i + 1,
                    total: queue.length,
                    folder: env.config.bulkFolder,
                    fileName,
                    originalName: it.name,
                    table: it.check?.source ?? env.config.bulkTable,
                    mimeType: it.type || XLSX_MIME,
                    sizeBytes: it.size,
                    rowCount: it.check?.counts.total ?? 0,
                    contentBase64: bytesToBase64(it.bytes ?? new Uint8Array()),
                },
                180000,
            );
            const created = typeof r.data.created === "number" ? r.data.created : null;
            patch(it.id, {
                state: r.status === "ok" ? "ok" : "error",
                storedAs: fileName,
                message: r.status === "ok" ? (created !== null ? `${created} jadwal dibuat` : r.message || "Terunggah, flow berjalan") : r.message || "Gagal mengunggah",
            });
            setProgress({ done: i + 1, total: queue.length });
        }
        setPhase("done");
    };

    const okCount = items.filter((i) => i.state === "ok").length;
    const failCount = items.filter((i) => i.state === "error").length;

    const footer =
        phase === "done" ? (
            <>
                {hasProblems && (
                    <button type="button" className="sc-link" onClick={() => downloadText("daftar-error-schedule.csv", errorCsv(checks), "text/csv")}>
                        {Icon.download(14)} Unduh daftar error
                    </button>
                )}
                <Button variant="primary" onClick={props.onClose}>
                    Selesai
                </Button>
            </>
        ) : (
            <>
                {hasProblems && phase === "pick" && (
                    <button type="button" className="sc-link sc-foot-left" onClick={() => downloadText("daftar-error-schedule.csv", errorCsv(checks), "text/csv")}>
                        {Icon.download(14)} Unduh daftar error
                    </button>
                )}
                {phase === "pick" && items.length > 0 && !eligible.length && !reading && <span className="sc-foot-note">Belum ada file yang siap diunggah</span>}
                <Button variant="ghost" onClick={props.onClose} disabled={phase === "uploading"}>
                    Batal
                </Button>
                <Button variant="primary" icon={Icon.upload(14)} disabled={phase !== "pick" || reading || !eligible.length} onClick={() => void submit()}>
                    {phase === "uploading" ? "Mengunggah…" : eligible.length ? `Unggah ${eligible.length} file · ${eligibleRows} baris` : "Unggah"}
                </Button>
            </>
        );

    return (
        <Modal title="Upload massal jadwal" width={1000} onClose={phase === "uploading" ? () => undefined : props.onClose} footer={footer}>
            <p className="sc-muted">
                File Excel diunggah ke folder <b>{env.config.bulkFolder}</b> lalu flow <b>PBS0001A</b> membuat satu jadwal per baris di tabel <b>{env.config.bulkTable}</b>. Setiap file diproses sendiri-sendiri.
                {env.config.templateUrl && (
                    <>
                        {" "}
                        <a className="sc-link sc-link--sm" href={env.config.templateUrl} target="_blank" rel="noreferrer">
                            Unduh template
                        </a>
                    </>
                )}
            </p>

            {phase === "pick" && (
                <div
                    className={cx("sc-drop", drag && "is-drag")}
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
                    <span className="sc-drop__icon">{Icon.upload(22)}</span>
                    <b>Tarik file .xlsx ke sini</b>
                    <span className="sc-muted">atau</span>
                    <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                        Pilih file
                    </Button>
                    <span className="sc-muted">Bisa lebih dari satu file · maks {env.config.maxUploadMb} MB per file</span>
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".xlsx"
                        multiple
                        hidden
                        onChange={(e) => {
                            add(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>
            )}

            {phase !== "pick" && (
                <div className="sc-progress">
                    <div className="sc-progress__head">
                        <b>{phase === "uploading" ? `Mengunggah ${Math.min(progress.done + 1, progress.total)} dari ${progress.total} file…` : failCount ? `${okCount} file berhasil, ${failCount} gagal` : `${okCount} file berhasil diunggah`}</b>
                        <span className="sc-muted">{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span>
                    </div>
                    <Bar ratio={progress.done / Math.max(1, progress.total)} tone={failCount ? "warning" : "primary"} height={6} />
                    {phase === "done" && <p className="sc-muted">Jadwal baru muncul setelah flow selesai — biasanya beberapa detik per file. Muat ulang daftar bila belum terlihat.</p>}
                </div>
            )}

            {items.length > 0 && (
                <ul className="sc-files">
                    {items.map((it) => {
                        const why = blocker(it);
                        const c = it.check;
                        return (
                            <li key={it.id} className={cx("sc-file", it.error && "is-error")}>
                                <span className="sc-file__icon">{Icon.file(16)}</span>
                                <div className="sc-file__main">
                                    <b>{it.name}</b>
                                    <span className="sc-muted">
                                        {fmtSize(it.size)}
                                        {c ? ` · ${c.source} · ${c.counts.total} baris` : ""}
                                        {it.storedAs ? ` · disimpan sebagai ${it.storedAs}` : ""}
                                    </span>
                                    {c && c.missing.length > 0 && (
                                        <span className="sc-dangertext">
                                            Kolom tidak dikenali: {c.missing.map((f) => FIELD_LABEL[f]).join(", ")}. Header di file: <span className="sc-mono">{c.headers.join(", ") || "—"}</span>
                                        </span>
                                    )}
                                    {phase === "pick" && c && c.missing.length > 0 && (
                                        <label className="sc-check">
                                            <input type="checkbox" checked={it.ackUnchecked} onChange={(e) => patch(it.id, { ackUnchecked: e.target.checked })} />
                                            File ini sesuai template PBS0001A — unggah tanpa validasi kolom tersebut
                                        </label>
                                    )}
                                    {phase === "pick" && c && c.counts.warning > 0 && c.counts.rejected === 0 && (
                                        <label className="sc-check">
                                            <input type="checkbox" checked={it.ackWarnings} onChange={(e) => patch(it.id, { ackWarnings: e.target.checked })} />
                                            Tetap unggah dengan {c.counts.warning} peringatan
                                        </label>
                                    )}
                                    {it.message && <span className={it.state === "error" ? "sc-dangertext" : "sc-successtext"}>{it.message}</span>}
                                </div>
                                <div className="sc-file__counts">
                                    {c && (
                                        <>
                                            <Badge tone="success">{c.counts.valid} valid</Badge>
                                            {c.counts.warning > 0 && <Badge tone="warning">{c.counts.warning} peringatan</Badge>}
                                            {c.counts.rejected > 0 && <Badge tone="danger">{c.counts.rejected} ditolak</Badge>}
                                        </>
                                    )}
                                </div>
                                <div className="sc-file__state">
                                    {it.state === "reading" ? (
                                        <span className="sc-muted">Membaca…</span>
                                    ) : it.state === "uploading" ? (
                                        <span className="sc-muted">Mengunggah…</span>
                                    ) : it.state === "ok" ? (
                                        <Badge tone="success">{Icon.check(12)} Terunggah</Badge>
                                    ) : it.state === "error" ? (
                                        <Badge tone="danger">Gagal</Badge>
                                    ) : it.state === "skipped" ? (
                                        <Badge tone="neutral">Tidak diunggah</Badge>
                                    ) : why ? (
                                        <span className="sc-warntext sc-file__why">{why}</span>
                                    ) : (
                                        <Badge tone="info">Siap</Badge>
                                    )}
                                    {phase === "pick" && (
                                        <button type="button" className="sc-iconbtn" aria-label={`Hapus ${it.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                                            {Icon.close(14)}
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {checks.length > 0 && phase === "pick" && (
                <>
                    <div className="sc-summary">
                        <b>{totals.total} baris</b>
                        <span className="sc-successtext">{totals.valid} valid</span>
                        <span className="sc-warntext">{totals.warning} peringatan</span>
                        <span className="sc-dangertext">{totals.rejected} ditolak</span>
                        <div className="sc-chips sc-summary__chips">
                            {(["all", "rejected", "warning"] as const).map((k) => (
                                <button key={k} type="button" className={cx("sc-chip", show === k && "is-on")} onClick={() => setShow(k)}>
                                    {k === "all" ? "Semua" : k === "rejected" ? "Ditolak" : "Peringatan"}
                                </button>
                            ))}
                        </div>
                    </div>
                    {totals.total > 0 && totals.rejected === totals.total && (
                        <Banner tone="danger">Semua baris ditolak — tidak ada yang bisa diunggah. Perbaiki ID master di file, lalu pilih ulang.</Banner>
                    )}
                    <div className="sc-tablewrap sc-tablewrap--scroll">
                        <table className="sc-table">
                            <thead>
                                <tr>
                                    <th>No</th>
                                    <th>File sumber</th>
                                    <th>Tanggal</th>
                                    <th>Brand</th>
                                    <th>Host</th>
                                    <th>Studio</th>
                                    <th>Jam</th>
                                    <th>Verdict</th>
                                    <th>Alasan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="sc-muted">
                                            Tidak ada baris untuk filter ini.
                                        </td>
                                    </tr>
                                ) : (
                                    allRows.slice(0, limit).map((r) => (
                                        <tr key={`${r.file}-${r.no}`} className={cx(r.verdict === "rejected" && "is-rejected")}>
                                            <td className="sc-mono">{r.excelRow}</td>
                                            <td className="sc-ellipsis" title={r.file}>{r.file}</td>
                                            <td className="sc-nowrap">{r.dateKey ? formatDateShort(r.dateKey) : "—"}</td>
                                            <td>
                                                {r.brandName || "—"}
                                                <div className="sc-muted sc-mono">{r.brandId}</div>
                                            </td>
                                            <td>{r.hostName || "—"}</td>
                                            <td className="sc-nowrap">{r.studioId || "—"}</td>
                                            <td className="sc-mono sc-nowrap">{timeText(r)}</td>
                                            <td>
                                                <Badge tone={r.verdict === "valid" ? "success" : r.verdict === "warning" ? "warning" : "danger"}>
                                                    {r.verdict === "valid" ? "Valid" : r.verdict === "warning" ? "Peringatan" : "Ditolak"}
                                                </Badge>
                                            </td>
                                            <td className="sc-reasons">{r.reasons.join("; ") || "—"}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                        {allRows.length > limit && (
                            <div className="sc-tablefoot">
                                <span>
                                    Menampilkan 1–{limit} dari {allRows.length}
                                </span>
                                <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 100)}>
                                    Muat lebih banyak
                                </Button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </Modal>
    );
}
