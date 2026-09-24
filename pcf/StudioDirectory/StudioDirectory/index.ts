import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
    BRAND_NAME_COLS,
    buildNameMap,
    HOST_NAME_COLS,
    isLoading,
    mapLocations,
    mapReports,
    mapSchedules,
    mapStudios,
    parseContext,
    pickSource,
    sourceColumns,
} from "./core/data";
import { ActionName, ActionResult } from "./core/types";
import { LatLon } from "./core/geo";
import { App, AppProps } from "./ui/App";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 20k rows per dataset; beyond that the canvas filter is too wide

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

export class StudioHub implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private root: Root;
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private actionPayload = "";
    private selectedStudioId = "";
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
        this.selectedStudioId = context.parameters.SelectedStudioId?.raw ?? "";
        for (const ds of this.datasets(context)) {
            try {
                ds.paging?.setPageSize?.(PAGE_SIZE);
            } catch {
                // Not every host supports setPageSize.
            }
        }
        this.root = createRoot(container);
    }

    private datasets(context: ComponentFramework.Context<IInputs>): DataSet[] {
        const p = context.parameters;
        return [p.studios, p.locations, p.schedules, p.brands, p.hosts, p.reports].filter((d): d is DataSet => !!d);
    }

    /** Pull every page so utilization is computed over the whole filtered period, not the first page. */
    private loadAllPages(name: string, ds: DataSet | undefined): void {
        if (!ds) return;
        // A shrinking record count means canvas re-queried (filter changed): start counting pages again.
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

        this.loadAllPages("studios", p.studios);
        this.loadAllPages("locations", p.locations);
        this.loadAllPages("schedules", p.schedules);
        this.loadAllPages("brands", p.brands);
        this.loadAllPages("hosts", p.hosts);
        this.loadAllPages("reports", p.reports);

        const brandNames = buildNameMap(pickSource(p.brands, p.BrandsJson?.raw), BRAND_NAME_COLS);
        const hostNames = buildNameMap(pickSource(p.hosts, p.HostsJson?.raw), HOST_NAME_COLS);

        const rawResult = p.ActionResult?.raw ?? "";
        if (rawResult !== this.lastActionResultRaw) {
            this.lastActionResultRaw = rawResult;
            this.lastActionResult = parseActionResult(rawResult);
        }

        const inSelected = p.SelectedStudioId?.raw ?? "";
        const opStart = clampHour(p.OperatingHourStart?.raw, 8, 0, 23);
        const opEnd = Math.max(opStart + 1, clampHour(p.OperatingHourEnd?.raw, 22, 1, 24));

        const pagingMore = (name: string, ds: DataSet | undefined, json: string | null | undefined): boolean =>
            isLoading(ds, json) || (!json?.trim() && !!ds?.paging?.hasNextPage && (this.pagesRequested[name] ?? 0) < MAX_PAGES);

        const props: AppProps = {
            studios: mapStudios(pickSource(p.studios, p.StudiosJson?.raw)),
            locations: mapLocations(pickSource(p.locations, p.LocationsJson?.raw)),
            schedules: mapSchedules(pickSource(p.schedules, p.SchedulesJson?.raw), brandNames, hostNames),
            reports: mapReports(pickSource(p.reports, p.ReportsJson?.raw)),
            sources: {
                studios: sourceColumns(p.studios, p.StudiosJson?.raw),
                locations: sourceColumns(p.locations, p.LocationsJson?.raw),
                schedules: sourceColumns(p.schedules, p.SchedulesJson?.raw),
            },
            loading: {
                studios: pagingMore("studios", p.studios, p.StudiosJson?.raw),
                locations: isLoading(p.locations, p.LocationsJson?.raw),
                schedules: pagingMore("schedules", p.schedules, p.SchedulesJson?.raw),
                reports: pagingMore("reports", p.reports, p.ReportsJson?.raw),
            },
            ctx: parseContext(p.Context?.raw),
            mode: p.Mode?.raw === "ReadOnly" ? "ReadOnly" : "Admin",
            actionResult: this.lastActionResult,
            op: { startMin: opStart * 60, endMin: opEnd * 60 },
            selectedStudioId: inSelected,
            height: context.mode.allocatedHeight > 0 ? context.mode.allocatedHeight : 0,
            emit: this.emit,
            onSelectStudio: this.onSelectStudio,
            getPosition: this.getPosition,
        };
        this.root.render(React.createElement(App, props));
    }

    private emit = (action: ActionName, payload: Record<string, unknown>): string => {
        const requestId = uuid();
        this.actionPayload = JSON.stringify({ action, requestId, payload });
        this.notifyOutputChanged();
        return requestId;
    };

    private onSelectStudio = (studioId: string): void => {
        if (studioId === this.selectedStudioId) return;
        this.selectedStudioId = studioId;
        this.notifyOutputChanged();
    };

    private getPosition = (): Promise<LatLon> => {
        const device = this.context?.device as unknown as { getCurrentPosition?: () => Promise<{ coords: { latitude: number; longitude: number } }> };
        const viaBrowser = (): Promise<LatLon> =>
            new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error("no geolocation"));
                    return;
                }
                navigator.geolocation.getCurrentPosition(
                    (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                    reject,
                    { enableHighAccuracy: true, timeout: 15000 },
                );
            });
        if (device && typeof device.getCurrentPosition === "function") {
            return device
                .getCurrentPosition()
                .then((pos) => ({ lat: pos.coords.latitude, lon: pos.coords.longitude }))
                .catch(viaBrowser);
        }
        return viaBrowser();
    };

    public getOutputs(): IOutputs {
        return {
            ActionPayload: this.actionPayload,
            SelectedStudioId: this.selectedStudioId,
        };
    }

    public destroy(): void {
        this.root?.unmount();
    }
}

function clampHour(v: number | null | undefined, fallback: number, min: number, max: number): number {
    if (v === null || v === undefined || !isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
}
