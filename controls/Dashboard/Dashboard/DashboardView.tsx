import * as React from "react";
import { ModuleContext, configNumber, hasPermission } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { DashboardModel, SessionState, SessionToday, buildDashboard } from "../../../shared/dashboard";
import { fmtClock, fmtDayMonth, fmtLongDate, fmtNumber, fmtTime, shortName } from "../../../shared/format";
import { REASONS, Tone } from "../../../shared/reconcile";
import { Badge, Button, Dot, EmptyState, Icon, ModuleHeader, SectionHeader, Skeleton } from "../../../shared/ui";

export interface DashboardData {
  schedules: Row[];
  reports: Row[];
  evidence: Row[];
  clockIns: Row[];
  hosts: Row[];
  studios: Row[];
  brands: Row[];
  payrolls: Row[];
}

export interface DashboardViewProps {
  ctx: ModuleContext;
  data: DashboardData;
  loading: boolean;
  /** Fixed "now" for testing; null = device clock, re-rendered every minute. */
  referenceNow: Date | null;
  fire: (action: string, payload: unknown) => void;
}

const SESSION_BADGE: Record<SessionState, { tone: Tone; label: string }> = {
  live: { tone: "info", label: "Sedang live" },
  waitingReport: { tone: "warning", label: "Waiting report" },
  notStarted: { tone: "neutral", label: "Belum dimulai" },
  reported: { tone: "success", label: "Report masuk" },
  cancelled: { tone: "neutral", label: "Dibatalkan" },
};

function useNow(fixed: Date | null): Date {
  const [now, setNow] = React.useState(() => fixed ?? new Date());
  React.useEffect(() => {
    if (fixed) {
      setNow(fixed);
      return undefined;
    }
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, [fixed?.getTime()]);
  return now;
}

export function DashboardView(props: DashboardViewProps): React.ReactElement {
  const { ctx, data, loading, fire } = props;
  const now = useNow(props.referenceNow);
  const model = React.useMemo<DashboardModel>(
    () =>
      buildDashboard({
        ...data,
        now,
        maxShiftHours: configNumber(ctx, "maxShiftHours", 12),
        missingReportDays: configNumber(ctx, "missingReportDays", 2),
        reconcile: { tolerancePct: configNumber(ctx, "tolerancePct", 5), confidenceThreshold: configNumber(ctx, "confidenceThreshold", 0.85) },
      }),
    [data, now, ctx],
  );
  const nav = (target: string, extra?: Record<string, unknown>) => fire("NAV", { target, ...extra });
  const canSchedule = hasPermission(ctx, "SCHEDULE_CREATE");
  const canPayroll = hasPermission(ctx, "PAYROLL_VIEW");

  const subtitle = (
    <>
      {fmtLongDate(now)} · {fmtTime(now)}
      {loading ? null : model.totalWaiting > 0 ? ` · ${model.totalWaiting} hal menunggu keputusan tim` : " · tidak ada yang menunggu"}
    </>
  );

  return (
    <div className="pbs-page">
      <ModuleHeader
        title="Dashboard"
        subtitle={subtitle}
        actions={
          canSchedule ? (
            <>
              <Button variant="secondary" onClick={() => nav("UPLOAD_SCHEDULE")}>
                Upload massal
              </Button>
              <Button onClick={() => nav("CREATE_SCHEDULE")}>Buat jadwal</Button>
            </>
          ) : undefined
        }
      />
      {loading ? <LoadingDashboard /> : <Loaded model={model} nav={nav} canPayroll={canPayroll} />}
    </div>
  );
}

function Loaded(props: { model: DashboardModel; nav: (t: string, e?: Record<string, unknown>) => void; canPayroll: boolean }): React.ReactElement {
  const { model, nav } = props;
  const reviewCaption =
    model.review.breakdown.length > 0
      ? model.review.breakdown.map((b) => `${b.count} ${REASONS[b.reason].label.toLowerCase()}`).join(" · ")
      : "Semua report sudah diputuskan";
  return (
    <>
      <div className="pbs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", marginBottom: 16 }}>
        <QueueCard
          icon="checkSquare"
          count={model.review.count}
          title="Report menunggu review"
          caption={reviewCaption}
          tag={model.review.overdue > 0 ? { tone: "danger", text: `${model.review.overdue} lewat 3 hari` } : undefined}
          onClick={() => nav("REVIEW")}
        />
        <QueueCard
          icon="mapPin"
          count={model.gps.count}
          title="Pengecualian GPS"
          caption="Clock in di luar radius bulan ini (IsInsideGeofence = false)"
          tag={model.gps.today > 0 ? { tone: "neutral", text: `${model.gps.today} hari ini` } : undefined}
          onClick={() => nav("CLOCKIN", { filter: "OUTSIDE_GEOFENCE" })}
        />
        <QueueCard
          icon="clock"
          count={model.openShift.count}
          title="Shift belum clock out"
          caption={`Clock in lebih dari ${model.openShift.hours} jam tanpa clock out`}
          tag={model.openShift.count > 0 ? { tone: "warning", text: "perlu dikoreksi" } : undefined}
          onClick={() => nav("CLOCKIN", { filter: "OPEN_SHIFT" })}
        />
        <QueueCard
          icon="file"
          count={model.missingReport.count}
          title="Report belum masuk"
          caption={`Sesi sudah lewat ${model.missingReport.days} hari, host belum submit`}
          onClick={() => nav("REPORT_MISSING")}
        />
      </div>

      {model.totalWaiting === 0 ? <AllClear model={model} /> : null}

      <div className="pbs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", alignItems: "start", gap: 16 }}>
        <div className="pbs-grid" style={{ gap: 16 }}>
          <TodaySessions model={model} nav={nav} />
          <Automation model={model} />
        </div>
        <div className="pbs-grid" style={{ gap: 16 }}>
          <Conflicts model={model} nav={nav} />
          <PayrollCard model={model} nav={nav} canPayroll={props.canPayroll} />
        </div>
      </div>
    </>
  );
}

function QueueCard(props: {
  icon: "checkSquare" | "mapPin" | "clock" | "file";
  count: number;
  title: string;
  caption: string;
  tag?: { tone: Tone; text: string };
  onClick: () => void;
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  const iconBg = props.icon === "clock" ? "#FFF4D6" : props.icon === "file" ? "#F5F5F5" : "#E1F1FF";
  const iconColor = props.icon === "clock" ? "#8A6A00" : props.icon === "file" ? "#60686E" : "#0072FF";
  return (
    <button
      type="button"
      className="pbs-card"
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ textAlign: "left", padding: 16, cursor: "pointer", borderColor: hover ? "#B3D9FF" : undefined, background: "#fff", display: "flex", flexDirection: "column", gap: 4, minHeight: 150 }}
      aria-label={`${props.title}: ${props.count}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", marginBottom: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor }}>
          <Icon name={props.icon} size={17} />
        </span>
        {props.tag ? <Badge tone={props.tag.tone}>{props.tag.text}</Badge> : null}
      </div>
      <span className="pbs-num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
        {fmtNumber(props.count)}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{props.title}</span>
      <span style={{ fontSize: 12, color: "#60686E" }}>{props.caption}</span>
    </button>
  );
}

function AllClear(props: { model: DashboardModel }): React.ReactElement {
  const decidedToday = props.model.automation.autoMatchToday + props.model.automation.autoUnmatchToday;
  return (
    <div className="pbs-card" style={{ marginBottom: 16 }}>
      <EmptyState
        good
        title="Tidak ada yang menunggu keputusan"
        text="Semua report sudah diputuskan, tidak ada pengecualian GPS terbuka, dan semua sesi lewat sudah punya report."
        action={
          <div style={{ display: "flex", gap: 12 }}>
            <MiniStat label="Sesi hari ini" value={props.model.sessionSummary.count} />
            <MiniStat label="Diputuskan otomatis hari ini" value={decidedToday} />
          </div>
        }
      />
    </div>
  );
}

function MiniStat(props: { label: string; value: number }): React.ReactElement {
  return (
    <div className="pbs-card" style={{ padding: "12px 14px", minWidth: 180, textAlign: "left" }}>
      <div style={{ fontSize: 12, color: "#60686E" }}>{props.label}</div>
      <div className="pbs-num" style={{ fontSize: 20, fontWeight: 700 }}>
        {fmtNumber(props.value)}
      </div>
    </div>
  );
}

function TodaySessions(props: { model: DashboardModel; nav: (t: string, e?: Record<string, unknown>) => void }): React.ReactElement {
  const { model, nav } = props;
  const s = model.sessionSummary;
  return (
    <section className="pbs-card pbs-card-pad" aria-label="Sesi hari ini">
      <SectionHeader
        label="Sesi hari ini"
        right={
          <button type="button" className="pbs-link" onClick={() => nav("SCHEDULE", { date: model.now.toISOString() })}>
            Buka board
          </button>
        }
      />
      {model.sessions.length === 0 ? (
        <EmptyState icon="calendar" title="Tidak ada sesi hari ini" text="Belum ada jadwal live untuk hari ini." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {model.sessions.map((x) => (
            <SessionRow key={x.id || x.title} s={x} onClick={() => nav("SESSION", { scheduleId: x.id, title: x.title })} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "#60686E", borderTop: "1px solid #F5F5F5", marginTop: 14, paddingTop: 12 }}>
        <span>
          {s.count} sesi · {fmtNumber(s.liveHours, s.liveHours % 1 === 0 ? 0 : 1)} jam live
        </span>
        <span>
          {s.studiosUsed} studio terpakai{s.studiosActive > 0 ? ` dari ${s.studiosActive} aktif` : ""}
        </span>
        {s.waitingReport > 0 ? <span>{s.waitingReport} menunggu report</span> : null}
      </div>
    </section>
  );
}

function SessionRow(props: { s: SessionToday; onClick: () => void }): React.ReactElement {
  const { s } = props;
  const b = SESSION_BADGE[s.state];
  const live = s.state === "live";
  const tone: Tone = s.state === "live" ? "info" : s.state === "waitingReport" ? "warning" : s.state === "reported" ? "success" : "neutral";
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "14px 96px 1fr auto",
        alignItems: "center",
        gap: 10,
        padding: "11px 14px",
        border: `1px solid ${live ? "#B3D9FF" : "#E8E8E8"}`,
        background: live ? "#F4F9FF" : "#fff",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        opacity: s.state === "cancelled" ? 0.7 : 1,
        textDecoration: s.state === "cancelled" ? "line-through" : undefined,
        width: "100%",
      }}
    >
      <Dot tone={tone} />
      <span className="pbs-num" style={{ fontWeight: 500 }}>
        {fmtClock(s.start)}–{fmtClock(s.end === null ? null : s.end % 1440)}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.brand} · {shortName(s.host)} <span style={{ color: "#60686E" }}>· {s.studio}</span>
      </span>
      <Badge tone={b.tone}>{live && s.remaining !== null ? `${b.label} · sisa ${s.remaining} m` : b.label}</Badge>
    </button>
  );
}

function Automation(props: { model: DashboardModel }): React.ReactElement {
  const a = props.model.automation;
  const decided = a.autoMatchToday + a.autoUnmatchToday;
  return (
    <section className="pbs-card pbs-card-pad" aria-label="Berjalan tanpa campur tangan tim">
      <SectionHeader label="Berjalan tanpa campur tangan tim" right="tidak ada tombol di sini — ini kerja flow" />
      <div className="pbs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <AutoCard tone={a.evidenceToday > 0 ? "success" : "neutral"} title="Pembacaan bukti AI" text={`${a.evidenceToday} screenshot dibaca hari ini oleh PBS0003A (Generate OCR Report)`} />
        <AutoCard
          tone={decided > 0 ? "success" : "neutral"}
          title="Rekonsiliasi otomatis"
          text={`${decided} report diputuskan otomatis hari ini · ${a.autoMatchToday} Match, ${a.autoUnmatchToday} masuk antrean review`}
        />
        <AutoCard tone="neutral" title="Streak mingguan" text={`Dijalankan Minggu 23:00 · terakhir ${fmtDayMonth(a.lastStreakRun)} · ${a.streakHosts} host memenuhi 5 hari clock in`} />
      </div>
    </section>
  );
}

function AutoCard(props: { tone: Tone; title: string; text: string }): React.ReactElement {
  return (
    <div className="pbs-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 6 }}>
        <Dot tone={props.tone} />
        {props.title}
      </div>
      <div style={{ fontSize: 12, color: "#60686E" }}>{props.text}</div>
    </div>
  );
}

function Conflicts(props: { model: DashboardModel; nav: (t: string, e?: Record<string, unknown>) => void }): React.ReactElement {
  const list = props.model.conflicts;
  return (
    <section className="pbs-card pbs-card-pad" aria-label="Konflik minggu ini">
      <SectionHeader label="Konflik minggu ini" right={list.length > 0 ? `${list.length} perlu dibetulkan` : undefined} />
      {list.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#0A7A24", fontSize: 13 }}>
          <Icon name="check" size={16} /> Tidak ada host terjadwal dobel atau studio lewat kapasitas minggu ini.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.slice(0, 5).map((c, i) => {
            const host = c.kind === "HOST_DOUBLE";
            return (
              <div key={i} style={{ border: `1px solid ${host ? "#FFC9C9" : "#FFE0B3"}`, background: host ? "#FFF9F9" : "#FFF9E0", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <span className="pbs-dot" style={{ background: host ? "#FF4646" : "#FF7F00" }} />
                  {c.title}
                </div>
                <div style={{ fontSize: 12, color: "#60686E", margin: "6px 0 8px" }}>
                  {fmtDayMonth(c.day)} · {c.detail}
                  {c.scheduleIds.length > 0 ? <span className="pbs-mono"> ({c.scheduleIds.slice(0, 4).join(", ")})</span> : null}
                </div>
                <button type="button" className="pbs-link" onClick={() => props.nav("SCHEDULE", { date: c.day.toISOString(), scheduleIds: c.scheduleIds })}>
                  Buka di board
                </button>
              </div>
            );
          })}
          {list.length > 5 ? <div style={{ fontSize: 12, color: "#60686E" }}>+{list.length - 5} konflik lain di board jadwal</div> : null}
        </div>
      )}
    </section>
  );
}

function PayrollCard(props: { model: DashboardModel; nav: (t: string, e?: Record<string, unknown>) => void; canPayroll: boolean }): React.ReactElement {
  const p = props.model.payroll;
  const items: { ok: boolean; text: string }[] = [
    { ok: true, text: `${p.activeHosts} host aktif` },
    { ok: p.withAttendance > 0, text: `${p.withAttendance} punya catatan kehadiran` },
  ];
  if (p.withoutAttendance > 0) items.push({ ok: false, text: `${p.withoutAttendance} host tanpa kehadiran` });
  items.push(p.reportsNotReviewed > 0 ? { ok: false, text: `${p.reportsNotReviewed} report belum selesai direview` } : { ok: true, text: "Semua report sudah direview" });
  if (p.hostsWithoutBank !== null) {
    items.push(p.hostsWithoutBank > 0 ? { ok: false, text: `${p.hostsWithoutBank} host tanpa data rekening` } : { ok: true, text: "Semua host aktif punya data rekening" });
  }
  return (
    <section className="pbs-card pbs-card-pad" aria-label="Payroll">
      <SectionHeader label={`Payroll ${p.periodLabel}`} right={<Badge tone={p.openRun ? "info" : "neutral"}>{p.openRun && p.lastRun ? p.lastRun.status : "Periode berjalan"}</Badge>} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name={it.ok ? "check" : "alert"} size={15} color={it.ok ? "#0A7A24" : "#8A6A00"} />
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: "#60686E", margin: "14px 0" }}>
        {p.lastRun ? (
          <>
            Run terakhir <span className="pbs-mono">{p.lastRun.title || "—"}</span> · {p.lastRun.periode || "periode tidak tercatat"} · {p.lastRun.status || "status kosong"}.
            {p.openRun ? " Run ini masih di rantai approval." : ""}
          </>
        ) : (
          "Belum ada run payroll yang tercatat."
        )}
      </p>
      {props.canPayroll ? (
        <Button variant="secondary" wide onClick={() => props.nav("PAYROLL")}>
          Buka payroll
        </Button>
      ) : null}
    </section>
  );
}

function LoadingDashboard(): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="Memuat dashboard">
      <div className="pbs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pbs-card" style={{ padding: 16, minHeight: 150 }}>
            <Skeleton w={32} h={32} r={8} />
            <Skeleton w={44} h={26} style={{ margin: "14px 0 10px" }} />
            <Skeleton w="80%" />
            <Skeleton w="60%" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="pbs-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        {[0, 1].map((k) => (
          <div key={k} className="pbs-card pbs-card-pad">
            <Skeleton w={140} style={{ marginBottom: 18 }} />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
                <Skeleton w={10} h={10} r={5} />
                <Skeleton w="22%" />
                <Skeleton w="45%" />
                <Skeleton w="18%" h={22} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
