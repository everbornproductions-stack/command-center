// Rebuild the bundled "What Meldmind can do" PDF.
// npm run build:guide. Package and release run this before the installer is built.
// No network. The pages come from the same guide as the tour.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppProbe } from "./app-probe.mjs";
import { formatGuideDate, writeGuidePdf } from "./guide-pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : "";
}

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const date = arg("--date") || formatGuideDate(new Date());
const file = path.resolve(root, arg("--out") || path.join("web", "what-meldmind-can-do.pdf"));
const probe = readAppProbe(root);
const { pages } = await writeGuidePdf({ file, probe, version, date });
console.log(`Guide PDF: ${path.relative(root, file)} (${pages.length} areas, version ${version}, ${date})`);
