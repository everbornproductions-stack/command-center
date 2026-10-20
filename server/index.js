// Everborn Command Center server: static UI + JSON API + WebSocket event stream.
// Local mode (default): one user, data/ folder, binds 127.0.0.1 until phone pairing is turned on. `node server/index.js` and done.
// Hosted mode (CC_MODE=hosted): Supabase sign-in, one context per user, binds 0.0.0.0. See docs/hosted-hub.md.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-generator";
import { DATA_DIR, WEB_DIR, HQ_DIR } from "./paths.js";
import { HOSTED, als, ctx, doc, putDoc, newContext, FileStore, setDefaultContext, getContext, runAs } from "./store.js";
import { evictIdle } from "./idle.js";
import { CFG, assertHostedConfig } from "./hosted.js";
import { bearer, contextForToken, setContextInitializer } from "./auth.js";
import { PROVIDERS, CAPABILITIES, setPricing, findModel, modelPrice, priceSource, pricingRules, saveRules, activeDiscount, nextDiscountStart } from "./registry.js";
import { loadVault, setSecret, getSecret, getOwnSecret, hasSecret, maskedKey, vaultInfo } from "./vault.js";
import { loadForActive as loadWorkspaceKeys } from "./workspace-keys.js";
import { handleStart as ssoStart, enabledProviders as ssoProviders } from "./sso.js";
import { bus, emit } from "./events.js";
import {
  BAD_LINK, BIND_FAIL, NO_LAN, cookieValue, ensureWindowsFirewall, isLanSocket, isPrivateIPv4,
  lanHostOk, lanOriginOk, loopbackHost, newPairToken, pairCookie, pairTokenOk, pairUrl,
  preferredLanIPv4, probePort, readInterfaces, unreachableError,
} from "./pairing.js";
import { loadLedger, summary as ledgerSummary, recordCredits, recordCall } from "./ledger.js";
import { allStatus, checkAll, checkProvider, liveModels, noteCall, getStatus } from "./health.js";
import { connectionOf } from "./connect.js";
import { noteKeySaved, stampAfterCheck, startCreditHealthLoop, describePause, pauseNotice } from "./pause.js";
import { accessFor } from "./provider-access.js";
import { planInfo } from "./plans.js";
import "./tips.js";
import { availableModels, rank, classify, heuristicClassify, cheaperRoute, learnedCaps, learnedDeltas, skillTable, deferAdvice, nextDiscountWindow } from "./router.js";
import { normalizeMode } from "./modes.js";
import { runCouncil, summaryOf } from "./council.js";
import { withMemory, MARKER as MEMORY_MARKER } from "./project-memory.js";
import { runMission, abortMission, publicMission, scheduleMission, scheduledMissions, restoreScheduled, missionSummary } from "./mission.js";
import { loadProjects, listProjects, saveProject, deleteProject, addLink, removeLink, hqSnapshot } from "./projects.js";
import { projectNameError, projectSlug } from "../web/project-picker.js";
import { loadSubscriptions, subscriptionView, saveSubscription, deleteSubscription, totals as subTotals } from "./subscriptions.js";
import { streamChat, complete } from "./providers.js";
import { startDemo, stopDemo, demoActive } from "./mock.js";
import { updateState, checkForUpdate, installUpdate, startUpdateLoop, VERSION } from "./update.js";
import { licenseState, activate as activateLicense, redeem as redeemPromo, recheck as recheckLicense, startLicenseLoop, requireFeature, guard, subscriptionsLocked, loadHostedLicense, validateCloudChange, resetVerifiedTier } from "./license.js";
import { assertServiceSlots } from "./service-limit.js";
import { scanHistory, detectKeys, buildAiFolder, bookmarksHtml, applyToBrowser, openUrl, browserProfiles } from "./discover.js";
import { loadPlugins, handlePlugin, loadedPlugins } from "./plugins/index.js";
import { augment as webAugment, sourcesFromCitations, recordNative } from "./search.js";
import { augment as libraryAugment, publicSources as publicLibrarySources } from "./libraries.js";
import { fallbackChat, fallbackRecord, announce as announceFallback, troubleKind, trouble, fallbackSettings } from "./fallback.js";
import { observe } from "./brain.js";
import { expandJob } from "./prompts/apply.js";
import { isCallback as isGrokbotCallback, handleCallback as grokbotCallback, routeAdvice as grokbotRoute } from "./grokbot.js";
import { routeAdvice as browserRoute } from "./browser.js";
import { hubAgents } from "./agents.js";
import { isHook as isScheduleHook, handleHook as scheduleHook } from "./schedules.js";
import { handleScheduleTick, TICK_PATH } from "./schedule-tick.js";
import { isHook as isExtensionHook, handleHook as extensionHook } from "./plugins/extension.js";
import { ONBOARDING_VERSION, DOC_KIND, normalizeRecord, historyReasons, planOnboarding, applyDailyCheck, completeRecord, publicOnboarding } from "./onboarding.js";
import { connectSetupPublic } from "./connect-setup.js";
let lastScan = null, lastKeys = null;

// The daily check waits until plugins are loaded (custom providers exist) and the
// first health pass has finished (live model ids). It never scans history or bookmarks.
let pluginsReady = false;
let healthReady = false;
let dailyCtx = null;
let dailyStarted = false;
function tryDailyCheck() {
  if (HOSTED || dailyStarted || !pluginsReady || !healthReady || !dailyCtx) return;
  dailyStarted = true;
  runAs(dailyCtx, () => { try { runDailyCheck(); } catch (e) { console.error("[onboarding]", e.message); } });
}

const PORT = Number(process.env.PORT || process.env.CC_PORT || 4747);
const MODE = HOSTED ? "hosted" : "local";

// ---- local-mode request protection ----
// Local mode binds 127.0.0.1 with no sign-in, so without these checks any web page the user visits
// could post to /api (a "simple" cross-site request) and a DNS-rebinding host could read /api/state.
//  1. A random 32-byte token, new on every launch, is injected into index.html (<meta name="cc-token">);
//     every /api call must carry it in X-CC-Token (except /api/health and /api/config) and it must be
//     the first WebSocket message ({ type: "auth", token }).
//  2. Host must be 127.0.0.1:<port> or localhost:<port> (421 otherwise), on every request including static files.
//     Phone pairing adds the PC's private IPv4 only while it is on. Any other host is still refused.
//  3. If an Origin header is present it must be the loopback origin (403 otherwise), also on the WebSocket upgrade.
//     While phone pairing is on, the origin http://<private-ip>:<port> is allowed too.
//  4. POST/PUT/DELETE with a body must be application/json (415), in hosted mode too.
// Hosted mode keeps its bearer-token sign-in; only 4 applies there.
const LOCAL_TOKEN = HOSTED ? null : crypto.randomBytes(32).toString("hex");
const PUBLIC_API = new Set(["/api/health", "/api/config"]);
let firewallStatus = { ok: true, skipped: true };
let pairingError = null;
let lanServer = null;
let lanWss = null;
let pairLock = Promise.resolve();
const hasBody = (req) => Number(req.headers["content-length"] || 0) > 0 || !!req.headers["transfer-encoding"];
const isJson = (req) => /^application\/json\b/i.test(String(req.headers["content-type"] || ""));
// the one raw upload: an export zip for the history import (not a CORS-safelisted type, so still preflighted)
const isZipUpload = (req, url) => req.method === "POST" && url.pathname === "/api/history/preview" && /^application\/(zip|x-zip-compressed|octet-stream)\b/i.test(String(req.headers["content-type"] || ""));
function tokenOk(presented) {
  if (!LOCAL_TOKEN) return true;
  const a = Buffer.from(String(presented || "")), b = Buffer.from(LOCAL_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hostOk = (req) => loopbackHost(req.headers.host, PORT) || (phonePair().on && lanHostOk(req.headers.host, PORT, readInterfaces()));
const originOk = (req) => {
  if (!req.headers.origin) return true;
  const o = String(req.headers.origin).toLowerCase();
  if ([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`].includes(o)) return true;
  return phonePair().on && lanOriginOk(o, PORT, readInterfaces());
};
function phonePair() {
  const p = settings().phonePair;
  if (!p || p.on !== true || !/^[a-f0-9]{64}$/.test(String(p.token || ""))) return { on: false, token: "" };
  return { on: true, token: p.token };
}
function pairPresented(req, url) {
  const token = phonePair().token;
  if (!token) return false;
  return pairTokenOk(url.searchParams.get("pair"), token) || pairTokenOk(cookieValue(req.headers.cookie, "cc-pair"), token);
}
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
const DEFAULT_SETTINGS = { budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Meldmind", uiMode: "simple", uiModeChosen: false };
const settings = () => {
  const s = doc("settings", () => ({ ...DEFAULT_SETTINGS }));
  const mode = normalizeMode(s.defaultMode);
  if (!mode || mode === s.defaultMode) return s;
  return { ...s, defaultMode: mode };
};
const saveSettings = (s) => putDoc("settings", s);
// Command bar choice when the person picked one. Otherwise the saved Default priority.
// economy is the old name for Max savings.
function chatPriority(requested) {
  return normalizeMode(requested) || normalizeMode(settings().defaultMode) || "balanced";
}

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
    .map((p) => {
      const plan = planInfo(p.id);
      return {
      id: p.id, name: p.name, vendor: p.vendor, color: p.color, kind: p.kind, links: p.links, keyHint: p.keyHint, unit: p.unit || null, hasApi: !!p.api, demo: !!p.demo, custom: !!p.custom, noKey: !!p.noKey, workspaceId: p.id === "anthropic" ? getSecret(p.id, p.keyEnv)?.workspaceId || null : undefined, baseUrl: p.custom ? p.baseUrl : undefined, api: p.custom ? p.api : undefined,
      keyed: hasSecret(p.id, p.keyEnv), masked: maskedKey(p.id, p.keyEnv), keyScope: getSecret(p.id, p.keyEnv)?.scope || null, status: st[p.id] || { status: "grey" }, connect: connectionOf(p.id), access: accessFor(p), plan: plan.plan, planSource: plan.source,
      models: (p.models || []).map((m) => { const pr = modelPrice(m.id); return { id: m.id, name: m.name, tier: m.tier, in: pr.in, out: pr.out, priceSource: priceSource(m.id), caps: learnedCaps(m.id, m.caps), base: m.caps, learned: learnedDeltas(m.id), default: !!m.default, web: !!m.web }; }),
      liveModels: liveModels[p.id] || [],
    }; })
    .concat(hubAgents()); // Grok Bot and the browser helper: their own hub cards (kind "agent", Phase 12)
}

function finishPausedChat({ id, prompt, projectId, customAgent, message, billing, provider }) {
  const title = (customAgent ? `${customAgent.name}: ${prompt}` : prompt).slice(0, 90);
  const m = { id, kind: "single", prompt, projectId: projectId || null, status: "failed", startedAt: Date.now(), finishedAt: Date.now(), provider: provider || null, model: null, cost: 0, deliverable: message, error: message, sources: [], toolCalls: [], fallbacks: [], notice: { kind: "paused", provider: provider || null, billing: billing || null, text: message }, ...(customAgent ? { customAgent } : {}) };
  ctx().store.saveMission(m, missionSummary({ ...m, title }));
  emit("mission.update", { mission: { ...m, title, tasks: [] } });
  return m;
}

function rulesView() {
  return pricingRules().map((r) => { const a = activeDiscount(r.provider); const nx = nextDiscountStart(r.provider); return { ...r, providerName: PROVIDERS[r.provider]?.name || r.provider, color: PROVIDERS[r.provider]?.color || null, activeNow: !!a && a.id === r.id, nextStart: nx && nx.rule.id === r.id ? nx.at.getTime() : null }; });
}

// runs made with the demo AIs stay in history, tagged demo, after demo mode is switched off
const isDemoRun = (m) => JSON.stringify([m.members?.map((x) => x.provider), m.tasks?.map((t) => t.provider), m.planner, m.assembler, m.provider]).includes('"demo-');
const summarize = (m) => { const s = m.kind === "council" ? summaryOf(m) : missionSummary(m); return s && isDemoRun(m) ? { ...s, demo: true } : s; };

// Demo mode retires itself once a real key is saved and validated (built-in or custom provider).
// The user can turn it back on in Settings; that choice (demoKeep) is respected until they turn it off again.
const realValidated = (since = 0) => Object.values(PROVIDERS).some((p) => p.kind === "text" && !p.demo && hasSecret(p.id, p.keyEnv) && !getSecret(p.id, p.keyEnv)?.managed && (getStatus(p.id)?.lastOk || 0) > since && getStatus(p.id)?.status !== "red");
async function retireDemoIfReal(since = 0) {
  const s = settings();
  if (!demoActive() || s.demoKeep || !realValidated(since)) return false;
  await stopDemo();
  saveSettings({ ...settings(), demo: false, demoRetiredAt: Date.now(), demoNotice: true });
  emit("log", { text: "Demo AIs removed now that your own keys are set up. Turn demo mode back on in Settings any time." });
  emit("demo.retired", {});
  return true;
}
function missionList() {
  return ctx().store.listMissions(summarize).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
}
function missionSearch(q) {
  guard("historySearch");
  const needle = String(q || "").trim().toLowerCase();
  return ctx().store.listMissions((m) => {
    const title = String(m.title || "");
    const prompt = String(m.prompt || m.goal || "");
    if (!title.toLowerCase().includes(needle) && !prompt.toLowerCase().includes(needle)) return null;
    return summarize(m);
  }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
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
// the Free limits (5 councils per UTC month, 3 projects, no missions, no scheduler) are enforced in one place.
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
function saveSubscriptionGated(s, meta) { guard("subscriptions"); return saveSubscription(s, meta); }

function vaultKeyIds() {
  const secrets = ctx().secrets || {};
  return Object.keys(secrets).filter((id) => secrets[id]?.key && !String(id).startsWith("demo-"));
}
function countMissionFiles() {
  try {
    if (HOSTED) return ctx().store.listMissions(() => ({ ok: 1 })).length;
    return fs.readdirSync(path.join(DATA_DIR, "missions")).filter((f) => f.endsWith(".json")).length;
  } catch { return 0; }
}
function countBookmarks() {
  let n = 0;
  try {
    for (const p of listProjects()) for (const c of p.categories || []) n += (c.links || []).filter((l) => l?.url).length;
  } catch { /* projects not loaded yet */ }
  if (!HOSTED) {
    try {
      for (const f of fs.readdirSync(DATA_DIR)) if (f.startsWith("bookmarks-backup-") && f.endsWith(".json")) n += 1;
    } catch { /* no data dir */ }
  }
  return n;
}
function onboardingHistory() {
  return historyReasons({
    vaultKeyIds: vaultKeyIds(),
    settings: settings(),
    defaults: DEFAULT_SETTINGS,
    ledgerCount: ctx().ledger?.length || 0,
    missionCount: countMissionFiles(),
    bookmarkCount: countBookmarks(),
  });
}
function readOnboarding() { return normalizeRecord(ctx().docs?.[DOC_KIND]); }
function writeOnboarding(record) { return putDoc(DOC_KIND, record); }
function onboardingPlan() {
  return planOnboarding({ record: readOnboarding(), history: onboardingHistory(), now: Date.now(), version: ONBOARDING_VERSION });
}
function onboardingState() { return publicOnboarding(onboardingPlan()); }
function catalogNow() {
  return Object.values(PROVIDERS).filter((p) => p && !p.demo).map((p) => {
    const models = [];
    const seen = new Set();
    for (const m of p.models || []) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      models.push({ id: m.id, name: m.name || m.id });
    }
    for (const id of liveModels[p.id] || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({ id, name: id });
    }
    return { id: p.id, name: p.name, models };
  });
}
function keyedProviderIds() {
  const have = new Set(vaultKeyIds());
  return Object.keys(PROVIDERS).filter((id) => have.has(id) && !PROVIDERS[id]?.demo);
}
// Mark setup done when a flag or any history already exists. Does not scan or touch bookmarks.
function prepareOnboarding() {
  const plan = onboardingPlan();
  if (plan.changed) writeOnboarding(plan.record);
  if (!plan.show && settings().onboarded !== true) saveSettings({ ...settings(), onboarded: true });
  if (plan.changed && !plan.show) console.log(`[onboarding] setup already done (${plan.reason})`);
  return plan;
}
function runDailyCheck() {
  const result = applyDailyCheck({ record: readOnboarding(), catalog: catalogNow(), keyIds: keyedProviderIds(), now: Date.now() });
  if (result.ran) writeOnboarding(result.record);
  if (result.notice) emit("onboarding.notice", { text: result.notice, at: result.record.notice?.at || Date.now() });
  return result;
}

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
    onboarding: onboardingState(), pairing: pairingView(), connectSetup: connectSetupPublic(),
  };
}

function pairingView() {
  const saved = phonePair();
  const address = preferredLanIPv4(readInterfaces());
  const listening = !!(lanServer && address && lanServer.listening);
  const url = saved.on && listening ? pairUrl(address, PORT, saved.token) : null;
  return {
    on: !!url,
    url,
    address: address || null,
    port: PORT,
    error: pairingError,
    firewall: firewallStatus.skipped ? null : { ok: !!firewallStatus.ok, error: firewallStatus.error || null },
  };
}

// What the browser may know before signing in.
const publicConfig = () => ({ mode: MODE, version: VERSION, name: "Meldmind", tagline: "an Everborn product", subtitle: "Take command of all your AIs.", supabase: HOSTED ? { url: CFG.url, anonKey: CFG.anonKey } : null, hub: HOSTED ? CFG.hubUrl : null, sso: ssoProviders() });

// ---------- single-AI chat (streams through the event bus) ----------
// Custom agents (Phase 19) pass system (their instructions), agent ({ id, name }), agentId (its libraries),
// toolAllow (the tools it may use) and runId; a plain chat passes none of them.
async function runChat({ prompt, provider, model, projectId, search, tools, libraries, system, agent: customAgent, agentId, toolAllow, runId, capability, difficulty, mode }) {
  const user = ctx();
  user.chatsInFlight = (user.chatsInFlight || 0) + 1;
  try { return await runChatBody({ prompt, provider, model, projectId, search, tools, libraries, system, agent: customAgent, agentId, toolAllow, runId, capability, difficulty, mode }); }
  finally { user.chatsInFlight = Math.max(0, (user.chatsInFlight || 1) - 1); }
}
async function runChatBody({ prompt, provider, model, projectId, search, tools, libraries, system, agent: customAgent, agentId, toolAllow, runId, capability, difficulty, mode }) {
  const id = runId || "s-" + Date.now().toString(36);
  const priority = chatPriority(mode);
  let cls = null;
  // A caller that already asked the router (a walkthrough step) passes that task type.
  // The record then uses it, instead of guessing again from the long prompt.
  const given = capability ? { capability, difficulty: difficulty ?? 2 } : null;
  if (!provider || !model) {
    cls = given || await classify(prompt, { onCall: (c) => recordCall({ ...c, missionId: id }) });
    const best = rank({ ...cls, mode: priority })[0];
    const pausedPick = best ? describePause(best.provider) : null;
    if (!best || pausedPick) {
      const named = pausedPick || Object.values(PROVIDERS).map((p) => (p.kind === "text" && !p.demo ? describePause(p.id) : null)).find(Boolean);
      if (named) return finishPausedChat({ id, prompt, projectId, customAgent, message: named.message, billing: named.billing, provider: named.provider });
      throw new Error("No AI available. Add a key in Settings.");
    }
    provider = best.provider; model = best.model;
  }
  let agent = `${id}:${provider}`;
  const taskType = () => (cls ||= given || heuristicClassify(prompt));
  const m = { id, kind: "single", prompt, projectId: projectId || null, status: "running", startedAt: Date.now(), provider, model, cost: 0, deliverable: "", sources: [], toolCalls: [], fallbacks: [], ...(customAgent ? { customAgent } : {}) };
  const title = (customAgent ? `${customAgent.name}: ${prompt}` : prompt).slice(0, 90);
  emit("mission.update", { mission: { ...m, title, tasks: [] } });
  // live web search (Phase 15): numbered results go into the prompt; the answer cites them as [n]
  const web = await webAugment({ prompt, kind: "single", provider, model, missionId: id, explicit: typeof search === "boolean" ? search : undefined });
  if (web?.sources?.length) { m.sources = web.sources; m.searchEngine = web.name; m.cost = +(m.cost + (web.cost || 0)).toFixed(6); }
  // knowledge libraries (Phase 18): the chat's, the active workspace's, or the ones the request names; excerpts cited as [L1], [L2]
  const lib = await libraryAugment({ prompt, projectId, agentId: agentId || null, missionId: id, explicit: Array.isArray(libraries) ? libraries : undefined });
  if (lib) { m.librarySources = publicLibrarySources(lib.sources); m.cost = +(m.cost + (lib.cost || 0)).toFixed(6); }
  // project memory (R5): the project's voice, offers, never-say list and past winners ride along
  const ask = withMemory(`${web?.prompt || prompt}${lib?.block ? `\n\n${lib.block}` : ""}`, projectId);
  m.memory = ask.includes(MEMORY_MARKER);
  const known = trouble(provider);
  const sittingOut = fallbackSettings().on && known && (known.kind === "credits" || known.kind === "rate");
  if (!sittingOut) emit("agent.start", { agent, provider, model, role: "answer", missionId: id, label: `${customAgent ? `${customAgent.name} (${PROVIDERS[provider].name})` : PROVIDERS[provider].name} answering${web?.native ? " (with its own web search)" : web?.sources?.length ? ` (with ${web.sources.length} web sources)` : ""}${lib?.sources?.length ? ` (with ${lib.sources.length} library excerpts)` : ""}` });
  const s = Date.now();
  let text = "";
  try {
    // MCP tools (Phase 16): enabled tools ride along for providers that can call them; writes ask first.
    // Smart fallback (Phase 26): a provider that is out of credits, rate limited or refusing its key is
    // replaced mid-run (same model via OpenRouter first, then the next-best model) and the run says so.
    for await (const ev of fallbackChat({ provider, model, maxTokens: 3000, webSearch: !!web?.native, system: system || "You are a sharp, concrete expert assistant. Markdown allowed. No filler.", messages: [{ role: "user", content: ask }] }, { missionId: id, tools, allow: Array.isArray(toolAllow) ? toolAllow : undefined, role: "answer", cls: cls || undefined, mode: priority })) {
      if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
      else if (ev.type === "fallback") {
        text = ""; m.fallbacks.push(fallbackRecord(ev));
        const next = `${id}:${ev.to.provider}`;
        announceFallback(ev, { missionId: id, agentFrom: agent, agentTo: next, role: "answer" });
        agent = next; provider = ev.to.provider; model = ev.to.model; m.provider = provider; m.model = model; m.via = ev.via || null;
        emit("mission.update", { mission: { ...m, title, tasks: [] } });
      }
      else if (ev.type === "tool" && ev.phase === "done") { m.toolCalls.push({ tool: ev.tool, server: ev.server, ok: ev.ok, denied: ev.denied, ms: ev.ms }); emit("mission.update", { mission: { ...m, title, tasks: [] } }); }
      else if (ev.type === "done") {
        const ms = Date.now() - s;
        noteCall(provider, true, ms);
        const e = recordCall({ provider, model, usage: ev.usage, missionId: id, role: "answer", ms });
        m.cost = +(m.cost + e.cost).toFixed(6);
        // learning router (Phase 28): the job, its cost and speed, and the task type the router used
        observe({ provider, model, capability: taskType().capability, difficulty: taskType().difficulty, runId: id, ok: true, cost: e.cost, ms, free: e.free });
        if (web?.native && ev.citations?.length) { m.sources = sourcesFromCitations(ev.citations); m.searchEngine = web.name; m.cost = +(m.cost + recordNative(provider, ev.citations, { missionId: id })).toFixed(6); }
        emit("agent.done", { agent, provider, model, missionId: id, ms, cost: e.cost });
      }
    }
    m.status = "done";
  } catch (err) {
    if (err.code !== "cap" && err.code !== "paused") noteCall(provider, false, Date.now() - s, err); // a spend-cap stop is not the provider's failure; a pause was already known
    if (!sittingOut) emit("agent.error", { agent, provider, model, missionId: id, error: err.message });
    if (!troubleKind(err) && err.code !== "paused") observe({ provider, model, capability: taskType().capability, difficulty: taskType().difficulty, runId: id, ok: false });
    m.status = "failed"; m.error = err.message;
    if (err.code === "paused") m.deliverable = err.message;
  }
  if (!m.deliverable) m.deliverable = text;
  const creditHop = (m.fallbacks || []).find((f) => f.kind === "credits" || f.kind === "rate");
  if (creditHop && !m.notice) m.notice = pauseNotice(creditHop);
  m.finishedAt = Date.now();
  ctx().store.saveMission(m, missionSummary({ ...m, title }));
  emit("mission.update", { mission: { ...m, title, tasks: [] } });
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
  if (method === "GET" && p === "/missions") {
    const q = url.searchParams.get("q");
    try { return json(res, 200, q && q.trim() ? missionSearch(q) : missionList()); }
    catch (e) { return json(res, e.status || 500, { error: e.message, code: e.code }); }
  }
  if (method === "GET" && seg[0] === "missions" && seg[1]) {
    const m = await ctx().store.getMission(seg[1].replace(/[^a-z0-9-]/gi, ""));
    return m ? json(res, 200, m.kind === "mission" ? publicMission(m) : m) : json(res, 404, { error: "not found" });
  }
  if (method === "GET" && p === "/route") {
    const prompt = url.searchParams.get("prompt") || "";
    if (!prompt.trim()) return json(res, 400, { error: "prompt required" });
    const cls = await classify(prompt, { onCall: (c) => recordCall({ ...c, role: "classify" }) });
    const mode = normalizeMode(url.searchParams.get("mode") || settings().defaultMode) || "balanced";
    const ranked = rank({ ...cls, mode }).slice(0, 6);
    return json(res, 200, { classification: cls, ranked, cheaper: cheaperRoute(cls), defer: deferAdvice(cls, mode), councilEstimate: ranked.slice(0, 4).reduce((a, m) => a + m.estCost, 0) * 2.4, agent: grokbotRoute(prompt), browserHelper: browserRoute(prompt) });
  }
  if (method === "GET" && p === "/models") return json(res, 200, availableModels());

  // a raw zip upload (history import, Phase 23) is streamed by its plugin, not read as JSON here
  const body = (method === "POST" || method === "PUT" || method === "PATCH") && !isZipUpload(req, url) ? await readBody(req) : {};

  if (method === "POST" && p === "/keys") {
    if (!PROVIDERS[body.provider]) return json(res, 400, { error: "unknown provider" });
    const prev = getOwnSecret(body.provider); // never a workspace's key (Phase 24)
    const key = String(body.key || "").trim() || (body.workspaceId !== undefined && !prev?.fromEnv ? prev?.key || "" : "");
    if (!key) return json(res, 400, { error: "key required" });
    try { await assertServiceSlots([body.provider]); }
    catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); }
    const keepHeaders = PROVIDERS[body.provider].custom ? prev?.headers : null; // custom providers keep their extra headers
    const value = { key };
    if (body.secret) value.secret = String(body.secret).trim();
    if (keepHeaders) value.headers = keepHeaders;
    // Anthropic: optional workspace ID, sent as anthropic-workspace-id on every Anthropic request
    if (body.provider === "anthropic") { const ws = body.workspaceId !== undefined ? String(body.workspaceId || "").trim() : prev?.workspaceId || ""; if (ws && !/^[A-Za-z0-9_-]{4,100}$/.test(ws)) return json(res, 400, { error: "That does not look like a workspace ID (letters, digits, _ and - only)." }); if (ws) value.workspaceId = ws; }
    await setSecret(body.provider, value);
    noteKeySaved(body.provider);
    const t0 = Date.now() - 1;
    const st = await checkProvider(body.provider);
    stampAfterCheck(body.provider);
    const demoRetired = await retireDemoIfReal(t0);
    return json(res, 200, { ok: true, status: st, masked: maskedKey(body.provider), demoRetired });
  }
  if (method === "DELETE" && seg[0] === "keys" && seg[1]) { noteKeySaved(seg[1]); await setSecret(seg[1], null); await checkProvider(seg[1]); stampAfterCheck(seg[1]); return json(res, 200, { ok: true }); }
  if (method === "POST" && p === "/check") { await checkAll(); for (const id of Object.keys(PROVIDERS)) stampAfterCheck(id); return json(res, 200, allStatus()); }
  if (method === "POST" && seg[0] === "check" && seg[1]) { const st = await checkProvider(seg[1]); stampAfterCheck(seg[1]); return json(res, 200, st); }

  if (method === "POST" && p === "/council") {
    let job = body;
    try { job = expandJob(body, "prompt"); }
    catch (e) { return json(res, e.status || 400, { error: e.message, code: e.code, missing: e.missing, questions: e.questions }); }
    if (!job.prompt?.trim()) return json(res, 400, { error: "prompt required" });
    let promise;
    try { promise = startCouncil({ prompt: job.prompt, members: job.members, chair: job.chair, projectId: job.projectId, qa: job.qa !== false, lite: !!job.lite, mode: job.mode, search: typeof job.search === "boolean" ? job.search : undefined, tools: typeof job.tools === "boolean" ? job.tools : undefined, grokbot: typeof job.grokbot === "boolean" ? job.grokbot : undefined, browser: typeof job.browser === "boolean" ? job.browser : undefined, libraries: Array.isArray(job.libraries) ? job.libraries : undefined }); }
    catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); }
    promise.catch((e) => emit("log", { text: `Council failed: ${e.message}`, level: "error" }));
    return json(res, 202, { ok: true });
  }
  if (method === "POST" && p === "/mission") {
    let job = body;
    try { job = expandJob(body, "goal"); }
    catch (e) { return json(res, e.status || 400, { error: e.message, code: e.code, missing: e.missing, questions: e.questions }); }
    if (!job.goal?.trim()) return json(res, 400, { error: "goal required" });
    try { guard("missions"); if (job.runAt === "offpeak") guard("scheduler"); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); }
    const s = settings();
    const opts = { goal: job.goal, mode: normalizeMode(job.mode || s.defaultMode) || "balanced", projectId: job.projectId, qa: job.qa !== false, budgetUsd: Number(job.budgetUsd) || s.missionBudget, context: job.context || "", search: typeof job.search === "boolean" ? job.search : undefined, tools: typeof job.tools === "boolean" ? job.tools : undefined, grokbot: typeof job.grokbot === "boolean" ? job.grokbot : undefined, browser: typeof job.browser === "boolean" ? job.browser : undefined, libraries: Array.isArray(job.libraries) ? job.libraries : undefined };
    if (job.runAt === "offpeak") {
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
    let job = body;
    try { job = expandJob(body, "prompt"); }
    catch (e) { return json(res, e.status || 400, { error: e.message, code: e.code, missing: e.missing, questions: e.questions }); }
    if (!job.prompt?.trim()) return json(res, 400, { error: "prompt required" });
    runChat(job).catch((e) => emit("log", { text: `Chat failed: ${e.message}`, level: "error" }));
    return json(res, 202, { ok: true });
  }

  if (method === "POST" && p === "/projects") {
    if (typeof body.name === "string") body.name = body.name.trim();
    const name = typeof body.name === "string" ? body.name : "";
    if (!body.id && !name) return json(res, 400, { error: "name required" });
    if (body.id && body.name != null && !name) return json(res, 400, { error: "name required" });
    const existing = listProjects();
    const updating = !!(body.id && existing.some((x) => x.id === body.id));
    if (name) {
      const problem = projectNameError(name, existing, updating ? body.id : "");
      if (problem) return json(res, 400, { error: problem === "Type a project name." ? "name required" : problem });
    }
    const id = body.id || projectSlug(name);
    if (!existing.some((x) => x.id === id)) { try { guard("projects", { count: existing.length }); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code }); } }
    return json(res, 200, saveProject(body));
  }
  if (method === "DELETE" && seg[0] === "projects" && seg[1] && !seg[2]) { deleteProject(seg[1]); return json(res, 200, { ok: true }); }
  if (method === "POST" && seg[0] === "projects" && seg[2] === "links") return json(res, 200, addLink(seg[1], body.categoryId, body));
  if (method === "DELETE" && seg[0] === "projects" && seg[2] === "links") return json(res, 200, removeLink(seg[1], url.searchParams.get("category"), url.searchParams.get("url")));

  if (seg[0] === "subscriptions" && method !== "GET") { try { guard("subscriptions"); } catch (e) { return json(res, e.status || 402, { error: e.message, code: e.code, locked: true }); } }
  if (method === "POST" && p === "/subscriptions") { try { return json(res, 200, saveSubscription(body)); } catch (e) { return json(res, e.status || 400, { error: e.message }); } }
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
  if (method === "POST" && p === "/setup/done") {
    writeOnboarding(completeRecord(readOnboarding(), Date.now()));
    const s = saveSettings({ ...settings(), onboarded: true });
    try { runDailyCheck(); } catch (e) { console.error("[onboarding]", e.message); }
    return json(res, 200, s);
  }
  if (method === "GET" && p === "/onboarding") return json(res, 200, onboardingState());
  if (method === "POST" && p === "/onboarding/ack") {
    const rec = readOnboarding();
    writeOnboarding({ ...rec, notice: null });
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && p === "/onboarding/check") {
    let result;
    try { result = runDailyCheck(); } catch (e) { return json(res, 500, { error: e.message }); }
    return json(res, 200, { ran: !!result.ran, throttled: !!result.throttled, skipped: !!result.skipped, notice: result.notice || null, onboarding: onboardingState() });
  }
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
  if (method === "POST" && p === "/demo/ack") { saveSettings({ ...settings(), demoNotice: false }); return json(res, 200, { ok: true }); }
  if (method === "POST" && p === "/demo") {
    if (body.on) await startDemo(); else await stopDemo();
    // turning demo on while real keys are validated is a deliberate choice: keep it until switched off
    saveSettings({ ...settings(), demo: !!body.on, demoKeep: !!body.on && realValidated(), demoNotice: false });
    await checkAll();
    emit("log", { text: body.on ? "Demo mode on: three pretend AIs are online. No credits are spent." : "Demo mode off." });
    return json(res, 200, { demo: demoActive(), providers: providerView() });
  }
  if (method === "POST" && p === "/settings") {
    const { cloud, phonePair: _pair, ...rest } = body; // cloud and phone pairing have their own routes
    if (rest.defaultMode != null) rest.defaultMode = normalizeMode(rest.defaultMode) || "balanced";
    return json(res, 200, saveSettings({ ...settings(), ...rest }));
  }
  if (p === "/pairing" && method === "GET") return json(res, 200, pairingView());
  if (p === "/pairing" && method === "POST") {
    try { return json(res, 200, await withPairLock(() => setPhonePair(!!body.on))); }
    catch (e) { return json(res, e.status || 500, { error: e.message, code: e.code }); }
  }
  if (p === "/pairing/qr.svg" && method === "GET") return pairingQr(res);
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

async function handleHttp(req, res) {
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${PORT}`); } catch { return json(res, 400, { error: "bad url" }); }
  try {
    // Grok Bot results (Phase 12): exempt from the session token, the Host pin (a tunnel or the hosted hub
    // forwards its own host name) and sign-in; the per-job token is checked instead and everything else is refused
    if (isGrokbotCallback(url.pathname)) return await grokbotCallback(req, res, url, json);
    // schedule webhooks (Phase 22): same exemption, checked against the trigger's own secret token instead
    if (isScheduleHook(url.pathname)) return await scheduleHook(req, res, url, json);
    // browser extension (Phase 24): exempt from the session token only; the Host pin stays, web origins are
    // refused and the pairing code is checked instead (server/plugins/extension.js)
    if (isExtensionHook(url.pathname)) {
      if (!HOSTED && !hostOk(req)) return json(res, 421, { error: `wrong host: use http://127.0.0.1:${PORT}/`, code: "host" });
      return await extensionHook(req, res, url, json);
    }
    const gate = localGate(req, url);
    if (gate) return json(res, gate.status, { error: gate.error, code: gate.code });
    // A phone on the LAN does not receive the session token until it presents the pairing code.
    if (!HOSTED && isLanSocket(req.socket?.remoteAddress) && !url.pathname.startsWith("/api/") && !pairPresented(req, url)) {
      return text(res, 401, BAD_LINK);
    }
    if (!HOSTED && isLanSocket(req.socket?.remoteAddress) && pairTokenOk(url.searchParams.get("pair"), phonePair().token)) {
      res.setHeader("set-cookie", pairCookie(phonePair().token));
      res.setHeader("referrer-policy", "no-referrer");
    }
    if (HOSTED) { cors(req, res); if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); } }
    // Hosted cron tick. The shared secret is the only check. Local mode answers 404 and keeps its own timer.
    if (url.pathname === TICK_PATH) return handleScheduleTick(req, res, json);
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method) && hasBody(req) && !isJson(req) && !isZipUpload(req, url)) return json(res, 415, { error: "content-type must be application/json", code: "content_type" });
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, app: "command-ai", mode: MODE, version: VERSION, uptime: Math.round(process.uptime()), instance: process.env.CC_INSTANCE || null });
    if (url.pathname === "/api/config") return json(res, 200, publicConfig());
    if (url.pathname === "/api/pair/qr.svg") return pairQr(res, url);
    if (url.pathname === "/api/sso/start") return ssoStart(req, res, url, json); // Google / Microsoft sign-in on the hub (Phase 24)
    if (url.pathname.startsWith("/api/")) {
      if (!HOSTED) return await api(req, res, url);
      let c;
      try { c = await contextForToken(bearer(req)); } catch (e) { return json(res, e.status || 401, { error: e.message, code: e.status === 401 ? "unauthorized" : undefined }); }
      return await als.run(c, () => api(req, res, url));
    }
    // static
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(path.join(WEB_DIR, file));
    if ((file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    if (path.basename(file) === "index.html" || path.relative(WEB_DIR, file) === "quick.html") { // quick.html: the desktop quick launcher (Phase 24)
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
    // Performance (Phase 11): "no-cache" still revalidates every time, so an ETag lets the browser keep its copy
    // (304, no body) until the file changes. Updates still show at once; HTML and sw.js above are never cached.
    const st = fs.statSync(file);
    const etag = path.extname(file) === ".html" ? undefined : `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (etag && req.headers["if-none-match"] === etag) { res.writeHead(304, { etag, "cache-control": "no-cache" }); return res.end(); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache", ...(etag ? { etag } : {}), "content-length": st.size });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    console.error(e && e.message ? e.message : e);
    json(res, 500, { error: e.message });
  }
}

function text(res, status, body) {
  const b = Buffer.from(String(body || ""));
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "content-length": b.length });
  res.end(b);
}

const server = http.createServer(handleHttp);
const socketServers = [];
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
function trackSocket(ws, c) {
  if (!c) return;
  c.openSockets = (c.openSockets || 0) + 1;
  ws.on("close", () => {
    c.openSockets = Math.max(0, (c.openSockets || 1) - 1);
    c.lastSeen = Date.now();
  });
}
function onWs(ws, req) {
  if (!HOSTED) {
    // local: same Host/Origin pinning as HTTP, then the per-launch token as the first message
    if (!hostOk(req) || !originOk(req)) { ws.close(4403, "cross-site refused"); return; }
    const timer = setTimeout(() => ws.close(4401, "auth timeout"), 15000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      let m = null; try { m = JSON.parse(String(raw)); } catch {}
      if (m?.type !== "auth" || !tokenOk(m?.token)) { send(ws, { type: "auth.error", error: "session token missing or wrong: reload the page" }); ws.close(4401, "unauthorized"); return; }
      ws.ctx = ctx(); trackSocket(ws, ws.ctx); send(ws, { type: "hello", state: fullState() });
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
      trackSocket(ws, c);
      send(ws, { type: "hello", state: runAs(c, fullState) });
    } catch (e) { send(ws, { type: "auth.error", error: e.message }); ws.close(4401, "unauthorized"); }
  });
}
function attachWs(httpServer) {
  const w = new WebSocketServer({ server: httpServer, path: "/ws" });
  w.on("connection", onWs);
  w.on("error", () => {});
  socketServers.push(w);
  return w;
}
attachWs(server);
function eachClient(fn) { for (const w of socketServers) for (const c of w.clients) fn(c); }

function withPairLock(fn) {
  const run = pairLock.then(fn, fn);
  pairLock = run.then(() => {}, () => {});
  return run;
}
async function closeLan() {
  const lan = lanServer;
  const w = lanWss;
  lanServer = null;
  lanWss = null;
  if (w) {
    const i = socketServers.indexOf(w);
    if (i >= 0) socketServers.splice(i, 1);
    try { for (const client of w.clients) client.close(1001, "pairing off"); } catch {}
    try { w.close(); } catch {}
  }
  // server.close() stops new connections but leaves a phone's open socket up, so the
  // phone would never see that pairing turned off. Drop those sockets too.
  if (lan) {
    try { lan.closeAllConnections(); } catch {}
    await new Promise((resolve) => lan.close(() => resolve()));
  }
}
async function openLan(ip) {
  if (!ip || !isPrivateIPv4(ip)) throw Object.assign(new Error(NO_LAN), { code: "lan" });
  if (lanServer && lanServer.listening && lanWss) {
    const bound = lanServer.address();
    if (bound && bound.address === ip) return;
  }
  await closeLan();
  const lan = http.createServer(handleHttp);
  await new Promise((resolve, reject) => {
    const fail = (e) => { lan.off("error", fail); reject(e); };
    lan.once("error", fail);
    lan.listen(PORT, ip, () => { lan.off("error", fail); resolve(); });
  });
  lanWss = attachWs(lan);
  lanServer = lan;
  const reached = await probePort(ip, PORT, net);
  if (!reached) {
    await closeLan();
    throw Object.assign(new Error(unreachableError(ip, PORT)), { code: "reach" });
  }
}
async function setPhonePair(on) {
  if (HOSTED) { pairingError = "Phone pairing is for the desktop app on this PC."; return pairingView(); }
  if (!on) {
    await closeLan();
    const next = { ...settings() };
    delete next.phonePair;
    saveSettings(next);
    pairingError = null;
    firewallStatus = { ok: true, skipped: true };
    console.log("Phone pairing off. This PC answers only on this computer.");
    emit("log", { text: "Phone pairing off. This PC answers only on this computer." });
    return pairingView();
  }
  guard("phone");
  const address = preferredLanIPv4(readInterfaces());
  if (!address) {
    pairingError = NO_LAN;
    console.log(pairingError);
    emit("log", { text: pairingError });
    return pairingView();
  }
  const prev = phonePair();
  const token = prev.on && prev.token ? prev.token : newPairToken();
  saveSettings({ ...settings(), phonePair: { on: true, token } });
  try { await openLan(address); }
  catch (e) {
    await closeLan();
    const next = { ...settings() };
    delete next.phonePair;
    saveSettings(next);
    pairingError = e.code === "reach" ? e.message : BIND_FAIL;
    console.log(pairingError);
    emit("log", { text: pairingError });
    return pairingView();
  }
  firewallStatus = await ensureWindowsFirewall();
  pairingError = firewallStatus.error || null;
  console.log(`Phone pairing on at ${address}:${PORT}.`);
  emit("log", { text: `Phone pairing on at ${address}:${PORT}.` });
  return pairingView();
}
function pairingQr(res) {
  const view = pairingView();
  if (!view.url) return json(res, 404, { error: view.error || "Phone pairing is off." });
  const qr = qrcode(0, "M"); qr.addData(view.url); qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
  res.end(svg);
}
bus.on("event", (ev) => {
  const msg = JSON.stringify(ev);
  eachClient((c) => { if (c.readyState === 1 && c.ctx && (!ev.user || c.ctx.userId === ev.user)) c.send(msg); });
});
// Periodic state refresh (ledger totals, subscription view) so the UI never drifts
setInterval(() => {
  const byCtx = new Map();
  eachClient((c) => { if (c.readyState !== 1 || !c.ctx) return; if (!byCtx.has(c.ctx)) byCtx.set(c.ctx, []); byCtx.get(c.ctx).push(c); });
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
  if (HOSTED) await loadWorkspaceKeys().catch((e) => console.error("[workspace-keys]", e.message)); // the active workspace's keys (Phase 24)
  prepareOnboarding();
  const userCtx = ctx();
  const health = checkAll().then(() => retireDemoIfReal()).catch(() => {});
  if (!HOSTED) health.finally(() => { healthReady = true; dailyCtx = userCtx; tryDailyCheck(); });
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
  await loadPlugins({ json, emit, bus, settings, PROVIDERS, rank, classify, runMission: startMission, runCouncil: startCouncil, runChat, recordCall, recordCredits, ledgerSummary, listProjects, saveProject, subscriptionView, saveSubscription: saveSubscriptionGated, licenseState, requireFeature, guard, HOSTED, DATA_DIR, VERSION, readBody, streamChat, complete, getSecret, setSecret, hasSecret, doc, putDoc, ctx, runAs, retireDemoIfReal });
  pluginsReady = true;
  tryDailyCheck();
  // A taken port is a clear message and exit code 1, not a stack trace. The desktop app picks a free port
  // and then trusts only its own instance id (decision 6), so it never mistakes another server for this one.
  // ws re-emits the HTTP server's errors on wss; that copy is handled here, so it is ignored there.
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Command AI could not start: port ${PORT} in use (EADDRINUSE). Another copy may be running; close it or set CC_PORT.` : `Command AI server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(PORT, HOSTED ? "0.0.0.0" : "127.0.0.1", async () => {
    console.log(`Meldmind (${MODE})  →  http://localhost:${PORT}`);
    if (HOSTED) console.log(`supabase: ${CFG.url}\nhub:      ${CFG.hubUrl || "(CC_HUB_URL not set)"}\nservice key: ${CFG.serviceKey ? "yes" : "no (writes use each user's own token)"}`);
    else console.log(`data: ${DATA_DIR}\nHQ:   ${HQ_DIR || "(not linked; set CC_HQ_DIR)"}`);
    if (!HOSTED && phonePair().on) {
      const address = preferredLanIPv4(readInterfaces());
      try {
        await openLan(address);
        firewallStatus = await ensureWindowsFirewall();
        pairingError = firewallStatus.error || null;
        console.log(`Phone pairing on at ${address}:${PORT}.`);
        emit("log", { text: `Phone pairing on at ${address}:${PORT}.` });
      } catch (e) {
        pairingError = e.code === "reach" || e.code === "lan" ? (e.message || BIND_FAIL) : BIND_FAIL;
        console.log(pairingError);
        emit("log", { text: pairingError });
      }
    }
    startCreditHealthLoop();
    startUpdateLoop();
    startLicenseLoop();
    // Hosted only: drop idle users from memory. Local mode keeps its one context.
    if (HOSTED) setInterval(() => evictIdle({ socketCount: (c) => { let n = 0; eachClient((ws) => { if (ws.readyState === 1 && ws.ctx === c) n += 1; }); return n; } }).catch((e) => console.error("[idle]", e.message)), 60 * 1000).unref();
  });
})().catch((e) => { console.error(e.message); process.exit(1); });
