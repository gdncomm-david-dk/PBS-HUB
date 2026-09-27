import { buildHosts, buildLedger, checkLedger, parseBands } from "../shared/host";
import { matchesFilter, scoreRules, summarize } from "../shared/hostScore";
import {
  addScoreMissing,
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
  reversedTxId,
  rulesFor,
  signedPoint,
} from "../shared/scoreAdmin";

const bands = parseBands([
  { ThresholdID: "B1", Label: "Kritis", MinimumScore: 0, MaximumScore: 59, Tone: "Danger" },
  { ThresholdID: "B2", Label: "Cukup", MinimumScore: 60, MaximumScore: 79, Tone: "Warning" },
  { ThresholdID: "B3", Label: "Baik", MinimumScore: 80, MaximumScore: 89, Tone: "Info" },
  { ThresholdID: "B4", Label: "Sangat baik", MinimumScore: 90, MaximumScore: 100, Tone: "Success" },
]);

const rules = parseAdminRules([
  { RuleID: "SR-014", RuleName: "Apresiasi manual", RuleType: { Value: "Reward" }, Point: 4, Category: "Inisiatif", Severity: { Value: "Ringan" }, Active: true },
  { RuleID: "SR-006", RuleName: "Tidak hadir tanpa kabar", RuleType: "Penalty", Point: 12, Category: "Kedisiplinan", Severity: "Berat" },
  { RuleID: "SR-002", RuleName: "Clock in di luar radius", RuleType: "Penalty", Point: -2, Category: "Kedisiplinan", Severity: "Ringan" },
  { RuleID: "SR-099", RuleName: "Lama", RuleType: "Reward", Point: 1, Active: false },
]);

const host = { score: 78, min: 0, max: 100 };

describe("rules", () => {
  it("keeps active rules, signs penalties negative whatever the list stores, reads severity", () => {
    expect(rules.map((r) => [r.id, r.point, r.severity])).toEqual([
      ["SR-014", 4, "ringan"],
      ["SR-002", -2, "ringan"],
      ["SR-006", -12, "berat"],
    ]);
  });
  it("filters by type and category", () => {
    expect(categoriesFor(rules, "PENALTY")).toEqual(["Kedisiplinan"]);
    expect(rulesFor(rules, "REWARD", "").map((r) => r.id)).toEqual(["SR-014"]);
    expect(rulesFor(rules, "PENALTY", "Inisiatif")).toEqual([]);
  });
  it("host app rule list signs a positive penalty too", () => {
    expect(scoreRules([{ RuleID: "SR-006", RuleName: "Tidak hadir", RuleType: "Penalty", Point: 12 }], []).map((r) => r.point)).toEqual([-12]);
  });
});

describe("points and preview", () => {
  it("the sign follows the type", () => {
    expect([signedPoint("6", "REWARD"), signedPoint("-6", "REWARD"), signedPoint("6", "PENALTY"), signedPoint("−12", "PENALTY"), signedPoint("", "REWARD"), signedPoint("0", "REWARD")]).toEqual([
      6, 6, -6, -12, null, null,
    ]);
  });
  it("shows the band move", () => {
    const p = previewScore(host, 6, bands);
    expect([p.before, p.after, p.bandBefore?.label, p.bandAfter?.label, p.bandMove, p.clamped]).toEqual([78, 84, "Cukup", "Baik", 1, false]);
    expect(previewScore(host, -2, bands).bandMove).toBe(0);
    expect(previewScore(host, -20, bands)).toMatchObject({ after: 58, bandMove: -1 });
  });
  it("clamps to the host min/max", () => {
    expect(previewScore({ score: 97, min: 0, max: 100 }, 5, bands)).toMatchObject({ after: 100, moved: 3, clamped: true });
    expect(previewScore({ score: null, min: 0, max: 100 }, 5, bands).after).toBeNull();
  });
});

describe("validation", () => {
  const rule = rules.find((r) => r.id === "SR-014") ?? null;
  const heavy = rules.find((r) => r.id === "SR-006") ?? null;
  it("override of the default needs a reason", () => {
    expect(isOverride(rule, 6)).toBe(true);
    expect(isOverride(rule, 4)).toBe(false);
    const base = { rule, point: 6, overrideReason: "", notes: "", acknowledged: false, preview: previewScore(host, 6, bands), bigPenalty: 10 };
    expect(addScoreMissing(base)).toEqual(["alasan override"]);
    expect(addScoreMissing({ ...base, overrideReason: "Dua sesi sekaligus" })).toEqual([]);
  });
  it("a big penalty or a band drop needs a confirmation; severity berat needs notes", () => {
    const p = previewScore({ score: 54, min: 0, max: 100 }, -12, bands);
    expect(needsAck(-12, p, 10)).toBe(true);
    expect(needsAck(-10, previewScore({ score: 54, min: 0, max: 100 }, -10, bands), 10)).toBe(false);
    expect(needsAck(-2, previewScore({ score: 61, min: 0, max: 100 }, -2, bands), 10)).toBe(true);
    expect(addScoreMissing({ rule: heavy, point: -12, overrideReason: "", notes: "", acknowledged: false, preview: p, bigPenalty: 10 })).toEqual(["konfirmasi", "catatan"]);
    expect(addScoreMissing({ rule: heavy, point: -12, overrideReason: "", notes: "Tanpa kabar ke PIC", acknowledged: true, preview: p, bigPenalty: 10 })).toEqual([]);
  });
  it("nothing chosen", () => {
    expect(addScoreMissing({ rule: null, point: null, overrideReason: "", notes: "", acknowledged: false, preview: previewScore(host, null, bands), bigPenalty: 10 })).toEqual(["rule", "poin"]);
  });
  it("one Notes value with the override reason", () => {
    expect(composeNotes(" Gantikan host ", { from: 4, reason: "dua sesi" })).toBe("Gantikan host · Poin diubah dari default +4: dua sesi");
    expect(composeNotes("", null)).toBe("");
    expect(composeNotes("Tanpa kabar", null, true)).toBe("Tanpa kabar · Host dan atasan sudah diberi tahu");
  });
});

describe("transaction id", () => {
  it("is TX-date-time-4 chars", () => {
    expect(newTransactionId(new Date(2026, 8, 15, 10, 26, 4), () => 0)).toBe("TX-20260915-102604-AAAA");
    expect(newTransactionId(new Date())).toMatch(/^TX-\d{8}-\d{6}-[A-Z2-9]{4}$/);
  });
});

describe("void and reversal", () => {
  const ledger = buildLedger([
    { ID: 1, TransactionID: "TX-1", RuleID: "SR-014", Reason: "Apresiasi manual", TransactionType: "Reward", Point: 4, ScoreBefore: 73, ScoreAfter: 77, Status: "Active", CreatedDate: "2026-09-04T16:42:00" },
    { ID: 2, TransactionID: "TX-2", RuleID: "SR-003", Reason: "Report telat 3 hari", TransactionType: "Penalty", Point: -5, ScoreBefore: 78, ScoreAfter: 73, Status: { Value: "Void" }, CreatedDate: "2026-09-11T09:02:00" },
    { ID: 3, TransactionID: "TX-3", RuleID: "VOID", Reason: "Pembatalan transaksi", TransactionType: "Reward", Point: 5, ScoreBefore: 73, ScoreAfter: 78, Notes: reversalNote("TX-2", "upload gagal"), Status: { Value: "Reversal" }, CreatedDate: "2026-09-15T10:26:00", HostID: "H1" },
  ]);
  it("neither the void nor its reversal counts; the reversal is not listed as Dibatalkan", () => {
    const [rev, voided, ok] = ledger;
    expect([rev?.reversal, rev?.active, voided?.reversal, voided?.active, ok?.active]).toEqual([true, false, false, false, true]);
    expect(summarize(ledger)).toMatchObject({ reward: 4, penalty: 0, voidCount: 1 });
    expect(ledger.filter((t) => matchesFilter(t, "Void")).map((t) => t.txId)).toEqual(["TX-2"]);
    const [h] = buildHosts([{ Title: "H1", InitialScore: 74, CurrentScore: 78, MinimumScore: 0, MaximumScore: 100 }], bands, { initial: null, min: null, max: null });
    expect(h && checkLedger(h, ledger)).toMatchObject({ expected: 78, drift: false, voidedCount: 1 });
  });
  it("links the reversal to the row it voids", () => {
    const rev = ledger[0];
    expect(rev && reversedTxId(rev)).toBe("TX-2");
    expect(reversalsByTx(ledger).get("TX-2")?.txId).toBe("TX-3");
  });
  it("only an active ordinary row can be voided", () => {
    expect(ledger.map(canVoid)).toEqual([false, false, true]);
  });
  it("last transaction per host", () => {
    expect(lastTxByHost(ledger).get("H1")?.txId).toBe("TX-3");
  });
});

describe("band counts", () => {
  it("counts hosts per band, highest first, with a share", () => {
    const hosts = buildHosts(
      [92, 88, 85, 78, 54, null].map((s, i) => ({ Title: `H${i}`, CurrentScore: s })),
      bands,
      { initial: null, min: 0, max: 100 },
    );
    expect(bandCounts(hosts, bands).map((c) => [c.band?.label ?? "none", c.count])).toEqual([
      ["Sangat baik", 1],
      ["Baik", 2],
      ["Cukup", 1],
      ["Kritis", 1],
      ["none", 1],
    ]);
  });
});
