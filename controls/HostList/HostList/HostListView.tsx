import * as React from "react";
import { ModuleContext, UseActionResult, configNumber, hasPermission } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { fmtDateShort, fmtNumber } from "../../../shared/format";
import { ClockInModal } from "../../../shared/clockIn";
import { HOST_STATUS, HostModel, HostStatus, buildHosts, parseBands, scoreDefaults } from "../../../shared/host";
import { Badge, Button, EmptyState, EndOfData, FilterSelect, Icon, InfoBanner, ModuleHeader, ResultBanner, SkeletonRows, Spinner } from "../../../shared/ui";

export interface HostListProps {
  ctx: ModuleContext;
  hosts: Row[];
  thresholds: Row[];
  schedules: Row[];
  clockIns: Row[];
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

interface Filters {
  q: string;
  status: string;
  pkg: string;
  band: string;
  bank: string;
}

const NO_FILTERS: Filters = { q: "", status: "", pkg: "", band: "", bank: "" };

type SortKey = "code" | "name" | "scoreDesc" | "scoreAsc" | "joined";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "code", label: "Urut: kode host" },
  { value: "name", label: "Urut: nama" },
  { value: "scoreDesc", label: "Urut: skor tertinggi" },
  { value: "scoreAsc", label: "Urut: skor terendah" },
  { value: "joined", label: "Urut: terbaru bergabung" },
];

const STATUS_OPTIONS = (["ACTIVE", "INACTIVE", "UNKNOWN"] as HostStatus[]).map((s) => ({ value: s, label: HOST_STATUS[s].label }));
const BANK_OPTIONS = [
  { value: "missing", label: "Data bank belum lengkap" },
  { value: "ok", label: "Data bank lengkap" },
];

const sorter = (k: SortKey) => (a: HostModel, b: HostModel): number => {
  switch (k) {
    case "name":
      return a.name.localeCompare(b.name);
    case "scoreDesc":
      return (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.code.localeCompare(b.code);
    case "scoreAsc":
      return (a.score ?? Infinity) - (b.score ?? Infinity) || a.code.localeCompare(b.code);
    case "joined":
      return (b.joined?.getTime() ?? 0) - (a.joined?.getTime() ?? 0);
    default:
      return a.code.localeCompare(b.code, undefined, { numeric: true });
  }
};

export function HostListView(props: HostListProps): React.ReactElement {
  const { ctx, action } = props;
  const pageSize = Math.max(10, configNumber(ctx, "pageSize", 50));
  const bands = React.useMemo(() => parseBands(props.thresholds), [props.thresholds]);
  const defaults = React.useMemo(() => scoreDefaults(ctx.config), [ctx]);
  const hosts = React.useMemo(() => buildHosts(props.hosts, bands, defaults), [props.hosts, bands, defaults]);

  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [sort, setSort] = React.useState<SortKey>("code");
  const [shown, setShown] = React.useState(pageSize);
  const filterActive = Object.values(filters).some((v) => v !== "");

  const apply = (next: Filters) => {
    setFilters(next);
    setShown(pageSize);
    // Informational: canvas may re-query server-side. Never locks the control.
    action.fire("FILTER_CHANGED", { filters: next, sort });
  };
  const setFilter = (k: keyof Filters, v: string) => apply({ ...filters, [k]: v });

  const q = filters.q.trim().toLowerCase();
  const filtered = hosts
    .filter((h) => {
      if (q && ![h.code, h.hostId, h.name, h.email].some((s) => s.toLowerCase().includes(q))) return false;
      if (filters.status && h.status !== filters.status) return false;
      if (filters.pkg && h.pkg !== filters.pkg) return false;
      if (filters.band === "none" ? h.band !== null : filters.band && h.band?.id !== filters.band) return false;
      if (filters.bank === "missing" && h.hasBank !== false) return false;
      if (filters.bank === "ok" && h.hasBank !== true) return false;
      return true;
    })
    .sort(sorter(sort));
  const visible = filtered.slice(0, shown);
  const localMore = filtered.length > shown;

  const active = hosts.filter((h) => h.status === "ACTIVE").length;
  const noBank = hosts.filter((h) => h.hasBank === false);
  const noBankActive = noBank.filter((h) => h.status === "ACTIVE").length;
  const drifted = hosts.filter((h) => h.drift).length;
  const leaked = [...new Set(hosts.flatMap((h) => h.sensitiveKeys))];

  const pkgOptions = [...new Set(hosts.map((h) => h.pkg).filter(Boolean))].sort().map((p) => ({ value: p, label: p }));
  const bandOptions = bands.map((b) => ({ value: b.id, label: b.label })).concat(hosts.some((h) => h.band === null) ? [{ value: "none", label: "Tanpa band" }] : []);
  const canEdit = hasPermission(ctx, "HOST_EDIT");
  const canClockIn = hasPermission(ctx, "HOST_CLOCKIN");
  const [clockInFor, setClockInFor] = React.useState<HostModel | null>(null);
  React.useEffect(() => {
    if (action.lastResult?.action === "ADD_CLOCK_IN" && action.lastResult.status === "ok") setClockInFor(null);
  }, [action.lastResult]);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const openClockIn = (h: HostModel) => {
    if (action.lastResult?.action === "ADD_CLOCK_IN") action.clearResult();
    setClockInFor(h);
  };
  // Errors of the popup stay in the popup.
  const bannerResult = clockInFor && action.lastResult?.action === "ADD_CLOCK_IN" ? null : action.lastResult;
  const firstLoad = props.loading && hosts.length === 0;

  return (
    <div className="pbs-page pbs-host" ref={hostRef}>
      <ModuleHeader
        crumb="Master data"
        title="Host"
        subtitle={
          firstLoad
            ? "Memuat host…"
            : `${fmtNumber(hosts.length)}${props.hasMore ? "+" : ""} host · ${fmtNumber(active)} aktif${noBank.length ? ` · ${fmtNumber(noBank.length)} tanpa data bank` : ""}`
        }
        actions={
          canEdit ? (
            <Button onClick={() => action.fire("ADD_HOST", {})}>
              <Icon name="plus" size={15} /> Tambah host
            </Button>
          ) : undefined
        }
      />

      <ResultBanner result={bannerResult} okText={bannerResult?.action === "ADD_CLOCK_IN" ? "Clock in tersimpan." : undefined} onClose={action.clearResult} />

      {leaked.length > 0 ? (
        <InfoBanner tone="err" icon="lock">
          HostsJson memuat kolom sensitif (<span className="pbs-mono">{leaked.join(", ")}</span>). Kolom itu tidak ditampilkan, tapi tetap ikut terkirim ke
          perangkat. Hapus dari ShowColumns/ForAll di canvas; kirim <span className="pbs-mono">HasRekening</span> saja.
        </InfoBanner>
      ) : null}

      {noBankActive > 0 ? (
        <InfoBanner
          tone="warn"
          action={
            filters.bank !== "missing" ? (
              <Button variant="secondary" size="sm" onClick={() => apply({ ...filters, bank: "missing", status: "ACTIVE" })}>
                Tampilkan
              </Button>
            ) : undefined
          }
        >
          <b>{noBankActive} host aktif</b> belum punya data bank. Payroll periode berikutnya akan terblokir untuk host ini sampai No rekening dan Bank diisi.
        </InfoBanner>
      ) : null}

      {drifted > 0 ? (
        <InfoBanner tone="warn">
          <b>{drifted} host</b> punya skor tersimpan (<span className="pbs-mono">CurrentScore</span>) yang berbeda dari jumlah ledger. Buka host untuk melihat
          selisihnya; skor yang tampil tetap nilai tersimpan.
        </InfoBanner>
      ) : null}

      <div className="pbs-filters">
        <label className="pbs-search">
          <Icon name="search" size={14} />
          <input type="search" value={filters.q} placeholder="Cari kode, nama, email" aria-label="Cari host" onChange={(e) => setFilter("q", e.target.value)} />
        </label>
        <FilterSelect label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => setFilter("status", v)} />
        <FilterSelect label="Package" value={filters.pkg} options={pkgOptions} onChange={(v) => setFilter("pkg", v)} />
        <FilterSelect label="Band skor" value={filters.band} options={bandOptions} onChange={(v) => setFilter("band", v)} />
        <FilterSelect label="Data bank" value={filters.bank} options={BANK_OPTIONS} onChange={(v) => setFilter("bank", v)} />
        {filterActive ? (
          <button type="button" className="pbs-link" onClick={() => apply(NO_FILTERS)} style={{ marginLeft: 4 }}>
            Hapus filter
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <label className="pbs-chip">
          <span className="pbs-sr">Urutkan</span>
          <select value={sort} aria-label="Urutkan" onChange={(e) => setSort(e.target.value as SortKey)}>
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
          <table className="pbs-table" aria-busy={props.loading}>
            <thead>
              <tr>
                <th>HostCode</th>
                <th>Nama</th>
                <th>Package</th>
                <th>Status</th>
                <th>Skor</th>
                <th>Bergabung</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {firstLoad ? (
                <SkeletonRows rows={8} cols={7} />
              ) : (
                visible.map((h) => (
                  <HostRow
                    key={h.hostId}
                    h={h}
                    onOpen={() => action.fire("OPEN_HOST", { hostId: h.hostId, id: h.id })}
                    onClockIn={canClockIn ? () => openClockIn(h) : undefined}
                    busy={!!action.pending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {firstLoad ? null : filtered.length === 0 ? (
          filterActive ? (
            <EmptyState
              icon="filterX"
              title="Tidak ada host yang cocok dengan filter"
              text={`${fmtNumber(hosts.length)} host dimuat, tapi tidak ada yang lolos filter yang dipilih.`}
              action={
                <Button variant="secondary" size="sm" onClick={() => apply(NO_FILTERS)}>
                  Hapus filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="user"
              title="Belum ada host"
              text="Host yang didaftarkan di list Host - PBS Hub akan muncul di sini."
              action={canEdit ? <Button size="sm" onClick={() => action.fire("ADD_HOST", {})}>Tambah host</Button> : undefined}
            />
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
              onClick={() => (localMore ? setShown(shown + pageSize) : action.fire("LOAD_MORE", { loaded: hosts.length, filters, sort }))}
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
          <EndOfData text={`Semua ${fmtNumber(filtered.length)} host sudah ditampilkan`} />
        )}
      </div>

      {clockInFor ? (
        <ClockInModal
          ctx={ctx}
          hostId={clockInFor.hostId}
          hostCode={clockInFor.code}
          hostName={clockInFor.name}
          schedules={props.schedules}
          clockIns={props.clockIns}
          now={props.now}
          action={action}
          onClose={() => setClockInFor(null)}
        />
      ) : null}
    </div>
  );
}

const BAND_TEXT: Record<string, string> = { success: "pbs-t-ok", danger: "pbs-t-bad", warning: "pbs-t-warn", info: "pbs-t-info", neutral: "" };

function HostRow(props: { h: HostModel; onOpen: () => void; onClockIn?: () => void; busy: boolean }): React.ReactElement {
  const { h } = props;
  const st = HOST_STATUS[h.status];
  const noBankTip = "Data bank belum lengkap: transfer dan slip gaji gagal, dan preflight payroll memblokir host ini.";
  return (
    <tr className={h.status === "INACTIVE" ? "muted" : undefined}>
      <td className="pbs-num" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
        {h.code}
      </td>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <button type="button" className="pbs-link" style={{ fontSize: 13, color: "inherit" }} onClick={props.onOpen}>
            {h.name}
          </button>
          {h.hasBank === false ? (
            <span className="pbs-ic-btn" title={noBankTip} aria-label={noBankTip} role="img">
              <Icon name="alert" size={14} />
            </span>
          ) : null}
        </span>
        {h.email ? <div className="pbs-muted" style={{ fontSize: 11.5 }}>{h.email}</div> : null}
      </td>
      <td>{h.pkg || <span className="pbs-muted">—</span>}</td>
      <td>
        <Badge tone={st.tone} title={h.status === "UNKNOWN" && h.statusText ? `Status: ${h.statusText}` : undefined}>
          {st.label}
        </Badge>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {h.score === null ? (
          <span className="pbs-muted">—</span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <b className={`pbs-num ${h.band ? BAND_TEXT[h.band.tone] : ""}`} style={{ fontSize: 14 }}>
              {fmtNumber(h.score)}
            </b>
            {h.band ? (
              <Badge tone={h.band.tone} small>
                {h.band.label}
              </Badge>
            ) : null}
            {h.drift ? (
              <span className="pbs-ic-btn" role="img" title={`Skor tersimpan ${fmtNumber(h.storedScore)}, jumlah ledger ${fmtNumber(h.ledgerScore)}`} aria-label="Skor berbeda dari ledger">
                <Icon name="alert" size={13} />
              </span>
            ) : null}
          </span>
        )}
      </td>
      <td className="pbs-num" style={{ whiteSpace: "nowrap" }}>
        {fmtDateShort(h.joined)}
      </td>
      <td className="r">
        <span className="pbs-rowact">
          {props.onClockIn ? (
            <Button variant="ghost" size="sm" onClick={props.onClockIn} disabled={props.busy} title="Tambah clock in untuk jadwal yang terlewat">
              <Icon name="clock" size={14} /> Clock in
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={props.onOpen}>
            Buka
          </Button>
        </span>
      </td>
    </tr>
  );
}
