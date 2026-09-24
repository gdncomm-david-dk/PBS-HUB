import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { MyReportsView } from "./MyReportsView";

interface ShellProps {
  contextJson: string | null;
  period: string;
  defaultFilter: string;
  reports: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  brands: Row[];
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hr");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.reports]);
  return React.createElement(MyReportsView, { ...p, ctx, now, action });
}

export class MyReports implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost("hc");
  private cache = new RowsCache();

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        period: p.Period?.raw ?? "",
        defaultFilter: p.DefaultFilter?.raw ?? "",
        reports: this.cache.get("r", p.ReportsJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        absences: this.cache.get("a", p.AbsenceJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        hasMore: flag(p.HasMore),
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
