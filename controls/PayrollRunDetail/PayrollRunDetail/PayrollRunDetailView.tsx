import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { Row, bool, date, num, str } from "../../../shared/data";
import { fmtDateTimeShort, fmtDayMonth, fmtNumber, fmtRupiah, fmtTime } from "../../../shared/format";
import { LINE_FLAG, PayLine, RunDetail, SLIP_LABEL, buildRunDetail, clockInDay, fmtPeriod, samePeriod, slipState, tierOf } from "../../../shared/payroll";
import { ApprovalTimeline } from "../../../shared/payrollUi";
import { Badge, Button, EmptyState, EndOfData, FilterSelect, Icon, InfoBanner, ModuleHeader, Pill, ResultBanner, Skeleton, SkeletonRows, Spinner } from "../../../shared/ui";

export type DetailTab = "Lines" | "Approval" | "Payslip";

export interface PayrollRunDetailProps {
  ctx: ModuleContext;
  runs: Row[];
  lines: Row[];
  clockIns: Row[];
  slips: Row[];
  defaultTab: DetailTab;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

const TAB_LABEL: Record<DetailTab, string> = { Lines: "Baris payroll", Approval: "Approval", Payslip: "Slip gaji" };

const money = (n: number | null) => (n === null ? <span className="pbs-muted">—</span> : fmtRupiah(n));

export function PayrollRunDetailView(props: PayrollRunDetailProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(
    () => ({ now, labelOffset: configNumber(ctx, "payrollLabelOffset", -1), assemblyMinutes: configNumber(ctx, "payrollAssemblyMinutes", 30) }),
    [ctx, now],
  );
  const d = React.useMemo(() => buildRunDetail(props.runs[0], props.lines, props.clockIns, props.slips, opts), [props.runs, props.lines, props.clockIns, props.slips, opts]);
  const [tab, setTab] = React.useState<DetailTab>(props.defaultTab);
  React.useEffect(() => setTab(props.defaultTab), [props.defaultTab]);

  const run = d.run;
  const back = (
    <button type="button" onClick={() => action.fire("BACK", {})}>
      Payroll
    </button>
  );

  if (!run) {
    return (
      <div className="pbs-page">
        <ModuleHeader crumb={back} title="Detail payroll" />
        {props.loading ? (
          <div className="pbs-grid">
            <Skeleton h={90} />
            <Skeleton h={240} />
          </div>
        ) : (
          <InfoBanner tone="warn">Run payroll tidak ditemukan. Mungkin sudah dihapus, atau properti PayrollJson belum diisi.</InfoBanner>
        )}
      </div>
    );
  }

  const hostCount = d.lines.length || run.fieldHosts || 0;
  const avg = hostCount > 0 ? d.totals.bruto / hostCount : null;
  const labelDiffers = run.labelPeriod && run.dataPeriod && !samePeriod(run.labelPeriod, run.dataPeriod);
  const slipSummary = run.slips;

  return (
    <div className="pbs-page">
      <ModuleHeader
        crumb={
          <>
            {back} <span aria-hidden="true">›</span> {run.title}
          </>
        }
        title={`${run.title} · ${fmtPeriod(run.dataPeriod)}`}
        subtitle={
          <>
            {run.name || "Pembayaran mitra host"}
            {labelDiffers ? ` · label run ${run.label}` : ""}
            {run.created ? ` · dibuat ${fmtDateTimeShort(run.created)}` : ""}
          </>
        }
        actions={
          <>
            <Pill tone={run.tone}>
              {run.phase === "ASSEMBLING" ? <span className="pbs-dot pbs-pulse" style={{ background: "#fff" }} /> : null}
              {run.statusText}
            </Pill>
            <Button variant="secondary" size="sm" onClick={() => action.fire("RELOAD", { payrollId: run.id, title: run.title })}>
              <Icon name="refresh" size={14} /> Muat ulang
            </Button>
          </>
        }
      />

      <ResultBanner result={action.lastResult} onClose={action.clearResult} okText="Slip dijadwalkan untuk dikirim ulang." />

      {d.periodMismatch.count > 0 ? (
        <InfoBanner tone="warn">
          <b>Label periode tidak cocok.</b> {d.periodMismatch.count} baris Payroll Data bertanda {d.periodMismatch.labels.join(", ")}, padahal run ini untuk data {fmtPeriod(run.dataPeriod)}. Flow v1 menulis label periode tetap (P2): cek slip sebelum dikirim.
        </InfoBanner>
      ) : null}
      {d.totalMismatch ? (
        <InfoBanner tone="err">
          <b>Total tidak rekonsil.</b> Payroll.TotalPayroll {fmtRupiah(run.fieldTotal)} berbeda dari jumlah baris {fmtRupiah(d.totals.bruto)}.
        </InfoBanner>
      ) : null}
      {d.lines.length === 0 && !props.loading && run.phase !== "ASSEMBLING" ? (
        <InfoBanner tone="warn">
          Run ini tidak punya baris Payroll Data.{" "}
          {run.manual ? "Run manual dari tombol app (PBS0003M) memang tidak menulis Payroll Data." : "Flow mungkin gagal di tengah: cek riwayat flow PBS0003A."}
        </InfoBanner>
      ) : null}

      <div className="pbs-kpis">
        <div className="pbs-kpi">
          <div className="l">Total payroll</div>
          <div className="v">{props.loading && d.lines.length === 0 ? <Skeleton w={140} h={24} /> : fmtRupiah(d.lines.length ? d.totals.bruto : run.fieldTotal)}</div>
          <div className="n">{run.fieldTotal === null ? "Dihitung dari baris: TotalPayroll tidak ditulis flow v1 (P9)" : d.totalMismatch ? "Tidak sama dengan TotalPayroll" : "Sama dengan TotalPayroll"}</div>
        </div>
        <div className="pbs-kpi">
          <div className="l">Jumlah host</div>
          <div className="v">{fmtNumber(hostCount)}</div>
          <div className="n">{d.attention > 0 ? `${d.attention} baris perlu perhatian` : "Semua baris lengkap"}</div>
        </div>
        <div className="pbs-kpi">
          <div className="l">Rata-rata per host</div>
          <div className="v">{fmtRupiah(avg)}</div>
          <div className="n">{d.pphAllZero ? "PPh21 Rp0 di semua baris (belum dihitung flow v1, P3)" : `PPh21 total ${fmtRupiah(d.totals.pph21)}`}</div>
        </div>
      </div>

      <div className="pbs-tabs" role="tablist">
        {(["Lines", "Approval", "Payslip"] as DetailTab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pbs-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "Lines" ? <span className="pbs-count">{fmtNumber(d.lines.length)}</span> : null}
            {t === "Payslip" && slipSummary ? (
              <span className="pbs-count">
                {slipSummary.sent}/{slipSummary.total}
              </span>
            ) : null}
            {t === "Approval" && run.rejectedAt ? <span className="pbs-dot" style={{ background: "#FF4646" }} /> : null}
          </button>
        ))}
      </div>

      {tab === "Lines" ? <LinesTab d={d} loading={props.loading} /> : null}
      {tab === "Approval" ? (
        <div className="pbs-card pbs-card-pad">
          <ApprovalTimeline gates={run.gates} />
          <p className="pbs-hint" style={{ marginTop: 4 }}>
            Approval berjalan di Power Automate (PBS0003A). Waktu hanya tercatat untuk keputusan terakhir; Finance menerima email tanpa kartu approval (P5).
          </p>
        </div>
      ) : null}
      {tab === "Payslip" ? <PayslipTab d={d} canResend={hasPermission(ctx, "PAYROLL_RUN")} action={action} runId={run.id} runTitle={run.title} loading={props.loading} /> : null}
    </div>
  );
}

// ---- P-3 lines ------------------------------------------------------------------------------------

function LinesTab(props: { d: RunDetail; loading: boolean }): React.ReactElement {
  const { d } = props;
  const [show, setShow] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const rows = show === "ATTN" ? d.lines.filter((l) => l.flags.length > 0) : show ? d.lines.filter((l) => l.flags.includes(show as PayLine["flags"][number])) : d.lines;
  const visible = rows; // every row: a partial list was read as the whole total
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const flagOptions = [
    { value: "ATTN", label: `Perlu perhatian (${d.attention})` },
    ...(Object.keys(LINE_FLAG) as PayLine["flags"][number][])
      .map((f) => ({ f, n: d.lines.filter((l) => l.flags.includes(f)).length }))
      .filter((x) => x.n > 0)
      .map((x) => ({ value: x.f, label: `${LINE_FLAG[x.f].label} (${x.n})` })),
  ];
  const noBank = d.lines.filter((l) => l.flags.includes("NO_BANK")).length;
  const COLS = 13;

  return (
    <>
      {noBank > 0 ? (
        <InfoBanner tone="err">
          <b>{noBank} host tanpa data rekening.</b> Transfer dan slip untuk mereka akan gagal. Lengkapi Bank dan NoRekening di list Host sebelum run disetujui.
        </InfoBanner>
      ) : null}
      <div className="pbs-filters">
        <FilterSelect label="Tampilkan semua baris" value={show} options={flagOptions} onChange={(v) => { setShow(v); }} />
        {show ? (
          <button type="button" className="pbs-link" onClick={() => setShow("")}>
            Hapus filter
          </button>
        ) : null}
      </div>
      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table dense" aria-busy={props.loading}>
            <thead>
              <tr>
                <th aria-label="Rincian" style={{ width: 36 }} />
                <th>Nama</th>
                <th className="r">HK</th>
                <th className="r">Uang kehadiran</th>
                <th className="r">Mingguan</th>
                <th className="r">Tier 1</th>
                <th className="r">Tier 2</th>
                <th className="r">Tier 3</th>
                <th className="r">Bruto</th>
                <th className="r">PPh21</th>
                <th className="r">Net THP</th>
                <th>Bank</th>
                <th>Slip</th>
              </tr>
            </thead>
            <tbody>
              {props.loading && d.lines.length === 0 ? (
                <SkeletonRows rows={8} cols={COLS} />
              ) : (
                visible.map((l) => <LineRows key={l.id} l={l} open={open.has(l.id)} onToggle={() => toggle(l.id)} cols={COLS} />)
              )}
            </tbody>
            {d.lines.length > 0 && !show ? (
              <tfoot>
                <tr>
                  <td />
                  <td>Total {fmtNumber(d.lines.length)} host</td>
                  <td className="r pbs-num">{fmtNumber(d.totals.hk)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.uangKehadiran)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.mingguan)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.tier1)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.tier2)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.tier3)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.bruto)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.pph21)}</td>
                  <td className="r pbs-num">{fmtRupiah(d.totals.net)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {props.loading && d.lines.length === 0 ? null : rows.length === 0 ? (
          show ? (
            <EmptyState good title="Tidak ada baris dengan catatan ini" />
          ) : (
            <EmptyState icon="inbox" title="Belum ada baris payroll" text="Baris muncul setelah flow selesai menyusun Payroll Data untuk run ini." />
          )
        ) : (
          <EndOfData text={`Total ${fmtNumber(rows.length)} baris`} />
        )}
      </div>
    </>
  );
}

function LineRows(props: { l: PayLine; open: boolean; onToggle: () => void; cols: number }): React.ReactElement {
  const { l } = props;
  const bad = l.flags.includes("NO_BANK") || l.flags.includes("SOURCE_MISMATCH");
  const slip = l.slip ? SLIP_LABEL[l.slip] : null;
  return (
    <>
      <tr className={bad ? "bad" : props.open ? "open" : undefined}>
        <td>
          <button type="button" className={`pbs-exp${props.open ? " on" : ""}`} onClick={props.onToggle} aria-expanded={props.open} aria-label={`Rincian kehadiran ${l.name}`}>
            <Icon name="chevronDown" size={14} />
          </button>
        </td>
        <td>
          <div style={{ fontWeight: 600 }}>{l.name}</div>
          {l.flags.length > 0 ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
              {l.flags.map((f) => (
                <Badge key={f} tone={LINE_FLAG[f].tone} small title={LINE_FLAG[f].hint}>
                  {LINE_FLAG[f].label}
                </Badge>
              ))}
            </div>
          ) : null}
        </td>
        <td className="r pbs-num">{l.hk === null ? "—" : fmtNumber(l.hk)}</td>
        <td className="r pbs-num">{money(l.uangKehadiran)}</td>
        <td className="r pbs-num">{money(l.mingguan)}</td>
        <td className="r pbs-num">{money(l.tier1)}</td>
        <td className="r pbs-num">{money(l.tier2)}</td>
        <td className="r pbs-num">{money(l.tier3)}</td>
        <td className="r pbs-num" style={{ fontWeight: 600 }}>
          {money(l.bruto)}
        </td>
        <td className="r pbs-num">{money(l.pph21)}</td>
        <td className="r pbs-num" style={{ fontWeight: 600 }}>
          {money(l.net)}
        </td>
        <td>
          {l.hasBank === false ? (
            <span style={{ color: "#C0292A", fontWeight: 600 }}>Belum ada</span>
          ) : (
            <span className="pbs-num">
              {l.bank || "—"}
              {l.norekLast4 ? <span className="pbs-muted"> •••• {l.norekLast4}</span> : null}
            </span>
          )}
        </td>
        <td>{slip ? <Badge tone={slip.tone}>{slip.label}</Badge> : <span className="pbs-muted">—</span>}</td>
      </tr>
      {props.open ? (
        <tr className="sub">
          <td colSpan={props.cols}>
            <SourceAttendance l={l} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SourceAttendance(props: { l: PayLine }): React.ReactElement {
  const { l } = props;
  if (l.sourceTotal === null) {
    return <p className="pbs-muted" style={{ margin: "10px 0 0" }}>Catatan Clock In tidak dikirim ke komponen (ClockInJson kosong atau HostID tidak ada di baris).</p>;
  }
  if (l.clockIns.length === 0) {
    return <p className="pbs-muted" style={{ margin: "10px 0 0" }}>Tidak ada Clock In untuk host ini di periode data run.</p>;
  }
  const diff = l.bruto !== null ? l.bruto - l.sourceTotal : null;
  return (
    <div style={{ paddingTop: 10 }}>
      <div className="pbs-strip" style={{ margin: "0 0 8px" }}>
        <span>
          {l.clockIns.length} catatan Clock In · jumlah HKTugas + Insentif + Streak <b className="pbs-num" style={{ color: "#000" }}>{fmtRupiah(l.sourceTotal)}</b>
        </span>
        {diff !== null && Math.abs(diff) >= 1 ? (
          <Badge tone="danger">Selisih {fmtRupiah(diff)} dari bruto</Badge>
        ) : (
          <Badge tone="success">Cocok dengan bruto</Badge>
        )}
      </div>
      <div className="pbs-table-scroll">
        <table className="pbs-sub-t">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Check in</th>
              <th>Check out</th>
              <th>Geofence</th>
              <th>Tier</th>
              <th className="r">HKTugas</th>
              <th className="r">Insentif</th>
              <th className="r">Streak</th>
            </tr>
          </thead>
          <tbody>
            {l.clockIns.map((c, i) => {
              const inside = bool(c, "IsInsideGeofence");
              const out = date(c, "CheckOutTime", "ClockOutTime");
              const t = tierOf(c);
              return (
                <tr key={i}>
                  <td className="pbs-num">{fmtDayMonth(clockInDay(c))}</td>
                  <td className="pbs-num">{fmtTime(date(c, "CheckInTime"))}</td>
                  <td className="pbs-num">{out ? fmtTime(out) : <span style={{ color: "#7A5B00", fontWeight: 600 }}>belum</span>}</td>
                  <td>{inside === false ? <Badge tone="danger" small>Di luar</Badge> : inside ? "Di dalam" : "—"}</td>
                  <td>{t ? `Tier ${t}` : "—"}</td>
                  <td className="r pbs-num">{money(num(c, "HKTugas"))}</td>
                  <td className="r pbs-num">{money(num(c, "Insentif"))}</td>
                  <td className="r pbs-num">{money(num(c, "Streak"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- P-5 payslips ---------------------------------------------------------------------------------

function PayslipTab(props: { d: RunDetail; canResend: boolean; action: UseActionResult; runId: string; runTitle: string; loading: boolean }): React.ReactElement {
  const { d, action } = props;
  const s = d.run?.slips ?? null;
  if (!d.slipsTracked || !s) {
    return (
      <div className="pbs-card">
        <EmptyState
          icon="inbox"
          title={props.loading ? "Memuat status slip…" : "Status slip belum tercatat"}
          text="Flow v1 (PBS0003A) membuat slip PDF dan mengirimnya lewat email tanpa mencatat hasilnya. Tambahkan list log slip lalu isi PayslipJson supaya status per host muncul di sini."
        />
      </div>
    );
  }
  const failed = props.d.lines
    .filter((l) => l.slip === "FAILED" || l.slip === "BOUNCED")
    .map((l) => ({ lineId: l.id, name: l.name, email: l.email, hostId: l.hostId }));
  const pending = action.pending?.action === "RESEND_PAYSLIPS";
  const processed = s.sent + s.failed + s.bounced;
  const generating = s.generated > 0 || processed < s.total;
  const pct = (n: number) => `${s.total > 0 ? (n / s.total) * 100 : 0}%`;
  const bySlip = new Map(d.lines.map((l) => [l.id, l]));
  // Failures first: those are the rows someone has to act on.
  const rank = (l: PayLine) => (l.slip === "FAILED" ? 0 : l.slip === "BOUNCED" ? 1 : !l.slipRow ? 2 : l.slip === "GENERATED" ? 3 : 4);
  const rows = [...d.lines].sort((x, y) => rank(x) - rank(y));

  return (
    <>
      <div className="pbs-card pbs-card-pad" style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700 }} className="pbs-num">
          {s.sent} dari {s.total} slip terkirim
        </div>
        <div className="pbs-bar" role="img" aria-label={`${s.sent} terkirim, ${s.failed} gagal, ${s.bounced} bounce`}>
          <span style={{ width: pct(s.sent), background: "#02C82B" }} />
          <span style={{ width: pct(s.bounced), background: "#FFCD00" }} />
          <span style={{ width: pct(s.failed), background: "#FF4646" }} />
        </div>
        <div className="pbs-muted" style={{ fontSize: 12 }}>
          {generating ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <Spinner small /> {s.generated} sedang dibuat
            </span>
          ) : null}
          {s.failed > 0 ? ` · ${s.failed} gagal` : ""}
          {s.bounced > 0 ? ` · ${s.bounced} bounce` : ""}
        </div>
        {props.canResend ? (
          <Button
            disabled={failed.length === 0 || !!action.pending}
            title={failed.length === 0 ? "Tidak ada slip yang gagal" : undefined}
            onClick={() => action.dispatch("RESEND_PAYSLIPS", { payrollId: props.runId, title: props.runTitle, items: failed })}
          >
            {pending ? (
              <>
                <Spinner small /> Mengirim…
              </>
            ) : (
              `Kirim ulang yang gagal${failed.length ? ` (${failed.length})` : ""}`
            )}
          </Button>
        ) : null}
      </div>
      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Status</th>
                <th>Waktu kirim</th>
                <th>Alasan gagal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const st = l.slipRow ? slipState(l.slipRow) : null;
                const lab = st ? SLIP_LABEL[st] : null;
                const sent = l.slipRow ? date(l.slipRow, "SentAt", "WaktuKirim", "Modified") : null;
                return (
                  <tr key={l.id} className={st === "FAILED" ? "bad" : undefined}>
                    <td style={{ fontWeight: 600 }}>{bySlip.get(l.id)?.name}</td>
                    <td className="pbs-muted">{l.email || "—"}</td>
                    <td>{lab ? <Badge tone={lab.tone}>{lab.label}</Badge> : <Badge tone="neutral">Belum dibuat</Badge>}</td>
                    <td className="pbs-num">{st === "SENT" || st === "BOUNCED" ? fmtDateTimeShort(sent) : "—"}</td>
                    <td style={{ color: st === "FAILED" ? "#C0292A" : undefined }}>{l.slipRow ? str(l.slipRow, "Error", "Reason", "AlasanGagal") || "—" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <EndOfData text={`Semua ${fmtNumber(rows.length)} slip sudah ditampilkan`} />
      </div>
    </>
  );
}
