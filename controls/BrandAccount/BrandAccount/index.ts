import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { BrandAccountView } from "./BrandAccountView";

interface ShellProps {
  contextJson: string | null;
  brands: Row[];
  accounts: Row[];
  brandId: string;
  loading: boolean;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "ba");
  return React.createElement(BrandAccountView, { ...p, ctx, action });
}

export class BrandAccount implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        brands: this.cache.get("b", p.BrandsJson?.raw),
        accounts: this.cache.get("a", p.AccountsJson?.raw),
        brandId: (p.BrandId?.raw ?? "").trim(),
        loading: flag(p.IsLoading),
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
