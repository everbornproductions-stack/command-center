// First-run discovery (all opt-in, all local):
//  1. scan browser history to find which AIs and creative tools this person actually uses
//  2. look for API keys already on this PC (environment variables)
//  3. build an "🤖 AI" bookmark folder from what was found, as an import file or applied to Chrome
//  4. open each provider's API-key page so the person can paste the key in
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, exec } from "node:child_process";
// node:sqlite ships with Node 22.13+ / 24; older runtimes just lose the history scan.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }
import { PROVIDERS } from "./registry.js";
import { DATA_DIR, readJson } from "./paths.js";

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const BROWSERS = [
  { id: "chrome", name: "Google Chrome", dir: path.join(LOCAL, "Google", "Chrome", "User Data"), exe: [path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"), path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"), path.join(LOCAL, "Google", "Chrome", "Application", "chrome.exe")], proc: "chrome.exe" },
  { id: "edge", name: "Microsoft Edge", dir: path.join(LOCAL, "Microsoft", "Edge", "User Data"), exe: [path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe")], proc: "msedge.exe" },
  { id: "brave", name: "Brave", dir: path.join(LOCAL, "BraveSoftware", "Brave-Browser", "User Data"), exe: [path.join(process.env.ProgramFiles || "C:\\Program Files", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")], proc: "brave.exe" },
];

// domain → what it is. provider = id in registry; otherwise a tool we only bookmark/track.
export const DOMAIN_MAP = [
  { m: /(^|\.)claude\.ai$|(^|\.)claude\.com$|(^|\.)anthropic\.com$/, provider: "anthropic", name: "Claude", cat: "Chat & Agents" },
  { m: /(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, provider: "openai", name: "ChatGPT", cat: "Chat & Agents" },
  { m: /(^|\.)grok\.com$|(^|\.)x\.ai$|(^|\.)grokipedia\.com$/, provider: "xai", name: "Grok", cat: "Chat & Agents" },
  { m: /^gemini\.google\.com$|^aistudio\.google\.com$|^notebooklm\.google\.com$/, provider: "google", name: "Gemini", cat: "Chat & Agents" },
  { m: /^flow\.google\.com$|^labs\.google$/, provider: "flow", name: "Google Flow (Veo)", cat: "Video & Image" },
  { m: /(^|\.)perplexity\.ai$/, provider: "perplexity", name: "Perplexity", cat: "Chat & Agents" },
  { m: /(^|\.)openrouter\.ai$/, provider: "openrouter", name: "OpenRouter", cat: "Chat & Agents" },
  { m: /(^|\.)deepseek\.com$/, provider: "deepseek", name: "DeepSeek", cat: "Chat & Agents" },
  { m: /(^|\.)groq\.com$/, provider: "groq", name: "Groq", cat: "Chat & Agents" },
  { m: /(^|\.)mistral\.ai$/, provider: "mistral", name: "Mistral", cat: "Chat & Agents" },
  { m: /(^|\.)kling\.ai$|(^|\.)klingai\.com$/, provider: "kling", name: "Kling AI", cat: "Video & Image" },
  { m: /(^|\.)suno\.com$|(^|\.)suno\.ai$/, provider: "suno", name: "Suno", cat: "Music & Audio" },
  { m: /(^|\.)sync\.so$/, provider: "syncso", name: "Sync.so", cat: "Video & Image" },
  { m: /(^|\.)hedra\.com$/, provider: "hedra", name: "Hedra", cat: "Video & Image" },
  { m: /(^|\.)elevenlabs\.io$/, provider: "elevenlabs", name: "ElevenLabs", cat: "Music & Audio" },
  { m: /(^|\.)cursor\.com$|(^|\.)cursor\.sh$/, provider: "cursor", name: "Cursor", cat: "Dev & Automation" },
  { m: /(^|\.)capcut\.com$/, provider: "capcut", name: "CapCut", cat: "Video & Image" },
  // tools without a provider entry: bookmarked and offered as subscriptions to track
  { m: /(^|\.)lovable\.dev$|(^|\.)lovable\.app$/, name: "Lovable", cat: "Dev & Automation", url: "https://lovable.dev" },
  { m: /(^|\.)magnific\.com$/, name: "Magnific", cat: "Video & Image", url: "https://magnific.com" },
  { m: /(^|\.)openart\.ai$/, name: "OpenArt", cat: "Video & Image", url: "https://openart.ai" },
  { m: /(^|\.)davinci\.ai$/, name: "DaVinci AI", cat: "Video & Image", url: "https://davinci.ai" },
  { m: /(^|\.)runwayml\.com$/, name: "Runway", cat: "Video & Image", url: "https://app.runwayml.com" },
  { m: /(^|\.)lumalabs\.ai$/, name: "Luma", cat: "Video & Image", url: "https://lumalabs.ai" },
  { m: /(^|\.)midjourney\.com$/, name: "Midjourney", cat: "Video & Image", url: "https://www.midjourney.com" },
  { m: /(^|\.)ideogram\.ai$/, name: "Ideogram", cat: "Video & Image", url: "https://ideogram.ai" },
  { m: /(^|\.)leonardo\.ai$/, name: "Leonardo", cat: "Video & Image", url: "https://leonardo.ai" },
  { m: /(^|\.)pika\.art$/, name: "Pika", cat: "Video & Image", url: "https://pika.art" },
  { m: /(^|\.)heygen\.com$/, name: "HeyGen", cat: "Video & Image", url: "https://www.heygen.com" },
  { m: /(^|\.)higgsfield\.ai$/, name: "Higgsfield", cat: "Video & Image", url: "https://higgsfield.ai" },
  { m: /(^|\.)krea\.ai$/, name: "Krea", cat: "Video & Image", url: "https://www.krea.ai" },
  { m: /(^|\.)descript\.com$/, name: "Descript", cat: "Video & Image", url: "https://www.descript.com" },
  { m: /(^|\.)udio\.com$/, name: "Udio", cat: "Music & Audio", url: "https://www.udio.com" },
  { m: /(^|\.)play\.ht$|(^|\.)murf\.ai$/, name: "Voice AI", cat: "Music & Audio", url: "https://play.ht" },
  { m: /(^|\.)poe\.com$/, name: "Poe", cat: "Chat & Agents", url: "https://poe.com" },
  { m: /(^|\.)character\.ai$/, name: "Character.ai", cat: "Chat & Agents", url: "https://character.ai" },
  { m: /^copilot\.microsoft\.com$/, name: "Microsoft Copilot", cat: "Chat & Agents", url: "https://copilot.microsoft.com" },
  { m: /(^|\.)meta\.ai$/, name: "Meta AI", cat: "Chat & Agents", url: "https://www.meta.ai" },
  { m: /(^|\.)manus\.im$/, name: "Manus", cat: "Chat & Agents", url: "https://manus.im" },
  { m: /(^|\.)genspark\.ai$/, name: "Genspark", cat: "Chat & Agents", url: "https://www.genspark.ai" },
  { m: /(^|\.)abacus\.ai$/, name: "Abacus ChatLLM", cat: "Chat & Agents", url: "https://chatllm.abacus.ai" },
  { m: /(^|\.)polsia\.com$/, name: "Polsia", cat: "Chat & Agents", url: "https://polsia.com" },
  { m: /(^|\.)wisprflow\.ai$/, name: "Wispr Flow", cat: "Chat & Agents", url: "https://wisprflow.ai" },
  { m: /(^|\.)replicate\.com$|(^|\.)fal\.ai$|(^|\.)huggingface\.co$/, name: "Model hosts (Replicate / fal / HF)", cat: "Dev & Automation", url: "https://replicate.com" },
  { m: /(^|\.)v0\.dev$|(^|\.)bolt\.new$|(^|\.)replit\.com$/, name: "AI app builders", cat: "Dev & Automation", url: "https://v0.dev" },
  { m: /^github\.com$/, name: "GitHub", cat: "Dev & Automation", url: "https://github.com" },
  { m: /(^|\.)zapier\.com$/, name: "Zapier", cat: "Dev & Automation", url: "https://zapier.com/app/zaps" },
  { m: /(^|\.)make\.com$|(^|\.)n8n\.io$|(^|\.)n8n\.cloud$/, name: "Make / n8n", cat: "Dev & Automation", url: "https://www.make.com" },
  { m: /(^|\.)canva\.com$/, name: "Canva", cat: "Video & Image", url: "https://www.canva.com" },
];

// Chrome stores microseconds since 1601 (too big for a JS number), so the SQL casts to seconds.
const CHROME_EPOCH_S = 11644473600;
function chromeSeconds(ms) { return Math.floor(ms / 1000) + CHROME_EPOCH_S; }
function fromChromeSeconds(s) { return (s - CHROME_EPOCH_S) * 1000; }

export function browserProfiles() {
  const out = [];
  for (const b of BROWSERS) {
    if (!fs.existsSync(b.dir)) continue;
    const ls = readJson(path.join(b.dir, "Local State"), {});
    const cache = ls?.profile?.info_cache || {};
    for (const [dir, info] of Object.entries(cache)) {
      const hist = path.join(b.dir, dir, "History");
      if (!fs.existsSync(hist)) continue;
      const bm = path.join(b.dir, dir, "Bookmarks");
      const bmJson = fs.existsSync(bm) ? readJson(bm, null) : null;
      out.push({ browser: b.id, browserName: b.name, dir, name: info.name || dir, email: info.user_name || null, history: hist, bookmarks: bm, bookmarkCount: bmJson ? countUrls(bmJson.roots) : 0, synced: !!bmJson?.sync_metadata, lastUsed: fs.statSync(hist).mtimeMs });
    }
    if (!Object.keys(cache).length && fs.existsSync(path.join(b.dir, "Default", "History"))) out.push({ browser: b.id, browserName: b.name, dir: "Default", name: "Default", email: null, history: path.join(b.dir, "Default", "History"), bookmarks: path.join(b.dir, "Default", "Bookmarks"), bookmarkCount: 0, synced: false, lastUsed: Date.now() });
  }
  return out.sort((a, b) => b.lastUsed - a.lastUsed);
}
function countUrls(roots) {
  const walk = (n) => (!n ? 0 : n.type === "url" ? 1 : (n.children || []).reduce((a, c) => a + walk(c), 0));
  return Object.values(roots || {}).reduce((a, r) => a + (r && typeof r === "object" && !Array.isArray(r) ? walk(r) : 0), 0);
}

function withCopy(file, fn) {
  if (!DatabaseSync) throw new Error("history scan needs Node 22.13+ (node:sqlite)");
  const tmp = path.join(os.tmpdir(), `cc-hist-${crypto.randomBytes(6).toString("hex")}.db`);
  fs.copyFileSync(file, tmp);
  try { const db = new DatabaseSync(tmp, { readOnly: true }); try { return fn(db); } finally { db.close(); } }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

// Scan history across every profile. Nothing leaves the machine; the copies are deleted right after.
export function scanHistory({ days = 180 } = {}) {
  const since = chromeSeconds(Date.now() - days * 86400000);
  const found = new Map(); // key → { provider?, name, cat, url, visits, lastVisit, profiles:Set, domains:Set }
  const profiles = browserProfiles();
  const scanned = [];
  for (const p of profiles) {
    try {
      withCopy(p.history, (db) => {
        const rows = db.prepare("SELECT url, visit_count, CAST(last_visit_time / 1000000 AS INTEGER) AS lv FROM urls WHERE last_visit_time / 1000000 > ?").all(since);
        let hits = 0;
        for (const r of rows) {
          let host; try { host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
          const d = DOMAIN_MAP.find((x) => x.m.test(host));
          if (!d) continue;
          hits++;
          const key = d.provider || d.name;
          const e = found.get(key) || { provider: d.provider || null, name: d.name, cat: d.cat, url: d.url || PROVIDERS[d.provider]?.links?.app || `https://${host}`, visits: 0, lastVisit: 0, profiles: new Set(), domains: new Set() };
          e.visits += r.visit_count || 1;
          e.lastVisit = Math.max(e.lastVisit, fromChromeSeconds(r.lv));
          e.profiles.add(`${p.browserName} · ${p.name}`);
          e.domains.add(host);
          found.set(key, e);
        }
        scanned.push({ ...p, hits, rows: rows.length });
      });
    } catch (e) { scanned.push({ ...p, error: e.message }); }
  }
  const list = [...found.values()].map((e) => ({ ...e, profiles: [...e.profiles], domains: [...e.domains].slice(0, 4) })).sort((a, b) => b.visits - a.visits);
  return { days, scanned: scanned.map((s) => ({ browser: s.browserName, profile: s.name, email: s.email, hits: s.hits || 0, error: s.error || null, synced: s.synced, bookmarkCount: s.bookmarkCount, dir: s.dir, browserId: s.browser })), providers: list.filter((e) => e.provider), tools: list.filter((e) => !e.provider) };
}

// Keys already on this PC: process env + the user's / machine's registry environment.
export async function detectKeys() {
  const names = Object.values(PROVIDERS).filter((p) => p.keyEnv).map((p) => p.keyEnv);
  const found = {};
  for (const p of Object.values(PROVIDERS)) if (p.keyEnv && process.env[p.keyEnv]) found[p.id] = { source: "environment", value: process.env[p.keyEnv] };
  if (process.platform === "win32") {
    const script = names.map((n) => `$u=[Environment]::GetEnvironmentVariable('${n}','User'); if($u){"${n}=user="+$u}; $m=[Environment]::GetEnvironmentVariable('${n}','Machine'); if($m){"${n}=machine="+$m}`).join("; ");
    const out = await new Promise((res) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }, (e, so) => res(so || "")));
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(\w+)=(user|machine)=(.+)$/);
      if (!m) continue;
      const prov = Object.values(PROVIDERS).find((p) => p.keyEnv === m[1]);
      if (prov && !found[prov.id]) found[prov.id] = { source: `${m[2]} environment variable ${m[1]}`, value: m[3].trim() };
    }
  }
  // never return the secret itself to the UI: only where it was found and a mask
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { source: v.source, masked: v.value.length > 8 ? `${v.value.slice(0, 4)}…${v.value.slice(-4)}` : "••••", _value: v.value }]));
}

// ---------- bookmarks ----------
export function buildAiFolder(scan, extraLinks = []) {
  const cats = {};
  const add = (cat, name, url) => { (cats[cat] ||= []).push({ name, url }); };
  for (const e of [...scan.providers, ...scan.tools]) add(e.cat, e.name, e.url);
  for (const e of scan.providers) {
    const p = PROVIDERS[e.provider]; if (!p?.links) continue;
    if (p.links.billing) add("Billing & Usage", `${p.name} billing`, p.links.billing);
    if (p.links.keys) add("Billing & Usage", `${p.name} API keys`, p.links.keys);
  }
  for (const l of extraLinks) add(l.cat || "Chat & Agents", l.name, l.url);
  add("Chat & Agents", "Meldmind", `http://localhost:${process.env.CC_PORT || 4747}`);
  const order = ["Chat & Agents", "Video & Image", "Music & Audio", "Dev & Automation", "Billing & Usage"];
  return order.filter((c) => cats[c]?.length).map((c) => ({ name: c, links: dedupe(cats[c]) }));
}
function dedupe(links) { const seen = new Set(); return links.filter((l) => { const k = l.url.replace(/\/$/, ""); if (seen.has(k)) return false; seen.add(k); return true; }); }

export function bookmarksHtml(folder) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const out = ["<!DOCTYPE NETSCAPE-Bookmark-file-1>", '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', "<TITLE>Bookmarks</TITLE>", "<H1>Bookmarks</H1>", "<DL><p>", "    <DT><H3>🤖 AI</H3>", "    <DL><p>"];
  for (const c of folder) { out.push(`        <DT><H3>${esc(c.name)}</H3>`, "        <DL><p>"); for (const l of c.links) out.push(`            <DT><A HREF="${esc(l.url)}">${esc(l.name)}</A>`); out.push("        </DL><p>"); }
  out.push("    </DL><p>", "</DL><p>");
  return out.join("\n");
}

const now = () => String(Math.round(Date.now() * 1000 + 11644473600000000));
let nextId = 0;
function node(name, url, children) {
  const base = { date_added: now(), date_last_used: "0", guid: crypto.randomUUID(), id: String(++nextId), name };
  return url ? { ...base, type: "url", url } : { ...base, type: "folder", date_modified: now(), children };
}
function maxId(n, m = 0) { m = Math.max(m, Number(n.id) || 0); for (const c of n.children || []) m = maxId(c, m); return m; }

// Insert/replace the 🤖 AI folder at the front of the bookmarks bar. Everything else is untouched.
export async function applyToBrowser({ browserId, profileDir, folder }) {
  const b = BROWSERS.find((x) => x.id === browserId); if (!b) throw new Error("unknown browser");
  const file = path.join(b.dir, profileDir, "Bookmarks");
  const data = fs.existsSync(file) ? readJson(file, null) : null;
  if (!data) throw new Error("no Bookmarks file for that profile");
  if (data.sync_metadata) throw new Error("This profile syncs bookmarks with a Google account; direct edits would be undone. Use the import file instead (Chrome menu → Bookmarks → Import).");
  const running = await isRunning(b.proc);
  if (running && process.platform === "darwin") throw new Error(`Quit ${b.name} first (a running Mac browser would overwrite this file), then try again.`);
  if (running && process.platform === "win32") {
    await new Promise((res) => execFile("taskkill.exe", ["/IM", b.proc], { windowsHide: true }, () => res()));
    for (let i = 0; i < 30 && (await isRunning(b.proc)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (await isRunning(b.proc)) throw new Error(`${b.name} did not close (a tab may be asking to save changes). Close it and try again.`);
  }
  const backup = path.join(DATA_DIR, `bookmarks-backup-${browserId}-${profileDir.replace(/\W+/g, "_")}-${Date.now()}.json`);
  fs.copyFileSync(file, backup);
  nextId = maxId({ children: Object.values(data.roots) });
  const ai = node("🤖 AI", null, folder.map((c) => node(c.name, null, c.links.map((l) => node(l.name, l.url)))));
  const bar = data.roots.bookmark_bar;
  bar.children = [ai, ...(bar.children || []).filter((c) => c.name !== "🤖 AI")];
  delete data.checksum; // Chrome recomputes and re-ids if needed
  fs.writeFileSync(file, JSON.stringify(data, null, 3));
  try { fs.unlinkSync(path.join(b.dir, profileDir, "Bookmarks.bak")); } catch {}
  const exe = b.exe.find((e) => fs.existsSync(e));
  if (running && exe) exec(`start "" "${exe}" --profile-directory="${profileDir}" --restore-last-session`, { windowsHide: true });
  return { backup, relaunched: !!(running && exe) };
}
function isRunning(proc) {
  if (process.platform === "darwin") return new Promise((res) => execFile("pgrep", ["-x", proc], (e) => res(!e)));
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((res) => execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${proc}`, "/NH"], { windowsHide: true }, (e, so) => res(/\.exe/i.test(so || ""))));
}

export function openUrl(url) {
  if (!/^https?:\/\//.test(url)) throw new Error("bad url");
  if (process.platform === "win32") exec(`start "" "${url.replace(/"/g, "")}"`, { windowsHide: true });
  else if (process.platform === "darwin") exec(`open "${url.replace(/"/g, "")}"`);
  else exec(`xdg-open "${url.replace(/"/g, "")}"`);
}
