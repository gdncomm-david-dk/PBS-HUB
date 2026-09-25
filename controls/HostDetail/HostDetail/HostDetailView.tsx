import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { ClockInModal, availableClockInDates } from "../../../shared/clockIn";
import { AttendanceTab } from "../../../shared/attendance";
import { Row, nameIndex } from "../../../shared/data";
import { fmtDateShort, fmtDateTimeShort, fmtDayMonth, fmtNumber, fmtRupiah, fmtTime } from "../../../shared/format";
import {
  AffectedPeriod,
  HOST_STATUS,
  HostModel,
  HostPayLine,
  HostReport,
  HostSession,
  LedgerCheck,
  PII_LABEL,
  PII_ORDER,
  PiiField,
  SESSION_STATUS,
  ScoreBand,
  ScoreTx,
  buildHost,
  buildHostPayLines,
  buildHostReports,
  buildLedger,
  buildSessions,
  checkLedger,
  deactivationImpact,
  hostActivity,
  maskedPii,
  parseBands,
  revealedFor,
  scoreDefaults,
} from "../../../shared/host";
import { buildRuns, fmtPeriod } from "../../../shared/payroll";
import { reviewBadge } from "../../../shared/reconcile";
import { Badge, Button, EmptyState, EndOfData, Icon, InfoBanner, Overlay, Pill, ResultBanner, SectionHeader, Skeleton, SkeletonRows, Spinner, TONE_DOT } from "../../../shared/ui";

export type HostTab = "Summary" | "Schedule" | "Attendance" | "Reports" | "Payroll" | "Personal";

export interface HostDetailProps {
  ctx: ModuleContext;
  host: Row[];
  schedules: Row[];
  reports: Row[];
  clockIns: Row[];
  lines: Row[];
  runs: Row[];
  txs: Row[];
  thresholds: Row[];
  brands: Row[];
  studios: Row[];
  revealed: Row[];
  defaultTab: HostTab;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

const TAB_LABEL: Record<HostTab, string> = { Summary: "Ringkasan", Schedule: "Jadwal", Attendance: "Kehadiran", Reports: "Report", Payroll: "Payroll", Personal: "Data pribadi" };
const BAND_TEXT: Record<string, string> = { success: "pbs-t-ok", danger: "pbs-t-bad", warning: "pbs-t-warn", info: "pbs-t-info", neutral: "" };

const money = (n: number | null) => (n === null ? <span className="pbs-muted">—</span> : fmtRupiah(n));
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmtNumber(Math.abs(n))}`);

export function HostDetailView(props: HostDetailProps): React.ReactElement {
  const { ctx, now, action } = props;
  const bands = React.useMemo(() => parseBands(props.thresholds), [props.thresholds]);
  const defaults = React.useMemo(() => scoreDefaults(ctx.config), [ctx]);
  const hostRow = props.host[0];
  const h = React.useMemo(() => (hostRow ? buildHost(hostRow, bands, defaults) : null), [hostRow, bands, defaults]);

  const brandNames = React.useMemo(() => nameIndex(props.brands, ["NamaBrand", "BrandName"]), [props.brands]);
  const studioNames = React.useMemo(() => nameIndex(props.studios, ["NamaStudio", "StudioName"]), [props.studios]);
  const sessions = React.useMemo(() => buildSessions(props.schedules, props.clockIns, brandNames, studioNames, now), [props.schedules, props.clockIns, brandNames, studioNames, now]);
  const reports = React.useMemo(() => buildHostReports(props.reports, brandNames), [props.reports, brandNames]);
  const runOpts = React.useMemo(() => ({ now, labelOffset: configNumber(ctx, "payrollLabelOffset", -1), assemblyMinutes: configNumber(ctx, "payrollAssemblyMinutes", 30) }), [ctx, now]);
  const runModels = React.useMemo(() => buildRuns(props.runs, props.lines, [], runOpts), [props.runs, props.lines, runOpts]);
  const payLines = React.useMemo(() => buildHostPayLines(props.lines, runModels), [props.lines, runModels]);
  const ledger = React.useMemo(() => buildLedger(props.txs), [props.txs]);

  const canPii = hasPermission(ctx, "HOST_PII_VIEW");
  const canPay = hasPermission(ctx, "PAYROLL_VIEW");
  const canEdit = hasPermission(ctx, "HOST_EDIT");
  const canClockIn = hasPermission(ctx, "HOST_CLOCKIN");
  const tabs: HostTab[] = ["Summary", "Schedule", ...(canClockIn || canPay ? (["Attendance"] as HostTab[]) : []), "Reports", ...(canPay ? (["Payroll"] as HostTab[]) : []), ...(canPii ? (["Personal"] as HostTab[]) : [])];
  const [tabRaw, setTab] = React.useState<HostTab>(props.defaultTab);
  React.useEffect(() => setTab(props.defaultTab), [props.defaultTab]);
  // The tab is absent without the permission, so a DefaultTab pointing at it falls back.
  const tab = tabs.includes(tabRaw) ? tabRaw : "Summary";
  const [statusModal, setStatusModal] = React.useState(false);
  const [clockInModal, setClockInModal] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (action.lastResult?.action === "SET_HOST_STATUS" && action.lastResult.status === "ok") setStatusModal(false);
    if (action.lastResult?.action === "ADD_CLOCK_IN" && action.lastResult.status === "ok") setClockInModal(false);
  }, [action.lastResult]);

  const back = (
    <button type="button" onClick={() => action.fire("BACK", {})}>
      Host
    </button>
  );

  if (!h) {
    return (
      <div className="pbs-page">
        <div className="pbs-crumb">{back}</div>
        {props.loading ? (
          <div className="pbs-grid">
            <Skeleton h={76} />
            <Skeleton h={36} />
            <Skeleton h={260} />
          </div>
        ) : (
          <InfoBanner tone="warn">Host tidak ditemukan. Mungkin sudah dihapus, atau properti HostJson belum diisi.</InfoBanner>
        )}
      </div>
    );
  }

  const check = checkLedger(h, ledger);
  const st = HOST_STATUS[h.status];
  const impact = h.status === "INACTIVE" ? deactivationImpact(h, sessions, props.clockIns, payLines, runModels, now) : null;
  const counts: Partial<Record<HostTab, number>> = {
    Schedule: sessions.filter((s) => s.upcoming).length,
    Reports: reports.filter((r) => r.state === "WAITING" || r.state === "REVISION").length,
  };
  // A successful reveal needs no banner; the value itself is the confirmation.
  const bannerResult =
    action.lastResult && !(action.lastResult.action === "REVEAL_PII" && action.lastResult.status === "ok") && !(clockInModal && action.lastResult.action === "ADD_CLOCK_IN") && !(action.lastResult.action === "ADJUST_CLOCK_IN" && action.lastResult.status !== "ok")
      ? action.lastResult
      : null;
  const missedDays = canClockIn ? availableClockInDates(props.schedules, props.clockIns, h.hostId, now).length : 0;

  const openClockIn = () => {
    if (action.lastResult?.action === "ADD_CLOCK_IN") action.clearResult();
    setClockInModal(true);
  };

  const openStatus = () => {
    setStatusModal(true);
  };

  return (
    <div className="pbs-host" ref={hostRef}>
      <div className="pbs-page">
        <div className="pbs-mh" style={{ marginBottom: 12, alignItems: "center" }}>
          <div className="pbs-crumb" style={{ margin: 0 }}>
            {back} <span aria-hidden="true">›</span> {h.code}
          </div>
          <div className="pbs-actions">
            <Button variant="ghost" size="sm" onClick={() => action.fire("RELOAD", { hostId: h.hostId })} disabled={props.loading}>
              <Icon name="refresh" size={14} /> Muat ulang
            </Button>
            {canClockIn ? (
              <Button variant="secondary" size="sm" onClick={openClockIn} disabled={!!action.pending} title={missedDays ? `${missedDays} jadwal belum ada clock in` : "Sudah clock in di semua jadwal"}>
                <Icon name="clock" size={14} /> Clock in
                {missedDays ? <span className="pbs-count">{missedDays}</span> : null}
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => action.fire("NAV", { target: "EDIT_HOST", hostId: h.hostId, id: h.id })}>
                  Edit host
                </Button>
                {h.status === "INACTIVE" ? (
                  <Button variant="secondary" size="sm" onClick={openStatus} disabled={!!action.pending}>
                    Aktifkan kembali
                  </Button>
                ) : (
                  <Button variant="danger" size="sm" onClick={openStatus} disabled={!!action.pending}>
                    Nonaktifkan
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="pbs-card pbs-rec">
          <div className="pbs-rec-code">{h.code}</div>
          <div className="pbs-rec-g">
            <Meta label="Nama" value={h.name} />
            <Meta label="Package" value={h.pkg || "—"} />
            <Meta label="Bergabung" value={fmtDateShort(h.joined)} />
            <Meta
              label="Skor"
              value={
                h.score === null ? (
                  "—"
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className={`pbs-num ${h.band ? BAND_TEXT[h.band.tone] : ""}`}>{fmtNumber(h.score)}</span>
                    {h.band ? (
                      <Badge tone={h.band.tone} small>
                        {h.band.label}
                      </Badge>
                    ) : null}
                  </span>
                )
              }
            />
          </div>
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>

        <ResultBanner result={bannerResult} onClose={action.clearResult} okText={bannerResult?.action === "ADD_CLOCK_IN" ? "Clock in tersimpan." : bannerResult?.action === "ADJUST_CLOCK_IN" ? "Kehadiran disesuaikan." : "Tersimpan."} />

        {h.sensitiveKeys.length > 0 ? (
          <InfoBanner tone="err" icon="lock">
            HostJson memuat kolom sensitif (<span className="pbs-mono">{h.sensitiveKeys.join(", ")}</span>). Nilainya tetap disamarkan di sini, tapi sudah ikut terkirim ke
            perangkat. Kirim hanya petunjuk samaran (<span className="pbs-mono">KtpLast4</span>, <span className="pbs-mono">NorekLast4</span>, <span className="pbs-mono">HasAlamat</span>, …).
          </InfoBanner>
        ) : null}

        {impact ? <DeactivatedBanner impact={impact} canPay={canPay} onSchedule={() => action.fire("NAV", { target: "SCHEDULE", hostId: h.hostId })} /> : null}

        {h.hasBank === false && h.status !== "INACTIVE" ? (
          <InfoBanner tone="warn">
            <b>Data bank belum lengkap.</b> Preflight payroll memblokir host ini, dan transfer serta slip gaji gagal sampai No rekening dan Bank diisi.
          </InfoBanner>
        ) : null}

        <div className="pbs-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pbs-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              {counts[t] ? <span className="pbs-count">{fmtNumber(counts[t] ?? 0)}</span> : null}
            </button>
          ))}
        </div>

        {tab === "Summary" ? (
          <SummaryTab h={h} bands={bands} ledger={ledger} check={check} sessions={sessions} reports={reports} clockIns={props.clockIns} canPay={canPay} loading={props.loading} now={now} action={action} />
        ) : tab === "Schedule" ? (
          <ScheduleTab sessions={sessions} loading={props.loading} haveClockIns={props.clockIns.length > 0} onOpen={(s) => action.fire("OPEN_SCHEDULE", { scheduleId: s.id, title: s.title })} />
        ) : tab === "Attendance" ? (
          <AttendanceTab ctx={ctx} hostId={h.hostId} hostCode={h.code} hostName={h.name} clockIns={props.clockIns} runs={runModels} canEdit={canClockIn} loading={props.loading} now={now} action={action} />
        ) : tab === "Reports" ? (
          <ReportsTab reports={reports} loading={props.loading} onOpen={(r) => action.fire("OPEN_REPORT", { reportId: r.id, title: r.title })} />
        ) : tab === "Payroll" ? (
          <PayrollTab lines={payLines} loading={props.loading} onOpen={(l) => action.fire("OPEN_RUN", { runId: l.run?.id ?? "", title: l.runTitle })} />
        ) : (
          <PersonalTab h={h} revealed={props.revealed} seconds={Math.max(5, configNumber(ctx, "piiRevealSeconds", 30))} action={action} />
        )}
      </div>

      {clockInModal ? (
        <ClockInModal ctx={ctx} hostId={h.hostId} hostCode={h.code} hostName={h.name} schedules={props.schedules} clockIns={props.clockIns} now={now} action={action} onClose={() => setClockInModal(false)} />
      ) : null}
      {statusModal ? <StatusModal h={h} sessions={sessions} clockIns={props.clockIns} payLines={payLines} runs={runModels} now={now} action={action} onClose={() => setStatusModal(false)} /> : null}
    </div>
  );
}

function Meta(props: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="pbs-rec-m">
      <span className="l">{props.label}</span>
      <span className="v">{props.value}</span>
    </div>
  );
}

// ---- deactivated mid-period -------------------------------------------------------------------

function periodLine(a: AffectedPeriod, canPay: boolean): React.ReactNode {
  const parts: string[] = [];
  if (a.clockIns > 0) parts.push(`${a.clockIns} kehadiran${canPay && a.value > 0 ? ` (${fmtRupiah(a.value)})` : ""}`);
  if (a.upcoming > 0) parts.push(`${a.upcoming} jadwal belum berjalan`);
  return (
    <li key={a.key}>
      <b style={{ minWidth: 120 }}>{fmtPeriod(a.period)}</b>
      <span>{parts.join(" · ")}</span>
      {a.paidIn.length > 0 ? (
        <Badge tone="info" small>
          masuk {a.paidIn.join(", ")}
        </Badge>
      ) : a.clockIns > 0 ? (
        <Badge tone="warning" small>
          {a.runWithoutLine.length > 0 ? `tidak ada di ${a.runWithoutLine.join(", ")}` : "belum dibayar"}
        </Badge>
      ) : null}
    </li>
  );
}

function DeactivatedBanner(props: { impact: ReturnType<typeof deactivationImpact>; canPay: boolean; onSchedule: () => void }): React.ReactElement {
  const { impact } = props;
  const since = impact.since ? `sejak ${fmtDateShort(impact.since)}` : "";
  if (impact.periods.length === 0) {
    return <InfoBanner>Host nonaktif {since}. Tidak ada kehadiran atau jadwal yang tersisa di periode berjalan.</InfoBanner>;
  }
  return (
    <InfoBanner
      tone="warn"
      action={
        impact.upcoming.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={props.onSchedule}>
            Atur ulang jadwal
          </Button>
        ) : undefined
      }
    >
      <b>Host nonaktif {since}, tapi masih punya aktivitas di periode berikut.</b> Flow payroll v1 membaca semua host tanpa melihat Status, jadwal yang belum berjalan
      tetap menunjuk host ini.
      <ul className="pbs-periods">{impact.periods.map((a) => periodLine(a, props.canPay))}</ul>
    </InfoBanner>
  );
}

// ---- Ringkasan --------------------------------------------------------------------------------

function BandChart(props: { bands: ScoreBand[]; score: number | null; min: number | null; max: number | null }): React.ReactElement | null {
  const { bands, score } = props;
  const lo = Math.min(...bands.map((b) => b.min ?? Infinity), props.min ?? Infinity, score ?? Infinity);
  const hi = Math.max(...bands.map((b) => b.max ?? -Infinity), props.max ?? -Infinity, score ?? -Infinity);
  if (bands.length === 0 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div aria-hidden="true">
      <div className="pbs-bands">
        {bands.map((b) => (
          <span key={b.id} title={`${b.label}: ${fmtNumber(b.min)}–${fmtNumber(b.max)}`} style={{ flex: `${Math.max(1, (b.max ?? hi) - (b.min ?? lo))} 1 0`, background: TONE_DOT[b.tone] }} />
        ))}
        {score !== null ? <i style={{ left: `${Math.min(100, Math.max(0, pos(score)))}%` }} /> : null}
      </div>
      <div className="pbs-bands-l">
        {bands.map((b) => (
          <span key={b.id} style={{ flex: `${Math.max(1, (b.max ?? hi) - (b.min ?? lo))} 1 0`, textAlign: "center" }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SummaryTab(props: {
  h: HostModel;
  bands: ScoreBand[];
  ledger: ScoreTx[];
  check: LedgerCheck;
  sessions: HostSession[];
  reports: HostReport[];
  clockIns: Row[];
  canPay: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}): React.ReactElement {
  const { h, check, action } = props;
  const act = hostActivity(props.sessions, props.clockIns, props.reports, props.now);
  const recent = props.ledger.slice(0, 10);
  const bounds = [h.min !== null ? `min ${fmtNumber(h.min)}` : "", h.max !== null ? `maks ${fmtNumber(h.max)}` : "", h.initial !== null ? `awal ${fmtNumber(h.initial)}` : ""].filter(Boolean).join(" · ");
  const month = fmtPeriod({ year: props.now.getFullYear(), month: props.now.getMonth() });

  return (
    <>
      <div className="pbs-two" style={{ marginBottom: 16 }}>
        <div className="pbs-card pbs-card-pad">
          <SectionHeader
            label="Skor kredit"
            right={
              <button type="button" className="pbs-link" onClick={() => action.fire("NAV", { target: "SCORE_LEDGER", hostId: h.hostId })}>
                Lihat ledger
              </button>
            }
          />
          {h.score === null ? (
            <p className="pbs-muted" style={{ margin: 0 }}>
              Host ini belum punya skor: CurrentScore dan InitialScore kosong, dan ScoreConfig tidak dikirim.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span className={`pbs-score ${h.band ? BAND_TEXT[h.band.tone] : ""}`}>{fmtNumber(h.score)}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{h.band?.label ?? "Tanpa band"}</span>
              </div>
              {h.band?.description ? <p className="pbs-muted" style={{ margin: "6px 0 0" }}>{h.band.description}</p> : null}
              <BandChart bands={props.bands} score={h.score} min={h.min} max={h.max} />
              {bounds ? <p className="pbs-hint">Batas host: {bounds}</p> : null}
            </>
          )}
          {check.drift ? (
            <div className="pbs-banner warn" role="status" style={{ margin: "14px 0 0" }}>
              <Icon name="alert" />
              <div className="grow">
                <b>Skor tersimpan tidak cocok dengan ledger.</b> CurrentScore {fmtNumber(h.storedScore)}, sedangkan awal {fmtNumber(h.initial)} + {check.activeCount} transaksi aktif ={" "}
                {fmtNumber(check.expected)} (selisih {signed(check.diff)}).
                {check.voidedCount > 0 ? ` ${check.voidedCount} transaksi dibatalkan tidak dihitung.` : ""}
              </div>
            </div>
          ) : null}
        </div>

        <div className="pbs-card pbs-card-pad">
          <SectionHeader label={`Bulan ini · ${month}`} />
          {props.loading && props.sessions.length === 0 ? (
            <Skeleton h={120} />
          ) : (
            <div className="pbs-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", margin: 0 }}>
              <div className="pbs-kpi">
                <div className="l">Sesi</div>
                <div className="v">{fmtNumber(act.sessionsPlanned)}</div>
                <div className="n">{fmtNumber(act.sessionsDone)} selesai</div>
              </div>
              <div className="pbs-kpi">
                <div className="l">Kehadiran</div>
                <div className="v">{fmtNumber(act.clockIns)}</div>
                <div className="n">{props.canPay && act.clockInValue > 0 ? fmtRupiah(act.clockInValue) : "hari clock in"}</div>
              </div>
              <div className="pbs-kpi">
                <div className="l">Report menunggu</div>
                <div className="v">{fmtNumber(act.reportsWaiting)}</div>
                <div className="n" style={act.reportsRevision > 0 ? { color: "#C0292A", fontWeight: 600 } : undefined}>
                  {fmtNumber(act.reportsRevision)} perlu revisi
                </div>
              </div>
            </div>
          )}
          <dl className="pbs-kv" style={{ marginTop: 18 }}>
            <dt>HostID</dt>
            <dd className="pbs-mono">{h.hostId}</dd>
            <dt>Email kerja</dt>
            <dd>{h.email || "—"}</dd>
            <dt>Terdaftar</dt>
            <dd>
              {fmtDateShort(h.registered)}
              {h.registeredBy ? <span className="pbs-muted"> · oleh {h.registeredBy}</span> : null}
            </dd>
            <dt>Data bank</dt>
            <dd>
              {h.hasBank === null ? (
                <span className="pbs-muted">Tidak dikirim</span>
              ) : h.hasBank ? (
                <Badge tone="success">Lengkap{h.bank ? ` · ${h.bank}` : ""}</Badge>
              ) : (
                <Badge tone="warning">Belum lengkap</Badge>
              )}
            </dd>
          </dl>
        </div>
      </div>

      <div className="pbs-table-wrap">
        <div style={{ padding: "14px 16px 0" }}>
          <SectionHeader label="Riwayat skor terakhir" right={props.ledger.length > recent.length ? `10 dari ${fmtNumber(props.ledger.length)}` : undefined} />
        </div>
        <div className="pbs-table-scroll">
          <table className="pbs-table dense">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Rule</th>
                <th>Tipe</th>
                <th className="r">Poin</th>
                <th className="r">Sebelum</th>
                <th className="r">Sesudah</th>
                <th>Catatan</th>
                <th>Oleh</th>
              </tr>
            </thead>
            <tbody>
              {props.loading && props.ledger.length === 0 ? (
                <SkeletonRows rows={4} cols={8} />
              ) : (
                recent.map((t) => (
                  <tr key={t.id || t.txId} className={t.active ? undefined : "void"}>
                    <td className="pbs-num">{fmtDateTimeShort(t.when)}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 160 }}>{t.rule}</td>
                    <td>
                      {!t.active ? (
                        <Badge tone="neutral" small title={t.statusText ? `Status: ${t.statusText}` : undefined}>
                          Dibatalkan
                        </Badge>
                      ) : t.type === "REWARD" ? (
                        <Badge tone="success" small>
                          Reward
                        </Badge>
                      ) : t.type === "PENALTY" ? (
                        <Badge tone="danger" small>
                          Penalty
                        </Badge>
                      ) : (
                        <Badge tone="neutral" small>
                          —
                        </Badge>
                      )}
                    </td>
                    <td className={`r pbs-num ${t.active ? ((t.point ?? 0) >= 0 ? "pbs-t-ok" : "pbs-t-bad") : ""}`} style={{ fontWeight: 600 }}>
                      {signed(t.point)}
                    </td>
                    <td className="r pbs-num">{fmtNumber(t.before)}</td>
                    <td className="r pbs-num">{fmtNumber(t.after)}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 180 }}>{t.notes || <span className="pbs-muted">—</span>}</td>
                    <td>{t.by || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {props.loading && props.ledger.length === 0 ? null : props.ledger.length === 0 ? (
          <EmptyState icon="inbox" title="Belum ada transaksi skor" text="Skor host masih nilai awal. Reward dan penalty yang diberikan akan tercatat di sini." />
        ) : null}
      </div>
    </>
  );
}

// ---- Jadwal -----------------------------------------------------------------------------------

type ScheduleView = "upcoming" | "past" | "all";

function ScheduleTab(props: { sessions: HostSession[]; loading: boolean; haveClockIns: boolean; onOpen: (s: HostSession) => void }): React.ReactElement {
  const upcoming = props.sessions.filter((s) => s.upcoming);
  const past = props.sessions.filter((s) => !s.upcoming).reverse();
  const [view, setView] = React.useState<ScheduleView>(upcoming.length > 0 ? "upcoming" : "past");
  const rows = view === "upcoming" ? upcoming : view === "past" ? past : [...upcoming, ...past];
  const firstLoad = props.loading && props.sessions.length === 0;
  const chip = (v: ScheduleView, label: string, n: number) => (
    <button type="button" className={`pbs-btn sm ${view === v ? "primary" : "secondary"}`} onClick={() => setView(v)} aria-pressed={view === v}>
      {label} · {fmtNumber(n)}
    </button>
  );
  return (
    <>
      <div className="pbs-filters">
        {chip("upcoming", "Mendatang", upcoming.length)}
        {chip("past", "Sebelumnya", past.length)}
        {chip("all", "Semua", props.sessions.length)}
      </div>
      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Waktu</th>
                <th>Brand</th>
                <th>Studio</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Clock in</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={6} cols={8} />
              ) : (
                rows.map((s) => {
                  const ss = SESSION_STATUS[s.status];
                  return (
                    <tr key={s.id || s.title} className={s.status === "CANCELLED" ? "muted" : undefined}>
                      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                        {fmtDayMonth(s.day)}
                      </td>
                      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                        {s.start || "—"}
                        {s.end ? `–${s.end}` : ""}
                      </td>
                      <td style={{ fontWeight: 600 }}>{s.brand}</td>
                      <td>{s.studio}</td>
                      <td className="pbs-muted">{s.platform || "—"}</td>
                      <td>
                        <Badge tone={ss.tone}>{ss.label}</Badge>
                      </td>
                      <td className="pbs-num">{s.clockIn ? fmtTime(s.clockIn) : <span className="pbs-muted">—</span>}</td>
                      <td className="r">
                        <Button variant="secondary" size="sm" onClick={() => props.onOpen(s)}>
                          Buka
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : rows.length === 0 ? (
          <EmptyState icon="calendar" title={view === "upcoming" ? "Tidak ada jadwal mendatang" : "Belum ada jadwal"} text="Jadwal host ini dibuat dari layar Jadwal." />
        ) : (
          <EndOfData text={`${fmtNumber(rows.length)} jadwal${props.haveClockIns ? "" : " · data Clock In tidak dikirim"}`} />
        )}
      </div>
    </>
  );
}

// ---- Report -----------------------------------------------------------------------------------

function ReportsTab(props: { reports: HostReport[]; loading: boolean; onOpen: (r: HostReport) => void }): React.ReactElement {
  const firstLoad = props.loading && props.reports.length === 0;
  return (
    <div className="pbs-table-wrap">
      <div className="pbs-table-scroll">
        <table className="pbs-table" aria-busy={props.loading}>
          <thead>
            <tr>
              <th>Tanggal live</th>
              <th>Brand</th>
              <th>Platform</th>
              <th className="r">Penjualan</th>
              <th>Status review</th>
              <th aria-label="Aksi" />
            </tr>
          </thead>
          <tbody>
            {firstLoad ? (
              <SkeletonRows rows={6} cols={6} />
            ) : (
              props.reports.map((r) => {
                const rs = reviewBadge(r.row, r.state);
                return (
                  <tr key={r.id || r.title}>
                    <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                      {fmtDayMonth(r.liveDate)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.brand}</td>
                    <td className="pbs-muted">{r.platform || "—"}</td>
                    <td className="r pbs-num">{money(r.sales)}</td>
                    <td>
                      <Badge tone={rs.tone}>{rs.label}</Badge>
                    </td>
                    <td className="r">
                      <Button variant="secondary" size="sm" onClick={() => props.onOpen(r)}>
                        {r.state === "WAITING" ? "Tinjau" : "Lihat"}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {firstLoad ? null : props.reports.length === 0 ? (
        <EmptyState icon="file" title="Belum ada report" text="Report yang di-submit host ini akan muncul di sini." />
      ) : (
        <EndOfData text={`${fmtNumber(props.reports.length)} report`} />
      )}
    </div>
  );
}

// ---- Payroll ----------------------------------------------------------------------------------

function PayrollTab(props: { lines: HostPayLine[]; loading: boolean; onOpen: (l: HostPayLine) => void }): React.ReactElement {
  const firstLoad = props.loading && props.lines.length === 0;
  return (
    <>
      <p className="pbs-hint" style={{ margin: "0 0 12px" }}>
        Periode = bulan kehadiran yang dibayar. Label run v1 memakai bulan run (satu bulan setelahnya).
      </p>
      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>Periode</th>
                <th>Run</th>
                <th className="r">HK</th>
                <th className="r">Bruto</th>
                <th className="r">PPh21</th>
                <th className="r">Neto</th>
                <th>Rekening</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={4} cols={8} />
              ) : (
                props.lines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{fmtPeriod(l.period)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="pbs-mono">{l.runTitle || "—"}</span>{" "}
                      {l.run ? (
                        <Badge tone={l.run.tone} small>
                          {l.run.statusText}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="r pbs-num">{fmtNumber(l.hk)}</td>
                    <td className="r pbs-num">{money(l.bruto)}</td>
                    <td className="r pbs-num">{money(l.pph21)}</td>
                    <td className="r pbs-num" style={{ fontWeight: 600 }}>
                      {money(l.net)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {l.hasBank === false ? (
                        <Badge tone="danger" small>
                          Tanpa rekening
                        </Badge>
                      ) : (
                        <span className="pbs-num">
                          {l.bank || "—"} {l.norekLast4 ? `••••${l.norekLast4}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="r">
                      <Button variant="secondary" size="sm" onClick={() => props.onOpen(l)} disabled={!l.runTitle}>
                        Buka run
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : props.lines.length === 0 ? (
          <EmptyState icon="inbox" title="Belum ada baris payroll" text="Baris muncul setelah run payroll pertama yang memuat host ini." />
        ) : (
          <EndOfData text={`${fmtNumber(props.lines.length)} baris payroll`} />
        )}
      </div>
    </>
  );
}

// ---- Data pribadi -----------------------------------------------------------------------------

function PersonalTab(props: { h: HostModel; revealed: Row[]; seconds: number; action: UseActionResult }): React.ReactElement {
  const { h, action } = props;
  const revealed = React.useMemo(() => revealedFor(props.revealed, h.hostId), [props.revealed, h.hostId]);
  // When each field was revealed. A value is shown for `seconds`, then hidden and canvas is told.
  const [shownAt, setShownAt] = React.useState<Partial<Record<PiiField, number>>>({});
  const [, tick] = React.useState(0);
  const prev = React.useRef<Map<PiiField, string>>(new Map());

  React.useEffect(() => {
    const next: Partial<Record<PiiField, number>> = {};
    let changed = false;
    for (const [f, v] of revealed) {
      if (prev.current.get(f) !== v) {
        next[f] = Date.now();
        changed = true;
      }
    }
    prev.current = revealed;
    if (changed) setShownAt((s) => ({ ...s, ...next }));
  }, [revealed]);

  const hide = React.useCallback(
    (f: PiiField) => {
      setShownAt((s) => {
        const n = { ...s };
        delete n[f];
        return n;
      });
      action.fire("HIDE_PII", { hostId: h.hostId, field: f });
    },
    [action, h.hostId],
  );

  const open = PII_ORDER.filter((f) => shownAt[f] !== undefined && revealed.has(f));
  React.useEffect(() => {
    if (open.length === 0) return undefined;
    const t = setInterval(() => {
      const nowMs = Date.now();
      for (const f of open) if (nowMs - (shownAt[f] ?? 0) >= props.seconds * 1000) hide(f);
      tick((x) => x + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [open.join(","), shownAt, props.seconds, hide]);

  const pending = action.pending?.action === "REVEAL_PII" ? action.pending : null;
  const [pendingField, setPendingField] = React.useState<PiiField | null>(null);
  const requested = React.useRef<PiiField | null>(null);
  React.useEffect(() => {
    if (!pending) setPendingField(null);
  }, [pending]);
  // Canvas may answer with a value it already sent once (RevealedJson not cleared): restart the timer.
  React.useEffect(() => {
    const r = action.lastResult;
    const f = requested.current;
    if (r?.action !== "REVEAL_PII" || !f) return;
    requested.current = null;
    if (r.status === "ok") setShownAt((s) => ({ ...s, [f]: Date.now() }));
  }, [action.lastResult]);

  const reveal = (f: PiiField) => {
    if (action.dispatch("REVEAL_PII", { hostId: h.hostId, id: h.id, field: f })) {
      requested.current = f;
      setPendingField(f);
    }
  };

  return (
    <>
      <InfoBanner>Membuka data pribadi tercatat dalam log akses.</InfoBanner>
      <div className="pbs-card">
        {PII_ORDER.map((f) => {
          const masked = maskedPii(h.row, f);
          const isOpen = open.includes(f);
          const left = isOpen ? Math.max(0, props.seconds - Math.floor((Date.now() - (shownAt[f] ?? 0)) / 1000)) : 0;
          return (
            <div key={f} className={`pbs-kvr${isOpen ? " on" : ""}`}>
              <span className="k">{PII_LABEL[f]}</span>
              {isOpen ? (
                <span className="v">
                  {revealed.get(f) || <span className="pbs-muted">(kosong)</span>}
                  <span className="pbs-muted" style={{ fontSize: 11.5, marginLeft: 10 }}>
                    disembunyikan dalam {left} dtk
                  </span>
                </span>
              ) : masked === null ? (
                <span className="v pbs-muted">Belum diisi</span>
              ) : (
                <span className="v masked">{masked ?? "••••••"}</span>
              )}
              {isOpen ? (
                <Button variant="ghost" size="sm" onClick={() => hide(f)}>
                  <Icon name="eyeOff" size={14} /> Sembunyikan
                </Button>
              ) : masked === null ? null : (
                <Button variant="ghost" size="sm" onClick={() => reveal(f)} disabled={!!action.pending}>
                  {pendingField === f ? (
                    <>
                      <Spinner small /> Membuka…
                    </>
                  ) : (
                    <>
                      <Icon name="eye" size={14} /> Lihat
                    </>
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="pbs-hint">Nilai yang dibuka hilang otomatis setelah {props.seconds} detik dan saat layar ditutup. Satu permintaan membuka satu kolom.</p>
    </>
  );
}

// ---- status change ----------------------------------------------------------------------------

function StatusModal(props: {
  h: HostModel;
  sessions: HostSession[];
  clockIns: Row[];
  payLines: HostPayLine[];
  runs: ReturnType<typeof buildRuns>;
  now: Date;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { h, action } = props;
  const deactivate = h.status !== "INACTIVE";
  const [reason, setReason] = React.useState("");
  const pending = action.pending?.action === "SET_HOST_STATUS";
  const res = action.lastResult?.action === "SET_HOST_STATUS" && action.lastResult.status !== "ok" ? action.lastResult : null;
  // Preview: what is left behind if the switch happens now.
  const preview = deactivate ? deactivationImpact({ ...h, deactivatedAt: props.now }, props.sessions, props.clockIns, props.payLines, props.runs, props.now) : null;
  const ok = !deactivate || reason.trim().length >= 5;
  const submit = () => {
    if (!ok || pending) return;
    action.dispatch("SET_HOST_STATUS", {
      hostId: h.hostId,
      id: h.id,
      status: deactivate ? "Inactive" : "Active",
      reason: reason.trim(),
      effectiveDate: props.now.toISOString(),
      expectedModified: h.modified,
      upcomingSchedules: preview ? preview.upcoming.map((s) => s.title).filter(Boolean) : [],
    });
  };
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-hs-title">
        <div className="pbs-modal-h">
          <h2 id="pbs-hs-title">{deactivate ? `Nonaktifkan ${h.code}?` : `Aktifkan kembali ${h.code}?`}</h2>
          <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="pbs-modal-b">
          {deactivate ? (
            <>
              <p style={{ margin: 0 }}>
                {h.name} tidak bisa lagi dijadwalkan. Riwayat kehadiran, report, payroll dan skor tetap tersimpan.
              </p>
              {preview && preview.periods.length > 0 ? (
                <InfoBanner tone="warn">
                  <b>Periode yang terdampak</b>
                  <ul className="pbs-periods">{preview.periods.map((a) => periodLine(a, true))}</ul>
                  <div style={{ marginTop: 8 }}>
                    Flow payroll v1 tidak menyaring Status: kehadiran di atas tetap dibayar di run berikutnya.
                    {preview.upcoming.length > 0 ? ` ${preview.upcoming.length} jadwal mendatang perlu dialihkan ke host lain.` : ""}
                  </div>
                </InfoBanner>
              ) : (
                <InfoBanner>Tidak ada kehadiran atau jadwal di periode berjalan.</InfoBanner>
              )}
            </>
          ) : (
            <p style={{ margin: 0 }}>{h.name} bisa dijadwalkan lagi dan ikut preflight payroll periode berikutnya.</p>
          )}
          <div>
            <label className="pbs-label" htmlFor="pbs-hs-reason">
              Alasan{deactivate ? " (wajib)" : ""}
            </label>
            <textarea id="pbs-hs-reason" className="pbs-textarea" value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} placeholder={deactivate ? "Mis. kontrak selesai 15 September" : "Opsional"} />
          </div>
          {res ? (
            <InfoBanner tone="err">
              {res.status === "conflict"
                ? `Data host sudah diubah${res.decidedBy ? ` oleh ${res.decidedBy}` : ""}. Muat ulang lalu coba lagi.`
                : res.message || "Gagal menyimpan status. Coba lagi."}
            </InfoBanner>
          ) : null}
        </div>
        <div className="pbs-modal-f">
          <Button variant="ghost" onClick={props.onClose} disabled={pending}>
            Batal
          </Button>
          <Button variant={deactivate ? "danger" : "primary"} onClick={submit} disabled={!ok || pending} title={!ok ? "Isi alasan minimal 5 karakter" : undefined}>
            {pending ? (
              <>
                <Spinner small /> Menyimpan…
              </>
            ) : deactivate ? (
              "Nonaktifkan host"
            ) : (
              "Aktifkan kembali"
            )}
          </Button>
        </div>
    </Overlay>
  );
}
