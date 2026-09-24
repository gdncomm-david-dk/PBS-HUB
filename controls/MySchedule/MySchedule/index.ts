import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { MyScheduleView } from "./MyScheduleView";

interface ShellProps {
  contextJson: string | null;
  period: string;
  defaultFilter: string;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  brands: Row[];
  studios: Row[];
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  minute: number;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hs");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.minute]);
  return React.createElement(MyScheduleView, { ...p, ctx, now, action });
}

export class MySchedule implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost("hc");
  private cache = new RowsCache();
  private tick: ReturnType<typeof setInterval> | null = null;
  private context: ComponentFramework.Context<IInputs> | null = null;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
    // Statuses (Segera mulai, Sedang live, Belum report) move with the clock.
    this.tick = setInterval(() => this.context && this.updateView(this.context), 60000);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    const p = context.parameters;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        period: p.Period?.raw ?? "",
        defaultFilter: p.DefaultFilter?.raw ?? "",
        host: this.cache.get("h", p.HostJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        absences: this.cache.get("a", p.AbsenceJson?.raw),
        reports: this.cache.get("r", p.ReportsJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        studios: this.cache.get("st", p.StudiosJson?.raw),
        hasMore: flag(p.HasMore),
        loading: flag(p.IsLoading),
        referenceDate: p.ReferenceDate?.raw ?? null,
        minute: Math.floor(Date.now() / 60000),
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
    if (this.tick) clearInterval(this.tick);
    this.host.destroy();
  }
}
