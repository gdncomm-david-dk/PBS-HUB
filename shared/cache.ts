import { Row, parseRows } from "./data";

/** Parses each JSON property once per distinct string, so React memos see stable arrays. */
export class RowsCache {
  private raw = new Map<string, string>();
  private rows = new Map<string, Row[]>();

  get(key: string, raw: string | null | undefined): Row[] {
    const s = raw ?? "";
    if (this.raw.get(key) === s) return this.rows.get(key) ?? [];
    const parsed = parseRows(s);
    this.raw.set(key, s);
    this.rows.set(key, parsed);
    return parsed;
  }


}
