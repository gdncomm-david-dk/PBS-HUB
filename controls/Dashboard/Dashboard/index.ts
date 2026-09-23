import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { DashboardData, DashboardView } from "./DashboardView";

interface ShellProps {
  contextJson: string | null;
  data: DashboardData;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const { fire } = useAction(p.emit, p.actionResult, "dash");
  const ref = React.useMemo(() => {
    if (!p.referenceDate) return null;
    const d = new Date(p.referenceDate);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [p.referenceDate]);
  return React.createElement(DashboardView, { ctx, data: p.data, loading: p.loading, referenceNow: ref, fire });
}

export class Dashboard implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost();
  private cache = new RowsCache();
  private data: DashboardData | null = null;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const next: DashboardData = {
      schedules: this.cache.get("s", p.SchedulesJson?.raw),
      reports: this.cache.get("r", p.ReportsJson?.raw),
      evidence: this.cache.get("e", p.EvidenceJson?.raw),
      clockIns: this.cache.get("c", p.ClockInJson?.raw),
      hosts: this.cache.get("h", p.HostsJson?.raw),
      studios: this.cache.get("st", p.StudiosJson?.raw),
      brands: this.cache.get("b", p.BrandsJson?.raw),
      payrolls: this.cache.get("p", p.PayrollJson?.raw),
    };
    // Keep the same object while nothing changed, so the aggregation memo is not recomputed.
    const same = this.data && (Object.keys(next) as (keyof DashboardData)[]).every((k) => this.data?.[k] === next[k]);
    if (!same) this.data = next;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        data: this.data as DashboardData,
        loading: flag(p.IsLoading),
        referenceDate: p.ReferenceDate?.raw ?? null,
        actionResult: p.ActionResult?.raw ?? null,
        emit: this.host.emit,
      }),
      context.mode.allocatedWidth,
      context.mode.allocatedHeight,
    );
  }

  public getOutputs(): IOutputs {
    return { ActionPayload: this.host.output };
  }

  public destroy(): void {
    this.host.destroy();
  }
}
