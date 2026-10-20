// Build THIRD-PARTY-NOTICES from the production dependency tree in package-lock.json.
// DevDependencies are omitted except Electron, which ships as the desktop runtime.
// Nothing here prints keys, tokens, or environment values.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NOTICES_PATH = path.join(ROOT, "THIRD-PARTY-NOTICES");

const LICENSE_NAMES = /^licen[cs]e/i;

export function licenseChoices(license) {
  return String(license || "UNKNOWN").trim().split(/\s+OR\s+/i).map((s) => s.replace(/^\(+|\)+$/g, "").trim()).filter(Boolean);
}

function choiceKind(choice) {
  const s = choice;
  const strong = /AGPL|SSPL|EUPL|OSL-|Sleepycat|RPL-|GPL-[123]|GPL-2|GPL-3|\bGPL\b/i.test(s) && !/LGPL/i.test(s);
  if (strong) return "strong";
  if (/\bLGPL\b|MPL-|MPL\b|EPL-|CDDL|CC-BY-SA|CPL-1/i.test(s)) return "weak";
  return null;
}

function choicePermissive(choice) {
  return /MIT|ISC|BSD|Apache|0BSD|Unlicense|CC0|Zlib|Python-2|BlueOak|Artistic|WTFPL|PostgreSQL|HPND/i.test(choice) && !choiceKind(choice);
}

// null when we can elect a permissive license, otherwise "strong" or "weak".
export function copyleftKind(license) {
  const choices = licenseChoices(license);
  if (choices.some(choicePermissive)) return null;
  if (choices.some((s) => choiceKind(s) === "strong")) return "strong";
  if (choices.some((s) => choiceKind(s) === "weak")) return "weak";
  return null;
}

function spdxOf(pkg) {
  const lic = pkg.license;
  if (typeof lic === "string" && lic.trim()) return lic.trim();
  if (lic && typeof lic === "object" && lic.type) return String(lic.type);
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) return pkg.licenses.map((l) => l.type || l).join(" OR ");
  return "UNKNOWN";
}

function licenseText(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return ""; }
  const files = names.filter((n) => LICENSE_NAMES.test(n) && fs.statSync(path.join(dir, n)).isFile()).sort();
  if (!files.length) return "";
  return files.map((n) => fs.readFileSync(path.join(dir, n), "utf8")).join("\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function resolveDep(packages, fromKey, depName) {
  let cursor = fromKey;
  while (true) {
    const prefix = cursor ? `${cursor}/node_modules/` : "node_modules/";
    const key = prefix + depName;
    if (packages[key]) return key;
    if (!cursor) return null;
    const idx = cursor.lastIndexOf("/node_modules/");
    cursor = idx === -1 ? "" : cursor.slice(0, idx);
  }
}

function productionKeys(lock) {
  const packages = lock.packages || {};
  const keys = [];
  const seen = new Set();
  const visit = (key) => {
    const meta = packages[key];
    if (!meta) return;
    for (const name of Object.keys(meta.dependencies || {})) {
      const child = resolveDep(packages, key, name);
      if (!child || seen.has(child)) continue;
      seen.add(child);
      keys.push(child);
      visit(child);
    }
  };
  visit("");
  return keys;
}

export function collectProduction(root = ROOT) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = [];
  for (const key of productionKeys(lock)) {
    const meta = lock.packages[key];
    const dir = path.join(root, key);
    const pkgPath = path.join(dir, "package.json");
    const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf8")) : {};
    const license = meta.license || spdxOf(pkg);
    const name = pkg.name || key.split("node_modules/").pop();
    packages.push({
      name,
      version: meta.version || pkg.version || "0.0.0",
      license,
      kind: copyleftKind(license),
      unknown: license === "UNKNOWN",
      key,
      text: licenseText(dir),
    });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  packages.sort((a, b) => cmp(a.name, b.name) || cmp(a.version, b.version) || cmp(a.key, b.key));
  return {
    packages,
    strong: packages.filter((p) => p.kind === "strong"),
    weak: packages.filter((p) => p.kind === "weak"),
    unknown: packages.filter((p) => p.unknown),
  };
}

function electronNote(root) {
  const pkgPath = path.join(root, "node_modules", "electron", "package.json");
  if (!fs.existsSync(pkgPath)) return "Electron package metadata was not installed in this tree.\n";
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const license = spdxOf(pkg);
  // Stable text. The Electron zip (and LICENSES.chromium.html) is downloaded on
  // demand, so this section must not change when that zip appears.
  return [
    `Electron ${pkg.version || ""}`.trim(),
    `SPDX: ${license}`,
    "Role: desktop runtime. Electron is a devDependency and is not packed into app.asar. The packaged app is the Electron binary plus app.asar.",
    "Chromium and the other notices Electron ships are in the Electron distribution as LICENSES.chromium.html (next to the binary). That file is large and is not copied into this notice. A packaged build includes it.",
    "",
  ].join("\n");
}

function listOrNone(rows) {
  if (!rows.length) return "none";
  return rows.map((p) => `${p.name}@${p.version} (${p.license})`).join(", ");
}

export function renderNotices(report, root = ROOT) {
  const lines = [
    "Third-party notices for Meldmind",
    "Copyright (c) 2026 Everborn Productions. All rights reserved.",
    "",
    "Meldmind is proprietary software of Everborn Productions. See the LICENSE file.",
    "The packages below are open-source components distributed with the app. Each one stays under its own license.",
    "This file is generated by scripts/third-party-notices.mjs from the production dependencies in package-lock.json.",
    "Build-only devDependencies are not listed, except the Electron runtime at the end.",
    "Where a package offers a permissive license OR a copyleft license, Meldmind uses the permissive one.",
    "",
    "Copyleft review",
    `Strong copyleft (GPL, AGPL, SSPL, EUPL, OSL): ${listOrNone(report.strong)}`,
    `Weak copyleft (LGPL, MPL, EPL, CDDL, CC-BY-SA): ${listOrNone(report.weak)}`,
    `License not detected: ${listOrNone(report.unknown)}`,
    "",
    "Production packages",
    "",
  ];
  for (const p of report.packages) {
    lines.push(`${p.name}@${p.version}`);
    lines.push(`SPDX: ${p.license}`);
    if (p.kind) lines.push(`Copyleft: ${p.kind}`);
    lines.push("");
    lines.push(p.text || "(No LICENSE file in the package. The SPDX identifier above is from package.json.)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  lines.push("Electron runtime");
  lines.push("");
  lines.push(electronNote(root).trimEnd());
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function main() {
  const report = collectProduction();
  const text = renderNotices(report);
  fs.writeFileSync(NOTICES_PATH, text);
  console.log(`Wrote ${path.relative(ROOT, NOTICES_PATH)} (${report.packages.length} production packages).`);
  console.log(`Strong copyleft: ${listOrNone(report.strong)}`);
  console.log(`Weak copyleft: ${listOrNone(report.weak)}`);
  console.log(`License not detected: ${listOrNone(report.unknown)}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
