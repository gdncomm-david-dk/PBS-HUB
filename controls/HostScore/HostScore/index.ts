import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { HostScoreView } from "./HostScoreView";

interface ShellProps {
  contextJson: string | null;
  hosts: Row[];
  recent: Row[];
  ledger: Row[];
  rules: Row[];
  thresholds: Row[];
  hostId: string;
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "sc");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.hosts, p.ledger]);
  return React.createElement(HostScoreView, { ...p, ctx, now, action });
}

export class HostScore implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        recent: this.cache.get("r", p.ScoreTxJson?.raw),
        ledger: this.cache.get("l", p.LedgerJson?.raw),
        rules: this.cache.get("u", p.RulesJson?.raw),
        thresholds: this.cache.get("t", p.ThresholdsJson?.raw),
        hostId: (p.HostId?.raw ?? "").trim(),
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
