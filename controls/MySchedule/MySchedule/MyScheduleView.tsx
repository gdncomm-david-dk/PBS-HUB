import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import {
  Row,
  localDayKey,
  NO_REPORT_LABEL,
  reportScheduleId,
  rowId,
  str,
} from "../../../shared/data";
import { fmtDayMonth, fmtLongDate, fmtNumber } from "../../../shared/format";
import {
  HostSession,
  buildHostSessions,
  hostOptions,
} from "../../../shared/hostApp";
import { useAbsen, useAbsenceMemory } from "../../../shared/hostAbsen";
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
  holidaySet,
  initialWeek,
  nextSession,
  spanStats,
} from "../../../shared/hostSchedule";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { ScheduleWeek } from "./ScheduleWeek";
import {
  Period,
  addMonths,
  fmtPeriod,
  inPeriod,
  parsePeriod,
  periodKey,
  periodOf,
} from "../../../shared/payroll";
import {
  Badge,
  Button,
  EmptyState,
  FilterSelect,
  Icon,
  IconName,
  Pager,
  ResultBanner,
  Skeleton,
  Spinner,
  usePaged,
} from "../../../shared/ui";

export interface MyScheduleProps {
  ctx: ModuleContext;
  period: string;
  defaultFilter: string;
  /** "Week" (default), "List" or "Calendar" (month). */
  defaultView: string;
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
export const scheduleRef = (s: HostSession): Record<string, unknown> => ({
  scheduleId: s.title,
  scheduleItemId: s.id,
  liveDate: s.dayKey,
});

export const reportRef = (r: Row): Record<string, unknown> => ({
  reportId: rowId(r),
  title: str(r, "Title"),
  scheduleId: reportScheduleId(r),
});

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
export function StateBadge(props: {
  state: ScheduleState;
}): React.ReactElement {
  const s = SCHEDULE_STATE[props.state];
  const ic = STATE_ICON[props.state];
  return (
    <Badge tone={s.tone}>
      {ic ? <Icon name={ic} size={12} /> : null}
      {s.label}
    </Badge>
  );
}

type View = "List" | "Week" | "Calendar";

const VIEWS: { key: View; label: string }[] = [
  { key: "List", label: "Daftar" },
  { key: "Week", label: "Minggu" },
  { key: "Calendar", label: "Bulan" },
];

/** "28 Sep – 4 Okt 2026" (year optional). */
function fmtWeek(monday: Date, year = true): string {
  const sun = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  );
  return `${fmtDayMonth(monday)} – ${fmtDayMonth(sun)}${year ? ` ${sun.getFullYear()}` : ""}`;
}

/** Whether any of the seven days lies in the month. */
function weekTouches(monday: Date, p: Period): boolean {
  const sun = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  );
  return inPeriod(monday, p) || inPeriod(sun, p);
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
  const absMemo = useAbsenceMemory(action, props.absences);
  const pk = periodKey(parsePeriod(props.period) ?? periodOf(now));
  const period: Period = React.useMemo(() => parsePeriod(pk) as Period, [pk]);
  const months = Array.from({ length: 7 }, (_, i) =>
    addMonths(periodOf(now), 1 - i),
  );
  if (!months.some((m) => periodKey(m) === periodKey(period)))
    months.push(period);
  const host = props.host[0];
  const absen = useAbsen(action, host, opts, absMemo.remember);

  const initial = (STATUS_FILTERS.find((f) => f.value === props.defaultFilter)
    ?.value ?? "") as StatusFilter;
  const [status, setStatus] = React.useState<StatusFilter>(initial);
  React.useEffect(() => setStatus(initial), [initial]);
  const [platform, setPlatform] = React.useState("");
  const [search, setSearch] = React.useState("");
  const initialView: View =
    props.defaultView === "Calendar" || props.defaultView === "Month"
      ? "Calendar"
      : props.defaultView === "List"
        ? "List"
        : "Week";
  const [view, setView] = React.useState<View>(initialView);
  React.useEffect(() => setView(initialView), [initialView]);
  const pickView = (v: View) => {
    setView(v);
    action.fire("VIEW_CHANGED", { view: v });
  };
  // Week board: the week follows the month picker; stepping out of the month asks canvas for that month.
  const [monday, setMonday] = React.useState<Date>(() =>
    initialWeek(period.year, period.month, now),
  );
  React.useEffect(() => {
    setMonday((m) =>
      weekTouches(m, period) ? m : initialWeek(period.year, period.month, now),
    );
  }, [period]); // keep the chosen week when canvas answers with the month it asked for
  const stepWeek = (n: number) => {
    const m = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 7 * n,
    );
    setMonday(m);
    if (!weekTouches(m, period)) {
      const thu = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 3);
      action.fire("PERIOD_CHANGED", { period: periodKey(periodOf(thu)) });
    }
  };
  const holidays = React.useMemo(() => holidaySet(ctx.config), [ctx]);

  const sessions = React.useMemo(
    () =>
      buildHostSessions(
        {
          schedules: props.schedules,
          clockIns: props.clockIns,
          absences: absMemo.absences,
          reports: props.reports,
          brands: props.brands,
          studios: props.studios,
        },
        now,
        opts,
      ),
    [
      props.schedules,
      props.clockIns,
      absMemo.absences,
      props.reports,
      props.brands,
      props.studios,
      now,
      opts,
    ],
  );
  const inRange = React.useCallback(
    (d: Date | null) => inPeriod(d, period),
    [period],
  );
  const allRows = React.useMemo(
    () => sessions.map((s) => ({ s, st: scheduleState(s, now) })),
    [sessions, now],
  );
  const rows = React.useMemo(
    () => allRows.filter((r) => inRange(r.s.day)),
    [allRows, inRange],
  );
  const kpi = React.useMemo(
    () => scheduleKpis(sessions, props.clockIns, now, inRange),
    [sessions, props.clockIns, now, inRange],
  );
  const focus = React.useMemo(() => todayFocus(sessions, now), [sessions, now]);
  const platforms = React.useMemo(
    () => [...new Set(rows.map((r) => r.s.platform).filter(Boolean))].sort(),
    [rows],
  );
  const filtered = rows.filter((r) =>
    matchesQuery(r.s, r.st, { platform, status, search }),
  );
  // The board shows the whole week, also days of the neighbouring month when they are loaded.
  const weekEnd = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 7,
  );
  const inWeek = (s: HostSession) =>
    !!s.day && s.day >= monday && s.day < weekEnd;
  const weekRows = allRows.filter(
    (r) => inWeek(r.s) && matchesQuery(r.s, r.st, { platform, status, search }),
  );
  const week = spanStats(allRows, inWeek);
  const next = React.useMemo(() => nextSession(sessions, now), [sessions, now]);
  const prevPeriod = addMonths(period, -1);
  const prevLoaded = allRows.some((r) => inPeriod(r.s.day, prevPeriod));
  const monthStats = spanStats(rows, () => true);
  const prevStats = prevLoaded
    ? spanStats(allRows, (s) => inPeriod(s.day, prevPeriod))
    : null;
  const weekMax = Number(ctx.config.weekMaxHours) || 0;
  // Report tertunda counts every loaded session, not only this week (an old unsent report still waits).
  const owed = spanStats(allRows, (x) => !!x.day && x.day < now);
  const paged = usePaged(
    filtered,
    JSON.stringify([periodKey(period), platform, status, search, view]),
  );
  const visible = paged.rows;
  const hasPosition = rows.some((r) => positionOf(r.s.row));
  const todayKey = localDayKey(now);
  const firstLoad = props.loading && rows.length === 0;
  const filtering = !!(platform || status || search.trim());

  const cols: Col[] = [
    { key: "id", label: "Schedule ID", w: "92px", hide: "s" },
    { key: "brand", label: "Brand", w: "minmax(0,1.3fr)" },
    { key: "date", label: "Tanggal", w: "64px", hide: "s" },
    { key: "acc", label: "Akun", w: "minmax(0,1.2fr)", hide: "m" },
    ...(hasPosition
      ? [{ key: "pos", label: "Posisi", w: "88px", hide: "m" as const }]
      : []),
    { key: "time", label: "Waktu", w: "96px", hide: "s" },
    { key: "studio", label: "Studio", w: "minmax(0,.8fr)", hide: "m" },
    { key: "dur", label: "Durasi", w: "56px", hide: "s", right: true },
    { key: "st", label: "Status", w: "146px" },
  ];
  const tpl = (drop: ("m" | "s")[]) =>
    cols
      .filter((c) => !c.hide || !drop.includes(c.hide))
      .map((c) => c.w)
      .join(" ");
  const grid = {
    "--gt": tpl([]),
    "--gt-m": tpl(["m"]),
    "--gt-s": "minmax(0,1fr) auto",
  } as React.CSSProperties;
  const cls = (c: Col) =>
    [
      c.hide === "m" ? "hide-m" : c.hide === "s" ? "hide-s" : "",
      c.right ? "r" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  const open = (s: HostSession) => action.fire("OPEN_SCHEDULE", scheduleRef(s));
  const reset = () => {
    setStatus("");
    setPlatform("");
    setSearch("");
  };
  const changed = (next: { status?: StatusFilter; platform?: string }) => {
    action.fire("FILTER_CHANGED", {
      status: next.status ?? status,
      platform: next.platform ?? platform,
      period: periodKey(period),
    });
  };

  return (
    <div className="hc-col wide">
      <div className="hc-hi">
        <div>
          <h1>Jadwal saya</h1>
          <p>
            {view === "Week"
              ? `Minggu ${fmtWeek(monday)} · ${fmtNumber(week.sessions)} sesi · ${fmtHours(week.minutes)}`
              : `${fmtLongDate(now)}${firstLoad ? "" : kpi.action ? ` · ${fmtNumber(kpi.action)} sesi perlu tindakan` : ""}`}
          </p>
        </div>
        <div className="hc-hi-a">
          <div className="hc-seg lg" role="group" aria-label="Tampilan">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => pickView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === "Week" ? (
            <div className="pbs-chip hc-wknav">
              <span className="pbs-num">{fmtWeek(monday, false)}</span>
              <button
                type="button"
                aria-label="Minggu sebelumnya"
                onClick={() => stepWeek(-1)}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Minggu berikutnya"
                onClick={() => stepWeek(1)}
              >
                ›
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>

      <ResultBanner
        result={action.lastResult}
        okText={
          action.lastResult?.action === "ABSEN"
            ? "Absen tercatat. Sekarang kamu bisa kirim report sesi ini."
            : undefined
        }
        onClose={action.clearResult}
      />

      {view === "Week" ? (
        <div className="hc-kpis">
          <Kpi
            icon="calendar"
            label="Sesi minggu ini"
            loading={firstLoad}
            value={fmtNumber(week.sessions)}
            sub="sesi"
          />
          <Kpi
            icon="clock"
            label="Jam live"
            loading={firstLoad}
            value={fmtNumber(Math.round(week.minutes / 6) / 10)}
            sub={weekMax ? `dari maks ${fmtNumber(weekMax)} jam` : "jam"}
          />
          <Kpi
            icon="file"
            label="Brand"
            loading={firstLoad}
            value={fmtNumber(week.brands.length)}
            sub={
              week.brands.length > 2
                ? `${week.brands.slice(0, 2).join(", ")}, +${week.brands.length - 2}`
                : week.brands.join(", ") || "—"
            }
          />
          <Kpi
            icon="alert"
            tone={owed.pending ? "bad" : undefined}
            label="Report tertunda"
            loading={firstLoad}
            value={fmtNumber(owed.pending)}
            sub={
              owed.pendingFirst
                ? `${owed.pendingFirst.brand} · ${fmtDayMonth(owed.pendingFirst.day)}`
                : "semua beres"
            }
          />
        </div>
      ) : (
        <div className="hc-kpis">
          <Kpi
            icon="calendar"
            label="Jadwal live"
            loading={firstLoad}
            value={fmtNumber(kpi.sessions)}
            sub={
              kpi.upcoming
                ? `sesi · ${fmtNumber(kpi.upcoming)} akan datang`
                : "sesi"
            }
          />
          <Kpi
            icon="clock"
            label="Jam live"
            loading={firstLoad}
            value={fmtNumber(Math.round(kpi.doneMin / 60))}
            sub={`dari ${fmtNumber(Math.round(kpi.totalMin / 60))} jam`}
          />
          <Kpi
            icon="checkSquare"
            label="Absen hari ini"
            loading={firstLoad}
            value={fmtNumber(kpi.absenToday)}
            sub={
              kpi.today ? `dari ${fmtNumber(kpi.today)} sesi` : "tidak ada sesi"
            }
          />
          <Kpi
            icon="mapPin"
            label="Hari clock in"
            loading={firstLoad}
            value={fmtNumber(kpi.clockDays)}
            sub={`dari ${fmtNumber(kpi.workDays)} hari berjadwal`}
          />
        </div>
      )}

      {focus && periodKey(period) === periodKey(periodOf(now)) ? (
        <TodayStrip
          s={focus}
          now={now}
          onAbsen={() => absen.start(focus)}
          action={action}
          onOpen={() => open(focus)}
        />
      ) : null}

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
          options={STATUS_FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
          }))}
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

      {view === "Calendar" && !firstLoad ? (
        <ScheduleCalendar
          period={period}
          rows={filtered}
          now={now}
          onOpen={open}
          panel={{
            month: monthStats,
            previous: prevStats,
            holidays,
            pic: String(ctx.config.picName ?? ""),
            onPrevious: () =>
              action.fire("PERIOD_CHANGED", { period: periodKey(prevPeriod) }),
            onContact: () =>
              action.fire("CONTACT_PIC", { period: periodKey(period) }),
          }}
        />
      ) : null}
      {view === "Week" && !firstLoad ? (
        <ScheduleWeek
          monday={monday}
          rows={weekRows}
          next={next}
          holidays={holidays}
          now={now}
          onOpen={open}
        />
      ) : null}

      <div
        className="hc-list"
        hidden={view !== "List" && !firstLoad}
        aria-busy={props.loading}
        role="table"
        aria-label="Jadwal saya"
      >
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
                    <Skeleton
                      w={c.key === "brand" || c.key === "acc" ? "70%" : 44}
                    />
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
                    <button
                      type="button"
                      className="pbs-link hc-id"
                      onClick={(e) => (e.stopPropagation(), open(s))}
                    >
                      {s.title || "—"}
                    </button>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b className="hc-brand">{s.brand}</b>
                    <span className="only-s pbs-muted">
                      {today ? "Hari ini" : fmtDayMonth(s.day)} ·{" "}
                      {s.startText || "—"}–{s.endText || "—"}
                      {s.platform ? ` · ${s.platform}` : ""}
                      {s.studio !== "—" ? ` · ${s.studio}` : ""}
                    </span>
                    <span className="only-m pbs-muted">
                      {[s.platform, s.account, s.studio !== "—" ? s.studio : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className={`hide-s pbs-num${today ? " hc-b" : ""}`}>
                    {today ? "Hari ini" : fmtDayMonth(s.day)}
                  </span>
                  <span className="hide-m hc-ell">
                    {s.account || s.platform || "—"}
                    {s.account && s.platform ? (
                      <span className="pbs-muted"> · {s.platform}</span>
                    ) : null}
                  </span>
                  {hasPosition ? (
                    <span className="hide-m pbs-muted">
                      {positionOf(s.row) || "—"}
                    </span>
                  ) : null}
                  <span className="hide-s pbs-num">
                    {s.startText || "—"}–{s.endText || "—"}
                  </span>
                  <span className="hide-m pbs-muted hc-ell">{s.studio}</span>
                  <span className="hide-s r pbs-num">{fmtHours(dur)}</span>
                  <span>
                    <StateBadge state={st} />
                    {s.noReport && !s.report ? (
                      <span
                        className="pbs-muted"
                        style={{ display: "block", fontSize: 11 }}
                      >
                        {NO_REPORT_LABEL[s.noReport]} · tanpa report
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
      </div>

      {firstLoad || view === "Week" ? null : filtered.length === 0 &&
        view === "List" ? (
        <EmptyState
          icon={filtering ? "filterX" : "calendar"}
          title={
            filtering
              ? "Tidak ada jadwal yang cocok"
              : `Belum ada jadwal di ${fmtPeriod(period)}`
          }
          text={
            filtering
              ? `${fmtNumber(rows.length)} sesi lain di bulan ini tersembunyi oleh filter.`
              : "Jadwal live yang dibuat tim PBS untukmu akan muncul di sini."
          }
          action={
            filtering ? (
              <Button variant="secondary" size="sm" onClick={reset}>
                Reset filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Pager
          paged={paged}
          unit="sesi"
          suffix={`${filtering ? " sesuai filter" : ""} pada ${fmtPeriod(period)}`}
          hasMore={props.hasMore}
          loading={props.loading}
          onLoadMore={() =>
            action.fire("LOAD_MORE", {
              period: periodKey(period),
              loaded: props.schedules.length,
            })
          }
        />
      )}
      {absen.dialog}
    </div>
  );
}

function Kpi(props: {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  loading: boolean;
  tone?: "bad";
}): React.ReactElement {
  return (
    <div className="hc-kpi">
      <span className={`hc-ic${props.tone ? ` ${props.tone}` : ""}`}>
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

function TodayStrip(props: {
  s: HostSession;
  now: Date;
  onAbsen: () => void;
  action: UseActionResult;
  onOpen: () => void;
}): React.ReactElement {
  const { s, now, action } = props;
  const st = scheduleState(s, now);
  const busy = action.pending?.action === "ABSEN";
  const facts = [
    `${s.startText || "—"}–${s.endText || "—"}`,
    s.studio !== "—" ? s.studio : "",
    s.account,
    positionOf(s.row),
    s.absence
      ? "absen tercatat"
      : s.phase === "NEEDS_REPORT" || s.report
        ? ""
        : "absen belum tercatat",
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
          <Button
            variant={s.phase === "NEEDS_REPORT" ? "secondary" : "primary"}
            size="sm"
            onClick={props.onAbsen}
            disabled={!!action.pending}
          >
            {busy ? <Spinner small /> : null} Absen
          </Button>
        ) : null}
        {s.phase === "NEEDS_REPORT" ? (
          <Button
            size="sm"
            onClick={() => action.fire("NEW_REPORT", scheduleRef(s))}
          >
            Kirim report
          </Button>
        ) : null}
        {s.phase === "REVISION" && s.report ? (
          <Button
            size="sm"
            onClick={() =>
              s.report && action.fire("OPEN_REPORT", reportRef(s.report))
            }
          >
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
