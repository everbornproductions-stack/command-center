// 0.4.20: what the AIs made for a remix is written into the remix folder, next to the starter page,
// with the files a real project has (package.json, README, LICENSE, .gitignore, a Playwright config),
// a characters file, and a real test run. Nothing here talks to the network.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { safeRel, escapeHtml } from "./remix-build.js";

const LANG_FILE = { html: "index.html", css: "style.css", javascript: "script.js", js: "script.js", json: "data.json" };

// Pull named files out of an AI answer. A fenced block is named by its first words
// ("```html index.html"), by a first line comment ("<!-- file: index.html -->"), or by its language.
export function extractFiles(text) {
  const out = {};
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const info = m[1].trim();
    let body = m[2];
    const lang = (info.split(/\s+/)[0] || "").toLowerCase();
    let name = (info.split(/\s+/)[1] || "").replace(/^file[:=]/i, "");
    const first = body.split("\n")[0].match(/(?:file|path|name)\s*[:=]\s*([A-Za-z0-9._/-]+)/i);
    if (first) { name = name || first[1]; body = body.split("\n").slice(1).join("\n"); }
    if (!name) name = LANG_FILE[lang] || "";
    const safe = safeRel(name);
    if (!safe || out[safe] !== undefined) continue;
    out[safe] = body.replace(/\s+$/, "") + "\n";
  }
  return out;
}

const slug = (s) => String(s || "remix").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "remix";

export function standardFiles(plan = {}, { year = new Date().getFullYear() } = {}) {
  const title = plan.projectName || "My remix";
  const pkg = {
    name: slug(title),
    version: "0.1.0",
    private: true,
    description: String(plan.description?.looks || title).slice(0, 200),
    scripts: { test: "playwright test", start: "npx serve ." },
    license: "MIT",
    devDependencies: { "@playwright/test": "^1.40.0" },
  };
  const own = plan.own || {};
  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "playwright.config.js": `// Generated for this remix. Playwright is Apache-2.0 and is not bundled.
import { defineConfig } from "@playwright/test";
import { pathToFileURL } from "node:url";
export default defineConfig({
  testMatch: /.*\\.spec\\.js/,
  use: { baseURL: pathToFileURL(process.cwd() + "/").href },
});
`,
    "README.md": `# ${title}\n\n${plan.summary ? String(plan.summary).split("\n").filter((l) => !/^Remix rebuilds/.test(l)).join("\n") : ""}\n\n## Open it\nDouble-click index.html, or run \`npx serve .\`.\n\n## Test it\nRun \`npm install\` then \`npm test\`. The checks in TESTRUN.json were already run once when this was made.\n\n## Credits and license\nSee CREDITS.md for the free tools and art used, and LICENSE for the license on the original code here.\n`,
    "LICENSE": `MIT License\n\nCopyright (c) ${year} ${own.name || title}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`,
    ".gitignore": "node_modules/\ntest-results/\nplaywright-report/\n.DS_Store\n.env\n",
    "characters.md": `# Characters\n\n${own.characters ? own.characters : "No characters were named. Add yours here."}\n\n${own.look ? `Look: ${own.look}\n\n` : ""}${own.ideas ? `Ideas: ${own.ideas}\n` : ""}`,
  };
}

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// A real run of the generated project: files exist, the page has a title and a heading, every
// local script, style and picture it points to is there, and every script parses.
export function testRun(folder) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
  const indexFile = path.join(folder, "index.html");
  const hasIndex = fs.existsSync(indexFile);
  add("The page file exists", hasIndex);
  const html = hasIndex ? fs.readFileSync(indexFile, "utf8") : "";
  add("The page has words in it", html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "").trim().length >= 8);
  add("The page has a title", /<title>[^<]+<\/title>/i.test(html));
  add("The page has a heading", /<h1[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(html));
  const refs = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/gi)].map((r) => r[1]).filter((r) => !/^(?:[a-z]+:|\/\/|data:)/i.test(r));
  const missing = refs.filter((r) => { const safe = safeRel(r.replace(/^\.\//, "")); return !safe || !fs.existsSync(path.join(folder, safe)); });
  add("Every file the page uses is there", missing.length === 0, missing.join(", "));
  const scripts = [...inlineScripts(html)];
  for (const r of refs.filter((x) => /\.js$/.test(x))) {
    const safe = safeRel(r.replace(/^\.\//, ""));
    if (safe && fs.existsSync(path.join(folder, safe))) scripts.push(fs.readFileSync(path.join(folder, safe), "utf8"));
  }
  let bad = "";
  for (const code of scripts) {
    if (/^\s*(?:import|export)\s/m.test(code)) continue; // module scripts are not parsed as plain scripts
    try { new vm.Script(code); } catch (e) { bad = bad || e.message; }
  }
  add("The scripts read without errors", !bad, bad);
  // A starter line left in place ("Not described.") means a question was never answered (0.4.21).
  const leftover = ["index.html", "README.md", "characters.md"].filter((f) => { try { return /Not described\./.test(fs.readFileSync(path.join(folder, f), "utf8")); } catch { return false; } });
  add("No question was left unanswered", leftover.length === 0, leftover.map((f) => `${f} still says "Not described."`).join(", "));
  const failed = checks.filter((c) => !c.ok).length;
  // The page is read and its scripts are parsed; it is not opened in a browser here. The result says so.
  return { ran: true, at: Date.now(), checks, passed: checks.length - failed, failed, grade: failed ? "Needs a look" : "Passed", note: "Checked on this computer. The page was read, not opened in a browser. Use Play preview to see it." };
}

// Write everything for one finished remix into its folder. Returns what was made, for the last step.
export function finishRemix(folder, plan, deliverable, { onlyMissing = true } = {}) {
  fs.mkdirSync(folder, { recursive: true });
  const written = [];
  const put = (rel, text, overwrite) => {
    const safe = safeRel(rel);
    if (!safe) return;
    const file = path.join(folder, safe);
    if (!overwrite && fs.existsSync(file)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.push(safe);
  };
  const made = extractFiles(deliverable);
  for (const [rel, text] of Object.entries(made)) put(rel, text, true);
  if (String(deliverable || "").trim()) put("OUTPUT.md", String(deliverable).slice(0, 200000) + "\n", true);
  for (const [rel, text] of Object.entries(standardFiles(plan))) put(rel, text, !onlyMissing);
  const result = testRun(folder);
  fs.writeFileSync(path.join(folder, "TESTRUN.json"), JSON.stringify(result, null, 2) + "\n");
  written.push("TESTRUN.json");
  return { files: [...new Set(written)], fromAI: Object.keys(made), test: result, hasOutput: Object.keys(made).length > 0 || !!String(deliverable || "").trim() };
}

export { escapeHtml };

// A small zip writer (stored, no compression, no extra package) so Export works anywhere.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const crc = crc32(buf);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(buf.length, 18); head.writeUInt32LE(buf.length, 22);
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    parts.push(head, nameBuf, buf);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(buf.length, 20); c.writeUInt32LE(buf.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + buf.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
