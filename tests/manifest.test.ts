import * as fs from "fs";
import * as path from "path";

// Dataverse validates manifest text attributes as noAposStringType: an apostrophe fails the solution import.
describe("control manifests", () => {
  const root = path.join(__dirname, "..", "controls");
  const manifests = fs.readdirSync(root).map((c) => path.join(root, c, c, "ControlManifest.Input.xml")).filter((p) => fs.existsSync(p));
  it.each(manifests.map((p) => [path.basename(path.dirname(p)), p]))("%s has no apostrophe in attributes", (_name, p) => {
    const xml = fs.readFileSync(p as string, "utf8").replace(/^<\?xml[^>]*\?>/, "");
    const bad = [...xml.matchAll(/([\w-]+)="([^"]*'[^"]*)"/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(bad).toEqual([]);
  });
});
