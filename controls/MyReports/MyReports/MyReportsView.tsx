import * as React from "react";
import { ModuleContext, UseActionResult, configNumber } from "../../../shared/contract";
import { Row, date, nameIndex, rowId, str } from "../../../shared/data";
import { fmtDayMonth, fmtNumber, fmtRupiah } from "../../../shared/format";
import { HOST_REPORT_STATE, HostSession, buildHostSessions, hostOptions } from "../../../shared/hostApp";
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

type Filter = "All" | "Unsent" | "Revision" | "Waiting" | "Done" | "Auto";

const FILTERS: { key: Filter; label: string; states?: ReviewState[] }[] = [
  { key: "All", label: "Semua" },
  { key: "Unsent", label: "Belum dikirim" },
  { key: "Revision", label: "Perlu revisi", states: ["REVISION"] },
  { key: "Waiting", label: "Menunggu review", states: ["WAITING"] },
  { key: "Done", label: "Selesai", states: ["DONE_MANUAL"] },
  { key: "Auto", label: "Otomatis disetujui", states: ["DONE_AUTO"] },
];

interface Item {
  key: string;
  day: Date | null;
  brand: string;
  platform: string;
  sales: number | null;
  state: ReviewState | "UNSENT";
  late: boolean;
  report?: Row;
  session?: HostSession;
}

const penjualan = ALL_METRICS.find((d) => d.key === "Penjualan");

export function MyReportsView(props: MyReportsProps): React.ReactElement {
  const { ctx, now, action } = props;
  const opts = React.useMemo(() => hostOptions(ctx.config), [ctx]);
  const pageSize = Math.max(10, configNumber(ctx, "pageSize", 20));
  const period: Period = parsePeriod(props.period) ?? periodOf(now);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(periodOf(now), -i));
  if (!months.some((m) => periodKey(m) === periodKey(period))) months.push(period);

  const initial = (FILTERS.find((f) => f.key === props.defaultFilter)?.key ?? "All") as Filter;
  const [filter, setFilter] = React.useState<Filter>(initial);
  React.useEffect(() => setFilter(initial), [initial]);
  const [shown, setShown] = React.useState(pageSize);

  const brands = React.useMemo(() => nameIndex(props.brands, ["NamaBrand", "BrandName"]), [props.brands]);
  const items = React.useMemo((): Item[] => {
    const sessions = buildHostSessions({ schedules: props.schedules, clockIns: props.clockIns, absences: props.absences, reports: props.reports, brands: props.brands, studios: [] }, now, opts);
    const unsent: Item[] = sessions
      .filter((s) => s.phase === "NEEDS_REPORT" && inPeriod(s.day, period))
      .map((s) => ({ key: `s-${s.title}`, day: s.day, brand: s.brand, platform: s.platform, sales: null, state: "UNSENT", late: s.late, session: s }));
    const reps: Item[] = props.reports
      .filter((r) => {
        const d = date(r, "LiveDate");
        return !d || inPeriod(d, period);
      })
      .map((r) => ({
        key: `r-${rowId(r) || str(r, "Title")}`,
        day: date(r, "LiveDate"),
        brand: brands.get(str(r, "BrandID")) ?? (str(r, "BrandName") || str(r, "BrandID") || "—"),
        platform: str(r, "Platform"),
        sales: penjualan ? readMetric(r, penjualan) : null,
        state: reviewState(r),
        late: false,
        report: r,
      }));
    return [...unsent, ...reps].sort((a, b) => (b.day?.getTime() ?? 0) - (a.day?.getTime() ?? 0));
  }, [props.schedules, props.clockIns, props.absences, props.reports, props.brands, brands, now, opts, period]);

  const count = (f: (typeof FILTERS)[number]) => (f.key === "All" ? items.length : f.key === "Unsent" ? items.filter((i) => i.state === "UNSENT").length : items.filter((i) => f.states?.includes(i.state as ReviewState)).length);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = !active || active.key === "All" ? items : active.key === "Unsent" ? items.filter((i) => i.state === "UNSENT") : items.filter((i) => active.states?.includes(i.state as ReviewState));
  const visible = filtered.slice(0, shown);
  const localMore = filtered.length > shown;
  const reportCount = items.filter((i) => i.state !== "UNSENT").length;
  const revision = items.filter((i) => i.state === "REVISION").length;
  const unsent = items.filter((i) => i.state === "UNSENT").length;

  const choose = (f: Filter) => {
    setFilter(f);
    setShown(pageSize);
    action.fire("FILTER_CHANGED", { filter: f, period: periodKey(period) });
  };
  const open = (i: Item) =>
    i.report
      ? action.fire("OPEN_REPORT", { reportId: rowId(i.report), title: str(i.report, "Title"), scheduleId: str(i.report, "ScheduleID") })
      : i.session && action.fire("NEW_REPORT", { scheduleId: i.session.title, scheduleItemId: i.session.id, liveDate: i.session.dayKey });

  const firstLoad = props.loading && items.length === 0;

  return (
    <div className="hc-col">
      <div className="hc-hi">
        <div>
          <h1>Report saya</h1>
          <p>
            {firstLoad
              ? "Memuat report…"
              : `${fmtNumber(reportCount)}${props.hasMore ? "+" : ""} report pada ${fmtPeriod(period)}${revision ? ` · ${revision} perlu revisi` : ""}${unsent ? ` · ${unsent} belum dikirim` : ""}`}
          </p>
        </div>
        <label className="pbs-chip">
          <span className="pbs-sr">Bulan</span>
          <select
            aria-label="Bulan"
            value={periodKey(period)}
            onChange={(e) => {
              setShown(pageSize);
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
          if (f.key === "Unsent" && n === 0 && filter !== "Unsent") return null;
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
            onClick={() => (localMore ? setShown(shown + pageSize) : action.fire("LOAD_MORE", { period: periodKey(period), loaded: props.reports.length }))}
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
        <EndOfData text={`Semua ${fmtNumber(filtered.length)} report ${fmtPeriod(period)} sudah ditampilkan`} />
      )}
    </div>
  );
}

function ReportRow(props: { i: Item; onOpen: () => void }): React.ReactElement {
  const { i } = props;
  const st = i.state === "UNSENT" ? { label: i.late ? "Terlambat" : "Belum dikirim", tone: i.late ? ("danger" as const) : ("warning" as const) } : HOST_REPORT_STATE[i.state];
  const bad = i.state === "REVISION" || (i.state === "UNSENT" && i.late);
  return (
    <div className={`hc-row${bad ? " bad" : ""}`}>
      <span className="pbs-num">{fmtDayMonth(i.day)}</span>
      <span style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 600 }}>{i.brand}</b>
        {i.platform ? <span className="pbs-muted"> · {i.platform}</span> : null}
        <span className="pbs-muted" style={{ display: "block", fontSize: 11.5 }}>
          {i.report ? str(i.report, "Title") : i.session ? `${i.session.title} · ${i.session.startText}–${i.session.endText}` : ""}
        </span>
      </span>
      <span className="r pbs-num hide-s">{i.sales === null ? <span className="pbs-muted">—</span> : fmtRupiah(i.sales)}</span>
      <span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </span>
      <span className="r">
        <button type="button" className="pbs-link" onClick={props.onOpen}>
          {i.state === "UNSENT" ? "Kirim" : i.state === "REVISION" ? "Perbaiki" : "Buka"}
        </button>
      </span>
    </div>
  );
}
