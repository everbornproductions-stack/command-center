// Chrome / Edge extension (Phase 24): send the page you are on, or a selection, to a chat or a council in
// this app. The extension (extension/ folder, "Load unpacked") talks only to this PC's local server, and only
// with a pairing code made here. Desktop and local mode only; the hosted hub refuses.
//
// Pairing: Settings > Browser extension > Pair a browser shows a code once ("cce.<port>.<secret>"); only the
// SHA-256 of the secret is kept, so a lost code is replaced, never shown again. Unpair revokes it at once.
//
// The extension's own routes, /api/ext/..., are exempt from the per-launch session token (the extension
// cannot read it) but keep the Host pin, refuse any web page's Origin (only chrome-extension:// and
// moz-extension:// may call them, or no Origin at all), need application/json, and check the pairing
// secret with timingSafeEqual. Wrong codes are limited to 20 a minute, each paired browser to 30 sends a minute.
//   GET  /api/ext/ping   who am I paired with
//   POST /api/ext/send   { action: "draft" | "chat" | "council", kind: "page" | "selection" | "link", url, title, text, note? }
// "draft" (the default) only puts the text into Marching orders (or the Inbox when the app is closed); "chat"
// and "council" start right away because the person clicked Send in the extension. Spend caps, the ledger and
// tier limits apply as usual. Nothing is sent anywhere but to the AI the app picks.
//
// App routes (session token as usual): /api/extension/pairings (GET, POST { name }, DELETE /<id>),
// /api/extension/inbox (GET, DELETE /<id>), /api/extension/info.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTED, getContext, runAs, doc, putDoc } from "../store.js";
import { emit } from "../events.js";

export const id = "extension";
export const HOOK_PREFIX = "/api/ext/";
const DOC = "extension.pairings", INBOX = "extension.inbox";
const LIMITS = { body: 300 * 1024, text: 50000, title: 300, note: 2000, sendsPerMinute: 30, badPerMinute: 20, inbox: 20 };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// in the installed app the folder is unpacked next to app.asar so Chrome can load it
export const EXTENSION_DIR = path.join(ROOT, "extension").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");

let H = null; // plugin helpers (runChat, runCouncil...), set by init
export function init(h) { H = h; }

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const pairings = () => doc(DOC, () => ({ list: [] }));
const inbox = () => doc(INBOX, () => ({ items: [] }));
const publicPairing = (p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsed: p.lastUsed || null, sends: p.sends || 0 });
const port = () => Number(process.env.CC_PORT || process.env.PORT || 4747);

function findPairing(secret) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(secret)) return null;
  const h = Buffer.from(sha(secret), "hex");
  let hit = null;
  for (const p of pairings().list) { const b = Buffer.from(p.hash, "hex"); if (b.length === h.length && crypto.timingSafeEqual(b, h)) hit = p; }
  return hit;
}

// ---------- rate limits ----------
const windows = new Map(); // key -> [timestamps]
function allow(key, max) {
  const now = Date.now(), w = (windows.get(key) || []).filter((t) => now - t < 60000);
  if (w.length >= max) { windows.set(key, w); return false; }
  w.push(now); windows.set(key, w); return true;
}

// ---------- the extension's own routes ----------
export const isHook = (pathname) => pathname.startsWith(HOOK_PREFIX);
const extOrigin = (o) => /^(chrome|moz)-extension:\/\/[a-z0-9-]{1,64}$/i.test(o);

function readLimited(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const clip = (s, n) => String(s ?? "").replace(/\u0000/g, "").trim().slice(0, n);
const INSTRUCTION = {
  page: "Summarize this page and list the points that matter.",
  selection: "Here is a passage I selected on a web page. Explain it and tell me what matters.",
  link: "Here is a link I want to look at. Tell me what you know about it and what to check.",
};
export function buildPrompt({ kind, url, title, text, note }) {
  const k = INSTRUCTION[kind] ? kind : "page";
  const body = clip(text, LIMITS.text);
  const cut = String(text || "").length > LIMITS.text;
  return `${clip(note, LIMITS.note) || INSTRUCTION[k]}\n\nFrom: ${clip(title, LIMITS.title) || "(no title)"}${url ? ` (${url})` : ""}${body ? `\n\n"""\n${body}\n"""${cut ? `\n(cut to the first ${LIMITS.text} characters)` : ""}` : ""}`;
}

export async function handleHook(req, res, url, send) {
  if (HOSTED) return send(res, 404, { error: "The browser extension works with the desktop app." });
  const origin = req.headers.origin;
  if (origin && !extOrigin(origin)) return send(res, 403, { error: "only the Command AI browser extension may call this", code: "origin" });
  if (origin) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "origin"); }
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET,POST"); res.setHeader("access-control-allow-headers", "authorization, content-type"); res.setHeader("access-control-max-age", "600");
    res.writeHead(204); return res.end();
  }
  const route = url.pathname.slice(HOOK_PREFIX.length);
  if (!["ping", "send"].includes(route)) return send(res, 404, { error: "not found" });
  const c = getContext(null);
  if (!c) return send(res, 401, { error: "pairing code not recognised", code: "pairing" });
  return runAs(c, async () => {
    const secret = String(req.headers.authorization || "").match(/^Bearer\s+(?:cce\.\d+\.)?(\S+)$/i)?.[1] || "";
    const p = secret ? findPairing(secret) : null;
    if (!p) {
      if (!allow("bad", LIMITS.badPerMinute)) return send(res, 429, { error: "too many wrong pairing codes; wait a minute" });
      return send(res, 401, { error: "pairing code not recognised: pair the extension again in Command AI > Settings > Browser extension", code: "pairing" });
    }
    if (route === "ping") {
      if (req.method !== "GET") return send(res, 405, { error: "GET only" });
      return send(res, 200, { ok: true, app: "Command AI", tagline: "an Everborn product", version: H?.VERSION || null, name: p.name, port: port() });
    }
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return send(res, 415, { error: "content-type must be application/json" });
    let body;
    try { const raw = await readLimited(req, LIMITS.body); body = raw ? JSON.parse(raw) : {}; if (!body || typeof body !== "object" || Array.isArray(body)) throw 0; }
    catch (e) { return send(res, e?.status || 400, { error: e?.status === 413 ? "too much text: send a selection instead" : "send a JSON object" }); }
    if (!allow(`p:${p.id}`, LIMITS.sendsPerMinute)) return send(res, 429, { error: `at most ${LIMITS.sendsPerMinute} sends a minute` });
    const action = ["draft", "chat", "council"].includes(body.action) ? body.action : "draft";
    const kind = ["page", "selection", "link"].includes(body.kind) ? body.kind : "page";
    let pageUrl = "";
    if (body.url) { try { const u = new URL(String(body.url)); if (!/^https?:$/.test(u.protocol)) throw 0; u.username = ""; u.password = ""; pageUrl = u.toString().slice(0, 2000); } catch { return send(res, 400, { error: "url must be an http(s) address" }); } }
    if (!clip(body.text, 10) && !pageUrl) return send(res, 400, { error: "nothing to send: no text and no address" });
    const prompt = buildPrompt({ kind, url: pageUrl, title: body.title, text: body.text, note: body.note });
    const ps = pairings(); const rec = ps.list.find((x) => x.id === p.id); rec.lastUsed = Date.now(); rec.sends = (rec.sends || 0) + 1; putDoc(DOC, ps);
    const from = { browser: p.name, kind, title: clip(body.title, LIMITS.title), url: pageUrl };
    if (action === "draft") {
      const ib = inbox();
      const item = { id: "ext-" + crypto.randomBytes(5).toString("hex"), at: Date.now(), prompt, ...from };
      ib.items = [item, ...ib.items].slice(0, LIMITS.inbox); putDoc(INBOX, ib);
      emit("extension.draft", { item });
      emit("log", { text: `From ${p.name}: ${kind === "selection" ? "a selection" : "a page"} is waiting in Marching orders.` });
      return send(res, 202, { ok: true, action, id: item.id });
    }
    try {
      if (action === "council") {
        const pr = H.runCouncil({ prompt, lite: true });
        pr.catch((e) => emit("log", { text: `Council failed: ${e.message}`, level: "error" }));
      } else {
        const runId = "s-" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
        H.runChat({ prompt, runId }).catch((e) => emit("log", { text: `Chat failed: ${e.message}`, level: "error" }));
        emit("log", { text: `From ${p.name}: ${kind === "selection" ? "a selection" : "a page"} sent to a chat.` });
        return send(res, 202, { ok: true, action, runId });
      }
    } catch (e) { return send(res, e.status || 400, { error: e.message, code: e.code }); }
    emit("log", { text: `From ${p.name}: ${kind === "selection" ? "a selection" : "a page"} sent to a council.` });
    return send(res, 202, { ok: true, action });
  });
}

// ---------- the app's own routes ----------
export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/extension/, "").replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean), m = req.method;
  if (h.HOSTED) return h.json(res, 400, { error: "The browser extension works with the desktop app." });
  if (m === "GET" && p === "/info") return h.json(res, 200, { folder: EXTENSION_DIR, port: port(), pairings: pairings().list.map(publicPairing) });
  if (seg[0] === "pairings") {
    if (m === "GET" && seg.length === 1) return h.json(res, 200, { pairings: pairings().list.map(publicPairing) });
    if (m === "POST" && seg.length === 1) {
      const name = clip(body.name, 60) || "Browser";
      const ps = pairings();
      if (ps.list.length >= 10) return h.json(res, 400, { error: "Ten browsers are paired already: unpair one first." });
      const secret = crypto.randomBytes(32).toString("base64url");
      const rec = { id: "pair-" + crypto.randomBytes(5).toString("hex"), name, hash: sha(secret), createdAt: Date.now() };
      ps.list.push(rec); putDoc(DOC, ps);
      emit("log", { text: `Browser extension pairing made for "${name}". The code is shown once.` });
      // the code is returned once and only its hash is kept
      return h.json(res, 200, { ...publicPairing(rec), code: `cce.${port()}.${secret}` });
    }
    if (m === "DELETE" && seg[1]) {
      const ps = pairings(); const n = ps.list.length;
      ps.list = ps.list.filter((x) => x.id !== seg[1]); putDoc(DOC, ps);
      return n === ps.list.length ? h.json(res, 404, { error: "not found" }) : h.json(res, 200, { ok: true });
    }
  }
  if (seg[0] === "inbox") {
    if (m === "GET" && seg.length === 1) return h.json(res, 200, inbox());
    if (m === "DELETE" && seg[1]) { const ib = inbox(); ib.items = ib.items.filter((x) => x.id !== seg[1]); putDoc(INBOX, ib); return h.json(res, 200, { ok: true }); }
  }
  return false;
}
