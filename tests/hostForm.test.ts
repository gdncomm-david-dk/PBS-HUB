import { buildHostForm, changedFields, hostIssues, isoDate, packageOptions, parseHostRefs, piiIssue, saveHostPayload } from "../shared/hostForm";

const hosts = parseHostRefs([
  { ID: 1, Title: "HOST0001", HostCode: "H1", NamaHost: "Dinda", Email: "dinda@pbs.id" },
  { ID: 2, Title: "HOST0002", HostCode: "H2", NamaHost: "Rara", Email: "rara@pbs.id" },
]);
const today = new Date(2026, 9, 26);

describe("hostForm", () => {
  it("add: next Host ID, today as join date, no personal data", () => {
    const m = buildHostForm([], hosts, today);
    expect(m.edit).toBeNull();
    expect(m.draft.hostId).toBe("HOST0003");
    expect(m.draft.joinDate).toBe("2026-10-26");
  });

  it("edit: masked personal data, never the raw value", () => {
    const m = buildHostForm(
      [{ ID: 2, Title: "HOST0002", NamaHost: "Rara", Email: "rara@pbs.id", Package: "Gold", JoinDate: "2025-03-01T00:00:00Z", Bank: "BCA", NorekLast4: "4321", KtpLast4: "9876", HasAlamat: false, Modified: "2026-10-01T00:00:00Z" }],
      hosts,
      today,
    );
    expect(m.edit).toMatchObject({ id: "2", hostId: "HOST0002" });
    expect(m.draft.joinDate).toBe("2025-03-01");
    expect(m.masked.NoRekening).toBe("BCA ••••4321");
    expect(m.masked.Alamat).toBeNull();
    expect(m.draft.pii).toEqual({});
    expect(changedFields(m.draft, m)).toEqual([]);
  });

  it("issues: duplicates, email, scores, personal data", () => {
    const add = buildHostForm([], hosts, today);
    const d = { ...add.draft, hostId: "host0001", code: "h2", name: "A", email: "RARA@pbs.id", minScore: "500", maxScore: "100", pii: { KTP: "123" } };
    const out = hostIssues(d, hosts, add, ["Gold"]);
    expect(out.join("|")).toMatch(/Host ID HOST0001 sudah dipakai/);
    expect(out.join("|")).toMatch(/Host code h2 sudah dipakai/);
    expect(out.join("|")).toMatch(/Isi nama host/);
    expect(out.join("|")).toMatch(/Email RARA@pbs.id sudah dipakai/);
    expect(out.join("|")).toMatch(/Pilih package/);
    expect(out.join("|")).toMatch(/minimum lebih besar/);
    expect(out.join("|")).toMatch(/KTP harus 16 angka/);
    // Editing a host does not clash with itself.
    const edit = buildHostForm([{ ID: 2, Title: "HOST0002", HostCode: "H2", NamaHost: "Rara", Email: "rara@pbs.id", Package: "Gold" }], hosts, today);
    expect(hostIssues(edit.draft, hosts, edit, ["Gold"])).toEqual([]);
    expect(hostIssues({ ...edit.draft, pii: { NoRekening: "" } }, hosts, edit, ["Gold"]).join()).toMatch(/masih kosong/);
    expect(hostIssues({ ...edit.draft, bank: "", pii: { NoRekening: "1234567890" } }, hosts, edit, ["Gold"]).join()).toMatch(/nama bank/);
  });

  it("piiIssue formats", () => {
    expect(piiIssue("KTP", "3201 0101 0101 0001")).toBeNull();
    expect(piiIssue("PhoneNumber", "+62 812-3456-789")).toBeNull();
    expect(piiIssue("PhoneNumber", "12")).not.toBeNull();
    expect(piiIssue("PersonalEmail", "x@y")).not.toBeNull();
  });

  it("payload sends only typed personal fields, and none without HOST_PII_VIEW", () => {
    const m = buildHostForm([{ ID: 2, Title: "HOST0002", NamaHost: "Rara", Email: "rara@pbs.id", Modified: "M" }], hosts, today);
    const d = { ...m.draft, name: "Rara A", pii: { KTP: "3201 0101 0101 0001", PhoneNumber: "0812-345-6789" } };
    expect(saveHostPayload(d, m, true)).toMatchObject({
      mode: "edit",
      id: "2",
      hostId: "HOST0002",
      expectedModified: "M",
      name: "Rara A",
      pii: { KTP: "3201010101010001", PhoneNumber: "08123456789" },
      piiFields: ["KTP", "PhoneNumber"],
    });
    expect(saveHostPayload(d, m, false)).toMatchObject({ pii: {}, piiFields: [] });
  });

  it("package options", () => {
    expect(packageOptions([{ Value: "Gold" }, { Value: "Silver" }], {}, "Bronze")).toEqual(["Gold", "Silver", "Bronze"]);
    expect(packageOptions([], { packages: ["A"] }, "")).toEqual(["A"]);
  });
});
