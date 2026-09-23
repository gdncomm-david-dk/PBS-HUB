import { bool, date, num, parseClock, parseRows, person, str } from "../shared/data";

describe("parseRows", () => {
  it("never throws on blank or malformed input", () => {
    expect(parseRows("")).toEqual([]);
    expect(parseRows(null)).toEqual([]);
    expect(parseRows("{nope")).toEqual([]);
    expect(parseRows("42")).toEqual([]);
  });
  it("wraps a single record and unwraps {value:[…]}", () => {
    expect(parseRows('{"Title":"A"}')).toEqual([{ Title: "A" }]);
    expect(parseRows('{"value":[{"Title":"A"},{"Title":"B"}]}')).toHaveLength(2);
  });
});

describe("field readers", () => {
  it("unwraps Choice and Person columns", () => {
    const r = { ApprovalStatus: { Value: "Done" }, Approver: { DisplayName: "Annisa", Email: "a@x.com" } };
    expect(str(r, "ApprovalStatus")).toBe("Done");
    expect(person(r, "Approver")).toEqual({ name: "Annisa", email: "a@x.com" });
  });
  it("reads encoded internal column names as aliases", () => {
    expect(num({ Durasi_x0028_Min_x0029_: 120 }, "Durasi(Min)", "Durasi_x0028_Min_x0029_")).toBe(120);
  });
  it("keeps blank distinct from zero, and parses Indonesian numbers", () => {
    expect(num({ A: "" }, "A")).toBeNull();
    expect(num({ A: 0 }, "A")).toBe(0);
    expect(num({ A: "12.400.000" }, "A")).toBe(12400000);
    expect(num({ A: "4,8" }, "A")).toBe(4.8);
    expect(num({ A: "Rp1.234,50" }, "A")).toBe(1234.5);
    expect(num({ A: "4.62%" }, "A")).toBe(4.62);
  });
  it("reads date-only strings as local dates", () => {
    const d = date({ Date: "2026-09-14" }, "Date") as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 14, 0]);
  });
  it("parses clock text", () => {
    expect(parseClock("10:00")).toBe(600);
    expect(parseClock("09.30")).toBe(570);
    expect(parseClock("7:15 PM")).toBe(19 * 60 + 15);
    expect(parseClock("x")).toBeNull();
  });
  it("reads booleans in several spellings", () => {
    expect(bool({ A: "false" }, "A")).toBe(false);
    expect(bool({ A: true }, "A")).toBe(true);
    expect(bool({}, "A")).toBeNull();
  });
});
