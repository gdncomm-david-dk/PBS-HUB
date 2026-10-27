/**
 * Phone width turns a wide `.pbs-table` into one card per row (styles.ts). Each cell needs the name of
 * its column to show beside the value, so this copies the header text onto every body cell as
 * `data-label`. Tables with three columns or fewer read fine as they are and stay tables.
 */
export const CARD_MIN_COLUMNS = 4;

export function labelTables(root: ParentNode): void {
  root.querySelectorAll<HTMLTableElement>("table.pbs-table").forEach((table) => {
    const head = table.tHead?.rows[table.tHead.rows.length - 1];
    if (!head) return;
    const labels: string[] = [];
    for (const th of Array.from(head.cells)) {
      const text = (th.textContent ?? "").replace(/\s+/g, " ").trim();
      for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text);
    }
    const cards = labels.length >= CARD_MIN_COLUMNS;
    if (table.classList.contains("pbs-cards") !== cards) table.classList.toggle("pbs-cards", cards);
    if (!cards) return;
    const rows = [...Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)), ...(table.tFoot ? Array.from(table.tFoot.rows) : [])];
    for (const tr of rows) {
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        const span = td.colSpan || 1;
        const label = span > 1 ? "" : (labels[col] ?? "");
        if (td.getAttribute("data-label") !== label) td.setAttribute("data-label", label);
        col += span;
      }
    }
  });
}
