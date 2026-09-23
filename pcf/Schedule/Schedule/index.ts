import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
    buildLookups,
    isLoading,
    mapAbsences,
    mapAccounts,
    mapBrands,
    mapClockIns,
    mapEvidence,
    mapHosts,
    mapReports,
    mapSchedules,
    mapStudios,
    parseContext,
    pickSource,
} from "./core/data";
import { ActionName, ActionResult } from "./core/types";
import { App, AppProps } from "./ui/App";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 20k rows per dataset; beyond that the canvas filter is too wide

const DATASETS = ["schedules", "brands", "accounts", "studios", "hosts", "reports", "absences", "clockins", "evidence"] as const;
type DsName = (typeof DATASETS)[number];

function uuid(): string {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

function parseActionResult(raw: string | null | undefined): ActionResult | null {
    if (!raw || !raw.trim()) return null;
    try {
        const o = JSON.parse(raw) as Record<string, unknown>;
        if (!o || typeof o !== "object" || typeof o.requestId !== "string") return null;
        const status = String(o.status).toLowerCase() === "ok" ? "ok" : "error";
        const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : {};
        return { requestId: o.requestId, status, message: typeof o.message === "string" ? o.message : "", data };
    } catch {
        return null;
    }
}

export class Schedule implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private root: Root;
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private actionPayload = "";
    private selectedScheduleId = "";
    private pagesRequested: Record<string, number> = {};
    private lastCount: Record<string, number> = {};
    private lastActionResultRaw = "";
    private lastActionResult: ActionResult | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        context.mode.trackContainerResize(true);
        this.selectedScheduleId = context.parameters.SelectedScheduleId?.raw ?? "";
        for (const name of DATASETS) {
            try {
                this.ds(context, name)?.paging?.setPageSize?.(PAGE_SIZE);
            } catch {
                // Not every host supports setPageSize.
            }
        }
        this.root = createRoot(container);
    }

    private ds(context: ComponentFramework.Context<IInputs>, name: DsName): DataSet | undefined {
        return (context.parameters as unknown as Record<string, DataSet | undefined>)[name];
    }

    private json(context: ComponentFramework.Context<IInputs>, name: DsName): string {
        const key = name === "clockins" ? "ClockInsJson" : name.charAt(0).toUpperCase() + name.slice(1) + "Json";
        const p = (context.parameters as unknown as Record<string, { raw?: string | null } | undefined>)[key];
        return p?.raw ?? "";
    }

    /** Pull every page so conflicts are computed over the whole period, not the first page. */
    private loadAllPages(name: string, ds: DataSet | undefined): void {
        if (!ds) return;
        const count = ds.sortedRecordIds?.length ?? 0;
        if (count < (this.lastCount[name] ?? 0)) this.pagesRequested[name] = 0;
        this.lastCount[name] = count;
        if (ds.loading || !ds.paging?.hasNextPage) return;
        const n = this.pagesRequested[name] ?? 0;
        if (n >= MAX_PAGES) return;
        this.pagesRequested[name] = n + 1;
        ds.paging.loadNextPage();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        const p = context.parameters;
        for (const name of DATASETS) if (!this.json(context, name).trim()) this.loadAllPages(name, this.ds(context, name));

        const src = (name: DsName) => pickSource(this.ds(context, name), this.json(context, name));
        const brands = mapBrands(src("brands"));
        const hosts = mapHosts(src("hosts"));
        const studios = mapStudios(src("studios"));
        const accounts = mapAccounts(src("accounts"));
        const lk = buildLookups(brands, hosts, studios, accounts);

        const rawResult = p.ActionResult?.raw ?? "";
        if (rawResult !== this.lastActionResultRaw) {
            this.lastActionResultRaw = rawResult;
            this.lastActionResult = parseActionResult(rawResult);
        }

        const pagingMore = (name: DsName): boolean => {
            const ds = this.ds(context, name);
            const json = this.json(context, name);
            return isLoading(ds, json) || (!json.trim() && !!ds?.paging?.hasNextPage && (this.pagesRequested[name] ?? 0) < MAX_PAGES);
        };

        const props: AppProps = {
            schedules: mapSchedules(src("schedules"), lk),
            brands,
            hosts,
            studios,
            accounts,
            reports: mapReports(src("reports")),
            absences: mapAbsences(src("absences")),
            clocks: mapClockIns(src("clockins")),
            evidence: mapEvidence(src("evidence")),
            loading: pagingMore("schedules") || pagingMore("studios"),
            ctx: parseContext(p.Context?.raw),
            mode: p.Mode?.raw === "ReadOnly" ? "ReadOnly" : "Admin",
            actionResult: this.lastActionResult,
            selectedScheduleId: p.SelectedScheduleId?.raw ?? "",
            height: context.mode.allocatedHeight > 0 ? context.mode.allocatedHeight : 0,
            emit: this.emit,
            onSelect: this.onSelect,
        };
        this.root.render(React.createElement(App, props));
    }

    private emit = (action: ActionName, payload: Record<string, unknown>): string => {
        const requestId = uuid();
        this.actionPayload = JSON.stringify({ action, requestId, payload });
        this.notifyOutputChanged();
        return requestId;
    };

    private onSelect = (scheduleId: string): void => {
        if (scheduleId === this.selectedScheduleId) return;
        this.selectedScheduleId = scheduleId;
        this.notifyOutputChanged();
    };

    public getOutputs(): IOutputs {
        return {
            ActionPayload: this.actionPayload,
            SelectedScheduleId: this.selectedScheduleId,
        };
    }

    public destroy(): void {
        this.root?.unmount();
    }
}
