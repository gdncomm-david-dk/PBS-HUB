import * as React from "react";
import { fmtLongDate } from "../../../shared/format";
import { HostSession } from "../../../shared/hostApp";
import { SCHEDULE_STATE, ScheduleState, initialCalendarDay, monthGrid, sessionsByDay } from "../../../shared/hostSchedule";
import { NO_REPORT_LABEL } from "../../../shared/data";
import { Period } from "../../../shared/payroll";
import { EmptyState } from "../../../shared/ui";
import { StateBadge } from "./MyScheduleView";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
/** Sessions shown inside a day cell before "+N lagi". */
const MAX_IN_CELL = 3;

export interface CalendarRow {
  s: HostSession;
  st: ScheduleState;
}

/**
 * Month view of the host sessions. Desktop: time + brand chips inside each day. Phone: a dot per
 * session. Either way the chosen day is listed under the grid, and a session opens the detail screen.
 */
export function ScheduleCalendar(props: { period: Period; rows: CalendarRow[]; now: Date; onOpen: (s: HostSession) => void }): React.ReactElement {
  const { period, rows, now } = props;
  const weeks = React.useMemo(() => monthGrid(period.year, period.month), [period]);
  const byDay = React.useMemo(() => sessionsByDay(rows), [rows]);
  const todayKey = weeks.flat().find((d) => d.date.toDateString() === now.toDateString())?.key ?? "";
  const pk = `${period.year}-${period.month}`;
  const [picked, setPicked] = React.useState<{ pk: string; key: string } | null>(null);
  const selected = picked && picked.pk === pk ? picked.key : initialCalendarDay(period.year, period.month, now, byDay.keys());
  const selDay = weeks.flat().find((d) => d.key === selected);
  const list = byDay.get(selected) ?? [];

  return (
    <div className="hc-cal-wrap">
      <div className="hc-cal" role="grid" aria-label="Kalender jadwal">
        <div className="hc-cal-h" role="row">
          {WEEKDAYS.map((w, i) => (
            <span key={w} role="columnheader" className={i >= 5 ? "we" : undefined}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]?.key} className="hc-cal-w" role="row">
            {week.map((d) => {
              const items = byDay.get(d.key) ?? [];
              const bad = items.some((r) => r.st === "LATE" || r.st === "REVISION");
              const cls = ["hc-cal-d", d.inMonth ? "" : "out", d.key === todayKey ? "today" : "", d.key === selected ? "sel" : "", items.length ? "has" : "", bad ? "bad" : ""].filter(Boolean).join(" ");
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
                  {items.length ? <span className="c">{items.length}</span> : null}
                  <span className="evs">
                    {items.slice(0, MAX_IN_CELL).map((r) => (
                      <span key={r.s.title || r.s.id} className={`hc-cal-ev ${SCHEDULE_STATE[r.st].tone}${r.st === "CANCELLED" ? " off" : ""}`} title={`${r.s.startText}–${r.s.endText} ${r.s.brand} · ${SCHEDULE_STATE[r.st].label}`}>
                        <b>{r.s.startText}</b> {r.s.brand}
                      </span>
                    ))}
                    {items.length > MAX_IN_CELL ? <span className="more">+{items.length - MAX_IN_CELL} lagi</span> : null}
                  </span>
                  <span className="dots" aria-hidden="true">
                    {items.slice(0, 4).map((r) => (
                      <i key={r.s.title || r.s.id} className={SCHEDULE_STATE[r.st].tone} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="hc-cal-day">
        <div className="pbs-sec" style={{ margin: "0 0 10px" }}>
          <span className="pbs-sec-l">{selDay ? (selDay.key === todayKey ? `Hari ini · ${fmtLongDate(selDay.date)}` : fmtLongDate(selDay.date)) : ""}</span>
          <span className="pbs-muted" style={{ fontSize: 12 }}>
            {list.length ? `${list.length} sesi` : ""}
          </span>
        </div>
        {list.length === 0 ? (
          <EmptyState icon="calendar" title="Tidak ada sesi" text="Pilih tanggal lain di kalender." />
        ) : (
          <div className="hc-stack" style={{ gap: 8 }}>
            {list.map(({ s, st }) => (
              <button key={s.title || s.id} type="button" className={`hc-cal-item${st === "REVISION" || st === "LATE" ? " bad" : ""}${st === "CANCELLED" ? " off" : ""}`} onClick={() => props.onOpen(s)}>
                <span className="t pbs-num">
                  {s.startText || "—"}–{s.endText || "—"}
                </span>
                <span className="b">
                  <b className="hc-brand">{s.brand}</b>
                  <span className="pbs-muted hc-ell" style={{ display: "block", fontSize: 12 }}>
                    {[s.title, s.platform, s.account, s.studio !== "—" ? s.studio : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="s">
                  <StateBadge state={st} />
                  {s.noReport && !s.report ? (
                    <span className="pbs-muted" style={{ display: "block", fontSize: 11, marginTop: 2 }}>
                      {NO_REPORT_LABEL[s.noReport]} · tanpa report
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
