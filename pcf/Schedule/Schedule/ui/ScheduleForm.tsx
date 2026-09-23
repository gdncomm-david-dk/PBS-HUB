import * as React from "react";
import { ScheduleRow } from "../core/types";
import { conflictsFor, Slot } from "../core/schedule";
import { formatMinutes, parseTimeToMinutes } from "../core/time";
import { Banner, Button, cx, Field, Icon, Modal, Toggle } from "./components";
import { Env, scheduleStatus } from "./shared";

interface Values {
    date: string;
    brandId: string;
    accountId: string;
    studioId: string;
    hostId: string;
    platform: string;
    shift: string;
    start: string;
    end: string;
    position: string;
    sesi: string;
    campaignName: string;
    liveBreak: boolean;
    status: string;
}

const hhmm = (m: number | null): string => (m === null ? "" : formatMinutes(m));

export function ScheduleForm(props: {
    env: Env;
    mode: "create" | "edit";
    schedule?: ScheduleRow;
    preset?: Partial<ScheduleRow>;
    onClose: () => void;
    onSaved: (scheduleId: string, created: boolean) => void;
}): React.ReactElement {
    const { env } = props;
    const src = props.schedule ?? props.preset;
    const [v, setV] = React.useState<Values>(() => ({
        date: src?.dateKey ?? env.todayKey,
        brandId: src?.brandId ?? "",
        accountId: src?.accountId ?? "",
        studioId: src?.studioId ?? "",
        hostId: src?.hostId ?? "",
        platform: src?.platform ?? "",
        shift: src?.shift ?? "",
        start: hhmm(src?.startMin ?? null),
        end: hhmm(src?.endMin ?? null),
        position: src?.position ?? "",
        sesi: src?.sesi ?? "",
        campaignName: src?.campaignName ?? "",
        liveBreak: !!src?.liveBreak && src.liveBreak.toLowerCase() === env.config.liveBreakYes.toLowerCase(),
        status: props.mode === "edit" ? props.schedule?.status || "Planned" : "Planned",
    }));
    const [acked, setAcked] = React.useState<Set<string>>(new Set());
    const [touched, setTouched] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");

    const set = (patch: Partial<Values>): void => setV((p) => ({ ...p, ...patch }));

    const accounts = env.accounts.filter((a) => v.brandId && a.brandId.toLowerCase() === v.brandId.toLowerCase());
    const pickBrand = (brandId: string): void => {
        const b = env.lk.brands.get(brandId.toLowerCase());
        set({ brandId, accountId: "", campaignName: v.campaignName || b?.namaBrand || "" });
    };
    const pickAccount = (accountId: string): void => {
        const a = env.lk.accounts.get(accountId.toLowerCase());
        set({ accountId, platform: a?.platform || v.platform });
    };

    const startMin = parseTimeToMinutes(v.start);
    let endMin = parseTimeToMinutes(v.end);
    const overnight = startMin !== null && endMin !== null && endMin < startMin;
    if (overnight && endMin !== null) endMin += 1440;

    const errors: Partial<Record<keyof Values, string>> = {};
    if (!v.date) errors.date = "Pilih tanggal.";
    if (!v.brandId) errors.brandId = "Pilih brand.";
    if (!v.studioId) errors.studioId = "Pilih studio.";
    if (!v.hostId) errors.hostId = "Pilih host.";
    if (startMin === null) errors.start = "Isi jam mulai.";
    if (endMin === null) errors.end = "Isi jam selesai.";
    else if (startMin !== null && endMin === startMin) errors.end = "Jam selesai harus berbeda dari jam mulai.";
    if (accounts.length > 0 && !v.accountId) errors.accountId = "Pilih account brand ini.";
    const valid = Object.keys(errors).length === 0;

    // Warnings: the checks v1 never ran. Each must be acknowledged before saving.
    const warnings = React.useMemo(() => {
        const out: { id: string; text: string; link?: ScheduleRow }[] = [];
        if (!valid) return out;
        const slot: Slot = { key: props.schedule?.key, dateKey: v.date, studioId: v.studioId, hostId: v.hostId, accountId: v.accountId, startMin, endMin, status: v.status };
        const pool = env.schedules.filter((s) => s.key !== props.schedule?.key);
        for (const c of conflictsFor(slot, pool, env.lk.studios, { host: (o) => o.hostName || o.hostId, studio: env.studioName })) {
            out.push({ id: `${c.kind}:${c.others.map((o) => o.key).join(",")}`, text: c.message, link: c.kind === "studio" ? undefined : c.others[0] });
        }
        const host = env.lk.hosts.get(v.hostId.toLowerCase());
        if (host && !host.isActive) out.push({ id: "host-inactive", text: `Host ${host.name} berstatus ${host.status}` });
        const studio = env.lk.studios.get(v.studioId.toLowerCase());
        if (studio && !studio.isActive) out.push({ id: "studio-inactive", text: `${studio.studioId} berstatus ${studio.status}` });
        const brand = env.lk.brands.get(v.brandId.toLowerCase());
        if (brand && !brand.isActive) out.push({ id: "brand-inactive", text: `Brand ${brand.namaBrand} berstatus ${brand.status}` });
        if (v.date < env.todayKey) out.push({ id: "past", text: "Tanggal sudah lewat — jadwal dibuat untuk masa lalu" });
        if (overnight) out.push({ id: "overnight", text: `Sesi melewati tengah malam (${v.start}–${v.end} esok hari)` });
        return out;
    }, [valid, v, startMin, endMin, overnight, env.schedules, env.lk, props.schedule?.key]);

    const allAcked = warnings.every((w) => acked.has(w.id));
    const jamLive = startMin !== null && endMin !== null ? Math.round(((endMin - startMin) / 60) * 100) / 100 : 0;

    const save = async (): Promise<void> => {
        setTouched(true);
        if (!valid || !allAcked) return;
        setSaving(true);
        setError("");
        const payload: Record<string, unknown> = {
            date: v.date,
            brandId: v.brandId,
            accountId: v.accountId,
            studioId: v.studioId,
            hostId: v.hostId,
            platform: v.platform,
            shift: v.shift,
            startTime: v.start,
            endTime: v.end,
            jamLive,
            position: v.position,
            sesi: v.sesi,
            campaignName: v.campaignName,
            liveBreak: v.liveBreak,
            liveBreakValue: v.liveBreak ? env.config.liveBreakYes : env.config.liveBreakNo,
            totalAccount: v.accountId ? 1 : 0,
            status: v.status,
            acknowledgedWarnings: warnings.map((w) => w.text),
        };
        if (props.mode === "edit") {
            payload.scheduleId = props.schedule?.scheduleId;
            payload.itemId = props.schedule?.itemId ?? null;
        }
        try {
            const r = await env.request(props.mode === "create" ? "CREATE_SCHEDULE" : "EDIT_SCHEDULE", payload);
            if (r.status === "ok") {
                const id = typeof r.data.scheduleId === "string" ? r.data.scheduleId : props.schedule?.scheduleId ?? "";
                props.onSaved(id, props.mode === "create");
            } else setError(r.message || "Gagal menyimpan jadwal.");
        } finally {
            setSaving(false);
        }
    };

    const err = (k: keyof Values): string | undefined => (touched ? errors[k] : undefined);
    const opt = (list: string[], cur: string): string[] => (cur && !list.some((x) => x.toLowerCase() === cur.toLowerCase()) ? [cur, ...list] : list);

    return (
        <Modal
            title={props.mode === "create" ? "Buat jadwal" : `Ubah jadwal ${props.schedule?.scheduleId ?? ""}`}
            width={760}
            onClose={saving ? () => undefined : props.onClose}
            footer={
                <>
                    {warnings.length > 0 && !allAcked && <span className="sc-foot-note">Centang semua peringatan untuk menyimpan</span>}
                    <Button variant="ghost" onClick={props.onClose} disabled={saving}>
                        Batal
                    </Button>
                    <Button variant="primary" disabled={saving || (touched && !valid) || !allAcked} onClick={() => void save()}>
                        {saving ? "Menyimpan…" : "Simpan"}
                    </Button>
                </>
            }
        >
            <div className="sc-formgrid">
                <Field label="Tanggal" htmlFor="f-date" hint={err("date")} hintTone="danger">
                    <input id="f-date" type="date" className={cx("sc-input", err("date") && "is-danger")} value={v.date} onChange={(e) => set({ date: e.target.value })} />
                </Field>
                <Field label="Studio" htmlFor="f-studio" hint={err("studioId") ?? capHint(env, v.studioId)} hintTone={err("studioId") ? "danger" : undefined}>
                    <select id="f-studio" className={cx("sc-input", err("studioId") && "is-danger")} value={v.studioId} onChange={(e) => set({ studioId: e.target.value })}>
                        <option value="">Pilih studio</option>
                        {env.studios.map((s) => (
                            <option key={s.key} value={s.studioId}>
                                {s.studioId}
                                {s.namaStudio ? ` · ${s.namaStudio}` : ""}
                                {!s.isActive ? " (nonaktif)" : ""}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Brand" htmlFor="f-brand" hint={err("brandId")} hintTone="danger">
                    <select id="f-brand" className={cx("sc-input", err("brandId") && "is-danger")} value={v.brandId} onChange={(e) => pickBrand(e.target.value)}>
                        <option value="">Pilih brand</option>
                        {env.brands.map((b) => (
                            <option key={b.key} value={b.brandId}>
                                {b.namaBrand} ({b.brandId}){!b.isActive ? " · nonaktif" : ""}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field
                    label="Account"
                    htmlFor="f-account"
                    hint={err("accountId") ?? (!v.brandId ? "Pilih brand dulu" : accounts.length === 0 ? "Brand ini belum punya account di master Account" : undefined)}
                    hintTone={err("accountId") ? "danger" : undefined}
                >
                    <select id="f-account" className={cx("sc-input", err("accountId") && "is-danger")} value={v.accountId} disabled={!v.brandId || accounts.length === 0} onChange={(e) => pickAccount(e.target.value)}>
                        <option value="">{!v.brandId ? "—" : "Pilih account"}</option>
                        {accounts.map((a) => (
                            <option key={a.key} value={a.accountId}>
                                {a.accountName}
                                {a.platform ? ` · ${a.platform}` : ""}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Host" htmlFor="f-host" hint={err("hostId")} hintTone="danger">
                    <select id="f-host" className={cx("sc-input", err("hostId") && "is-danger")} value={v.hostId} onChange={(e) => set({ hostId: e.target.value })}>
                        <option value="">Pilih host</option>
                        {env.hosts
                            .filter((h) => h.isActive || h.hostId === v.hostId)
                            .map((h) => (
                                <option key={h.key} value={h.hostId}>
                                    {h.name} ({h.hostId})
                                </option>
                            ))}
                    </select>
                </Field>
                <Field label="Platform" htmlFor="f-platform">
                    <select id="f-platform" className="sc-input" value={v.platform} onChange={(e) => set({ platform: e.target.value })}>
                        <option value="">—</option>
                        {opt(env.config.platforms, v.platform).map((p) => (
                            <option key={p}>{p}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Jam mulai" htmlFor="f-start" hint={err("start")} hintTone="danger">
                    <input id="f-start" type="time" step={900} className={cx("sc-input", err("start") && "is-danger")} value={v.start} onChange={(e) => set({ start: e.target.value })} />
                </Field>
                <Field label="Jam selesai" htmlFor="f-end" hint={err("end") ?? (jamLive > 0 ? `${jamLive.toLocaleString("id-ID")} jam live` : undefined)} hintTone={err("end") ? "danger" : undefined}>
                    <input id="f-end" type="time" step={900} className={cx("sc-input", err("end") && "is-danger")} value={v.end} onChange={(e) => set({ end: e.target.value })} />
                </Field>
                <Field label="Shift" htmlFor="f-shift">
                    <input id="f-shift" className="sc-input" list="sc-shifts" value={v.shift} onChange={(e) => set({ shift: e.target.value })} placeholder="mis. Pagi" />
                    <datalist id="sc-shifts">
                        {env.config.shifts.map((x) => (
                            <option key={x} value={x} />
                        ))}
                    </datalist>
                </Field>
                <Field label="Posisi" htmlFor="f-pos">
                    <input id="f-pos" className="sc-input" list="sc-positions" value={v.position} onChange={(e) => set({ position: e.target.value })} />
                    <datalist id="sc-positions">
                        {env.config.positions.map((x) => (
                            <option key={x} value={x} />
                        ))}
                    </datalist>
                </Field>
                <Field label="Sesi" htmlFor="f-sesi">
                    <input id="f-sesi" className="sc-input" value={v.sesi} onChange={(e) => set({ sesi: e.target.value })} placeholder="mis. 1" />
                </Field>
                {props.mode === "edit" ? (
                    <Field label="Status" htmlFor="f-status">
                        <select id="f-status" className="sc-input" value={v.status} onChange={(e) => set({ status: e.target.value })}>
                            {opt(env.config.statuses, v.status).map((x) => (
                                <option key={x} value={x}>
                                    {scheduleStatus(x).label} ({x})
                                </option>
                            ))}
                        </select>
                    </Field>
                ) : (
                    <div className="sc-field sc-field--toggle">
                        <Toggle checked={v.liveBreak} onChange={(b) => set({ liveBreak: b })} label="Live break" description="Ada jeda di tengah sesi" />
                    </div>
                )}
                {props.mode === "edit" && (
                    <div className="sc-field sc-field--toggle sc-formgrid__full">
                        <Toggle checked={v.liveBreak} onChange={(b) => set({ liveBreak: b })} label="Live break" description="Ada jeda di tengah sesi" />
                    </div>
                )}
                <div className="sc-formgrid__full">
                    <Field label="Campaign name" htmlFor="f-camp">
                        <textarea id="f-camp" className="sc-input" rows={2} value={v.campaignName} onChange={(e) => set({ campaignName: e.target.value })} />
                    </Field>
                </div>
            </div>

            {warnings.length > 0 && (
                <div className="sc-warnings" role="group" aria-label="Peringatan jadwal">
                    {warnings.map((w) => (
                        <label key={w.id} className={cx("sc-warning", acked.has(w.id) && "is-acked")}>
                            <span className="sc-warning__icon">{Icon.warn(16)}</span>
                            <span className="sc-warning__text">
                                {w.text}
                                {w.link && (
                                    <>
                                        {" "}
                                        <span className="sc-muted">[{w.link.scheduleId}]</span>
                                    </>
                                )}
                            </span>
                            <span className="sc-warning__ack">
                                <input
                                    type="checkbox"
                                    checked={acked.has(w.id)}
                                    onChange={(e) =>
                                        setAcked((p) => {
                                            const n = new Set(p);
                                            if (e.target.checked) n.add(w.id);
                                            else n.delete(w.id);
                                            return n;
                                        })
                                    }
                                />
                                Tetap simpan
                            </span>
                        </label>
                    ))}
                </div>
            )}
            {error && <Banner tone="danger">{error}</Banner>}
        </Modal>
    );
}

function capHint(env: Env, studioId: string): string | undefined {
    const s = env.lk.studios.get(studioId.toLowerCase());
    return s ? `Kapasitas ${Math.max(1, s.kapasitasHost || 1)} host bersamaan` : undefined;
}
