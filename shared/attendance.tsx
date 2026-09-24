import * as React from "react";
import { ModuleContext, UseActionResult, configNumber } from "./contract";
import { Row, date, localDayKey, num, parseClock, rowId, startOfDay, str } from "./data";
import { fmtClock, fmtLongDate, fmtNumber, fmtRupiah, fmtTime } from "./format";
import { clockInStatuses } from "./clockIn";
import { Period, RunModel, clockInDay, fmtPeriod, inPeriod, periodKey, periodOf, samePeriod, tierOf } from "./payroll";
import { Badge, Button, EmptyState, EndOfData, Icon, InfoBanner, Overlay, SkeletonRows, Spinner } from "./ui";

/**
 * Attendance adjustments on one Clock In row. HKTugas (uang kehadiran), Tier + Insentif and Streak
 * (weekly bonus) all live on that same row, and the payroll flow sums them per host per month —
 * so fixing a day here is what the next payroll run pays.
 */

export interface TierRates {
  1: number;
  2: number;
  3: number;
  weekly: number | null;
}

/** Insentif per tier (rate card): the tier decides the amount, no tier = 0. */
export const DEFAULT_TIER_RATES = { 1: 75000, 2: 65000, 3: 55000 } as const;

export const insentifFor = (rates: TierRates, tier: 1 | 2 | 3 | null): number => (tier ? rates[tier] : 0);

const mode = (xs: number[]): number | null => {
  const counts = new Map<number, number>();
  for (const x of xs) if (x > 0) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && best !== null && v > best)) [best, n] = [v, c];
  return best;
};

/** Tier 1/2/3 = 75.000/65.000/55.000 unless config.tierRates says otherwise; weekly from config.weeklyBonus or the data. */
export function tierRates(config: Record<string, unknown>, clockIns: Row[]): TierRates {
  const cfg = (config.tierRates && typeof config.tierRates === "object" ? config.tierRates : {}) as Row;
  const weeklyCfg = typeof config.weeklyBonus === "number" ? config.weeklyBonus : null;
  return {
    1: num(cfg, "tier1", "Tier 1", "1") ?? DEFAULT_TIER_RATES[1],
    2: num(cfg, "tier2", "Tier 2", "2") ?? DEFAULT_TIER_RATES[2],
    3: num(cfg, "tier3", "Tier 3", "3") ?? DEFAULT_TIER_RATES[3],
    weekly: weeklyCfg ?? mode(clockIns.map((c) => num(c, "Streak") ?? 0)),
  };
}

export interface AttendanceDay {
  row: Row;
  id: string;
  title: string;
  day: Date;
  key: string;
  inAt: Date | null;
  outAt: Date | null;
  minutes: number | null;
  hk: number;
  status: string;
  tier: 1 | 2 | 3 | null;
  insentif: number;
  streak: number;
  total: number;
  outsideGeofence: boolean;
  manual: boolean;
  adjusted: { by: string; at: Date | null; reason: string } | null;
}

function withClock(day: Date, clock: string): Date | null {
  const m = parseClock(clock);
  if (m === null) return null;
  const d = startOfDay(day);
  d.setMinutes(m);
  return d;
}

export function buildAttendance(clockIns: Row[], hostId: string, config: Record<string, unknown>): AttendanceDay[] {
  const statuses = clockInStatuses(config);
  const id = hostId.toLowerCase();
  const out: AttendanceDay[] = [];
  for (const c of clockIns) {
    if (hostId && str(c, "HostID") && str(c, "HostID").toLowerCase() !== id) continue;
    const day = clockInDay(c);
    if (!day) continue;
    const inAt = date(c, "CheckInTime") ?? withClock(day, str(c, "ClockInTime"));
    let outAt = date(c, "CheckOutTime") ?? withClock(date(c, "ClockOutDate") ?? day, str(c, "ClockOutTime"));
    if (inAt && outAt && outAt < inAt) outAt = new Date(outAt.getTime() + 864e5); // text times past midnight
    const hk = num(c, "HKTugas") ?? 0;
    const insentif = num(c, "Insentif") ?? 0;
    const streak = num(c, "Streak") ?? 0;
    const status = str(c, "StatusKehadiran", "Status") || statuses.find((s) => s.hk === hk && hk > 0)?.label || (hk > 0 ? `HK ${fmtRupiah(hk)}` : "");
    const adjAt = date(c, "AdjustedAt");
    const adjBy = str(c, "AdjustedBy");
    out.push({
      row: c,
      id: rowId(c),
      title: str(c, "Title"),
      day: startOfDay(day),
      key: localDayKey(day),
      inAt,
      outAt,
      minutes: inAt && outAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60000) : null,
      hk,
      status,
      tier: tierOf(c),
      insentif,
      streak,
      total: hk + insentif + streak,
      outsideGeofence: c.IsInsideGeofence === false || str(c, "IsInsideGeofence").toLowerCase() === "false",
      // Manual rows (ADD_CLOCK_IN) carry text times and no GPS check-in.
      manual: !date(c, "CheckInTime") && !!str(c, "ClockInTime"),
      adjusted: adjAt || adjBy ? { by: adjBy, at: adjAt, reason: str(c, "AdjustReason") } : null,
    });
  }
  return out.sort((a, b) => b.day.getTime() - a.day.getTime() || (b.inAt?.getTime() ?? 0) - (a.inAt?.getTime() ?? 0));
}

/** The payroll run that pays this month's attendance, and what editing it now means. */
export function payrollLock(runs: RunModel[], period: Period): { run: RunModel; level: "warn" | "err"; text: string } | null {
  const run = runs.filter((r) => samePeriod(r.dataPeriod, period) && r.phase !== "REJECTED").sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0))[0];
  if (!run) return null;
  if (run.phase === "DONE")
    return { run, level: "err", text: `Payroll ${run.label || fmtPeriod(run.dataPeriod)} untuk kehadiran ${fmtPeriod(period)} sudah selesai dibayar. Perubahan di sini tidak mengubah slip yang sudah terkirim — selisihnya perlu dikoreksi manual di payroll berikutnya.` };
  return { run, level: "warn", text: `Payroll ${run.label || fmtPeriod(run.dataPeriod)} (${run.statusText}) sudah memakai kehadiran ${fmtPeriod(period)}. Perubahan baru ikut dihitung kalau run itu disusun ulang.` };
}

const dur = (m: number | null) => (m === null ? "—" : `${Math.floor(m / 60)}j ${String(m % 60).padStart(2, "0")}m`);
const tierLabel = (t: 1 | 2 | 3 | null) => (t ? `Tier ${t}` : "—");

// ---- Tab --------------------------------------------------------------------------------------

export function AttendanceTab(props: {
  ctx: ModuleContext;
  hostId: string;
  hostCode: string;
  hostName: string;
  clockIns: Row[];
  runs: RunModel[];
  canEdit: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}): React.ReactElement {
  const { ctx, now, action } = props;
  const days = React.useMemo(() => buildAttendance(props.clockIns, props.hostId, ctx.config), [props.clockIns, props.hostId, ctx]);
  const rates = React.useMemo(() => tierRates(ctx.config, props.clockIns), [ctx, props.clockIns]);
  const maxShift = configNumber(ctx, "maxShiftHours", 12);
  // Months that have data, plus the current one; newest first.
  const months = React.useMemo(() => {
    const keys = new Map<string, Period>();
    keys.set(periodKey(periodOf(now)), periodOf(now));
    for (const d of days) keys.set(periodKey(periodOf(d.day)), periodOf(d.day));
    return [...keys.values()].sort((a, b) => b.year - a.year || b.month - a.month);
  }, [days, now]);
  const latestWithData = days[0] ? periodOf(days[0].day) : periodOf(now);
  const [periodK, setPeriodK] = React.useState(periodKey(latestWithData));
  const period = months.find((m) => periodKey(m) === periodK) ?? latestWithData;
  const rows = days.filter((d) => inPeriod(d.day, period));
  const lock = payrollLock(props.runs, period);
  const [editing, setEditing] = React.useState<AttendanceDay | null>(null);
  React.useEffect(() => {
    if (action.lastResult?.action === "ADJUST_CLOCK_IN" && action.lastResult.status === "ok") setEditing(null);
  }, [action.lastResult]);

  const sum = (f: (d: AttendanceDay) => number) => rows.reduce((s, d) => s + f(d), 0);
  const tiers = ([1, 2, 3] as const).map((t) => rows.filter((d) => d.tier === t).length);
  const firstLoad = props.loading && days.length === 0;

  return (
    <>
      <div className="pbs-filters" style={{ alignItems: "center" }}>
        <label className="pbs-chip">
          <span className="pbs-sr">Bulan kehadiran</span>
          <select aria-label="Bulan kehadiran" value={periodKey(period)} onChange={(e) => setPeriodK(e.target.value)}>
            {months.map((m) => (
              <option key={periodKey(m)} value={periodKey(m)}>
                {fmtPeriod(m)}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
        <span className="pbs-muted" style={{ fontSize: 12 }}>
          HKTugas, Tier + Insentif dan Weekly (Streak) diambil dari baris Clock In ini oleh flow payroll.
        </span>
      </div>

      <div className="pbs-kpis">
        <div className="pbs-kpi">
          <div className="l">Hari hadir</div>
          <div className="v">{fmtNumber(rows.length)}</div>
          <div className="n">HKTugas {fmtRupiah(sum((d) => d.hk))}</div>
        </div>
        <div className="pbs-kpi">
          <div className="l">Insentif tier</div>
          <div className="v">{fmtRupiah(sum((d) => d.insentif))}</div>
          <div className="n">
            T1 {tiers[0]} · T2 {tiers[1]} · T3 {tiers[2]} hari
          </div>
        </div>
        <div className="pbs-kpi">
          <div className="l">Weekly</div>
          <div className="v">{fmtRupiah(sum((d) => d.streak))}</div>
          <div className="n">{fmtNumber(rows.filter((d) => d.streak > 0).length)} kali</div>
        </div>
        <div className="pbs-kpi">
          <div className="l">Total dari Clock In</div>
          <div className="v">{fmtRupiah(sum((d) => d.total))}</div>
          <div className="n">sebelum PPh21</div>
        </div>
      </div>

      {lock ? <InfoBanner tone={lock.level}>{lock.text}</InfoBanner> : null}

      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Clock in</th>
                <th>Clock out</th>
                <th>Durasi</th>
                <th>Status</th>
                <th>Tier</th>
                <th className="r">Insentif</th>
                <th className="r">Weekly</th>
                <th className="r">Total</th>
                <th aria-label="Catatan" />
                {props.canEdit ? <th aria-label="Aksi" /> : null}
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={6} cols={props.canEdit ? 11 : 10} />
              ) : (
                rows.map((d) => {
                  const open = !!d.inAt && !d.outAt;
                  const long = d.minutes !== null && d.minutes > maxShift * 60;
                  return (
                    <tr key={d.id || d.title || d.key + String(d.inAt?.getTime())}>
                      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                        {fmtLongDate(d.day).replace(/ \d{4}$/, "")}
                      </td>
                      <td className="pbs-num">{fmtTime(d.inAt)}</td>
                      <td className="pbs-num">{open ? <Badge tone="warning">Belum clock out</Badge> : fmtTime(d.outAt)}</td>
                      <td className={`pbs-num${long ? " pbs-t-warn" : ""}`} style={{ whiteSpace: "nowrap" }}>
                        {dur(d.minutes)}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{d.status || <span className="pbs-muted">—</span>}</td>
                      <td>{d.tier ? <Badge tone="info">{tierLabel(d.tier)}</Badge> : <span className="pbs-muted">—</span>}</td>
                      <td className="r pbs-num">{d.insentif ? fmtRupiah(d.insentif) : <span className="pbs-muted">—</span>}</td>
                      <td className="r pbs-num">{d.streak ? fmtRupiah(d.streak) : <span className="pbs-muted">—</span>}</td>
                      <td className="r pbs-num" style={{ fontWeight: 600 }}>
                        {fmtRupiah(d.total)}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {d.adjusted ? (
                          <Badge tone="neutral" small title={[d.adjusted.by, d.adjusted.reason].filter(Boolean).join(" · ")}>
                            Disesuaikan
                          </Badge>
                        ) : d.manual ? (
                          <Badge tone="neutral" small>
                            Manual
                          </Badge>
                        ) : null}{" "}
                        {d.insentif !== insentifFor(rates, d.tier) ? (
                          <Badge tone="danger" small title={`Tier ${d.tier ?? "-"} seharusnya ${fmtRupiah(insentifFor(rates, d.tier))}`}>
                            Insentif ≠ tier
                          </Badge>
                        ) : null}{" "}
                        {d.outsideGeofence ? (
                          <Badge tone="warning" small>
                            Luar geofence
                          </Badge>
                        ) : null}
                      </td>
                      {props.canEdit ? (
                        <td className="r">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!!action.pending}
                            onClick={() => {
                              if (action.lastResult?.action === "ADJUST_CLOCK_IN") action.clearResult();
                              setEditing(d);
                            }}
                          >
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : rows.length === 0 ? (
          <EmptyState icon="clock" title={`Tidak ada clock in di ${fmtPeriod(period)}`} text={props.clockIns.length ? "Pilih bulan lain di atas." : "ClockInJson belum dikirim untuk host ini."} />
        ) : (
          <EndOfData text={`${fmtNumber(rows.length)} hari kehadiran ${fmtPeriod(period)}`} />
        )}
      </div>

      {editing ? (
        <AdjustClockInModal
          ctx={ctx}
          day={editing}
          hostId={props.hostId}
          hostCode={props.hostCode}
          hostName={props.hostName}
          rates={rates}
          lock={payrollLock(props.runs, periodOf(editing.day))}
          maxShiftHours={maxShift}
          action={action}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

// ---- Edit modal -------------------------------------------------------------------------------

const hhmm = (d: Date | null) => (d ? fmtTime(d) : "");
const localIso = (key: string, minutes: number, plusDays = 0) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + plusDays, 0, minutes, 0);
  return `${localDayKey(dt)}T${fmtClock(dt.getHours() * 60 + dt.getMinutes())}:00`;
};
const parseRupiah = (s: string): number | null => {
  const t = s.replace(/[^\d]/g, "");
  return t ? Number(t) : null;
};

export interface Change {
  field: string;
  label: string;
  from: string;
  to: string;
}

export function AdjustClockInModal(props: {
  ctx: ModuleContext;
  day: AttendanceDay;
  hostId: string;
  hostCode: string;
  hostName: string;
  rates: TierRates;
  lock: { run: RunModel; level: "warn" | "err"; text: string } | null;
  maxShiftHours: number;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { day: d, rates, action } = props;
  const statuses = React.useMemo(() => {
    const list = clockInStatuses(props.ctx.config);
    return d.status && !list.some((s) => s.label === d.status) ? [{ label: d.status, hk: d.hk }, ...list] : list;
  }, [props.ctx, d]);

  const [tin, setTin] = React.useState(hhmm(d.inAt));
  const [tout, setTout] = React.useState(hhmm(d.outAt));
  const [status, setStatus] = React.useState(d.status || "");
  const [tier, setTier] = React.useState<string>(d.tier ? String(d.tier) : "");
  const [weekly, setWeekly] = React.useState(d.streak > 0);
  const [weeklyAmt, setWeeklyAmt] = React.useState(String(d.streak > 0 ? d.streak : (rates.weekly ?? "")));
  const [reason, setReason] = React.useState("");

  const pending = action.pending?.action === "ADJUST_CLOCK_IN";
  const res = action.lastResult?.action === "ADJUST_CLOCK_IN" && action.lastResult.status !== "ok" ? action.lastResult : null;
  const a = parseClock(tin);
  const b = parseClock(tout);
  const overnight = a !== null && b !== null && b <= a;
  const minutes = a !== null && b !== null ? (overnight ? b + 1440 - a : b - a) : null;
  const st = statuses.find((s) => s.label === status);
  const tierN = tier ? (Number(tier) as 1 | 2 | 3) : null;
  const ins = insentifFor(rates, tierN);
  const wk = weekly ? parseRupiah(weeklyAmt) : 0;



  const changes: Change[] = [];
  const push = (field: string, label: string, from: string, to: string) => from !== to && changes.push({ field, label, from: from || "—", to: to || "—" });
  push("CheckInTime", "Clock in", hhmm(d.inAt), a !== null ? fmtClock(a) : "");
  push("CheckOutTime", "Clock out", hhmm(d.outAt), b !== null ? fmtClock(b) + (overnight ? " (+1 hari)" : "") : "");
  if (st) push("HKTugas", "Status / HK", `${d.status || "—"} · ${fmtRupiah(d.hk)}`, `${st.label} · ${fmtRupiah(st.hk)}`);
  push("Tier", "Tier", tierLabel(d.tier), tierLabel(tierN));
  push("Insentif", "Insentif", fmtRupiah(d.insentif), fmtRupiah(ins));
  if (wk !== null) push("Streak", "Weekly", fmtRupiah(d.streak), fmtRupiah(wk));
  const before = d.total;
  const after = (st?.hk ?? 0) + (ins ?? 0) + (wk ?? 0);

  const problems: string[] = [];
  if (a === null) problems.push("Isi jam clock in");
  if (d.outAt && b === null) problems.push("Jam clock out tidak boleh dikosongkan");
  if (!st) problems.push("Pilih status");
  if (weekly && wk === null) problems.push("Isi nominal weekly");
  if (reason.trim().length < 5) problems.push("Tulis alasan penyesuaian");
  if (changes.length === 0) problems.push("Belum ada yang diubah");
  const ok = problems.length === 0 && !pending;

  const submit = () => {
    if (!ok || a === null || !st) return;
    action.dispatch("ADJUST_CLOCK_IN", {
      clockInId: d.id,
      title: d.title,
      hostId: props.hostId,
      hostName: props.hostName,
      clockInDate: d.key,
      clockInTime: fmtClock(a),
      clockOutTime: b !== null ? fmtClock(b) : "",
      checkInAt: localIso(d.key, a),
      checkOutAt: b !== null ? localIso(d.key, b, overnight ? 1 : 0) : "",
      manualRow: d.manual,
      status: st.label,
      hkTugas: st.hk,
      tier: tierN ? `Tier ${tierN}` : "",
      insentif: ins,
      streak: wk ?? 0,
      totalBefore: before,
      totalAfter: after,
      reason: reason.trim(),
      changes: changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
      expectedModified: str(d.row, "Modified"),
      payrollRun: props.lock ? { id: props.lock.run.id, title: props.lock.run.title, phase: props.lock.run.phase } : null,
    });
  };

  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-adj-title">
        <div className="pbs-modal-h">
          <h2 id="pbs-adj-title">
            Edit kehadiran · {props.hostCode} · {fmtLongDate(d.day)}
          </h2>
          <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="pbs-modal-b">
          {props.lock ? <InfoBanner tone={props.lock.level}>{props.lock.text}</InfoBanner> : null}
          <div className="pbs-two">
            <div className="pbs-field">
              <label className="pbs-label" htmlFor="pbs-adj-in">
                Jam clock in
              </label>
              <input id="pbs-adj-in" type="time" value={tin} onChange={(e) => setTin(e.target.value)} disabled={pending} />
            </div>
            <div className="pbs-field">
              <label className="pbs-label" htmlFor="pbs-adj-out">
                Jam clock out
              </label>
              <input id="pbs-adj-out" type="time" value={tout} onChange={(e) => setTout(e.target.value)} disabled={pending} />
              <div className="pbs-hint">
                {minutes !== null ? `Durasi ${dur(minutes)}${overnight ? " · lewat tengah malam (clock out hari berikutnya)" : ""}` : !d.outAt ? "Kosongkan kalau shift memang masih berjalan." : ""}
              </div>
            </div>
          </div>
          {minutes !== null && minutes > props.maxShiftHours * 60 ? <InfoBanner tone="warn">Durasi lebih dari {props.maxShiftHours} jam. Pastikan jamnya benar.</InfoBanner> : null}
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-adj-status">
              Status kehadiran (HKTugas)
            </label>
            <select id="pbs-adj-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={pending}>
              <option value="">Pilih status…</option>
              {statuses.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label} · {fmtRupiah(s.hk)}
                </option>
              ))}
            </select>
          </div>
          <div className="pbs-two">
            <div className="pbs-field">
              <label className="pbs-label" htmlFor="pbs-adj-tier">
                Tier hari ini
              </label>
              <select id="pbs-adj-tier" value={tier} onChange={(e) => setTier(e.target.value)} disabled={pending}>
                <option value="">Tanpa tier</option>
                {([1, 2, 3] as const).map((t) => (
                  <option key={t} value={String(t)}>
                    Tier {t} · {fmtRupiah(rates[t])}
                  </option>
                ))}
              </select>
            </div>
            <div className="pbs-field">
              <label className="pbs-label" htmlFor="pbs-adj-ins">
                Insentif
              </label>
              <input id="pbs-adj-ins" type="text" value={fmtRupiah(ins)} readOnly disabled aria-describedby="pbs-adj-ins-h" />
              <div className="pbs-hint" id="pbs-adj-ins-h">
                Otomatis dari tier: T1 {fmtRupiah(rates[1])} · T2 {fmtRupiah(rates[2])} · T3 {fmtRupiah(rates[3])} · tanpa tier Rp0
              </div>
            </div>
          </div>
          <div className="pbs-two">
            <div className="pbs-field">
              <span className="pbs-label">Weekly (Streak)</span>
              <label className="pbs-inline" style={{ height: 40 }}>
                <input type="checkbox" className="pbs-check" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} disabled={pending} aria-label="Dapat bonus weekly" />
                Dapat bonus weekly di hari ini
              </label>
            </div>
            <div className="pbs-field">
              <label className="pbs-label" htmlFor="pbs-adj-wk">
                Nominal weekly (Rp)
              </label>
              <input id="pbs-adj-wk" type="text" inputMode="numeric" value={weeklyAmt ? fmtNumber(parseRupiah(weeklyAmt)) : ""} onChange={(e) => setWeeklyAmt(e.target.value)} disabled={pending || !weekly} placeholder="0" />
            </div>
          </div>
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-adj-reason">
              Alasan penyesuaian
            </label>
            <textarea id="pbs-adj-reason" className="pbs-textarea" style={{ minHeight: 64 }} value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} placeholder="Mis. host lupa clock out, pulang 21:00 sesuai jadwal live." />
          </div>
          {changes.length ? (
            <ul className="pbs-diff" aria-label="Ringkasan perubahan">
              {changes.map((c) => (
                <li key={c.field}>
                  <b>{c.label}</b>: {c.from} → {c.to}
                </li>
              ))}
              <li>
                <b>Total hari ini</b>: {fmtRupiah(before)} → {fmtRupiah(after)}
                {after !== before ? <span className={after > before ? "pbs-t-ok" : "pbs-t-bad"}> ({after > before ? "+" : "−"}{fmtRupiah(Math.abs(after - before))})</span> : null}
              </li>
            </ul>
          ) : null}
          {res ? (
            <InfoBanner tone="err">
              {res.status === "conflict" ? res.message || "Baris clock in ini sudah diubah orang lain. Muat ulang lalu coba lagi." : res.message || "Gagal menyimpan. Coba lagi."}
            </InfoBanner>
          ) : null}
        </div>
        <div className="pbs-modal-f">
          <Button variant="ghost" onClick={props.onClose} disabled={pending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!ok} title={problems.join(" · ") || undefined}>
            {pending ? (
              <>
                <Spinner small /> Menyimpan…
              </>
            ) : (
              "Simpan perubahan"
            )}
          </Button>
        </div>
    </Overlay>
  );
}

