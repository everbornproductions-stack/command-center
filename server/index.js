// Everborn Command Center server: static UI + JSON API + WebSocket event stream.
// Local mode (default): one user, data/ folder, binds 127.0.0.1. `node server/index.js` and done.
// Hosted mode (CC_MODE=hosted): Supabase sign-in, one context per user, binds 0.0.0.0. See docs/hosted-hub.md.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-generator";
import { DATA_DIR, WEB_DIR, HQ_DIR } from "./paths.js";
import { HOSTED, als, ctx, doc, putDoc, newContext, FileStore, setDefaultContext, getContext, runAs } from "./store.js";
import { CFG, assertHostedConfig } from "./hosted.js";
import { bearer, contextForToken, setContextInitializer } from "./auth.js";
import { PROVIDERS, CAPABILITIES, setPricing, findModel, modelPrice, pricingRules, saveRules, activeDiscount, nextDiscountStart } from "./registry.js";
import { loadVault, setSecret, getSecret, hasSecret, maskedKey, vaultInfo } from "./vault.js";
import { bus, emit } from "./events.js";
import { loadLedger, summary as ledgerSummary, recordCredits, recordCall } from "./ledger.js";
import { allStatus, checkAll, checkProvider, startHealthLoop, liveModels, noteCall } from "./health.js";
import { availableModels, rank, classify, cheaperRoute, learnedCaps, skillTable, deferAdvice, nextDiscountWindow } from "./router.js";
import { runCouncil, summaryOf } from "./council.js";
import { runMission, abortMission, publicMission, scheduleMission, scheduledMissions, restoreScheduled, missionSummary } from "./mission.js";
import { loadProjects, listProjects, saveProject, deleteProject, addLink, removeLink, hqSnapshot } from "./projects.js";
import { loadSubscriptions, subscriptionView, saveSubscription, deleteSubscription, totals as subTotals } from "./subscriptions.js";
import { streamChat, complete } from "./providers.js";
import { startDemo, stopDemo, demoActive } from "./mock.js";
import { updateState, checkForUpdate, installUpdate, startUpdateLoop, VERSION } from "./update.js";
import { licenseState, activate as activateLicense, redeem as redeemPromo, recheck as recheckLicense, startLicenseLoop, requireFeature, guard, subscriptionsLocked, loadHostedLicense, validateCloudChange, resetVerifiedTier } from "./license.js";
import { scanHistory, detectKeys, buildAiFolder, bookmarksHtml, applyToBrowser, openUrl, browserProfiles } from "./discover.js";
import { loadPlugins, handlePlugin, loadedPlugins } from "./plugins/index.js";
let lastScan = null, lastKeys = null;

const PORT = Number(process.env.PORT || process.env.CC_PORT || 4747);
const MODE = HOSTED ? "hosted" : "local";

// ---- local-mode request protection ----
// Local mode binds 127.0.0.1 with no sign-in, so without these checks any web page the user visits
// could post to /api (a "simple" cross-site request) and a DNS-rebinding host could read /api/state.
//  1. A random 32-byte token, new on every launch, is injected into index.html (<meta name="cc-token">);
//     every /api call must carry it in X-CC-Token (except /api/health and /api/config) and it must be
//     the first WebSocket message ({ type: "auth", token }).
//  2. Host must be 127.0.0.1:<port> or localhost:<port> (421 otherwise), on every request including static files.
//  3. If an Origin header is present it must be the loopback origin (403 otherwise), also on the WebSocket upgrade.
//  4. POST/PUT/DELETE with a body must be application/json (415), in hosted mode too.
// Hosted mode keeps its bearer-token sign-in; only 4 applies there.
const LOCAL_TOKEN = HOSTED ? null : crypto.randomBytes(32).toString("hex");
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const LOCAL_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`]);
const PUBLIC_API = new Set(["/api/health", "/api/config"]);
const hasBody = (req) => Number(req.headers["content-length"] || 0) > 0 || !!req.headers["transfer-encoding"];
const isJson = (req) => /^application\/json\b/i.test(String(req.headers["content-type"] || ""));
function tokenOk(presented) {
  if (!LOCAL_TOKEN) return true;
  const a = Buffer.from(String(presented || "")), b = Buffer.from(LOCAL_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hostOk = (req) => LOCAL_HOSTS.has(String(req.headers.host || "").toLowerCase());
const originOk = (req) => !req.headers.origin || LOCAL_ORIGINS.has(String(req.headers.origin).toLowerCase());
// Returns { status, error } to send, or null when the request may proceed.
function localGate(req, url) {
  if (HOSTED) return null;
  if (!hostOk(req)) return { status: 421, error: `wrong host: open http://localhost:${PORT}/ or http://127.0.0.1:${PORT}/`, code: "host" };
  if (!originOk(req)) return { status: 403, error: "cross-site request refused", code: "origin" };
  if (url.pathname.startsWith("/api/") && !PUBLIC_API.has(url.pathname) && !url.pathname.startsWith("/api/share/t/") && !tokenOk(req.headers["x-cc-token"])) return { status: 401, error: "session token missing or wrong: reload the page", code: "token" };
  return null;
}
// index.html with the per-launch token injected (local mode only).
function indexHtml(file) {
  const html = fs.readFileSync(file, "utf8");
  if (!LOCAL_TOKEN) return html;
  const tag = `<meta name="cc-token" content="${LOCAL_TOKEN}" />`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`) : tag + html;
}
const DEFAULT_SETTINGS = { budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Everborn Command" };
const settings = () => doc("settings", () => ({ ...DEFAULT_SETTINGS }));
const saveSettings = (s) => putDoc("settings", s);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

function json(res, status, body) {
  const b = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(b) });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

function providerView() {
  const st = allStatus();
  return Object.values(PROVIDERS)
    .filter((p) => !p.demo || hasSecret(p.id)) // demo AIs only for the user who turned demo on
    .map((p) => ({
      id: p.id, name: p.name, vendor: p.vendor, color: p.color, kind: p.kind, links: p.links, keyHint: p.keyHint, unit: p.unit || null, hasApi: !!p.api, demo: !!p.demo,
      keyed: hasSecret(p.id, p.keyEnv), masked: maskedKey(p.id, p.keyEnv), status: st[p.id] || { status: "grey" },
      models: (p.models || []).map((m) => { const pr = modelPrice(m.id); return { id: m.id, name: m.name, tier: m.tier, in: pr.in, out: pr.out, caps: learnedCaps(m.id, m.caps), base: m.caps, default: !!m.default, web: !!m.web }; }),
      liveModels: liveModels[p.id] || [],
    }));
}

function rulesView() {
  return pricingRules().map((r) => { const a = activeDiscount(r.provider); const nx = nextDiscountStart(r.provider); return { ...r, providerName: PROVIDERS[r.provider]?.name || r.provider, color: PROVIDERS[r.provider]?.color || null, activeNow: !!a && a.id === r.id, nextStart: nx && nx.rule.id === r.id ? nx.at.getTime() : null }; });
}

const summarize = (m) => (m.kind === "council" ? summaryOf(m) : missionSummary(m));
function missionList() {
  return ctx().store.listMissions(summarize).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
}

// most recent mission/council snapshot per user, so a reloaded UI picks up where it was
bus.on("event", (ev) => {
  const c = getContext(ev.user); if (!c) return;
  if (ev.type === "mission.update" && ev.mission.kind !== "council") c.lastRun = ev.mission; else if (ev.type === "council.update") c.lastRun = ev.council;
});

// Subscriptions tracker is a Pro feature: Free users get empty data and a locked flag.
const EMPTY_TOTALS = { known: 0, estimated: 0, count: 0, unconfirmed: 0, locked: true };
const subsView = () => (subscriptionsLocked() ? { subscriptions: [], subscriptionTotals: EMPTY_TOTALS, subscriptionsLocked: true } : { subscriptions: subscriptionView(), subscriptionTotals: subTotals(), subscriptionsLocked: false });

// Gated entry points. Routes and plugin helpers both start councils/missions through these, so
// the Free limits (3 councils per UTC month, no missions, no scheduler) are enforced in one place.
function startCouncil(opts) {
  guard("council");
  const c = ctx();
  c.councilsInFlight = (c.councilsInFlight || 0) + 1;
  const p = runCouncil(opts);
  p.finally(() => { c.councilsInFlight = Math.max(0, (c.councilsInFlight || 1) - 1); }).catch(() => {});
  return p;
}
function startMission(opts) {
  guard("missions");
  if (opts.runAt === "offpeak") guard("scheduler");
  const { runAt, ...rest } = opts;
  return runMission(rest);
}
function saveSubscriptionGated(s) { guard("subscriptions"); return saveSubscription(s); }

function fullState() {
  const c = ctx();
  const s = settings();
  return {
    mode: MODE, user: HOSTED ? { email: c.email } : null, hub: HOSTED ? CFG.hubUrl : null,
    lastRun: c.lastRun, plugins: loadedPlugins(),
    name: s.name, settings: s, demo: demoActive(), providers: providerView(), capabilities: CAPABILITIES, ledger: ledgerSummary(),
    ...subsView(), projects: listProjects(), hq: hqSnapshot(),
    missions: missionList(), skills: skillTable(), vault: vaultInfo(), hqDir: HOSTED ? null : HQ_DIR, recent: bus.recent(120).filter((e) => e.user === c.userId || !e.user), now: Date.now(),
    rules: rulesView(), scheduled: scheduledMissions(), update: updateState(), version: VERSION, license: licenseState(),
  };
}

// What the browser may know before signing in.
const publicConfig = () => ({ mode: MODE, version: VERSION, name: "Everborn Command", supabase: HOSTED ? { url: CFG.url, anonKey: CFG.anonKey } : null, hub: HOSTED ? CFG.hubUrl : null });

// ---------- single-AI chat (streams through the event bus) ----------
async function runChat({ prompt, provider, model, projectId }) {
  const id = "s-" + Date.now().toString(36);
  if (!provider || !model) {
    const cls = await classify(prompt, { onCall: (c) => recordCall({ ...c, missionId: id }) });
    const best = rank({ ...cls, mode: settings().defaultMode })[0];
    if (!best) throw new Error("No AI available. Add a key in Settings.");
    provider = best.provider; model = best.model;
  }
  const agent = `${id}:${provider}`;
  const m = { id, kind: "single", prompt, projectId: projectId || null, status: "running", startedAt: Date.now(), provider, model, cost: 0, deliverable: "" };
  emit("mission.update", { mission: { ...m, title: prompt.slice(0, 90), tasks: [] } });
  emit("agent.start", { agent, provider, model, role: "answer", missionId: id, label: `${PROVIDERS[provider].name} answering` });
  const s = Date.now();
  let text = "";
  try {
    for await (const ev of streamChat({ provider, model, maxTokens: 3000, system: "You are a sharp, concrete expert assistant. Markdown allowed. No filler.", messages: [{ role: "user", content: prompt }] })) {
      if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
      else if (ev.type === "done") {
        const ms = Date.now() - s;
        noteCall(provider, true, ms);
        const e = recordCall({ provider, model, usage: ev.usage, missionId: id, role: "answer", ms });
        m.cost = e.cost;
        emit("agent.done", { agent, provider, model, missionId: id, ms, cost: e.cost });
      }
    }
    m.status = "done";
  } catch (err) {
    noteCall(provider, false, Date.now() - s, err.status);
    emit("agent.error", { agent, provider, model, missionId: id, error: err.message });
    m.status = "failed"; m.error = err.message;
  }
  m.deliverable = text; m.finishedAt = Date.now();
  ctx().store.saveMission(m, missionSummary({ ...m, title: prompt.slice(0, 90) }));
  emit("mission.update", { mission: { ...m, title: prompt.slice(0, 90), tasks: [] } });
  return m;
}

// ---------- routes (run inside the signed-in user's context) ----------
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, "");
  const method = req.method;
  const seg = p.split("/").filter(Boolean);

  // features that only make sense on the PC the server runs on
  if (HOSTED && (seg[0] === "setup" || p === "/open" || p === "/cloud")) return json(res, 400, { error: "Not available on a hosted hub (this is a local-PC feature)." });

  if (method === "GET" && p === "/state") return json(res, 200, fullState());
  if (method === "GET" && p === "/missions") return json(res, 200, missionList());
  if (method === "GET" && seg[0] === "missions" && seg[1]) {
    const m = await ctx().store.getMission(seg[1].replace(/[^a-z0-9-]/gi, ""));
    return m ? json(res, 200, m.kind === "mission" ? publicMission(m) : m) : json(res, 404, { error: "not found" });
  }
  if (method === "GET" && p === "/route") {
    const prompt = url.searchParams.get("prompt") || "";
    if (!prompt.trim()) return json(res, 400, { error: "prompt required" });
    const cls = await classify(prompt, { onCall: (c) => recordCall({ ...c, role: "classify" }) });
    const mode = url.searchParams.get("mode") || settings().defaultMode;
    const ranked = rank({ ...cls, mode }).slice(0, 6);
    return json(res, 200, { classification: cls, ranked, cheaper: cheaperRoute(cls), defer: deferAdvice(cls, mode), councilEstimate: ranked.slice(0, 4).reduce((a, m) => a + m.estCost, 0) * 2.4 });
  }
  if (method === "GET" && p === "/models") return json(res, 200, availableModels());

  const body = method === "POST" || method === "PUT" || method === "PATCH" ? await readBody(req) : {};

  if (method === "POST" && p === "/keys") {
    if (!PROVIDERS[body.provider]) return json(res, 400, { error: "unknown provider" });
    if (!String(body.key || "").trim()) return json(res, 400, { error: "key required" });
    await setSecret(body.provider, body.secret ? { key: body.key, secret: body.secret } : body.key);
    const st = await checkProvider(body.provider);
    return json(res, 200, { ok: true, status: st, masked: maskedKey(body.provider) });
  }
  if (method === "DELETE" && seg[0] === "keys" && seg[1]) { await setSecret(seg[1], null); await checkProvider(seg[1]); return json(res, 200, { ok: true }); }
  if (method === "POST" && p === "/check") { await checkAll(); return json(res, 200, allStatus()); }
  if (method === "POST" && seg[0] === "check" && seg[1]) return json(res, 200, await checkProvider(seg[1]));

  if (method === "POST" && p === "/council") {
    if (!body.prompt?.trim()) return json(res, 400, { error: "prompt required" });
    let promise;
    try { promise = startCouncil({ prompt: body.prompt, members: body.members, chair: body.chair, projectId: body.projectId, qa: body.qa !== false, lite: !!body.lite }); }
    catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); }
    promise.catch((e) => emit("log", { text: `Council failed: ${e.message}`, level: "error" }));
    return json(res, 202, { ok: true });
  }
  if (method === "POST" && p === "/mission") {
    if (!body.goal?.trim()) return json(res, 400, { error: "goal required" });
    try { guard("missions"); if (body.runAt === "offpeak") guard("scheduler"); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); }
    const s = settings();
    const opts = { goal: body.goal, mode: body.mode || s.defaultMode, projectId: body.projectId, qa: body.qa !== false, budgetUsd: Number(body.budgetUsd) || s.missionBudget, context: body.context || "" };
    if (body.runAt === "offpeak") {
      const win = nextDiscountWindow();
      if (win) { const m = scheduleMission(opts, win.at, `${win.rule.name}, ${win.rule.pct}% off`); return json(res, 202, { ok: true, scheduled: m }); }
      emit("log", { text: "A discount window is already open (or none is configured): running now." });
    }
    const promise = startMission(opts);
    promise.catch((e) => emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
    return json(res, 202, { ok: true });
  }
  if (method === "POST" && seg[0] === "mission" && seg[2] === "abort") return json(res, 200, { aborted: abortMission(seg[1]) });
  if (method === "POST" && p === "/chat") {
    if (!body.prompt?.trim()) return json(res, 400, { error: "prompt required" });
    runChat(body).catch((e) => emit("log", { text: `Chat failed: ${e.message}`, level: "error" }));
    return json(res, 202, { ok: true });
  }

  if (method === "POST" && p === "/projects") {
    if (!body.id && !String(body.name || "").trim()) return json(res, 400, { error: "name required" });
    const id = body.id || String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const existing = listProjects();
    if (!existing.some((x) => x.id === id)) { try { guard("projects", { count: existing.length }); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); } }
    return json(res, 200, saveProject(body));
  }
  if (method === "DELETE" && seg[0] === "projects" && seg[1] && !seg[2]) { deleteProject(seg[1]); return json(res, 200, { ok: true }); }
  if (method === "POST" && seg[0] === "projects" && seg[2] === "links") return json(res, 200, addLink(seg[1], body.categoryId, body));
  if (method === "DELETE" && seg[0] === "projects" && seg[2] === "links") return json(res, 200, removeLink(seg[1], url.searchParams.get("category"), url.searchParams.get("url")));

  if (seg[0] === "subscriptions" && method !== "GET") { try { guard("subscriptions"); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code, locked: true }); } }
  if (method === "POST" && p === "/subscriptions") return json(res, 200, saveSubscription(body));
  if (method === "DELETE" && seg[0] === "subscriptions" && seg[1]) return json(res, 200, deleteSubscription(seg[1]));
  if (method === "POST" && p === "/credits") { recordCredits(body); return json(res, 200, { ok: true }); }
  if (method === "POST" && p === "/rules") { if (!Array.isArray(body.rules)) return json(res, 400, { error: "rules[]" }); saveRules(body.rules); return json(res, 200, rulesView()); }
  if (method === "GET" && p === "/rules") return json(res, 200, rulesView());
  if (method === "POST" && p === "/pricing") { if (!findModel(body.model)) return json(res, 404, { error: "model" }); setPricing(body.model, body); return json(res, 200, { ok: true }); }
  // ---- first-run setup (local mode only; every step opt-in; nothing leaves the PC) ----
  if (method === "POST" && p === "/setup/scan") {
    const out = {};
    if (body.history !== false) { lastScan = scanHistory({ days: Number(body.days) || 180 }); out.scan = lastScan; }
    if (body.keys !== false) { lastKeys = await detectKeys(); out.keys = Object.fromEntries(Object.entries(lastKeys).map(([k, v]) => [k, { source: v.source, masked: v.masked }])); }
    out.profiles = browserProfiles().map((x) => ({ browser: x.browser, browserName: x.browserName, dir: x.dir, name: x.name, email: x.email, bookmarkCount: x.bookmarkCount, synced: x.synced }));
    if (lastScan) out.folder = buildAiFolder(lastScan);
    return json(res, 200, out);
  }
  if (method === "POST" && p === "/setup/import-keys") {
    const done = [];
    for (const id of body.providers || []) { const k = lastKeys?.[id]; if (k?._value && PROVIDERS[id]) { await setSecret(id, k._value); await checkProvider(id); done.push(id); } }
    return json(res, 200, { imported: done });
  }
  if (method === "GET" && p === "/setup/bookmarks.html") {
    if (!lastScan) return json(res, 400, { error: "run the scan first" });
    const html = bookmarksHtml(buildAiFolder(lastScan));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-disposition": 'attachment; filename="ai-bookmarks.html"' });
    return res.end(html);
  }
  if (method === "POST" && p === "/setup/bookmarks/apply") {
    if (!lastScan) return json(res, 400, { error: "run the scan first" });
    try { const r = await applyToBrowser({ browserId: body.browser, profileDir: body.profile, folder: buildAiFolder(lastScan) }); emit("log", { text: `AI bookmark folder added to ${body.browser} (${body.profile}). Backup: ${r.backup}` }); return json(res, 200, r); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (method === "POST" && p === "/setup/open") {
    const prov = PROVIDERS[body.provider];
    const target = body.url || prov?.links?.keys || prov?.links?.console || prov?.links?.app;
    if (!target) return json(res, 404, { error: "no page known" });
    openUrl(target); return json(res, 200, { ok: true, url: target });
  }
  if (method === "POST" && p === "/setup/track") {
    // add detected media tools as subscriptions to track (Pro: the tracker is locked on Free)
    try { guard("subscriptions"); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code, locked: true, added: [] }); }
    const added = [];
    for (const t of body.tools || []) { if (!t?.name) continue; saveSubscription({ id: t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), provider: t.provider || null, name: t.name, plan: "UNKNOWN", monthly: null, unit: "credits", url: t.url, notes: `Found in browser history (${t.visits} visits).` }); added.push(t.name); }
    return json(res, 200, { added });
  }
  if (method === "POST" && p === "/setup/done") { const s = saveSettings({ ...settings(), onboarded: true }); return json(res, 200, s); }
  if (method === "POST" && p === "/update/check") return json(res, 200, await checkForUpdate());
  if (method === "GET" && p === "/update") return json(res, 200, updateState());
  if (method === "POST" && p === "/update/install") { try { return json(res, 202, await installUpdate()); } catch (e) { return json(res, e.status || 400, { error: e.message, code: e.code, update: updateState() }); } }
  if (method === "POST" && p === "/license") { try { return json(res, 200, body.code ? await redeemPromo(body.code, body.email) : await activateLicense(body.key)); } catch (e) { return json(res, 400, { error: e.message }); } }
  if (method === "POST" && p === "/license/recheck") return json(res, 200, await recheckLicense());
  if (method === "POST" && p === "/cloud") {
    let v;
    try { v = validateCloudChange(body); } catch (e) { return json(res, e.status || 400, { error: e.message, license: licenseState() }); }
    const s = saveSettings({ ...settings(), cloud: { url: v.url, anonKey: v.anonKey } });
    if (v.changed) { resetVerifiedTier(); recheckLicense().catch(() => {}); }
    return json(res, 200, { cloud: { url: s.cloud.url, anonKey: s.cloud.anonKey ? "set" : "" }, license: licenseState() });
  }
  if (method === "POST" && p === "/demo") {
    if (body.on) await startDemo(); else await stopDemo();
    saveSettings({ ...settings(), demo: !!body.on });
    await checkAll();
    emit("log", { text: body.on ? "Demo mode on: three pretend AIs are online. No credits are spent." : "Demo mode off." });
    return json(res, 200, { demo: demoActive(), providers: providerView() });
  }
  if (method === "POST" && p === "/settings") {
    const { cloud, ...rest } = body; // cloud has its own route
    return json(res, 200, saveSettings({ ...settings(), ...rest }));
  }
  if (method === "GET" && p === "/hq") return json(res, 200, hqSnapshot());
  if (method === "POST" && p === "/open") {
    // open a local folder or file in Explorer (Windows) — the project hub uses it for local outputs
    const target = String(body.path || "");
    if (!target || !fs.existsSync(target)) return json(res, 404, { error: "path not found" });
    const { exec } = await import("node:child_process");
    exec(process.platform === "win32" ? `explorer "${target}"` : `open "${target}"`);
    return json(res, 200, { ok: true });
  }
  if (await handlePlugin(req, res, url, body)) return;
  return json(res, 404, { error: "no such route" });
}

// ---------- public routes (no sign-in) ----------
function pairQr(res, url) {
  const u = String(url.searchParams.get("u") || CFG.hubUrl || "").trim();
  if (!/^https?:\/\/[^\s]{1,300}$/.test(u)) return json(res, 400, { error: "u must be an http(s) address" });
  const qr = qrcode(0, "M"); qr.addData(u); qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
  res.end(svg);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "600");
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${PORT}`); } catch { return json(res, 400, { error: "bad url" }); }
  try {
    const gate = localGate(req, url);
    if (gate) return json(res, gate.status, { error: gate.error, code: gate.code });
    if (HOSTED) { cors(req, res); if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); } }
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method) && hasBody(req) && !isJson(req)) return json(res, 415, { error: "content-type must be application/json", code: "content_type" });
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, mode: MODE, version: VERSION, uptime: Math.round(process.uptime()) });
    if (url.pathname === "/api/config") return json(res, 200, publicConfig());
    if (url.pathname === "/api/pair/qr.svg") return pairQr(res, url);
    if (url.pathname.startsWith("/api/")) {
      if (!HOSTED) return await api(req, res, url);
      let c;
      try { c = await contextForToken(bearer(req)); } catch (e) { return json(res, e.status || 401, { error: e.message, code: e.status === 401 ? "unauthorized" : undefined }); }
      return await als.run(c, () => api(req, res, url));
    }
    // static
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(path.join(WEB_DIR, file));
    if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    if (path.basename(file) === "index.html") {
      const html = indexHtml(file);
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store", "content-length": Buffer.byteLength(html) });
      return res.end(html);
    }
    if (path.relative(WEB_DIR, file) === "sw.js") {
      // the version is stamped into the service worker so every release installs a new one (PWA "refresh" prompt)
      const js = fs.readFileSync(file, "utf8").replace(/__CC_VERSION__/g, VERSION);
      res.writeHead(200, { "content-type": MIME[".js"] || "text/javascript", "cache-control": "no-cache", "content-length": Buffer.byteLength(js) });
      return res.end(js);
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

// ---------- WebSocket: one hello per client, events fanned out per user ----------
const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
wss.on("connection", (ws, req) => {
  if (!HOSTED) {
    // local: same Host/Origin pinning as HTTP, then the per-launch token as the first message
    if (!hostOk(req) || !originOk(req)) { ws.close(4403, "cross-site refused"); return; }
    const timer = setTimeout(() => ws.close(4401, "auth timeout"), 15000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      let m = null; try { m = JSON.parse(String(raw)); } catch {}
      if (m?.type !== "auth" || !tokenOk(m?.token)) { send(ws, { type: "auth.error", error: "session token missing or wrong: reload the page" }); ws.close(4401, "unauthorized"); return; }
      ws.ctx = ctx(); send(ws, { type: "hello", state: fullState() });
    });
    return;
  }
  // hosted: the first message must be { type: "auth", token }
  const timer = setTimeout(() => ws.close(4401, "auth timeout"), 15000);
  ws.once("message", async (raw) => {
    clearTimeout(timer);
    try {
      const m = JSON.parse(String(raw));
      const c = await contextForToken(m?.token);
      ws.ctx = c;
      send(ws, { type: "hello", state: runAs(c, fullState) });
    } catch (e) { send(ws, { type: "auth.error", error: e.message }); ws.close(4401, "unauthorized"); }
  });
});
bus.on("event", (ev) => {
  const msg = JSON.stringify(ev);
  for (const c of wss.clients) if (c.readyState === 1 && c.ctx && (!ev.user || c.ctx.userId === ev.user)) c.send(msg);
});
// Periodic state refresh (ledger totals, subscription view) so the UI never drifts
setInterval(() => {
  const byCtx = new Map();
  for (const c of wss.clients) { if (c.readyState !== 1 || !c.ctx) continue; if (!byCtx.has(c.ctx)) byCtx.set(c.ctx, []); byCtx.get(c.ctx).push(c); }
  for (const [c, clients] of byCtx) {
    const msg = runAs(c, () => JSON.stringify({ type: "tick", ledger: ledgerSummary(), ...subsView(), providers: providerView(), now: Date.now() }));
    for (const ws of clients) ws.send(msg);
  }
}, 15000).unref();

// Loads one user's world. Runs inside that user's context (local: once at boot; hosted: on first request).
async function initContext() {
  await loadVault();
  loadLedger();
  pricingRules();
  loadProjects();
  loadSubscriptions();
  if (settings().demo) await startDemo().catch((e) => { console.error("[demo]", e.message); emit("log", { text: `Demo mode could not start: ${e.message}`, level: "error" }); });
  restoreScheduled();
  if (HOSTED) await loadHostedLicense();
  checkAll().catch(() => {});
}

(async () => {
  if (HOSTED) assertHostedConfig();
  else {
    const local = newContext("local", new FileStore(DATA_DIR));
    await local.store.loadAll(local);
    setDefaultContext(local);
    await initContext();
    local.ready = true;
  }
  setContextInitializer(initContext);
  // plugins get the gated entry points, never the raw runners, so tier limits cannot be bypassed
  await loadPlugins({ json, emit, bus, settings, PROVIDERS, rank, classify, runMission: startMission, runCouncil: startCouncil, recordCall, recordCredits, ledgerSummary, listProjects, saveProject, subscriptionView, saveSubscription: saveSubscriptionGated, licenseState, requireFeature, guard, HOSTED, DATA_DIR, VERSION, readBody, streamChat, complete, getSecret, setSecret, hasSecret, doc, putDoc, ctx, runAs });
  server.listen(PORT, HOSTED ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`Everborn Command Center (${MODE})  →  http://localhost:${PORT}`);
    if (HOSTED) console.log(`supabase: ${CFG.url}\nhub:      ${CFG.hubUrl || "(CC_HUB_URL not set)"}\nservice key: ${CFG.serviceKey ? "yes" : "no (writes use each user's own token)"}`);
    else console.log(`data: ${DATA_DIR}\nHQ:   ${HQ_DIR || "(not linked; set CC_HQ_DIR)"}`);
    startHealthLoop();
    startUpdateLoop();
    startLicenseLoop();
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
