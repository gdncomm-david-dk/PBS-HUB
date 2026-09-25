import * as React from "react";
import { ModuleContext, UseActionResult } from "./contract";
import { Row, clockText, date, localDayKey, num, parseClock, startOfDay, str } from "./data";
import { fmtClock, fmtLongDate, fmtRupiah } from "./format";
import { clockInDay } from "./payroll";
import { sessionStatus } from "./host";
import { Button, Icon, InfoBanner, Overlay, Spinner } from "./ui";

/** Manual clock-in for a host who forgot to clock in on a scheduled day (without it they cannot report). */

export interface ClockInStatus {
  label: string;
  hk: number;
}

export const DEFAULT_CLOCKIN_STATUSES: ClockInStatus[] = [
  { label: "Hadir - Tugas", hk: 180000 },
  { label: "Hadir - Retainer", hk: 30000 },
];

/** config.clockInStatuses: ["Hadir - Tugas", …] or [{label, hk}, …]; unknown labels pay 0. */
export function clockInStatuses(
  config: Record<string, unknown>,
): ClockInStatus[] {
  const raw = config.clockInStatuses;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_CLOCKIN_STATUSES;
  const out: ClockInStatus[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v.trim()) {
      const label = v.trim();
      out.push({
        label,
        hk: DEFAULT_CLOCKIN_STATUSES.find((s) => s.label === label)?.hk ?? 0,
      });
    } else if (v && typeof v === "object") {
      const label = str(v as Row, "label", "Label", "Value");
      if (label)
        out.push({ label, hk: num(v as Row, "hk", "HK", "HKTugas") ?? 0 });
    }
  }
  return out.length ? out : DEFAULT_CLOCKIN_STATUSES;
}

export interface ClockInDate {
  key: string; // yyyy-mm-dd, local
  day: Date;
  sessions: { title: string; start: string; end: string }[];
  start: number | null; // earliest scheduled start, minutes
  end: number | null; // latest scheduled end, minutes
}

/**
 * Scheduled days of this host that have no clock-in yet, oldest first. Same rule as the canvas
 * formula (Distinct schedule Date minus ClockInDate), limited to today and earlier and to
 * sessions that were not cancelled — a future or cancelled day cannot be "forgotten".
 */
export function availableClockInDates(
  schedules: Row[],
  clockIns: Row[],
  hostId: string,
  now: Date,
): ClockInDate[] {
  const id = hostId.toLowerCase();
  const mine = (r: Row) => !hostId || str(r, "HostID").toLowerCase() === id;
  const clocked = new Set<string>();
  for (const c of clockIns) {
    if (!mine(c)) continue;
    const d = clockInDay(c);
    if (d) clocked.add(localDayKey(d));
  }
  const today = startOfDay(now).getTime();
  const days = new Map<string, ClockInDate>();
  for (const s of schedules) {
    if (!mine(s) || sessionStatus(s) === "CANCELLED") continue;
    const d = date(s, "Date", "Tanggal");
    if (!d || startOfDay(d).getTime() > today) continue;
    const key = localDayKey(d);
    if (clocked.has(key)) continue;
    const start = clockText(str(s, "StartTime", "JamMulai"));
    const end = clockText(str(s, "EndTime", "JamSelesai"));
    const entry = days.get(key) ?? {
      key,
      day: startOfDay(d),
      sessions: [],
      start: null,
      end: null,
    };
    entry.sessions.push({ title: str(s, "Title"), start, end });
    const a = parseClock(start);
    const b = parseClock(end);
    if (a !== null && (entry.start === null || a < entry.start))
      entry.start = a;
    if (b !== null && (entry.end === null || b > entry.end)) entry.end = b;
    days.set(key, entry);
  }
  return [...days.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
}

const STEP = 30;
function timeOptions(extra: (number | null)[]): number[] {
  const set = new Set<number>();
  for (let m = 0; m < 24 * 60; m += STEP) set.add(m);
  for (const e of extra) if (e !== null && e < 24 * 60) set.add(e);
  return [...set].sort((a, b) => a - b);
}

export function ClockInModal(props: {
  ctx: ModuleContext;
  hostId: string;
  hostCode: string;
  hostName: string;
  schedules: Row[];
  clockIns: Row[];
  now: Date;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { action } = props;
  const dates = React.useMemo(
    () =>
      availableClockInDates(
        props.schedules,
        props.clockIns,
        props.hostId,
        props.now,
      ),
    [props.schedules, props.clockIns, props.hostId, props.now],
  );
  const hasSchedule = React.useMemo(
    () =>
      props.schedules.some(
        (r) =>
          str(r, "HostID").toLowerCase() === props.hostId.toLowerCase() &&
          sessionStatus(r) !== "CANCELLED",
      ),
    [props.schedules, props.hostId],
  );
  const statuses = React.useMemo(
    () => clockInStatuses(props.ctx.config),
    [props.ctx],
  );
  const [key, setKey] = React.useState("");
  const [tin, setTin] = React.useState("");
  const [tout, setTout] = React.useState("");
  const [status, setStatus] = React.useState("");

  const pending = action.pending?.action === "ADD_CLOCK_IN";
  const res =
    action.lastResult?.action === "ADD_CLOCK_IN" &&
    action.lastResult.status !== "ok"
      ? action.lastResult
      : null;
  const picked = dates.find((d) => d.key === key);
  const options = timeOptions([picked?.start ?? null, picked?.end ?? null]);
  const st = statuses.find((s) => s.label === status);
  const a = tin === "" ? null : Number(tin);
  const b = tout === "" ? null : Number(tout);
  const order = a !== null && b !== null && b <= a;
  const ok = !!picked && a !== null && b !== null && !order && !!st;

  const choose = (k: string) => {
    setKey(k);
    const d = dates.find((x) => x.key === k);
    // Prefill from the schedule of that day; the reviewer can still change it.
    setTin(d?.start !== null && d?.start !== undefined ? String(d.start) : "");
    setTout(d?.end !== null && d?.end !== undefined ? String(d.end) : "");
  };
  const submit = () => {
    if (!ok || pending || !picked || !st) return;
    action.dispatch("ADD_CLOCK_IN", {
      hostId: props.hostId,
      hostName: props.hostName,
      clockInDate: picked.key,
      clockInTime: fmtClock(a),
      clockOutTime: fmtClock(b),
      status: st.label,
      hkTugas: st.hk,
      scheduleIds: picked.sessions.map((s) => s.title).filter(Boolean),
    });
  };

  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-ci-title">
        <div className="pbs-modal-h">
          <h2 id="pbs-ci-title">Clock in manual · {props.hostCode}</h2>
          <button
            type="button"
            className="pbs-x"
            onClick={props.onClose}
            disabled={pending}
            aria-label="Tutup"
          >
            <Icon name="x" />
          </button>
        </div>
        {dates.length === 0 ? (
          <>
            <div className="pbs-modal-b">
              <InfoBanner icon="check">
                {hasSchedule ? (
                  <>
                    <b>{props.hostName}</b> sudah clock in di semua jadwalnya
                    sampai hari ini. Tidak ada tanggal yang perlu ditambahkan.
                  </>
                ) : (
                  <>
                    <b>{props.hostName}</b> belum punya jadwal sampai hari ini,
                    jadi tidak ada tanggal untuk clock in.
                  </>
                )}
              </InfoBanner>
            </div>
            <div className="pbs-modal-f">
              <Button variant="secondary" onClick={props.onClose}>
                Tutup
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="pbs-modal-b">
              <p style={{ margin: 0 }}>
                Untuk host yang lupa clock in, sehingga tidak bisa submit
                report. Hanya tanggal yang ada jadwalnya dan belum ada clock in
                yang bisa dipilih.
              </p>
              <div className="pbs-field">
                <label className="pbs-label" htmlFor="pbs-ci-date">
                  Tanggal
                </label>
                <select
                  id="pbs-ci-date"
                  value={key}
                  onChange={(e) => choose(e.target.value)}
                  disabled={pending}
                >
                  <option value="">Pilih tanggal jadwal…</option>
                  {dates.map((d) => (
                    <option key={d.key} value={d.key}>
                      {fmtLongDate(d.day)}
                      {d.start !== null
                        ? ` · ${fmtClock(d.start)}–${fmtClock(d.end)}`
                        : ""}
                      {d.sessions.length > 1
                        ? ` · ${d.sessions.length} sesi`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pbs-two">
                <div className="pbs-field">
                  <label className="pbs-label" htmlFor="pbs-ci-in">
                    Jam clock in
                  </label>
                  <select
                    id="pbs-ci-in"
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    disabled={pending || !picked}
                  >
                    <option value="">—</option>
                    {options.map((m) => (
                      <option key={m} value={m}>
                        {fmtClock(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pbs-field">
                  <label className="pbs-label" htmlFor="pbs-ci-out">
                    Jam clock out
                  </label>
                  <select
                    id="pbs-ci-out"
                    value={tout}
                    onChange={(e) => setTout(e.target.value)}
                    disabled={pending || !picked}
                  >
                    <option value="">—</option>
                    {options.map((m) => (
                      <option key={m} value={m}>
                        {fmtClock(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pbs-field">
                <label className="pbs-label" htmlFor="pbs-ci-status">
                  Status
                </label>
                <select
                  id="pbs-ci-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={pending}
                >
                  <option value="">Pilih status…</option>
                  {statuses.map((s) => (
                    <option key={s.label} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {st ? (
                  <div className="pbs-hint">HKTugas {fmtRupiah(st.hk)}</div>
                ) : null}
              </div>
              {order ? (
                <InfoBanner tone="warn">
                  Jam clock out harus setelah jam clock in.
                </InfoBanner>
              ) : null}
              {res ? (
                <InfoBanner tone="err">
                  {res.status === "conflict"
                    ? res.message ||
                      "Host ini sudah punya clock in di tanggal itu. Muat ulang lalu coba lagi."
                    : res.message || "Gagal menyimpan clock in. Coba lagi."}
                </InfoBanner>
              ) : null}
            </div>
            <div className="pbs-modal-f">
              <Button
                variant="ghost"
                onClick={props.onClose}
                disabled={pending}
              >
                Batal
              </Button>
              <Button
                onClick={submit}
                disabled={!ok || pending}
                title={
                  !ok
                    ? "Isi tanggal, jam clock in, jam clock out dan status"
                    : undefined
                }
              >
                {pending ? (
                  <>
                    <Spinner small /> Menyimpan…
                  </>
                ) : (
                  "Simpan clock in"
                )}
              </Button>
            </div>
          </>
        )}
    </Overlay>
  );
}
