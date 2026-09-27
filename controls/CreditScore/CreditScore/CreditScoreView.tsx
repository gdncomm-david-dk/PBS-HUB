import * as React from "react";
import { ModuleContext, UseActionResult } from "../../../shared/contract";
import { Row } from "../../../shared/data";
import { fmtDayMonth, fmtNumber, fmtTime } from "../../../shared/format";
import { ScoreBand, ScoreTx, bandOf, buildHost, buildLedger, parseBands, scoreDefaults } from "../../../shared/host";
import { ScorePoint, ScoreRule, TX_FILTERS, TxFilter, marginBelow, matchesFilter, nextBand, scoreRules, scoreSeries, summarize, txInPeriod } from "../../../shared/hostScore";
import { Period, addMonths, fmtPeriod, inPeriod, parsePeriod, periodKey, periodOf } from "../../../shared/payroll";
import { BandChart } from "../../../shared/scoreUi";
import { Badge, Button, EmptyState, EndOfData, Icon, IconName, ResultBanner, Skeleton, Spinner, TONE_DOT } from "../../../shared/ui";

export interface CreditScoreProps {
  ctx: ModuleContext;
  host: Row[];
  txs: Row[];
  thresholds: Row[];
  rules: Row[];
  period: string;
  defaultFilter: string;
  hasMore: boolean;
  loading: boolean;
  now: Date;
  action: UseActionResult;
}

const BAND_TEXT: Record<string, string> = { success: "pbs-t-ok", danger: "pbs-t-bad", warning: "pbs-t-warn", info: "pbs-t-info", neutral: "" };
const ALL = "All";

const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmtNumber(Math.abs(n))}`);
const range = (b: ScoreBand) => (b.max === null ? `${fmtNumber(b.min)} ke atas` : b.min === null ? `sampai ${fmtNumber(b.max)}` : `${fmtNumber(b.min)}–${fmtNumber(b.max)}`);

/** "" → this month, "All" → every month, yyyy-mm → that month. */
function periodFrom(text: string, now: Date): Period | null {
  if (text.trim().toLowerCase() === "all") return null;
  return parsePeriod(text) ?? periodOf(now);
}

export function CreditScoreView(props: CreditScoreProps): React.ReactElement {
  const { ctx, now, action } = props;
  const bands = React.useMemo(() => parseBands(props.thresholds), [props.thresholds]);
  const defaults = React.useMemo(() => scoreDefaults(ctx.config), [ctx]);
  const hostRow = props.host[0];
  const h = React.useMemo(() => (hostRow ? buildHost(hostRow, bands, defaults) : null), [hostRow, bands, defaults]);
  const ledger = React.useMemo(() => buildLedger(props.txs), [props.txs]);
  const rules = React.useMemo(() => scoreRules(props.rules, ledger), [props.rules, ledger]);

  // Month and filter work on the rows already here; canvas only hears about them (it may reload).
  const [period, setPeriod] = React.useState<Period | null>(() => periodFrom(props.period, now));
  React.useEffect(() => setPeriod(periodFrom(props.period, now)), [props.period]);
  const initialFilter = (TX_FILTERS.find((f) => f.key === props.defaultFilter)?.key ?? "All") as TxFilter;
  const [filter, setFilter] = React.useState<TxFilter>(initialFilter);
  React.useEffect(() => setFilter(initialFilter), [initialFilter]);

  const thisMonth = periodOf(now);
  const months = React.useMemo(() => {
    const keys = new Set<string>();
    const list: Period[] = [];
    const add = (p: Period) => {
      if (!keys.has(periodKey(p))) {
        keys.add(periodKey(p));
        list.push(p);
      }
    };
    for (let i = 0; i < 6; i++) add(addMonths(thisMonth, -i));
    for (const t of ledger) if (t.when) add(periodOf(t.when));
    if (period) add(period);
    return list.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
  }, [ledger, period, thisMonth.year, thisMonth.month]);

  const inScope = ledger.filter((t) => txInPeriod(t, period));
  const sum = summarize(inScope);
  const monthNet = summarize(ledger.filter((t) => inPeriod(t.when, thisMonth))).net;
  const count = (f: TxFilter) => inScope.filter((t) => matchesFilter(t, f)).length;
  const visible = inScope.filter((t) => matchesFilter(t, filter));
  const scopeLabel = period ? fmtPeriod(period) : "semua waktu";

  const choosePeriod = (key: string) => {
    const p = key === ALL ? null : parsePeriod(key);
    setPeriod(p);
    action.fire("PERIOD_CHANGED", { period: p ? periodKey(p) : ALL });
  };
  const chooseFilter = (f: TxFilter) => {
    setFilter(f);
    action.fire("FILTER_CHANGED", { filter: f, period: period ? periodKey(period) : ALL });
  };

  const firstLoad = props.loading && !h && ledger.length === 0;
  const listLoading = props.loading && ledger.length === 0;

  return (
    <div className="hc-col">
      <div className="hc-hi">
        <div>
          <h1>Skor saya</h1>
          <p>
            {firstLoad
              ? "Memuat skor…"
              : h
                ? [h.name, h.code !== h.name ? h.code : "", h.pkg ? `Paket ${h.pkg}` : "", `${fmtNumber(ledger.filter((t) => t.active).length)}${props.hasMore ? "+" : ""} transaksi skor`].filter(Boolean).join(" · ")
                : "Data host belum terkirim ke layar ini."}
          </p>
        </div>
        <label className="pbs-chip">
          <span className="pbs-sr">Bulan</span>
          <select aria-label="Bulan" value={period ? periodKey(period) : ALL} onChange={(e) => choosePeriod(e.target.value)}>
            <option value={ALL}>Semua waktu</option>
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

      <div className="hc-split">
        <div className="hc-main">
          {firstLoad ? <HeroSkeleton /> : <Hero score={h?.score ?? null} min={h?.min ?? null} max={h?.max ?? null} bands={bands} ledger={ledger} monthNet={monthNet} />}

          <div className="hc-kpis" style={{ marginBottom: 0 }}>
            <SumCard icon="plus" tone="ok" label="Reward" value={sum.reward === 0 ? "0" : signed(sum.reward)} sub={`${fmtNumber(sum.rewardCount)} kali`} loading={listLoading} onClick={sum.rewardCount ? () => chooseFilter("Reward") : undefined} />
            <SumCard icon="alert" tone="bad" label="Penalty" value={sum.penalty === 0 ? "0" : signed(sum.penalty)} sub={`${fmtNumber(sum.penaltyCount)} kali`} loading={listLoading} onClick={sum.penaltyCount ? () => chooseFilter("Penalty") : undefined} />
            <SumCard icon="sparkle" tone="" label="Perubahan" value={sum.net === 0 ? "0" : signed(sum.net)} sub="bersih" loading={listLoading} />
            <SumCard icon="x" tone="warn" label="Dibatalkan" value={fmtNumber(sum.voidCount)} sub="transaksi" loading={listLoading} onClick={sum.voidCount ? () => chooseFilter("Void") : undefined} />
          </div>

          <div>
            <div className="hc-chips" role="tablist" aria-label="Jenis transaksi">
              {TX_FILTERS.map((f) => {
                const n = count(f.key);
                if (f.key === "Void" && n === 0 && filter !== "Void") return null;
                return (
                  <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`hc-chip${filter === f.key ? " on" : ""}`} onClick={() => chooseFilter(f.key)}>
                    {f.label} <span className="n">{listLoading ? "" : fmtNumber(n)}</span>
                  </button>
                );
              })}
            </div>

            <div className="hc-list" aria-busy={props.loading}>
              <div className="hc-row tx head">
                <span>Tanggal</span>
                <span>Alasan</span>
                <span className="r">Poin</span>
                <span className="r hide-s">Skor</span>
              </div>
              {listLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="hc-row tx">
                      <Skeleton w={40} />
                      <Skeleton w="60%" />
                      <Skeleton w={36} />
                      <Skeleton w={60} />
                    </div>
                  ))
                : visible.map((t) => <TxRow key={t.id || t.txId} t={t} />)}
            </div>

            {listLoading ? null : visible.length === 0 ? (
              <EmptyState
                icon={ledger.length === 0 ? "inbox" : "filterX"}
                good={filter === "Penalty"}
                title={
                  ledger.length === 0
                    ? "Belum ada transaksi skor"
                    : filter === "Penalty"
                      ? `Tidak ada penalty di ${scopeLabel}`
                      : filter === "All"
                        ? `Tidak ada transaksi di ${scopeLabel}`
                        : `Tidak ada transaksi “${TX_FILTERS.find((f) => f.key === filter)?.label ?? ""}” di ${scopeLabel}`
                }
                text={ledger.length === 0 ? "Skor kamu masih nilai awal. Reward dan penalty dari tim studio akan tercatat di sini." : `${fmtNumber(ledger.length)} transaksi lain ada di bulan lain atau tab Semua.`}
                action={
                  ledger.length > 0 && (filter !== "All" || period !== null) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFilter("All");
                        choosePeriod(ALL);
                      }}
                    >
                      Lihat semua
                    </Button>
                  ) : undefined
                }
              />
            ) : props.hasMore ? (
              <div className="pbs-foot">
                <span>{fmtNumber(ledger.length)} transaksi dimuat · masih ada data lama di server</span>
                <span className="line" />
                <Button variant="secondary" size="sm" disabled={props.loading} onClick={() => action.fire("LOAD_MORE", { loaded: props.txs.length })}>
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
              <EndOfData text={`Total ${fmtNumber(visible.length)} transaksi · ${scopeLabel}`} />
            )}
          </div>
        </div>

        <div className="hc-aside">
          <Levels bands={bands} score={h?.score ?? null} loading={firstLoad} />
          <Rules rules={rules} loading={listLoading} />
          <div className="hc-card hc-sc-note">
            <Icon name="info" size={16} />
            <p>
              Skor berubah setiap kali tim studio mencatat reward atau penalty. Transaksi yang dibatalkan tidak mengubah skor. Ada yang tidak sesuai? Hubungi PIC studio kamu.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero(props: { score: number | null; min: number | null; max: number | null; bands: ScoreBand[]; ledger: ScoreTx[]; monthNet: number }): React.ReactElement {
  const { score, bands } = props;
  const band = bandOf(score, bands);
  const next = nextBand(score, bands);
  const margin = marginBelow(score, band);
  const series = React.useMemo(() => scoreSeries(props.ledger, score), [props.ledger, score]);
  if (score === null) {
    return (
      <div className="hc-card">
        <EmptyState icon="info" title="Skor belum tersedia" text="Skor awal belum diatur untuk akun kamu. Hubungi PIC studio." />
      </div>
    );
  }
  return (
    <div className="hc-card hc-sc-hero">
      <div className="hc-sc-top">
        <div style={{ minWidth: 0 }}>
          <div className="pbs-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
            Skor kredit saat ini
          </div>
          <div className="hc-scorec-n">
            <span className={`pbs-num ${band ? BAND_TEXT[band.tone] : ""}`}>{fmtNumber(score)}</span>
            {band ? <Badge tone={band.tone}>{band.label}</Badge> : null}
          </div>
          {props.monthNet !== 0 ? (
            <div className={`hc-score-d ${props.monthNet > 0 ? "pbs-t-ok" : "pbs-t-bad"}`}>
              {props.monthNet > 0 ? "▲ +" : "▼ "}
              {fmtNumber(props.monthNet)} bulan ini
            </div>
          ) : (
            <div className="hc-score-d pbs-muted">Belum ada perubahan bulan ini</div>
          )}
          {band?.description ? <p className="hc-sc-desc">{band.description}</p> : null}
        </div>
        {series.length >= 2 ? <Spark points={series} /> : null}
      </div>
      <BandChart bands={bands} score={score} min={props.min} max={props.max} />
      <p className="hc-sc-next">
        {next ? (
          <>
            <b>{fmtNumber(next.gap)} poin lagi</b> ke level <b>{next.band.label}</b>.
          </>
        ) : band ? (
          <>
            Kamu di level tertinggi. <b>Pertahankan!</b>
          </>
        ) : (
          "Level skor belum diatur."
        )}
        {margin !== null && band && margin < 10 ? <span className="pbs-t-warn"> Turun {fmtNumber(margin + 1)} poin lagi, level kamu turun dari {band.label}.</span> : null}
      </p>
    </div>
  );
}

function HeroSkeleton(): React.ReactElement {
  return (
    <div className="hc-card">
      <Skeleton w={120} />
      <Skeleton w={140} h={44} style={{ marginTop: 10 }} />
      <Skeleton w="100%" h={8} style={{ marginTop: 22 }} />
    </div>
  );
}

/** Score after each transaction as a small line; the last point is the current score. */
function Spark(props: { points: ScorePoint[] }): React.ReactElement {
  const pts = props.points.slice(-20);
  const W = 220;
  const H = 64;
  const vals = pts.map((p) => p.score);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (pts.length === 1 ? W : (i / (pts.length - 1)) * (W - 8) + 4);
  const y = (v: number) => H - 6 - ((v - lo) / span) * (H - 12);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];
  return (
    <figure className="hc-spark" aria-label={`Tren skor: ${fmtNumber(first?.score)} ke ${fmtNumber(last?.score)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-hidden="true">
        <path d={d} fill="none" stroke="var(--p)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={x(pts.length - 1)} cy={y(last.score)} r={3.5} fill="var(--p)" /> : null}
      </svg>
      <figcaption>
        Tren {fmtNumber(pts.length)} transaksi terakhir{first ? ` · sejak ${fmtDayMonth(first.when)}` : ""}
      </figcaption>
    </figure>
  );
}

function TxRow(props: { t: ScoreTx }): React.ReactElement {
  const { t } = props;
  const up = (t.point ?? 0) >= 0;
  return (
    <div className={`hc-row tx${t.active || t.reversal ? "" : " void"}`}>
      <span className="pbs-num">
        {fmtDayMonth(t.when)}
        <span className="pbs-muted" style={{ display: "block", fontSize: 11.5 }}>
          {fmtTime(t.when)}
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <b className="hc-tx-r">{t.rule}</b>
        {t.reversal ? (
          <Badge tone="info" small title="Pembatalan transaksi lain; skor kembali seperti sebelum transaksi itu">
            Koreksi
          </Badge>
        ) : !t.active ? (
          <Badge tone="neutral" small title={t.statusText ? `Status: ${t.statusText}` : undefined}>
            Dibatalkan
          </Badge>
        ) : null}
        {t.notes ? <span className="hc-tx-n">{t.notes}</span> : null}
        <span className="pbs-muted" style={{ display: "block", fontSize: 11.5 }}>
          {[t.txId, t.by ? `oleh ${t.by}` : ""].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className={`r pbs-num hc-tx-p ${t.active || t.reversal ? (up ? "pbs-t-ok" : "pbs-t-bad") : ""}`}>{signed(t.point)}</span>
      <span className="r pbs-num hide-s">
        {(t.active || t.reversal) && t.after !== null ? (
          <>
            <span className="pbs-muted">{fmtNumber(t.before)} → </span>
            <b>{fmtNumber(t.after)}</b>
          </>
        ) : (
          <span className="pbs-muted">—</span>
        )}
      </span>
    </div>
  );
}

function Levels(props: { bands: ScoreBand[]; score: number | null; loading: boolean }): React.ReactElement | null {
  const current = bandOf(props.score, props.bands);
  if (!props.loading && props.bands.length === 0) return null;
  const list = [...props.bands].reverse();
  return (
    <div className="hc-card">
      <div className="pbs-sec">
        <span className="pbs-sec-l">Level skor</span>
      </div>
      {props.loading ? (
        <Skeleton w="100%" h={120} />
      ) : (
        <ul className="hc-lv">
          {list.map((b) => (
            <li key={b.id} className={current?.id === b.id ? "on" : undefined}>
              <i style={{ background: TONE_DOT[b.tone] }} />
              <div style={{ minWidth: 0 }}>
                <div className="t">
                  {b.label}
                  {current?.id === b.id ? <span className="hc-tag">Kamu di sini</span> : null}
                </div>
                {b.description ? <div className="x">{b.description}</div> : null}
              </div>
              <span className="pbs-num v">{range(b)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rules(props: { rules: ScoreRule[]; loading: boolean }): React.ReactElement | null {
  if (!props.loading && props.rules.length === 0) return null;
  const rewards = props.rules.filter((r) => r.type !== "PENALTY");
  const penalties = props.rules.filter((r) => r.type === "PENALTY");
  const block = (title: string, list: ScoreRule[]) =>
    list.length === 0 ? null : (
      <div>
        <div className="hc-rule-h">{title}</div>
        <ul className="hc-rule">
          {list.map((r) => (
            <li key={r.id || r.name}>
              <div style={{ minWidth: 0 }}>
                <div className="t">{r.name}</div>
                {r.description || r.count ? <div className="x">{[r.description, r.count ? `${fmtNumber(r.count)}× untuk kamu` : ""].filter(Boolean).join(" · ")}</div> : null}
              </div>
              <span className={`pbs-num v ${r.type === "PENALTY" ? "pbs-t-bad" : "pbs-t-ok"}`}>{signed(r.point)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="hc-card">
      <div className="pbs-sec">
        <span className="pbs-sec-l">Cara skor berubah</span>
      </div>
      {props.loading ? (
        <Skeleton w="100%" h={100} />
      ) : (
        <div className="hc-stack">
          {block("Menambah skor", rewards)}
          {block("Mengurangi skor", penalties)}
        </div>
      )}
    </div>
  );
}

function SumCard(props: { icon: IconName; tone: "" | "ok" | "warn" | "bad"; label: string; value: string; sub: string; loading: boolean; onClick?: () => void }): React.ReactElement {
  const body = (
    <>
      <span className={`hc-ic${props.tone ? ` ${props.tone}` : ""}`}>
        <Icon name={props.icon} size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="l">{props.label}</div>
        {props.loading ? (
          <Skeleton w={60} h={20} style={{ marginTop: 4 }} />
        ) : (
          <div className="v">
            {props.value}
            <small>{props.sub}</small>
          </div>
        )}
      </div>
    </>
  );
  return props.onClick ? (
    <button type="button" className="hc-kpi click" onClick={props.onClick}>
      {body}
    </button>
  ) : (
    <div className="hc-kpi">{body}</div>
  );
}
