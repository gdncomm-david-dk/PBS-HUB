import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { DetailTab, PayrollRunDetailView } from "./PayrollRunDetailView";

interface ShellProps {
  contextJson: string | null;
  runs: Row[];
  lines: Row[];
  clockIns: Row[];
  slips: Row[];
  defaultTab: DetailTab;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "pd");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.runs]);
  return React.createElement(PayrollRunDetailView, { ...p, ctx, now, action });
}

const tabOf = (raw: string | null | undefined): DetailTab => (raw === "Approval" || raw === "Payslip" ? raw : "Lines");

export class PayrollRunDetail implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        runs: this.cache.get("p", p.PayrollJson?.raw),
        lines: this.cache.get("l", p.PayrollDataJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        slips: this.cache.get("s", p.PayslipJson?.raw),
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
