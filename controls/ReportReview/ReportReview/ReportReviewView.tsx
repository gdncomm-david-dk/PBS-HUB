import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { Row, date, localDayKey } from "../../../shared/data";
import { fmtAge, fmtDayMonth, fmtNumber, fmtSignedPct } from "../../../shared/format";
import { REASONS, ReasonCode, reasonDetail, reviewBadge } from "../../../shared/reconcile";
import { ApprovalStatusBadge, DECISION_ACTIONS, DECISION_DONE_TEXT, DecisionPanel, EvidenceRail, MetricsTable, PlaybookValue, ReportHeader } from "../../../shared/reportUi";
import { ReportItem, buildReportItems, itemRef } from "../../../shared/reportItems";
import { Badge, Button, EmptyState, EndOfData, FilterDate, FilterSelect, Icon, InfoBanner, ModuleHeader, Overlay, Pill, ResultBanner, SkeletonRows, Spinner } from "../../../shared/ui";
import { fmtAgo as fmtAgoText } from "../../../shared/format";

export type Tab = "Waiting" | "Revision" | "Done" | "All";

export interface ReportReviewProps {
  ctx: ModuleContext;
  reports: Row[];
  evidence: Row[];
  brands: Row[];
  hosts: Row[];
  schedules: Row[];
  defaultTab: Tab;
  readOnly: boolean;
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

interface Filters {
  reason: string;
  brand: string;
  host: string;
  platform: string;
  from: string;
  to: string;
  age: string;
}

const NO_FILTERS: Filters = { reason: "", brand: "", host: "", platform: "", from: "", to: "", age: "" };

const TAB_LABEL: Record<Tab, string> = { Waiting: "Menunggu review", Revision: "Perlu revisi", Done: "Selesai", All: "Semua" };

function inTab(it: ReportItem, tab: Tab): boolean {
  if (tab === "All") return true;
  if (tab === "Waiting") return it.state === "WAITING";
  if (tab === "Revision") return it.state === "REVISION";
  return it.state === "DONE_AUTO" || it.state === "DONE_MANUAL";
}

const AGE_OPTIONS = [
  { value: "1", label: "Lebih dari 1 hari" },
  { value: "3", label: "Lebih dari 3 hari" },
  { value: "7", label: "Lebih dari 7 hari" },
];

const uniqueOptions = (items: ReportItem[], key: (i: ReportItem) => string, label: (i: ReportItem) => string) => {
  const m = new Map<string, string>();
  for (const it of items) {
    const k = key(it);
    if (k && !m.has(k)) m.set(k, label(it));
  }
  return [...m.entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label));
};

export function ReportReviewView(props: ReportReviewProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(
    () => ({ tolerancePct: configNumber(ctx, "tolerancePct", 5), confidenceThreshold: configNumber(ctx, "confidenceThreshold", 0.85) }),
    [ctx],
  );
  const pageSize = Math.max(10, configNumber(ctx, "pageSize", 50));
  const items = React.useMemo(() => buildReportItems(props.reports, props.evidence, props.brands, props.hosts, opts, props.schedules), [props.reports, props.evidence, props.brands, props.hosts, opts, props.schedules]);

  const [tab, setTab] = React.useState<Tab>(props.defaultTab);
  React.useEffect(() => setTab(props.defaultTab), [props.defaultTab]);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [shown, setShown] = React.useState(pageSize);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const reviewing = reviewId ? items.find((i) => (i.id || i.title) === reviewId) ?? null : null;
  const openReview = (it: ReportItem) => {
    action.clearResult();
    setReviewId(it.id || it.title);
  };
  // A decision saved from the pop-up closes it; the list shows the banner and canvas reloads rows.
  React.useEffect(() => {
    const r = action.lastResult;
    if (r && r.status === "ok" && DECISION_ACTIONS.includes(r.action)) setReviewId(null);
  }, [action.lastResult]);

  const filterActive = Object.values(filters).some((v) => v !== "");

  const setFilter = (k: keyof Filters, v: string) => {
    const next = { ...filters, [k]: v };
    setFilters(next);
    setShown(pageSize);
    setSelected(new Set());
    // Informational: lets canvas re-query server-side if it pages. Never locks the control.
    action.fire("FILTER_CHANGED", { tab, filters: next });
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setShown(pageSize);
    action.fire("FILTER_CHANGED", { tab, filters: NO_FILTERS });
  };
  const changeTab = (t: Tab) => {
    setTab(t);
    setShown(pageSize);
    setSelected(new Set());
    action.fire("FILTER_CHANGED", { tab: t, filters });
  };

  const tabItems = items.filter((it) => inTab(it, tab));
  const counts: Record<Tab, number> = {
    Waiting: items.filter((i) => inTab(i, "Waiting")).length,
    Revision: items.filter((i) => inTab(i, "Revision")).length,
    Done: items.filter((i) => inTab(i, "Done")).length,
    All: items.length,
  };

  const filtered = tabItems
    .filter((it) => {
      if (filters.reason && it.rec.reason !== filters.reason) return false;
      if (filters.brand && it.brandId !== filters.brand) return false;
      if (filters.host && it.hostId !== filters.host) return false;
      if (filters.platform && it.platform.toLowerCase() !== filters.platform.toLowerCase()) return false;
      const day = it.liveDate ? localDayKey(it.liveDate) : "";
      if (filters.from && (!day || day < filters.from)) return false;
      if (filters.to && (!day || day > filters.to)) return false;
      if (filters.age) {
        const days = it.since ? (now.getTime() - it.since.getTime()) / 86400000 : 0;
        if (days < Number(filters.age)) return false;
      }
      return true;
    })
    .sort((a, b) =>
      tab === "Waiting"
        ? (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity) // oldest first
        : (b.liveDate?.getTime() ?? 0) - (a.liveDate?.getTime() ?? 0),
    );

  const visible = filtered.slice(0, shown);
  const localMore = filtered.length > shown;
  const canDecide = !props.readOnly && hasPermission(ctx, "REPORT_ADJUDICATE");
  const showBulk = canDecide && tab === "Waiting";
  const selectedItems = filtered.filter((it) => selected.has(it.id) && it.bulkEligible);
  const pending = action.pending;
  const bulkPending = pending?.action === "BULK_APPROVE";

  // Clear the selection once canvas confirms the bulk write.
  React.useEffect(() => {
    if (action.lastResult?.action === "BULK_APPROVE" && action.lastResult.status === "ok") setSelected(new Set());
  }, [action.lastResult]);

  const oldest = counts.Waiting > 0 ? items.filter((i) => i.state === "WAITING").reduce<Date | null>((acc, i) => (i.since && (!acc || i.since < acc) ? i.since : acc), null) : null;
  const autoToday = items.filter((i) => i.state === "DONE_AUTO" && i.row && isToday(i.row, now)).length;

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const bulkApprove = () => {
    if (selectedItems.length === 0) return;
    action.dispatch("BULK_APPROVE", {
      items: selectedItems.map(itemRef),
      approvalStatus: "Done",
      match: "Match",
      comment: "Disetujui massal: confidence rendah, semua metrik dalam toleransi.",
      approverEmail: ctx.userEmail,
    });
  };

  const reasonOptions = (Object.keys(REASONS) as ReasonCode[]).map((k) => ({ value: k, label: REASONS[k].label }));
  const cols = 9 + (showBulk ? 1 : 0) + (tab === "Waiting" ? 1 : 0);

  return (
    <div className="pbs-host" ref={hostRef}>
    <div className="pbs-page">
      <ModuleHeader
        crumb="Review"
        title={tab === "Waiting" ? "Antrean rekonsiliasi" : "Report"}
        subtitle={
          props.loading && items.length === 0
            ? "Memuat report…"
            : `${counts.Waiting} report menunggu keputusan${oldest ? ` · tertua ${fmtAge(oldest, now)}` : ""} · ${autoToday} diputuskan otomatis hari ini`
        }
        actions={
          hasPermission(ctx, "RECONCILIATION_CONFIG") ? (
            <Button variant="secondary" onClick={() => action.fire("NAV", { target: "TOLERANCE_CONFIG" })}>
              Konfigurasi toleransi
            </Button>
          ) : undefined
        }
      />

      <ResultBanner result={reviewing || action.lastResult?.status === "conflict" ? null : action.lastResult} onClose={action.clearResult} okText={action.lastResult ? DECISION_DONE_TEXT[action.lastResult.action] ?? "Report tersimpan." : undefined} />

      <div className="pbs-tabs" role="tablist">
        {(["Waiting", "Revision", "Done", "All"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pbs-tab${tab === t ? " on" : ""}`} onClick={() => changeTab(t)}>
            {TAB_LABEL[t]} <span className="pbs-count">{fmtNumber(counts[t])}</span>
          </button>
        ))}
      </div>

      <div className="pbs-filters">
        <FilterSelect label="Alasan" value={filters.reason} options={reasonOptions} onChange={(v) => setFilter("reason", v)} />
        <FilterSelect label="Brand" value={filters.brand} options={uniqueOptions(tabItems, (i) => i.brandId, (i) => i.brand)} onChange={(v) => setFilter("brand", v)} />
        <FilterSelect label="Host" value={filters.host} options={uniqueOptions(tabItems, (i) => i.hostId, (i) => i.host)} onChange={(v) => setFilter("host", v)} />
        <FilterSelect label="Platform" value={filters.platform} options={uniqueOptions(tabItems, (i) => i.platform.toLowerCase(), (i) => i.platform)} onChange={(v) => setFilter("platform", v)} />
        <FilterDate label="Live dari tanggal" value={filters.from} onChange={(v) => setFilter("from", v)} />
        <FilterDate label="Live sampai tanggal" value={filters.to} onChange={(v) => setFilter("to", v)} />
        <FilterSelect label="Umur" value={filters.age} options={AGE_OPTIONS} onChange={(v) => setFilter("age", v)} />
        {filterActive ? (
          <button type="button" className="pbs-link" onClick={clearFilters} style={{ marginLeft: 4 }}>
            Hapus filter
          </button>
        ) : null}
      </div>

      {showBulk && selectedItems.length > 0 ? (
        <InfoBanner
          action={
            <Button disabled={!!pending} onClick={bulkApprove}>
              {bulkPending ? (
                <>
                  <Spinner small /> Menyimpan…
                </>
              ) : (
                `Setujui ${selectedItems.length} baris`
              )}
            </Button>
          }
        >
          {selectedItems.length} baris dipilih. Bulk approve hanya bisa untuk alasan <b>Confidence rendah</b> yang semua metriknya dalam toleransi — baris lain harus dibuka satu per satu.
        </InfoBanner>
      ) : null}

      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table" aria-busy={props.loading}>
            <thead>
              <tr>
                {showBulk ? <th style={{ width: 44 }} aria-label="Pilih" /> : null}
                <th>Rep ID</th>
                <th>Schedule ID</th>
                <th>Tanggal &amp; jam live</th>
                <th>Brand &amp; platform</th>
                <th>Host</th>
                <th>Playbook</th>
                <th>Alasan</th>
                <th>Status</th>
                {tab === "Waiting" ? <th>Menunggu</th> : null}
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {props.loading && items.length === 0 ? <SkeletonRows rows={8} cols={cols} /> : visible.map((it) => (
                <ReportRow
                  key={it.id || it.title}
                  it={it}
                  tab={tab}
                  now={now}
                  showBulk={showBulk}
                  checked={selected.has(it.id)}
                  onToggle={() => toggle(it.id)}
                  disabled={!!pending}
                  onOpen={() => action.fire("OPEN_REPORT", itemRef(it))}
                  onLink={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: it.id, title: it.title })}
                  onReview={() => openReview(it)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {props.loading && items.length === 0 ? null : filtered.length === 0 ? (
          filterActive ? (
            <EmptyState
              icon="filterX"
              title="Tidak ada report yang cocok dengan filter"
              text={`${tabItems.length} report ada di tab ini, tapi tidak ada yang lolos filter yang dipilih.`}
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Hapus filter
                </Button>
              }
            />
          ) : tab === "Waiting" ? (
            <EmptyState good title="Tidak ada yang menunggu keputusan" text="Semua report sudah diputuskan — oleh tim atau otomatis oleh flow rekonsiliasi." />
          ) : (
            <EmptyState icon="inbox" title={`Belum ada report ${TAB_LABEL[tab].toLowerCase()}`} text="Report akan muncul di sini setelah host submit." />
          )
        ) : localMore || props.hasMore ? (
          <div className="pbs-foot">
            <span>
              Menampilkan 1–{fmtNumber(visible.length)} dari {fmtNumber(filtered.length)}
              {props.hasMore ? "+" : ""}
            </span>
            <span className="line" />
            <Button
              variant="secondary"
              size="sm"
              disabled={props.loading}
              onClick={() => (localMore ? setShown(shown + pageSize) : action.fire("LOAD_MORE", { tab, loaded: items.length }))}
            >
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
          <EndOfData text={`Semua ${fmtNumber(filtered.length)} report ${tab === "Waiting" ? "yang menunggu " : ""}sudah ditampilkan`} />
        )}
      </div>
    </div>
    {reviewing ? (
      <ReviewModal
        item={reviewing}
        ctx={ctx}
        action={action}
        readOnly={props.readOnly}
        now={now}
        tolerancePct={opts.tolerancePct}
        onClose={() => setReviewId(null)}
        onDetail={() => {
          setReviewId(null);
          action.fire("OPEN_REPORT", itemRef(reviewing));
        }}
      />
    ) : null}
    </div>
  );
}

function ReviewModal(props: {
  item: ReportItem;
  ctx: ModuleContext;
  action: UseActionResult;
  readOnly: boolean;
  now: Date;
  tolerancePct: number;
  onClose: () => void;
  onDetail: () => void;
}): React.ReactElement {
  const { item, action } = props;
  const pending = !!action.pending && DECISION_ACTIONS.includes(action.pending.action);
  const conflict = action.lastResult?.status === "conflict" ? action.lastResult : null;
  const error = action.lastResult?.status === "error" ? action.lastResult : null;
  const reason = REASONS[item.rec.reason];
  const st = reviewBadge(item.row, item.state);
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-rv-title" wide>
        <div className="pbs-modal-h">
          <h2 id="pbs-rv-title">Review {item.title}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="ghost" size="sm" onClick={props.onDetail} disabled={pending}>
              <Icon name="external" size={14} /> Lihat detail
            </Button>
            <button type="button" className="pbs-x" onClick={props.onClose} disabled={pending} aria-label="Tutup">
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="pbs-modal-b">
          <ReportHeader item={item} onOpenLink={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: item.id, title: item.title })} pill={item.state === "WAITING" ? <Pill tone={reason.tone}>{reason.label}</Pill> : <Pill tone={st.tone}>{st.label}</Pill>} />
          {conflict ? (
            <InfoBanner tone="warn">
              Report ini sudah diputuskan oleh {conflict.decidedBy || "orang lain"}
              {conflict.decidedAt ? ` ${fmtAgoText(new Date(conflict.decidedAt), props.now)}` : ""}. Keputusanmu tidak disimpan.
            </InfoBanner>
          ) : null}
          {error ? <InfoBanner tone="err">{error.message || "Gagal menyimpan. Coba lagi."}</InfoBanner> : null}
          <div className="pbs-rv">
            <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
              <MetricsTable item={item} tolerancePct={props.tolerancePct} />
              <DecisionPanel key={item.id || item.title} item={item} ctx={props.ctx} action={action} readOnly={props.readOnly} tolerancePct={props.tolerancePct} now={props.now} />
            </div>
            <EvidenceRail compact item={item} ctx={props.ctx} onOpen={(url) => action.fire("OPEN_EVIDENCE", { url, reportId: item.id, title: item.title })} />
          </div>
        </div>
    </Overlay>
  );
}

function isToday(row: Row, now: Date): boolean {
  const d = date(row, "Modified");
  return d !== null && localDayKey(d) === localDayKey(now);
}

function ReportRow(props: {
  it: ReportItem;
  tab: Tab;
  now: Date;
  showBulk: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onLink: (url: string) => void;
  onReview: () => void;
}): React.ReactElement {
  const { it, now } = props;
  const reason = REASONS[it.rec.reason];
  const detail = reasonDetail(it.rec, fmtSignedPct);
  const ageDays = it.since ? (now.getTime() - it.since.getTime()) / 86400000 : 0;
  return (
    <tr className={props.checked ? "sel" : undefined}>
      {props.showBulk ? (
        <td>
          {it.bulkEligible ? (
            <input type="checkbox" className="pbs-check" checked={props.checked} onChange={props.onToggle} disabled={props.disabled} aria-label={`Pilih ${it.title}`} />
          ) : null}
        </td>
      ) : null}
      <td className="pbs-num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{it.title || "—"}</td>
      <td className="pbs-num pbs-muted" style={{ whiteSpace: "nowrap" }}>{it.scheduleId || "—"}</td>
      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
        {fmtDayMonth(it.liveDate)}
        <span className="pbs-muted" style={{ display: "block", fontSize: 12 }}>{it.liveTime || "—"}</span>
      </td>
      <td>
        <span style={{ fontWeight: 600 }}>{it.brand}</span>
        <span className="pbs-muted" style={{ display: "block", fontSize: 12 }}>{it.platform || "—"}</span>
      </td>
      <td>{it.host}</td>
      <td>
        <PlaybookValue compact value={it.playbook} onOpen={props.onLink} />
      </td>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Badge tone={reason.tone}>{reason.label}</Badge>
          {detail ? (
            <span style={{ fontSize: 11.5, color: it.rec.reason === "LOW_CONFIDENCE" && it.rec.allWithin ? "#0A7A24" : "#60686E" }} className="pbs-num">
              {detail}
            </span>
          ) : null}
          {it.rec.evidenceCount > 1 ? (
            <Badge tone="neutral" small title="Lebih dari satu baris Report Automation untuk report ini; yang terbaru dipakai">
              {it.rec.evidenceCount} bukti
            </Badge>
          ) : null}
        </span>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <ApprovalStatusBadge item={it} />
      </td>
      {props.tab === "Waiting" ? (
        <td>
          <span className="pbs-num" style={{ fontWeight: ageDays >= 3 ? 600 : 400, color: ageDays >= 3 ? "#C0292A" : undefined, whiteSpace: "nowrap" }}>
            {fmtAge(it.since, now)}
          </span>
        </td>
      ) : null}
      <td className="r">
        <span className="pbs-rowact">
          <Button size="sm" variant={it.state === "WAITING" ? "primary" : "secondary"} onClick={props.onReview}>
            {it.state === "WAITING" ? "Review" : "Lihat"}
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onOpen}>
            Detail
          </Button>
        </span>
      </td>
    </tr>
  );
}
