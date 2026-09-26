import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { NO_REPORT_LABEL, Row, date, localDayKey, reportPlaybook, reportScheduleId, rowId, str } from "../../../shared/data";
import { fmtDayMonth, fmtLongDate, fmtRupiah, fmtTime } from "../../../shared/format";
import {
  BLOCKER_TEXT,
  HOST_REPORT_STATE,
  HostOptions,
  HostSession,
  ReportBlocker,
  buildHostSessions,
  fmtMinutes,
  hostOptions,
  hostReportBadge,
  reportBlocker,
  reportLiveId,
  reportMinutes,
  reviewerNote,
} from "../../../shared/hostApp";
import { SCHEDULE_STATE, SessionStep, StepState, clockInOf, durationMin, fmtHours, isLive, positionOf, scheduleState, sessionSteps } from "../../../shared/hostSchedule";
import { ALL_METRICS, readMetric, reviewState } from "../../../shared/reconcile";
import { Coverage, PageHead, Revision, SubmitReport } from "../../../shared/hostReport";
import { useAbsen } from "../../../shared/hostAbsen";
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
  /** Report.Playbook choices; empty = Context config.playbooks, else the defaults. */
  playbooks?: string[];
}

const WRITES = ["SUBMIT_REPORT", "RESUBMIT_REPORT", "DISPUTE_REVIEW"];

const scheduleRef = (s: HostSession): Record<string, unknown> => ({
  scheduleId: s.title,
  scheduleItemId: s.id,
  liveDate: s.dayKey,
});
const reportRef = (r: Row): Record<string, unknown> => ({
  reportId: rowId(r),
  title: str(r, "Title"),
  scheduleId: reportScheduleId(r),
});

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

const STEP_ICON: Record<StepState, IconName> = {
  done: "check",
  now: "clock",
  todo: "clock",
  missing: "alert",
  bad: "alert",
  skip: "x",
};

export function ScheduleDetailView(props: ScheduleDetailProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const host = props.host[0];
  const sessions = React.useMemo(
    () =>
      buildHostSessions(
        {
          schedules: props.schedules,
          clockIns: props.clockIns,
          absences: props.absences,
          reports: props.reports,
          brands: props.brands,
          studios: props.studios,
        },
        now,
        opts,
      ),
    [props.schedules, props.clockIns, props.absences, props.reports, props.brands, props.studios, now, opts],
  );
  const want = props.scheduleId.trim().toLowerCase();
  const s = want ? sessions.find((x) => x.title.toLowerCase() === want || x.id === props.scheduleId.trim()) : sessions[0];
  const back = () => action.fire("BACK", {});
  const absen = useAbsen(action, host, opts);
  const [formOpen, setFormOpen] = React.useState(false);
  const formRef = React.useRef<HTMLElement>(null);
  const [scrollTo, setScrollTo] = React.useState(0);
  React.useEffect(() => {
    const el = formRef.current;
    if (!scrollTo || !el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true });
  }, [scrollTo]);
  const toForm = () => {
    setFormOpen(true);
    setScrollTo((n) => n + 1);
  };

  if (props.loading && !s) return <Loading onBack={back} />;
  if (!s) {
    return (
      <div className="hc-col">
        <Crumb onBack={back} />
        <EmptyState
          icon="calendar"
          title="Jadwal tidak ditemukan"
          text={props.scheduleId ? `${props.scheduleId} tidak ada di jadwalmu, atau sudah dihapus tim PBS.` : "Pilih sesi dari Jadwal saya."}
          action={
            <Button variant="secondary" size="sm" onClick={back}>
              Kembali ke Jadwal saya
            </Button>
          }
        />
      </div>
    );
  }

  const st = scheduleState(s, now);
  const clockIn = clockInOf(s, props.clockIns);
  const steps = sessionSteps(s, clockIn, now, opts, {
    time: fmtTime,
    day: dayText,
  });
  const dur = durationMin(s);
  const sameDay = sessions.filter((x) => x.dayKey === s.dayKey && x.title !== s.title && x.phase !== "CANCELLED");
  const today = s.dayKey === localDayKey(now);
  const busy = action.pending?.action === "ABSEN";
  const position = positionOf(s.row);
  const status = str(s.row, "Status");
  const res = action.lastResult;
  const blocker = st === "CANCELLED" ? "NO_REPORT" : reportBlocker(s, opts);
  const justSent = res?.action === "SUBMIT_REPORT" && res.status === "ok";
  // Send Report: only while Schedule.Status is Waiting Report and minutes are still owed. Gone once
  // the parts cover the session, for a live break and for a Co-Host.
  const sendVisible = blocker !== "NO_REPORT" && blocker !== "COMPLETE";
  const canSend = blocker === null;
  const showForm = (formOpen && canSend) || (justSent && formOpen);
  const showRevision = st === "REVISION" && !!s.report;
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
    playbooks: props.playbooks,
  };
  const sendTitle = blocker === "STATUS" ? `Status jadwal masih ${status || "Planned"}. Report hanya bisa dikirim saat status ${opts.waitingStatus}.` : blocker ? BLOCKER_TEXT[blocker] : undefined;

  return (
    <div className="hc-col">
      <PageHead
        crumb={
          <>
            <button type="button" className="pbs-link" onClick={back}>
              Jadwal saya
            </button>{" "}
            / <span className="hc-id">{s.title}</span>
          </>
        }
        title={
          <>
            {s.brand} · {dayText(s.day)}
          </>
        }
        sub={[`${s.startText || "—"}–${s.endText || "—"}`, s.studio !== "—" ? (/^studio\b/i.test(s.studio) ? s.studio : `Studio ${s.studio}`) : "", s.platform].filter(Boolean).join(" · ")}
        right={
          <>
            {s.canAbsen && s.clockedIn ? (
              <Button variant="secondary" onClick={() => absen.start(s)} disabled={!!action.pending}>
                {busy ? <Spinner small /> : null} Absen
              </Button>
            ) : today && !s.clockedIn && st !== "CANCELLED" && s.phase !== "REPORTED" ? (
              <Button variant="secondary" onClick={() => action.fire("CLOCK_IN", {})}>
                <Icon name="mapPin" size={14} /> Clock in
              </Button>
            ) : null}
            {sendVisible ? (
              <Button onClick={toForm} disabled={!canSend || showForm} title={sendTitle}>
                <Icon name="file" size={14} /> {s.partial ? "Send Report berikutnya" : "Send Report"}
              </Button>
            ) : s.noReport ? (
              <Badge tone="success">{NO_REPORT_LABEL[s.noReport]} · tanpa report</Badge>
            ) : null}
          </>
        }
      />

      <div className="hc-rec">
        <Rec k="Schedule ID" v={s.title || "—"} mono />
        <Rec k="Brand" v={s.brand} />
        <Rec k="Akun" v={s.account || "—"} />
        <Rec k="Platform" v={s.platform || "—"} />
        <Rec k="Studio" v={s.studio} />
        <Rec k="Durasi" v={fmtHours(dur)} />
        {position ? <Rec k="Posisi" v={position} /> : null}
        <span className="hc-rec-r">
          <Badge tone={SCHEDULE_STATE[st].tone}>{s.partial && st !== "REVISION" ? `Kurang ${s.remainingMin} menit` : SCHEDULE_STATE[st].label}</Badge>
        </span>
      </div>

      <ResultBanner
        result={res && WRITES.includes(res.action) && res.status !== "ok" ? null : res}
        okText={res?.action === "ABSEN" ? (s.noReport || s.reports.length ? "Absen tercatat. Sesi ini tidak perlu report." : "Absen tercatat. Sekarang kamu bisa kirim report sesi ini.") : undefined}
        onClose={action.clearResult}
      />

      <div className="hc-split">
        <div className="hc-main">
          <NextStep
            s={s}
            now={now}
            busy={busy}
            pending={!!action.pending}
            onAbsen={() => absen.start(s)}
            action={action}
            opts={opts}
            today={today}
            onForm={canSend ? toForm : null}
            blocker={blocker}
          />

          {showForm ? (
            <section ref={formRef} className="hc-form" id="hc-report" aria-label="Report sesi ini">
              <div className="pbs-sec" style={{ marginTop: 4 }}>
                <span className="pbs-sec-l">{s.reports.length ? `Report ke-${s.reports.length + 1}` : "Send Report"}</span>
                <span className="pbs-sec-r">Live ID · durasi · angka · screenshot</span>
              </div>
              <SubmitReport key={s.title} {...formProps} />
              {!justSent ? (
                <div style={{ marginTop: 8 }}>
                  <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                    Tutup form
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {showRevision && s.report ? (
            <section className="hc-form" id="hc-revision" aria-label="Revisi report">
              <div className="pbs-sec" style={{ marginTop: 4 }}>
                <span className="pbs-sec-l">Revisi report</span>
                <span className="pbs-sec-r">{str(s.report, "Title")}</span>
              </div>
              <Revision key={str(s.report, "Title")} {...formProps} report={s.report} />
            </section>
          ) : null}

          {s.reports.length ? <ReportsCard s={s} revising={showRevision ? s.report : undefined} onOpen={(r) => action.fire("OPEN_REPORT", reportRef(r))} /> : null}

          <div className="hc-card">
            <div className="pbs-sec">
              <span className="pbs-sec-l">Waktu &amp; tempat</span>
            </div>
            <dl className="hc-kv two">
              <Fact k="Tanggal" v={s.day ? fmtLongDate(s.day) : "—"} />
              <Fact k="Studio" v={s.studio} />
              <Fact k="Jam live" v={`${s.startText || "—"}–${s.endText || "—"}`} />
              <Fact k="Akun" v={s.account || "—"} />
              <Fact k="Absen dibuka" v={s.start ? `${fmtTime(new Date(s.start.getTime() - opts.absenLeadMin * 60000))} (${opts.absenLeadMin} menit sebelum)` : "—"} />
              <Fact k="Status jadwal" v={status || "Planned"} />
              <Fact k="Batas report" v={s.noReport ? "Tidak perlu report" : dayText(s.due)} />
              {position ? <Fact k="Posisi" v={position} /> : null}
            </dl>
          </div>
        </div>

        <aside className="hc-aside">
          {!s.noReport && st !== "CANCELLED" && s.requiredMin && (s.reports.length || st === "NEEDS_REPORT" || st === "LATE") ? (
            <div className="hc-card">
              <div className="pbs-sec">
                <span className="pbs-sec-l">Durasi report</span>
              </div>
              <Coverage session={s} />
              <p className="pbs-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
                Live terputus? Kirim satu report per Live ID. Status jadwal tetap {opts.waitingStatus} sampai total durasi mencapai {s.requiredMin} menit, lalu menjadi {opts.doneStatus}.
              </p>
            </div>
          ) : null}

          <div className="hc-card">
            <div className="pbs-sec">
              <span className="pbs-sec-l">Langkah sesi</span>
            </div>
            <ol className="hc-steps">
              {steps.map((x, i) => (
                <Step key={x.key} n={i + 1} step={x} />
              ))}
            </ol>
          </div>

          {sameDay.length ? (
            <div className="hc-card">
              <div className="pbs-sec">
                <span className="pbs-sec-l">Sesi lain {today ? "hari ini" : `di ${dayText(s.day)}`}</span>
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
        </aside>
      </div>
      {absen.dialog}
    </div>
  );
}

function Rec(props: { k: string; v: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="hc-rec-i">
      <span className="k">{props.k}</span>
      <span className={`v${props.mono ? " hc-id" : ""}`}>{props.v}</span>
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
      <span className="pbs-sr">
        {
          {
            done: "selesai",
            now: "sekarang",
            todo: "belum",
            missing: "tidak ada",
            bad: "perlu perhatian",
            skip: "tidak dipakai",
          }[step.state]
        }
      </span>
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
  opts: HostOptions;
  today: boolean;
  /** Opens the report form on this screen; null while a report cannot be sent. */
  onForm: (() => void) | null;
  blocker: ReportBlocker | null;
}): React.ReactElement | null {
  const { s, now, action, opts } = props;
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
      text = `Absen dibuka ${opts.absenLeadMin} menit sebelum sesi mulai${s.clockedIn ? "." : props.today ? " — clock in dulu di studio." : ". Clock in di studio pada hari live."}`;
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
        text = s.noReport
          ? "Absen menandai kamu hadir di sesi ini. Sesi ini tidak perlu report."
          : "Absen menandai kamu hadir di sesi ini. Kamu akan ditanya apakah sesi ini Live Break; kalau bukan, kirim report lewat Send Report.";
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
      if (s.partial) {
        title = `Report belum lengkap — kurang ${fmtMinutes(s.remainingMin)}`;
        text = `Sudah dilaporkan ${s.reportedMin} dari ${s.requiredMin} menit dalam ${s.reports.length} report. Silakan kirim report berikutnya untuk sisa live (Live ID berikutnya).`;
      } else {
        title = st === "LATE" ? "Report terlambat" : "Kirim report sesi ini";
        text = st === "LATE" ? `Batasnya ${dayText(s.due)}. Kirim sekarang dan jelaskan di catatan.` : `Kirim sebelum ${dayText(s.due)}.`;
        text += " Tekan Send Report, isi Live ID, durasi, angka, dan screenshot.";
      }
      if (props.blocker === "STATUS") {
        tone = "warn";
        title = `Menunggu status ${opts.waitingStatus}`;
        text = `Status jadwal masih ${str(s.row, "Status") || "Planned"}. Send Report terbuka saat status ${opts.waitingStatus} — biasanya langsung setelah absen. Kalau sudah absen tapi status belum berubah, hubungi tim PBS.`;
      }
      btn = props.onForm ? (
        <Button size="sm" onClick={props.onForm}>
          {s.partial ? "Send Report berikutnya" : "Send Report"}
        </Button>
      ) : null;
      break;
    case "REVISION":
      tone = "bad";
      icon = "alert";
      title = "Report perlu revisi";
      text = "Reviewer mengembalikan report ini. Perbaiki angka yang ditandai atau kirim sanggahan.";
      btn = (
        <Button size="sm" onClick={() => document.getElementById("hc-revision")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>
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
      text = s.reportState
        ? `Report ${HOST_REPORT_STATE[s.reportState].label.toLowerCase()}.`
        : s.noReport
          ? `Tidak perlu report — ${s.noReport === "CO_HOST" ? "kamu Co-Host di sesi ini" : "sesi ini live break"}.`
          : "Semua langkah sudah selesai.";
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

/** Every report of the session: a live that dropped has one per Live ID. */
function ReportsCard(props: { s: HostSession; revising: Row | undefined; onOpen: (r: Row) => void }): React.ReactElement {
  const { s } = props;
  const pen = ALL_METRICS.find((d) => d.key === "Penjualan");
  return (
    <div className="hc-card">
      <div className="pbs-sec">
        <span className="pbs-sec-l">Report sesi ini · {s.reports.length}</span>
        <span className="pbs-sec-r">{s.requiredMin ? `${s.reportedMin} dari ${s.requiredMin} menit` : ""}</span>
      </div>
      <div className="hc-stack" style={{ gap: 0 }}>
        {s.reports.map((r, i) => {
          const rs = reviewState(r);
          const b = hostReportBadge(r, rs);
          const note = rs === "REVISION" ? reviewerNote(str(r, "ApprovalComment")) : "";
          const min = reportMinutes(r);
          return (
            <div key={str(r, "Title") || i} className={`hc-part${rs === "REVISION" ? " bad" : ""}`}>
              <span className="n">{i + 1}</span>
              <span style={{ minWidth: 0 }}>
                <b className="pbs-num">{str(r, "Title") || "Report baru"}</b>
                <span className="pbs-muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                  {[
                    reportLiveId(r) ? `Live ID ${reportLiveId(r)}` : "",
                    min !== null ? `${min} menit` : "durasi kosong",
                    pen ? fmtRp(readMetric(r, pen)) : "",
                    reportPlaybook(r),
                    `dikirim ${fmtDayMonth(date(r, "Created", "CreatedDate"))} ${fmtTime(date(r, "Created", "CreatedDate"))}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {note ? (
                  <span className="pbs-t-bad" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                    “{note}”
                  </span>
                ) : null}
              </span>
              <Badge tone={b.tone} title={str(r, "ApprovalStatus")}>
                {b.label}
              </Badge>
              <button type="button" className="pbs-link" onClick={() => props.onOpen(r)}>
                {rs === "REVISION" && props.revising !== r ? "Perbaiki" : "Lihat"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fmtRp = (v: number | null): string => (v === null ? "" : fmtRupiah(v));

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
