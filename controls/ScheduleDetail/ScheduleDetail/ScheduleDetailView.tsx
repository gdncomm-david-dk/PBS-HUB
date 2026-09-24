import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row, date, localDayKey, rowId, str } from "../../../shared/data";
import { fmtDayMonth, fmtLongDate, fmtRupiah, fmtNumber, fmtPercentValue, fmtTime } from "../../../shared/format";
import { HOST_REPORT_STATE, HostSession, buildHostSessions, flaggedFromComment, hostOptions, reviewerNote } from "../../../shared/hostApp";
import { SCHEDULE_STATE, SessionStep, StepState, clockInOf, durationMin, fmtHours, isLive, positionOf, scheduleState, sessionSteps } from "../../../shared/hostSchedule";
import { ALL_METRICS, readMetric } from "../../../shared/reconcile";
import { Revision, SubmitReport } from "../../../shared/hostReport";
import { Badge, Button, EmptyState, Icon, IconName, InfoBanner, ResultBanner, Skeleton, Spinner } from "../../../shared/ui";

export interface ScheduleDetailProps {
  ctx: ModuleContext;
  scheduleId: string;
  host: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  reports: Row[];
  /** Report Automation rows of these reports (revision compares against them). */
  evidence: Row[];
  /** The host's earlier reports on the same platform (sanity warnings on the form). */
  history: Row[];
  brands: Row[];
  studios: Row[];
  loading: boolean;
  now: Date;
  action: UseActionResult;
  /** Screenshot for the next SUBMIT_REPORT / RESUBMIT_REPORT, sent on UploadData. */
  setUpload: (data: string) => void;
}

const WRITES = ["SUBMIT_REPORT", "RESUBMIT_REPORT", "DISPUTE_REVIEW"];

const scheduleRef = (s: HostSession): Record<string, unknown> => ({ scheduleId: s.title, scheduleItemId: s.id, liveDate: s.dayKey });
const reportRef = (r: Row): Record<string, unknown> => ({ reportId: rowId(r), title: str(r, "Title"), scheduleId: str(r, "ScheduleID") });

function absenPayload(s: HostSession, host: Row | undefined): Record<string, unknown> {
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

function until(from: Date, to: Date): string {
  const m = Math.round((to.getTime() - from.getTime()) / 60000);
  if (m <= 0) return "sekarang";
  if (m < 60) return `${m} menit lagi`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} jam ${m % 60} menit lagi` : `${h} jam lagi`;
  }
  return `${Math.round(m / 1440)} hari lagi`;
}

const dayText = (d: Date | null): string => (d ? `${fmtLongDate(d).split(",")[0]} ${fmtDayMonth(d)}` : "—");

const STEP_ICON: Record<StepState, IconName> = { done: "check", now: "clock", todo: "clock", missing: "alert", bad: "alert", skip: "x" };

export function ScheduleDetailView(props: ScheduleDetailProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const host = props.host[0];
  const sessions = React.useMemo(
    () => buildHostSessions({ schedules: props.schedules, clockIns: props.clockIns, absences: props.absences, reports: props.reports, brands: props.brands, studios: props.studios }, now, opts),
    [props.schedules, props.clockIns, props.absences, props.reports, props.brands, props.studios, now, opts],
  );
  const want = props.scheduleId.trim().toLowerCase();
  const s = want ? sessions.find((x) => x.title.toLowerCase() === want || x.id === props.scheduleId.trim()) : sessions[0];
  const back = () => action.fire("BACK", {});
  const formRef = React.useRef<HTMLElement>(null);
  const toForm = () => {
    const el = formRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true });
  };

  if (props.loading && !s) return <Loading onBack={back} />;
  if (!s) {
    return (
      <div className="hc-col">
        <Crumb onBack={back} />
        <EmptyState icon="calendar" title="Jadwal tidak ditemukan" text={props.scheduleId ? `${props.scheduleId} tidak ada di jadwalmu, atau sudah dihapus tim PBS.` : "Pilih sesi dari Jadwal saya."} action={<Button variant="secondary" size="sm" onClick={back}>Kembali ke Jadwal saya</Button>} />
      </div>
    );
  }

  const st = scheduleState(s, now);
  const clockIn = clockInOf(s, props.clockIns);
  const steps = sessionSteps(s, clockIn, now, opts, { time: fmtTime, day: dayText });
  const dur = durationMin(s);
  const sameDay = sessions.filter((x) => x.dayKey === s.dayKey && x.title !== s.title && x.phase !== "CANCELLED");
  const today = s.dayKey === localDayKey(now);
  const busy = action.pending?.action === "ABSEN";
  const position = positionOf(s.row);
  const status = str(s.row, "Status");
  // Absen and the report both happen here: the form opens once the host clocked in on the session day.
  const showForm = !s.report && s.clockedIn && s.phase !== "UPCOMING" && st !== "CANCELLED";
  const showRevision = st === "REVISION" && !!s.report;
  const res = action.lastResult;
  const formProps = {
    ctx,
    host: props.host,
    report: s.report ? [s.report] : [],
    schedule: [s.row],
    evidence: s.report ? props.evidence.filter((e) => str(e, "Title").toLowerCase() === str(s.report, "Title").toLowerCase()) : [],
    clockIns: props.clockIns,
    absences: props.absences,
    history: props.history,
    brands: props.brands,
    studios: props.studios,
    loading: props.loading,
    now,
    action,
    setUpload: props.setUpload,
    session: s,
    embedded: true,
  };

  return (
    <div className="hc-col">
      <Crumb onBack={back} />
      <div className="hc-hi">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {s.brand} {s.platform ? <span className="hc-plat">{s.platform}</span> : null}
          </h1>
          <p>
            <span className="hc-id">{s.title}</span> · {s.day ? fmtLongDate(s.day) : "—"} · {s.startText || "—"}–{s.endText || "—"}
          </p>
        </div>
        <Badge tone={SCHEDULE_STATE[st].tone}>{SCHEDULE_STATE[st].label}</Badge>
      </div>

      <ResultBanner result={res && WRITES.includes(res.action) && res.status !== "ok" ? null : res} okText={action.lastResult?.action === "ABSEN" ? "Absen tercatat. Sekarang kamu bisa kirim report sesi ini." : undefined} onClose={action.clearResult} />

      <div className="hc-stack">
        <NextStep s={s} now={now} busy={busy} pending={!!action.pending} onAbsen={() => action.dispatch("ABSEN", absenPayload(s, host))} action={action} absenLeadMin={opts.absenLeadMin} today={today} onForm={showForm || showRevision ? toForm : null} />

        {showForm || showRevision ? (
          <section ref={formRef} className="hc-form" id="hc-report" aria-label="Report sesi ini">
            <div className="pbs-sec" style={{ marginTop: 4 }}>
              <span className="pbs-sec-l">{showRevision ? "Revisi report" : "Report sesi ini"}</span>
              <span className="pbs-sec-r">{showRevision ? str(s.report, "Title") : s.absence || !opts.requireAbsen ? "isi angka + screenshot" : "absen dulu, angka bisa diisi sekarang"}</span>
            </div>
            {showRevision && s.report ? <Revision key={s.title} {...formProps} report={s.report} /> : <SubmitReport key={s.title} {...formProps} />}
          </section>
        ) : null}

        <div className="hc-card">
          <div className="pbs-sec-l" style={{ marginBottom: 4 }}>
            Langkah sesi
          </div>
          <ol className="hc-steps">
            {steps.map((x, i) => (
              <Step key={x.key} n={i + 1} step={x} />
            ))}
          </ol>
        </div>

        <div className="hc-card">
          <div className="pbs-sec-l" style={{ marginBottom: 12 }}>
            Detail jadwal
          </div>
          <dl className="hc-dl">
            <Fact k="Tanggal" v={s.day ? fmtLongDate(s.day) : "—"} />
            <Fact k="Waktu" v={`${s.startText || "—"}–${s.endText || "—"}`} />
            <Fact k="Durasi" v={fmtHours(dur)} />
            <Fact k="Studio" v={s.studio} />
            <Fact k="Platform" v={s.platform || "—"} />
            <Fact k="Akun" v={s.account || "—"} />
            {position ? <Fact k="Posisi" v={position} /> : null}
            <Fact k="Schedule ID" v={s.title || "—"} mono />
            <Fact k="Status jadwal" v={status || "Planned"} />
          </dl>
        </div>

        {s.report && !showRevision ? <ReportCard report={s.report} onOpen={() => s.report && action.fire("OPEN_REPORT", reportRef(s.report))} revision={st === "REVISION"} /> : null}

        {sameDay.length ? (
          <div className="hc-card">
            <div className="pbs-sec-l" style={{ marginBottom: 8 }}>
              Sesi lain {today ? "hari ini" : `di ${dayText(s.day)}`}
            </div>
            <div className="hc-stack" style={{ gap: 0 }}>
              {sameDay.map((x) => {
                const xs = scheduleState(x, now);
                return (
                  <button key={x.title || x.id} type="button" className="hc-other" onClick={() => action.fire("OPEN_SCHEDULE", scheduleRef(x))}>
                    <span className="pbs-num hc-b">
                      {x.startText}–{x.endText}
                    </span>
                    <span className="hc-ell">
                      {x.brand}
                      <span className="pbs-muted"> · {[x.platform, x.studio !== "—" ? x.studio : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Badge tone={SCHEDULE_STATE[xs].tone}>{SCHEDULE_STATE[xs].label}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Crumb(props: { onBack: () => void }): React.ReactElement {
  return (
    <button type="button" className="pbs-link hc-crumb" onClick={props.onBack}>
      <Icon name="arrowLeft" size={14} /> Jadwal saya
    </button>
  );
}

function Fact(props: { k: string; v: string; mono?: boolean }): React.ReactElement {
  return (
    <div>
      <dt>{props.k}</dt>
      <dd className={props.mono ? "hc-id" : undefined}>{props.v}</dd>
    </div>
  );
}

function Step(props: { n: number; step: SessionStep }): React.ReactElement {
  const { step } = props;
  return (
    <li className={`hc-step ${step.state}`}>
      <span className={`hc-dot ${step.state}`} aria-hidden="true">
        {step.state === "todo" ? props.n : <Icon name={STEP_ICON[step.state]} size={14} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="hc-step-t">{step.label}</div>
        <div className="hc-step-x">{step.text}</div>
      </div>
      <span className="pbs-sr">{{ done: "selesai", now: "sekarang", todo: "belum", missing: "tidak ada", bad: "perlu perhatian", skip: "tidak dipakai" }[step.state]}</span>
    </li>
  );
}

/** The one thing to do now, with its button. */
function NextStep(props: {
  s: HostSession;
  now: Date;
  busy: boolean;
  pending: boolean;
  onAbsen: () => void;
  action: UseActionResult;
  absenLeadMin: number;
  today: boolean;
  /** Scrolls to the report form on this screen; null when there is none. */
  onForm: (() => void) | null;
}): React.ReactElement | null {
  const { s, now, action } = props;
  const st = scheduleState(s, now);
  let tone = "";
  let icon: IconName = "clock";
  let title: string;
  let text: string;
  let btn: React.ReactNode = null;
  switch (st) {
    case "CANCELLED":
      return (
        <InfoBanner tone="warn" icon="x">
          Sesi ini dibatalkan. Tidak perlu clock in, absen, atau report.
        </InfoBanner>
      );
    case "PLANNED":
      title = s.start ? `Mulai ${until(now, s.start)}` : "Belum dimulai";
      text = `Absen dibuka ${props.absenLeadMin} menit sebelum sesi mulai${s.clockedIn ? "." : props.today ? " — clock in dulu di studio." : ". Clock in di studio pada hari live."}`;
      icon = "calendar";
      if (props.today && !s.clockedIn)
        btn = (
          <Button size="sm" onClick={() => action.fire("CLOCK_IN", {})}>
            <Icon name="mapPin" size={14} /> Clock in
          </Button>
        );
      break;
    case "SOON":
    case "LIVE":
    case "NEEDS_ABSEN":
      if (!s.clockedIn) {
        tone = "warn";
        icon = "mapPin";
        title = "Clock in dulu";
        text = "Tanpa clock in di hari ini, absen dan report tidak bisa dikirim.";
        btn = (
          <Button size="sm" onClick={() => action.fire("CLOCK_IN", {})}>
            <Icon name="mapPin" size={14} /> Clock in
          </Button>
        );
      } else if (s.canAbsen) {
        tone = "now";
        icon = "checkSquare";
        title = isLive(s, now) ? "Sesi sedang live — absen sekarang" : "Absen sekarang";
        text = "Absen menandai kamu hadir di sesi ini. Setelah itu report di bawah bisa dikirim.";
        btn = (
          <Button size="sm" onClick={props.onAbsen} disabled={props.pending}>
            {props.busy ? <Spinner small /> : null} Absen
          </Button>
        );
      } else {
        title = isLive(s, now) ? "Sesi sedang live" : "Segera mulai";
        text = "Kirim report setelah sesi selesai.";
      }
      break;
    case "NEEDS_CLOCKIN":
      tone = "warn";
      icon = "mapPin";
      title = "Tidak ada clock in di hari ini";
      text = "Report tidak bisa dikirim tanpa clock in. Kalau kamu memang live, minta tim PBS menambahkan clock in manual.";
      break;
    case "NEEDS_REPORT":
    case "LATE":
      tone = st === "LATE" ? "bad" : "warn";
      icon = "file";
      title = st === "LATE" ? "Report terlambat" : "Kirim report sesi ini";
      text = st === "LATE" ? `Batasnya ${dayText(s.due)}. Kirim sekarang dan jelaskan di catatan.` : `Kirim sebelum ${dayText(s.due)}.`;
      text += " Isi angka dan screenshot di bawah.";
      btn = (
        <Button size="sm" onClick={() => (props.onForm ? props.onForm() : action.fire("NEW_REPORT", scheduleRef(s)))}>
          Isi report
        </Button>
      );
      break;
    case "REVISION":
      tone = "bad";
      icon = "alert";
      title = "Report perlu revisi";
      text = "Reviewer mengembalikan report ini. Perbaiki angka yang ditandai atau kirim sanggahan.";
      btn = (
        <Button size="sm" onClick={() => (props.onForm ? props.onForm() : s.report && action.fire("OPEN_REPORT", reportRef(s.report)))}>
          Lihat revisi
        </Button>
      );
      break;
    case "WAITING":
      icon = "clock";
      title = "Report terkirim, menunggu review";
      text = "Tidak ada yang perlu kamu lakukan sekarang.";
      break;
    default:
      tone = "ok";
      icon = "check";
      title = "Sesi selesai";
      text = s.reportState ? `Report ${HOST_REPORT_STATE[s.reportState].label.toLowerCase()}.` : "Semua langkah sudah selesai.";
  }
  return (
    <div className={`hc-todo${tone ? ` ${tone}` : ""}`}>
      <span className={`hc-ic${tone === "bad" ? " bad" : tone === "warn" ? " warn" : tone === "ok" ? " ok" : ""}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="hc-todo-b">
        <p className="hc-todo-t">{title}</p>
        <p className="hc-todo-x">{text}</p>
      </div>
      {btn}
    </div>
  );
}

const SUMMARY = ["Penjualan", "Pesanan", "CTR", "CTOR"];

function ReportCard(props: { report: Row; revision: boolean; onOpen: () => void }): React.ReactElement {
  const r = props.report;
  const flagged = props.revision ? flaggedFromComment(str(r, "ApprovalComment")) : [];
  const note = reviewerNote(str(r, "ApprovalComment"));
  const defs = SUMMARY.map((k) => ALL_METRICS.find((d) => d.key === k)).filter((d): d is (typeof ALL_METRICS)[number] => !!d);
  const fmt = (v: number | null, f: string) => (v === null ? "—" : f === "idr" ? fmtRupiah(v) : f === "pct" ? fmtPercentValue(v) : fmtNumber(v));
  return (
    <div className={`hc-card${props.revision ? " hc-bad" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div className="pbs-sec-l">Report {str(r, "Title")}</div>
        <button type="button" className="pbs-link" onClick={props.onOpen}>
          {props.revision ? "Perbaiki report" : "Lihat report"}
        </button>
      </div>
      <dl className="hc-dl">
        {defs.map((d) => (
          <div key={d.key} className={flagged.some((f) => f.key === d.key) ? "flag" : undefined}>
            <dt>{d.label}</dt>
            <dd className="pbs-num">{fmt(readMetric(r, d), d.format)}</dd>
          </div>
        ))}
      </dl>
      {note ? (
        <div className="hc-quote" style={{ marginTop: 12 }}>
          <Icon name="info" size={16} />
          <span>“{note}”</span>
        </div>
      ) : null}
      <div className="pbs-muted" style={{ fontSize: 12, marginTop: 10 }}>
        Dikirim {fmtDayMonth(date(r, "Created", "CreatedDate"))} {fmtTime(date(r, "Created", "CreatedDate"))}
      </div>
    </div>
  );
}

function Loading(props: { onBack: () => void }): React.ReactElement {
  return (
    <div className="hc-col" aria-busy="true">
      <Crumb onBack={props.onBack} />
      <Skeleton w="45%" h={24} />
      <Skeleton w="65%" h={12} style={{ marginTop: 10, marginBottom: 20 }} />
      <div className="hc-stack">
        <Skeleton h={80} r={8} />
        <Skeleton h={220} r={8} />
        <Skeleton h={140} r={8} />
      </div>
    </div>
  );
}
