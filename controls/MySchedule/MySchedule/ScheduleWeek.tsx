import * as React from "react";
import { fmtDayMonth, fmtLongDate } from "../../../shared/format";
import { HostSession } from "../../../shared/hostApp";
import { BOARD_LEGEND, BoardTone, SCHEDULE_STATE, boardTone, durationMin, fmtHours, sessionsByDay, weekDays } from "../../../shared/hostSchedule";
import { NO_REPORT_LABEL } from "../../../shared/data";
import { CalendarRow } from "./ScheduleCalendar";

const DAY = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Badge text on a board card, in the words of the legend (design 11a). */
const CARD_LABEL: Record<BoardTone, string> = {
  next: "Berikutnya",
  planned: "Terjadwal",
  review: "Direview",
  done: "Disetujui",
  missing: "Belum report",
  off: "Dibatalkan",
};

/**
 * Week board (design 11a, like the Ops schedule board): seven day columns, one card per session with
 * brand, account, studio, platform and where it stands. A day without sessions reads "Libur".
 */
export function ScheduleWeek(props: {
  monday: Date;
  rows: CalendarRow[];
  next: HostSession | undefined;
  holidays: Set<string>;
  now: Date;
  onOpen: (s: HostSession) => void;
}): React.ReactElement {
  const { monday, rows, now } = props;
  const days = React.useMemo(() => weekDays(monday), [monday]);
  const byDay = React.useMemo(() => sessionsByDay(rows), [rows]);
  const todayKey = days.find((d) => d.date.toDateString() === now.toDateString())?.key ?? "";
  const nextKey = props.next?.dayKey ?? "";
  // The highlighted column: today when it has sessions, else the day of the next session.
  const focusKey = todayKey && (byDay.get(todayKey)?.length ?? 0) > 0 ? todayKey : days.some((d) => d.key === nextKey) ? nextKey : todayKey;

  return (
    <div className="hc-board-wrap">
      <div className="hc-legend" aria-label="Keterangan warna">
        {BOARD_LEGEND.map((l) => (
          <span key={l.tone}>
            <i className={l.tone} />
            {l.label}
          </span>
        ))}
      </div>
      <div className="hc-board" role="list" aria-label="Jadwal minggu ini">
        {days.map((d) => {
          const items = byDay.get(d.key) ?? [];
          const live = items.filter((r) => r.st !== "CANCELLED");
          const minutes = live.reduce((a, r) => a + (durationMin(r.s) ?? 0), 0);
          const holiday = props.holidays.has(d.key);
          const tag = d.key === todayKey ? "hari ini" : d.key === nextKey && d.key === focusKey ? "hari berikutnya" : "";
          const sub = live.length ? `${live.length} sesi · ${fmtHours(minutes)}` : holiday ? "Libur nasional" : "Libur";
          return (
            <section key={d.key} className={`hc-bcol${d.key === focusKey ? " on" : ""}`} role="listitem" aria-label={`${fmtLongDate(d.date)}, ${sub}`}>
              <header>
                <b>
                  {DAY[d.date.getDay()]} {d.date.getDate()}
                  {d.date.getDate() === 1 || d === days[0] ? <span className="m"> {fmtDayMonth(d.date).split(" ")[1]}</span> : null}
                </b>
                <span className={holiday ? "pbs-t-bad" : undefined}>{[tag, sub].filter(Boolean).join(" · ")}</span>
              </header>
              <div className={`hc-bcol-b${items.length ? "" : " empty"}`}>
                {items.length === 0 ? (
                  <span className="hc-bcol-e">{holiday ? "Libur nasional" : "Libur"}</span>
                ) : (
                  items.map(({ s, st }) => {
                    const tone = boardTone(st, props.next === s);
                    return (
                      <button key={s.title || s.id} type="button" className={`hc-bcard ${tone}`} onClick={() => props.onOpen(s)} title={`${s.title} · ${SCHEDULE_STATE[st].label}`}>
                        <span className="t pbs-num">
                          {s.startText || "—"}–{s.endText || "—"}
                        </span>
                        <b className="hc-brand">{s.brand}</b>
                        {s.account ? <span className="x">{s.account}</span> : null}
                        <span className="x">{[s.studio !== "—" ? s.studio : "", s.platform].filter(Boolean).join(" · ")}</span>
                        <span className={`hc-btag ${tone}`}>{tone === "missing" ? SCHEDULE_STATE[st].label : CARD_LABEL[tone]}</span>
                        {s.noReport && !s.report ? <span className="x">{NO_REPORT_LABEL[s.noReport]} · tanpa report</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
