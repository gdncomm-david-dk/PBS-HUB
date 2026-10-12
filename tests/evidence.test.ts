import { buildLedger, urlList } from "../shared/host";
import { evidenceMonth, evidencePath, evidenceRequired, evidenceRuleOf, safeName } from "../shared/scoreAdmin";

describe("credit score evidence", () => {
  it("safeName strips SharePoint-illegal characters", () => {
    expect(safeName('Telat "live" #2 / 10:00?')).toBe("Telat live 2 10 00");
    expect(safeName(" ..rapi.. ")).toBe("rapi");
    expect(safeName("***")).toBe("Tanpa nama");
  });

  it("evidenceMonth reads as yyyy-mm Bulan", () => {
    expect(evidenceMonth(new Date(2026, 9, 12))).toBe("2026-10 Oktober");
    expect(evidenceMonth(new Date(2026, 0, 1))).toBe("2026-01 Januari");
  });

  it("evidencePath builds Credit Score/<host>/<month>/<rule> - <tx>.<ext>", () => {
    const d = new Date(2026, 9, 12);
    const a = evidencePath("Credit Score", "David Kurniawan", d, "Telat masuk live", "TX-1", 0, "JPG");
    expect(a.display).toBe("Credit Score/David Kurniawan/2026-10 Oktober/Telat masuk live - TX-1.jpg");
    expect(a.path).toBe("Credit%20Score/David%20Kurniawan/2026-10%20Oktober/Telat%20masuk%20live%20-%20TX-1.jpg");
    expect(evidencePath("Credit Score", "A", d, "R", "TX-1", 1, ".pdf").fileName).toBe("R - TX-1 (2).pdf");
  });

  it("evidenceRuleOf / evidenceRequired", () => {
    expect(evidenceRuleOf("")).toBe("none");
    expect(evidenceRuleOf("penalty")).toBe("penalty");
    expect(evidenceRuleOf("Semua")).toBe("all");
    expect(evidenceRequired("penalty", "PENALTY")).toBe(true);
    expect(evidenceRequired("penalty", "REWARD")).toBe(false);
    expect(evidenceRequired("all", "REWARD")).toBe(true);
    expect(evidenceRequired("none", "PENALTY")).toBe(false);
  });

  it("urlList reads lines, separators and JSON arrays", () => {
    expect(urlList("https://a/x.jpg\nhttps://b/y.pdf; https://a/x.jpg")).toEqual(["https://a/x.jpg", "https://b/y.pdf"]);
    expect(urlList('["https://a/1","https://a/2"]')).toEqual(["https://a/1", "https://a/2"]);
    expect(urlList([{ Url: "https://a/1" }, "https://a/2"])).toEqual(["https://a/1", "https://a/2"]);
    expect(urlList(null)).toEqual([]);
  });

  it("buildLedger exposes Evidence", () => {
    const [t] = buildLedger([{ TransactionID: "TX-1", HostID: "H1", Point: -5, Evidence: "https://sp/a.jpg" }]);
    expect(t?.evidence).toEqual(["https://sp/a.jpg"]);
  });
});
