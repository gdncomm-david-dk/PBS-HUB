import * as React from "react";
import { UseActionResult } from "./contract";
import { Row } from "./data";
import { HostOptions, HostSession, absenPayload } from "./hostApp";

/**
 * Absen: one tap, no questions. Live Break is decided when the host reports (LIVE_BREAK), not here.
 */
export function useAbsen(
  action: UseActionResult,
  host: Row | undefined,
  opts: HostOptions,
  onSent?: (scheduleId: string) => void,
): { start: (s: HostSession) => void } {
  const start = React.useCallback(
    (s: HostSession) => {
      if (action.dispatch("ABSEN", absenPayload(s, host, opts)))
        onSent?.(s.title);
    },
    [action, host, opts, onSent],
  );
  return { start };
}

/**
 * Absences canvas has confirmed but not yet sent back through AbsenceJson. Canvas answers ABSEN "ok" (or
 * "conflict": already recorded) before its collections reload, and a canvas that reloads the wrong
 * collection never sends the row at all; without this the Absen button stays live and the host can absen
 * the same session again and again. A remembered absence drops out once AbsenceJson carries the real row.
 */
export function useAbsenceMemory(
  action: UseActionResult,
  absences: Row[],
): { absences: Row[]; remember: (scheduleId: string) => void } {
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
    if (last.status === "ok" || last.status === "conflict")
      setDone((d) => (d.includes(id) ? d : [...d, id]));
  }, [last]);
  const merged = React.useMemo(() => {
    const have = new Set(
      absences.map((a) => String(a.ScheduleID ?? "").toLowerCase()),
    );
    const extra = done
      .filter((id) => !have.has(id.toLowerCase()))
      .map((id): Row => ({ Title: "", ScheduleID: id, Pending: true }));
    return extra.length ? [...absences, ...extra] : absences;
  }, [absences, done]);
  return { absences: merged, remember };
}
