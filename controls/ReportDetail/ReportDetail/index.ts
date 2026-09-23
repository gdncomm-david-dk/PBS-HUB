import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, modeOf, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { ReportDetailView } from "./ReportDetailView";

interface ShellProps {
  contextJson: string | null;
  reports: Row[];
  evidence: Row[];
  brands: Row[];
  hosts: Row[];
  readOnly: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "rd");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.reports]);
  return React.createElement(ReportDetailView, { ...p, ctx, now, action });
}

export class ReportDetail implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        reports: this.cache.get("r", p.ReportJson?.raw),
        evidence: this.cache.get("e", p.EvidenceJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        hosts: this.cache.get("h", p.HostsJson?.raw),
        readOnly: modeOf(p.Mode as { raw: string | null }) === "ReadOnly",
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
