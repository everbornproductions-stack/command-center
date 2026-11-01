// Dogfood runner: gives the INSTALLED Meldmind real jobs through its own local engine, one after another,
// then checks each result the way a customer would (does the file exist, open, run, contain what was asked).
// Usage: node tools/dogfood/run-batch.mjs <tasks.json> <outDir> [--port 4747] [--mode savings] [--budget 0.25] [--only id,id]
// Nothing is sent or posted; no key is read or printed. The app's own data folder is only searched for the
// named output files (Meldmind saves named files under its project media folder).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [tasksFile, outDir] = args;
const PORT = Number(opt("port", 4747));
const MODE = opt("mode", "savings");
const BUDGET = Number(opt("budget", 0.25));
const ONLY = (opt("only", "") || "").split(",").filter(Boolean);
const MAX_MIN = Number(opt("minutes", 20));
const BASE = `http://127.0.0.1:${PORT}`;
const isEnd = (s) => /^(done|failed|cancelled|incomplete|error)/.test(String(s || ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "run-log.txt");
const log = (...a) => { const l = `${new Date().toISOString().slice(11, 19)} ${a.join(" ")}`; console.log(l); fs.appendFileSync(logFile, l + "\n"); };

async function token() {
  const h = await (await fetch(BASE + "/")).text();
  const m = h.match(/name="cc-token"\s+content="([^"]+)"/) || h.match(/content="([^"]+)"\s+name="cc-token"/);
  if (!m) throw new Error("no cc-token on the page");
  return m[1];
}
let TOKEN = await token();
async function api(p, { method = "GET", body } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + "/api" + p, { method, headers: { "X-CC-Token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 || r.status === 403) { TOKEN = await token(); continue; }
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 500) }; }
      if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.body = j; throw e; }
      return j;
    } catch (e) { if (e.status) throw e; await sleep(3000); if (attempt === 2) throw e; }
  }
}

const MEDIA_ROOTS = [path.join(process.env.APPDATA || "", "Everborn Command", "data", "projects")];
// the app never overwrites, so a second run saves name-2.ext: accept that too
const sameName = (got, want) => { const g = got.toLowerCase(), w = want.toLowerCase(); if (g === w) return true; const i = w.lastIndexOf("."); const base = w.slice(0, i), ext = w.slice(i); if (!g.endsWith(ext) || !g.startsWith(base + "-")) return false; return /^\d+$/.test(g.slice(base.length + 1, g.length - ext.length)); };
function findOutput(name, dir, since) {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return { path: direct, where: "asked folder" };
  for (const root of MEDIA_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (sameName(e.name, name) && fs.statSync(p).mtimeMs >= since) {
          fs.copyFileSync(p, direct);
          return { path: direct, where: `app media folder (${path.relative(root, p)})` };
        }
      }
    }
  }
  return null;
}

function run(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", timeout: 60000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), timedOut: r.error?.code === "ETIMEDOUT" };
}
const PY = (cwd, code) => run("python", ["-I", "-c", code], cwd);

function check(f, file) {
  const p = file.path, dir = path.dirname(p), res = { ok: false, notes: [] };
  const text = () => fs.readFileSync(p, "utf8");
  const size = fs.statSync(p).size;
  res.notes.push(`${size} bytes`);
  if (size === 0) { res.notes.push("empty file"); return res; }
  switch (f.check) {
    case "exists": res.ok = true; break;
    case "text": { const t = text(); const miss = (f.mustInclude || []).filter((s) => !t.includes(s)); res.ok = t.length > 200 && !miss.length; if (miss.length) res.notes.push("missing: " + miss.join(", ")); break; }
    case "html": { const t = text().toLowerCase(); const miss = (f.mustInclude || []).filter((s) => !t.includes(s.toLowerCase())); res.ok = t.includes("<html") && t.includes("<body") && !miss.length; if (miss.length) res.notes.push("missing: " + miss.join(", ")); break; }
    case "csv": {
      const r = PY(dir, `import csv,sys\nrows=list(csv.reader(open(r'''${p}''',encoding='utf-8-sig')))\nprint(len(rows)-1, max(len(x) for x in rows))`);
      const [n, c] = r.out.trim().split(/\s+/).map(Number);
      res.notes.push(`${n} data rows, ${c} columns`);
      res.ok = r.code === 0 && n >= (f.minRows || 1) && c >= (f.minCols || 1); break;
    }
    case "xlsx": {
      const r = PY(dir, `import zipfile,re\nz=zipfile.ZipFile(r'''${p}''')\nsheets=[n for n in z.namelist() if n.startswith('xl/worksheets/sheet')]\nf=sum(len(re.findall(r'<f[ >]',z.read(s).decode('utf-8','ignore'))) for s in sheets)\nprint(len(sheets),f)`);
      if (r.code !== 0) { res.notes.push("does not open as a spreadsheet: " + r.out.trim().split("\n").pop()); break; }
      const [s, fo] = r.out.trim().split(/\s+/).map(Number);
      res.notes.push(`${s} sheet(s), ${fo} formulas`);
      res.ok = s >= 1 && fo >= (f.minFormulas || 0); break;
    }
    case "docx": {
      const r = PY(dir, `import zipfile,re\nz=zipfile.ZipFile(r'''${p}''')\nx=z.read('word/document.xml').decode('utf-8','ignore')\nt=re.sub('<[^>]+>',' ',x)\nprint(len(t.split()))\nprint(t[:4000])`);
      if (r.code !== 0) { res.notes.push("does not open as a Word file: " + r.out.trim().split("\n").pop()); break; }
      const words = Number(r.out.split("\n")[0]); const miss = (f.mustInclude || []).filter((s) => !r.out.includes(s));
      res.notes.push(`${words} words`); if (miss.length) res.notes.push("missing: " + miss.join(", "));
      res.ok = words > 150 && !miss.length; break;
    }
    case "python": {
      const r = run("python", ["-I", p], dir);
      res.notes.push(`exit ${r.code}${r.timedOut ? " (timed out)" : ""}: ${r.out.trim().slice(0, 300).replace(/\s+/g, " ")}`);
      res.ok = r.code === 0 && new RegExp(f.expect || ".").test(r.out); break;
    }
    case "node": {
      const r = run(process.execPath, [p, ...(f.args || [])], dir);
      res.notes.push(`exit ${r.code}: ${r.out.trim().slice(0, 300).replace(/\s+/g, " ")}`);
      res.ok = r.code === 0 && new RegExp(f.expect || ".").test(r.out); break;
    }
    case "pptx": {
      const r = PY(dir, `import zipfile,re\nz=zipfile.ZipFile(r'''${p}''')\nn=[x for x in z.namelist() if re.match(r'ppt/slides/slide[0-9]+[.]xml$',x)]\nprint(len(n))`);
      if (r.code !== 0) { res.notes.push("does not open as a PowerPoint file: " + r.out.trim().split("\n").pop()); break; }
      const n = Number(r.out.trim()); res.notes.push(`${n} slides`); res.ok = n >= (f.minSlides || 1); break;
    }
    case "svg": { const t = text(); const miss = (f.mustInclude || []).filter((x) => !t.includes(x)); res.ok = /<svg[\s>]/i.test(t) && /<\/svg>/i.test(t) && !miss.length; if (miss.length) res.notes.push("missing: " + miss.join(", ")); break; }
    case "sqlite": {
      const r = PY(dir, `import sqlite3\nc=sqlite3.connect(':memory:')\nc.executescript(open(r'''${p}''',encoding='utf-8').read())\nt=[x[0] for x in c.execute("select name from sqlite_master where type='table'")]\nprint(len(t), ','.join(t))`);
      res.notes.push(r.code === 0 ? `runs in SQLite: ${r.out.trim()}` : "SQLite error: " + r.out.trim().split("\n").pop());
      res.ok = r.code === 0 && Number(r.out.trim().split(/\s+/)[0]) >= 3; break;
    }
    case "json": { try { const j = JSON.parse(text()); res.notes.push(Array.isArray(j) ? `${j.length} items` : "object"); res.ok = true; } catch (e) { res.notes.push("not valid JSON: " + e.message); } break; }
    case "ps1parse": {
      const r = run("powershell", ["-NoProfile", "-Command", `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${p}',[ref]$null,[ref]$e);if($e){$e|%{$_.Message};exit 1}else{'parsed ok'}`], dir);
      res.notes.push(r.out.trim().slice(0, 200)); res.ok = r.code === 0 && /param\s*\(/i.test(text()); break;
    }
    case "ps1": {
      const r = run("powershell", ["-NoProfile", "-Command", `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${p}',[ref]$null,[ref]$e);if($e){$e|%{$_.Message};exit 1}else{'parsed ok'}`], dir);
      res.notes.push(r.out.trim().slice(0, 200));
      if (r.code === 0) {
        const src = fs.mkdtempSync(path.join(os.tmpdir(), "df-src-")), dst = fs.mkdtempSync(path.join(os.tmpdir(), "df-dst-"));
        fs.writeFileSync(path.join(src, "a.txt"), "hello");
        const t = run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", p, "-Source", src, "-Destination", dst], dir);
        const zips = fs.readdirSync(dst).filter((n) => n.endsWith(".zip"));
        res.notes.push(`ran: exit ${t.code}, ${zips.length} zip made${zips[0] ? " (" + zips[0] + ")" : ""}`);
        res.ok = t.code === 0 && zips.length === 1;
      }
      break;
    }
    default: res.notes.push("unknown check");
  }
  return res;
}

function summarize(m) {
  const tasks = (m?.plan?.tasks || m?.tasks || []).map((t) => ({
    title: t.title, status: t.status, ai: t.provider || t.assignee?.provider || t.assigned?.provider || t.ai || null,
    model: t.model || t.assignee?.model || t.assigned?.model || null, qa: t.qa?.pass ?? null,
  }));
  return { status: m?.status, mode: m?.mode, cost: m?.costUsd ?? m?.cost ?? m?.spent ?? null, estimate: m?.estimateUsd ?? m?.estimate ?? null, tasks, error: m?.error || null };
}

const all = JSON.parse(fs.readFileSync(tasksFile, "utf8")).filter((t) => !ONLY.length || ONLY.includes(t.id));
const results = [];
const st = await api("/state");
log(`Meldmind ${st.version} on port ${PORT}; mode ${MODE}; budget $${BUDGET}/task; ${all.length} tasks`);
for (const t of all) {
  const dir = path.join(outDir, t.id);
  fs.mkdirSync(dir, { recursive: true });
  const goal = t.goal.replaceAll("{dir}", dir);
  const started = Date.now();
  const row = { id: t.id, industry: t.industry, persona: t.persona, kind: t.kind, goal, startedAt: new Date(started).toISOString() };
  log(`--- ${t.id} (${t.industry}, ${t.kind})`);
  let mission = null;
  try {
    const r = await api("/mission", { method: "POST", body: { goal, mode: MODE, qa: true, budgetUsd: BUDGET, background: true, runAt: "now" } });
    row.missionId = r.id;
    log(`started ${r.id}`);
    const deadline = started + MAX_MIN * 60000;
    let last = "";
    while (Date.now() < deadline) {
      await sleep(10000);
      try { mission = await api(`/missions/${encodeURIComponent(r.id)}`); } catch (e) { if (e.status === 404) continue; throw e; }
      const s = summarize(mission);
      const line = `${s.status} ${s.tasks.map((x) => x.status?.[0] || "?").join("")}`;
      if (line !== last) { log(line); last = line; }
      if (isEnd(s.status)) break;
    }
    if (mission && !isEnd(mission.status)) { row.timedOut = true; log(`still ${mission.status} after ${MAX_MIN} min`); }
  } catch (e) { row.startError = `${e.status || ""} ${e.message}`.trim(); log(`error: ${row.startError}`); }
  row.seconds = Math.round((Date.now() - started) / 1000);
  row.mission = summarize(mission);
  row.deliverable = String(mission?.deliverable || mission?.result || "").slice(0, 3000);
  if (mission) fs.writeFileSync(path.join(dir, "mission.json"), JSON.stringify(mission, null, 2));
  row.files = (t.files || []).map((f) => {
    const found = findOutput(f.name, dir, started - 1000);
    if (!found) return { name: f.name, found: false, ok: false, notes: ["not saved anywhere"] };
    try { return { name: f.name, found: true, where: found.where, ...check(f, found) }; }
    catch (e) { return { name: f.name, found: true, where: found.where, ok: false, notes: ["check crashed: " + e.message] }; }
  });
  row.pass = row.files.length > 0 && row.files.every((f) => f.ok);
  log(`${row.pass ? "PASS" : "FAIL"} ${row.files.map((f) => `${f.name}: ${f.ok ? "ok" : "bad"} (${f.notes.join("; ")})`).join(" | ")}`);
  results.push(row);
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
}

const pass = results.filter((r) => r.pass).length;
const md = [`# Meldmind dogfood batch (${new Date().toISOString().slice(0, 10)})`, "", `Meldmind ${st.version}, mode ${MODE}, budget $${BUDGET} per task. ${pass} of ${results.length} produced a working result.`, "",
  "| Task | Industry | Result | Time | Mission | Files |", "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.industry} | ${r.pass ? "PASS" : "FAIL"} | ${r.seconds}s | ${r.startError || `${r.mission.status}${r.timedOut ? " (timed out)" : ""}, ${r.mission.tasks.length} steps, cost ${r.mission.cost ?? "?"}`} | ${r.files.map((f) => `${f.name}: ${f.ok ? "ok" : "bad"}, ${f.where || ""} ${f.notes.join("; ")}`).join("<br>")} |`),
  "", "## Steps per task", "", ...results.flatMap((r) => [`### ${r.id}`, ...r.mission.tasks.map((x) => `- ${x.title} | ${x.status} | ${x.ai || "?"} ${x.model || ""} | QA ${x.qa}`), r.mission.error ? `- error: ${r.mission.error}` : "", ""])];
fs.writeFileSync(path.join(outDir, "REPORT.md"), md.join("\n"));
log(`DONE ${pass}/${results.length}. Report: ${path.join(outDir, "REPORT.md")}`);
