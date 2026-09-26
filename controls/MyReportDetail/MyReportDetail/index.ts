import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ReactHost, flag, referenceNow } from "../../../shared/mount";
import { RowsCache } from "../../../shared/cache";
import { parseContext, useAction } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { parsePlaybooks } from "../../../shared/hostApp";
import { MyReportDetailView } from "./MyReportDetailView";

interface ShellProps {
  contextJson: string | null;
  host: Row[];
  report: Row[];
  schedule: Row[];
  evidence: Row[];
  clockIns: Row[];
  absences: Row[];
  history: Row[];
  brands: Row[];
  studios: Row[];
  sessionReports: Row[];
  playbooks: string[];
  loading: boolean;
  referenceDate: string | null;
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
  const action = useAction(emit, p.actionResult, "hd");
  const now = React.useMemo(() => referenceNow(p.referenceDate), [p.referenceDate, p.report, p.schedule]);
  return React.createElement(MyReportDetailView, { ...p, ctx, now, action, setUpload });
}

export class MyReportDetail implements ComponentFramework.StandardControl<IInputs, IOutputs> {
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
        report: this.cache.get("r", p.ReportJson?.raw),
        schedule: this.cache.get("s", p.ScheduleJson?.raw),
        evidence: this.cache.get("e", p.EvidenceJson?.raw),
        clockIns: this.cache.get("c", p.ClockInJson?.raw),
        absences: this.cache.get("a", p.AbsenceJson?.raw),
        history: this.cache.get("hi", p.HistoryJson?.raw),
        brands: this.cache.get("b", p.BrandsJson?.raw),
        studios: this.cache.get("st", p.StudiosJson?.raw),
        sessionReports: this.cache.get("sr", p.SessionReportsJson?.raw),
        playbooks: parsePlaybooks(p.PlaybooksJson?.raw),
        loading: flag(p.IsLoading),
        referenceDate: p.ReferenceDate?.raw ?? null,
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
    this.host.destroy();
  }
}
