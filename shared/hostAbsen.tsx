import * as React from "react";
import { UseActionResult } from "./contract";
import { Row, noReportReason } from "./data";
import { HostOptions, HostSession, absenPayload } from "./hostApp";
import { Button, Icon, Overlay, Spinner } from "./ui";

/**
 * Absen with the live break question. A Co-Host owes no report either way, so it is not asked;
 * everyone else answers before the ABSEN is sent. "Ya" = live break: no report, but canvas still
 * creates a Report row with every metric 0 and ApprovalStatus LiveBreak.
 */
export function useAbsen(
  action: UseActionResult,
  host: Row | undefined,
  opts: HostOptions,
  onSent?: (scheduleId: string) => void,
): { start: (s: HostSession) => void; dialog: React.ReactElement | null } {
  const [asking, setAsking] = React.useState<HostSession | null>(null);
  const send = React.useCallback(
    (s: HostSession, liveBreak: boolean) => {
      if (action.dispatch("ABSEN", absenPayload(s, host, liveBreak, opts))) onSent?.(s.title);
    },
    [action, host, opts, onSent],
  );
  const start = React.useCallback(
    (s: HostSession) => {
      if (noReportReason(s.row) === "CO_HOST") send(s, false);
      else setAsking(s);
    },
    [send],
  );
  const pending = action.pending?.action === "ABSEN";
  // Close once canvas answered (ok or not; the banner on the screen tells which).
  const last = action.lastResult;
  React.useEffect(() => {
    if (last?.action === "ABSEN") setAsking(null);
  }, [last]);
  const dialog = asking ? <LiveBreakDialog s={asking} pending={pending} onClose={() => setAsking(null)} onSend={(lb) => send(asking, lb)} /> : null;
  return { start, dialog };
}

/**
 * Absences canvas has confirmed but not yet sent back through AbsenceJson. Canvas answers ABSEN "ok" (or
 * "conflict": already recorded) before its collections reload, and a canvas that reloads the wrong
 * collection never sends the row at all; without this the Absen button stays live and the host can absen
 * the same session again and again. A remembered absence drops out once AbsenceJson carries the real row.
 */
export function useAbsenceMemory(action: UseActionResult, absences: Row[]): { absences: Row[]; remember: (scheduleId: string) => void } {
  const sent = React.useRef<string | null>(null);
  const [done, setDone] = React.useState<string[]>([]);
  const remember = React.useCallback((scheduleId: string) => {
    sent.current = scheduleId;
  }, []);
  const last = action.lastResult;
  React.useEffect(() => {
    if (last?.action !== "ABSEN" || !sent.current) return;
    const id = sent.current;
    sent.current = null;
    if (last.status === "ok" || last.status === "conflict") setDone((d) => (d.includes(id) ? d : [...d, id]));
  }, [last]);
  const merged = React.useMemo(() => {
    const have = new Set(absences.map((a) => String(a.ScheduleID ?? "").toLowerCase()));
    const extra = done.filter((id) => !have.has(id.toLowerCase())).map((id): Row => ({ Title: "", ScheduleID: id, Pending: true }));
    return extra.length ? [...absences, ...extra] : absences;
  }, [absences, done]);
  return { absences: merged, remember };
}

function LiveBreakDialog(props: { s: HostSession; pending: boolean; onClose: () => void; onSend: (liveBreak: boolean) => void }): React.ReactElement {
  const { s, pending } = props;
  const [choice, setChoice] = React.useState<"no" | "yes" | null>(null);
  const opt = (v: "no" | "yes", title: string, text: string) => (
    <label className={`hc-opt${choice === v ? " on" : ""}`}>
      <input type="radio" name="hc-lb" value={v} checked={choice === v} onChange={() => setChoice(v)} disabled={pending} />
      <span>
        <b>{title}</b>
        <span className="pbs-muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
          {text}
        </span>
      </span>
    </label>
  );
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="hc-lb-title">
      <div className="pbs-modal-h">
        <h2 id="hc-lb-title">Absen sesi {s.brand}</h2>
        <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
          <Icon name="x" />
        </button>
      </div>
      <div className="pbs-modal-b">
        <p style={{ margin: 0 }}>
          {s.title} · {s.startText || "—"}–{s.endText || "—"} · {s.platform || "—"}. Apakah sesi ini <b>Live Break</b>?
        </p>
        <div className="hc-stack" role="radiogroup" aria-label="Live break" style={{ gap: 8 }}>
          {opt("no", "Tidak, live seperti biasa", "Setelah absen, kirim report sesi ini lewat tombol Send Report.")}
          {opt("yes", "Ya, Live Break", "Tidak perlu report. Report tetap dibuat otomatis dengan semua angka 0 dan status LiveBreak.")}
        </div>
      </div>
      <div className="pbs-modal-f">
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Batal
        </Button>
        <Button onClick={() => choice && props.onSend(choice === "yes")} disabled={!choice || pending}>
          {pending ? (
            <>
              <Spinner small /> Mengirim…
            </>
          ) : (
            "Absen"
          )}
        </Button>
      </div>
    </Overlay>
  );
}
