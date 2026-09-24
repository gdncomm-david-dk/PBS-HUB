import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { ScheduleDetailView } from "./ScheduleDetailView";

interface ShellProps {
  contextJson: string | null;
  scheduleId: string;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  evidence: Row[];
  history: Row[];
  brands: Row[];
  studios: Row[];
  loading: boolean;
  referenceDate: string | null;
  minute: number;
  actionResult: string | null;
  emitWithUpload: (json: string, data: string) => void;
}

function Shell(p: ShellProps): React.ReactElement {
  const ctx = React.useMemo(() => parseContext(p.contextJson), [p.contextJson]);
  // The screenshot rides on UploadData with exactly the one emit that needs it, then clears.
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
  const action = useAction(emit, p.actionResult, "hsd");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.minute]);
  return React.createElement(ScheduleDetailView, { ...p, ctx, now, action, setUpload });
}

export class ScheduleDetail implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private host = new ReactHost("hc");
  private cache = new RowsCache();
  private tick: ReturnType<typeof setInterval> | null = null;
  private context: ComponentFramework.Context<IInputs> | null = null;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.host.init(container, notifyOutputChanged, (v) => context.mode.trackContainerResize(v));
    // The next step (absen opens, sesi live, report late) moves with the clock.
    this.tick = setInterval(() => this.context && this.updateView(this.context), 60000);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    const p = context.parameters;
    this.host.render(
      React.createElement(Shell, {
        contextJson: p.Context?.raw ?? null,
        scheduleId: p.ScheduleId?.raw ?? "",
        host: this.cache.get("h", p.HostJson?.raw),
        schedules: this.cache.get("s", p.SchedulesJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        absences: this.cache.get("a", p.AbsenceJson?.raw),
        reports: this.cache.get("r", p.ReportsJson?.raw),
        evidence: this.cache.get("e", p.EvidenceJson?.raw),
        history: this.cache.get("hi", p.HistoryJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        studios: this.cache.get("st", p.StudiosJson?.raw),
        loading: flag(p.IsLoading),
        referenceDate: p.ReferenceDate?.raw ?? null,
        minute: Math.floor(Date.now() / 60000),
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
