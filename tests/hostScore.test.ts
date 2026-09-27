import { buildLedger, parseBands } from "../shared/host";
import { marginBelow, matchesFilter, nextBand, scoreRules, scoreSeries, summarize, txInPeriod } from "../shared/hostScore";

const bands = parseBands([
  { ThresholdID: "B1", Label: "Kritis", MinimumScore: 0, MaximumScore: 59, Tone: "Danger" },
  { ThresholdID: "B2", Label: "Perlu perhatian", MinimumScore: 60, MaximumScore: 84, Tone: "Warning" },
  { ThresholdID: "B3", Label: "Baik", MinimumScore: 85, MaximumScore: 114, Tone: "Info" },
  { ThresholdID: "B4", Label: "Sangat baik", MinimumScore: 115, MaximumScore: 200, Tone: "Success" },
]);

const ledger = buildLedger([
  { ID: 1, TransactionID: "TX-1", RuleID: "R1", Reason: "Live tepat waktu", TransactionType: { Value: "Reward" }, Point: 2, ScoreBefore: 100, ScoreAfter: 102, Status: { Value: "Active" }, CreatedDate: "2026-08-04T10:00:00" },
  { ID: 2, TransactionID: "TX-2", RuleID: "R2", Reason: "Report terlambat", TransactionType: { Value: "Penalty" }, Point: -5, ScoreBefore: 102, ScoreAfter: 97, Status: { Value: "Active" }, CreatedDate: "2026-08-15T10:00:00" },
  { ID: 3, TransactionID: "TX-3", RuleID: "R3", Reason: "Target GMV", TransactionType: { Value: "Reward" }, Point: 5, ScoreBefore: 97, ScoreAfter: 102, Status: { Value: "Void" }, CreatedDate: "2026-09-02T10:00:00" },
  { ID: 4, TransactionID: "TX-4", RuleID: "R1", Reason: "Live tepat waktu", TransactionType: { Value: "Reward" }, Point: 2, ScoreBefore: 97, ScoreAfter: 99, Status: "", CreatedDate: "2026-09-05T10:00:00" },
]);
const SEP = { year: 2026, month: 8 };

describe("host score summary", () => {
  it("sums rewards and penalties of active rows; voided rows only counted", () => {
    expect(summarize(ledger)).toEqual({ reward: 4, rewardCount: 2, penalty: -5, penaltyCount: 1, net: -1, voidCount: 1 });
    expect(summarize(ledger.filter((t) => txInPeriod(t, SEP)))).toEqual({ reward: 2, rewardCount: 1, penalty: 0, penaltyCount: 0, net: 2, voidCount: 1 });
  });
  it("null period keeps every month", () => {
    expect(ledger.filter((t) => txInPeriod(t, null))).toHaveLength(4);
  });
  it("filters: a voided reward is only under Dibatalkan", () => {
    const tx3 = ledger.find((t) => t.txId === "TX-3");
    expect(tx3 && [matchesFilter(tx3, "All"), matchesFilter(tx3, "Reward"), matchesFilter(tx3, "Void")]).toEqual([true, false, true]);
    expect(ledger.filter((t) => matchesFilter(t, "Penalty")).map((t) => t.txId)).toEqual(["TX-2"]);
  });
});

describe("next level", () => {
  it("points to the band above and the gap to its minimum", () => {
    expect(nextBand(99, bands)).toMatchObject({ band: { id: "B4" }, gap: 16 });
    expect(nextBand(84, bands)).toMatchObject({ band: { id: "B3" }, gap: 1 });
  });
  it("is null at the top level, without a score or without bands", () => {
    expect(nextBand(150, bands)).toBeNull();
    expect(nextBand(null, bands)).toBeNull();
    expect(nextBand(90, [])).toBeNull();
  });
  it("margin below is the distance to the band minimum", () => {
    expect(marginBelow(88, bands[2] ?? null)).toBe(3);
    expect(marginBelow(88, null)).toBeNull();
  });
});

describe("score series", () => {
  it("uses ScoreAfter of active rows, oldest first", () => {
    expect(scoreSeries(ledger, 99).map((p) => p.score)).toEqual([102, 97, 99]);
  });
  it("rebuilds from the current score when rows have no ScoreAfter", () => {
    const bare = buildLedger([
      { ID: 1, Point: 3, Status: "Active", CreatedDate: "2026-09-01T10:00:00" },
      { ID: 2, Point: -2, Status: "Active", CreatedDate: "2026-09-03T10:00:00" },
    ]);
    expect(scoreSeries(bare, 101).map((p) => p.score)).toEqual([103, 101]);
    expect(scoreSeries(bare, null)).toEqual([]);
  });
});

describe("score rules", () => {
  it("reads the rules from the transactions when RulesJson is empty, rewards first", () => {
    const r = scoreRules([], ledger);
    expect(r.map((x) => [x.name, x.point, x.count])).toEqual([
      ["Target GMV", 5, 0],
      ["Live tepat waktu", 2, 2],
      ["Report terlambat", -5, 1],
    ]);
  });
  it("uses RulesJson when sent, drops inactive rules and counts the host rows by RuleID", () => {
    const r = scoreRules(
      [
        { RuleID: "R1", RuleName: "Live tepat waktu", RuleType: { Value: "Reward" }, Point: 2, Active: true },
        { RuleID: "R9", RuleName: "Lama", RuleType: "Reward", Point: 1, Active: false },
        { RuleID: "R4", RuleName: "Tidak hadir", RuleType: "Penalty", Point: -10, Description: "Tanpa kabar ke PIC" },
      ],
      ledger,
    );
    expect(r.map((x) => [x.id, x.type, x.count, x.description])).toEqual([
      ["R1", "REWARD", 2, ""],
      ["R4", "PENALTY", 0, "Tanpa kabar ke PIC"],
    ]);
  });
});
