import * as React from "react";
import {
  ModuleContext,
  UseActionResult,
  configNumber,
  hasPermission,
} from "../../../shared/contract";
import { Row } from "../../../shared/data";
import {
  fmtDateTimeShort,
  fmtDayMonth,
  fmtNumber,
  shortName,
} from "../../../shared/format";
import {
  HOST_STATUS,
  HostModel,
  HostStatus,
  ScoreBand,
  ScoreTx,
  TxType,
  buildHosts,
  buildLedger,
  checkLedger,
  parseBands,
  scoreDefaults,
} from "../../../shared/host";
import { TX_FILTERS, TxFilter, matchesFilter } from "../../../shared/hostScore";
import {
  AdminRule,
  ScorePreview,
  addScoreMissing,
  averageScore,
  bandCounts,
  canVoid,
  categoriesFor,
  composeNotes,
  isOverride,
  lastTxByHost,
  needsAck,
  newTransactionId,
  parseAdminRules,
  previewScore,
  reversalNote,
  reversalsByTx,
  rulesFor,
  signed,
  signedPoint,
  VOID_REASON,
} from "../../../shared/scoreAdmin";
import {
  Badge,
  Button,
  EmptyState,
  FilterSelect,
  Icon,
  InfoBanner,
  ModuleHeader,
  Overlay,
  Pager,
  ResultBanner,
  SkeletonRows,
  Spinner,
  TONE_DOT,
  usePaged,
} from "../../../shared/ui";

export interface HostScoreProps {
  ctx: ModuleContext;
  hosts: Row[];
  recent: Row[];
  ledger: Row[];
  rules: Row[];
  thresholds: Row[];
  hostId: string;
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

type Dialog =
  | { kind: "add"; type: TxType; host: HostModel | null }
  | { kind: "void"; tx: ScoreTx; host: HostModel };

const BAND_TEXT: Record<string, string> = {
  success: "pbs-t-ok",
  danger: "pbs-t-bad",
  warning: "pbs-t-warn",
  info: "pbs-t-info",
  neutral: "",
};

const range = (b: ScoreBand) =>
  b.min !== null && b.max !== null
    ? `${fmtNumber(b.min)}–${fmtNumber(b.max)}`
    : b.min !== null
      ? `≥ ${fmtNumber(b.min)}`
      : b.max !== null
        ? `≤ ${fmtNumber(b.max)}`
        : "";
const pointClass = (p: number | null) =>
  p === null ? "" : p >= 0 ? "pbs-t-ok" : "pbs-t-bad";

export function HostScoreView(props: HostScoreProps): React.ReactElement {
  const { ctx, action } = props;
  const bands = React.useMemo(
    () => parseBands(props.thresholds),
    [props.thresholds],
  );
  const defaults = React.useMemo(() => scoreDefaults(ctx.config), [ctx]);
  const hosts = React.useMemo(
    () => buildHosts(props.hosts, bands, defaults),
    [props.hosts, bands, defaults],
  );
  const rules = React.useMemo(
    () => parseAdminRules(props.rules),
    [props.rules],
  );
  const canEdit = hasPermission(ctx, "SCORE_EDIT");
  const host = props.hostId
    ? (hosts.find(
        (h) => h.hostId.toLowerCase() === props.hostId.toLowerCase(),
      ) ?? null)
    : null;

  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  React.useEffect(() => {
    const r = action.lastResult;
    if (
      r &&
      r.status === "ok" &&
      (r.action === "ADD_SCORE" || r.action === "VOID_SCORE")
    )
      setDialog(null);
  }, [action.lastResult]);
  const open = (d: Dialog) => {
    if (action.lastResult && action.lastResult.action !== "LOAD_MORE")
      action.clearResult();
    setDialog(d);
  };
  // A failed save stays in its dialog; the page banner only shows it once the dialog is closed.
  const bannerResult =
    dialog &&
    (action.lastResult?.action === "ADD_SCORE" ||
      action.lastResult?.action === "VOID_SCORE")
      ? null
      : action.lastResult;

  return (
    <div className="pbs-page pbs-sc">
      {props.hostId ? (
        <LedgerPage
          {...props}
          host={host}
          bands={bands}
          canEdit={canEdit}
          bannerResult={bannerResult}
          onDialog={open}
        />
      ) : (
        <ListPage
          {...props}
          hosts={hosts}
          bands={bands}
          canEdit={canEdit}
          bannerResult={bannerResult}
          onAdd={() => open({ kind: "add", type: "REWARD", host: null })}
        />
      )}
      {dialog?.kind === "add" ? (
        <ScoreModal
          ctx={ctx}
          hosts={hosts}
          host={dialog.host}
          type={dialog.type}
          rules={rules}
          bands={bands}
          now={props.now}
          action={action}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "void" ? (
        <VoidModal
          host={dialog.host}
          tx={dialog.tx}
          bands={bands}
          now={props.now}
          action={action}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

// ---- SL-1 host list -----------------------------------------------------------------------------

interface ListFilters {
  q: string;
  band: string;
  status: string;
}
const NO_FILTERS: ListFilters = { q: "", band: "", status: "" };

type SortKey = "scoreDesc" | "scoreAsc" | "code" | "recent";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "scoreDesc", label: "Urut: skor tertinggi" },
  { value: "scoreAsc", label: "Urut: skor terendah" },
  { value: "code", label: "Urut: kode host" },
  { value: "recent", label: "Urut: transaksi terbaru" },
];
const STATUS_OPTIONS = (["ACTIVE", "INACTIVE", "UNKNOWN"] as HostStatus[]).map(
  (s) => ({ value: s, label: HOST_STATUS[s].label }),
);

function ListPage(
  props: Omit<HostScoreProps, "hosts"> & {
    hosts: HostModel[];
    bands: ScoreBand[];
    canEdit: boolean;
    bannerResult: UseActionResult["lastResult"];
    onAdd: () => void;
  },
): React.ReactElement {
  const { hosts, bands, action } = props;
  const recent = React.useMemo(
    () => lastTxByHost(buildLedger(props.recent)),
    [props.recent],
  );
  const [filters, setFilters] = React.useState<ListFilters>(NO_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("scoreDesc");
  const filterActive = Object.values(filters).some((v) => v !== "");
  const apply = (next: ListFilters) => {
    setFilters(next);
    action.fire("FILTER_CHANGED", { filters: next, sort });
  };

  const q = filters.q.trim().toLowerCase();
  const rows = hosts
    .filter((h) => {
      if (
        q &&
        ![h.code, h.hostId, h.name].some((s) => s.toLowerCase().includes(q))
      )
        return false;
      if (filters.status && h.status !== filters.status) return false;
      if (filters.band === "drift") return h.drift;
      if (
        filters.band === "none"
          ? h.band !== null
          : filters.band && h.band?.id !== filters.band
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      switch (sort) {
        case "scoreAsc":
          return (
            (a.score ?? Infinity) - (b.score ?? Infinity) ||
            a.code.localeCompare(b.code)
          );
        case "code":
          return a.code.localeCompare(b.code, undefined, { numeric: true });
        case "recent":
          return (
            (recent.get(b.hostId)?.when?.getTime() ?? 0) -
            (recent.get(a.hostId)?.when?.getTime() ?? 0)
          );
        default:
          return (
            (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
            a.code.localeCompare(b.code)
          );
      }
    });

  const paged = usePaged(rows, JSON.stringify([filters, sort]));
  const counts = bandCounts(hosts, bands);
  const drifted = hosts.filter((h) => h.drift).length;
  const avg = averageScore(hosts);
  const firstLoad = props.loading && hosts.length === 0;
  const bandOptions = bands
    .map((b) => ({ value: b.id, label: b.label }))
    .concat(
      hosts.some((h) => h.band === null)
        ? [{ value: "none", label: "Tanpa band" }]
        : [],
    )
    .concat(
      drifted ? [{ value: "drift", label: "Tidak sinkron dengan ledger" }] : [],
    );

  return (
    <>
      <ModuleHeader
        crumb="Skor host"
        title="Skor host"
        subtitle={
          firstLoad
            ? "Memuat host…"
            : `${fmtNumber(hosts.length)}${props.hasMore ? "+" : ""} host${avg !== null ? ` · skor rata-rata ${fmtNumber(avg)}` : ""}${drifted ? ` · ${fmtNumber(drifted)} skor tidak sinkron dengan ledger` : ""}`
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => action.fire("NAV", { target: "RULES" })}
            >
              Aturan skor
            </Button>
            {props.canEdit ? (
              <Button
                onClick={props.onAdd}
                disabled={hosts.length === 0 || !!action.pending}
              >
                <Icon name="plus" size={15} /> Tambah transaksi
              </Button>
            ) : null}
          </>
        }
      />

      <ResultBanner result={props.bannerResult} onClose={action.clearResult} />

      {bands.length === 0 && !firstLoad ? (
        <InfoBanner tone="warn">
          <span className="pbs-mono">ThresholdsJson</span> kosong: band skor
          tidak bisa ditentukan. Kirim baris aktif dari{" "}
          <b>[FAS STUDIO] HostScoreThreshold</b>.
        </InfoBanner>
      ) : null}

      {bands.length > 0 ? (
        <div className="pbs-sc-kpis" role="group" aria-label="Host per band">
          {counts.map((c) => {
            const id = c.band?.id ?? "none";
            const on = filters.band === id;
            return (
              <button
                key={id}
                type="button"
                className={`pbs-kpi pbs-sc-kpi${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => apply({ ...filters, band: on ? "" : id })}
              >
                <span className="l">
                  <span
                    className="pbs-sc-sq"
                    style={{ background: TONE_DOT[c.band?.tone ?? "neutral"] }}
                    aria-hidden="true"
                  />
                  {c.band
                    ? `${c.band.label}${range(c.band) ? ` · ${range(c.band)}` : ""}`
                    : "Tanpa band"}
                </span>
                <span className="v">
                  {firstLoad ? "—" : fmtNumber(c.count)}
                </span>
                <span className="n">
                  host · {Math.round(c.share * 100)}% dari total
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {drifted > 0 && filters.band !== "drift" ? (
        <InfoBanner
          tone="warn"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => apply({ ...filters, band: "drift" })}
            >
              Tampilkan
            </Button>
          }
        >
          <b>{drifted} host</b> punya skor tersimpan yang berbeda dari jumlah
          ledger. Buka ledger-nya untuk melihat transaksi yang belum ikut
          dihitung.
        </InfoBanner>
      ) : null}

      <div className="pbs-filters">
        <label className="pbs-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={filters.q}
            placeholder="Cari HostCode atau nama"
            aria-label="Cari host"
            onChange={(e) => apply({ ...filters, q: e.target.value })}
          />
        </label>
        <FilterSelect
          label="Band"
          value={filters.band}
          options={bandOptions}
          onChange={(v) => apply({ ...filters, band: v })}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(v) => apply({ ...filters, status: v })}
        />
        {filterActive ? (
          <button
            type="button"
            className="pbs-link"
            onClick={() => apply(NO_FILTERS)}
            style={{ marginLeft: 4 }}
          >
            Hapus filter
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <label className="pbs-chip">
          <span className="pbs-sr">Urutkan</span>
          <select
            value={sort}
            aria-label="Urutkan"
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </div>

      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table pbs-sc-list" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>HostCode</th>
                <th>Nama</th>
                <th className="r">Skor</th>
                <th>Band</th>
                <th>Transaksi terakhir</th>
                <th>Tanggal</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={8} cols={7} />
              ) : (
                paged.rows.map((h) => {
                  const t = recent.get(h.hostId);
                  const openLedger = () =>
                    action.fire("OPEN_LEDGER", { hostId: h.hostId, id: h.id });
                  return (
                    <tr
                      key={h.hostId}
                      className={
                        h.drift
                          ? "pbs-sc-drift"
                          : h.status === "INACTIVE"
                            ? "muted"
                            : undefined
                      }
                    >
                      <td className="pbs-mono" style={{ whiteSpace: "nowrap" }}>
                        {h.code}
                      </td>
                      <td>
                        <span className="pbs-sc-name">
                          <button
                            type="button"
                            className="pbs-link"
                            onClick={openLedger}
                          >
                            {h.name}
                          </button>
                          {h.drift ? (
                            <span className="pbs-badge danger sm">
                              <Icon name="alert" size={11} /> Tidak sinkron
                            </span>
                          ) : null}
                          {h.status === "INACTIVE" ? (
                            <Badge tone="neutral" small>
                              Nonaktif
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td
                        className={`r pbs-num pbs-sc-score ${h.band ? BAND_TEXT[h.band.tone] : ""}`}
                      >
                        {h.score === null ? (
                          <span className="pbs-muted">—</span>
                        ) : (
                          fmtNumber(h.score)
                        )}
                      </td>
                      <td>
                        {h.band ? (
                          <Badge tone={h.band.tone} small>
                            {h.band.label}
                          </Badge>
                        ) : (
                          <span className="pbs-muted">—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                        {h.drift ? (
                          <span className="pbs-t-bad">
                            Jumlah ledger {fmtNumber(h.ledgerScore)}, tersimpan{" "}
                            {fmtNumber(h.storedScore)}
                          </span>
                        ) : t ? (
                          <span className={t.active ? undefined : "pbs-muted"}>
                            {t.rule}{" "}
                            <b
                              className={
                                t.active || t.reversal
                                  ? pointClass(t.point)
                                  : ""
                              }
                            >
                              {signed(t.point)}
                            </b>
                            {t.reversal
                              ? " · koreksi"
                              : !t.active
                                ? " · dibatalkan"
                                : ""}
                          </span>
                        ) : (
                          <span className="pbs-muted">Belum ada transaksi</span>
                        )}
                      </td>
                      <td
                        className="pbs-num pbs-muted"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {t ? fmtDayMonth(t.when) : "—"}
                      </td>
                      <td className="r">
                        <button
                          type="button"
                          className="pbs-link"
                          onClick={openLedger}
                        >
                          {h.drift ? "Periksa" : "Ledger"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : rows.length === 0 ? (
          filterActive ? (
            <EmptyState
              icon="filterX"
              title="Tidak ada host yang cocok dengan filter"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => apply(NO_FILTERS)}
                >
                  Hapus filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="user"
              title="Belum ada host"
              text="Host dari list Host - PBS Hub akan muncul di sini dengan skornya."
            />
          )
        ) : (
          <Pager
            paged={paged}
            unit="host"
            hasMore={props.hasMore}
            loading={props.loading}
            onLoadMore={() =>
              action.fire("LOAD_MORE", { loaded: hosts.length, filters, sort })
            }
          />
        )}
      </div>
      <p className="pbs-muted pbs-sc-note">
        Skor di kolom ini adalah nilai tersimpan di Host
        {drifted || hosts.some((h) => h.ledgerScore !== null)
          ? "; jumlah ledger dihitung ulang saat halaman dibuka, dan selisihnya ditandai"
          : ""}
        .
      </p>
    </>
  );
}

// ---- SL-2 ledger of one host --------------------------------------------------------------------

function LedgerPage(
  props: HostScoreProps & {
    host: HostModel | null;
    bands: ScoreBand[];
    canEdit: boolean;
    bannerResult: UseActionResult["lastResult"];
    onDialog: (d: Dialog) => void;
  },
): React.ReactElement {
  const { host: h, action } = props;
  const ledger = React.useMemo(() => buildLedger(props.ledger), [props.ledger]);
  const reversals = React.useMemo(() => reversalsByTx(ledger), [ledger]);
  const check = h ? checkLedger(h, ledger) : null;
  const [filter, setFilter] = React.useState<TxFilter | "Reversal">("All");
  const rows = ledger.filter((t) =>
    filter === "Reversal" ? t.reversal : matchesFilter(t, filter),
  );
  const paged = usePaged(rows, filter);
  const visible = paged.rows;
  const firstLoad = props.loading && (!h || ledger.length === 0);
  const back = () => action.fire("BACK", {});
  const busy = !!action.pending;
  const reversalCount = ledger.filter((t) => t.reversal).length;
  const chips: { key: TxFilter | "Reversal"; label: string; n: number }[] = [
    ...TX_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      n: ledger.filter((t) => matchesFilter(t, f.key)).length,
    })),
    { key: "Reversal", label: "Koreksi", n: reversalCount },
  ];

  if (!h && !props.loading) {
    return (
      <>
        <ModuleHeader
          crumb={
            <button type="button" onClick={back}>
              Skor host
            </button>
          }
          title="Ledger skor"
        />
        <EmptyState
          icon="user"
          title="Host tidak ditemukan"
          text={`${props.hostId} tidak ada di HostsJson. Kirim baris host itu, atau kembali ke daftar.`}
          action={
            <Button variant="secondary" size="sm" onClick={back}>
              Kembali
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <ModuleHeader
        crumb={
          <>
            <button type="button" onClick={back}>
              Skor host
            </button>{" "}
            / {h?.code ?? props.hostId}
          </>
        }
        title="Ledger skor"
        subtitle="Riwayat tidak pernah diubah: transaksi yang salah dibatalkan, bukan disunting. Skor sebelum dan sesudah selalu tercatat."
      />

      <ResultBanner result={props.bannerResult} onClose={action.clearResult} />

      <div className="pbs-card pbs-rec">
        <div className="pbs-rec-code">{h?.code ?? props.hostId}</div>
        <div className="pbs-rec-g">
          <Meta label="Nama" value={h?.name ?? "—"} />
          <Meta
            label="Skor sekarang"
            value={
              <span className="pbs-sc-now">
                <b
                  className={`pbs-num ${h?.band ? BAND_TEXT[h.band.tone] : ""}`}
                >
                  {fmtNumber(h?.score)}
                </b>
                {h?.band ? (
                  <Badge tone={h.band.tone} small>
                    {h.band.label}
                  </Badge>
                ) : null}
              </span>
            }
          />
          <Meta
            label="Jumlah ledger"
            value={
              check && check.expected !== null ? (
                <span className={check.drift ? "pbs-t-bad" : undefined}>
                  {fmtNumber(check.expected)} ·{" "}
                  {check.drift
                    ? `tidak sinkron (${signed(check.diff === null ? null : Math.round(check.diff))})`
                    : "sinkron"}{" "}
                  · {fmtNumber(ledger.length)} transaksi
                </span>
              ) : (
                `${fmtNumber(ledger.length)} transaksi`
              )
            }
          />
        </div>
        {props.canEdit && h ? (
          <div className="pbs-actions">
            <Button
              variant="secondary"
              onClick={() =>
                props.onDialog({ kind: "add", type: "PENALTY", host: h })
              }
              disabled={busy || h.score === null}
            >
              Kurangi poin
            </Button>
            <Button
              onClick={() =>
                props.onDialog({ kind: "add", type: "REWARD", host: h })
              }
              disabled={busy || h.score === null}
            >
              Tambah poin
            </Button>
          </div>
        ) : null}
      </div>

      {check?.drift && h ? (
        <InfoBanner tone="warn">
          <b>Skor tersimpan tidak cocok dengan ledger.</b> CurrentScore{" "}
          {fmtNumber(h.storedScore)}, sedangkan awal {fmtNumber(h.initial)} +{" "}
          {check.activeCount} transaksi aktif = {fmtNumber(check.expected)}.
          Transaksi baru dihitung dari skor tersimpan; minta admin menyamakan{" "}
          <span className="pbs-mono">CurrentScore</span> dulu kalau selisihnya
          bukan disengaja.
        </InfoBanner>
      ) : null}

      <div className="pbs-sc-chips" role="tablist" aria-label="Jenis transaksi">
        {chips
          .filter((c) => c.key === "All" || c.n > 0 || filter === c.key)
          .map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={filter === c.key}
              className={`pbs-btn sm ${filter === c.key ? "primary" : "secondary"}`}
              onClick={() => {
                setFilter(c.key);
              }}
            >
              {c.label} <span className="pbs-num">{fmtNumber(c.n)}</span>
            </button>
          ))}
      </div>

      <div className="pbs-table-wrap">
        <div className="pbs-table-scroll">
          <table className="pbs-table pbs-sc-ledger" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Rule</th>
                <th>Tipe</th>
                <th className="r">Poin</th>
                <th className="r">Sebelum</th>
                <th className="r">Sesudah</th>
                <th>Alasan &amp; catatan</th>
                <th>Oleh</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={6} cols={9} />
              ) : (
                visible.map((t) => {
                  const rev =
                    !t.active && !t.reversal
                      ? reversals.get(t.txId)
                      : undefined;
                  return (
                    <tr
                      key={t.id || t.txId}
                      className={
                        t.reversal
                          ? "pbs-sc-rev"
                          : t.active
                            ? undefined
                            : "void"
                      }
                    >
                      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
                        {fmtDateTimeShort(t.when)}
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 160 }}>
                        <b className="pbs-sc-rule">{t.rule}</b>
                        {t.txId ? (
                          <span className="pbs-mono pbs-muted pbs-sc-id">
                            {t.txId}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {t.reversal ? (
                          <Badge tone="info" small>
                            Koreksi
                          </Badge>
                        ) : !t.active ? (
                          <Badge
                            tone="neutral"
                            small
                            title={
                              t.statusText
                                ? `Status: ${t.statusText}`
                                : undefined
                            }
                          >
                            Dibatalkan
                          </Badge>
                        ) : t.type === "PENALTY" ? (
                          <Badge tone="danger" small>
                            Penalty
                          </Badge>
                        ) : (
                          <Badge tone="success" small>
                            Reward
                          </Badge>
                        )}
                      </td>
                      <td
                        className={`r pbs-num ${t.active || t.reversal ? pointClass(t.point) : ""}`}
                        style={{ fontWeight: 700 }}
                      >
                        {signed(t.point)}
                      </td>
                      <td className="r pbs-num pbs-muted">
                        {fmtNumber(t.before)}
                      </td>
                      <td
                        className="r pbs-num"
                        style={{
                          fontWeight: t.active || t.reversal ? 600 : undefined,
                        }}
                      >
                        {fmtNumber(t.after)}
                      </td>
                      <td
                        className="keep"
                        style={{ whiteSpace: "normal", minWidth: 200 }}
                      >
                        {[
                          t.notes,
                          rev
                            ? `dibatalkan ${fmtDayMonth(rev.when)}${rev.by ? ` oleh ${shortName(rev.by)}` : ""}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || <span className="pbs-muted">—</span>}
                      </td>
                      <td
                        className="keep"
                        style={{ whiteSpace: "nowrap" }}
                        title={t.by || undefined}
                      >
                        {t.by ? (
                          shortName(t.by)
                        ) : (
                          <span className="pbs-muted">otomatis</span>
                        )}
                      </td>
                      <td className="r">
                        {props.canEdit && h && canVoid(t) ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              props.onDialog({ kind: "void", tx: t, host: h })
                            }
                          >
                            Batalkan
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : ledger.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="Belum ada transaksi skor"
            text="Skor host masih nilai awal. Reward dan penalty yang diberikan akan tercatat di sini."
          />
        ) : (
          <Pager paged={paged} unit="transaksi" suffix=" · urut terbaru" />
        )}
      </div>
      <p className="pbs-muted pbs-sc-note">
        Ledger tidak pernah disunting. Baris yang salah dibatalkan, dan
        pembatalannya masuk sebagai transaksi baru dengan poin berlawanan. Baris
        yang dibatalkan dan baris koreksinya tidak ikut dijumlah, sehingga
        jumlah ledger tetap sama dengan skor tersimpan.
      </p>
    </>
  );
}

function Meta(props: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="pbs-rec-m">
      <span className="l">{props.label}</span>
      <span className="v">{props.value}</span>
    </div>
  );
}

// ---- dialogs ------------------------------------------------------------------------------------

function PreviewBox(props: {
  p: ScorePreview;
  label?: string;
}): React.ReactElement {
  const { p } = props;
  if (p.after === null)
    return (
      <div className="pbs-sc-prev muted">
        {p.before === null
          ? "Skor host belum ada"
          : "Isi poin untuk melihat skor baru"}
      </div>
    );
  const move =
    p.bandMove > 0
      ? `naik dari ${p.bandBefore?.label ?? "—"}`
      : p.bandMove < 0
        ? `turun dari ${p.bandBefore?.label ?? "—"}`
        : p.bandAfter
          ? `tetap ${p.bandAfter.label}`
          : "";
  return (
    <div className="pbs-sc-prev" aria-live="polite">
      <span className="pbs-num pbs-muted">{fmtNumber(p.before)}</span>
      <Icon
        name="arrowLeft"
        size={14}
        style={{ transform: "rotate(180deg)" }}
      />
      <b
        className={`pbs-num ${p.bandAfter ? BAND_TEXT[p.bandAfter.tone] : ""}`}
      >
        {fmtNumber(p.after)}
      </b>
      {p.bandAfter ? (
        <Badge tone={p.bandAfter.tone} small>
          {p.bandAfter.label}
        </Badge>
      ) : null}
      <span className="pbs-muted" style={{ fontSize: 12 }}>
        {[move, p.clamped ? "dibatasi min/maks skor" : ""]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

function SaveError(props: {
  action: UseActionResult;
  name: string;
}): React.ReactElement | null {
  const r = props.action.lastResult;
  if (!r || r.action !== props.name || r.status === "ok") return null;
  return (
    <InfoBanner tone="err">
      {r.status === "conflict"
        ? r.message ||
          "Skor host sudah berubah sejak halaman dibuka. Tutup, muat ulang, lalu coba lagi."
        : r.message || "Gagal menyimpan. Coba lagi."}
    </InfoBanner>
  );
}

function ScoreModal(props: {
  ctx: ModuleContext;
  hosts: HostModel[];
  host: HostModel | null;
  type: TxType;
  rules: AdminRule[];
  bands: ScoreBand[];
  now: Date;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { action, rules, bands } = props;
  const [hostId, setHostId] = React.useState(props.host?.hostId ?? "");
  const h = props.host ?? props.hosts.find((x) => x.hostId === hostId) ?? null;
  const [type, setType] = React.useState<TxType>(props.type);
  const [category, setCategory] = React.useState("");
  const [ruleId, setRuleId] = React.useState("");
  const [pointText, setPointText] = React.useState("");
  const [overrideReason, setOverrideReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const pending = action.pending?.action === "ADD_SCORE";

  const categories = categoriesFor(rules, type);
  const options = rulesFor(rules, type, category);
  const rule = options.find((r) => r.id === ruleId) ?? null;
  const point = signedPoint(pointText, type);
  const preview = previewScore(
    h ?? { score: null, min: null, max: null },
    point,
    bands,
  );
  const bigPenalty = configNumber(props.ctx, "bigPenaltyPoints", 10);
  const minSchedule = configNumber(props.ctx, "scheduleMinScore", NaN);
  const override = isOverride(rule, point);
  const ack1 = needsAck(point, preview, bigPenalty);
  const missing = h
    ? addScoreMissing({
        rule,
        point,
        overrideReason,
        notes,
        acknowledged: ack,
        preview,
        bigPenalty,
      })
    : ["host"];

  const pickType = (t: TxType) => {
    setType(t);
    setCategory("");
    setRuleId("");
    setPointText("");
    setAck(false);
  };
  const pickRule = (id: string) => {
    setRuleId(id);
    const r = rules.find((x) => x.id === id);
    setPointText(
      r?.point !== null && r?.point !== undefined
        ? signed(r.point).replace("−", "-")
        : "",
    );
    setAck(false);
  };

  const submit = () => {
    if (
      !h ||
      !rule ||
      point === null ||
      preview.after === null ||
      missing.length > 0 ||
      pending
    )
      return;
    action.dispatch("ADD_SCORE", {
      hostId: h.hostId,
      hostItemId: h.id,
      hostCode: h.code,
      hostName: h.name,
      transactionId: newTransactionId(props.now),
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      severity: rule.severity,
      transactionType: type === "PENALTY" ? "Penalty" : "Reward",
      point,
      defaultPoint: rule.point,
      overridden: override,
      overrideReason: override ? overrideReason.trim() : "",
      notes: notes.trim(),
      notesText: composeNotes(
        notes,
        override ? { from: rule.point, reason: overrideReason } : null,
        ack1 && ack,
      ),
      acknowledged: ack1 ? ack : false,
      expectedScore: h.score,
      scoreBefore: preview.before,
      scoreAfter: preview.after,
      bandBefore: preview.bandBefore?.label ?? "",
      bandAfter: preview.bandAfter?.label ?? "",
    });
  };

  const title = type === "PENALTY" ? "Kurangi poin" : "Tambah poin";
  const hostOptions = props.hosts
    .filter((x) => x.status !== "INACTIVE")
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const missingText = missing.length
    ? `Belum lengkap: ${missing.join(", ")}`
    : "";

  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-sc-add">
      <div className="pbs-modal-h">
        <div>
          <h2 id="pbs-sc-add">{title}</h2>
          <div className="pbs-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {h
              ? `${h.code} · ${h.name} · skor sekarang ${fmtNumber(h.score)}`
              : "Pilih host dulu"}
          </div>
        </div>
        <button
          type="button"
          className="pbs-x"
          onClick={props.onClose}
          disabled={pending}
          aria-label="Tutup"
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="pbs-modal-b">
        {props.host ? null : (
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-sc-host">
              Host
            </label>
            <select
              id="pbs-sc-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              disabled={pending}
            >
              <option value="">Pilih host</option>
              {hostOptions.map((x) => (
                <option key={x.hostId} value={x.hostId}>
                  {x.code} · {x.name} · {fmtNumber(x.score)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          className="pbs-sc-seg"
          role="radiogroup"
          aria-label="Jenis transaksi"
        >
          <button
            type="button"
            role="radio"
            aria-checked={type === "REWARD"}
            className={type === "REWARD" ? "on ok" : ""}
            onClick={() => pickType("REWARD")}
            disabled={pending}
          >
            Reward · tambah
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={type === "PENALTY"}
            className={type === "PENALTY" ? "on bad" : ""}
            onClick={() => pickType("PENALTY")}
            disabled={pending}
          >
            Penalty · kurangi
          </button>
        </div>

        {rules.length === 0 ? (
          <InfoBanner tone="warn">
            <span className="pbs-mono">RulesJson</span> kosong: tidak ada rule
            aktif yang bisa dipilih. Setiap transaksi harus memakai rule.
          </InfoBanner>
        ) : null}

        {categories.length > 0 ? (
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-sc-cat">
              Kategori
            </label>
            <select
              id="pbs-sc-cat"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setRuleId("");
                setPointText("");
              }}
              disabled={pending}
            >
              <option value="">Semua kategori</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="pbs-field">
          <label className="pbs-label" htmlFor="pbs-sc-rule">
            Rule
          </label>
          <select
            id="pbs-sc-rule"
            value={ruleId}
            onChange={(e) => pickRule(e.target.value)}
            disabled={pending || options.length === 0}
          >
            <option value="">
              {options.length ? "Pilih rule" : "Tidak ada rule untuk jenis ini"}
            </option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.name}
              </option>
            ))}
          </select>
          <div className="pbs-sc-hint">
            {rule
              ? [
                  rule.severity ? `Severity: ${rule.severity}` : "",
                  `poin default ${signed(rule.point)}`,
                  rule.description,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Hanya rule aktif yang tampil. Rule menentukan poin default dan severity."}
          </div>
        </div>

        <div className="pbs-sc-row2">
          <div className="pbs-field">
            <label className="pbs-label" htmlFor="pbs-sc-pt">
              Poin
            </label>
            <input
              id="pbs-sc-pt"
              type="text"
              inputMode="numeric"
              className={`pbs-sc-pt ${type === "PENALTY" ? "bad" : "ok"}`}
              value={pointText}
              onChange={(e) => setPointText(e.target.value)}
              onBlur={() =>
                point !== null && setPointText(signed(point).replace("−", "-"))
              }
              placeholder={type === "PENALTY" ? "-5" : "+2"}
              disabled={pending || !rule}
            />
          </div>
          <div>
            <span className="pbs-label">Pratinjau skor</span>
            <PreviewBox p={preview} />
          </div>
        </div>

        {override && rule ? (
          <div className="pbs-sc-box warn">
            <div className="pbs-sc-box-h">
              <Icon name="info" size={15} />
              <b>Poin diubah dari default rule ({signed(rule.point)})</b>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="pbs-link"
                onClick={() => pickRule(rule.id)}
                disabled={pending}
              >
                Kembalikan
              </button>
            </div>
            <label className="pbs-label" htmlFor="pbs-sc-ovr">
              Alasan override · wajib
            </label>
            <input
              id="pbs-sc-ovr"
              type="text"
              className="pbs-sc-input"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              disabled={pending}
              placeholder="Mis. menggantikan dua sesi sekaligus"
            />
          </div>
        ) : null}

        {ack1 && preview.after !== null ? (
          <div className="pbs-sc-box bad" role="alert">
            <div className="pbs-sc-box-h">
              <Icon name="alert" size={15} />
              <span>
                Skor turun {fmtNumber(preview.before)} →{" "}
                {fmtNumber(preview.after)},{" "}
                {preview.bandMove < 0 ? (
                  <>
                    turun ke band <b>{preview.bandAfter?.label ?? "—"}</b>.
                  </>
                ) : (
                  <>
                    tetap di band <b>{preview.bandAfter?.label ?? "—"}</b>.
                  </>
                )}
                {Number.isFinite(minSchedule) && preview.after < minSchedule
                  ? ` Di bawah ${fmtNumber(minSchedule)}, host tidak bisa dijadwalkan sampai skornya naik.`
                  : ""}
              </span>
            </div>
            <label className="pbs-sc-ack">
              <input
                type="checkbox"
                className="pbs-check"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                disabled={pending}
              />
              <b>Saya sudah memberi tahu host dan atasannya</b>
            </label>
          </div>
        ) : null}

        <div>
          <label className="pbs-label" htmlFor="pbs-sc-notes">
            Catatan
            {rule?.severity === "berat" ? " · wajib untuk severity berat" : ""}
          </label>
          <textarea
            id="pbs-sc-notes"
            className="pbs-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending}
            placeholder="Tulis kejadiannya, tanggal, dan sesi yang terdampak…"
          />
        </div>
        <div className="pbs-sc-hint">
          Transaksi ini masuk ledger atas nama {props.ctx.userName || "Anda"}{" "}
          dan tidak bisa disunting setelah tersimpan — hanya bisa dibatalkan.
          Catatan tampil juga di aplikasi host.
        </div>
        <SaveError action={action} name="ADD_SCORE" />
      </div>
      <div className="pbs-modal-f">
        {missingText ? (
          <span className="pbs-muted pbs-sc-miss">{missingText}</span>
        ) : null}
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Batal
        </Button>
        <Button onClick={submit} disabled={missing.length > 0 || pending}>
          {pending ? (
            <>
              <Spinner small /> Menyimpan…
            </>
          ) : (
            "Simpan transaksi"
          )}
        </Button>
      </div>
    </Overlay>
  );
}

function VoidModal(props: {
  host: HostModel;
  tx: ScoreTx;
  bands: ScoreBand[];
  now: Date;
  action: UseActionResult;
  onClose: () => void;
}): React.ReactElement {
  const { host: h, tx: t, action } = props;
  const [reason, setReason] = React.useState("");
  const pending = action.pending?.action === "VOID_SCORE";
  const back = t.point === null ? null : -t.point;
  const preview = previewScore(h, back, props.bands);
  const ok = reason.trim().length >= 5 && preview.after !== null;
  const bandText =
    preview.bandMove > 0
      ? `naik ke ${preview.bandAfter?.label}`
      : preview.bandMove < 0
        ? `turun ke ${preview.bandAfter?.label}`
        : preview.bandAfter
          ? `tetap ${preview.bandAfter.label}`
          : "";
  const submit = () => {
    if (!ok || pending || back === null) return;
    action.dispatch("VOID_SCORE", {
      hostId: h.hostId,
      hostItemId: h.id,
      txItemId: t.id,
      transactionId: t.txId,
      reversalId: newTransactionId(props.now),
      ruleId: "VOID",
      ruleName: VOID_REASON,
      transactionType: back >= 0 ? "Reward" : "Penalty",
      point: back,
      originalPoint: t.point,
      reason: reason.trim(),
      notesText: reversalNote(t.txId || `#${t.id}`, reason),
      expectedScore: h.score,
      scoreBefore: preview.before,
      scoreAfter: preview.after,
    });
  };
  return (
    <Overlay onClose={props.onClose} busy={pending} labelledBy="pbs-sc-void">
      <div className="pbs-modal-h">
        <div>
          <h2 id="pbs-sc-void">Batalkan transaksi</h2>
          <div className="pbs-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {[
              t.txId,
              t.rule,
              `${signed(t.point)} poin`,
              fmtDateTimeShort(t.when),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          className="pbs-x"
          onClick={props.onClose}
          disabled={pending}
          aria-label="Tutup"
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="pbs-modal-b">
        <InfoBanner>
          Transaksi tidak dihapus. Pembatalan masuk ledger sebagai baris baru{" "}
          <b>{signed(back)} poin</b>, dan baris aslinya ditandai Dibatalkan.
        </InfoBanner>
        <div className="pbs-sc-void">
          <div>
            <span className="l">Skor sekarang</span>
            <b className="pbs-num">{fmtNumber(preview.before)}</b>
          </div>
          <Icon
            name="arrowLeft"
            size={16}
            style={{ transform: "rotate(180deg)" }}
          />
          <div>
            <span className="l">Setelah dibatalkan</span>
            <b
              className={`pbs-num ${preview.bandAfter ? BAND_TEXT[preview.bandAfter.tone] : ""}`}
            >
              {fmtNumber(preview.after)}
            </b>
          </div>
          <span style={{ flex: 1 }} />
          {bandText ? (
            <Badge
              tone={
                preview.bandMove < 0
                  ? "danger"
                  : (preview.bandAfter?.tone ?? "neutral")
              }
              small
            >
              {bandText}
            </Badge>
          ) : null}
        </div>
        {preview.clamped ? (
          <div className="pbs-sc-hint">
            Skor dibatasi min/maks host, jadi perubahannya{" "}
            {signed(preview.moved)}, bukan {signed(back)}.
          </div>
        ) : null}
        <div>
          <label className="pbs-label" htmlFor="pbs-sc-vr">
            Alasan pembatalan · wajib
          </label>
          <textarea
            id="pbs-sc-vr"
            className="pbs-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            placeholder="Mis. report sebenarnya terkirim tepat waktu, upload gagal karena gangguan"
          />
          <div className="pbs-sc-hint">
            Alasan ini tampil di ledger host dan di aplikasi host, jadi tulis
            yang bisa dibaca host.
          </div>
        </div>
        <SaveError action={action} name="VOID_SCORE" />
      </div>
      <div className="pbs-modal-f">
        <Button variant="ghost" onClick={props.onClose} disabled={pending}>
          Tutup
        </Button>
        <Button
          onClick={submit}
          disabled={!ok || pending}
          title={!ok ? "Isi alasan minimal 5 karakter" : undefined}
        >
          {pending ? (
            <>
              <Spinner small /> Menyimpan…
            </>
          ) : (
            "Batalkan transaksi"
          )}
        </Button>
      </div>
    </Overlay>
  );
}
