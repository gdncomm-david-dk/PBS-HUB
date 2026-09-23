import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, modeOf, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { ReportReviewView, Tab } from "./ReportReviewView";

interface ShellProps {
  contextJson: string | null;
  reports: Row[];
  evidence: Row[];
  brands: Row[];
  hosts: Row[];
  defaultTab: Tab;
  readOnly: boolean;
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "rr");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.reports]);
  return React.createElement(ReportReviewView, { ...p, ctx, now, action });
}

const TABS: Tab[] = ["Waiting", "Revision", "Done", "All"];

export class ReportReview implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost();
  private cache = new RowsCache();

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const tabRaw = p.DefaultTab?.raw as string | null | undefined;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        reports: this.cache.get("r", p.ReportsJson?.raw),
        evidence: this.cache.get("e", p.EvidenceJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        hosts: this.cache.get("h", p.HostsJson?.raw),
        defaultTab: TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "Waiting",
        readOnly: modeOf(p.Mode as { raw: string | null }) === "ReadOnly",
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
