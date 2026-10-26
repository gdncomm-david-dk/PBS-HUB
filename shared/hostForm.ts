import { Row, num, rowId, str } from "./data";
import { PII_ORDER, PiiField, maskedPii } from "./host";
import { nextCode } from "./brandAccount";

/**
 * Ops Host form: add a host or edit one (`Host - PBS Hub`). Personal data (KTP, rekening, alamat, telepon,
 * email pribadi) never comes in: canvas sends the same masked hints as HostDetail, and the form only sends
 * the fields the admin typed a new value for.
 */

export interface HostRef {
  id: string;
  hostId: string;
  code: string;
  name: string;
  email: string;
}

export interface HostDraft {
  hostId: string;
  code: string;
  name: string;
  email: string;
  pkg: string;
  joinDate: string;
  initialScore: string;
  minScore: string;
  maxScore: string;
  bank: string;
  /** New values typed in; a field left out keeps what the list has. */
  pii: Partial<Record<PiiField, string>>;
}

export interface HostFormModel {
  /** null = adding a new host. */
  edit: { id: string; hostId: string; modified: string; name: string } | null;
  draft: HostDraft;
  /** Masked text per personal field for the edit screen ("••••1234"); null = empty. */
  masked: Partial<Record<PiiField, string | null>>;
}

export function parseHostRefs(rows: Row[]): HostRef[] {
  return rows
    .map((r) => ({
      id: rowId(r),
      hostId: str(r, "Title", "HostID"),
      code: str(r, "HostCode"),
      name: str(r, "NamaHost", "HostName"),
      email: str(r, "Email", "WorkEmail"),
    }))
    .filter((h) => h.hostId || h.name);
}

const numText = (v: number | null): string => (v === null ? "" : String(v));

/** ISO date (yyyy-mm-dd) from whatever canvas sent: "2026-01-05", "2026-01-05T00:00:00Z", a Date string. */
export function isoDate(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m?.[1]) return m[1];
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildHostForm(rows: Row[], hosts: HostRef[], today: Date): HostFormModel {
  const r = rows[0];
  const id = r ? rowId(r) : "";
  const hostId = r ? str(r, "Title", "HostID") : "";
  if (!r || (!id && !hostId)) {
    return {
      edit: null,
      draft: {
        hostId: nextCode(hosts.map((h) => h.hostId), "HOST"),
        code: "",
        name: "",
        email: "",
        pkg: "",
        joinDate: isoDate(today.toString()), // local day, not UTC
        initialScore: "",
        minScore: "",
        maxScore: "",
        bank: "",
        pii: {},
      },
      masked: {},
    };
  }
  const masked: Partial<Record<PiiField, string | null>> = {};
  for (const f of PII_ORDER) {
    const m = maskedPii(r, f);
    if (m !== undefined) masked[f] = m;
  }
  return {
    edit: { id, hostId, modified: str(r, "Modified"), name: str(r, "NamaHost", "HostName") },
    draft: {
      hostId,
      code: str(r, "HostCode"),
      name: str(r, "NamaHost", "HostName"),
      email: str(r, "Email", "WorkEmail"),
      pkg: str(r, "Package", "Paket"),
      joinDate: isoDate(str(r, "JoinDate")),
      initialScore: numText(num(r, "InitialScore")),
      minScore: numText(num(r, "MinimumScore")),
      maxScore: numText(num(r, "MaximumScore")),
      bank: str(r, "Bank"),
      pii: {},
    },
    masked,
  };
}

/** Package choices: PackagesJson (Choices of the column), else config.packages, else what hosts already use. */
export function packageOptions(rows: Row[], config: Record<string, unknown>, current: string): string[] {
  const fromRows = rows.map((r) => str(r, "Value", "Title", "Name")).filter(Boolean);
  const fromConfig = Array.isArray(config.packages) ? config.packages.map((p) => String(p).trim()).filter(Boolean) : [];
  const all = [...(fromRows.length ? fromRows : fromConfig), ...(current ? [current] : [])];
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const digits = (s: string): string => s.replace(/\D/g, "");

function numberIssue(label: string, v: string): string | null {
  if (!v.trim()) return null;
  return Number.isFinite(Number(v)) ? null : `${label} harus angka`;
}

/** What one personal field must look like; null = fine. */
export function piiIssue(field: PiiField, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (field) {
    case "KTP":
      return /^\d{16}$/.test(digits(v)) && digits(v).length === v.replace(/[\s.-]/g, "").length ? null : "KTP harus 16 angka";
    case "NoRekening":
      return /^\d{6,20}$/.test(v.replace(/[\s.-]/g, "")) ? null : "No rekening 6–20 angka";
    case "PhoneNumber":
      return /^\+?\d{9,15}$/.test(v.replace(/[\s.()-]/g, "")) ? null : "Telepon 9–15 angka (boleh diawali +)";
    case "PersonalEmail":
      return EMAIL_RE.test(v) ? null : "Email pribadi tidak valid";
    case "NamaRekening":
      return v.length >= 2 ? null : "Nama rekening terlalu pendek";
    case "Alamat":
      return v.length >= 5 ? null : "Alamat terlalu pendek";
  }
}

/** What blocks saving, in the order the admin fixes it. */
export function hostIssues(d: HostDraft, hosts: HostRef[], model: HostFormModel, packages: string[]): string[] {
  const out: string[] = [];
  const others = hosts.filter((h) => !(model.edit && (h.id === model.edit.id || same(h.hostId, model.edit.hostId))));
  if (!model.edit) {
    if (!d.hostId.trim()) out.push("Isi Host ID");
    else if (!ID_RE.test(d.hostId.trim())) out.push("Host ID 2–30 karakter: huruf, angka, titik, minus atau garis bawah");
    else {
      const dup = others.find((h) => same(h.hostId, d.hostId));
      if (dup) out.push(`Host ID ${dup.hostId} sudah dipakai oleh ${dup.name || "host lain"}`);
    }
  }
  if (d.code.trim()) {
    const dup = others.find((h) => h.code && same(h.code, d.code));
    if (dup) out.push(`Host code ${d.code.trim()} sudah dipakai oleh ${dup.name || dup.hostId}`);
  }
  if (d.name.trim().length < 2) out.push("Isi nama host");
  if (!d.email.trim()) out.push("Isi email kerja");
  else if (!EMAIL_RE.test(d.email.trim())) out.push("Email kerja tidak valid");
  else {
    const dup = others.find((h) => h.email && same(h.email, d.email));
    if (dup) out.push(`Email ${d.email.trim()} sudah dipakai oleh ${dup.name || dup.hostId}`);
  }
  if (packages.length && !d.pkg) out.push("Pilih package");
  if (d.joinDate && !isoDate(d.joinDate)) out.push("Tanggal join tidak valid");
  for (const [label, v] of [
    ["Skor awal", d.initialScore],
    ["Skor minimum", d.minScore],
    ["Skor maksimum", d.maxScore],
  ] as const) {
    const i = numberIssue(label, v);
    if (i) out.push(i);
  }
  const n = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const [ini, min, max] = [n(d.initialScore), n(d.minScore), n(d.maxScore)];
  if (min !== null && max !== null && min > max) out.push("Skor minimum lebih besar dari maksimum");
  if (!model.edit && ini !== null && ((min !== null && ini < min) || (max !== null && ini > max)))
    out.push("Skor awal di luar batas minimum–maksimum");
  for (const f of PII_ORDER) {
    const v = d.pii[f];
    if (v === undefined) continue;
    if (model.edit && !v.trim()) {
      out.push(`${f === "NoRekening" ? "No rekening" : f} baru masih kosong (batalkan Ganti kalau tidak diubah)`);
      continue;
    }
    const i = piiIssue(f, v);
    if (i) out.push(i);
  }
  const norek = d.pii.NoRekening?.trim();
  if (norek && !d.bank.trim()) out.push("Isi nama bank untuk no rekening");
  return out;
}

const trimOrNull = (v: string): number | null => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** SAVE_HOST payload. Personal fields go only when typed in, and only with HOST_PII_VIEW. */
export function saveHostPayload(d: HostDraft, model: HostFormModel, canPii: boolean): Record<string, unknown> {
  const pii: Record<string, string> = {};
  if (canPii) {
    for (const f of PII_ORDER) {
      const v = d.pii[f]?.trim();
      if (!v) continue;
      pii[f] = f === "KTP" || f === "NoRekening" ? v.replace(/[\s.-]/g, "") : f === "PhoneNumber" ? v.replace(/[\s.()-]/g, "") : v;
    }
  }
  const ini = trimOrNull(d.initialScore);
  return {
    mode: model.edit ? "edit" : "add",
    id: model.edit?.id ?? "",
    hostId: model.edit ? model.edit.hostId : d.hostId.trim(),
    expectedModified: model.edit?.modified ?? "",
    hostCode: d.code.trim(),
    name: d.name.trim(),
    email: d.email.trim().toLowerCase(),
    package: d.pkg,
    joinDate: isoDate(d.joinDate),
    // A new host starts at its initial score; on edit the score moves only through the ledger.
    initialScore: ini,
    minScore: trimOrNull(d.minScore),
    maxScore: trimOrNull(d.maxScore),
    bank: d.bank.trim(),
    pii,
    piiFields: Object.keys(pii),
  };
}

/** Fields that differ from what the form opened with (edit), for the "nothing changed" check. */
export function changedFields(d: HostDraft, model: HostFormModel): string[] {
  const o = model.draft;
  const out: string[] = [];
  const keys: (keyof Omit<HostDraft, "pii">)[] = ["code", "name", "email", "pkg", "joinDate", "initialScore", "minScore", "maxScore", "bank"];
  for (const k of keys) if (d[k].trim() !== o[k].trim()) out.push(k);
  for (const f of PII_ORDER) if (d.pii[f]?.trim()) out.push(f);
  return out;
}
