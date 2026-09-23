// Renders harness scenarios to PNGs: node harness/shoot.js <outDir> "name|query|Button;=ExactButton" ...
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const [outDir, ...shots] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1120, height: 900 } });
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
  for (const s of shots) {
    const [name, query, action] = s.split("|");
    await p.goto("file://" + path.join(__dirname, "index.html") + "?" + (query || ""));
    await p.waitForTimeout(500);
    if (action) {
      for (const step of action.split(";")) {
        const [label, idx] = step.split("@");
        const exact = label.startsWith("=");
        await p.getByRole("button", { name: exact ? label.slice(1) : label, exact }).nth(Number(idx || 0)).click();
        await p.waitForTimeout(300);
      }
    }
    const el = await p.$("#stage");
    await el.screenshot({ path: path.join(outDir, name + ".png") });
    console.log("shot", name);
  }
  await b.close();
})();
