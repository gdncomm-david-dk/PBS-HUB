import * as React from "react";
import { AbsenceRow, AccountRow, ActionName, ActionResult, BrandRow, ClockRow, EvidenceRow, HostRow, ModuleContext, ReportRow, ScheduleRow, StudioRow } from "../core/types";
import { buildLookups, jsonRecords, mapEvidence } from "../core/data";
import { conflictIndex, distinct, Evidence, findSchedule } from "../core/schedule";
import { toDateKey } from "../core/time";
import { Banner, Card } from "./components";
import { Config, Env, Pending } from "./shared";
import { ScheduleList } from "./ScheduleList";
import { ScheduleDetail } from "./ScheduleDetail";
import { ScheduleForm } from "./ScheduleForm";
import { BulkUpload } from "./BulkUpload";
import { AiUpload } from "./AiUpload";

export interface AppProps {
    schedules: ScheduleRow[];
    brands: BrandRow[];
    hosts: HostRow[];
    studios: StudioRow[];
    accounts: AccountRow[];
    reports: ReportRow[];
    absences: AbsenceRow[];
    clocks: ClockRow[];
    evidence: EvidenceRow[];
    loading: boolean;
    ctx: ModuleContext;
    mode: "Admin" | "ReadOnly";
    actionResult: ActionResult | null;
    selectedScheduleId: string;
    /** Board (default) or Detail: a separate screen that shows only SelectedScheduleId. */
    view: "Board" | "Detail";
    height: number;
    width: number;
    emit: (action: ActionName, payload: Record<string, unknown>) => string;
    onSelect: (scheduleId: string) => void;
    openUrl: (url: string) => void;
}

const REQUEST_TIMEOUT_MS = 30000;

type Dialog =
    | { kind: "create"; preset?: Partial<ScheduleRow> }
    | { kind: "edit"; schedule: ScheduleRow }
    | { kind: "bulk" }
    | { kind: "ai" };

const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
const str = (v: unknown, d: string): string => (typeof v === "string" && v.trim() ? v.trim() : d);
const numOr = (v: unknown, d: number): number => (typeof v === "number" && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : d);

function useNow(intervalMs: number): Date {
    const [now, setNow] = React.useState(() => new Date());
    React.useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), intervalMs);
        return () => window.clearInterval(t);
    }, [intervalMs]);
    return now;
}

export function App(props: AppProps): React.ReactElement {
    const now = useNow(30000);
    const todayKey = toDateKey(now);
    const detailMode = props.view === "Detail";
    // Board: start on the board; only a SelectedScheduleId that changes after load opens a session.
    // Detail: open the linked session straight away.
    const [openId, setOpenId] = React.useState(() => (detailMode ? props.selectedScheduleId : ""));
    // Detail mode: sessions opened from the detail (clash links, same-day list) so Kembali steps back
    // through them before leaving the screen.
    const trail = React.useRef<string[]>([]);
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [banner, setBanner] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
    const [dialog, setDialog] = React.useState<Dialog | null>(null);

    // Rows deleted from the control stay hidden until the bound data stops returning them
    // (a canvas collection or a delayed Refresh would otherwise keep showing them).
    const [removed, setRemoved] = React.useState<Set<string>>(new Set());
    const rowKey = (s: ScheduleRow): string => (s.itemId !== null ? `#${s.itemId}` : s.scheduleId.toLowerCase());
    const schedules = React.useMemo(() => (removed.size ? props.schedules.filter((s) => !removed.has(rowKey(s))) : props.schedules), [props.schedules, removed]);
    React.useEffect(() => {
        if (!removed.size || props.loading) return;
        const present = new Set(props.schedules.map(rowKey));
        const still = [...removed].filter((k) => present.has(k));
        if (still.length !== removed.size) setRemoved(new Set(still));
    }, [props.schedules, props.loading]);
    const hide = React.useCallback((rows: ScheduleRow[]) => setRemoved((p) => new Set([...p, ...rows.map(rowKey)])), []);

    const lastInput = React.useRef(props.selectedScheduleId);
    React.useEffect(() => {
        if (props.selectedScheduleId !== lastInput.current) {
            lastInput.current = props.selectedScheduleId;
            if (detailMode) trail.current = [];
            setOpenId(props.selectedScheduleId || "");
        }
    }, [props.selectedScheduleId]);

    const canEdit =
        props.mode === "Admin" && (props.ctx.permissions.length === 0 || props.ctx.permissions.some((p) => /^(SCHEDULE_EDIT|SCHEDULE_WRITE)$/i.test(p)));

    const cfg = props.ctx.config;
    const config: Config = React.useMemo(
        () => ({
            platforms: distinct([...strList(cfg.platforms), ...props.accounts.map((a) => a.platform), ...schedules.map((s) => s.platform), "Shopee", "TikTok"]),
            statuses: distinct([...strList(cfg.statuses), "Planned", "Waiting Report", "Finished", "Cancelled", "Leave", ...schedules.map((s) => s.status)]),
            maxUploadMb: numOr(cfg.maxUploadMb, 10),
            aiAccept: str(cfg.aiAccept, ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.docx,.txt"),
            bulkFolder: str(cfg.bulkFolder, "Bulk Schedule"),
            aiFolder: str(cfg.aiFolder, "Schedule AI Automation"),
            bulkTable: str(cfg.bulkTable, "Table1"),
            templateUrl: str(cfg.templateUrl, ""),
            uploadMode: str(cfg.uploadMode, "control").toLowerCase() === "canvas" ? "canvas" : "control",
        }),
        [cfg, props.accounts, schedules],
    );

    const lk = React.useMemo(() => buildLookups(props.brands, props.hosts, props.studios, props.accounts), [props.brands, props.hosts, props.studios, props.accounts]);
    const studioName = React.useCallback((id: string) => {
        const s = lk.studios.get(id.toLowerCase());
        return s?.namaStudio ? `${s.namaStudio}` : id || "studio ?";
    }, [lk]);
    // Report Automation rows found by Title lookup (LOAD_EVIDENCE) when the evidence dataset missed them,
    // e.g. their LiveDate is blank or outside the loaded period.
    const [extraEvidence, setExtraEvidence] = React.useState<EvidenceRow[]>([]);
    const [evSearch, setEvSearch] = React.useState<Record<string, "searching" | "found" | "notfound" | "noreply">>({});
    const allEvidence = React.useMemo(() => {
        if (!extraEvidence.length) return props.evidence;
        const known = new Set(props.evidence.map((e) => (e.itemId !== null ? `#${e.itemId}` : e.key)));
        return [...props.evidence, ...extraEvidence.filter((e) => !known.has(e.itemId !== null ? `#${e.itemId}` : e.key))];
    }, [props.evidence, extraEvidence]);
    const ev = React.useMemo(() => new Evidence(props.reports, props.absences, props.clocks, allEvidence), [props.reports, props.absences, props.clocks, allEvidence]);
    const conflicts = React.useMemo(() => conflictIndex(schedules, lk.studios, studioName), [schedules, lk, studioName]);

    // Replies are matched to the waiting promise by requestId; stale or foreign replies are ignored.
    const waiters = React.useRef(new Map<string, { resolve: (r: ActionResult) => void; timer: number }>());
    // Requests that timed out; a reply that still arrives later is shown as a banner instead of being dropped.
    const late = React.useRef(new Set<string>());
    React.useEffect(() => {
        const r = props.actionResult;
        if (!r) return;
        if (late.current.delete(r.requestId)) {
            setBanner({ tone: r.status === "ok" ? "success" : "danger", text: r.message || (r.status === "ok" ? "Aplikasi mengonfirmasi permintaan sebelumnya." : "Permintaan sebelumnya gagal.") });
            return;
        }
        const w = waiters.current.get(r.requestId);
        if (!w) return;
        window.clearTimeout(w.timer);
        waiters.current.delete(r.requestId);
        w.resolve(r);
    }, [props.actionResult]);
    React.useEffect(() => () => waiters.current.forEach((w) => window.clearTimeout(w.timer)), []);

    const request = React.useCallback(
        (action: ActionName, payload: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ActionResult> => {
            const requestId = props.emit(action, payload);
            setPending({ requestId, action });
            return new Promise<ActionResult>((resolve) => {
                const timer = window.setTimeout(() => {
                    waiters.current.delete(requestId);
                    late.current.add(requestId);
                    resolve({
                        requestId,
                        status: "error",
                        message: `Aplikasi tidak membalas dalam ${Math.round(timeoutMs / 1000)} detik. Periksa apakah perubahan tersimpan sebelum mencoba lagi.`,
                        data: { timeout: true },
                    });
                }, timeoutMs);
                waiters.current.set(requestId, { resolve, timer });
            }).then((r) => {
                setPending((p) => (p && p.requestId === requestId ? null : p));
                return r;
            });
        },
        [props.emit],
    );

    const emit = React.useCallback((action: ActionName, payload: Record<string, unknown>) => void props.emit(action, payload), [props.emit]);

    // One lookup per report and control session, one at a time (canvas handles one OnChange per payload).
    const searched = React.useRef(new Set<string>());
    const findEvidence = React.useCallback(
        async (reportIds: string[]): Promise<void> => {
            for (const id of reportIds) {
                const k = id.trim().toLowerCase();
                if (!k || searched.current.has(k)) continue;
                searched.current.add(k);
                setEvSearch((p) => ({ ...p, [k]: "searching" }));
                const r = await request("LOAD_EVIDENCE", { reportId: id }, 20000);
                if (r.status !== "ok") {
                    setEvSearch((p) => ({ ...p, [k]: r.data.timeout ? "noreply" : "notfound" }));
                    continue;
                }
                const rows = mapEvidence(jsonRecords(JSON.stringify(Array.isArray(r.data.rows) ? r.data.rows : [])) ?? []).map((e, i) => ({
                    ...e,
                    key: `fetched:${k}:${e.itemId ?? i}`,
                    title: e.title || id,
                    fetched: true,
                }));
                setExtraEvidence((p) => [...p, ...rows]);
                setEvSearch((p) => ({ ...p, [k]: rows.length ? "found" : "notfound" }));
            }
        },
        [request],
    );
    const notify = React.useCallback((tone: "success" | "danger" | "warning", text: string) => setBanner({ tone, text }), []);

    const openIdRef = React.useRef(openId);
    openIdRef.current = openId;
    const show = React.useCallback(
        (id: string) => {
            setOpenId(id);
            setBanner(null);
            const out = id.startsWith("#") ? "" : id;
            // Our own output echoes back as SelectedScheduleId; only a change from the app counts as a new link.
            lastInput.current = out;
            props.onSelect(out);
        },
        [props.onSelect],
    );
    const open = React.useCallback(
        (s: ScheduleRow | null) => {
            const id = s ? s.scheduleId || (s.itemId !== null ? `#${s.itemId}` : "") : "";
            if (detailMode) {
                if (!s) {
                    // Kembali: step back through sessions opened here, then leave the screen.
                    const prev = trail.current.pop();
                    if (prev !== undefined) show(prev);
                    else props.emit("NAV_BACK", { scheduleId: openIdRef.current.startsWith("#") ? "" : openIdRef.current });
                    return;
                }
                if (id && id !== openIdRef.current) trail.current.push(openIdRef.current);
            }
            show(id);
            if (s?.scheduleId) props.emit("NAV_SESSION_DETAIL", { scheduleId: s.scheduleId });
        },
        [detailMode, show, props.emit],
    );

    const env: Env = {
        schedules,
        brands: props.brands,
        hosts: props.hosts,
        studios: props.studios,
        accounts: props.accounts,
        lk,
        ev,
        conflicts,
        now,
        todayKey,
        canEdit,
        pending,
        loading: props.loading,
        config,
        studioName,
        request,
        emit,
        open,
        notify,
        openUrl: props.openUrl,
        hide,
        findEvidence,
        evSearch,
    };

    const openRow = openId ? findSchedule(schedules, openId) : undefined;

    const dialogs = (
        <>
            {dialog && (dialog.kind === "create" || dialog.kind === "edit") && (
                <ScheduleForm
                    env={env}
                    mode={dialog.kind}
                    schedule={dialog.kind === "edit" ? dialog.schedule : undefined}
                    preset={dialog.kind === "create" ? dialog.preset : undefined}
                    onClose={() => setDialog(null)}
                    onSaved={(id, created) => {
                        setDialog(null);
                        setBanner({ tone: "success", text: created ? `Jadwal ${id || ""} dibuat.`.replace("  ", " ") : "Perubahan jadwal tersimpan." });
                        if (created && id) {
                            if (detailMode && id !== openIdRef.current) trail.current.push(openIdRef.current);
                            show(id);
                        }
                    }}
                />
            )}
            {dialog?.kind === "bulk" && <BulkUpload env={env} onClose={() => setDialog(null)} />}
            {dialog?.kind === "ai" && <AiUpload env={env} onClose={() => setDialog(null)} />}
        </>
    );

    // Layout size from the width the canvas gives the control (falls back to the window width).
    const [winW, setWinW] = React.useState(() => window.innerWidth);
    React.useEffect(() => {
        const on = () => setWinW(window.innerWidth);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    const w = props.width > 0 ? props.width : winW;
    const size = w < 640 ? "s" : w < 1040 ? "m" : "l";

    if (detailMode) {
        return (
            <div className="pbs-sc" data-size={size} style={props.height > 0 ? { height: props.height } : undefined}>
                <div className="sc-page">
                    {banner && (
                        <Banner tone={banner.tone} onClose={() => setBanner(null)}>
                            {banner.text}
                        </Banner>
                    )}
                    {openRow ? (
                        <ScheduleDetail
                            env={env}
                            schedule={openRow}
                            backLabel="Kembali"
                            onBack={() => open(null)}
                            onEdit={() => setDialog({ kind: "edit", schedule: openRow })}
                            onDuplicate={() => setDialog({ kind: "create", preset: openRow })}
                        />
                    ) : props.loading ? (
                        <Card className="sc-loadcard">Memuat jadwal {openId}…</Card>
                    ) : (
                        <Banner tone="warning" action={<button type="button" className="sc-link" onClick={() => open(null)}>Kembali</button>}>
                            {openId ? `Jadwal “${openId}” tidak ditemukan. Mungkin sudah dihapus, atau tanggalnya di luar data yang dimuat screen ini.` : "Belum ada jadwal yang dipilih (SelectedScheduleId kosong)."}
                        </Banner>
                    )}
                </div>
                {dialogs}
            </div>
        );
    }

    return (
        <div className="pbs-sc" data-size={size} style={props.height > 0 ? { height: props.height } : undefined}>
            <div className="sc-page">
                {banner && (
                    <Banner tone={banner.tone} onClose={() => setBanner(null)}>
                        {banner.text}
                    </Banner>
                )}
                {openId && !openRow && !props.loading ? (
                    <Banner tone="warning" action={<button type="button" className="sc-link" onClick={() => open(null)}>Kembali ke schedule</button>}>
                        Jadwal “{openId}” tidak ditemukan di data yang dimuat. Periksa rentang tanggal.
                    </Banner>
                ) : (
                    openRow && (
                        <ScheduleDetail
                            env={env}
                            schedule={openRow}
                            onBack={() => open(null)}
                            onEdit={() => setDialog({ kind: "edit", schedule: openRow })}
                            onDuplicate={() => setDialog({ kind: "create", preset: openRow })}
                        />
                    )
                )}
                {/* Stays mounted behind the detail so Kembali returns to the same week, view, filters and page. */}
                <div className="sc-listhost" hidden={!!openId}>
                    <ScheduleList
                        env={env}
                        onCreate={(preset) => setDialog({ kind: "create", preset })}
                        onEdit={(s) => setDialog({ kind: "edit", schedule: s })}
                        onBulk={() => (config.uploadMode === "canvas" ? emit("OPEN_UPLOAD", { kind: "BULK", folder: config.bulkFolder }) : setDialog({ kind: "bulk" }))}
                        onAi={() => (config.uploadMode === "canvas" ? emit("OPEN_UPLOAD", { kind: "AI", folder: config.aiFolder }) : setDialog({ kind: "ai" }))}
                    />
                </div>
            </div>
            {dialogs}
        </div>
    );
}
