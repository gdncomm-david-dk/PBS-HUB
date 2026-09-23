import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { fmtDateShort, fmtNumber, fmtRupiah } from "../../../shared/format";
import {
  Period,
  PreflightCheck,
  RunModel,
  RunPhase,
  buildRuns,
  fmtPeriod,
  isOpen,
  parsePeriod,
  periodKey,
  periodOptions,
  runPreflight,
  samePeriod,
} from "../../../shared/payroll";
import { GateDots } from "../../../shared/payrollUi";
import { Badge, Button, EmptyState, EndOfData, FilterSelect, Icon, InfoBanner, ModuleHeader, ResultBanner, Skeleton, SkeletonRows, Spinner } from "../../../shared/ui";

export interface PayrollRunsProps {
  ctx: ModuleContext;
  runs: Row[];
  lines: Row[];
  slips: Row[];
  hosts: Row[];
  /** {period:"2026-08", clockIns:[…], reports:[…]} for the period the modal asked for. */
  preflightRaw: string | null;
  preflightLoading: boolean;
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

interface PreflightData {
  period: Period | null;
  clockIns: Row[];
  reports: Row[];
}

function parsePreflight(raw: string | null): PreflightData {
  if (!raw) return { period: null, clockIns: [], reports: [] };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r)) : []);
    return { period: parsePeriod(String(o.period ?? "")), clockIns: rows(o.clockIns), reports: rows(o.reports) };
  } catch {
    return { period: null, clockIns: [], reports: [] };
  }
}

const PHASE_FILTER: { value: RunPhase | "OPEN"; label: string }[] = [
  { value: "OPEN", label: "Belum selesai" },
  { value: "DONE", label: "Selesai" },
  { value: "REJECTED", label: "Ditolak" },
];

export function PayrollRunsView(props: PayrollRunsProps): React.ReactElement {
  const { ctx, now, action } = props;
  const runOpts = React.useMemo(
    () => ({ now, labelOffset: configNumber(ctx, "payrollLabelOffset", -1), assemblyMinutes: configNumber(ctx, "payrollAssemblyMinutes", 30) }),
    [ctx, now],
  );
  const runs = React.useMemo(() => buildRuns(props.runs, props.lines, props.slips, runOpts), [props.runs, props.lines, props.slips, runOpts]);
  const canRun = hasPermission(ctx, "PAYROLL_RUN");
  const pageSize = Math.max(10, configNumber(ctx, "pageSize", 50));

  const [phase, setPhase] = React.useState("");
  const [year, setYear] = React.useState("");
  const [shown, setShown] = React.useState(pageSize);
  const [modal, setModal] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement>(null);

  const openRun = runs.find(isOpen);
  const filtered = runs.filter((r) => {
    if (phase === "OPEN" && !isOpen(r)) return false;
    if (phase && phase !== "OPEN" && r.phase !== phase) return false;
    if (year && String(r.dataPeriod?.year ?? "") !== year) return false;
    return true;
  });
  const visible = filtered.slice(0, shown);
  const localMore = filtered.length > visible.length;
  const years = [...new Set(runs.map((r) => r.dataPeriod?.year).filter((y): y is number => !!y))].sort((a, b) => b - a);
  const filterActive = phase !== "" || year !== "";
  const last = runs[0];

  // Close the modal once canvas confirms the run started; the list then shows it as "Sedang disusun".
  const res = action.lastResult;
  React.useEffect(() => {
    if (res?.action === "RUN_PAYROLL" && res.status === "ok") setModal(false);
  }, [res]);

  const openModal = () => {
    const scroller = hostRef.current?.closest(".pbs-root");
    if (scroller) scroller.scrollTop = 0;
    setModal(true);
  };

  return (
    <div className="pbs-host" ref={hostRef}>
      <div className="pbs-page">
        <ModuleHeader
          crumb="Kehadiran & payroll"
          title="Payroll"
          subtitle={
            props.loading && runs.length === 0
              ? "Memuat run payroll…"
              : last
                ? `${runs.length} run · terakhir ${last.title} ${fmtPeriod(last.dataPeriod)}: ${last.statusText}`
                : "Belum ada run payroll"
          }
          actions={
            canRun ? (
              <Button onClick={openModal} disabled={!!openRun} title={openRun ? `Masih ada run terbuka: ${openRun.title} (${openRun.statusText})` : undefined}>
                Jalankan payroll
              </Button>
            ) : undefined
          }
        />

        {res?.action === "RUN_PAYROLL" && !modal ? (
          <ResultBanner result={res} onClose={action.clearResult} okText="Payroll dijalankan. Run baru muncul di daftar setelah flow membuat item Payroll." />
        ) : null}

        {openRun ? (
          <InfoBanner
            action={
              <Button variant="secondary" size="sm" onClick={() => action.fire("OPEN_RUN", { payrollId: openRun.id, title: openRun.title })}>
                Lihat {openRun.title}
              </Button>
            }
          >
            <b>{openRun.title}</b> ({fmtPeriod(openRun.dataPeriod)}) masih berjalan ({openRun.statusText}). Run baru baru bisa dijalankan setelah run ini selesai atau ditolak.
          </InfoBanner>
        ) : null}

        <div className="pbs-filters">
          <FilterSelect label="Status" value={phase} options={PHASE_FILTER} onChange={(v) => { setPhase(v); setShown(pageSize); }} />
          <FilterSelect label="Tahun" value={year} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(v) => { setYear(v); setShown(pageSize); }} />
          {filterActive ? (
            <button type="button" className="pbs-link" onClick={() => { setPhase(""); setYear(""); }} style={{ marginLeft: 4 }}>
              Hapus filter
            </button>
          ) : null}
        </div>

        <div className="pbs-table-wrap">
          <div className="pbs-table-scroll">
            <table className="pbs-table" aria-busy={props.loading}>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th>Nama payroll</th>
                  <th>Status</th>
                  <th className="r">Total</th>
                  <th className="r">Host</th>
                  <th>Approval</th>
                  <th>Slip gaji</th>
                  <th>Dibuat</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {props.loading && runs.length === 0 ? (
                  <SkeletonRows rows={6} cols={9} />
                ) : (
                  visible.map((r) => <RunRow key={r.id || r.title} r={r} onOpen={() => action.fire("OPEN_RUN", { payrollId: r.id, title: r.title })} />)
                )}
              </tbody>
            </table>
          </div>
          {props.loading && runs.length === 0 ? null : filtered.length === 0 ? (
            filterActive ? (
              <EmptyState
                icon="filterX"
                title="Tidak ada run yang cocok dengan filter"
                action={
                  <Button variant="secondary" size="sm" onClick={() => { setPhase(""); setYear(""); }}>
                    Hapus filter
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="inbox" title="Belum ada run payroll" text={canRun ? "Pilih Jalankan payroll untuk membuat run pertama." : "Run payroll akan muncul di sini setelah dijalankan tim PBS."} />
            )
          ) : localMore || props.hasMore ? (
            <div className="pbs-foot">
              <span>
                Menampilkan 1–{fmtNumber(visible.length)} dari {fmtNumber(filtered.length)}
                {props.hasMore ? "+" : ""}
              </span>
              <span className="line" />
              <Button variant="secondary" size="sm" disabled={props.loading} onClick={() => (localMore ? setShown(shown + pageSize) : action.fire("LOAD_MORE", { loaded: runs.length }))}>
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
            <EndOfData text={`Semua ${fmtNumber(filtered.length)} run sudah ditampilkan`} />
          )}
        </div>
      </div>

      {modal ? <PreflightModal {...props} models={runs} onClose={() => setModal(false)} /> : null}
    </div>
  );
}

function RunRow(props: { r: RunModel; onOpen: () => void }): React.ReactElement {
  const { r } = props;
  const total = r.lineTotal ?? r.fieldTotal;
  const hosts = r.lineCount > 0 ? r.lineCount : r.fieldHosts;
  const labelDiffers = r.label && r.labelPeriod && r.dataPeriod && !samePeriod(r.labelPeriod, r.dataPeriod);
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        <div style={{ fontWeight: 600 }}>{fmtPeriod(r.dataPeriod)}</div>
        {labelDiffers ? (
          <div className="pbs-muted" style={{ fontSize: 11.5 }} title="Payroll.Periode ditulis dengan bulan run, bukan bulan data (P8)">
            label: {r.label}
          </div>
        ) : null}
      </td>
      <td>
        <div>{r.name || r.title}</div>
        <div className="pbs-muted pbs-mono" style={{ fontSize: 11.5 }}>
          {r.title}
          {r.manual ? " · manual" : ""}
        </div>
      </td>
      <td>
        <Badge tone={r.tone}>
          {r.phase === "ASSEMBLING" ? <span className="pbs-dot pbs-pulse" style={{ background: "#0072FF" }} /> : null}
          {r.statusText}
        </Badge>
      </td>
      <td className="r pbs-num" style={{ fontWeight: 600 }}>
        {total !== null ? fmtRupiah(total) : <span className="pbs-muted">—</span>}
      </td>
      <td className="r pbs-num">{hosts !== null ? fmtNumber(hosts) : "—"}</td>
      <td>
        <GateDots gates={r.gates} />
      </td>
      <td className="pbs-num">
        {r.slips ? (
          <span style={{ color: r.slips.failed + r.slips.bounced > 0 ? "#C0292A" : undefined, fontWeight: r.slips.failed + r.slips.bounced > 0 ? 600 : 400 }}>
            {r.slips.sent}/{r.slips.total} terkirim
          </span>
        ) : (
          <span className="pbs-muted" title="v1 tidak mencatat status pengiriman slip">
            —
          </span>
        )}
      </td>
      <td className="pbs-num pbs-muted" style={{ whiteSpace: "nowrap" }}>{fmtDateShort(r.created)}</td>
      <td className="r">
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          Lihat
        </Button>
      </td>
    </tr>
  );
}

// ---- P-2 preflight --------------------------------------------------------------------------------

function CheckIcon(props: { level: PreflightCheck["level"] }): React.ReactElement {
  return (
    <span className={`pbs-ci ${props.level}`} aria-hidden="true">
      <Icon name={props.level === "pass" ? "check" : props.level === "warn" ? "alert" : "x"} size={12} />
    </span>
  );
}

const LEVEL_WORD = { pass: "Lolos", warn: "Peringatan", block: "Memblokir" } as const;

function PreflightModal(props: PayrollRunsProps & { models: RunModel[]; onClose: () => void }): React.ReactElement {
  const { ctx, now, action } = props;
  const [key, setKey] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const options = React.useMemo(() => periodOptions(now, Math.max(1, configNumber(ctx, "payrollPeriodOptions", 6))), [now, ctx]);
  const period = options.find((p) => periodKey(p) === key) ?? null;
  const data = React.useMemo(() => parsePreflight(props.preflightRaw), [props.preflightRaw]);
  const ready = !!period && samePeriod(data.period, period) && !props.preflightLoading;
  const result = React.useMemo(
    () =>
      ready && period
        ? runPreflight({
            period,
            now,
            runs: props.models,
            hosts: props.hosts,
            clockIns: data.clockIns,
            reports: data.reports,
            previousMonthOnly: ctx.config.payrollAnyPeriod !== true,
          })
        : null,
    [ready, period, now, props.models, props.hosts, data, ctx],
  );

  const pending = action.pending?.action === "RUN_PAYROLL";
  const res = action.lastResult?.action === "RUN_PAYROLL" ? action.lastResult : null;
  const needsAck = !!result && result.warnings.length > 0;
  const canSubmit = !!result && !result.blocked && (!needsAck || ack) && !action.pending;

  const choose = (k: string) => {
    setKey(k);
    setAck(false);
    action.clearResult();
    const p = options.find((o) => periodKey(o) === k);
    if (p) action.fire("PREFLIGHT_PERIOD", { period: periodKey(p), year: p.year, month: p.month + 1, label: fmtPeriod(p) });
  };

  const submit = () => {
    if (!result || !period || !canSubmit) return;
    action.dispatch("RUN_PAYROLL", {
      period: periodKey(period),
      year: period.year,
      month: period.month + 1,
      label: fmtPeriod(period),
      acknowledgedWarnings: result.warnings,
      activeHosts: result.activeHosts,
      hostsWithAttendance: result.hostsWithAttendance,
      estimateTotal: result.estimate,
      requestedBy: ctx.userEmail,
    });
  };

  const link = (c: PreflightCheck) => {
    if (!c.link || !period) return null;
    const go = () =>
      c.link?.target === "OPEN_RUN"
        ? action.fire("OPEN_RUN", { payrollId: c.link.payrollId, title: c.link.title })
        : action.fire("NAV", { target: c.link?.target, period: periodKey(period), check: c.code });
    return (
      <button type="button" className="pbs-link" onClick={go}>
        {c.link.label ?? "lihat"}
      </button>
    );
  };

  const r = result?.rates;
  const rateParts = r
    ? [
        ["Manday", r.manday],
        ["Tier 1", r.tier1],
        ["Tier 2", r.tier2],
        ["Tier 3", r.tier3],
        ["Streak", r.streak],
      ].filter((x): x is [string, number] => x[1] !== null)
    : [];

  return (
    <div className="pbs-overlay" role="presentation" onKeyDown={(e) => e.key === "Escape" && !pending && props.onClose()}>
      <div className="pbs-modal" role="dialog" aria-modal="true" aria-labelledby="pbs-pf-title">
        <div className="pbs-modal-h">
          <h2 id="pbs-pf-title">Jalankan payroll</h2>
          <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>

        <div className="pbs-modal-b">
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-pf-period">
              Periode data kehadiran
            </label>
            <select id="pbs-pf-period" value={key} onChange={(e) => choose(e.target.value)} disabled={pending}>
              <option value="">Pilih periode…</option>
              {options.map((p) => (
                <option key={periodKey(p)} value={periodKey(p)}>
                  {fmtPeriod(p)}
                </option>
              ))}
            </select>
            <p className="pbs-hint">Dipilih sendiri, tidak diambil dari tanggal hari ini. Flow v1 menulis label run dengan bulan berikutnya (P8).</p>
          </div>

          <div>
            <div className="pbs-sec" style={{ marginBottom: 10 }}>
              <span className="pbs-sec-l">Preflight</span>
              {result ? (
                <span className="pbs-sec-r">
                  {result.checks.filter((c) => c.level === "block").length} memblokir · {result.warnings.length} peringatan
                </span>
              ) : null}
            </div>
            {!period ? (
              <p className="pbs-muted" style={{ margin: 0 }}>
                Pilih periode untuk memeriksa host, kehadiran, report, dan run yang sudah ada.
              </p>
            ) : !result ? (
              <div className="pbs-grid" style={{ gap: 8 }} role="status" aria-label="Memeriksa">
                {[70, 55, 80, 60].map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 10px" }}>
                    <Skeleton w={20} h={20} r={10} />
                    <Skeleton w={`${w}%`} />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="pbs-checks">
                {result.checks.map((c) => (
                  <li key={c.code} className={c.level}>
                    <CheckIcon level={c.level} />
                    <span className="pbs-sr">{LEVEL_WORD[c.level]}: </span>
                    <span className="grow">{c.text}</span>
                    {link(c)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {result ? (
            <div className="pbs-muted" style={{ fontSize: 12.5 }}>
              {rateParts.length > 0 ? (
                <div className="pbs-num">
                  {rateParts.map(([l, v]) => `${l} ${fmtRupiah(v)}`).join(" · ")}
                  <span> — tarif yang tercatat di Clock In {fmtPeriod(period)}</span>
                </div>
              ) : null}
              <div className="pbs-num" style={{ marginTop: 4 }}>
                Perkiraan total <b style={{ color: "#000" }}>{fmtRupiah(result.estimate)}</b> untuk {result.activeHosts} host aktif (HKTugas + Insentif + Streak).
              </div>
            </div>
          ) : null}

          {needsAck && !result?.blocked ? (
            <label className="pbs-ack">
              <input type="checkbox" className="pbs-check" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={pending} style={{ marginTop: 2 }} />
              <span>Saya sudah memeriksa {result?.warnings.length} peringatan di atas dan tetap ingin menjalankan payroll {fmtPeriod(period)}.</span>
            </label>
          ) : null}

          {res && res.status !== "ok" ? (
            <InfoBanner tone="err">
              Payroll tidak berjalan: {res.message || "flow mengembalikan error."} Periksa daftar run: kalau item Payroll sudah terbuat sebagian, tolak run itu sebelum mencoba lagi.
            </InfoBanner>
          ) : null}
        </div>

        <div className="pbs-modal-f">
          {result?.blocked ? (
            <span className="pbs-muted" style={{ fontSize: 12, marginRight: "auto" }}>
              Selesaikan item yang memblokir dulu.
            </span>
          ) : null}
          <Button variant="ghost" onClick={props.onClose} disabled={pending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!canSubmit} title={!period ? "Pilih periode dulu" : result?.blocked ? "Ada item yang memblokir" : needsAck && !ack ? "Centang pengakuan peringatan" : undefined}>
            {pending ? (
              <>
                <Spinner small /> Menjalankan…
              </>
            ) : (
              "Jalankan payroll"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

