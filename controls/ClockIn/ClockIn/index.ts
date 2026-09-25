import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { ClockInView } from "./ClockInView";

interface ShellProps {
  contextJson: string | null;
  host: Row[];
  locations: Row[];
  clockIns: Row[];
  schedules: Row[];
  reports: Row[];
  canvasLocation: Row[];
  loading: boolean;
  referenceDate: string | null;
  minute: number;
  actionResult: string | null;
  emitWithUpload: (json: string, data: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  // The selfie rides on UploadData with exactly the one emit that needs it, then clears.
  const upload = React.useRef("");
  const { emitWithUpload } = p;
  const emit = React.useCallback(
    (json: string) => {
      emitWithUpload(json, upload.current);
      upload.current = "";
    },
    [emitWithUpload],
  );
  const setUpload = React.useCallback((data: string) => {
    upload.current = data;
  }, []);
  const action = useAction(emit, p.actionResult, "hk");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.minute]);
  const { referenceDate } = p;
  const clock = React.useCallback(() => referenceNow(referenceDate), [referenceDate]);
  return React.createElement(ClockInView, { ...p, ctx, now, clock, action, setUpload });
}

export class ClockIn implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost("hc");
  private cache = new RowsCache();
  private tick: ReturnType<typeof setInterval> | null = null;
  private context: ComponentFramework.Context<IInputs> | null = null;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
    // The shift timer and the 5-minute position limit move with the clock.
    this.tick = setInterval(() => this.context && this.updateView(this.context), 30000);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    const p = context.parameters;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        host: this.cache.get("h", p.HostJson?.raw),
        locations: this.cache.get("l", p.LocationsJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        reports: this.cache.get("r", p.ReportsJson?.raw),
        canvasLocation: this.cache.get("g", p.DeviceLocationJson?.raw),
        loading: flag(p.IsLoading),
        referenceDate: p.ReferenceDate?.raw ?? null,
        minute: Math.floor(Date.now() / 30000),
        actionResult: p.ActionResult?.raw ?? null,
        emitWithUpload: this.host.emitWithUpload,
      }),
      context.mode.allocatedWidth,
      context.mode.allocatedHeight,
    );
  }

  public getOutputs(): IOutputs {
    return { ActionPayload: this.host.output, UploadData: this.host.uploadData };
  }

  public destroy(): void {
    if (this.tick) clearInterval(this.tick);
    this.host.destroy();
  }
}
