import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row, date, nameIndex, rowId, str } from "../../../shared/data";
import { fmtDayMonth, fmtNumber, fmtRupiah } from "../../../shared/format";
import { hostReportBadge } from "../../../shared/hostApp";
import { liveWindow } from "../../../shared/reportItems";
import { Period, addMonths, fmtPeriod, inPeriod, parsePeriod, periodKey, periodOf } from "../../../shared/payroll";
import { ALL_METRICS, ReviewState, readMetric, reviewState } from "../../../shared/reconcile";
import { Badge, Button, EmptyState, EndOfData, Icon, ResultBanner, Skeleton, Spinner } from "../../../shared/ui";

export interface MyReportsProps {
  ctx: ModuleContext;
  period: string;
  defaultFilter: string;
  reports: Row[];
  schedules: Row[];
  clockIns: Row[];
  absences: Row[];
  brands: Row[];
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

type Filter = "All" | "Revision" | "Waiting" | "Done" | "Auto" | "LiveBreak";

const FILTERS: { key: Filter; label: string; states?: ReviewState[] }[] = [
  { key: "All", label: "Semua" },
  { key: "Revision", label: "Perlu revisi", states: ["REVISION"] },
  { key: "Waiting", label: "Menunggu review", states: ["WAITING"] },
  { key: "Done", label: "Selesai", states: ["DONE_MANUAL"] },
  { key: "Auto", label: "Otomatis disetujui", states: ["DONE_AUTO"] },
  { key: "LiveBreak", label: "Live break", states: ["LIVE_BREAK"] },
];

/** One row of the list: a Report row, with its Schedule looked up by ScheduleID for the session time. */
interface Item {
  key: string;
  day: Date | null;
  brand: string;
  platform: string;
  sales: number | null;
  state: ReviewState;
  report: Row;
  schedule: Row | undefined;
}

const penjualan = ALL_METRICS.find((d) => d.key === "Penjualan");

export function MyReportsView(props: MyReportsProps): React.ReactElement {
  const { now, action } = props;
  const period: Period = parsePeriod(props.period) ?? periodOf(now);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(periodOf(now), -i));
  if (!months.some((m) => periodKey(m) === periodKey(period))) months.push(period);

  const initial = (FILTERS.find((f) => f.key === props.defaultFilter)?.key ?? "All") as Filter;
  const [filter, setFilter] = React.useState<Filter>(initial);
  React.useEffect(() => setFilter(initial), [initial]);

  const brands = React.useMemo(() => nameIndex(props.brands, ["NamaBrand", "BrandName"]), [props.brands]);
  const items = React.useMemo((): Item[] => {
    const bySchedule = new Map<string, Row>();
    for (const x of props.schedules) {
      const t = str(x, "Title").toLowerCase();
      if (t && !bySchedule.has(t)) bySchedule.set(t, x);
    }
    return props.reports
      .filter((r) => {
        const d = date(r, "LiveDate");
        return !d || inPeriod(d, period);
      })
      .map((r) => {
        const schedule = bySchedule.get(str(r, "ScheduleID").toLowerCase());
        const brandId = str(r, "BrandID") || str(schedule, "BrandID");
        return {
          key: `r-${rowId(r) || str(r, "Title")}`,
          day: date(r, "LiveDate") ?? date(schedule, "Date"),
          brand: brands.get(brandId) ?? (str(r, "BrandName") || brandId || "—"),
          platform: str(r, "Platform") || str(schedule, "Platform"),
          sales: penjualan ? readMetric(r, penjualan) : null,
          state: reviewState(r),
          report: r,
          schedule,
        };
      })
      .sort((a, b) => (b.day?.getTime() ?? 0) - (a.day?.getTime() ?? 0));
  }, [props.schedules, props.reports, brands, period]);

  const count = (f: (typeof FILTERS)[number]) => (f.key === "All" ? items.length : items.filter((i) => f.states?.includes(i.state)).length);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = !active || active.key === "All" ? items : items.filter((i) => active.states?.includes(i.state));
  // Every loaded row is rendered: a partial list was read as the whole total.
  const visible = filtered;
  const revision = items.filter((i) => i.state === "REVISION").length;

  const choose = (f: Filter) => {
    setFilter(f);
    action.fire("FILTER_CHANGED", { filter: f, period: periodKey(period) });
  };
  const open = (i: Item) => action.fire("OPEN_REPORT", { reportId: rowId(i.report), title: str(i.report, "Title"), scheduleId: str(i.report, "ScheduleID") });

  const firstLoad = props.loading && items.length === 0;

  return (
    <div className="hc-col">
      <div className="hc-hi">
        <div>
          <h1>Report saya</h1>
          <p>
            {firstLoad
              ? "Memuat report…"
              : `${fmtNumber(items.length)}${props.hasMore ? "+" : ""} report pada ${fmtPeriod(period)}${revision ? ` · ${revision} perlu revisi` : ""}`}
          </p>
        </div>
        <label className="pbs-chip">
          <span className="pbs-sr">Bulan</span>
          <select
            aria-label="Bulan"
            value={periodKey(period)}
            onChange={(e) => {
              action.fire("PERIOD_CHANGED", { period: e.target.value });
            }}
          >
            {months.map((m) => (
              <option key={periodKey(m)} value={periodKey(m)}>
                {fmtPeriod(m)}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </div>

      <ResultBanner result={action.lastResult} onClose={action.clearResult} />

      <div className="hc-chips" role="tablist" aria-label="Status">
        {FILTERS.map((f) => {
          const n = count(f);
          if (f.key === "LiveBreak" && n === 0 && filter !== "LiveBreak") return null;
          return (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`hc-chip${filter === f.key ? " on" : ""}`} onClick={() => choose(f.key)}>
              {f.label} <span className="n">{firstLoad ? "" : fmtNumber(n)}</span>
            </button>
          );
        })}
      </div>

      <div className="hc-list" aria-busy={props.loading}>
        <div className="hc-row head">
          <span>Tanggal</span>
          <span>Brand &amp; platform</span>
          <span className="r hide-s">Penjualan</span>
          <span className="hide-s">Status</span>
          <span className="hide-s" aria-label="Aksi" />
        </div>
        {firstLoad
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="hc-row">
                <Skeleton w={40} />
                <Skeleton w="60%" />
                <Skeleton w={80} />
                <Skeleton w={90} />
                <Skeleton w={30} />
              </div>
            ))
          : visible.map((i) => <ReportRow key={i.key} i={i} onOpen={() => open(i)} />)}
      </div>

      {firstLoad ? null : filtered.length === 0 ? (
        <EmptyState
          icon={filter === "All" ? "inbox" : "filterX"}
          good={filter === "Revision"}
          title={filter === "All" ? `Belum ada report di ${fmtPeriod(period)}` : filter === "Revision" ? "Tidak ada report yang perlu revisi" : `Tidak ada report “${active?.label ?? ""}”`}
          text={filter === "All" ? "Report yang kamu kirim setelah sesi live akan muncul di sini." : `${fmtNumber(items.length)} report lain di bulan ini ada di tab Semua.`}
          action={
            filter !== "All" ? (
              <Button variant="secondary" size="sm" onClick={() => choose("All")}>
                Lihat semua
              </Button>
            ) : undefined
          }
        />
      ) : props.hasMore ? (
        <div className="pbs-foot">
          <span>
            Total {fmtNumber(filtered.length)} report dimuat · masih ada data lain di server
          </span>
          <span className="line" />
          <Button
            variant="secondary"
            size="sm"
            disabled={props.loading}
            onClick={() => action.fire("LOAD_MORE", { period: periodKey(period), loaded: props.reports.length })}
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
        <EndOfData text={`Total ${fmtNumber(filtered.length)} report pada ${fmtPeriod(period)}`} />
      )}
    </div>
  );
}

function ReportRow(props: { i: Item; onOpen: () => void }): React.ReactElement {
  const { i } = props;
  const st = hostReportBadge(i.report, i.state);
  const time = liveWindow(i.schedule, i.report);
  const playbook = str(i.report, "Playbook").trim();
  return (
    <div className={`hc-row${i.state === "REVISION" ? " bad" : ""}`}>
      <span className="pbs-num">{fmtDayMonth(i.day)}</span>
      <span style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 600 }}>{i.brand}</b>
        {i.platform ? <span className="pbs-muted"> · {i.platform}</span> : null}
        <span className="pbs-muted" style={{ display: "block", fontSize: 11.5 }}>
          {[str(i.report, "Title"), str(i.report, "ScheduleID"), time].filter(Boolean).map((t, n) => (
            <React.Fragment key={n}>
              {n ? " · " : ""}
              <span style={{ whiteSpace: "nowrap" }}>{t}</span>
            </React.Fragment>
          ))}
        </span>
        {playbook ? (
          <span className="pbs-muted" style={{ display: "block", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={playbook}>
            Playbook: {playbook}
          </span>
        ) : null}
      </span>
      <span className="r pbs-num hide-s">{i.sales === null ? <span className="pbs-muted">—</span> : fmtRupiah(i.sales)}</span>
      <span>
        <Badge tone={st.tone} title={st.label}>
          {str(i.report, "ApprovalStatus") || "Belum ada status"}
        </Badge>
      </span>
      <span className="r">
        <button type="button" className="pbs-link" onClick={props.onOpen}>
          {i.state === "REVISION" ? "Perbaiki" : "Buka"}
        </button>
      </span>
    </div>
  );
}
