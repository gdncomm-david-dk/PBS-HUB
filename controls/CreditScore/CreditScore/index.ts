import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { CreditScoreView } from "./CreditScoreView";

interface ShellProps {
  contextJson: string | null;
  host: Row[];
  txs: Row[];
  thresholds: Row[];
  rules: Row[];
  period: string;
  defaultFilter: string;
  hasMore: boolean;
  loading: boolean;
  referenceDate: string | null;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hs");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.txs]);
  return React.createElement(CreditScoreView, { ...p, ctx, now, action });
}

export class CreditScore implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        host: this.cache.get("h", p.HostJson?.raw),
        txs: this.cache.get("x", p.ScoreTxJson?.raw),
        thresholds: this.cache.get("t", p.ThresholdsJson?.raw),
        rules: this.cache.get("r", p.RulesJson?.raw),
        period: p.Period?.raw ?? "",
        defaultFilter: p.DefaultFilter?.raw ?? "",
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
