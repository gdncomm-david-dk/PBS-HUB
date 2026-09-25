import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row, date, localDayKey, nameIndex, num, reportScheduleId, rowId, startOfDay, str } from "../../../shared/data";
import { fmtDayMonth, fmtLongDate, fmtNumber, fmtTime } from "../../../shared/format";
import { bandOf, parseBands } from "../../../shared/host";
import {
  hostReportBadge,
  HostSession,
  PHASE_LABEL,
  Shift,
  buildHostSessions,
  flaggedFromComment,
  greeting,
  hostName,
  hostOptions,
  reviewerNote,
  scoreOf,
  shiftToday,
  streakDays,
} from "../../../shared/hostApp";
import { reviewState } from "../../../shared/reconcile";
import { MASCOT_CHEER } from "../../../shared/assets.generated";
import { Badge, Button, Icon, InfoBanner, ResultBanner, Skeleton, Spinner } from "../../../shared/ui";

export interface HostDashboardProps {
  ctx: ModuleContext;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  scoreTx: Row[];
  thresholds: Row[];
  brands: Row[];
  studios: Row[];
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

export const fmtDur = (min: number): string => (min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min}m`);

function until(from: Date, to: Date): string {
  const m = Math.round((to.getTime() - from.getTime()) / 60000);
  if (m <= 0) return "sekarang";
  if (m < 60) return `${m} menit lagi`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} jam ${m % 60} menit lagi` : `${h} jam lagi`;
}

/** Payload canvas needs to write Host Absence for a session. */
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

export const sessionRef = (s: HostSession): Record<string, unknown> => ({ scheduleId: s.title, scheduleItemId: s.id, liveDate: s.dayKey });
export const reportRef = (r: Row): Record<string, unknown> => ({ reportId: rowId(r), title: str(r, "Title"), scheduleId: reportScheduleId(r) });

export function HostDashboardView(props: HostDashboardProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const host = props.host[0];
  const sessions = React.useMemo(
    () => buildHostSessions({ schedules: props.schedules, clockIns: props.clockIns, absences: props.absences, reports: props.reports, brands: props.brands, studios: props.studios }, now, opts),
    [props.schedules, props.clockIns, props.absences, props.reports, props.brands, props.studios, now, opts],
  );
  const shift = shiftToday(props.clockIns, now, opts);
  const todayKey = localDayKey(now);
  const today = sessions.filter((s) => s.dayKey === todayKey && s.phase !== "CANCELLED");
  const name = hostName(host, ctx.userName);
  const first = today.find((s) => s.start && s.end && s.end > now);

  // Revisions come from reports, not sessions: a revised report can belong to a session outside the window.
  const brandNames = React.useMemo(() => nameIndex(props.brands, ["NamaBrand", "BrandName"]), [props.brands]);
  const brandName = (id: string) => brandNames.get(id) ?? id;
  const revisions = props.reports.filter((r) => reviewState(r) === "REVISION");
  const toSend = sessions.filter((s) => s.phase === "NEEDS_REPORT" && s.dayKey !== todayKey);
  const toAbsen = sessions.filter((s) => s.phase === "NEEDS_ABSEN" && s.dayKey !== todayKey);
  const noClock = sessions.filter((s) => s.phase === "NEEDS_CLOCKIN" && s.dayKey !== todayKey && s.day && now.getTime() - s.day.getTime() < 4 * 864e5);
  const next = sessions.find((s) => s.day && startOfDay(s.day) > startOfDay(now) && s.phase !== "CANCELLED");

  const busy = action.pending?.action === "ABSEN";
  const absen = (s: HostSession) => action.dispatch("ABSEN", absenPayload(s, host));

  if (props.loading && sessions.length === 0 && !host) return <Loading />;

  return (
    <div className="hc-col">
      <div className="hc-hi">
        <div>
          <h1>
            {greeting(now)}
            {name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
          <p>
            {fmtLongDate(now)} ·{" "}
            {today.length === 0
              ? "tidak ada jadwal hari ini"
              : `${today.length} sesi hari ini${first?.start ? `. Sesi ${first.start <= now ? "sekarang" : "berikutnya"} mulai ${fmtTime(first.start)}${first.start > now ? ` — ${until(now, first.start)}` : ""}` : ""}.`}
          </p>
        </div>
        <img src={MASCOT_CHEER} alt="" />
      </div>

      <ResultBanner result={action.lastResult} okText={action.lastResult?.action === "ABSEN" ? "Absen tercatat. Sekarang kamu bisa kirim report sesi ini." : undefined} onClose={action.clearResult} />

      <div className="hc-stack">
        <ShiftCard shift={shift} hasToday={today.length > 0} maxHours={opts.maxShiftHours} onIn={() => action.fire("CLOCK_IN", {})} onOut={() => action.fire("CLOCK_OUT", { clockInId: rowId(shift.row) })} />

        {revisions.map((r) => {
          const flagged = flaggedFromComment(str(r, "ApprovalComment"));
          const note = reviewerNote(str(r, "ApprovalComment"));
          return (
            <div key={rowId(r) || str(r, "Title")} className="hc-todo bad">
              <span className="hc-ic bad">
                <Icon name="alert" size={18} />
              </span>
              <div className="hc-todo-b">
                <p className="hc-todo-t">Report {brandName(str(r, "BrandID"))} perlu revisi</p>
                <p className="hc-todo-x">
                  {flagged.length ? `${flagged.map((m) => m.label).join(" dan ")} perlu kamu cek. ` : ""}
                  {note ? `“${note.length > 120 ? note.slice(0, 117) + "…" : note}”` : ""}
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <span className="pbs-muted" style={{ fontSize: 12 }}>
                    {str(r, "Title")} · {fmtDayMonth(date(r, "LiveDate"))}
                  </span>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => action.fire("OPEN_REPORT", reportRef(r))}>
                Perbaiki report
              </Button>
            </div>
          );
        })}

        {toSend.map((s) => (
          <div key={s.title} className={`hc-todo${s.late ? " bad" : " warn"}`}>
            <span className={`hc-ic ${s.late ? "bad" : "warn"}`}>
              <Icon name="file" size={18} />
            </span>
            <div className="hc-todo-b">
              <p className="hc-todo-t">Report {s.brand} belum dikirim</p>
              <p className="hc-todo-x">
                Sesi {fmtDayMonth(s.day)} {s.startText}–{s.endText}.{" "}
                {s.late ? "Sudah lewat batas waktu — kirim sekarang dan jelaskan di catatan." : s.due ? `Kirim sebelum ${fmtLongDate(s.due).split(",")[0]} ${fmtDayMonth(s.due)}.` : ""}
              </p>
            </div>
            <Button size="sm" onClick={() => action.fire("NEW_REPORT", sessionRef(s))}>
              Kirim report
            </Button>
          </div>
        ))}

        {toAbsen.map((s) => (
          <div key={s.title} className="hc-todo warn">
            <span className="hc-ic warn">
              <Icon name="checkSquare" size={18} />
            </span>
            <div className="hc-todo-b">
              <p className="hc-todo-t">Absen {s.brand} belum tercatat</p>
              <p className="hc-todo-x">
                Sesi {fmtDayMonth(s.day)} {s.startText}–{s.endText}. Absen dulu supaya report sesi ini bisa dikirim.
              </p>
            </div>
            <Button size="sm" onClick={() => absen(s)} disabled={!!action.pending}>
              {busy && action.pending ? <Spinner small /> : null} Absen
            </Button>
          </div>
        ))}

        {noClock.map((s) => (
          <div key={s.title} className="hc-todo">
            <span className="hc-ic">
              <Icon name="clock" size={18} />
            </span>
            <div className="hc-todo-b">
              <p className="hc-todo-t">Sesi {s.brand} tanpa clock in</p>
              <p className="hc-todo-x">
                {fmtDayMonth(s.day)} {s.startText}–{s.endText}. Report tidak bisa dikirim tanpa clock in di hari itu. Kalau kamu memang live, minta tim PBS menambahkan clock in manual.
              </p>
            </div>
          </div>
        ))}

        <div className="pbs-sec" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="pbs-sec-l">Jadwal hari ini</span>
          <button type="button" className="pbs-link" onClick={() => action.fire("NAV", { target: "SCHEDULE" })}>
            Jadwal saya
          </button>
        </div>

        {today.length === 0 ? (
          <div className="hc-card" style={{ textAlign: "center", padding: "28px 18px" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Tidak ada jadwal hari ini</div>
            <div className="pbs-muted" style={{ marginTop: 4 }}>
              {next?.day ? `Jadwal berikutnya ${fmtLongDate(next.day)}${next.startText ? ` · ${next.startText}` : ""} · ${next.brand}.` : "Belum ada jadwal berikutnya."}
            </div>
          </div>
        ) : (
          today.map((s) => <SessionCard key={s.title || s.id} s={s} now={now} shift={shift} pending={!!action.pending} busy={busy} onAbsen={() => absen(s)} action={action} />)
        )}

        <ScoreCard host={host} thresholds={props.thresholds} scoreTx={props.scoreTx} clockIns={props.clockIns} revisions={revisions.length} now={now} onOpen={() => action.fire("NAV", { target: "SCORE" })} />

        <div style={{ textAlign: "center" }}>
          <button type="button" className="pbs-link" onClick={() => action.fire("NAV", { target: "REPORTS" })}>
            Lihat semua report saya
          </button>
        </div>
      </div>
    </div>
  );
}

function ShiftCard(props: { shift: Shift; hasToday: boolean; maxHours: number; onIn: () => void; onOut: () => void }): React.ReactElement {
  const { shift } = props;
  if (shift.state === "IN") {
    return (
      <div className="hc-card hc-shift">
        <div className="hc-shift-h">
          <span className="hc-ic ok">
            <Icon name="clock" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Shift berjalan {fmtDur(shift.minutes)}</div>
            <div className="pbs-muted" style={{ fontSize: 12.5 }}>
              Clock in {fmtTime(shift.since)}
              {shift.office ? ` · ${shift.office}` : ""}
            </div>
          </div>
          <Badge tone="success">Aktif</Badge>
        </div>
        {shift.overdue ? (
          <InfoBanner tone="warn">
            Shift sudah lebih dari {props.maxHours} jam. Lupa clock out? Clock out sekarang supaya jam kerjamu tercatat benar.
          </InfoBanner>
        ) : null}
        <button type="button" className="pbs-btn secondary hc-big" onClick={props.onOut}>
          Clock out
        </button>
      </div>
    );
  }
  if (shift.state === "OUT") {
    return (
      <div className="hc-card hc-shift-h">
        <span className="hc-ic ok">
          <Icon name="check" size={20} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Shift hari ini selesai</div>
          <div className="pbs-muted" style={{ fontSize: 12.5 }}>
            {fmtTime(shift.since)}–{fmtTime(shift.until)} · {fmtDur(shift.minutes)}
            {shift.office ? ` · ${shift.office}` : ""}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="hc-card hc-shift">
      <div className="hc-shift-h">
        <span className="hc-ic">
          <Icon name="mapPin" size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Belum clock in</div>
          <div className="pbs-muted" style={{ fontSize: 12.5 }}>
            {props.hasToday ? "Clock in di studio sebelum sesi pertama. Tanpa clock in, absen dan report tidak bisa dikirim." : "Tidak ada jadwal hari ini."}
          </div>
        </div>
      </div>
      <button type="button" className={`pbs-btn ${props.hasToday ? "primary" : "secondary"} hc-big`} onClick={props.onIn}>
        <Icon name="clock" size={18} /> Clock in
      </button>
      <p className="hc-note">Lokasi kamu diperiksa di layar clock in, sekali saat tombol ditekan.</p>
    </div>
  );
}

function SessionCard(props: { s: HostSession; now: Date; shift: Shift; pending: boolean; busy: boolean; onAbsen: () => void; action: UseActionResult }): React.ReactElement {
  const { s, now, action } = props;
  const live = !!s.start && !!s.end && s.start <= now && now <= s.end;
  const dur = s.start && s.end ? Math.round((s.end.getTime() - s.start.getTime()) / 60000) : null;
  let right: React.ReactNode;
  switch (s.phase) {
    case "UPCOMING":
      right = <Badge tone="neutral">{s.start ? `Mulai ${until(now, s.start)}` : "Belum dimulai"}</Badge>;
      break;
    case "NOW":
      right = s.clockedIn ? (
        <Button size="sm" onClick={props.onAbsen} disabled={props.pending}>
          {props.busy ? <Spinner small /> : null} Absen
        </Button>
      ) : (
        <Badge tone="warning">Clock in dulu</Badge>
      );
      break;
    case "NEEDS_ABSEN":
      right = (
        <Button size="sm" onClick={props.onAbsen} disabled={props.pending}>
          {props.busy ? <Spinner small /> : null} Absen
        </Button>
      );
      break;
    case "NEEDS_CLOCKIN":
      right = <Badge tone="warning">Tanpa clock in</Badge>;
      break;
    case "NEEDS_REPORT":
      right = (
        <>
          <Badge tone="success">Absen tercatat</Badge>
          <Button size="sm" onClick={() => action.fire("NEW_REPORT", sessionRef(s))}>
            Kirim report
          </Button>
        </>
      );
      break;
    case "NO_REPORT":
      right = <Badge tone="success">{s.noReport === "CO_HOST" ? "Co-Host · tanpa report" : "Live break · tanpa report"}</Badge>;
      break;
    case "REVISION":
      right = (
        <Button variant="secondary" size="sm" onClick={() => s.report && action.fire("OPEN_REPORT", reportRef(s.report))}>
          Perbaiki report
        </Button>
      );
      break;
    case "REPORTED": {
      const st = hostReportBadge(s.report, s.reportState ?? "WAITING");
      right = (
        <>
          <Badge tone={st.tone}>{st.label}</Badge>
          <button type="button" className="pbs-link" onClick={() => s.report && action.fire("OPEN_REPORT", reportRef(s.report))}>
            Lihat
          </button>
        </>
      );
      break;
    }
    default:
      right = <Badge tone="neutral">{PHASE_LABEL[s.phase].label}</Badge>;
  }
  const cls = live && (s.phase === "NOW" || s.phase === "NEEDS_ABSEN") ? " now" : s.phase === "REVISION" ? " bad" : s.phase === "REPORTED" ? " off" : "";
  return (
    <div className={`hc-sess${cls}`}>
      <div className="hc-time">
        {s.startText || "—"}–{s.endText || "—"}
        <small>{live ? "sedang live" : dur ? fmtDur(dur) : ""}</small>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="hc-sess-t">
          <button type="button" className="hc-today-n" onClick={() => action.fire("OPEN_SCHEDULE", sessionRef(s))} title="Buka detail sesi">
            {s.brand}
          </button>{" "}
          {s.platform ? <span className="hc-plat">{s.platform}</span> : null}
        </div>
        <div className="hc-sess-m">
          {[s.studio !== "—" ? s.studio : "", s.account ? `Akun ${s.account}` : "", s.title].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="hc-sess-a">{right}</div>
    </div>
  );
}

function ScoreCard(props: { host: Row | undefined; thresholds: Row[]; scoreTx: Row[]; clockIns: Row[]; revisions: number; now: Date; onOpen: () => void }): React.ReactElement | null {
  const score = scoreOf(props.host);
  const bands = React.useMemo(() => parseBands(props.thresholds), [props.thresholds]);
  const band = bandOf(score, bands);
  const weekAgo = props.now.getTime() - 7 * 864e5;
  const delta = props.scoreTx
    .filter((t) => !/cancel|batal|void/i.test(str(t, "Status")) && (date(t, "CreatedDate", "Created")?.getTime() ?? 0) >= weekAgo)
    .reduce((a, t) => a + (num(t, "Point", "Points") ?? 0), 0);
  const streak = streakDays(props.clockIns, props.now);
  if (score === null && streak === 0) return null;
  return (
    <div className="hc-card hc-score">
      <div>
        <div className="pbs-sec-l" style={{ color: "var(--tx2)", marginBottom: 6 }}>
          Skor kamu
        </div>
        <span className="hc-score-n pbs-num">{score === null ? "—" : fmtNumber(score)}</span>{" "}
        {band ? (
          <Badge tone={band.tone} small>
            {band.label}
          </Badge>
        ) : null}
        {delta !== 0 ? (
          <div className={`hc-score-d ${delta > 0 ? "pbs-t-ok" : "pbs-t-bad"}`}>
            {delta > 0 ? "▲ +" : "▼ "}
            {fmtNumber(delta)} minggu ini
          </div>
        ) : null}
      </div>
      <div className="hc-score-x">
        {streak > 0 ? `Streak ${streak} hari berturut` : "Belum ada streak"}
        {props.revisions > 0 ? ` · ${props.revisions} report perlu revisi` : ""}
      </div>
      <Button variant="secondary" size="sm" onClick={props.onOpen}>
        Lihat rincian
      </Button>
    </div>
  );
}

function Loading(): React.ReactElement {
  return (
    <div className="hc-col" aria-busy="true">
      <Skeleton w="55%" h={24} />
      <Skeleton w="75%" h={12} style={{ marginTop: 10, marginBottom: 20 }} />
      <div className="hc-stack">
        <Skeleton h={150} r={8} />
        <Skeleton h={70} r={8} />
        <Skeleton h={70} r={8} />
        <Skeleton h={70} r={8} />
      </div>
    </div>
  );
}
