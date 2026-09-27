import { Row, bool, num, str } from "./data";
import { ScoreBand, ScoreTx, TxType } from "./host";
import { Period, inPeriod } from "./payroll";

/**
 * Host app H-7 Skor saya: what the signed-in host sees of their own credit score.
 * Reads the same rows as Ops HostDetail (`HostScoreTransactions`, `HostScoreThreshold`),
 * without the drift check: a host cannot fix a stored score, so it is not shown to them.
 */

export type TxFilter = "All" | "Reward" | "Penalty" | "Void";

export const TX_FILTERS: { key: TxFilter; label: string }[] = [
  { key: "All", label: "Semua" },
  { key: "Reward", label: "Reward" },
  { key: "Penalty", label: "Penalty" },
  { key: "Void", label: "Dibatalkan" },
];

export function matchesFilter(t: ScoreTx, f: TxFilter): boolean {
  if (f === "All") return true;
  if (f === "Void") return !t.active && !t.reversal;
  return t.active && (f === "Reward" ? t.type === "REWARD" : t.type === "PENALTY");
}

/** null = every month. */
export const txInPeriod = (t: ScoreTx, period: Period | null): boolean => period === null || inPeriod(t.when, period);

export interface ScoreSummary {
  reward: number;
  rewardCount: number;
  penalty: number;
  penaltyCount: number;
  net: number;
  voidCount: number;
}

/** Active rows only; a voided transaction never moved the score. */
export function summarize(txs: ScoreTx[]): ScoreSummary {
  const s: ScoreSummary = { reward: 0, rewardCount: 0, penalty: 0, penaltyCount: 0, net: 0, voidCount: 0 };
  for (const t of txs) {
    if (t.reversal) continue;
    if (!t.active) {
      s.voidCount++;
      continue;
    }
    const p = t.point ?? 0;
    if (t.type === "PENALTY" || p < 0) {
      s.penalty += p;
      s.penaltyCount++;
    } else {
      s.reward += p;
      s.rewardCount++;
    }
    s.net += p;
  }
  return s;
}

export interface NextBand {
  band: ScoreBand;
  /** Points still needed to reach band.min. */
  gap: number;
}

/** The lowest band that starts above the score. null at the top level or without bands. */
export function nextBand(score: number | null, bands: ScoreBand[]): NextBand | null {
  if (score === null) return null;
  const up = bands.filter((b) => b.min !== null && b.min > score).sort((a, b) => (a.min ?? 0) - (b.min ?? 0))[0];
  return up && up.min !== null ? { band: up, gap: up.min - score } : null;
}

/** Points the score can drop before it leaves the current band (null without a lower bound). */
export function marginBelow(score: number | null, band: ScoreBand | null): number | null {
  if (score === null || !band || band.min === null) return null;
  return score - band.min;
}

export interface ScorePoint {
  when: Date;
  score: number;
}

/**
 * Score after each active transaction, oldest first. The row's ScoreAfter is used when set;
 * otherwise the series is rebuilt backwards from the current score.
 */
export function scoreSeries(txs: ScoreTx[], current: number | null): ScorePoint[] {
  const active = txs.filter((t) => t.active && t.when).sort((a, b) => (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0));
  if (active.length === 0) return [];
  const out: ScorePoint[] = new Array(active.length);
  let after = current;
  for (let i = active.length - 1; i >= 0; i--) {
    const t = active[i];
    if (!t || !t.when) continue;
    const v = t.after ?? after;
    if (v === null) return [];
    out[i] = { when: t.when, score: v };
    after = t.before ?? v - (t.point ?? 0);
  }
  return out;
}

export interface ScoreRule {
  id: string;
  name: string;
  type: TxType;
  point: number | null;
  description: string;
  /** Active transactions of this rule for the host. */
  count: number;
}

const ruleType = (text: string, point: number | null): TxType =>
  /reward|bonus|tambah|plus|positif/i.test(text) ? "REWARD" : /penalt|potong|kurang|minus|negatif/i.test(text) ? "PENALTY" : point === null ? "OTHER" : point >= 0 ? "REWARD" : "PENALTY";

/**
 * The rules a host can earn or lose points by. RulesJson when canvas sends it, else the
 * distinct rules found in the host transactions. Rewards first, biggest points first.
 */
export function scoreRules(rules: Row[], txs: ScoreTx[]): ScoreRule[] {
  const counts = new Map<string, number>();
  const key = (id: string, name: string) => (id || name).toLowerCase();
  for (const t of txs) if (t.active) counts.set(key(t.ruleId, t.rule), (counts.get(key(t.ruleId, t.rule)) ?? 0) + 1);

  let list: ScoreRule[];
  if (rules.length > 0) {
    list = rules
      .filter((r) => bool(r, "Active") !== false)
      .map((r) => {
        const id = str(r, "RuleID", "Title");
        const name = str(r, "RuleName", "Name", "Reason") || id;
        const raw = num(r, "Point", "Points", "DefaultPoint");
        const type = ruleType(str(r, "RuleType", "TransactionType", "Type"), raw);
        // A rule list may keep penalties as positive numbers; the sign follows the type.
        const point = raw === null ? null : type === "PENALTY" ? -Math.abs(raw) : type === "REWARD" ? Math.abs(raw) : raw;
        return { id, name, type, point, description: str(r, "Description", "Deskripsi"), count: counts.get(key(id, name)) ?? counts.get(name.toLowerCase()) ?? 0 };
      });
  } else {
    const seen = new Map<string, ScoreRule>();
    for (const t of txs) {
      const k = key(t.ruleId, t.rule);
      if (!k || t.rule === "—" || seen.has(k)) continue;
      seen.set(k, { id: t.ruleId, name: t.rule, type: t.type, point: t.point, description: "", count: counts.get(k) ?? 0 });
    }
    list = [...seen.values()];
  }
  const order = (r: ScoreRule) => (r.type === "REWARD" ? 0 : r.type === "PENALTY" ? 1 : 2);
  return list.filter((r) => r.name !== "").sort((a, b) => order(a) - order(b) || Math.abs(b.point ?? 0) - Math.abs(a.point ?? 0) || a.name.localeCompare(b.name));
}
