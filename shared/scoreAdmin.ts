import { Row, bool, num, str } from "./data";
import { HostModel, ScoreBand, ScoreTx, TxType, bandOf, clamp } from "./host";

/**
 * Ops SL-1 / SL-2: managing credit score transactions (`[FAS STUDIO] HostScoreTransactions`).
 *
 * The ledger is append-only. A new transaction moves `Host.CurrentScore` by its points (clamped to the
 * host min/max). A wrong transaction is never edited: its row becomes `Void` and a `Reversal` row with
 * the opposite points is appended. Neither of the two counts in clamp(Initial + Σ Active), so the
 * ledger sum still equals the stored score.
 */

export type Severity = "ringan" | "sedang" | "berat" | "";

export interface AdminRule {
  id: string;
  name: string;
  type: TxType;
  /** Default points, signed (a penalty is negative). */
  point: number | null;
  category: string;
  severity: Severity;
  description: string;
}

export function severityOf(text: string): Severity {
  const t = text.trim().toLowerCase();
  if (/berat|high|major|severe|tinggi/.test(t)) return "berat";
  if (/sedang|medium|moderate/.test(t)) return "sedang";
  if (/ringan|low|minor|rendah/.test(t)) return "ringan";
  return "";
}

const typeOf = (text: string, point: number | null): TxType =>
  /reward|bonus|tambah|plus|positif|apresiasi|achievement|prestasi|appreciation/i.test(text) ? "REWARD" : /penalt|potong|kurang|minus|negatif|violation|pelanggaran|sanksi|deduct/i.test(text) ? "PENALTY" : point === null ? "OTHER" : point >= 0 ? "REWARD" : "PENALTY";

/** Active rules only (the modal never offers an inactive one), by category then name. */
export function parseAdminRules(rows: Row[]): AdminRule[] {
  return rows
    .filter((r) => bool(r, "Active", "IsActive") !== false)
    .map((r) => {
      const raw = num(r, "Point", "Points", "DefaultPoint");
      const type = typeOf(str(r, "RuleType", "TransactionType", "Type"), raw);
      // The rule list may store penalties as positive numbers; the sign follows the type.
      const point = raw === null ? null : type === "PENALTY" ? -Math.abs(raw) : type === "REWARD" ? Math.abs(raw) : raw;
      // RuleID column first; a list whose Title is left empty still has its rules offered (the name stands in).
      const id = str(r, "RuleID", "Title", "RuleCode") || str(r, "RuleName", "Name");
      return {
        id,
        name: str(r, "RuleName", "Name", "Reason") || id,
        type,
        point,
        category: str(r, "Category", "Kategori"),
        severity: severityOf(str(r, "Severity", "Tingkat")),
        description: str(r, "Description", "Deskripsi"),
      };
    })
    .filter((r) => r.id !== "" && r.type !== "OTHER")
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function rulesFor(rules: AdminRule[], type: TxType, category: string): AdminRule[] {
  return rules.filter((r) => r.type === type && (category === "" || r.category === category));
}

export function categoriesFor(rules: AdminRule[], type: TxType): string[] {
  return [...new Set(rules.filter((r) => r.type === type).map((r) => r.category).filter(Boolean))].sort();
}

/** Signed points of the input: the sign follows the type, whatever was typed. null when not a number or 0. */
export function signedPoint(input: string, type: TxType): number | null {
  const n = Number(input.replace(/[−–]/g, "-").replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n === 0 || input.trim() === "") return null;
  return type === "PENALTY" ? -Math.abs(n) : Math.abs(n);
}

export interface ScorePreview {
  before: number | null;
  after: number | null;
  /** after − before: differs from the points when the min/max clamp kicks in. */
  moved: number | null;
  clamped: boolean;
  bandBefore: ScoreBand | null;
  bandAfter: ScoreBand | null;
  /** -1 = drops a band, 1 = climbs, 0 = stays (or unknown). */
  bandMove: -1 | 0 | 1;
}

export function previewScore(host: Pick<HostModel, "score" | "min" | "max">, point: number | null, bands: ScoreBand[]): ScorePreview {
  const before = host.score;
  const bandBefore = bandOf(before, bands);
  if (before === null || point === null) return { before, after: null, moved: null, clamped: false, bandBefore, bandAfter: null, bandMove: 0 };
  const raw = before + point;
  const after = clamp(raw, host.min, host.max);
  const bandAfter = bandOf(after, bands);
  const lo = (b: ScoreBand | null) => (b ? b.min ?? -Infinity : null);
  const a = lo(bandBefore);
  const b = lo(bandAfter);
  const bandMove = a === null || b === null || a === b ? 0 : b < a ? -1 : 1;
  return { before, after, moved: after - before, clamped: after !== raw, bandBefore, bandAfter, bandMove };
}

/** "TX-20260915-102604-7F3K": sortable, readable on the phone of a host, unique enough per second. */
export function newTransactionId(now: Date, rand: () => number = Math.random): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += chars[Math.floor(rand() * chars.length) % chars.length];
  return `TX-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${tail}`;
}

export interface AddScoreInput {
  rule: AdminRule | null;
  point: number | null;
  overrideReason: string;
  notes: string;
  acknowledged: boolean;
  preview: ScorePreview;
  /** Context.config.bigPenaltyPoints (default 10): a deduction of more than this needs a confirmation. */
  bigPenalty: number;
}

/** The rule's default was changed: the reason is mandatory. */
export const isOverride = (rule: AdminRule | null, point: number | null): boolean => !!rule && rule.point !== null && point !== null && point !== rule.point;

/** More than `bigPenalty` points off, or the host drops to a lower band. */
export const needsAck = (point: number | null, preview: ScorePreview, bigPenalty: number): boolean =>
  point !== null && point < 0 && (-point > bigPenalty || preview.bandMove < 0);

/** What still blocks Simpan transaksi, in the order the fields appear. Empty = ready. */
export function addScoreMissing(i: AddScoreInput): string[] {
  const out: string[] = [];
  if (!i.rule) out.push("rule");
  if (i.point === null) out.push("poin");
  if (i.preview.before === null) out.push("skor host");
  if (isOverride(i.rule, i.point) && i.overrideReason.trim().length < 5) out.push("alasan override");
  if (needsAck(i.point, i.preview, i.bigPenalty) && !i.acknowledged) out.push("konfirmasi");
  if (i.rule?.severity === "berat" && i.notes.trim().length < 5) out.push("catatan");
  return out;
}

/** One ledger note for the transaction: the notes, the override reason, the confirmation (the ledger has one Notes column). */
export function composeNotes(notes: string, override: { from: number | null; reason: string } | null, acknowledged = false): string {
  const parts = [notes.trim()];
  if (override) parts.push(`Poin diubah dari default ${signed(override.from)}: ${override.reason.trim()}`);
  if (acknowledged) parts.push("Host dan atasan sudah diberi tahu");
  return parts.filter(Boolean).join(" · ");
}

export const signed = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

// ---- voiding ------------------------------------------------------------------------------------

export const VOID_REASON = "Pembatalan transaksi";
export const reversalNote = (txId: string, reason: string): string => `Membatalkan ${txId}: ${reason.trim()}`;

/** Transaction ID a reversal row points at ("Membatalkan TX-…"). */
export function reversedTxId(t: ScoreTx): string {
  if (!t.reversal) return "";
  const m = /membatalkan\s+([A-Z]{2,4}-[\w-]+)/i.exec(t.notes);
  return m?.[1] ?? "";
}

/** original TransactionID → its reversal row, so a Void row can say when and by whom. */
export function reversalsByTx(txs: ScoreTx[]): Map<string, ScoreTx> {
  const m = new Map<string, ScoreTx>();
  for (const t of txs) {
    const id = reversedTxId(t);
    if (id && !m.has(id)) m.set(id, t);
  }
  return m;
}

/** Only an active, ordinary transaction can be voided (a reversal is never voided in turn). */
export const canVoid = (t: ScoreTx): boolean => t.active && !t.reversal && t.point !== null && t.id !== "";

// ---- list (SL-1) --------------------------------------------------------------------------------

export interface BandCount {
  band: ScoreBand | null;
  count: number;
  share: number;
}

/** Hosts per band, highest band first; hosts outside every band are one last entry. */
export function bandCounts(hosts: HostModel[], bands: ScoreBand[]): BandCount[] {
  const total = hosts.length || 1;
  const out: BandCount[] = [...bands].reverse().map((b) => {
    const count = hosts.filter((h) => h.band?.id === b.id).length;
    return { band: b, count, share: count / total };
  });
  const none = hosts.filter((h) => h.band === null).length;
  if (none > 0) out.push({ band: null, count: none, share: none / total });
  return out;
}

/** Newest transaction per HostID (ScoreTxJson rows carry HostID). */
export function lastTxByHost(txs: ScoreTx[]): Map<string, ScoreTx> {
  const m = new Map<string, ScoreTx>();
  // buildLedger sorts newest first; the host id stays on the row.
  for (const t of txs) {
    const id = str(t.row, "HostID", "HostId");
    if (id && !m.has(id)) m.set(id, t);
  }
  return m;
}

export function averageScore(hosts: HostModel[]): number | null {
  const s = hosts.map((h) => h.score).filter((v): v is number => v !== null);
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
}
