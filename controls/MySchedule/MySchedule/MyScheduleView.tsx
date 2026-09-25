import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row, localDayKey, NO_REPORT_LABEL, reportScheduleId, rowId, str } from "../../../shared/data";
import { fmtDayMonth, fmtLongDate, fmtNumber } from "../../../shared/format";
import { HostSession, buildHostSessions, hostOptions } from "../../../shared/hostApp";
import {
  STATUS_FILTERS,
  SCHEDULE_STATE,
  ScheduleState,
  StatusFilter,
  durationMin,
  fmtHours,
  matchesQuery,
  positionOf,
  scheduleKpis,
  scheduleState,
  todayFocus,
} from "../../../shared/hostSchedule";
import { Period, addMonths, fmtPeriod, inPeriod, parsePeriod, periodKey, periodOf } from "../../../shared/payroll";
import { Badge, Button, EmptyState, EndOfData, FilterSelect, Icon, IconName, ResultBanner, Skeleton, Spinner } from "../../../shared/ui";

export interface MyScheduleProps {
  ctx: ModuleContext;
  period: string;
  defaultFilter: string;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  brands: Row[];
  studios: Row[];
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

/** Payloads shared with HostDashboard (same canvas handlers). */
export const scheduleRef = (s: HostSession): Record<string, unknown> => ({ scheduleId: s.title, scheduleItemId: s.id, liveDate: s.dayKey });

export function absenPayload(s: HostSession, host: Row | undefined): Record<string, unknown> {
  return {
    scheduleId: s.title,
    scheduleItemId: s.id,
    hostId: str(host, "Title") || str(s.row, "HostID"),
    hostName: str(host, "NamaHost", "HostName"),
    liveDate: s.dayKey,
    brandId: s.brandId,
    studioId: s.studioId,
    platform: s.platform,
    account: s.accountId,
  };
}

export const reportRef = (r: Row): Record<string, unknown> => ({ reportId: rowId(r), title: str(r, "Title"), scheduleId: reportScheduleId(r) });

const STATE_ICON: Partial<Record<ScheduleState, IconName>> = {
  FINISHED: "check",
  WAITING: "clock",
  PLANNED: "calendar",
  SOON: "clock",
  LIVE: "sparkle",
  NEEDS_ABSEN: "checkSquare",
  NEEDS_CLOCKIN: "mapPin",
  NEEDS_REPORT: "file",
  LATE: "alert",
  REVISION: "alert",
  CANCELLED: "x",
};

/** Status is a shape as well as a colour (design 5a). */
export function StateBadge(props: { state: ScheduleState }): React.ReactElement {
  const s = SCHEDULE_STATE[props.state];
  const ic = STATE_ICON[props.state];
  return (
    <Badge tone={s.tone}>
      {ic ? <Icon name={ic} size={12} /> : null}
      {s.label}
    </Badge>
  );
}

interface Col {
  key: string;
  label: string;
  w: string;
  /** Hidden on tablet width (m) or on phones (s). */
  hide?: "m" | "s";
  right?: boolean;
}

export function MyScheduleView(props: MyScheduleProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const pk = periodKey(parsePeriod(props.period) ?? periodOf(now));
  const period: Period = React.useMemo(() => parsePeriod(pk) as Period, [pk]);
  const months = Array.from({ length: 7 }, (_, i) => addMonths(periodOf(now), 1 - i));
  if (!months.some((m) => periodKey(m) === periodKey(period))) months.push(period);
  const host = props.host[0];

  const initial = (STATUS_FILTERS.find((f) => f.value === props.defaultFilter)?.value ?? "") as StatusFilter;
  const [status, setStatus] = React.useState<StatusFilter>(initial);
  React.useEffect(() => setStatus(initial), [initial]);
  const [platform, setPlatform] = React.useState("");
  const [search, setSearch] = React.useState("");

  const sessions = React.useMemo(
    () => buildHostSessions({ schedules: props.schedules, clockIns: props.clockIns, absences: props.absences, reports: props.reports, brands: props.brands, studios: props.studios }, now, opts),
    [props.schedules, props.clockIns, props.absences, props.reports, props.brands, props.studios, now, opts],
  );
  const inRange = React.useCallback((d: Date | null) => inPeriod(d, period), [period]);
  const rows = React.useMemo(() => sessions.filter((s) => inRange(s.day)).map((s) => ({ s, st: scheduleState(s, now) })), [sessions, inRange, now]);
  const kpi = React.useMemo(() => scheduleKpis(sessions, props.clockIns, now, inRange), [sessions, props.clockIns, now, inRange]);
  const focus = React.useMemo(() => todayFocus(sessions, now), [sessions, now]);
  const platforms = React.useMemo(() => [...new Set(rows.map((r) => r.s.platform).filter(Boolean))].sort(), [rows]);
  const filtered = rows.filter((r) => matchesQuery(r.s, r.st, { platform, status, search }));
  // Every loaded row is rendered: a partial list was read as the whole total.
  const visible = filtered;
  const hasPosition = rows.some((r) => positionOf(r.s.row));
  const todayKey = localDayKey(now);
  const firstLoad = props.loading && rows.length === 0;
  const filtering = !!(platform || status || search.trim());

  const cols: Col[] = [
    { key: "id", label: "Schedule ID", w: "92px", hide: "s" },
    { key: "brand", label: "Brand", w: "minmax(0,1.3fr)" },
    { key: "date", label: "Tanggal", w: "64px", hide: "s" },
    { key: "acc", label: "Akun", w: "minmax(0,1.2fr)", hide: "m" },
    ...(hasPosition ? [{ key: "pos", label: "Posisi", w: "88px", hide: "m" as const }] : []),
    { key: "time", label: "Waktu", w: "96px", hide: "s" },
    { key: "studio", label: "Studio", w: "minmax(0,.8fr)", hide: "m" },
    { key: "dur", label: "Durasi", w: "56px", hide: "s", right: true },
    { key: "st", label: "Status", w: "146px" },
  ];
  const tpl = (drop: ("m" | "s")[]) => cols.filter((c) => !c.hide || !drop.includes(c.hide)).map((c) => c.w).join(" ");
  const grid = { "--gt": tpl([]), "--gt-m": tpl(["m"]), "--gt-s": "minmax(0,1fr) auto" } as React.CSSProperties;
  const cls = (c: Col) => [c.hide === "m" ? "hide-m" : c.hide === "s" ? "hide-s" : "", c.right ? "r" : ""].filter(Boolean).join(" ") || undefined;

  const open = (s: HostSession) => action.fire("OPEN_SCHEDULE", scheduleRef(s));
  const reset = () => {
    setStatus("");
    setPlatform("");
    setSearch("");
  };
  const changed = (next: { status?: StatusFilter; platform?: string }) => {
    action.fire("FILTER_CHANGED", { status: next.status ?? status, platform: next.platform ?? platform, period: periodKey(period) });
  };

  return (
    <div className="hc-col wide">
      <div className="hc-hi">
        <div>
          <h1>Jadwal saya</h1>
          <p>
            {fmtLongDate(now)}
            {firstLoad ? "" : kpi.action ? ` · ${fmtNumber(kpi.action)} sesi perlu tindakan` : ""}
          </p>
        </div>
        <label className="pbs-chip">
          <span className="pbs-sr">Bulan</span>
          <select
            aria-label="Bulan"
            value={periodKey(period)}
            onChange={(e) => {
              action.fire("PERIOD_CHANGED", { period: e.target.value });
            }}
          >
            {months.map((m) => (
              <option key={periodKey(m)} value={periodKey(m)}>
                {fmtPeriod(m)}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </div>

      <ResultBanner result={action.lastResult} okText={action.lastResult?.action === "ABSEN" ? "Absen tercatat. Sekarang kamu bisa kirim report sesi ini." : undefined} onClose={action.clearResult} />

      <div className="hc-kpis">
        <Kpi icon="calendar" label="Live schedule" loading={firstLoad} value={fmtNumber(kpi.sessions)} sub={kpi.upcoming ? `sesi · ${fmtNumber(kpi.upcoming)} akan datang` : "sesi"} />
        <Kpi icon="clock" label="Jam live" loading={firstLoad} value={fmtNumber(Math.round(kpi.doneMin / 60))} sub={`dari ${fmtNumber(Math.round(kpi.totalMin / 60))} jam`} />
        <Kpi icon="checkSquare" label="Absen hari ini" loading={firstLoad} value={fmtNumber(kpi.absenToday)} sub={kpi.today ? `dari ${fmtNumber(kpi.today)} sesi` : "tidak ada sesi"} />
        <Kpi icon="mapPin" label="Hari clock in" loading={firstLoad} value={fmtNumber(kpi.clockDays)} sub={`dari ${fmtNumber(kpi.workDays)} hari berjadwal`} />
      </div>

      {focus && periodKey(period) === periodKey(periodOf(now)) ? <TodayStrip s={focus} now={now} host={host} action={action} onOpen={() => open(focus)} /> : null}

      <div className="pbs-filters">
        <FilterSelect
          label="Platform"
          value={platform}
          options={platforms.map((p) => ({ value: p, label: p }))}
          onChange={(v) => {
            setPlatform(v);
            changed({ platform: v });
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
          onChange={(v) => {
            setStatus(v as StatusFilter);
            changed({ status: v as StatusFilter });
          }}
        />
        <label className="pbs-search hc-grow">
          <Icon name="search" size={14} />
          <input
            type="search"
            placeholder="Cari brand, akun, atau Schedule ID"
            aria-label="Cari jadwal"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </label>
        {filtering ? (
          <button type="button" className="pbs-link" onClick={reset}>
            Reset
          </button>
        ) : null}
      </div>

      <div className="hc-list" aria-busy={props.loading} role="table" aria-label="Jadwal saya">
        <div className="hc-row sch head" style={grid} role="row">
          {cols.map((c) => (
            <span key={c.key} className={cls(c)} role="columnheader">
              {c.label}
            </span>
          ))}
        </div>
        {firstLoad
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="hc-row sch" style={grid}>
                {cols.map((c) => (
                  <span key={c.key} className={cls(c)}>
                    <Skeleton w={c.key === "brand" || c.key === "acc" ? "70%" : 44} />
                  </span>
                ))}
              </div>
            ))
          : visible.map(({ s, st }) => {
              const dur = durationMin(s);
              const today = s.dayKey === todayKey;
              return (
                <div
                  key={s.title || s.id}
                  className={`hc-row sch click${today ? " today" : ""}${st === "REVISION" || st === "LATE" ? " bad" : ""}${st === "CANCELLED" ? " off" : ""}`}
                  style={grid}
                  role="row"
                  onClick={() => open(s)}
                >
                  <span className="hide-s">
                    <button type="button" className="pbs-link hc-id" onClick={(e) => (e.stopPropagation(), open(s))}>
                      {s.title || "—"}
                    </button>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b className="hc-brand">{s.brand}</b>
                    <span className="only-s pbs-muted">
                      {today ? "Hari ini" : fmtDayMonth(s.day)} · {s.startText || "—"}–{s.endText || "—"}
                      {s.platform ? ` · ${s.platform}` : ""}
                      {s.studio !== "—" ? ` · ${s.studio}` : ""}
                    </span>
                    <span className="only-m pbs-muted">
                      {[s.platform, s.account, s.studio !== "—" ? s.studio : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`hide-s pbs-num${today ? " hc-b" : ""}`}>{today ? "Hari ini" : fmtDayMonth(s.day)}</span>
                  <span className="hide-m hc-ell">
                    {s.account || s.platform || "—"}
                    {s.account && s.platform ? <span className="pbs-muted"> · {s.platform}</span> : null}
                  </span>
                  {hasPosition ? <span className="hide-m pbs-muted">{positionOf(s.row) || "—"}</span> : null}
                  <span className="hide-s pbs-num">
                    {s.startText || "—"}–{s.endText || "—"}
                  </span>
                  <span className="hide-m pbs-muted hc-ell">{s.studio}</span>
                  <span className="hide-s r pbs-num">{fmtHours(dur)}</span>
                  <span>
                    <StateBadge state={st} />
                    {s.noReport && !s.report ? (
                      <span className="pbs-muted" style={{ display: "block", fontSize: 11 }}>
                        {NO_REPORT_LABEL[s.noReport]} · tanpa report
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
      </div>

      {firstLoad ? null : filtered.length === 0 ? (
        <EmptyState
          icon={filtering ? "filterX" : "calendar"}
          title={filtering ? "Tidak ada jadwal yang cocok" : `Belum ada jadwal di ${fmtPeriod(period)}`}
          text={filtering ? `${fmtNumber(rows.length)} sesi lain di bulan ini tersembunyi oleh filter.` : "Jadwal live yang dibuat tim PBS untukmu akan muncul di sini."}
          action={
            filtering ? (
              <Button variant="secondary" size="sm" onClick={reset}>
                Reset filter
              </Button>
            ) : undefined
          }
        />
      ) : props.hasMore ? (
        <div className="pbs-foot">
          <span>
            Total {fmtNumber(filtered.length)} jadwal dimuat · masih ada data lain di server sesi
          </span>
          <span className="line" />
          <Button
            variant="secondary"
            size="sm"
            disabled={props.loading}
            onClick={() => action.fire("LOAD_MORE", { period: periodKey(period), loaded: props.schedules.length })}
          >
            {props.loading ? (
              <>
                <Spinner small /> Memuat…
              </>
            ) : (
              "Muat lebih banyak"
            )}
          </Button>
        </div>
      ) : (
        <EndOfData text={`Total ${fmtNumber(filtered.length)} sesi${filtering ? " sesuai filter" : ""} pada ${fmtPeriod(period)}`} />
      )}
    </div>
  );
}

function Kpi(props: { icon: IconName; label: string; value: string; sub: string; loading: boolean }): React.ReactElement {
  return (
    <div className="hc-kpi">
      <span className="hc-ic">
        <Icon name={props.icon} size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="l">{props.label}</div>
        {props.loading ? (
          <Skeleton w={70} h={20} style={{ marginTop: 4 }} />
        ) : (
          <div className="v">
            {props.value}
            <small>{props.sub}</small>
          </div>
        )}
      </div>
    </div>
  );
}

function TodayStrip(props: { s: HostSession; now: Date; host: Row | undefined; action: UseActionResult; onOpen: () => void }): React.ReactElement {
  const { s, now, action } = props;
  const st = scheduleState(s, now);
  const busy = action.pending?.action === "ABSEN";
  const facts = [
    `${s.startText || "—"}–${s.endText || "—"}`,
    s.studio !== "—" ? s.studio : "",
    s.account,
    positionOf(s.row),
    s.absence ? "absen tercatat" : s.phase === "NEEDS_REPORT" || s.report ? "" : "absen belum tercatat",
  ].filter(Boolean);
  return (
    <div className={`hc-today${st === "REVISION" ? " bad" : ""}`}>
      <div className="b">
        <div className="hc-today-t">
          <span className="hc-tag">HARI INI</span>
          <button type="button" className="hc-today-n" onClick={props.onOpen}>
            {s.title} · {s.brand}
          </button>
          {s.platform ? <span className="hc-plat">{s.platform}</span> : null}
          <StateBadge state={st} />
        </div>
        <div className="pbs-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          {facts.join(" · ")}
        </div>
      </div>
      <div className="hc-today-a">
        {!s.clockedIn && s.phase === "NOW" ? (
          <Button size="sm" onClick={() => action.fire("CLOCK_IN", {})}>
            <Icon name="mapPin" size={14} /> Clock in
          </Button>
        ) : null}
        {s.canAbsen ? (
          <Button variant={s.phase === "NEEDS_REPORT" ? "secondary" : "primary"} size="sm" onClick={() => action.dispatch("ABSEN", absenPayload(s, props.host))} disabled={!!action.pending}>
            {busy ? <Spinner small /> : null} Absen
          </Button>
        ) : null}
        {s.phase === "NEEDS_REPORT" ? (
          <Button size="sm" onClick={() => action.fire("NEW_REPORT", scheduleRef(s))}>
            Kirim report
          </Button>
        ) : null}
        {s.phase === "REVISION" && s.report ? (
          <Button size="sm" onClick={() => s.report && action.fire("OPEN_REPORT", reportRef(s.report))}>
            Perbaiki report
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          Detail
        </Button>
      </div>
    </div>
  );
}
