import * as React from "react";
import { ModuleContext, UseActionResult, configNumber } from "./contract";
import { Row, date, nameIndex, person, rowId, str } from "./data";
import { fmtDateTimeShort, fmtLongDate, fmtSignedPct, fmtTime } from "./format";
import {
  hostReportBadge,
  HostSession,
  MetricValues,
  buildHostSessions,
  disputeOf,
  evidenceFileName,
  flaggedFromComment,
  hostOptions,
  metricColumns,
  metricsFrom,
  missingMetrics,
  parseMetricInput,
  reportBlocker,
  reviewerNote,
  sanityWarnings,
} from "./hostApp";
import { PreparedImage, fmtBytes, prepareImage } from "./hostImage";
import { ALL_METRICS, COMPARED_METRICS, MetricComparison, MetricDef, compareMetric, reviewState, sameValue } from "./reconcile";
import { evidenceUrl, fmtMetric } from "./reportUi";
import { liveWindow } from "./reportItems";
import { Badge, Button, Icon, InfoBanner, Overlay, PlaybookValue, ResultBanner, Skeleton, Spinner } from "./ui";

export interface MyReportDetailProps {
  ctx: ModuleContext;
  host: Row[];
  report: Row[];
  schedule: Row[];
  evidence: Row[];
  clockIns: Row[];
  absences: Row[];
  history: Row[];
  brands: Row[];
  studios: Row[];
  loading: boolean;
  now: Date;
  action: UseActionResult;
  setUpload: (data: string) => void;
}

/** Form sections as in the design: the reconciled core first, then the rest (compared too). */
const CORE: MetricDef[] = [...COMPARED_METRICS, ...ALL_METRICS.filter((d) => d.key === "Durasi")];
const EXTRA: MetricDef[] = ALL_METRICS.filter((d) => !CORE.includes(d));
const REQUIRED: MetricDef[] = COMPARED_METRICS;
const UNIT: Record<string, string> = { Penjualan: " (Rp)", CTR: " (%)", CTOR: " (%)", Durasi: " (menit)" };

type Texts = Record<string, string>;

const toText = (def: MetricDef, v: number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  return def.format === "pct" ? v.toLocaleString("id-ID", { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("id-ID");
};
const textsFrom = (v: MetricValues): Texts => Object.fromEntries(ALL_METRICS.map((d) => [d.key, toText(d, v[d.key])]));
const valuesFrom = (t: Texts): MetricValues => Object.fromEntries(ALL_METRICS.map((d) => [d.key, parseMetricInput(t[d.key] ?? "", d)]));

// ---- device draft (never the image; it is too big for storage) ------------------------------------

interface Draft {
  texts: Texts;
  savedAt: string;
}
const draftKey = (hostId: string, id: string) => `pbs-host-draft:${hostId || "me"}:${id}`;
function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && d.texts ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: Draft | null): void {
  try {
    if (d) window.localStorage.setItem(key, JSON.stringify(d));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage blocked: the draft only lives while the screen is open */
  }
}

// ---- view ---------------------------------------------------------------------------------------

export function MyReportDetailView(props: MyReportDetailProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const report = props.report[0];
  const schedule = props.schedule[0];
  const session = React.useMemo(
    () =>
      schedule
        ? buildHostSessions({ schedules: [schedule], clockIns: props.clockIns, absences: props.absences, reports: report ? [report] : [], brands: props.brands, studios: props.studios }, now, opts)[0]
        : undefined,
    [schedule, report, props.clockIns, props.absences, props.brands, props.studios, now, opts],
  );

  if (props.loading && !report && !schedule) return <Loading />;
  const back = (
    <div className="pbs-crumb" style={{ marginBottom: 10 }}>
      <button type="button" onClick={() => action.fire("BACK", {})} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="arrowLeft" size={14} /> Report saya
      </button>
    </div>
  );
  if (!report && !schedule) {
    return (
      <div className="hc-col">
        {back}
        <InfoBanner tone="warn">Sesi atau report ini tidak ditemukan. Mungkin jadwalnya sudah dihapus, atau ScheduleJson / ReportJson belum diisi.</InfoBanner>
      </div>
    );
  }
  const state = report ? reviewState(report) : null;
  return (
    <div className="hc-col">
      {back}
      {!report ? (
        <SubmitReport {...props} session={session} />
      ) : state === "REVISION" ? (
        <Revision {...props} report={report} session={session} />
      ) : (
        <ViewReport {...props} report={report} session={session} />
      )}
    </div>
  );
}

// ---- context card -------------------------------------------------------------------------------

function useBrand(props: { brands: Row[] }) {
  const names = React.useMemo(() => nameIndex(props.brands, ["NamaBrand", "BrandName"]), [props.brands]);
  return (id: string) => names.get(id) ?? id;
}

function SessionHeader(props: { title: string; platform: string; meta: string; right?: React.ReactNode }): React.ReactElement {
  return (
    <div className="hc-card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="hc-sess-t" style={{ fontSize: 16 }}>
          {props.title} {props.platform ? <span className="hc-plat">{props.platform}</span> : null}
        </div>
        <div className="hc-sess-m">{props.meta}</div>
      </div>
      {props.right}
    </div>
  );
}

function sessionMeta(s: HostSession | undefined, report: Row | undefined): string {
  if (s) return [s.title, s.day ? fmtLongDate(s.day) : "", s.startText && `${s.startText}–${s.endText}`, s.studio !== "—" ? s.studio : "", s.account && `Akun ${s.account}`].filter(Boolean).join(" · ");
  const d = date(report, "LiveDate");
  return [str(report, "ScheduleID"), d ? fmtLongDate(d) : "", str(report, "Account", "AccountID") && `Akun ${str(report, "Account", "AccountID")}`].filter(Boolean).join(" · ");
}

/** Rep ID, Schedule ID, live window, the stored ApprovalStatus and the Playbook: the same facts the Ops list shows. */
export function ReportFacts(props: { report: Row; session: HostSession | undefined; onLink?: (url: string) => void }): React.ReactElement {
  const { report, session } = props;
  const st = hostReportBadge(report, reviewState(report));
  const time = session && (session.startText || session.endText) ? `${session.startText || "?"}–${session.endText || "?"}` : liveWindow(undefined, report);
  return (
    <div className="hc-card" style={{ marginBottom: 16 }}>
      <dl className="hc-dl">
        <div>
          <dt>Rep ID</dt>
          <dd className="pbs-num">{str(report, "Title") || "—"}</dd>
        </div>
        <div>
          <dt>Schedule ID</dt>
          <dd className="pbs-num">{str(report, "ScheduleID") || session?.title || "—"}</dd>
        </div>
        <div>
          <dt>Jam live</dt>
          <dd className="pbs-num">{time || "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Badge tone={st.tone} title={st.label}>
              {str(report, "ApprovalStatus") || "Belum ada status"}
            </Badge>
          </dd>
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <dt>Playbook</dt>
          <dd>
            <PlaybookValue value={str(report, "Playbook").trim()} onOpen={props.onLink} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---- submit (H-5) -------------------------------------------------------------------------------

/** `embedded`: inside ScheduleDetail, which already shows the session, its next step (clock in / absen) and a back link. */
export function SubmitReport(props: MyReportDetailProps & { session: HostSession | undefined; embedded?: boolean }): React.ReactElement {
  const { ctx, action, session } = props;
  const opts = hostOptions(ctx.config);
  const brand = useBrand(props);
  const host = props.host[0];
  const hostId = str(host, "Title") || str(session?.row, "HostID");
  const key = draftKey(hostId, session?.title || "new");
  const [draft] = React.useState(() => readDraft(key));
  const [texts, setTexts] = React.useState<Texts>(() => draft?.texts ?? textsFrom({}));
  const [savedAt, setSavedAt] = React.useState<string | null>(draft?.savedAt ?? null);
  const [image, setImage] = React.useState<PreparedImage | null>(null);
  const values = valuesFrom(texts);
  const history = React.useMemo(() => props.history.map((r) => metricsFrom(r)), [props.history]);
  const warnings = sanityWarnings(values, history);
  const missing = missingMetrics(values, REQUIRED);
  const blocker = session ? reportBlocker(session, opts) : null;
  const pending = action.pending?.action === "SUBMIT_REPORT";
  const absenPending = action.pending?.action === "ABSEN";
  const res = action.lastResult;
  const sent = res?.action === "SUBMIT_REPORT" && res.status === "ok";

  // Autosave to this device, so leaving the screen does not lose the numbers.
  React.useEffect(() => {
    if (sent) return;
    const any = Object.values(texts).some((t) => t.trim() !== "");
    if (!any) return;
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      writeDraft(key, { texts, savedAt: at });
      setSavedAt(at);
    }, 800);
    return () => clearTimeout(t);
  }, [texts, key, sent]);
  React.useEffect(() => {
    if (sent) writeDraft(key, null);
  }, [sent, key]);

  const reasons: string[] = [];
  if (blocker) reasons.push(blocker === "CLOCKIN" ? "Belum ada clock in di hari sesi ini" : blocker === "ABSEN" ? "Absen sesi ini belum tercatat" : "Sesi belum dimulai");
  if (missing.length) reasons.push(`Isi ${missing.map((m) => m.label).join(", ")}`);
  if (!image) reasons.push("Tambahkan screenshot dashboard");
  const canSubmit = reasons.length === 0 && !pending && !sent;

  const submit = () => {
    if (!canSubmit || !session || !image) return;
    props.setUpload(image.base64);
    action.dispatch("SUBMIT_REPORT", {
      scheduleId: session.title,
      scheduleItemId: session.id,
      hostId,
      hostName: str(host, "NamaHost", "HostName") || ctx.userName,
      brandId: session.brandId,
      studioId: session.studioId,
      platform: session.platform,
      account: session.accountId,
      liveDate: session.dayKey,
      absId: str(session.absence, "Title"),
      metrics: metricColumns(values),
      file: { name: evidenceFileName("", session.platform, session.accountId, "jpg"), ext: "jpg", contentType: "image/jpeg", bytes: image.bytes, width: image.width, height: image.height },
      warnings: warnings.map((w) => w.text),
    });
  };

  const absenRight = !session ? null : session.absence ? (
    <Badge tone="success">Absen tercatat{date(session.absence, "Created") ? ` ${fmtTime(date(session.absence, "Created"))}` : ""}</Badge>
  ) : opts.requireAbsen ? (
    <Badge tone="warning">Absen belum ada</Badge>
  ) : null;

  if (sent) {
    return (
      <div className="hc-card" style={{ textAlign: "center", padding: "32px 20px" }}>
        <span className="hc-ic ok" style={{ width: 48, height: 48, borderRadius: 24 }}>
          <Icon name="check" size={24} />
        </span>
        <h2 style={{ margin: "14px 0 6px", fontSize: 18 }}>Report terkirim</h2>
        <p className="pbs-muted" style={{ margin: "0 0 18px" }}>
          {res?.message || "Screenshot sedang dibaca AI dan dicocokkan dengan angka kamu. Hasilnya muncul di Report saya."}
        </p>
        {props.embedded ? null : <Button onClick={() => action.fire("BACK", {})}>Kembali ke Report saya</Button>}
      </div>
    );
  }

  return (
    <>
      {props.embedded ? null : (
        <>
          <h1 className="pbs-h1" style={{ fontSize: 24, marginBottom: 14 }}>
            Submit report
          </h1>
          <SessionHeader title={session?.brand ?? brand(str(session?.row, "BrandID"))} platform={session?.platform ?? ""} meta={sessionMeta(session, undefined)} right={absenRight} />
        </>
      )}

      {draft && Object.values(draft.texts).some(Boolean) ? (
        <InfoBanner
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                writeDraft(key, null);
                setTexts(textsFrom({}));
                setSavedAt(null);
              }}
            >
              Buang draft
            </Button>
          }
        >
          Draft dari {fmtDateTimeShort(new Date(draft.savedAt))} dipulihkan. Screenshot tidak ikut tersimpan — pilih lagi sebelum submit.
        </InfoBanner>
      ) : null}

      {props.embedded ? null : blocker === "CLOCKIN" ? (
        <div className="hc-flag" style={{ marginBottom: 16 }}>
          <div className="hc-flag-h">
            <span>
              <Icon name="clock" size={16} /> Sesi ini tidak punya catatan clock in
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13 }}>
            Report hanya bisa dikirim kalau kamu clock in di hari sesi. Kalau kamu memang live tapi lupa clock in, minta tim PBS menambahkan clock in manual. Angka yang kamu isi tetap tersimpan sebagai draft.
          </p>
        </div>
      ) : blocker === "ABSEN" && session ? (
        <div className="hc-flag" style={{ marginBottom: 16 }}>
          <div className="hc-flag-h">
            <span>Absen sesi ini dulu</span>
          </div>
          <p style={{ margin: "6px 0 10px", fontSize: 13 }}>Report terbuka setelah absen sesi {session.title} tercatat. Kamu sudah clock in, jadi bisa absen sekarang.</p>
          <Button size="sm" disabled={!!action.pending} onClick={() => action.dispatch("ABSEN", absenPayloadFor(session, host))}>
            {absenPending ? <Spinner small /> : null} Absen sekarang
          </Button>
        </div>
      ) : blocker === "NOT_STARTED" ? (
        <InfoBanner>Sesi ini belum dimulai. Report bisa dikirim setelah sesi berjalan; angka yang kamu isi disimpan sebagai draft.</InfoBanner>
      ) : null}

      {res && res.status !== "ok" && (res.action === "SUBMIT_REPORT" || res.action === "ABSEN") ? (
        <InfoBanner tone="err">{res.message || (res.status === "conflict" ? "Report untuk sesi ini sudah ada. Muat ulang Report saya." : "Gagal mengirim. Coba lagi.")}</InfoBanner>
      ) : res?.action === "ABSEN" && res.status === "ok" && !props.embedded ? (
        <ResultBanner result={res} okText="Absen tercatat. Report sudah bisa dikirim." onClose={action.clearResult} />
      ) : null}

      <MetricForm texts={texts} setTexts={setTexts} disabled={pending} warnings={warnings} flagged={new Set()} evidence={null} requiredMissing={new Set(missing.map((m) => m.key))} />

      <Screenshot
        image={image}
        setImage={setImage}
        disabled={pending}
        fileName={evidenceFileName("", session?.platform ?? "", session?.accountId ?? "", "jpg").replace("REP-{ID}", "REP-(baru)")}
        maxPx={configNumber(ctx, "imageMaxPx", 2000)}
        maxKb={configNumber(ctx, "imageMaxKb", 1200)}
        required
      />

      <div className="hc-foot">
        <p>
          {savedAt ? `Draft tersimpan di perangkat ini ${fmtTime(new Date(savedAt))}. ` : ""}Setelah submit, report masuk antrean review dan tidak bisa kamu ubah sendiri.
          {!canSubmit && !pending && reasons.length ? (
            <span style={{ display: "block", color: "var(--warn-ic)", marginTop: 4 }}>Belum bisa submit: {reasons.join(" · ")}.</span>
          ) : null}
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            const at = new Date().toISOString();
            writeDraft(key, { texts, savedAt: at });
            setSavedAt(at);
          }}
          disabled={pending}
        >
          Simpan draft
        </Button>
        <Button onClick={submit} disabled={!canSubmit} title={reasons.join(" · ") || undefined}>
          {pending ? (
            <>
              <Spinner small /> Mengirim…
            </>
          ) : (
            "Submit report"
          )}
        </Button>
      </div>
    </>
  );
}

export function absenPayloadFor(s: HostSession, host: Row | undefined): Record<string, unknown> {
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

// ---- metric form --------------------------------------------------------------------------------

function MetricForm(props: {
  texts: Texts;
  setTexts: (t: Texts) => void;
  disabled: boolean;
  warnings: { key: string; text: string }[];
  flagged: Set<string>;
  evidence: MetricValues | null;
  requiredMissing: Set<string>;
  original?: MetricValues;
}): React.ReactElement {
  const set = (k: string, v: string) => props.setTexts({ ...props.texts, [k]: v });
  const blur = (d: MetricDef) => {
    const v = parseMetricInput(props.texts[d.key] ?? "", d);
    set(d.key, toText(d, v));
  };
  const field = (d: MetricDef) => {
    const w = props.warnings.find((x) => x.key === d.key);
    const flag = props.flagged.has(d.key);
    const ev = props.evidence?.[d.key];
    const orig = props.original?.[d.key];
    const changed = props.original && parseMetricInput(props.texts[d.key] ?? "", d) !== (orig ?? null);
    return (
      <div key={d.key} className={`hc-field${flag ? " flag" : w ? " warn" : ""}`}>
        <label htmlFor={`hc-m-${d.key}`}>
          {d.label}
          {UNIT[d.key] ?? ""}
          {REQUIRED.includes(d) ? "" : <span className="pbs-muted" style={{ fontWeight: 400 }}> · opsional</span>}
        </label>
        <input
          id={`hc-m-${d.key}`}
          inputMode={d.format === "pct" ? "decimal" : "numeric"}
          value={props.texts[d.key] ?? ""}
          disabled={props.disabled}
          placeholder={d.format === "idr" ? "Rp" : d.format === "pct" ? "%" : "0"}
          onChange={(e) => set(d.key, e.target.value)}
          onBlur={() => blur(d)}
          aria-invalid={flag || undefined}
        />
        {flag && ev !== undefined && ev !== null ? <span className="h">Tercatat di bukti: {fmtMetric(d, ev)}{changed ? ` · sebelumnya ${fmtMetric(d, orig ?? null)}` : ""}</span> : null}
        {w ? <span className="h w">{w.text}</span> : null}
      </div>
    );
  };
  const general = props.warnings.filter((w) => !ALL_METRICS.some((d) => d.key === w.key));
  return (
    <>
      <div className="hc-card" style={{ marginBottom: 16 }}>
        <div className="pbs-sec">
          <span className="pbs-sec-l">Metrik yang direkonsiliasi</span>
          <span className="pbs-sec-r">dibandingkan dengan bukti AI</span>
        </div>
        <div className="hc-grid2">{CORE.map(field)}</div>
        {general.map((w) => (
          <div key={w.text} style={{ marginTop: 12 }}>
            <InfoBanner tone="warn">{w.text}</InfoBanner>
          </div>
        ))}
      </div>
      <div className="hc-card" style={{ marginBottom: 16 }}>
        <div className="pbs-sec">
          <span className="pbs-sec-l">Metrik tambahan</span>
          <span className="pbs-sec-r">ikut dibandingkan kalau diisi</span>
        </div>
        <div className="hc-grid2">{EXTRA.map(field)}</div>
      </div>
    </>
  );
}

// ---- screenshot ---------------------------------------------------------------------------------

function Screenshot(props: {
  image: PreparedImage | null;
  setImage: (i: PreparedImage | null) => void;
  disabled: boolean;
  fileName: string;
  maxPx: number;
  maxKb: number;
  required?: boolean;
  label?: string;
}): React.ReactElement {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      props.setImage(await prepareImage(f, props.maxPx, props.maxKb));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gambar gagal diproses.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const img = props.image;
  return (
    <div className="hc-card" style={{ marginBottom: 16 }}>
      <div className="pbs-sec">
        <span className="pbs-sec-l">{props.label ?? "Screenshot dashboard"}</span>
        <span className="pbs-sec-r">{props.required ? "wajib · PNG atau JPG" : "opsional · PNG atau JPG"}</span>
      </div>
      <input ref={input} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void pick(e.target.files?.[0])} aria-label="Pilih screenshot" />
      <div className={`hc-drop${img ? " has" : ""}`}>
        <div className="hc-thumb">{img ? <img src={img.dataUrl} alt="Pratinjau screenshot" /> : busy ? <Spinner /> : <Icon name="image" size={22} />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {img ? (
            <>
              <div className="pbs-mono" style={{ fontWeight: 600, wordBreak: "break-all" }}>
                <Icon name="check" size={13} color="#0A7A24" /> {props.fileName}
              </div>
              <div className="pbs-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {fmtBytes(img.bytes)} · {img.width}×{img.height}
                {img.originalBytes > img.bytes ? ` · diperkecil dari ${fmtBytes(img.originalBytes)}` : ""} · kamu cukup pilih gambarnya, nama filenya kami yang susun
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>{busy ? "Menyiapkan gambar…" : "Tambah screenshot Seller Center"}</div>
              <div className="pbs-muted" style={{ fontSize: 12, marginTop: 2 }}>
                Ambil setelah sesi benar-benar selesai supaya angkanya lengkap. Nama file dibuat otomatis.
              </div>
            </>
          )}
        </div>
        {img ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="sm" disabled={props.disabled || busy} onClick={() => input.current?.click()}>
              Ganti
            </Button>
            <Button variant="ghost" size="sm" disabled={props.disabled || busy} onClick={() => props.setImage(null)}>
              Hapus
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" disabled={props.disabled || busy} onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> Pilih file
          </Button>
        )}
      </div>
      {error ? (
        <div style={{ marginTop: 10 }}>
          <InfoBanner tone="err">{error}</InfoBanner>
        </div>
      ) : null}
    </div>
  );
}

// ---- revision (H-6) -----------------------------------------------------------------------------

export function Revision(props: Omit<MyReportDetailProps, "report"> & { report: Row; session: HostSession | undefined; embedded?: boolean }): React.ReactElement {
  const { ctx, action, report, session } = props;
  const brand = useBrand(props);
  const tolerancePct = configNumber(ctx, "tolerancePct", 5);
  const evidence = props.evidence[0];
  const comment = str(report, "ApprovalComment");
  const comparisons = React.useMemo(() => ALL_METRICS.map((d) => compareMetric(d, report, evidence, tolerancePct)), [report, evidence, tolerancePct]);
  // The reviewer's list wins; without it, what is out of tolerance; without evidence, nothing.
  const fromComment = flaggedFromComment(comment);
  const flaggedDefs = fromComment.length ? fromComment : comparisons.filter((m) => m.evidence !== null && !m.within && m.note !== "zero-zero").map((m) => m.def);
  const flagged = new Set(flaggedDefs.map((d) => d.key));
  const flaggedRows = comparisons.filter((m) => flagged.has(m.def.key));
  const others = comparisons.filter((m) => !flagged.has(m.def.key) && (m.claim !== null || m.evidence !== null));
  const note = reviewerNote(comment);
  const dispute = disputeOf(comment);
  const approver = person(report, "Approver");
  const reviewer = approver.name || str(report, "ApproverEmail") || "tim PBS";
  const reviewedAt = date(report, "TanggalRevisi") ?? date(report, "Modified");
  const url = evidenceUrl(report, evidence);

  const original = React.useMemo(() => metricsFrom(report), [report]);
  const [editing, setEditing] = React.useState(false);
  const [texts, setTexts] = React.useState<Texts>(() => textsFrom(original));
  const [image, setImage] = React.useState<PreparedImage | null>(null);
  const [hostNote, setHostNote] = React.useState("");
  const [disputing, setDisputing] = React.useState(false);
  const values = valuesFrom(texts);
  const changed = ALL_METRICS.filter((d) => (values[d.key] ?? null) !== (original[d.key] ?? null));
  const history = React.useMemo(() => props.history.map((r) => metricsFrom(r)), [props.history]);
  const warnings = sanityWarnings(values, history);
  const missing = missingMetrics(values, REQUIRED);
  const pending = action.pending?.action === "RESUBMIT_REPORT";
  const res = action.lastResult;
  const done = res?.action === "RESUBMIT_REPORT" && res.status === "ok";
  const evValues = React.useMemo(() => (evidence ? metricsFrom(evidence) : null), [evidence]);

  const canSend = !pending && !done && missing.length === 0 && (changed.length > 0 || !!image);
  const send = () => {
    if (!canSend) return;
    props.setUpload(image ? image.base64 : "");
    action.dispatch("RESUBMIT_REPORT", {
      reportId: rowId(report),
      title: str(report, "Title"),
      scheduleId: str(report, "ScheduleID"),
      expectedModified: str(report, "Modified"),
      // Report goes back to the reviewer as a second look; its Report Automation row (same Title) is
      // set to Unmatch so the reviewer compares again.
      approvalStatus: "Waiting Approval Revision",
      evidenceId: evidence ? rowId(evidence) : "",
      evidenceTitle: str(report, "Title"),
      evidenceStatus: "Unmatch",
      metrics: metricColumns(values),
      changed: changed.map((d) => d.fields[0] ?? d.key),
      flagged: flaggedDefs.map((d) => d.fields[0] ?? d.key),
      note: hostNote.trim(),
      file: image
        ? { name: evidenceFileName(str(report, "Title"), str(report, "Platform") || (session?.platform ?? ""), str(report, "AccountID", "Account") || (session?.accountId ?? ""), "jpg"), ext: "jpg", contentType: "image/jpeg", bytes: image.bytes, width: image.width, height: image.height }
        : null,
    });
  };

  if (done) {
    return (
      <div className="hc-card" style={{ textAlign: "center", padding: "32px 20px" }}>
        <span className="hc-ic ok" style={{ width: 48, height: 48, borderRadius: 24 }}>
          <Icon name="check" size={24} />
        </span>
        <h2 style={{ margin: "14px 0 6px", fontSize: 18 }}>Revisi terkirim</h2>
        <p className="pbs-muted" style={{ margin: "0 0 18px" }}>{res?.message || "Report kembali ke antrean review. Kamu dapat kabar setelah tim PBS memutuskan."}</p>
        {props.embedded ? null : <Button onClick={() => action.fire("BACK", {})}>Kembali ke Report saya</Button>}
      </div>
    );
  }

  return (
    <>
      {props.embedded ? null : (
        <>
          <div className="pbs-mh" style={{ marginBottom: 6 }}>
            <h1 className="pbs-h1" style={{ fontSize: 24 }}>
              {flaggedRows.length === 0 ? "Report ini perlu revisi" : flaggedRows.length === 1 ? "Ada satu angka yang perlu kamu cek" : `Ada ${flaggedRows.length} angka yang perlu kamu cek`}
            </h1>
            <Badge tone="danger">Perlu revisi</Badge>
          </div>
          <p className="pbs-sub" style={{ margin: "0 0 16px" }}>
            {[session?.brand ?? brand(str(report, "BrandID")), date(report, "LiveDate") ? fmtLongDate(date(report, "LiveDate") as Date) : "", str(report, "Platform"), str(report, "Title")].filter(Boolean).join(" · ")}
            {reviewedAt ? ` · ditinjau ${fmtDateTimeShort(reviewedAt)} oleh ${reviewer}` : ""}
          </p>
        </>
      )}
      <ReportFacts report={report} session={session} onLink={(u) => action.fire("OPEN_EVIDENCE", { url: u, reportId: rowId(report), title: str(report, "Title") })} />

      {res && res.status !== "ok" && (res.action === "RESUBMIT_REPORT" || res.action === "DISPUTE_REVIEW") ? (
        <InfoBanner tone="err">{res.message || (res.status === "conflict" ? "Report ini sudah diubah sejak kamu buka. Muat ulang lalu coba lagi." : "Gagal mengirim. Coba lagi.")}</InfoBanner>
      ) : res?.action === "DISPUTE_REVIEW" && res.status === "ok" ? (
        <ResultBanner result={res} okText="Sanggahan terkirim ke reviewer." onClose={action.clearResult} />
      ) : null}
      {dispute !== null ? (
        <InfoBanner icon="info">
          Sanggahanmu sudah terkirim{dispute ? `: “${dispute}”` : ""}. Report tetap berstatus perlu revisi sampai tim PBS memutuskan. Kamu masih bisa memperbaiki angkanya.
        </InfoBanner>
      ) : null}

      {!editing ? (
        <>
          <div className="hc-stack" style={{ marginBottom: 16 }}>
            {flaggedRows.map((m) => (
              <FlagCard key={m.def.key} m={m} tolerancePct={tolerancePct} />
            ))}
          </div>
          {others.length ? <OthersTable rows={others} title={flaggedRows.length ? "Angka lain" : "Semua angka"} /> : null}
          {note ? (
            <div className="hc-quote" style={{ marginBottom: 16 }}>
              <Icon name="info" size={16} color="#0072FF" />
              <span>
                “{note}” <span className="pbs-muted">— {reviewer}</span>
              </span>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button onClick={() => setEditing(true)}>Perbaiki report</Button>
            {url ? (
              <Button variant="secondary" onClick={() => action.fire("OPEN_EVIDENCE", { url, reportId: rowId(report), title: str(report, "Title") })}>
                Lihat screenshot yang dipakai
              </Button>
            ) : null}
            {dispute === null ? (
              <Button variant="ghost" onClick={() => setDisputing(true)} disabled={!!action.pending}>
                Saya rasa angka saya benar
              </Button>
            ) : null}
          </div>
          <p className="pbs-muted" style={{ fontSize: 12, marginTop: 10 }}>
            “Perbaiki report” membuka form dengan angka yang ditandai sudah disorot. “Saya rasa angka saya benar” mengirim sanggahan ke reviewer beserta alasannya.
          </p>
        </>
      ) : (
        <>
          <MetricForm texts={texts} setTexts={setTexts} disabled={pending} warnings={warnings} flagged={flagged} evidence={evValues} requiredMissing={new Set(missing.map((m) => m.key))} original={original} />
          <Screenshot
            image={image}
            setImage={setImage}
            disabled={pending}
            label="Screenshot baru"
            fileName={evidenceFileName(str(report, "Title"), str(report, "Platform") || (session?.platform ?? ""), str(report, "AccountID", "Account") || (session?.accountId ?? ""), "jpg")}
            maxPx={configNumber(ctx, "imageMaxPx", 2000)}
            maxKb={configNumber(ctx, "imageMaxKb", 1200)}
          />
          <div className="hc-card" style={{ marginBottom: 16 }}>
            <label className="pbs-label" htmlFor="hc-note">
              Catatan untuk reviewer (opsional)
            </label>
            <textarea id="hc-note" className="pbs-textarea" value={hostNote} onChange={(e) => setHostNote(e.target.value)} disabled={pending} placeholder="Mis. angka penjualan saya salin ulang dari Seller Center setelah sesi selesai." />
          </div>
          <div className="hc-foot">
            <p>
              {changed.length ? `${changed.length} angka diubah: ${changed.map((d) => d.label).join(", ")}.` : image ? "Angka tidak diubah; screenshot baru akan dibaca ulang AI." : "Ubah angka yang ditandai atau tambahkan screenshot baru."}
            </p>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Batal
            </Button>
            <Button onClick={send} disabled={!canSend}>
              {pending ? (
                <>
                  <Spinner small /> Mengirim…
                </>
              ) : (
                "Kirim revisi"
              )}
            </Button>
          </div>
        </>
      )}

      {disputing ? <DisputeModal report={report} action={action} onClose={() => setDisputing(false)} /> : null}
    </>
  );
}

function FlagCard(props: { m: MetricComparison; tolerancePct: number }): React.ReactElement {
  const { m } = props;
  const diff = m.claim !== null && m.evidence !== null ? m.claim - m.evidence : null;
  return (
    <div className="hc-flag">
      <div className="hc-flag-h">
        <span>{m.def.label}</span>
        <span className="pbs-t-bad">
          {m.ratio !== null ? fmtSignedPct(m.ratio) : m.evidence === null ? "tidak terbaca di bukti" : "berbeda"}
          {!m.within && m.evidence !== null ? ` · di luar toleransi ±${props.tolerancePct}%` : ""}
        </span>
      </div>
      <div className="hc-flag-v">
        <span>
          Kamu isi: <b>{fmtMetric(m.def, m.claim)}</b>
        </span>
        <span>
          Tercatat di bukti: <b>{fmtMetric(m.def, m.evidence)}</b>
        </span>
        {diff !== null ? (
          <span>
            Selisih: <b>{fmtMetric(m.def, Math.abs(diff))}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OthersTable(props: { rows: MetricComparison[]; title: string }): React.ReactElement {
  const withEvidence = props.rows.some((m) => m.evidence !== null);
  return (
    <div className="hc-list" style={{ marginBottom: 16 }}>
      <div className={`hc-row head ${withEvidence ? "cmp" : "cmp1"}`}>
        <span>{props.title}</span>
        <span className="r">Kamu isi</span>
        {withEvidence ? <span className="r">Bukti AI</span> : null}
        {withEvidence ? <span className="r">Selisih</span> : null}
      </div>
      {props.rows.map((m) => (
        <div key={m.def.key} className={`hc-row ${withEvidence ? "cmp" : "cmp1"}`}>
          <span>{m.def.label}</span>
          <span className="r pbs-num" style={{ fontWeight: 600 }}>
            {fmtMetric(m.def, m.claim)}
          </span>
          {withEvidence ? <span className="r pbs-num pbs-muted">{fmtMetric(m.def, m.evidence)}</span> : null}
          {withEvidence ? (
            <span className={`r pbs-num ${m.evidence === null ? "pbs-muted" : m.within ? "pbs-t-ok" : "pbs-t-bad"}`} style={{ fontWeight: 600 }}>
              {m.evidence === null ? "—" : sameValue(m) ? "±0,0% ✓" : `${fmtSignedPct(m.ratio)}${m.within ? " ✓" : ""}`}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DisputeModal(props: { report: Row; action: UseActionResult; onClose: () => void }): React.ReactElement {
  const { action, report } = props;
  const [reason, setReason] = React.useState("");
  const pending = action.pending?.action === "DISPUTE_REVIEW";
  React.useEffect(() => {
    if (action.lastResult?.action === "DISPUTE_REVIEW") props.onClose();
  }, [action.lastResult]);
  const ok = reason.trim().length >= 10;
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="hc-dp-title">
        <div className="pbs-modal-h">
          <h2 id="hc-dp-title">Kirim sanggahan</h2>
          <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="pbs-modal-b">
          <p style={{ margin: 0 }}>Jelaskan kenapa angkamu benar. Reviewer membaca ini bersama screenshot. Status report tetap perlu revisi sampai diputuskan.</p>
          <div>
            <label className="pbs-label" htmlFor="hc-dp-reason">
              Alasan
            </label>
            <textarea
              id="hc-dp-reason"
              className="pbs-textarea"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              placeholder="Mis. screenshot diambil sebelum sesi selesai; angka final di Seller Center Rp4.820.000."
            />
            <div className="pbs-hint">{reason.trim().length} / 300 · minimal 10 karakter</div>
          </div>
        </div>
        <div className="pbs-modal-f">
          <Button variant="ghost" onClick={props.onClose} disabled={pending}>
            Batal
          </Button>
          <Button
            onClick={() => action.dispatch("DISPUTE_REVIEW", { reportId: rowId(report), title: str(report, "Title"), expectedModified: str(report, "Modified"), reason: reason.trim() })}
            disabled={!ok || pending}
          >
            {pending ? (
              <>
                <Spinner small /> Mengirim…
              </>
            ) : (
              "Kirim sanggahan"
            )}
          </Button>
        </div>
    </Overlay>
  );
}

// ---- read-only view -----------------------------------------------------------------------------

function ViewReport(props: Omit<MyReportDetailProps, "report"> & { report: Row; session: HostSession | undefined }): React.ReactElement {
  const { ctx, action, report, session } = props;
  const brand = useBrand(props);
  const tolerancePct = configNumber(ctx, "tolerancePct", 5);
  const evidence = props.evidence[0];
  const state = reviewState(report);
  const st = hostReportBadge(props.report, state);
  const rows = ALL_METRICS.map((d) => compareMetric(d, report, evidence, tolerancePct)).filter((m) => m.claim !== null || m.evidence !== null);
  const note = reviewerNote(str(report, "ApprovalComment"));
  const approver = person(report, "Approver");
  const reviewer = approver.name || str(report, "ApproverEmail");
  const url = evidenceUrl(report, evidence);
  const created = date(report, "Created", "CreatedDate");
  const modified = date(report, "Modified");
  const res = action.lastResult;
  return (
    <>
      <div className="pbs-mh" style={{ marginBottom: 6 }}>
        <h1 className="pbs-h1" style={{ fontSize: 24 }}>
          Report {session?.brand ?? brand(str(report, "BrandID"))}
        </h1>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="pbs-sub" style={{ margin: "0 0 16px" }}>
        {sessionMeta(session, report)}
        {created ? ` · dikirim ${fmtDateTimeShort(created)}` : ""}
      </p>
      <ReportFacts report={report} session={session} onLink={(u) => action.fire("OPEN_EVIDENCE", { url: u, reportId: rowId(report), title: str(report, "Title") })} />
      {res && (res.action === "SUBMIT_REPORT" || res.action === "RESUBMIT_REPORT") && res.status === "ok" ? (
        <ResultBanner result={res} okText="Report terkirim dan masuk antrean review." onClose={action.clearResult} />
      ) : null}
      {state === "WAITING" ? (
        <InfoBanner>
          {evidence
            ? "Report kamu menunggu review tim PBS. Selama menunggu, angkanya tidak bisa diubah."
            : "Screenshot sedang dibaca AI. Kalau angkanya cocok, report disetujui otomatis; kalau tidak, tim PBS yang meninjau."}
        </InfoBanner>
      ) : state === "DONE_AUTO" ? (
        <InfoBanner icon="check">Semua angka cocok dengan bukti — disetujui otomatis{modified ? ` ${fmtDateTimeShort(modified)}` : ""}.</InfoBanner>
      ) : state === "DONE_MANUAL" ? (
        <InfoBanner icon="check">
          Disetujui{reviewer ? ` oleh ${reviewer}` : ""}
          {modified ? ` ${fmtDateTimeShort(modified)}` : ""}.
        </InfoBanner>
      ) : null}
      <div style={{ height: 12 }} />
      {rows.length ? <OthersTable rows={rows} title="Metrik" /> : <InfoBanner tone="warn">Report ini belum berisi angka.</InfoBanner>}
      {note && !/automated/i.test(note) ? (
        <div className="hc-quote" style={{ marginBottom: 16 }}>
          <Icon name="info" size={16} color="#0072FF" />
          <span>
            “{note}” {reviewer ? <span className="pbs-muted">— {reviewer}</span> : null}
          </span>
        </div>
      ) : null}
      {url ? (
        <Button variant="secondary" onClick={() => action.fire("OPEN_EVIDENCE", { url, reportId: rowId(report), title: str(report, "Title") })}>
          <Icon name="external" size={14} /> Lihat screenshot
        </Button>
      ) : null}
    </>
  );
}

function Loading(): React.ReactElement {
  return (
    <div className="hc-col" aria-busy="true">
      <Skeleton w={120} h={12} />
      <Skeleton w="50%" h={24} style={{ margin: "12px 0 16px" }} />
      <Skeleton h={70} r={8} />
      <div className="hc-grid2" style={{ marginTop: 16 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} h={64} r={8} />
        ))}
      </div>
    </div>
  );
}
