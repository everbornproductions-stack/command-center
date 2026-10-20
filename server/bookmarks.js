// Organize my existing browser bookmarks (Phase 13). The first-run step that builds the AI folder also
// offers to sort the person's EXISTING bookmarks into smart, auto-named folders by topic, using an AI the
// person picks with their own key.
//  - Reads Chrome / Edge / Brave `Bookmarks` JSON (per profile) and Firefox `places.sqlite` (a read-only copy),
//    only after the person picks the browser and clicks allow.
//  - Titles and addresses go only to the AI the person picked (no smart fallback to another provider), with
//    query strings and fragments cut off first. Every call is in the ledger (role "bookmarks") and inside the caps.
//  - Apply only reorganizes: nothing is deleted except exact duplicates the person ticked. The original file is
//    backed up next to itself and in the app data folder first, and Undo restores it. A running browser is
//    detected and refused (Chromium overwrites the file while it runs); `checksum` is removed so it accepts the edit.
//  - Firefox is read and sorted; its result is an import file (writing places.sqlite is not safe).
// Tests point CC_BROWSER_HOME at a fake home folder (Local/ and Roaming/ like Windows), so no real profile is touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HOSTED, doc, putDoc } from "./store.js";
import { DATA_DIR } from "./paths.js";
import { TEXT_PROVIDERS, PROVIDERS, estimateCost } from "./registry.js";
import { hasSecret } from "./vault.js";
import { complete, extractJson } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { cheapest } from "./router.js";
import { emit } from "./events.js";
import { demoActive } from "./mock.js";
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }

const HISTORY = "bookmarks.history";
const BATCH = 120;
const MAX_ITEMS = 5000;
const DEMO_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "bookmarks-demo.json");
const DEMO_DIR = () => path.join(DATA_DIR, "bookmarks-demo");
const BACKUP_DIR = () => path.join(DATA_DIR, "bookmarks-backups");

const bad = (msg, status = 400, code) => Object.assign(new Error(msg), { status, code });

// ---------- where the browsers keep their bookmarks ----------
function homes() {
  const fake = process.env.CC_BROWSER_HOME;
  if (fake) return { os: "win32", local: path.join(fake, "Local"), roaming: path.join(fake, "Roaming") };
  const h = os.homedir();
  if (process.platform === "win32") return { os: "win32", local: process.env.LOCALAPPDATA || path.join(h, "AppData", "Local"), roaming: process.env.APPDATA || path.join(h, "AppData", "Roaming") };
  if (process.platform === "darwin") { const s = path.join(h, "Library", "Application Support"); return { os: "darwin", local: s, roaming: s }; }
  return { os: "linux", local: path.join(h, ".config"), roaming: h };
}
export function browsers() {
  const H = homes();
  const at = { win32: { chrome: ["Google", "Chrome", "User Data"], edge: ["Microsoft", "Edge", "User Data"], brave: ["BraveSoftware", "Brave-Browser", "User Data"], firefox: ["Mozilla", "Firefox"] },
    darwin: { chrome: ["Google", "Chrome"], edge: ["Microsoft Edge"], brave: ["BraveSoftware", "Brave-Browser"], firefox: ["Firefox"] },
    linux: { chrome: ["google-chrome"], edge: ["microsoft-edge"], brave: ["BraveSoftware", "Brave-Browser"], firefox: [".mozilla", "firefox"] } }[H.os];
  const proc = { win32: { chrome: "chrome.exe", edge: "msedge.exe", brave: "brave.exe", firefox: "firefox.exe" }, darwin: { chrome: "Google Chrome", edge: "Microsoft Edge", brave: "Brave Browser", firefox: "firefox" }, linux: { chrome: "chrome", edge: "msedge", brave: "brave", firefox: "firefox" } }[H.os];
  return [
    { id: "chrome", name: "Google Chrome", kind: "chromium", dir: path.join(H.local, ...at.chrome), proc: proc.chrome },
    { id: "edge", name: "Microsoft Edge", kind: "chromium", dir: path.join(H.local, ...at.edge), proc: proc.edge },
    { id: "brave", name: "Brave", kind: "chromium", dir: path.join(H.local, ...at.brave), proc: proc.brave },
    { id: "firefox", name: "Firefox", kind: "firefox", dir: path.join(H.roaming, ...at.firefox), proc: proc.firefox },
  ];
}

// Firefox lists its profiles in profiles.ini (Name=, Path=, IsRelative=).
export function parseProfilesIni(text, base) {
  const out = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { cur = /^Profile\d+$/i.test(sec[1]) ? {} : null; if (cur) out.push(cur); continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (cur && kv) cur[kv[1].trim()] = kv[2].trim();
  }
  return out.filter((p) => p.Path).map((p) => ({ name: p.Name || p.Path, dir: p.IsRelative === "0" ? p.Path : path.join(base, ...p.Path.split(/[\\/]/)) }));
}

// Profile names only: nothing inside a bookmarks file is read until the person clicks allow.
export function sources() {
  const out = [];
  for (const b of browsers()) {
    if (!fs.existsSync(b.dir)) continue;
    if (b.kind === "chromium") {
      let cache = {};
      try { cache = JSON.parse(fs.readFileSync(path.join(b.dir, "Local State"), "utf8"))?.profile?.info_cache || {}; } catch {}
      const dirs = new Set(Object.keys(cache));
      try { for (const d of fs.readdirSync(b.dir)) if (/^(Default|Profile \d+)$/.test(d)) dirs.add(d); } catch {}
      for (const d of [...dirs].sort()) {
        const file = path.join(b.dir, d, "Bookmarks");
        if (!fs.existsSync(file)) continue;
        out.push({ browser: b.id, browserName: b.name, kind: b.kind, profile: d, name: cache[d]?.name || d, canApply: true });
      }
    } else {
      let list = [];
      try { list = parseProfilesIni(fs.readFileSync(path.join(b.dir, "profiles.ini"), "utf8"), b.dir); } catch {}
      for (const p of list) if (fs.existsSync(path.join(p.dir, "places.sqlite"))) out.push({ browser: b.id, browserName: b.name, kind: b.kind, profile: path.basename(p.dir), name: p.name, canApply: false });
    }
  }
  if (demoActive()) out.push({ browser: "demo", browserName: "Sample bookmarks", kind: "demo", profile: "demo", name: "demo mode", canApply: true });
  return out;
}

function locate(browserId, profile) {
  if (typeof browserId !== "string" || typeof profile !== "string" || !profile || /[\\/]|^\.\.?$/.test(profile)) throw bad("Pick a browser profile from the list.");
  if (browserId === "demo") {
    if (!demoActive()) throw bad("The sample bookmarks are only there in demo mode.");
    const file = path.join(DEMO_DIR(), "Bookmarks");
    if (!fs.existsSync(file)) { fs.mkdirSync(DEMO_DIR(), { recursive: true }); fs.copyFileSync(DEMO_FIXTURE, file); }
    return { b: { id: "demo", name: "Sample bookmarks", kind: "demo", proc: null }, file };
  }
  const b = browsers().find((x) => x.id === browserId);
  if (!b) throw bad("Unknown browser.");
  const src = sources().find((s) => s.browser === browserId && s.profile === profile);
  if (!src) throw bad("That browser profile was not found on this computer.", 404);
  if (b.kind === "chromium") return { b, file: path.join(b.dir, profile, "Bookmarks") };
  const p = parseProfilesIni(fs.readFileSync(path.join(b.dir, "profiles.ini"), "utf8"), b.dir).find((x) => path.basename(x.dir) === profile);
  return { b, file: path.join(p.dir, "places.sqlite") };
}

// Is the browser running? true / false, or null when it could not be checked (then nothing is applied).
export function isRunning(b) {
  if (!b.proc) return Promise.resolve(false);
  if (process.env.CC_BROWSER_HOME) { // tests: a fake process list next to the fake profiles
    let list = ""; try { list = fs.readFileSync(path.join(process.env.CC_BROWSER_HOME, "running.txt"), "utf8"); } catch {}
    return Promise.resolve(list.split(/[\s,]+/).includes(b.id));
  }
  if (process.platform === "win32") return new Promise((res) => execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${b.proc}`, "/NH"], { windowsHide: true }, (e, so) => res(e ? null : new RegExp(b.proc.replace(/\./g, "\\."), "i").test(so || ""))));
  return new Promise((res) => execFile("pgrep", ["-x", b.proc], (e) => res(!e ? true : e.code === 1 ? false : null)));
}

// ---------- reading ----------
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const ROOT_LABEL = { bookmark_bar: "Bookmarks bar", other: "Other bookmarks", synced: "Mobile bookmarks" };

export function flattenChromium(data) {
  const items = [];
  const walk = (n, trail, root) => {
    for (const c of n.children || []) {
      if (c.type === "url") items.push({ id: `n${c.id}`, title: String(c.name || ""), url: String(c.url || ""), path: trail.join(" / "), root });
      else if (c.type === "folder") walk(c, [...trail, String(c.name || "")], root);
    }
  };
  for (const [k, r] of Object.entries(data?.roots || {})) if (r && typeof r === "object" && Array.isArray(r.children)) walk(r, [ROOT_LABEL[k] || r.name || k], k);
  return items;
}

const FX_ROOTS = { toolbar_____: "Bookmarks toolbar", menu________: "Bookmarks menu", unfiled_____: "Other bookmarks", mobile______: "Mobile bookmarks" };
export function readFirefox(file) {
  if (!DatabaseSync) throw bad("Reading Firefox needs a newer runtime (node:sqlite).", 501);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fx-"));
  try {
    try {
      fs.copyFileSync(file, path.join(tmp, "places.sqlite"));
      for (const ext of ["-wal"]) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, path.join(tmp, "places.sqlite" + ext));
    } catch (e) { throw bad(`Could not copy Firefox's bookmarks (${e.code || e.message}). Close Firefox and try again.`, 409, "browser_running"); }
    const db = new DatabaseSync(path.join(tmp, "places.sqlite"), { readOnly: true });
    try {
      const folders = new Map(db.prepare("SELECT id, title, parent, guid FROM moz_bookmarks WHERE type = 2").all().map((r) => [r.id, r]));
      const trail = (id) => { const t = []; let root = null; for (let i = 0, cur = folders.get(id); cur && i < 50; i++, cur = folders.get(cur.parent)) { if (cur.guid === "tags________") return null; if (FX_ROOTS[cur.guid]) { root = cur.guid; t.unshift(FX_ROOTS[cur.guid]); break; } if (cur.guid !== "root________") t.unshift(String(cur.title || "")); } return root ? { path: t.join(" / "), root } : null; };
      const rows = db.prepare("SELECT b.id AS id, b.title AS title, b.parent AS parent, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 ORDER BY b.parent, b.position").all();
      const out = [];
      for (const r of rows) { const t = trail(r.parent); if (!t) continue; out.push({ id: `f${r.id}`, title: String(r.title || ""), url: String(r.url || ""), path: t.path, root: t.root }); }
      return out;
    } finally { db.close(); }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// Drafts live in memory only: the bookmarks themselves are never written to the app's own files.
const drafts = new Map();
const newId = (p) => `${p}${crypto.randomBytes(6).toString("hex")}`;

export function duplicates(items) {
  const by = new Map();
  for (const it of items) if (/^https?:/i.test(it.url)) (by.get(it.url) || by.set(it.url, []).get(it.url)).push(it.id);
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([url, ids]) => ({ url, items: ids }));
}

export async function read({ browser, profile, allow }) {
  if (HOSTED) throw bad("Organizing bookmarks works in the desktop app on your own computer.", 409);
  if (allow !== true) throw bad("Tick allow first: Meldmind reads this browser's bookmarks only with your OK.");
  const { b, file } = locate(browser, profile);
  let items, synced = false, hash = null;
  if (b.kind === "firefox") items = readFirefox(file);
  else {
    const buf = fs.readFileSync(file);
    let data; try { data = JSON.parse(buf.toString("utf8")); } catch { throw bad("That Bookmarks file could not be read (not valid JSON)."); }
    items = flattenChromium(data); synced = !!data.sync_metadata; hash = sha(buf);
  }
  if (items.length > MAX_ITEMS) throw bad(`That profile has ${items.length} bookmarks; this version sorts up to ${MAX_ITEMS} at a time.`);
  const d = { id: newId("bm_"), browser: b.id, browserName: b.name, kind: b.kind, profile, file, hash, synced, items, readAt: Date.now(), proposal: null, cost: 0 };
  drafts.set(d.id, d);
  for (const k of [...drafts.keys()].slice(0, -5)) drafts.delete(k); // keep the last few
  return draftView(d);
}

export function draftView(d) {
  return { id: d.id, browser: d.browser, browserName: d.browserName, kind: d.kind, profile: d.profile, synced: d.synced, canApply: d.kind !== "firefox", count: d.items.length, items: d.items, duplicates: duplicates(d.items), proposal: d.proposal, cost: d.cost, readAt: d.readAt };
}
function draft(id) { const d = drafts.get(String(id || "")); if (!d) throw bad("Read the bookmarks again (that list is no longer open).", 404); return d; }

// ---------- sorting with the AI the person picked ----------
// Only the scheme, host and path go out: query strings and fragments can carry tokens or session ids.
export function cleanUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return x.protocol === "javascript:" ? "(bookmarklet)" : `${x.protocol}(local page)`;
    return `${x.protocol}//${x.host}${x.pathname}`.slice(0, 140);
  } catch { return "(not a web address)"; }
}
const clip = (s, n) => String(s || "").replace(/[\s|]+/g, " ").trim().slice(0, n);
export const lineFor = (it) => `${it.id} | ${clip(it.title, 90) || "(no title)"} | ${cleanUrl(it.url)}`;

export const SYSTEM = `You sort browser bookmarks into folders by topic.
Make 4 to 12 folders with short, clear names (1 to 3 words) a person would pick, for example their business name, Insurance, Banking, Tools, Social, Shopping, News.
When several bookmarks belong to the person's own business or one main brand, name that folder after it.
Put every bookmark id in exactly one folder. Use only the ids given. Do not invent ids.
Reply with JSON only: {"folders":[{"name":"Banking","items":["n12","n14"]}]}`;

export function models(d) {
  const lines = d ? d.items.map(lineFor) : [];
  const batches = Math.max(1, Math.ceil(lines.length / BATCH));
  const inTok = Math.ceil((lines.join("\n").length + batches * (SYSTEM.length + 300)) / 4);
  const outTok = Math.ceil(lines.length * 7 + batches * 60);
  const capped = doc("alerts.state", () => undefined)?.stop || [];
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    if (p.kind !== "text" || !hasSecret(p.id, p.keyEnv)) continue;
    for (const m of p.models || []) out.push({ provider: p.id, providerName: p.name, model: m.id, name: m.name, tier: m.tier || null, demo: !!p.demo, capped: capped.includes(p.id), estCost: +estimateCost(m.id, inTok, outTok).toFixed(5) });
  }
  const c = cheapest(60);
  const pick = c && out.find((m) => m.provider === c.provider && m.model === c.model && !m.capped);
  return { models: out, suggested: pick ? { provider: pick.provider, model: pick.model } : out.find((m) => !m.capped) || null, estimate: { inTok, outTok, batches } };
}

export const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

export async function categorize({ draft: id, provider, model, business }) {
  const d = draft(id);
  const p = PROVIDERS[provider];
  if (!p || p.kind !== "text" || !p.models?.some((m) => m.id === model)) throw bad("Pick the AI to sort with from the list.");
  if (!hasSecret(p.id, p.keyEnv)) throw bad(`There is no key for ${p.name}. Add one in Settings first.`, 409);
  if ((doc("alerts.state", () => undefined)?.stop || []).includes(p.id)) throw bad(`${p.name} has reached its monthly spend cap. Pick another AI or raise the cap.`, 409, "cap");
  const biz = cleanName(business);
  const ids = new Set(d.items.map((x) => x.id));
  const folders = new Map(); // lower name -> { name, items: [] }
  const placed = new Set();
  let cost = 0, calls = 0;
  for (let i = 0; i < d.items.length; i += BATCH) {
    const batch = d.items.slice(i, i + BATCH);
    const known = [...folders.values()].map((f) => f.name);
    const user = [biz ? `BUSINESS: ${biz}` : "", known.length ? `FOLDERS SO FAR (reuse them where they fit): ${known.join(", ")}` : "", "BOOKMARKS (id | title | address):", ...batch.map(lineFor)].filter(Boolean).join("\n");
    const t0 = Date.now();
    let r;
    // the person's chosen AI only: no smart fallback here, so the list never reaches another provider
    try { r = await complete({ provider: p.id, model, system: SYSTEM, maxTokens: Math.min(4000, 200 + batch.length * 12), messages: [{ role: "user", content: user }] }); }
    catch (e) { noteCall(p.id, false, Date.now() - t0, e); throw bad(`${p.name} could not sort the bookmarks: ${clip(e.message, 200)}`, 502); }
    const ms = Date.now() - t0;
    noteCall(p.id, true, ms);
    const e = recordCall({ provider: p.id, model, usage: r.usage, missionId: d.id, role: "bookmarks", ms });
    cost += e.cost || 0; calls++;
    const j = extractJson(r.text);
    for (const f of Array.isArray(j?.folders) ? j.folders : []) {
      const name = cleanName(f?.name);
      if (!name || !Array.isArray(f.items)) continue;
      const key = name.toLowerCase();
      const slot = folders.get(key) || folders.set(key, { name, items: [] }).get(key);
      for (const x of f.items) { const xid = String(x); if (ids.has(xid) && !placed.has(xid)) { placed.add(xid); slot.items.push(xid); } }
    }
  }
  const left = d.items.filter((x) => !placed.has(x.id)).map((x) => x.id);
  if (left.length) { const o = folders.get("other") || folders.set("other", { name: "Other", items: [] }).get("other"); o.items.push(...left); }
  d.cost = +(d.cost + cost).toFixed(6);
  d.proposal = { folders: [...folders.values()].filter((f) => f.items.length), by: { provider: p.id, model, name: p.models.find((m) => m.id === model).name, providerName: p.name }, calls, cost: +cost.toFixed(6), unplaced: left.length, at: Date.now() };
  emit("log", { text: `Bookmarks sorted into ${d.proposal.folders.length} folders by ${p.name} (${d.items.length} bookmarks, ${calls} call${calls === 1 ? "" : "s"}).` });
  return draftView(d);
}

// ---------- the plan the person approved ----------
// plan: { folders: [{ name, items: [ids] }], merge: [urls], where: "bar" | "other", removeEmpty }
export function checkPlan(d, plan) {
  const ids = new Set(d.items.map((x) => x.id));
  const seen = new Set();
  const folders = [];
  for (const f of Array.isArray(plan?.folders) ? plan.folders : []) {
    const name = cleanName(f?.name);
    const items = (Array.isArray(f?.items) ? f.items : []).map(String).filter((x) => ids.has(x) && !seen.has(x) && seen.add(x));
    if (!items.length) continue;
    if (!name) throw bad("Every folder needs a name.");
    const same = folders.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (same) same.items.push(...items); else folders.push({ name, items });
  }
  if (!folders.length) throw bad("Nothing to apply: every bookmark is unticked.");
  const dupes = new Map(duplicates(d.items).map((x) => [x.url, x.items]));
  const merge = [...new Set((Array.isArray(plan?.merge) ? plan.merge : []).map(String))];
  for (const u of merge) if (!dupes.has(u)) throw bad("Only listed duplicates can be merged.");
  return { folders, merge: merge.map((u) => ({ url: u, items: dupes.get(u) })), where: plan?.where === "other" ? "other" : "bar", removeEmpty: plan?.removeEmpty !== false };
}

const chromeNow = () => String(BigInt(Date.now()) * 1000n + 11644473600000000n);
// Returns a new Bookmarks object. Moved bookmarks keep their own id, guid, dates and meta info; only exact
// duplicates the person ticked are dropped, and every other bookmark ends up somewhere.
export function applyPlan(data, plan) {
  const out = JSON.parse(JSON.stringify(data));
  const parentOf = new Map(), nodeOf = new Map();
  let maxId = 0;
  const index = (n, parent) => { maxId = Math.max(maxId, Number(n.id) || 0); if (parent) parentOf.set(n, parent); if (n.type === "url") nodeOf.set(`n${n.id}`, n); for (const c of n.children || []) index(c, n); };
  const roots = Object.entries(out.roots || {}).filter(([, r]) => r && typeof r === "object" && Array.isArray(r.children));
  for (const [, r] of roots) index(r, null);
  const before = nodeOf.size;
  const moving = new Set(plan.folders.flatMap((f) => f.items));
  // duplicates: keep the first one being moved (else the first in the file), drop the rest
  const drop = new Set();
  for (const m of plan.merge) { const keep = m.items.find((x) => moving.has(x)) || m.items[0]; for (const x of m.items) if (x !== keep) drop.add(x); }
  for (const x of drop) moving.delete(x);
  const roots0 = new Set(roots.map(([, r]) => r));
  const touched = new Set();
  for (const id of [...moving, ...drop]) {
    const n = nodeOf.get(id); const par = n && parentOf.get(n);
    if (!par) continue;
    par.children = par.children.filter((c) => c !== n);
    touched.add(par);
  }
  // folders emptied by this move (never ones that were empty before), when the person allows it
  const removedFolders = [];
  if (plan.removeEmpty) {
    let again = true;
    while (again) {
      again = false;
      for (const f of [...touched]) {
        if (roots0.has(f) || (f.children || []).length) continue;
        const par = parentOf.get(f); if (!par) continue;
        par.children = par.children.filter((c) => c !== f); touched.delete(f); touched.add(par); removedFolders.push(f.name); again = true;
      }
    }
  }
  const target = plan.where === "other" ? out.roots.other : out.roots.bookmark_bar;
  if (!target) throw bad("That profile has no bookmarks bar to put the folders on.");
  const now = chromeNow();
  const created = [];
  for (const f of plan.folders) {
    const nodes = f.items.filter((x) => moving.has(x)).map((x) => nodeOf.get(x)).filter(Boolean);
    if (!nodes.length) continue;
    let folder = target.children.find((c) => c.type === "folder" && String(c.name).toLowerCase() === f.name.toLowerCase());
    if (!folder) { folder = { children: [], date_added: now, date_last_used: "0", date_modified: now, guid: crypto.randomUUID(), id: String(++maxId), name: f.name, type: "folder" }; created.push(folder); }
    else folder.date_modified = now;
    folder.children.push(...nodes);
  }
  target.children = [...created, ...target.children];
  delete out.checksum; // Chromium recomputes it; with a stale checksum it would treat the file as damaged
  const after = flattenChromium(out).length;
  if (after !== before - drop.size) throw bad(`Safety check failed (${before} bookmarks before, ${after} after, ${drop.size} duplicates merged). Nothing was changed.`, 500);
  return { data: out, moved: moving.size, merged: drop.size, folders: plan.folders.length, removedFolders };
}

export function importHtml(d, plan) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const by = new Map(d.items.map((x) => [x.id, x]));
  const moving = new Set(plan.folders.flatMap((f) => f.items));
  const drop = new Set(plan.merge.flatMap((m) => { const keep = m.items.find((x) => moving.has(x)) || m.items[0]; return m.items.filter((x) => x !== keep); }));
  const out = ["<!DOCTYPE NETSCAPE-Bookmark-file-1>", '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", "<DL><p>", "    <DT><H3>Organized by Meldmind</H3>", "    <DL><p>"];
  for (const f of plan.folders) {
    out.push(`        <DT><H3>${esc(f.name)}</H3>`, "        <DL><p>");
    for (const id of f.items) { const it = by.get(id); if (it && !drop.has(id) && /^https?:/i.test(it.url)) out.push(`            <DT><A HREF="${esc(it.url)}">${esc(it.title || it.url)}</A>`); }
    out.push("        </DL><p>");
  }
  out.push("    </DL><p>", "</DL><p>");
  return out.join("\n");
}

// ---------- apply and undo ----------
const history = () => doc(HISTORY, () => []);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const safe = (s) => String(s).replace(/[^\w-]+/g, "_");

async function mustBeClosed(b) {
  const r = await isRunning(b);
  if (r === null) throw bad(`Could not check whether ${b.name} is running. Close it and try again.`, 409, "browser_running");
  if (r) throw bad(`${b.name} is open. Close every ${b.name} window first (it rewrites its bookmarks file while it runs), then click again.`, 409, "browser_running");
}

export async function apply({ draft: id, plan, allowSynced }) {
  if (HOSTED) throw bad("Organizing bookmarks works in the desktop app on your own computer.", 409);
  const d = draft(id);
  if (d.kind === "firefox") throw bad("Firefox bookmarks cannot be rewritten safely. Download the import file instead (Firefox: Bookmarks > Manage bookmarks > Import and Backup > Import from HTML).", 409, "export_only");
  const p = checkPlan(d, plan);
  const { b, file } = locate(d.browser, d.profile);
  await mustBeClosed(b);
  const buf = fs.readFileSync(file);
  if (sha(buf) !== d.hash) throw bad("The bookmarks changed since they were read. Read them again, then apply.", 409, "changed");
  if (d.synced && allowSynced !== true) throw bad(`This ${b.name} profile syncs bookmarks with an account. The browser may put the old layout back or duplicate items from the cloud. Tick "apply anyway" to go ahead (the backup and Undo stay available), or download the import file instead.`, 409, "synced");
  const r = applyPlan(JSON.parse(buf.toString("utf8")), p);
  // back up first: next to the file and in the app data folder
  const st = stamp();
  const backupNext = `${file}.command-ai-backup-${st}`;
  fs.mkdirSync(BACKUP_DIR(), { recursive: true });
  const backupLocal = path.join(BACKUP_DIR(), `${safe(b.id)}-${safe(d.profile)}-${st}.json`);
  fs.copyFileSync(file, backupNext); fs.copyFileSync(file, backupLocal);
  if (sha(fs.readFileSync(backupLocal)) !== d.hash || sha(fs.readFileSync(backupNext)) !== d.hash) throw bad("The backup could not be verified. Nothing was changed.", 500);
  const text = JSON.stringify(r.data, null, 3);
  const tmp = `${file}.command-ai-tmp`;
  fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
  const entry = { id: newId("ba_"), browser: b.id, browserName: b.name, profile: d.profile, file, backupNext, backupLocal, writtenHash: sha(Buffer.from(text)), at: Date.now(), moved: r.moved, merged: r.merged, folders: r.folders, removedFolders: r.removedFolders.length, undoneAt: null };
  putDoc(HISTORY, [entry, ...history()].slice(0, 20));
  drafts.delete(d.id);
  emit("log", { text: `Bookmarks organized in ${b.name} (${d.profile}): ${r.moved} moved into ${r.folders} folders${r.merged ? `, ${r.merged} duplicates merged` : ""}. Backup saved; Undo is in Settings.` });
  return { applied: historyView(entry) };
}

export async function undo({ id, force }) {
  if (HOSTED) throw bad("Organizing bookmarks works in the desktop app on your own computer.", 409);
  const list = history();
  const e = list.find((x) => x.id === id);
  if (!e) throw bad("That change was not found.", 404);
  if (e.undoneAt) throw bad("That change was already undone.", 409, "undone");
  const b = e.browser === "demo" ? { id: "demo", name: "Sample bookmarks", proc: null } : browsers().find((x) => x.id === e.browser);
  if (!b) throw bad("Unknown browser.");
  await mustBeClosed(b);
  const src = [e.backupLocal, e.backupNext].find((f) => { try { JSON.parse(fs.readFileSync(f, "utf8")); return true; } catch { return false; } });
  if (!src) throw bad("The backup files are gone, so this cannot be undone.", 410);
  const now = fs.existsSync(e.file) ? fs.readFileSync(e.file) : null;
  if (now && sha(now) !== e.writtenHash && force !== true) throw bad("The bookmarks changed after they were organized. Undo puts back the old file and loses those later changes (a copy of the current file is kept next to it). Click Undo anyway to go ahead.", 409, "changed_since");
  if (now) fs.copyFileSync(e.file, `${e.file}.command-ai-before-undo-${stamp()}`);
  const tmp = `${e.file}.command-ai-tmp`;
  fs.copyFileSync(src, tmp); fs.renameSync(tmp, e.file);
  e.undoneAt = Date.now();
  putDoc(HISTORY, list);
  emit("log", { text: `Bookmarks in ${e.browserName} (${e.profile}) put back as they were before.` });
  return { undone: historyView(e) };
}

const historyView = (e) => ({ id: e.id, browser: e.browser, browserName: e.browserName, profile: e.profile, at: e.at, moved: e.moved, merged: e.merged, folders: e.folders, removedFolders: e.removedFolders, undoneAt: e.undoneAt, backup: e.backupLocal, backupNext: e.backupNext });

export function view() {
  return { hosted: HOSTED, sources: HOSTED ? [] : sources(), history: HOSTED ? [] : history().map(historyView), firefoxReadable: !!DatabaseSync };
}

export function exportHtml({ draft: id, plan }) { const d = draft(id); return importHtml(d, checkPlan(d, plan)); }
export const getDraft = (id) => draftView(draft(id));
export const modelsFor = (id) => models(id ? draft(id) : null);
