import * as React from "react";
import { ActionName, ActionResult, AccountRow, BrandRow, HostRow, ScheduleRow, StudioRow } from "../core/types";
import { Lookups } from "../core/data";
import { Conflict, Evidence } from "../core/schedule";
import { Badge, Tone } from "./components";

/** Schedule.Status values (DESIGN.md) to Bahasa Indonesia labels and tones. Unknown values render verbatim. */
export function scheduleStatus(status: string): { label: string; tone: Tone; chip: string } {
    const l = status.toLowerCase();
    if (!l) return { label: "—", tone: "neutral", chip: "planned" };
    if (l === "planned") return { label: "Terjadwal", tone: "info", chip: "planned" };
    if (l === "done" || l === "finished") return { label: "Selesai", tone: "success", chip: "done" };
    if (l === "waiting report") return { label: "Menunggu report", tone: "warning", chip: "waiting" };
    if (l.includes("cancel")) return { label: "Dibatalkan", tone: "neutral", chip: "off" };
    if (l === "leave") return { label: "Cuti", tone: "neutral", chip: "off" };
    return { label: status, tone: "neutral", chip: "planned" };
}

export function StatusBadge(props: { status: string }): React.ReactElement {
    const s = scheduleStatus(props.status);
    return <Badge tone={s.tone}>{s.label}</Badge>;
}

export interface Config {
    platforms: string[];
    statuses: string[];
    maxUploadMb: number;
    aiAccept: string;
    bulkFolder: string;
    aiFolder: string;
    bulkTable: string;
    templateUrl: string;
    /** "control": files are picked, checked and sent by the control. "canvas": the buttons only emit
     *  OPEN_UPLOAD and the app opens its own Attachments popup (the Graph PUT with ThisRecord.Value). */
    uploadMode: "control" | "canvas";
}

export interface Pending {
    requestId: string;
    action: ActionName;
}

export interface Env {
    schedules: ScheduleRow[];
    brands: BrandRow[];
    hosts: HostRow[];
    studios: StudioRow[];
    accounts: AccountRow[];
    lk: Lookups;
    ev: Evidence;
    conflicts: Map<string, Conflict[]>;
    now: Date;
    todayKey: string;
    canEdit: boolean;
    pending: Pending | null;
    loading: boolean;
    config: Config;
    studioName: (id: string) => string;
    /** Emit an action and wait for the canvas reply with the same requestId. */
    request: (action: ActionName, payload: Record<string, unknown>, timeoutMs?: number) => Promise<ActionResult>;
    emit: (action: ActionName, payload: Record<string, unknown>) => void;
    open: (s: ScheduleRow | null) => void;
    notify: (tone: "success" | "danger" | "warning", text: string) => void;
}

export const hostLabel = (lk: Lookups, id: string): string => lk.hosts.get(id.toLowerCase())?.name || id;

/** Shown when an upload got no reply in time: the file usually did arrive, the canvas just never confirmed it. */
export const UNCONFIRMED = "File sudah dikirim, tetapi aplikasi belum membalas. Cek folder SharePoint / list Schedule sebelum mengunggah ulang.";
