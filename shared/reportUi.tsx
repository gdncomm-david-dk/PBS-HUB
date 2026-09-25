import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "./contract";
import { Row, date, person, str } from "./data";
import { fmtAgo, fmtDate, fmtDateTimeShort, fmtNumber, fmtPercentValue, fmtRupiah, fmtSignedPct } from "./format";
import { MetricComparison, MetricDef, reviewBadge, sameValue } from "./reconcile";
import { ReportItem, itemRef } from "./reportItems";
import { Badge, Button, Icon, PlaybookValue, SectionHeader, Spinner } from "./ui";

export { PlaybookValue };

/**
 * Review building blocks shared by ReportDetail (full screen) and the review pop-up in
 * ReportReview: the metric table, the decision bar with revision picker, and the evidence rail.
 */

export const DECISION_ACTIONS = ["APPROVE", "APPROVE_WITHOUT_EVIDENCE", "REQUEST_REVISION", "ESCALATE"];

export const DECISION_DONE_TEXT: Record<string, string> = {
  APPROVE: "Keputusan tersimpan: report disetujui.",
  APPROVE_WITHOUT_EVIDENCE: "Keputusan tersimpan: report disetujui tanpa bukti.",
  REQUEST_REVISION: "Permintaan revisi terkirim ke host.",
  ESCALATE: "Report dieskalasi.",
  REMIND_HOST: "Pengingat terkirim ke host.",
  BULK_APPROVE: "Report terpilih disetujui.",
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

export function fileName(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return last || u.hostname;
  } catch {
    return url;
  }
}

export function evidenceUrl(report: Row, evidence: Row | undefined): string {
  return firstUrl(str(evidence, "Attachment", "AttachmentUrl", "Screenshot")) || firstUrl(str(report, "Attachment", "AttachmentUrl"));
}

/** Title card: report id, live date, brand, host, account, and a status pill on the right. */
/** Report.ApprovalStatus as stored, toned by its review state. */
export function ApprovalStatusBadge(props: { item: ReportItem }): React.ReactElement {
  const { item } = props;
  const st = reviewBadge(item.row, item.state);
  return (
    <Badge tone={st.tone} title={st.label}>
      {item.approvalStatus || "Belum ada status"}
    </Badge>
  );
}

export function ReportHeader(props: { item: ReportItem; pill: React.ReactNode; onOpenLink?: (url: string) => void }): React.ReactElement {
  const { item } = props;
  const meta = (l: string, v: React.ReactNode) => (
    <div className="pbs-rec-m">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
    </div>
  );
  return (
    <div className="pbs-card pbs-rec">
      <div className="pbs-rec-code">
        <span className="l">Rep ID</span>
        {item.title || `Report #${item.id}`}
      </div>
      <div className="pbs-rec-g">
        {meta("Schedule ID", <span className="pbs-num">{item.scheduleId || "—"}</span>)}
        {meta("Tanggal live", fmtDate(item.liveDate))}
        {meta("Jam live", <span className="pbs-num">{item.liveTime || "—"}</span>)}
        {meta("Brand", item.brand)}
        {meta("Host", item.host)}
        {meta("Akun", [item.account, item.platform].filter(Boolean).join(" · ") || "—")}
        {meta("Status", <ApprovalStatusBadge item={item} />)}
        {meta("Playbook", <PlaybookValue compact value={item.playbook} onOpen={props.onOpenLink} />)}
      </div>
      {props.pill}
    </div>
  );
}

/** Metrics the host can be asked to fix: every one whose claim differs from the evidence. */
export const revisable = (m: MetricComparison): boolean => !sameValue(m);

function DeltaCell(props: { m: MetricComparison; tolerancePct: number }): React.ReactElement {
  const { m } = props;
  const band = `±${fmtNumber(props.tolerancePct)}%`;
  if (m.note === "evidence-empty") return <Badge tone="warning">bukti kosong</Badge>;
  if (m.note === "claim-empty") return <Badge tone="warning">klaim kosong</Badge>;
  if (m.note === "zero-zero")
    return (
      <span className="pbs-num" style={{ fontWeight: 600, color: "#0A7A24" }}>
        ±0,0%
      </span>
    );
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
      {m.within ? null : <Badge tone="danger">di luar {band}</Badge>}
    </span>
  );
}

export function MetricsTable(props: { item: ReportItem; tolerancePct: number }): React.ReactElement {
  const { item } = props;
  const noEvidence = !item.rec.evidence;
  const since = date(item.row, "Created", "CreatedDate");
  return (
    <div className="pbs-table-wrap">
      <table className="pbs-table">
        <thead>
          <tr>
            <th>Metrik</th>
            <th className="r">Klaim host</th>
            <th className="r">Bukti AI</th>
            {noEvidence ? null : <th className="r">Selisih</th>}
          </tr>
        </thead>
        <tbody>
          {item.rec.metrics.map((m, i) => (
            <tr key={m.def.key} className={!noEvidence && !m.within ? "bad" : undefined}>
              <td>{m.def.label}</td>
              <td className="r pbs-num" style={{ fontWeight: 600 }}>
                {fmtMetric(m.def, m.claim)}
              </td>
              <td className="r pbs-num" style={{ color: noEvidence ? "#7A5B00" : "#60686E" }}>
                {noEvidence ? (i === 0 ? `Menunggu bukti sejak ${fmtDateTimeShort(since)}` : "Menunggu bukti") : fmtMetric(m.def, m.evidence)}
              </td>
              {noEvidence ? null : (
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
  // Metrics that differ first; identical ones (0 %) cannot be picked.
  const ordered = [...item.rec.metrics].sort((a, b) => Number(revisable(b)) - Number(revisable(a)) || Number(a.within) - Number(b.within));
  const ready = flagged.size > 0 && props.note.trim() !== "";
  return (
    <div className="pbs-card" style={{ padding: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>Minta revisi · {item.title}</div>
      <p style={{ fontSize: 12.5, color: "#60686E", margin: "4px 0 14px" }}>
        Metrik yang berbeda dari bukti sudah dicentang. Metrik yang sama persis (0%) tidak ikut direvisi.
      </p>
      <div>
        {ordered.map((m) => {
          const can = revisable(m);
          return (
            <label key={m.def.key} className={`pbs-rev-row${can ? "" : " off"}`}>
              <input type="checkbox" className="pbs-check" checked={can && flagged.has(m.def.key)} disabled={!can} onChange={() => toggle(m.def.key)} aria-label={m.def.label} />
              <span style={{ flex: 1, fontWeight: can && flagged.has(m.def.key) ? 600 : 400 }}>{m.def.label}</span>
              <span className="pbs-num" style={{ fontSize: 12, color: "#60686E" }}>
                {fmtMetric(m.def, m.claim)} → {fmtMetric(m.def, m.evidence)}
              </span>
              {!can ? (
                <span style={{ fontSize: 12 }}>sama</span>
              ) : m.within ? (
                <Badge tone="warning">{m.ratio === null ? "beda" : fmtSignedPct(m.ratio)}</Badge>
              ) : (
                <Badge tone="danger">{m.ratio === null ? (m.note === "evidence-empty" ? "bukti kosong" : m.note === "claim-empty" ? "klaim kosong" : "tidak cocok") : fmtSignedPct(m.ratio)}</Badge>
              )}
            </label>
          );
        })}
      </div>
      <label className="pbs-label" htmlFor="pbs-rev-note" style={{ marginTop: 14 }}>
        Catatan untuk host
      </label>
      <textarea id="pbs-rev-note" className="pbs-textarea" value={props.note} onChange={(e) => props.setNote(e.target.value)} placeholder="Contoh: Penjualan beda dari screenshot. Tolong cek lagi angka di Seller Center dan kirim ulang." />
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid #E8E8E8", marginTop: 16, paddingTop: 14, flexWrap: "wrap" }}>
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

/**
 * Comment + Setujui / Perlu revisi / Eskalasi, the revision picker, the "sending" lock and, once
 * decided, the decision summary. Dispatches the same payloads from both screens.
 */
export function DecisionPanel(props: { item: ReportItem; ctx: ModuleContext; action: UseActionResult; readOnly: boolean; tolerancePct: number; now: Date }): React.ReactElement {
  const { item, ctx, action, tolerancePct } = props;
  const report = item.row;
  const noEvidence = !item.rec.evidence;
  const [comment, setComment] = React.useState("");
  const [revising, setRevising] = React.useState(false);
  const [flagged, setFlagged] = React.useState<Set<string>>(() => new Set(item.rec.metrics.filter(revisable).map((m) => m.def.key)));

  const pending = action.pending;
  const submitting = !!pending && DECISION_ACTIONS.includes(pending.action);
  const last = action.lastResult;
  const decidedByMe = !!last && last.status === "ok" && DECISION_ACTIONS.includes(last.action);
  const conflict = last?.status === "conflict";
  const canDecide = !props.readOnly && hasPermission(ctx, "REPORT_ADJUDICATE") && item.state === "WAITING" && !decidedByMe && !conflict;

  const decide = (decision: "APPROVE" | "APPROVE_WITHOUT_EVIDENCE" | "REQUEST_REVISION" | "ESCALATE") => {
    const base = { ...itemRef(item), decision, approverEmail: ctx.userEmail, approverName: ctx.userName, reason: item.rec.reason };
    const note = comment.trim();
    if (decision === "APPROVE") {
      action.dispatch("APPROVE", { ...base, approvalStatus: "Done", match: "Match", comment: note, flaggedMetrics: [] });
    } else if (decision === "APPROVE_WITHOUT_EVIDENCE") {
      action.dispatch("APPROVE_WITHOUT_EVIDENCE", { ...base, approvalStatus: "Done", match: "", comment: `[Tanpa bukti] ${note}`, flaggedMetrics: [] });
    } else if (decision === "REQUEST_REVISION") {
      const keys = item.rec.metrics.filter((m) => revisable(m) && flagged.has(m.def.key)).map((m) => m.def);
      action.dispatch("REQUEST_REVISION", {
        ...base,
        approvalStatus: "Need Revision",
        match: "Unmatch",
        flaggedMetrics: keys.map((m) => m.key),
        comment: `${note}\nMetrik yang perlu dibetulkan: ${keys.map((m) => m.label).join(", ")}`,
      });
    } else {
      action.dispatch("ESCALATE", { ...base, approvalStatus: str(report, "ApprovalStatus") || "Waiting Approval", match: str(report, "Match"), comment: `[Eskalasi] ${note}`, flaggedMetrics: [] });
    }
  };

  if (submitting) {
    return (
      <div className="pbs-card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
        <Spinner />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Mengirim keputusan…</div>
          <div style={{ fontSize: 12, color: "#60686E" }}>Tombol dimatikan sampai hasil tulis kembali, supaya tidak ada keputusan ganda.</div>
        </div>
        <Button disabled>Mengirim…</Button>
      </div>
    );
  }
  if (canDecide && revising) {
    return (
      <RevisionPanel
        item={item}
        flagged={flagged}
        setFlagged={setFlagged}
        note={comment}
        setNote={setComment}
        onCancel={() => setRevising(false)}
        onSend={() => decide("REQUEST_REVISION")}
      />
    );
  }
  if (!canDecide) return <DecisionSummary report={report} item={item} now={props.now} decidedByMe={decidedByMe} readOnly={props.readOnly} />;

  const differing = item.rec.metrics.filter(revisable).length;
  return (
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
          </>
        ) : (
          <>
            <Button onClick={() => decide("APPROVE")}>Setujui</Button>
            <Button variant="secondary" onClick={() => setRevising(true)} disabled={differing === 0} title={differing === 0 ? "Semua metrik sama dengan bukti" : undefined}>
              Perlu revisi
            </Button>
            <Button variant="ghost" onClick={() => decide("ESCALATE")}>
              Eskalasi
            </Button>
          </>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#60686E" }}>
          {noEvidence ? "Persetujuan tanpa bukti tercatat khusus." : `Keputusan tercatat atas nama ${ctx.userName || ctx.userEmail || "kamu"}`}
        </span>
      </div>
      {!noEvidence && item.rec.outOfTolerance.length > 0 ? (
        <p style={{ fontSize: 12, color: "#7A5B00", margin: "12px 0 0" }}>
          {item.rec.outOfTolerance.length} metrik di luar ±{fmtNumber(tolerancePct)}%. Menyetujui berarti kamu menerima klaim host apa adanya.
        </p>
      ) : null}
    </div>
  );
}

function DecisionSummary(props: { report: Row; item: ReportItem; now: Date; decidedByMe: boolean; readOnly: boolean }): React.ReactElement {
  const { report, item, now } = props;
  const st = reviewBadge(report, item.state);
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
  if (item.state === "OTHER" && !item.approvalStatus) {
    return (
      <div className="pbs-card" style={{ padding: 18, fontSize: 13, color: "#60686E" }}>
        ApprovalStatus report ini masih kosong, jadi belum masuk antrean review. Isi ApprovalStatus di list Report (mis. <b>Waiting Approval</b>) supaya bisa diputuskan.
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

export function EvidenceRail(props: { item: ReportItem; ctx: ModuleContext; onOpen: (url: string) => void; compact?: boolean }): React.ReactElement {
  const { item, ctx } = props;
  const report = item.row;
  const evidence = item.rec.evidence;
  const [imgFailed, setImgFailed] = React.useState(false);
  const [zoom, setZoom] = React.useState(false);
  const url = evidenceUrl(report, evidence);
  const platform = item.platform || "platform";
  const isTiktok = /tiktok/i.test(item.platform);
  const conf = item.rec.confidence;
  const showImg = !!url && !imgFailed;
  const tolerancePct = configNumber(ctx, "tolerancePct", 5);
  const threshold = configNumber(ctx, "confidenceThreshold", 0.85);

  let note: React.ReactNode = null;
  const r = item.rec.reason;
  if (!evidence) note = "Belum ada baris Report Automation untuk report ini. Flow OCR membaca screenshot yang diunggah ke folder Report Automation dengan nama ReportID_Platform_AccountID.";
  else if (r === "ORPHAN_EVIDENCE") note = `Bukti ini tercatat untuk ${item.rec.mismatchedKeys.join(", ")} yang berbeda dari report. Kemungkinan nama file screenshot salah — jangan setujui sebelum dicek.`;
  else if (r === "ZERO_ZERO") note = "Semua metrik 0 di klaim dan di bukti. Biasanya screenshot kosong atau report kosong.";
  else if (r === "METRIC_EMPTY") note = "AI tidak berhasil membaca sebagian metrik. Cek screenshot secara manual.";
  else if (r === "LOW_CONFIDENCE") note = `Confidence ${fmtNumber(conf ?? 0, 2)} di bawah ambang ${fmtNumber(threshold, 2)} — cocokkan angka dengan screenshot sebelum menyetujui.`;
  else if (r === "OUT_OF_TOLERANCE") note = `${item.rec.outOfTolerance.length} metrik di luar ±${fmtNumber(tolerancePct)}%.`;
  else if (r === "ALL_MATCH") note = "Semua metrik dalam toleransi. Report ini menunggu karena flow belum memutuskannya.";

  const facts: [string, React.ReactNode][] = [
    ["Confidence", conf !== null ? <b className="pbs-num">{fmtNumber(conf, 2)}</b> : <span className="pbs-muted">tidak tercatat</span>],
    ["Dibaca AI", evidence ? fmtDateTimeShort(date(evidence, "Created")) : "—"],
    ["Prompt", evidence ? (isTiktok ? "TikTok" : "Shopee") : "—"],
    ["Diunggah host", fmtDateTimeShort(date(report, "Created", "CreatedDate"))],
  ];
  if (evidence && str(evidence, "Status")) facts.push(["Verdict flow", str(evidence, "Status")]);

  return (
    <aside className="pbs-card pbs-card-pad" aria-label="Bukti">
      <SectionHeader label="Bukti" />
      <div style={{ position: "relative", borderRadius: 8, background: "#F5F5F5", border: "1px solid #E8E8E8", height: props.compact ? 180 : 220, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {showImg ? (
          <img src={url} alt={`Screenshot ${platform}`} onError={() => setImgFailed(true)} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} />
        ) : (
          <div style={{ textAlign: "center", color: "#60686E", fontSize: 12, padding: 12 }}>
            <Icon name="image" size={24} />
            <div style={{ marginTop: 6 }}>{url ? `Screenshot ${platform} — pratinjau tidak tersedia` : evidence ? "Screenshot tidak tercatat di baris bukti" : "Belum ada screenshot"}</div>
          </div>
        )}
        {url ? (
          <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", gap: 8 }}>
            {showImg ? (
              <Button variant="secondary" size="sm" onClick={() => setZoom(true)}>
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
        <div className="pbs-mono" style={{ fontSize: 11, margin: "8px 0 0", wordBreak: "break-all", color: "#60686E" }}>
          {fileName(url)}
        </div>
      ) : null}
      <div style={{ borderTop: "1px solid #F5F5F5", marginTop: 12, paddingTop: 6 }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 12.5 }}>
            <span className="pbs-muted">{k}</span>
            <span style={{ textAlign: "right", fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
      {item.rec.evidenceCount > 1 ? (
        <div className="pbs-banner warn" style={{ margin: "12px 0 0", fontSize: 12 }}>
          <div className="grow">Ada {item.rec.evidenceCount} baris bukti untuk report ini. Yang terbaru dipakai.</div>
        </div>
      ) : null}
      {note ? (
        <div className={`pbs-banner ${r === "ORPHAN_EVIDENCE" || r === "ZERO_ZERO" ? "err" : "info"}`} style={{ margin: "12px 0 0", fontSize: 12.5, alignItems: "flex-start" }}>
          <div className="grow">{note}</div>
        </div>
      ) : null}
      {zoom ? <Lightbox url={url} onClose={() => setZoom(false)} /> : null}
    </aside>
  );
}

function Lightbox(props: { url: string; onClose: () => void }): React.ReactElement {
  const { onClose } = props;
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-label="Screenshot bukti" onClick={onClose} style={{ position: "fixed", inset: 0, background: "#1A1D21", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <img src={props.url} alt="Screenshot bukti" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
      <button type="button" onClick={onClose} aria-label="Tutup" style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 18, border: 0, background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer" }}>
        <Icon name="x" />
      </button>
    </div>
  );
}

