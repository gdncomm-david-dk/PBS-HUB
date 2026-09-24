import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { HostDetailView, HostTab } from "./HostDetailView";

interface ShellProps {
  contextJson: string | null;
  host: Row[];
  schedules: Row[];
  reports: Row[];
  clockIns: Row[];
  lines: Row[];
  runs: Row[];
  txs: Row[];
  thresholds: Row[];
  brands: Row[];
  studios: Row[];
  revealed: Row[];
  defaultTab: HostTab;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hd");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.host]);
  return React.createElement(HostDetailView, { ...p, ctx, now, action });
}

const TABS: HostTab[] = ["Summary", "Schedule", "Attendance", "Reports", "Payroll", "Personal"];
const tabOf = (raw: string | null | undefined): HostTab => (TABS.includes(raw as HostTab) ? (raw as HostTab) : "Summary");

export class HostDetail implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost();
  private cache = new RowsCache();

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        host: this.cache.get("h", p.HostJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        reports: this.cache.get("r", p.ReportsJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        lines: this.cache.get("l", p.PayrollDataJson?.raw),
        runs: this.cache.get("p", p.PayrollJson?.raw),
        txs: this.cache.get("x", p.ScoreTxJson?.raw),
        thresholds: this.cache.get("t", p.ThresholdsJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        studios: this.cache.get("st", p.StudiosJson?.raw),
        revealed: this.cache.get("v", p.RevealedJson?.raw),
        defaultTab: tabOf(p.DefaultTab?.raw as string | null | undefined),
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
