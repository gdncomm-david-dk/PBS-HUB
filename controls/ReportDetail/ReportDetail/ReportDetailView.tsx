import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { Row, date, person, str } from "../../../shared/data";
import { fmtAgo, fmtDate, fmtDateTimeShort, fmtNumber, fmtPercentValue, fmtRupiah, fmtSignedPct } from "../../../shared/format";
import { COMPARED_METRICS, MetricComparison, MetricDef, REASONS, REVIEW_STATES, UNCOMPARED_METRICS, readMetric } from "../../../shared/reconcile";
import { ReportItem, buildReportItems, itemRef } from "../../../shared/reportItems";
import { Badge, Button, Icon, InfoBanner, Pill, ResultBanner, SectionHeader, Skeleton, Spinner } from "../../../shared/ui";

export interface ReportDetailProps {
  ctx: ModuleContext;
  reports: Row[];
  evidence: Row[];
  brands: Row[];
  hosts: Row[];
  readOnly: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

const DECISION_ACTIONS = ["APPROVE", "APPROVE_WITHOUT_EVIDENCE", "REQUEST_REVISION", "ESCALATE"];

const DECISION_DONE_TEXT: Record<string, string> = {
  APPROVE: "Keputusan tersimpan: report disetujui.",
  APPROVE_WITHOUT_EVIDENCE: "Keputusan tersimpan: report disetujui tanpa bukti.",
  REQUEST_REVISION: "Permintaan revisi terkirim ke host.",
  ESCALATE: "Report dieskalasi.",
  REMIND_HOST: "Pengingat terkirim ke host.",
};

export function fmtMetric(def: MetricDef, v: number | null): string {
  if (v === null) return "—";
  switch (def.format) {
    case "idr":
      return fmtRupiah(v);
    case "pct":
      return fmtPercentValue(v);
    case "min":
      return `${fmtNumber(v)} menit`;
    default:
      return fmtNumber(v);
  }
}

function firstUrl(s: string): string {
  const m = /https?:\/\/[^\s"'<>;,]+/i.exec(s);
  return m ? m[0] : "";
}

function fileName(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return last || u.hostname;
  } catch {
    return url;
  }
}

export function ReportDetailView(props: ReportDetailProps): React.ReactElement {
  const { ctx, action } = props;
  const tolerancePct = configNumber(ctx, "tolerancePct", 5);
  const confidenceThreshold = configNumber(ctx, "confidenceThreshold", 0.85);
  const opts = React.useMemo(() => ({ tolerancePct, confidenceThreshold }), [tolerancePct, confidenceThreshold]);
  const item: ReportItem | undefined = React.useMemo(
    () => buildReportItems(props.reports.slice(0, 1), props.evidence, props.brands, props.hosts, opts)[0],
    [props.reports, props.evidence, props.brands, props.hosts, opts],
  );

  if (props.loading && !item) return <LoadingDetail />;
  if (!item) {
    return (
      <div className="pbs-page">
        <BackLink onBack={() => action.fire("BACK", {})} />
        <InfoBanner tone="warn">Report tidak ditemukan. Mungkin sudah dihapus, atau properti ReportJson belum diisi.</InfoBanner>
      </div>
    );
  }
  return <Detail key={item.id || item.title} {...props} item={item} tolerancePct={tolerancePct} />;
}

function BackLink(props: { onBack: () => void }): React.ReactElement {
  return (
    <div className="pbs-crumb" style={{ marginBottom: 12 }}>
      <button type="button" onClick={props.onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="arrowLeft" size={14} /> Antrean rekonsiliasi
      </button>
    </div>
  );
}

function Detail(props: ReportDetailProps & { item: ReportItem; tolerancePct: number }): React.ReactElement {
  const { ctx, now, action, item, tolerancePct } = props;
  const report = item.row;
  const ev = item.rec.evidence;
  const [comment, setComment] = React.useState("");
  const [revising, setRevising] = React.useState(false);
  const [flagged, setFlagged] = React.useState<Set<string>>(() => new Set(item.rec.outOfTolerance.map((m) => m.def.key)));
  const [showUncompared, setShowUncompared] = React.useState(false);
  const [zoom, setZoom] = React.useState(false);
  const [imgFailed, setImgFailed] = React.useState(false);

  const pending = action.pending;
  const submitting = !!pending && DECISION_ACTIONS.includes(pending.action);
  const last = action.lastResult;
  const decidedByMe = !!last && last.status === "ok" && DECISION_ACTIONS.includes(last.action);
  const conflict = last?.status === "conflict" ? last : null;

  const approver = person(report, "Approver");
  const approverEmail = str(report, "ApproverEmail") || approver.email;
  const approverName = approver.name || approverEmail;
  const modified = date(report, "Modified");
  const mine = !!approverEmail && !!ctx.userEmail && approverEmail.toLowerCase() === ctx.userEmail.toLowerCase();
  const decidedElsewhere = item.state !== "WAITING" && !decidedByMe && !mine;

  const canDecide = !props.readOnly && hasPermission(ctx, "REPORT_ADJUDICATE") && item.state === "WAITING" && !decidedByMe && !conflict;
  const reason = REASONS[item.rec.reason];
  const noEvidence = !ev;

  const decide = (decision: "APPROVE" | "APPROVE_WITHOUT_EVIDENCE" | "REQUEST_REVISION" | "ESCALATE") => {
    const base = { ...itemRef(item), decision, approverEmail: ctx.userEmail, approverName: ctx.userName, reason: item.rec.reason };
    if (decision === "APPROVE") {
      action.dispatch("APPROVE", { ...base, approvalStatus: "Done", match: "Match", comment: comment.trim(), flaggedMetrics: [] });
    } else if (decision === "APPROVE_WITHOUT_EVIDENCE") {
      action.dispatch("APPROVE_WITHOUT_EVIDENCE", { ...base, approvalStatus: "Done", match: "", comment: `[Tanpa bukti] ${comment.trim()}`, flaggedMetrics: [] });
    } else if (decision === "REQUEST_REVISION") {
      const keys = COMPARED_METRICS.filter((m) => flagged.has(m.key));
      const note = comment.trim();
      action.dispatch("REQUEST_REVISION", {
        ...base,
        approvalStatus: "Need Revision",
        match: "Unmatch",
        flaggedMetrics: keys.map((m) => m.key),
        comment: `${note}\nMetrik yang perlu dibetulkan: ${keys.map((m) => m.label).join(", ")}`,
      });
    } else {
      action.dispatch("ESCALATE", { ...base, approvalStatus: str(report, "ApprovalStatus") || "Waiting Approval", match: str(report, "Match"), comment: `[Eskalasi] ${comment.trim()}`, flaggedMetrics: [] });
    }
  };

  const headerPill = decidedByMe ? (
    <Pill tone="success">Keputusan tersimpan</Pill>
  ) : item.state === "WAITING" ? (
    <Pill tone={reason.tone === "neutral" ? "neutral" : reason.tone}>{reason.label}</Pill>
  ) : (
    <Pill tone={REVIEW_STATES[item.state].tone}>{REVIEW_STATES[item.state].label}</Pill>
  );

  return (
    <div className="pbs-page">
      <BackLink onBack={() => action.fire("BACK", {})} />

      {conflict || decidedElsewhere ? (
        <InfoBanner
          action={
            <Button variant="secondary" onClick={() => action.fire("RELOAD", itemRef(item))}>
              Muat ulang
            </Button>
          }
        >
          {conflict
            ? `Report ini sudah diputuskan oleh ${conflict.decidedBy || "orang lain"}${conflict.decidedAt ? ` ${fmtAgo(new Date(conflict.decidedAt), now)}` : ""}. Keputusanmu tidak disimpan.`
            : item.state === "DONE_AUTO"
              ? `Report ini sudah diputuskan otomatis oleh flow rekonsiliasi ${fmtAgo(modified, now)}.`
              : `Report ini sudah diputuskan oleh ${approverName || "orang lain"} ${fmtAgo(modified, now)}.`}
        </InfoBanner>
      ) : null}

      <ResultBanner result={conflict ? null : last} okText={last ? DECISION_DONE_TEXT[last.action] : undefined} onClose={action.clearResult} />

      <div className="pbs-card" style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, paddingRight: 20, borderRight: "1px solid #E8E8E8" }}>{item.title || `Report #${item.id}`}</div>
        <HeaderField label="Tanggal live" value={fmtDate(item.liveDate)} />
        <HeaderField label="Brand" value={item.brand} />
        <HeaderField label="Host" value={item.host} />
        <HeaderField label="Akun" value={[item.account, item.platform].filter(Boolean).join(" · ") || "—"} last />
        <div style={{ marginLeft: "auto" }}>{headerPill}</div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          <MetricsTable item={item} noEvidence={noEvidence} tolerancePct={tolerancePct} />
          <div className="pbs-strip">
            <span>Tidak dibandingkan: {UNCOMPARED_METRICS.map((m) => m.label).join(" · ")}</span>
            <button type="button" className="pbs-link" onClick={() => setShowUncompared(!showUncompared)}>
              {showUncompared ? "Sembunyikan nilai" : "Lihat nilai"}
            </button>
          </div>
          {showUncompared ? <UncomparedTable report={report} evidence={ev} /> : null}

          <div style={{ marginTop: 16 }}>
            {submitting ? (
              <div className="pbs-card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
                <Spinner />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>Mengirim keputusan…</div>
                  <div style={{ fontSize: 12, color: "#60686E" }}>Tombol dimatikan sampai hasil tulis kembali, supaya tidak ada keputusan ganda.</div>
                </div>
                <Button disabled>Mengirim…</Button>
              </div>
            ) : canDecide && revising ? (
              <RevisionPanel
                item={item}
                flagged={flagged}
                setFlagged={setFlagged}
                note={comment}
                setNote={setComment}
                onCancel={() => setRevising(false)}
                onSend={() => decide("REQUEST_REVISION")}
              />
            ) : canDecide ? (
              <div className="pbs-card" style={{ padding: 18 }}>
                <label className="pbs-label" htmlFor="pbs-comment">
                  Komentar untuk host
                </label>
                <textarea
                  id="pbs-comment"
                  className="pbs-textarea"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={noEvidence ? "Wajib diisi kalau menyetujui tanpa bukti…" : "Tulis apa yang perlu dibetulkan, atau alasan persetujuan…"}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  {noEvidence ? (
                    <>
                      <Button variant="secondary" onClick={() => action.dispatch("REMIND_HOST", { ...itemRef(item), hostId: item.hostId })}>
                        Ingatkan host kirim bukti
                      </Button>
                      <Button variant="ghost" disabled={comment.trim() === ""} onClick={() => decide("APPROVE_WITHOUT_EVIDENCE")} title={comment.trim() === "" ? "Isi komentar dulu" : undefined}>
                        Setujui tanpa bukti
                      </Button>
                      <Button variant="ghost" onClick={() => setRevising(true)}>
                        Perlu revisi
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => decide("APPROVE")}>Setujui</Button>
                      <Button variant="secondary" onClick={() => setRevising(true)}>
                        Perlu revisi
                      </Button>
                      <Button variant="ghost" onClick={() => decide("ESCALATE")}>
                        Eskalasi
                      </Button>
                    </>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#60686E" }}>
                    {noEvidence ? "Persetujuan tanpa bukti tercatat khusus dan masuk laporan bulanan." : `Keputusan tercatat atas nama ${ctx.userName || ctx.userEmail || "kamu"}`}
                  </span>
                </div>
                {!noEvidence && item.rec.outOfTolerance.length > 0 ? (
                  <p style={{ fontSize: 12, color: "#7A5B00", margin: "12px 0 0" }}>
                    {item.rec.outOfTolerance.length} metrik di luar ±{fmtNumber(tolerancePct)}%. Menyetujui berarti kamu menerima klaim host apa adanya.
                  </p>
                ) : null}
              </div>
            ) : (
              <DecisionSummary report={report} item={item} now={now} decidedByMe={decidedByMe} readOnly={props.readOnly} />
            )}
          </div>
        </div>

        <EvidenceRail
          item={item}
          report={report}
          evidence={ev}
          imgFailed={imgFailed}
          onImgError={() => setImgFailed(true)}
          onZoom={() => setZoom(true)}
          onOpen={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: item.id, title: item.title })}
          confidenceThreshold={configNumber(ctx, "confidenceThreshold", 0.85)}
          tolerancePct={tolerancePct}
        />
      </div>

      {zoom ? <Lightbox url={evidenceUrl(report, ev)} onClose={() => setZoom(false)} /> : null}
    </div>
  );
}

function HeaderField(props: { label: string; value: string; last?: boolean }): React.ReactElement {
  return (
    <div style={{ paddingRight: props.last ? 0 : 20, borderRight: props.last ? undefined : "1px solid #E8E8E8", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "#60686E", marginBottom: 3 }}>{props.label}</div>
      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.value}</div>
    </div>
  );
}

function DeltaCell(props: { m: MetricComparison; tolerancePct: number }): React.ReactElement {
  const { m } = props;
  const band = `±${fmtNumber(props.tolerancePct)}%`;
  if (m.note === "evidence-empty") return <Badge tone="warning">bukti kosong</Badge>;
  if (m.note === "claim-empty") return <Badge tone="warning">klaim kosong</Badge>;
  if (m.note === "zero-zero") return <Badge tone="danger" title="Klaim dan bukti sama-sama 0">nol lawan nol</Badge>;
  if (m.note === "evidence-zero")
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: "#C0292A", fontWeight: 600 }}>bukti 0</span>
        <Badge tone="danger">di luar {band}</Badge>
      </span>
    );
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <span className="pbs-num" style={{ fontWeight: 600, color: m.within ? "#0A7A24" : "#C0292A" }}>
        {fmtSignedPct(m.ratio)}
      </span>
      <Badge tone={m.within ? "success" : "danger"}>{m.within ? "dalam toleransi" : `di luar ${band}`}</Badge>
    </span>
  );
}

function MetricsTable(props: { item: ReportItem; noEvidence: boolean; tolerancePct: number }): React.ReactElement {
  const { item } = props;
  const since = date(item.row, "Created", "CreatedDate");
  return (
    <div className="pbs-table-wrap">
      <table className="pbs-table">
        <thead>
          <tr>
            <th>Metrik</th>
            <th className="r">Klaim host</th>
            <th className="r">Bukti AI</th>
            {props.noEvidence ? null : <th className="r">Selisih</th>}
          </tr>
        </thead>
        <tbody>
          {item.rec.metrics.map((m, i) => (
            <tr key={m.def.key}>
              <td>{m.def.label}</td>
              <td className="r pbs-num" style={{ fontWeight: 600 }}>
                {fmtMetric(m.def, m.claim)}
              </td>
              <td className="r pbs-num" style={{ color: props.noEvidence ? "#7A5B00" : "#60686E" }}>
                {props.noEvidence ? (i === 0 ? `Menunggu bukti sejak ${fmtDateTimeShort(since)}` : "Menunggu bukti") : fmtMetric(m.def, m.evidence)}
              </td>
              {props.noEvidence ? null : (
                <td className="r">
                  <DeltaCell m={m} tolerancePct={props.tolerancePct} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UncomparedTable(props: { report: Row; evidence: Row | undefined }): React.ReactElement {
  return (
    <div className="pbs-table-wrap" style={{ marginTop: 10 }}>
      <table className="pbs-table">
        <thead>
          <tr>
            <th>Tidak dibandingkan oleh flow</th>
            <th className="r">Klaim host</th>
            <th className="r">Bukti AI</th>
          </tr>
        </thead>
        <tbody>
          {UNCOMPARED_METRICS.map((d) => (
            <tr key={d.key}>
              <td className="pbs-muted">{d.label}</td>
              <td className="r pbs-num">{fmtMetric(d, readMetric(props.report, d))}</td>
              <td className="r pbs-num pbs-muted">{props.evidence ? fmtMetric(d, readMetric(props.evidence, d)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevisionPanel(props: {
  item: ReportItem;
  flagged: Set<string>;
  setFlagged: (s: Set<string>) => void;
  note: string;
  setNote: (s: string) => void;
  onCancel: () => void;
  onSend: () => void;
}): React.ReactElement {
  const { item, flagged } = props;
  const toggle = (k: string) => {
    const n = new Set(flagged);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    props.setFlagged(n);
  };
  // Metrics outside tolerance first — those are the ones the reviewer usually flags.
  const ordered = [...item.rec.metrics].sort((a, b) => Number(a.within) - Number(b.within));
  const ready = flagged.size > 0 && props.note.trim() !== "";
  return (
    <div className="pbs-card" style={{ padding: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>Minta revisi · {item.title}</div>
      <p style={{ fontSize: 12.5, color: "#60686E", margin: "4px 0 14px" }}>
        Centang metrik yang perlu dibetulkan host. Hanya metrik yang dicentang yang bisa diubah host saat mengirim ulang.
      </p>
      <div>
        {ordered.map((m) => (
          <label key={m.def.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderTop: "1px solid #F5F5F5", cursor: "pointer" }}>
            <input type="checkbox" className="pbs-check" checked={flagged.has(m.def.key)} onChange={() => toggle(m.def.key)} />
            <span style={{ flex: 1, fontWeight: flagged.has(m.def.key) ? 600 : 400 }}>{m.def.label}</span>
            {m.within ? (
              <span style={{ fontSize: 12, color: "#60686E" }} className="pbs-num">
                {m.ratio === null ? "cocok" : `${fmtSignedPct(m.ratio)} · dalam toleransi`}
              </span>
            ) : (
              <Badge tone="danger">{m.ratio === null ? (m.note === "evidence-empty" ? "bukti kosong" : "tidak cocok") : fmtSignedPct(m.ratio)}</Badge>
            )}
          </label>
        ))}
      </div>
      <label className="pbs-label" htmlFor="pbs-rev-note" style={{ marginTop: 14 }}>
        Catatan untuk host
      </label>
      <textarea id="pbs-rev-note" className="pbs-textarea" value={props.note} onChange={(e) => props.setNote(e.target.value)} placeholder="Contoh: Penjualan dan CTOR beda jauh dari screenshot. Tolong cek lagi angka di Seller Center dan kirim ulang." />
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #E8E8E8", marginTop: 16, paddingTop: 14 }}>
        <Button variant="ghost" onClick={props.onCancel}>
          Batal
        </Button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#60686E" }}>
          {flagged.size} metrik ditandai{props.note.trim() === "" ? " · catatan wajib diisi" : ""}
        </span>
        <Button disabled={!ready} onClick={props.onSend}>
          Kirim permintaan
        </Button>
      </div>
    </div>
  );
}

function DecisionSummary(props: { report: Row; item: ReportItem; now: Date; decidedByMe: boolean; readOnly: boolean }): React.ReactElement {
  const { report, item, now } = props;
  const st = REVIEW_STATES[item.state];
  const approver = person(report, "Approver");
  const who = approver.name || str(report, "ApproverEmail") || "—";
  const commentText = str(report, "ApprovalComment");
  if (props.decidedByMe) {
    return (
      <div className="pbs-card" style={{ padding: 18, display: "flex", gap: 12, alignItems: "center" }}>
        <Icon name="check" color="#0A7A24" />
        <div>
          <div style={{ fontWeight: 600 }}>Keputusanmu sudah tercatat.</div>
          <div style={{ fontSize: 12, color: "#60686E" }}>Report akan hilang dari antrean setelah data dimuat ulang.</div>
        </div>
      </div>
    );
  }
  if (item.state === "WAITING") {
    return (
      <div className="pbs-card" style={{ padding: 18, fontSize: 13, color: "#60686E" }}>
        {props.readOnly ? "Mode baca saja — keputusan hanya bisa dibuat oleh reviewer." : "Kamu tidak punya izin untuk memutuskan report ini (REPORT_ADJUDICATE)."}
      </div>
    );
  }
  return (
    <div className="pbs-card" style={{ padding: 18 }}>
      <SectionHeader label="Keputusan" right={<Badge tone={st.tone}>{st.label}</Badge>} />
      <dl className="pbs-kv">
        <dt>Oleh</dt>
        <dd>{item.state === "DONE_AUTO" ? "Flow rekonsiliasi (PBS0005A)" : who}</dd>
        <dt>Waktu</dt>
        <dd>
          {fmtDateTimeShort(date(report, "Modified"))} <span className="pbs-muted">({fmtAgo(date(report, "Modified"), now)})</span>
        </dd>
        <dt>Match</dt>
        <dd>{str(report, "Match") || "—"}</dd>
        <dt>Komentar</dt>
        <dd style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{commentText || "—"}</dd>
      </dl>
    </div>
  );
}

function evidenceUrl(report: Row, evidence: Row | undefined): string {
  return firstUrl(str(evidence, "Attachment", "AttachmentUrl", "Screenshot")) || firstUrl(str(report, "Attachment", "AttachmentUrl"));
}

function EvidenceRail(props: {
  item: ReportItem;
  report: Row;
  evidence: Row | undefined;
  imgFailed: boolean;
  onImgError: () => void;
  onZoom: () => void;
  onOpen: (url: string) => void;
  confidenceThreshold: number;
  tolerancePct: number;
}): React.ReactElement {
  const { item, report, evidence } = props;
  const url = evidenceUrl(report, evidence);
  const platform = item.platform || "platform";
  const isTiktok = /tiktok/i.test(item.platform);
  const conf = item.rec.confidence;
  const showImg = !!url && !props.imgFailed;

  let note: React.ReactNode = null;
  const r = item.rec.reason;
  if (!evidence) note = "Belum ada baris Report Automation untuk report ini. Flow OCR membaca screenshot yang diunggah ke folder Report Automation dengan nama ReportID_Platform_AccountID.";
  else if (r === "ORPHAN_EVIDENCE") note = `Bukti ini tercatat untuk ${item.rec.mismatchedKeys.join(", ")} yang berbeda dari report. Kemungkinan nama file screenshot salah — jangan setujui sebelum dicek.`;
  else if (r === "ZERO_ZERO") note = "Semua metrik 0 di klaim dan di bukti. Flow menganggapnya cocok, tapi ini biasanya screenshot kosong atau report kosong.";
  else if (r === "METRIC_EMPTY") note = "AI tidak berhasil membaca sebagian metrik. Cek screenshot secara manual.";
  else if (r === "LOW_CONFIDENCE") note = `Confidence ${fmtNumber(conf ?? 0, 2)} di bawah ambang ${fmtNumber(props.confidenceThreshold, 2)} — cocokkan angka dengan screenshot sebelum menyetujui.`;
  else if (r === "OUT_OF_TOLERANCE") {
    const n = item.rec.outOfTolerance.length;
    note = `${conf !== null ? `Confidence ${fmtNumber(conf, 2)} di atas ambang ${fmtNumber(props.confidenceThreshold, 2)}, jadi bukti ini dianggap terbaca benar. ` : ""}Yang menahan persetujuan adalah ${n} metrik di luar ±${fmtNumber(props.tolerancePct)}%.`;
  } else if (r === "ALL_MATCH") note = "Ketujuh metrik dalam toleransi. Report ini menunggu karena flow belum memutuskannya.";

  return (
    <aside className="pbs-card pbs-card-pad" aria-label="Bukti" style={{ flex: "1 0 320px", maxWidth: 380 }}>
      <SectionHeader label="Bukti" />
      <div style={{ position: "relative", borderRadius: 8, background: "#F5F5F5", border: "1px solid #E8E8E8", height: 210, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {showImg ? (
          <img src={url} alt={`Screenshot ${platform}`} onError={props.onImgError} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} />
        ) : (
          <div style={{ textAlign: "center", color: "#60686E", fontSize: 12 }}>
            <Icon name="image" size={24} />
            <div style={{ marginTop: 6 }}>{url ? `screenshot ${platform} — pratinjau tidak tersedia` : evidence ? "Screenshot tidak tercatat di baris bukti" : "Belum ada screenshot"}</div>
          </div>
        )}
        {url ? (
          <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", gap: 8 }}>
            {showImg ? (
              <Button variant="secondary" size="sm" onClick={props.onZoom}>
                <Icon name="zoom" size={14} /> Perbesar
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => props.onOpen(url)}>
              <Icon name="external" size={14} /> Buka
            </Button>
          </div>
        ) : null}
      </div>
      {url ? (
        <div className="pbs-mono" style={{ fontSize: 11.5, margin: "10px 0 0", wordBreak: "break-all", color: "#60686E" }}>
          {fileName(url)}
        </div>
      ) : null}
      <dl className="pbs-kv" style={{ gridTemplateColumns: "130px 1fr", borderTop: "1px solid #F5F5F5", marginTop: 14, paddingTop: 14 }}>
        <dt>Confidence model</dt>
        <dd className="pbs-num" style={{ fontWeight: conf !== null ? 700 : 400 }}>
          {conf !== null ? fmtNumber(conf, 2) : <span className="pbs-muted">tidak tercatat</span>}
        </dd>
        <dt>Dibaca</dt>
        <dd>{evidence ? fmtDateTimeShort(date(evidence, "Created")) : "—"}</dd>
        <dt>Prompt</dt>
        <dd>{evidence ? (isTiktok ? "TikTok" : "Shopee (dipakai untuk semua non-TikTok)") : "—"}</dd>
        <dt>Diunggah host</dt>
        <dd>{fmtDateTimeShort(date(report, "Created", "CreatedDate"))}</dd>
        {evidence && str(evidence, "Status") ? (
          <>
            <dt>Verdict flow</dt>
            <dd>{str(evidence, "Status")}</dd>
          </>
        ) : null}
      </dl>
      {item.rec.evidenceCount > 1 ? (
        <div className="pbs-banner warn" style={{ margin: "14px 0 0", fontSize: 12 }}>
          <div className="grow">Ada {item.rec.evidenceCount} baris bukti untuk report ini. Yang terbaru dipakai.</div>
        </div>
      ) : null}
      {note ? (
        <div className={`pbs-banner ${r === "ORPHAN_EVIDENCE" || r === "ZERO_ZERO" ? "err" : "info"}`} style={{ margin: "14px 0 0", fontSize: 12.5, alignItems: "flex-start" }}>
          <div className="grow">{note}</div>
        </div>
      ) : null}
    </aside>
  );
}

function Lightbox(props: { url: string; onClose: () => void }): React.ReactElement {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [props.onClose]);
  return (
    <div role="dialog" aria-label="Screenshot bukti" onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "#1A1D21", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <img src={props.url} alt="Screenshot bukti" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
      <button type="button" onClick={props.onClose} aria-label="Tutup" style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 18, border: 0, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer" }}>
        <Icon name="x" />
      </button>
    </div>
  );
}

function LoadingDetail(): React.ReactElement {
  return (
    <div className="pbs-page" aria-busy="true">
      <div className="pbs-card" style={{ padding: 20, display: "flex", gap: 24, marginBottom: 16 }}>
        {[120, 90, 80, 110, 140].map((w, i) => (
          <div key={i}>
            <Skeleton w={w / 2} h={10} />
            <Skeleton w={w} h={16} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        <div className="pbs-card pbs-card-pad">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} style={{ display: "flex", gap: 16, marginBottom: 18 }}>
              <Skeleton w="30%" />
              <Skeleton w="20%" />
              <Skeleton w="20%" />
              <Skeleton w="20%" />
            </div>
          ))}
        </div>
        <div className="pbs-card pbs-card-pad">
          <Skeleton h={200} r={8} />
          <Skeleton w="70%" style={{ marginTop: 14 }} />
          <Skeleton w="50%" style={{ marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}
