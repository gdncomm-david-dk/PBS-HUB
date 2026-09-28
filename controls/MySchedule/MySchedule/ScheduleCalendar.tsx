import * as React from "react";
import { HostSession } from "../../../shared/hostApp";
import {
  SCHEDULE_STATE,
  ScheduleState,
  SpanStats,
  fmtHours,
  initialCalendarDay,
  monthGrid,
  sessionsByDay,
} from "../../../shared/hostSchedule";
import { NO_REPORT_LABEL } from "../../../shared/data";
import { Period, addMonths, fmtPeriod } from "../../../shared/payroll";
import { fmtLongDate, fmtNumber, monthName } from "../../../shared/format";
import { Button, EmptyState, Icon } from "../../../shared/ui";
import { StateBadge } from "./MyScheduleView";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
/** Sessions shown inside a day cell before "+N lagi". */
const MAX_IN_CELL = 3;

export interface CalendarRow {
  s: HostSession;
  st: ScheduleState;
}

export interface MonthPanel {
  month: SpanStats;
  /** null when the previous month is not loaded. */
  previous: SpanStats | null;
  holidays: Set<string>;
  pic: string;
  onPrevious: () => void;
  onContact: () => void;
}

/**
 * Month view (design 10b): the month grid 8/12 with time + brand chips per day (a dot per session on
 * phones), weekends and national holidays greyed; on the right the chosen day, the month in numbers,
 * last month to compare, and who to contact. A month without sessions still renders the grid.
 */
export function ScheduleCalendar(props: {
  period: Period;
  rows: CalendarRow[];
  now: Date;
  onOpen: (s: HostSession) => void;
  panel: MonthPanel;
}): React.ReactElement {
  const { panel } = props;
  const { period, rows, now } = props;
  const weeks = React.useMemo(
    () => monthGrid(period.year, period.month),
    [period],
  );
  const byDay = React.useMemo(() => sessionsByDay(rows), [rows]);
  const todayKey =
    weeks.flat().find((d) => d.date.toDateString() === now.toDateString())
      ?.key ?? "";
  const pk = `${period.year}-${period.month}`;
  const [picked, setPicked] = React.useState<{
    pk: string;
    key: string;
  } | null>(null);
  const selected =
    picked && picked.pk === pk
      ? picked.key
      : initialCalendarDay(period.year, period.month, now, byDay.keys());
  const selDay = weeks.flat().find((d) => d.key === selected);
  const list = byDay.get(selected) ?? [];

  return (
    <div className="hc-cal-wrap">
      <div className="hc-cal">
        <div role="grid" aria-label="Kalender jadwal">
          <div className="hc-cal-h" role="row">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                role="columnheader"
                className={i >= 5 ? "we" : undefined}
              >
                {w}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]?.key} className="hc-cal-w" role="row">
              {week.map((d) => {
                const items = byDay.get(d.key) ?? [];
                const bad = items.some(
                  (r) => r.st === "LATE" || r.st === "REVISION",
                );
                const off = d.date.getDay() === 0 || d.date.getDay() === 6;
                const holiday = panel.holidays.has(d.key);
                const cls = [
                  "hc-cal-d",
                  d.inMonth ? "" : "out",
                  off ? "we" : "",
                  holiday ? "hol" : "",
                  d.key === todayKey ? "today" : "",
                  d.key === selected && rows.length > 0 ? "sel" : "",
                  items.length ? "has" : "",
                  bad ? "bad" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="gridcell"
                    className={cls}
                    aria-selected={d.key === selected}
                    aria-label={`${fmtLongDate(d.date)}, ${items.length ? `${items.length} sesi` : "tidak ada sesi"}`}
                    onClick={() => setPicked({ pk, key: d.key })}
                  >
                    <span className="n">{d.date.getDate()}</span>
                    {holiday && d.inMonth ? (
                      <span className="hl">Libur nasional</span>
                    ) : null}
                    {items.length ? (
                      <span className="c">{items.length}</span>
                    ) : null}
                    <span className="evs">
                      {items.slice(0, MAX_IN_CELL).map((r) => (
                        <span
                          key={r.s.title || r.s.id}
                          className={`hc-cal-ev ${SCHEDULE_STATE[r.st].tone}${r.st === "CANCELLED" ? " off" : ""}`}
                          title={`${r.s.startText}–${r.s.endText} ${r.s.brand} · ${SCHEDULE_STATE[r.st].label}`}
                        >
                          <b>{r.s.startText}</b> {r.s.brand}
                        </span>
                      ))}
                      {items.length > MAX_IN_CELL ? (
                        <span className="more">
                          +{items.length - MAX_IN_CELL} lagi
                        </span>
                      ) : null}
                    </span>
                    <span className="dots" aria-hidden="true">
                      {items.slice(0, 4).map((r) => (
                        <i
                          key={r.s.title || r.s.id}
                          className={SCHEDULE_STATE[r.st].tone}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="hc-cal-empty">
            <span className="hc-ic">
              <Icon name="calendar" size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Jadwal {monthName(period.month)} belum terbit</b>
              <p>
                Tim PBS biasanya menerbitkan jadwal bulan berikutnya paling
                lambat tanggal 28. Jadwal akan muncul di sini begitu terbit.
              </p>
            </div>
            <button
              type="button"
              className="pbs-link"
              onClick={panel.onPrevious}
            >
              View {monthName(addMonths(period, -1).month)}
            </button>
          </div>
        ) : null}
      </div>

      <div className="hc-cal-side">
        {rows.length > 0 ? (
          <div className="hc-cal-day">
            <div className="pbs-sec" style={{ margin: "0 0 10px" }}>
              <span className="pbs-sec-l">
                {selDay
                  ? selDay.key === todayKey
                    ? `Hari ini · ${fmtLongDate(selDay.date)}`
                    : fmtLongDate(selDay.date)
                  : ""}
              </span>
              <span className="pbs-muted" style={{ fontSize: 12 }}>
                {list.length ? `${list.length} sesi` : ""}
              </span>
            </div>
            {list.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Tidak ada sesi"
                text="Pilih tanggal lain di kalender."
              />
            ) : (
              <div className="hc-stack" style={{ gap: 8 }}>
                {list.map(({ s, st }) => (
                  <button
                    key={s.title || s.id}
                    type="button"
                    className={`hc-cal-item${st === "REVISION" || st === "LATE" ? " bad" : ""}${st === "CANCELLED" ? " off" : ""}`}
                    onClick={() => props.onOpen(s)}
                  >
                    <span className="t pbs-num">
                      {s.startText || "—"}–{s.endText || "—"}
                    </span>
                    <span className="b">
                      <b className="hc-brand">{s.brand}</b>
                      <span
                        className="pbs-muted hc-ell"
                        style={{ display: "block", fontSize: 12 }}
                      >
                        {[
                          s.title,
                          s.platform,
                          s.account,
                          s.studio !== "—" ? s.studio : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="s">
                      <StateBadge state={st} />
                      {s.noReport && !s.report ? (
                        <span
                          className="pbs-muted"
                          style={{
                            display: "block",
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          {NO_REPORT_LABEL[s.noReport]} · tanpa report
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <MonthCard
          title={fmtPeriod(period)}
          rows={[
            ["Sesi terjadwal", fmtNumber(panel.month.sessions)],
            ["Jam live", fmtHours(panel.month.minutes)],
            [
              "Hari libur nasional",
              fmtNumber(holidaysIn(panel.holidays, period)),
            ],
          ]}
        />
        {panel.previous ? (
          <MonthCard
            title={`Bulan lalu · ${monthName(addMonths(period, -1).month)}`}
            rows={[
              ["Sesi", fmtNumber(panel.previous.sessions)],
              ["Jam live", fmtHours(panel.previous.minutes)],
              ["Brand", fmtNumber(panel.previous.brands.length)],
              [
                "Report tertunda",
                fmtNumber(panel.previous.pending),
                panel.previous.pending > 0,
              ],
            ]}
          />
        ) : null}
        <div className="hc-card">
          <b style={{ fontSize: 14 }}>Ada yang tidak sesuai?</b>
          <p
            className="pbs-muted"
            style={{ fontSize: 12.5, margin: "6px 0 12px" }}
          >
            Hubungi PIC jadwal kamu{panel.pic ? `, ${panel.pic},` : ""} untuk
            tukar sesi atau ajukan libur.
          </p>
          <Button variant="secondary" wide onClick={panel.onContact}>
            Contact PIC
          </Button>
        </div>
      </div>
    </div>
  );
}

function holidaysIn(set: Set<string>, p: Period): number {
  const prefix = `${p.year}-${String(p.month + 1).padStart(2, "0")}-`;
  return [...set].filter((k) => k.startsWith(prefix)).length;
}

function MonthCard(props: {
  title: string;
  rows: [string, string, boolean?][];
}): React.ReactElement {
  return (
    <div className="hc-card">
      <div className="pbs-sec">
        <span className="pbs-sec-l">{props.title}</span>
      </div>
      <dl className="hc-kv">
        {props.rows.map(([k, v, bad]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={bad ? "pbs-t-bad" : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
