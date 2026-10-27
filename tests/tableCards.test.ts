/** @jest-environment jsdom */
import { labelTables } from "../shared/tableCards";

describe("labelTables", () => {
  it("labels wide tables and picks the card title", () => {
    document.body.innerHTML = `
      <table class="pbs-table"><thead><tr><th></th><th>Rep ID</th><th>Host</th><th colspan="2">Status</th></tr></thead>
        <tbody><tr><td><input type="checkbox"></td><td>REP-1</td><td>Dinda</td><td>A</td><td>B</td></tr>
        <tr><td colspan="5">detail</td></tr></tbody></table>
      <table class="pbs-table" id="small"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    labelTables(document);
    const big = document.querySelector("table")!;
    expect(big.classList.contains("pbs-cards")).toBe(true);
    const cells = Array.from(big.tBodies[0]!.rows[0]!.cells);
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["", "Rep ID", "Host", "Status", "Status"]);
    expect(cells.map((c) => c.hasAttribute("data-title"))).toEqual([false, true, false, false, false]);
    expect(big.tBodies[0]!.rows[1]!.cells[0]!.getAttribute("data-label")).toBe("");
    expect(document.getElementById("small")!.classList.contains("pbs-cards")).toBe(false);
  });
});
