import { Row, bool, rowId, str } from "./data";

/**
 * Ops Brand & Account: the brands (`Brand - PBS Hub`) and the accounts of every brand
 * (`Account - PBS Hub`: Title = account code, AccountName, BrandID, Platform, Status).
 *
 * Account names are what Report.Account / Host Absence.Account store, so the name stays unique across
 * all accounts and the code (Title, what Schedule.Account holds) never changes after it is created.
 */

export interface BrandModel {
  id: string;
  code: string;
  name: string;
  accounts: AccountModel[];
  active: number;
}

export interface AccountModel {
  id: string;
  /** Account code: Account.Title, the value of Schedule.Account. Immutable. */
  code: string;
  name: string;
  brandId: string;
  platform: string;
  active: boolean;
  /** Last change, sent back as `expectedModified` so a concurrent edit is caught. */
  modified: string;
  row: Row;
}

export const DEFAULT_PLATFORMS = ["Shopee", "TikTok"];
const INACTIVE = /^(inactive|nonaktif|non-aktif|tidak aktif|no|false|0|off)$/i;

export function parseAccounts(rows: Row[]): AccountModel[] {
  return rows
    .map((r): AccountModel => {
      const status = str(r, "Status", "Active", "Aktif", "IsActive");
      const flag = bool(r, "Active", "Aktif", "IsActive");
      return {
        id: rowId(r),
        code: str(r, "Title", "AccountID", "AccountCode"),
        name: str(r, "AccountName", "NamaAccount", "Name"),
        brandId: str(r, "BrandID", "Brand"),
        platform: str(r, "Platform"),
        active: flag !== null ? flag : !INACTIVE.test(status),
        modified: str(r, "Modified"),
        row: r,
      };
    })
    .filter((a) => a.code || a.name);
}

export function parseBrands(rows: Row[], accounts: AccountModel[]): BrandModel[] {
  const out = rows
    .map((r): BrandModel => {
      const code = str(r, "Title", "BrandID", "BrandCode");
      return { id: rowId(r), code, name: str(r, "NamaBrand", "BrandName", "Name") || code, accounts: [], active: 0 };
    })
    .filter((b) => b.code || b.name);
  const byCode = new Map(out.map((b) => [b.code.toLowerCase(), b]));
  for (const a of accounts) byCode.get(a.brandId.toLowerCase())?.accounts.push(a);
  for (const b of out) {
    b.accounts.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
    b.active = b.accounts.filter((a) => a.active).length;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Accounts whose BrandID matches no brand (typo or deleted brand): shown under "Tanpa brand". */
export function orphanAccounts(brands: BrandModel[], accounts: AccountModel[]): AccountModel[] {
  const known = new Set(brands.map((b) => b.code.toLowerCase()));
  return accounts.filter((a) => !known.has(a.brandId.toLowerCase()));
}

/** Platforms offered in the form: config.platforms, else the ones already used, else Shopee / TikTok. */
export function platformOptions(accounts: AccountModel[], config: Record<string, unknown>): string[] {
  const fromConfig = Array.isArray(config.platforms) ? config.platforms.map((p) => String(p).trim()).filter(Boolean) : [];
  const used = accounts.map((a) => a.platform).filter(Boolean);
  const all = [...(fromConfig.length ? fromConfig : DEFAULT_PLATFORMS), ...used];
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Next code in the pattern the existing ones follow ("ACC-014" → "ACC-015"); `fallback` + 001 when none. */
export function nextCode(codes: string[], fallback: string): string {
  const parsed = codes
    .map((c) => /^(.*?)(\d+)$/.exec(c.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ prefix: m[1] ?? "", n: Number(m[2]), width: (m[2] ?? "").length }));
  if (!parsed.length) return `${fallback}001`;
  // The most used prefix wins, then the highest number inside it.
  const count = new Map<string, number>();
  for (const p of parsed) count.set(p.prefix, (count.get(p.prefix) ?? 0) + 1);
  const prefix = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const top = parsed.filter((p) => p.prefix === prefix).sort((a, b) => b.n - a.n)[0];
  if (!top) return `${fallback}001`;
  return `${prefix}${String(top.n + 1).padStart(top.width, "0")}`;
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/;
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface AccountDraft {
  code: string;
  name: string;
  brandId: string;
  platform: string;
  active: boolean;
}

/** What blocks saving an account, in the order the admin fixes it. `editing` = the account being edited. */
export function accountIssues(d: AccountDraft, all: AccountModel[], brands: BrandModel[], editing?: AccountModel): string[] {
  const out: string[] = [];
  const others = all.filter((a) => a.id !== editing?.id);
  const code = d.code.trim();
  const name = d.name.trim();
  if (!code) out.push("Isi kode akun");
  else if (!CODE_RE.test(code)) out.push("Kode akun 2–30 karakter: huruf, angka, titik, minus atau garis bawah");
  else if (!editing) {
    const dup = others.find((a) => same(a.code, code));
    if (dup) out.push(`Kode ${dup.code} sudah dipakai oleh ${dup.name || "akun lain"}`);
  }
  if (name.length < 2) out.push("Isi nama akun");
  else {
    const dup = others.find((a) => same(a.name, name));
    if (dup) out.push(`Nama akun sudah dipakai oleh ${dup.code} (nama dipakai sebagai pilihan di Report, jadi harus unik)`);
  }
  if (!d.brandId) out.push("Pilih brand");
  else if (!brands.some((b) => same(b.code, d.brandId))) out.push("Brand tidak ditemukan");
  if (!d.platform.trim()) out.push("Pilih platform");
  return out;
}

export function brandIssues(code: string, name: string, brands: BrandModel[]): string[] {
  const out: string[] = [];
  if (!code.trim()) out.push("Isi kode brand");
  else if (!CODE_RE.test(code.trim())) out.push("Kode brand 2–30 karakter: huruf, angka, titik, minus atau garis bawah");
  else {
    const dup = brands.find((b) => same(b.code, code));
    if (dup) out.push(`Kode ${dup.code} sudah dipakai oleh ${dup.name}`);
  }
  if (name.trim().length < 2) out.push("Isi nama brand");
  else {
    const dup = brands.find((b) => same(b.name, name));
    if (dup) out.push(`Nama brand sudah dipakai oleh ${dup.code}`);
  }
  return out;
}

/** Choice value written to Account.Status. */
export const STATUS_ACTIVE = "Active";
export const STATUS_INACTIVE = "Inactive";

export function addAccountPayload(d: AccountDraft, brand: BrandModel | undefined): Record<string, unknown> {
  return {
    code: d.code.trim(),
    name: d.name.trim(),
    brandId: brand?.code ?? d.brandId,
    brandName: brand?.name ?? "",
    platform: d.platform.trim(),
    status: d.active ? STATUS_ACTIVE : STATUS_INACTIVE,
  };
}

export function updateAccountPayload(
  d: AccountDraft,
  was: AccountModel,
  brand: BrandModel | undefined,
): Record<string, unknown> {
  return {
    ...addAccountPayload(d, brand),
    code: was.code, // never changes: Schedule.Account points at it
    accountItemId: was.id,
    expectedModified: was.modified,
    previousName: was.name,
    renamed: !same(was.name, d.name),
  };
}

export function addBrandPayload(code: string, name: string): Record<string, unknown> {
  return { code: code.trim(), name: name.trim() };
}
