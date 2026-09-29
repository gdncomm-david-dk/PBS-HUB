import * as React from "react";
import { UseActionResult } from "./contract";
import { Row, date, localDayKey, reportScheduleId, rowId, str } from "./data";
import { Button, Icon, InfoBanner, Overlay, Spinner } from "./ui";

/**
 * Delete a wrong report (DELETE_REPORT). Ops deletes any report; the host only their own report that
 * is not matched yet. Canvas removes the Report row and its Report Automation rows, syncs reportFiltered and, when given,
 * writes scheduleStatus to Schedule.Status.
 */

export const DELETE_MIN_REASON = 5;

export function DeleteReportCard(props: {
  report: Row;
  action: UseActionResult;
  /** Shown under the title: who may delete and what happens. */
  text: string;
  /** Extra payload, e.g. scheduleStatus from the host app. */
  extra?: Record<string, unknown>;
  deletedBy?: string;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const res = props.action.lastResult;
  const deleted = res?.action === "DELETE_REPORT" && res.status === "ok";
  if (deleted) {
    return (
      <InfoBanner icon="check">
        Report {str(props.report, "Title")} dihapus.
      </InfoBanner>
    );
  }
  return (
    <div className={props.className ?? "pbs-card pbs-card-pad"}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700 }}>Hapus report</div>
          <div className="pbs-muted" style={{ fontSize: 12.5 }}>
            {props.text}
          </div>
        </div>
        <Button
          variant="danger"
          onClick={() => setOpen(true)}
          disabled={!!props.action.pending}
        >
          <Icon name="trash" size={14} /> Delete Report
        </Button>
      </div>
      {open ? (
        <DeleteReportModal
          report={props.report}
          action={props.action}
          extra={props.extra}
          deletedBy={props.deletedBy}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DeleteReportModal(props: {
  report: Row;
  action: UseActionResult;
  extra?: Record<string, unknown>;
  deletedBy?: string;
  onClose: () => void;
}): React.ReactElement {
  const { action, report } = props;
  const [reason, setReason] = React.useState("");
  const pending = action.pending?.action === "DELETE_REPORT";
  const res = action.lastResult;
  React.useEffect(() => {
    if (res?.action === "DELETE_REPORT" && res.status === "ok") props.onClose();
  }, [res]);
  const failed = res?.action === "DELETE_REPORT" && res.status !== "ok";
  const ok = reason.trim().length >= DELETE_MIN_REASON;
  const title = str(report, "Title");
  const live = date(report, "LiveDate");
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-del-title">
      <div className="pbs-modal-h">
        <h2 id="pbs-del-title">Hapus report {title}?</h2>
        <button
          type="button"
          className="pbs-x"
          onClick={props.onClose}
          disabled={pending}
          aria-label="Close"
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="pbs-modal-b">
        <p style={{ margin: 0 }}>
          Report dan AI Report-nya (Report Automation) dihapus dan tidak bisa
          dikembalikan. Sesi ini bisa diisi report baru lagi.
        </p>
        {failed ? (
          <InfoBanner tone="err">{res?.message || "Gagal menghapus."}</InfoBanner>
        ) : null}
        <div>
          <label className="pbs-label" htmlFor="pbs-del-reason">
            Alasan
          </label>
          <textarea
            id="pbs-del-reason"
            className="pbs-textarea"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            placeholder="Mis. salah pilih sesi / akun, angka dobel."
          />
          <div className="pbs-hint">
            {reason.trim().length} / 300 · minimal {DELETE_MIN_REASON} karakter
          </div>
        </div>
      </div>
      <div className="pbs-modal-f">
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            action.dispatch("DELETE_REPORT", {
              reportId: rowId(report),
              title,
              scheduleId: reportScheduleId(report),
              hostId: str(report, "HostID"),
              liveDate: live ? localDayKey(live) : "",
              expectedModified: str(report, "Modified"),
              reason: reason.trim(),
              deletedBy: props.deletedBy ?? "",
              ...props.extra,
            })
          }
          disabled={!ok || pending}
        >
          {pending ? (
            <>
              <Spinner small /> Deleting…
            </>
          ) : (
            "Delete Report"
          )}
        </Button>
      </div>
    </Overlay>
  );
}
