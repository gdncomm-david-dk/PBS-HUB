import {
  accountIssues,
  addAccountPayload,
  brandIssues,
  nextCode,
  orphanAccounts,
  parseAccounts,
  parseBrands,
  platformOptions,
  updateAccountPayload,
} from "../shared/brandAccount";

const accounts = parseAccounts([
  { ID: 1, Title: "ACC-001", AccountName: "wingsofficialstore", BrandID: "BRD-001", Platform: { Value: "Shopee" }, Status: { Value: "Active" }, Modified: "2026-09-01T10:00:00Z" },
  { ID: 2, Title: "ACC-002", AccountName: "wings.tiktok", BrandID: "brd-001", Platform: "TikTok", Status: { Value: "Inactive" } },
  { ID: 3, Title: "ACC-010", AccountName: "youbeauty", BrandID: "BRD-002", Platform: "Shopee" },
  { ID: 4, Title: "ACC-011", AccountName: "lost", BrandID: "BRD-404", Platform: "Shopee" },
]);
const brands = parseBrands(
  [
    { ID: 11, Title: "BRD-002", NamaBrand: "Y.O.U Beauty" },
    { ID: 10, Title: "BRD-001", NamaBrand: "Wings" },
  ],
  accounts,
);

describe("parse", () => {
  it("groups accounts under their brand (case-insensitive), sorted by name, with active counts", () => {
    expect(brands.map((b) => b.code)).toEqual(["BRD-001", "BRD-002"]);
    const wings = brands.find((b) => b.code === "BRD-001");
    expect(wings?.accounts.map((a) => a.code)).toEqual(["ACC-002", "ACC-001"]);
    expect(wings?.active).toBe(1);
  });
  it("reads Status / Active in the common shapes", () => {
    expect(accounts.map((a) => a.active)).toEqual([true, false, true, true]);
    expect(parseAccounts([{ Title: "A", AccountName: "a", Active: false }])[0]?.active).toBe(false);
    expect(parseAccounts([{ Title: "A", AccountName: "a", Status: "Nonaktif" }])[0]?.active).toBe(false);
  });
  it("lists accounts whose brand does not exist", () => {
    expect(orphanAccounts(brands, accounts).map((a) => a.code)).toEqual(["ACC-011"]);
  });
});

describe("platformOptions", () => {
  it("config first, then the platforms already used, no duplicates", () => {
    expect(platformOptions(accounts, {})).toEqual(["Shopee", "TikTok"]);
    expect(platformOptions(accounts, { platforms: ["Lazada", "shopee"] })).toEqual(["Lazada", "shopee", "TikTok"]);
  });
});

describe("nextCode", () => {
  it("continues the pattern in use and keeps the width", () => {
    expect(nextCode(["ACC-001", "ACC-010", "ACC-011"], "ACC-")).toBe("ACC-012");
    expect(nextCode(["BRD-9", "BRD-10"], "BRD-")).toBe("BRD-11");
    expect(nextCode([], "ACC-")).toBe("ACC-001");
    expect(nextCode(["x"], "ACC-")).toBe("ACC-001");
  });
});

describe("accountIssues", () => {
  const ok = { code: "ACC-012", name: "newshop", brandId: "BRD-001", platform: "Shopee", active: true };
  it("passes a complete new account", () => {
    expect(accountIssues(ok, accounts, brands)).toEqual([]);
  });
  it("blocks a duplicate code or name, and missing fields", () => {
    expect(accountIssues({ ...ok, code: "acc-001" }, accounts, brands)[0]).toMatch(/sudah dipakai/);
    expect(accountIssues({ ...ok, name: "WingsOfficialStore " }, accounts, brands)[0]).toMatch(/Nama akun sudah dipakai/);
    expect(accountIssues({ code: "", name: "", brandId: "", platform: "", active: true }, accounts, brands)).toHaveLength(4);
    expect(accountIssues({ ...ok, code: "a b" }, accounts, brands)[0]).toMatch(/Kode akun/);
    expect(accountIssues({ ...ok, brandId: "BRD-404" }, accounts, brands)).toEqual(["Brand tidak ditemukan"]);
  });
  it("editing: its own code and name are not duplicates", () => {
    const me = accounts[0]!;
    expect(accountIssues({ code: me.code, name: me.name, brandId: "BRD-001", platform: "Shopee", active: true }, accounts, brands, me)).toEqual([]);
    expect(accountIssues({ code: me.code, name: "wings.tiktok", brandId: "BRD-001", platform: "Shopee", active: true }, accounts, brands, me)[0]).toMatch(/Nama akun sudah dipakai oleh ACC-002/);
  });
});

describe("brandIssues", () => {
  it("needs a unique code and name", () => {
    expect(brandIssues("BRD-003", "Glow", brands)).toEqual([]);
    expect(brandIssues("brd-001", "Glow", brands)[0]).toMatch(/sudah dipakai/);
    expect(brandIssues("BRD-003", "wings", brands)[0]).toMatch(/Nama brand/);
    expect(brandIssues("", "", brands)).toHaveLength(2);
  });
});

describe("payloads", () => {
  it("add: trimmed values, Active / Inactive status, brand name for the message", () => {
    const wings = brands.find((b) => b.code === "BRD-001");
    expect(addAccountPayload({ code: " ACC-012 ", name: " newshop ", brandId: "BRD-001", platform: "Shopee", active: false }, wings)).toEqual({
      code: "ACC-012", name: "newshop", brandId: "BRD-001", brandName: "Wings", platform: "Shopee", status: "Inactive",
    });
  });
  it("update: the code stays, expectedModified and rename flag come along", () => {
    const was = accounts[0]!;
    const p = updateAccountPayload({ code: "ACC-999", name: "Wings Official", brandId: "BRD-001", platform: "Shopee", active: true }, was, brands[1]);
    expect(p).toMatchObject({ code: "ACC-001", accountItemId: "1", expectedModified: "2026-09-01T10:00:00Z", previousName: "wingsofficialstore", renamed: true, status: "Active" });
  });
});
