import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { HostFormView } from "./HostFormView";

interface ShellProps {
  contextJson: string | null;
  host: Row[];
  hosts: Row[];
  packages: Row[];
  loading: boolean;
  actionResult: string | null;
  emit: (json: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  const action = useAction(p.emit, p.actionResult, "hf");
  return React.createElement(HostFormView, { ...p, ctx, action });
}

export class HostForm implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        hosts: this.cache.get("hs", p.HostsJson?.raw),
        packages: this.cache.get("p", p.PackagesJson?.raw),
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
