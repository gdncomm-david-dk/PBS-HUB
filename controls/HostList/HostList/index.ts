import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { HostListView } from "./HostListView";

interface ShellProps {
  contextJson: string | null;
  hosts: Row[];
  thresholds: Row[];
  schedules: Row[];
  clockIns: Row[];
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hl");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.hosts]);
  return React.createElement(HostListView, { ...p, ctx, now, action });
}

export class HostList implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        hosts: this.cache.get("h", p.HostsJson?.raw),
        thresholds: this.cache.get("t", p.ThresholdsJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
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
