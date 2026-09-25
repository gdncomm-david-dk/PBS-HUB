import * as React from "react";
import { AbsenceRow, AccountRow, ActionName, ActionResult, BrandRow, ClockRow, EvidenceRow, HostRow, ModuleContext, ReportRow, ScheduleRow, StudioRow } from "../core/types";
import { buildLookups } from "../core/data";
import { conflictIndex, distinct, Evidence } from "../core/schedule";
import { toDateKey } from "../core/time";
import { Banner } from "./components";
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
    height: number;
    emit: (action: ActionName, payload: Record<string, unknown>) => string;
    onSelect: (scheduleId: string) => void;
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
    const [openId, setOpenId] = React.useState(props.selectedScheduleId || "");
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [banner, setBanner] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
    const [dialog, setDialog] = React.useState<Dialog | null>(null);

    const lastInput = React.useRef(props.selectedScheduleId);
    React.useEffect(() => {
        if (props.selectedScheduleId !== lastInput.current) {
            lastInput.current = props.selectedScheduleId;
            setOpenId(props.selectedScheduleId || "");
        }
    }, [props.selectedScheduleId]);

    const canEdit =
        props.mode === "Admin" && (props.ctx.permissions.length === 0 || props.ctx.permissions.some((p) => /^(SCHEDULE_EDIT|SCHEDULE_WRITE)$/i.test(p)));

    const cfg = props.ctx.config;
    const config: Config = React.useMemo(
        () => ({
            platforms: distinct([...strList(cfg.platforms), ...props.accounts.map((a) => a.platform), ...props.schedules.map((s) => s.platform), "Shopee", "TikTok"]),
            statuses: distinct([...strList(cfg.statuses), "Planned", "Waiting Report", "Finished", "Cancelled", "Leave", ...props.schedules.map((s) => s.status)]),
            maxUploadMb: numOr(cfg.maxUploadMb, 10),
            aiAccept: str(cfg.aiAccept, ".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.docx,.txt"),
            bulkFolder: str(cfg.bulkFolder, "Bulk Schedule"),
            aiFolder: str(cfg.aiFolder, "Schedule AI Automation"),
            bulkTable: str(cfg.bulkTable, "Table1"),
            templateUrl: str(cfg.templateUrl, ""),
            uploadMode: str(cfg.uploadMode, "control").toLowerCase() === "canvas" ? "canvas" : "control",
        }),
        [cfg, props.accounts, props.schedules],
    );

    const lk = React.useMemo(() => buildLookups(props.brands, props.hosts, props.studios, props.accounts), [props.brands, props.hosts, props.studios, props.accounts]);
    const studioName = React.useCallback((id: string) => {
        const s = lk.studios.get(id.toLowerCase());
        return s?.namaStudio ? `${s.namaStudio}` : id || "studio ?";
    }, [lk]);
    const ev = React.useMemo(() => new Evidence(props.reports, props.absences, props.clocks, props.evidence), [props.reports, props.absences, props.clocks, props.evidence]);
    const conflicts = React.useMemo(() => conflictIndex(props.schedules, lk.studios, studioName), [props.schedules, lk, studioName]);

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
    const notify = React.useCallback((tone: "success" | "danger" | "warning", text: string) => setBanner({ tone, text }), []);

    const open = React.useCallback(
        (s: ScheduleRow | null) => {
            const id = s ? s.scheduleId || (s.itemId !== null ? `#${s.itemId}` : "") : "";
            setOpenId(id);
            setBanner(null);
            props.onSelect(s?.scheduleId ?? "");
            if (s?.scheduleId) props.emit("NAV_SESSION_DETAIL", { scheduleId: s.scheduleId });
        },
        [props.onSelect, props.emit],
    );

    const env: Env = {
        schedules: props.schedules,
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
    };

    const openRow = openId
        ? props.schedules.find((s) => (openId.startsWith("#") ? `#${s.itemId}` === openId : s.scheduleId.toLowerCase() === openId.toLowerCase()))
        : undefined;

    return (
        <div className="pbs-sc" style={props.height > 0 ? { height: props.height } : undefined}>
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
                ) : openRow ? (
                    <ScheduleDetail
                        env={env}
                        schedule={openRow}
                        onBack={() => open(null)}
                        onEdit={() => setDialog({ kind: "edit", schedule: openRow })}
                        onDuplicate={() => setDialog({ kind: "create", preset: openRow })}
                    />
                ) : (
                    <ScheduleList
                        env={env}
                        onCreate={(preset) => setDialog({ kind: "create", preset })}
                        onEdit={(s) => setDialog({ kind: "edit", schedule: s })}
                        onBulk={() => (config.uploadMode === "canvas" ? emit("OPEN_UPLOAD", { kind: "BULK", folder: config.bulkFolder }) : setDialog({ kind: "bulk" }))}
                        onAi={() => (config.uploadMode === "canvas" ? emit("OPEN_UPLOAD", { kind: "AI", folder: config.aiFolder }) : setDialog({ kind: "ai" }))}
                    />
                )}
            </div>
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
                            setOpenId(id);
                            props.onSelect(id);
                        }
                    }}
                />
            )}
            {dialog?.kind === "bulk" && <BulkUpload env={env} onClose={() => setDialog(null)} />}
            {dialog?.kind === "ai" && <AiUpload env={env} onClose={() => setDialog(null)} />}
        </div>
    );
}
