import * as React from "react";
import { readSheets } from "../core/xlsx";
import { readPdf } from "../core/pdfText";
import { LayoutResult, pdfSessions, sheetSessions, yearHint } from "../core/layout";
import { checkParsed, createItem, Overrides, ParsedRow, Resolved, ResolveContext, resolveSession } from "../core/parseResolve";
import { formatDateShort } from "../core/time";
import { Badge, Banner, Bar, Button, cx, Icon, Modal, Pager, usePaged } from "./components";
import { Env, hostLabel, UNCONFIRMED } from "./shared";
import { fmtSize } from "./BulkUpload";

interface FileItem {
    id: string;
    name: string;
    size: number;
    state: "reading" | "ready";
    /** Page being read, for a multi-page PDF. */
    step?: string;
    error?: string;
    result?: LayoutResult;
    year?: number;
}

const ACCEPT = /\.(pdf|xlsx)$/i;

type Show = "all" | "valid" | "clash" | "dup" | "exists" | "check" | "rejected";
const SHOW_LABEL: Record<Show, string> = { all: "Semua", valid: "Valid", clash: "Bentrok", dup: "Duplikat", exists: "Sudah ada", check: "Perlu dicek", rejected: "Belum lengkap" };

/** What a row is, for the chips and the "Hasil cek" badges. A row can be several things at once. */
function kinds(r: ParsedRow): Show[] {
    const out: Show[] = [];
    if (r.verdict === "rejected") out.push("rejected");
    if (r.flags.exists) out.push("exists");
    if (r.flags.dup) out.push("dup");
    if (r.flags.clash.length) out.push("clash");
    if (r.verdict === "warning" && !out.length) out.push("check");
    if (r.verdict === "valid") out.push("valid");
    return out;
}
const KIND_TONE: Record<Show, "success" | "warning" | "danger" | "neutral" | "info"> = { all: "neutral", valid: "success", clash: "danger", dup: "warning", exists: "neutral", check: "warning", rejected: "danger" };
const CHUNK = 150;
/** "HH:MM" from a time input → minutes from midnight; empty → null. */
const toMin = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

async function parseFile(f: File, now: Date, onPage?: (page: number, total: number) => void): Promise<{ result: LayoutResult; year: number }> {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const year = yearHint(f.name, now);
    if (/\.pdf$/i.test(f.name)) {
        return { result: pdfSessions(f.name, await readPdf(bytes, onPage), year), year };
    }
    return { result: sheetSessions(f.name, readSheets(bytes), year), year };
}

/**
 * Parse a schedule PDF or Excel (the "Day · Date · per-brand Start/End/Duration/Host/Platform" layout) right in the
 * control, match brand, account, studio and host against the master lists, and create the ticked sessions with
 * BULK_CREATE_SCHEDULE. No AI, no flow, no file stored.
 */
export function ParseUpload(props: { env: Env; loaded: { from: string; to: string } | null; onClose: () => void }): React.ReactElement {
    const { env } = props;
    const [files, setFiles] = React.useState<FileItem[]>([]);
    const [drag, setDrag] = React.useState(false);
    const [picks, setPicks] = React.useState<Record<string, Overrides>>({});
    const [sel, setSel] = React.useState<Record<string, boolean>>({});
    const [group, setGroup] = React.useState("");
    const [hideExisting, setHideExisting] = React.useState(true);
    const [show, setShow] = React.useState<Show>("all");
    const [phase, setPhase] = React.useState<"pick" | "saving" | "done">("pick");
    const [progress, setProgress] = React.useState({ done: 0, total: 0 });
    const [outcome, setOutcome] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const maxBytes = env.config.maxUploadMb * 1048576;

    const rcx: ResolveContext = React.useMemo(
        () => ({ lk: env.lk, brands: env.brands, hosts: env.hosts, studios: env.studios, accounts: env.accounts, schedules: env.schedules, platforms: env.config.platforms }),
        [env.lk, env.brands, env.hosts, env.studios, env.accounts, env.schedules, env.config.platforms],
    );

    const patch = (id: string, p: Partial<FileItem>): void => setFiles((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const add = (list: FileList | null): void => {
        if (!list) return;
        const picked = Array.from(list);
        const fresh: FileItem[] = picked.map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "reading" }));
        setFiles((xs) => [...xs.filter((x) => !fresh.some((n) => n.name === x.name)), ...fresh]);
        fresh.forEach((it, i) => {
            const f = picked[i];
            if (!ACCEPT.test(f.name)) return patch(it.id, { state: "ready", error: "Bukan file .pdf atau .xlsx" });
            if (f.size > maxBytes) return patch(it.id, { state: "ready", error: `Lebih dari ${env.config.maxUploadMb} MB` });
            // Last safety net: a file never stays on "Membaca…" for more than two minutes.
            let timer = 0;
            const cap = new Promise<never>((_resolve, reject) => {
                timer = window.setTimeout(() => reject(new Error("File tidak selesai dibaca dalam 2 menit. Coba upload versi Excel-nya, atau simpan ulang PDF-nya lalu upload lagi.")), 120000);
            });
            void Promise.race([parseFile(f, env.now, (page, total) => patch(it.id, { step: total > 1 ? `hal. ${page}/${total}` : "" })), cap])
                .finally(() => window.clearTimeout(timer))
                .then(({ result, year }) => patch(it.id, { state: "ready", result, year }))
                .catch((e: unknown) => patch(it.id, { state: "ready", error: e instanceof Error ? e.message : "File tidak bisa dibaca" }));
        });
    };

    const resolved: Resolved[] = React.useMemo(() => files.flatMap((f) => (f.result ? f.result.sessions.map((s) => resolveSession(s, rcx)) : [])), [files, rcx]);
    const origOf = React.useMemo(() => new Map(resolved.map((r) => [r.id, r])), [resolved]);
    const groups = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const r of resolved) m.set(r.raw.group, (m.get(r.raw.group) ?? 0) + 1);
        return Array.from(m.entries());
    }, [resolved]);
    const inGroup = resolved.filter((r) => !group || r.raw.group === group);
    // Past dates are normal here (a month sheet, a late upload): they are neither flagged nor hidden.
    const scope = inGroup;
    // Checked only for what is on screen: a year of sessions against every schedule would be slow.
    const scopeKey = scope.map((r) => r.id).join(",");
    const allChecked: ParsedRow[] = React.useMemo(
        () => checkParsed(scope, picks, rcx, { todayKey: env.todayKey, studioName: env.studioName }),
        // scope is rebuilt every render; its ids say when it really changed.
        [scopeKey, picks, rcx, env.todayKey, env.studioName],
    );
    // Sessions already in Schedule are hidden by default: re-uploading the same file should only show what is new.
    const existCount = allChecked.filter((r) => r.flags.exists).length;
    const checked = hideExisting ? allChecked.filter((r) => !r.flags.exists) : allChecked;
    // Clashing, duplicated and already-existing sessions start unticked; "Pilih semua" still ticks them.
    const selectable = (r: ParsedRow): boolean => r.verdict !== "rejected";
    const byDefault = (r: ParsedRow): boolean => !r.flags.exists && !r.flags.dup && !r.flags.clash.length;
    const isOn = (r: ParsedRow): boolean => selectable(r) && (sel[r.id] ?? byDefault(r));
    const chosen = checked.filter(isOn);
    const kindOf = new Map(checked.map((r) => [r.id, kinds(r)]));
    const counts = Object.fromEntries((Object.keys(SHOW_LABEL) as Show[]).map((k) => [k, k === "all" ? checked.length : checked.filter((r) => kindOf.get(r.id)?.includes(k)).length])) as Record<Show, number>;
    const visible = checked.filter((r) => show === "all" || kindOf.get(r.id)?.includes(show));
    const visibleSel = visible.filter(selectable);
    const allOn = visibleSel.length > 0 && visibleSel.every(isOn);
    const someOn = visibleSel.some(isOn);
    const pg = usePaged(visible, `${group}|${hideExisting}|${show}|${files.length}`, 25);
    const reading = files.some((f) => f.state === "reading");
    // The schedules dataset only holds the period the board loaded; outside it nothing can clash yet.
    const loadedFrom = props.loaded?.from ?? "";
    const loadedTo = props.loaded?.to ?? "";
    const outside = loadedFrom ? checked.filter((r) => r.raw.dateKey && (r.raw.dateKey < loadedFrom || r.raw.dateKey > loadedTo)).length : 0;
    const noYear = files.some((f) => f.result?.sessions.some((s) => s.dateText && !/\d{4}/.test(s.dateText)));

    // A pick for an undecided cell also fills the same undecided cell in similar rows (same host text, same
    // brand and platform), so 30 "pilih akun" rows take one choice. Rows already decided are left alone.
    const setPick = (id: string, p: Overrides): void => {
        const src = resolved.find((r) => r.id === id);
        setPicks((x) => {
            const next = { ...x, [id]: { ...x[id], ...p } };
            if (!src) return next;
            for (const r of resolved) {
                if (r.id === id) continue;
                const o = next[r.id] ?? {};
                if (p.hostId && !r.hostId && o.hostId === undefined && r.raw.host && r.raw.host === src.raw.host) next[r.id] = { ...o, hostId: p.hostId };
                if (p.accountId && !r.accountId && o.accountId === undefined && r.brandId === src.brandId && r.platform === src.platform) next[r.id] = { ...(next[r.id] ?? o), accountId: p.accountId };
                if (p.studioId && !r.studioId && o.studioId === undefined && r.brandId && r.brandId === src.brandId) next[r.id] = { ...(next[r.id] ?? o), studioId: p.studioId };
            }
            return next;
        });
    };
    /** Puts the file's date and times back on a row. */
    const unedit = (id: string): void =>
        setPicks((x) => {
            const { dateKey: _d, startMin: _s, endMin: _e, ...rest } = x[id] ?? {};
            return { ...x, [id]: rest };
        });
    /** Tick or untick every row of the current filter (all pages). */
    const setAll = (on: boolean, rows: ParsedRow[] = visible): void => setSel((x) => ({ ...x, ...Object.fromEntries(rows.filter(selectable).map((r) => [r.id, on])) }));
    const headerBox = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (headerBox.current) headerBox.current.indeterminate = someOn && !allOn;
    });

    const submit = async (): Promise<void> => {
        const items = chosen.map(createItem);
        if (!items.length) return;
        setPhase("saving");
        setProgress({ done: 0, total: items.length });
        let made = 0;
        for (let i = 0; i < items.length; i += CHUNK) {
            const part = items.slice(i, i + CHUNK);
            const r = await env.request("BULK_CREATE_SCHEDULE", { items: part, count: part.length, source: "PARSE" }, 60000 + part.length * 2000);
            if (r.status !== "ok") {
                setOutcome({
                    tone: r.data.timeout ? "warning" : "danger",
                    text: `${made ? `${made} jadwal sudah dibuat. ` : ""}${r.data.timeout ? UNCONFIRMED : r.message || "Gagal membuat jadwal"}`,
                });
                setPhase("done");
                return;
            }
            made += part.length;
            setProgress({ done: made, total: items.length });
        }
        setOutcome({ tone: "success", text: `${made} jadwal dibuat.` });
        setPhase("done");
    };

    const hostOpts = [...env.hosts].sort((a, b) => a.name.localeCompare(b.name));
    const studioOpts = [...env.studios].sort((a, b) => a.studioId.localeCompare(b.studioId));

    const footer =
        phase === "done" ? (
            <Button variant="primary" onClick={props.onClose}>
                Selesai
            </Button>
        ) : (
            <>
                {checked.length > 0 && <span className="sc-foot-note sc-foot-left">{chosen.length} dari {checked.length} sesi dipilih</span>}
                <Button variant="ghost" onClick={props.onClose} disabled={phase === "saving"}>
                    Batal
                </Button>
                <Button variant="primary" icon={Icon.plus(14)} disabled={phase !== "pick" || reading || !chosen.length} onClick={() => void submit()}>
                    {phase === "saving" ? "Membuat jadwal…" : `Buat ${chosen.length} jadwal`}
                </Button>
            </>
        );

    return (
        <Modal title="Parse jadwal dari PDF / Excel" width={1280} tall onClose={phase === "saving" ? () => undefined : props.onClose} footer={footer}>
            {phase === "pick" && files.length > 0 && (
                <div className="sc-parsebar">
                    <Button variant="secondary" size="sm" icon={Icon.plus(14)} onClick={() => inputRef.current?.click()}>
                        Tambah file
                    </Button>
                    <span className="sc-muted">.pdf / .xlsx · maks {env.config.maxUploadMb} MB</span>
                </div>
            )}
            {phase === "pick" && (
                <div
                    style={files.length > 0 ? { display: "none" } : undefined}
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
                    <span className="sc-drop__icon">{Icon.file(22)}</span>
                    <b>Tarik file .pdf / .xlsx ke sini</b>
                    <span className="sc-muted">atau</span>
                    <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                        Pilih file
                    </Button>
                    <span className="sc-muted">PDF hasil ekspor (bukan scan) · bisa lebih dari satu file · maks {env.config.maxUploadMb} MB</span>
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".pdf,.xlsx,application/pdf"
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
                        <b>{phase === "saving" ? `Membuat jadwal ${progress.done} dari ${progress.total}…` : outcome?.text}</b>
                        <span className="sc-muted">{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span>
                    </div>
                    <Bar ratio={progress.done / Math.max(1, progress.total)} tone={outcome && outcome.tone !== "success" ? "warning" : "primary"} height={6} />
                    {outcome && outcome.tone !== "success" && <Banner tone={outcome.tone}>{outcome.text}</Banner>}
                </div>
            )}

            {files.length > 0 && (
                <ul className="sc-files">
                    {files.map((f) => (
                        <li key={f.id} className={cx("sc-file", (f.error || f.result?.problem) && "is-error")}>
                            <span className="sc-file__icon">{Icon.file(16)}</span>
                            <div className="sc-file__main">
                                <b>{f.name}</b>
                                <span className="sc-muted">
                                    {fmtSize(f.size)}
                                    {f.result ? ` · ${f.result.sessions.length} sesi terbaca` : ""}
                                    {f.result && f.result.skipped.length ? ` · ${f.result.skipped.length} baris dilewati` : ""}
                                </span>
                                {f.error && <span className="sc-dangertext">{f.error}</span>}
                                {f.result?.problem && <span className="sc-dangertext">{f.result.problem}</span>}
                                {f.result && f.result.skipped.length > 0 && (
                                    <span className="sc-muted" title={f.result.skipped.map((s) => `${s.where}: ${s.text}`).join("\n")}>
                                        Dilewati: {f.result.skipped.slice(0, 3).map((s) => `${s.where} (${s.text})`).join(", ")}
                                        {f.result.skipped.length > 3 ? "…" : ""}
                                    </span>
                                )}
                            </div>
                            <div className="sc-file__state">
                                {f.state === "reading" ? <span className="sc-muted">Membaca{f.step ? ` ${f.step}` : ""}…</span> : f.error || f.result?.problem ? <Badge tone="danger">Gagal</Badge> : <Badge tone="info">Terbaca</Badge>}
                                {phase === "pick" && (
                                    <button type="button" className="sc-iconbtn" aria-label={`Hapus ${f.name}`} onClick={() => setFiles((xs) => xs.filter((x) => x.id !== f.id))}>
                                        {Icon.close(14)}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {resolved.length > 0 && phase === "pick" && (
                <>
                    <div className="sc-summary">
                        <b>{checked.length} sesi</b>
                        <span className="sc-successtext">{counts.valid} valid</span>
                        {counts.clash > 0 && <span className="sc-dangertext">{counts.clash} bentrok</span>}
                        {counts.dup > 0 && <span className="sc-warntext">{counts.dup} duplikat</span>}
                        {counts.exists > 0 && <span className="sc-muted">{counts.exists} sudah ada</span>}
                        {counts.rejected > 0 && <span className="sc-dangertext">{counts.rejected} belum lengkap</span>}
                        <div className="sc-chips sc-summary__chips">
                            {(Object.keys(SHOW_LABEL) as Show[])
                                .filter((k) => k === "all" || counts[k] > 0)
                                .map((k) => (
                                    <button key={k} type="button" className={cx("sc-chip", show === k && "is-on")} onClick={() => setShow(k)}>
                                        {SHOW_LABEL[k]} <span className="sc-muted">{counts[k]}</span>
                                    </button>
                                ))}
                        </div>
                    </div>
                    <div className="sc-parsebar">
                        {groups.length > 1 && (
                            <label className={cx("sc-select", group && "is-set")}>
                                <span>Sheet</span>
                                <select value={group} onChange={(e) => setGroup(e.target.value)}>
                                    <option value="">Semua ({resolved.length})</option>
                                    {groups.map(([g, n]) => (
                                        <option key={g} value={g}>
                                            {g} ({n})
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <label className="sc-check">
                            <input type="checkbox" checked={hideExisting} onChange={(e) => setHideExisting(e.target.checked)} />
                            Sembunyikan yang sudah ada di Schedule{existCount ? ` (${existCount})` : ""}
                        </label>
                        <span className="sc-parsebar__right">
                            <button type="button" className="sc-link sc-link--sm" onClick={() => setAll(true)}>
                                Pilih semua{show !== "all" ? ` (${SHOW_LABEL[show]})` : ""}
                            </button>
                            <button type="button" className="sc-link sc-link--sm" onClick={() => setAll(true, checked.filter(byDefault))}>
                                Pilih yang aman saja
                            </button>
                            <button type="button" className="sc-link sc-link--sm" onClick={() => setAll(false)}>
                                Kosongkan
                            </button>
                        </span>
                    </div>
                    {noYear && <p className="sc-muted">Tanggal tanpa tahun dianggap tahun {files.find((f) => f.year)?.year ?? env.now.getFullYear()} (atau tahun yang tertulis di nama file).</p>}
                    {outside > 0 && (
                        <Banner tone="warning">
                            {outside} sesi di luar periode yang sedang dimuat di papan{loadedFrom ? ` (${formatDateShort(loadedFrom)}–${formatDateShort(loadedTo)})` : ""}, jadi bentrok host/studio untuk sesi itu belum bisa dicek. Tutup dialog ini, buka minggu/bulan
                            tanggal tersebut di papan, lalu parse ulang.
                        </Banner>
                    )}
                    {checked.length === 0 && (
                        <Banner tone="info">
                            {hideExisting && existCount
                                ? `Semua ${existCount} sesi sudah ada di Schedule. Hapus centang “Sembunyikan yang sudah ada di Schedule” untuk melihatnya.`
                                : "Tidak ada sesi."}
                        </Banner>
                    )}
                    {checked.length > 0 && (
                        <div className="sc-tablewrap sc-tablewrap--scroll sc-tablewrap--tall">
                            <table className="sc-table sc-table--parse">
                                <thead>
                                    <tr>
                                        <th>
                                            <input ref={headerBox} type="checkbox" aria-label="Pilih semua sesi di filter ini" title="Pilih / kosongkan semua di filter ini" checked={allOn} disabled={!visibleSel.length} onChange={(e) => setAll(e.target.checked)} />
                                        </th>
                                        <th>Tanggal</th>
                                        <th>Jam</th>
                                        <th>Brand</th>
                                        <th>Akun</th>
                                        <th>Host</th>
                                        <th>Studio</th>
                                        <th>Jam live</th>
                                        <th>Hasil cek</th>
                                        <th>Catatan</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pg.rows.map((r) => {
                                        const own = env.accounts.filter((a) => a.brandId.toLowerCase() === r.brandId.toLowerCase());
                                        const accOpts = own.length ? own : env.accounts;
                                        const hostSel = picks[r.id]?.hostId ?? r.hostId;
                                        const studioSel = picks[r.id]?.studioId ?? r.studioId;
                                        const accSel = picks[r.id]?.accountId ?? r.accountId;
                                        const orig = origOf.get(r.id);
                                        const dateEdited = !!orig && orig.raw.dateKey !== r.raw.dateKey;
                                        const timeEdited = !!orig && (orig.raw.startMin !== r.raw.startMin || orig.raw.endMin !== r.raw.endMin);
                                        return (
                                            <tr key={r.id} className={cx((r.verdict === "rejected" || r.flags.clash.length > 0) && "is-rejected")}>
                                                <td>
                                                    <input type="checkbox" aria-label="Pilih sesi" disabled={r.verdict === "rejected"} checked={isOn(r)} onChange={(e) => setSel((x) => ({ ...x, [r.id]: e.target.checked }))} />
                                                </td>
                                                <td className="sc-nowrap">
                                                    <input
                                                        type="date"
                                                        aria-label="Tanggal"
                                                        className={cx("sc-cellinput", !r.raw.dateKey && "is-empty", dateEdited && "is-edited")}
                                                        value={r.raw.dateKey}
                                                        onChange={(e) => setPick(r.id, { dateKey: e.target.value })}
                                                    />
                                                    <div className="sc-muted sc-tiny">
                                                        {r.raw.where}
                                                        {dateEdited && ` · di file: ${orig?.raw.dateKey ? formatDateShort(orig.raw.dateKey) : "—"}`}
                                                    </div>
                                                </td>
                                                <td className="sc-nowrap">
                                                    <span className="sc-timepair">
                                                        <input
                                                            type="time"
                                                            aria-label="Jam mulai"
                                                            className={cx("sc-cellinput sc-cellinput--time", r.raw.startMin === null && "is-empty", timeEdited && "is-edited")}
                                                            value={r.raw.startText}
                                                            onChange={(e) => setPick(r.id, { startMin: toMin(e.target.value) })}
                                                        />
                                                        –
                                                        <input
                                                            type="time"
                                                            aria-label="Jam selesai"
                                                            className={cx("sc-cellinput sc-cellinput--time", r.raw.endMin === null && "is-empty", timeEdited && "is-edited")}
                                                            value={r.raw.endText}
                                                            onChange={(e) => setPick(r.id, { endMin: toMin(e.target.value) })}
                                                        />
                                                    </span>
                                                    <div className="sc-muted sc-tiny">
                                                        {r.shift}
                                                        {timeEdited && ` · di file: ${orig?.raw.startText || "?"}–${orig?.raw.endText || "?"}`}
                                                        {(dateEdited || timeEdited) && (
                                                            <>
                                                                {" · "}
                                                                <button type="button" className="sc-link sc-link--sm" onClick={() => unedit(r.id)}>
                                                                    kembalikan
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    {r.brandId ? r.brandName : <span className="sc-dangertext">{r.raw.label || "—"}</span>}
                                                    {r.brandId && r.raw.label && r.raw.label.toLowerCase() !== r.brandName.toLowerCase() && <div className="sc-muted sc-tiny">{r.raw.label}</div>}
                                                </td>
                                                <td>
                                                    <select className={cx("sc-cellselect", !accSel && "is-empty")} value={accSel} onChange={(e) => setPick(r.id, { accountId: e.target.value })}>
                                                        <option value="">— pilih akun —</option>
                                                        {accOpts.map((a) => (
                                                            <option key={a.key} value={a.accountId}>
                                                                {r.accountOptions.includes(a.accountId) ? "★ " : ""}
                                                                {a.accountId} · {a.accountName}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <div className="sc-muted sc-tiny">{r.platform || "—"}</div>
                                                </td>
                                                <td>
                                                    <select className={cx("sc-cellselect", !hostSel && "is-empty")} value={hostSel} onChange={(e) => setPick(r.id, { hostId: e.target.value })}>
                                                        <option value="">— pilih host —</option>
                                                        {r.hostOptions.map((id) => (
                                                            <option key={"c" + id} value={id}>
                                                                ★ {hostLabel(env.lk, id)}
                                                            </option>
                                                        ))}
                                                        {hostOpts
                                                            .filter((h) => !r.hostOptions.includes(h.hostId))
                                                            .map((h) => (
                                                                <option key={h.key} value={h.hostId}>
                                                                    {h.name}
                                                                    {h.isActive ? "" : " (nonaktif)"}
                                                                </option>
                                                            ))}
                                                    </select>
                                                    {r.raw.host && hostLabel(env.lk, hostSel) !== r.raw.host && <div className="sc-muted sc-tiny">di file: {r.raw.host}</div>}
                                                </td>
                                                <td>
                                                    <select className={cx("sc-cellselect", !studioSel && "is-empty")} value={studioSel} onChange={(e) => setPick(r.id, { studioId: e.target.value })}>
                                                        <option value="">— pilih studio —</option>
                                                        {studioOpts.map((s) => (
                                                            <option key={s.key} value={s.studioId}>
                                                                {r.studioOptions.includes(s.studioId) ? "★ " : ""}
                                                                {s.studioId}
                                                                {s.namaStudio ? ` · ${s.namaStudio}` : ""}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {studioSel && !picks[r.id]?.studioId && r.studioFrom && (
                                                        <div className="sc-muted sc-tiny">{r.studioFrom === "dokumen" ? "dari file" : r.studioFrom === "master" ? "dari list Studio" : "dari jadwal sebelumnya"}</div>
                                                    )}
                                                </td>
                                                <td className="sc-mono sc-nowrap">{r.jamLive}</td>
                                                <td>
                                                    <div className="sc-badges">
                                                        {(kindOf.get(r.id) ?? []).map((k) => (
                                                            <Badge key={k} tone={KIND_TONE[k]} title={k === "exists" ? r.flags.exists : k === "dup" ? r.flags.dup : k === "clash" ? r.flags.clash.join("\n") : undefined}>
                                                                {SHOW_LABEL[k]}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="sc-reasons">{r.reasons.join("; ") || "—"}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <Pager {...pg} onPage={pg.setPage} unit="sesi" />
                        </div>
                    )}
                </>
            )}
        </Modal>
    );
}
