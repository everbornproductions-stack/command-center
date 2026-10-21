// Desktop control: list installed programs, let the person allow each one,
// score the allowed ones the same way a user-added tool is scored, and
// suggest a program while a mission or client job is being planned.
// Nothing is installed or bought here.

import { capsFor, inferCapabilities } from "./added-caps.js";
import { bundledCatalog, hydrateCatalog, matchOne, mergeCatalog, normName, pullCatalog, storedCatalog } from "./app-catalog.js";
import { scanInstalled, liveIo } from "./app-scan.js";
import { addRouteSource } from "./route-extras.js";
import { doc, putDoc } from "./store.js";
import { heuristicClassify } from "./router.js";

const DOC = "apps.discovery";

function empty() {
  return { optedIn: false, suggestions: true, scannedAt: null, allows: {}, dismissed: [], apps: [], catalogExtra: [] };
}

export function loadState() {
  const saved = doc(DOC, empty);
  const base = empty();
  return {
    ...base,
    ...saved,
    allows: { ...base.allows, ...(saved?.allows || {}) },
    dismissed: Array.isArray(saved?.dismissed) ? saved.dismissed : [],
    apps: Array.isArray(saved?.apps) ? saved.apps : [],
    catalogExtra: Array.isArray(saved?.catalogExtra) ? saved.catalogExtra : [],
  };
}

function saveState(next) {
  putDoc(DOC, next);
  return next;
}

export function activeCatalog(state = loadState()) {
  return mergeCatalog(bundledCatalog(), hydrateCatalog(state.catalogExtra || []));
}

function slug(name, catalogId) {
  if (catalogId) return catalogId;
  const s = normName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return s || "app";
}

export function describeFound(found, catalog) {
  const rows = [];
  const seen = new Set();
  for (const item of found || []) {
    const hit = matchOne(item.name, catalog) || (item.file ? matchOne(item.file, catalog) : null);
    if (item.source === "path" && !hit) continue;
    const id = slug(hit?.title || item.name, hit?.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const inferred = hit ? [] : inferCapabilities({ name: item.name });
    const capabilities = hit ? hit.capabilities : inferred;
    rows.push({
      id,
      title: hit?.title || item.name,
      source: item.source,
      publisher: item.publisher || "",
      catalogId: hit?.id || null,
      capabilities,
      capabilitiesSource: hit ? "catalog" : inferred.length ? "name" : "none",
      price: hit?.price || null,
      url: hit?.url || null,
      reason: hit?.reason || "",
    });
    if (rows.length >= 250) break;
  }
  return rows;
}

export async function optIn(on, io = liveIo()) {
  const cur = loadState();
  if (!on) return saveState({ ...cur, optedIn: false });
  const found = await scanInstalled(io);
  const apps = describeFound(found, activeCatalog(cur));
  return saveState({ ...cur, optedIn: true, scannedAt: Date.now(), apps });
}

export async function rescan(io = liveIo()) {
  const cur = loadState();
  if (!cur.optedIn) {
    const err = new Error("Turn on desktop control before scanning.");
    err.status = 400;
    throw err;
  }
  const apps = describeFound(await scanInstalled(io), activeCatalog(cur));
  return saveState({ ...cur, scannedAt: Date.now(), apps });
}

export function setAllowed(id, allowed) {
  const cur = loadState();
  if (!cur.optedIn) {
    const err = new Error("Turn on desktop control before allowing an app.");
    err.status = 400;
    throw err;
  }
  const app = cur.apps.find((row) => row.id === id);
  if (!app) {
    const err = new Error("That program is not in the list.");
    err.status = 404;
    throw err;
  }
  const allows = { ...cur.allows, [id]: !!allowed };
  return saveState({ ...cur, allows });
}

export function dismissSuggestion(id) {
  const key = String(id || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(key)) {
    const err = new Error("That suggestion is not in the list.");
    err.status = 400;
    throw err;
  }
  const cur = loadState();
  const dismissed = cur.dismissed.includes(key) ? cur.dismissed : [...cur.dismissed, key].slice(-80);
  return saveState({ ...cur, dismissed });
}

export function setSuggestions(on) {
  const cur = loadState();
  return saveState({ ...cur, suggestions: !!on });
}

export async function updateCatalog(url, fetchImpl, io = liveIo()) {
  const extra = storedCatalog(await pullCatalog(url, fetchImpl));
  const cur = loadState();
  const next = saveState({ ...cur, catalogExtra: extra });
  if (next.optedIn) return rescan(io);
  return next;
}

export function suggestFor(prompt, state = loadState()) {
  if (!state.optedIn || state.suggestions === false) return [];
  const text = String(prompt || "").trim();
  if (text.length < 12) return [];
  const cls = heuristicClassify(text);
  const installed = new Set(state.apps.map((row) => row.catalogId).filter(Boolean));
  const allowed = new Set(Object.entries(state.allows || {}).filter(([, on]) => on).map(([id]) => id));
  const gone = new Set(state.dismissed || []);
  const hits = [];
  for (const app of activeCatalog(state)) {
    if (gone.has(app.id) || allowed.has(app.id)) continue;
    if (!app.capabilities.includes(cls.capability)) continue;
    if (app.keywords && !app.keywords.test(text)) continue;
    if (!app.keywords) continue;
    hits.push({ app, installed: installed.has(app.id) });
  }
  hits.sort((a, b) => Number(b.installed) - Number(a.installed) || a.app.title.localeCompare(b.app.title));
  return hits.slice(0, 2).map(({ app, installed: onPc }) => ({
    id: app.id,
    title: app.title,
    reason: app.reason,
    price: app.price === "paid" ? "Paid" : "Free",
    url: app.url,
    installed: onPc,
  }));
}

export function routeRows(state = loadState()) {
  if (!state.optedIn) return [];
  const rows = [];
  for (const app of state.apps) {
    if (!state.allows?.[app.id]) continue;
    if (!app.capabilities?.length) continue;
    const caps = capsFor(app.capabilities);
    rows.push({
      provider: `app:${app.id}`,
      providerName: app.title,
      color: "#64748b",
      model: `app:${app.id}`,
      name: app.title,
      kind: "app",
      tier: "tool",
      in: 0,
      out: 0,
      caps,
      baseCaps: caps,
      available: true,
      keyed: true,
      status: "green",
      statusDetail: "Allowed on this PC",
      balance: null,
      discount: null,
      web: false,
      app: true,
      priceLabel: app.price,
      url: app.url,
    });
  }
  return rows;
}

export function publicState(state = loadState()) {
  return {
    optedIn: !!state.optedIn,
    suggestions: state.suggestions !== false,
    scannedAt: state.scannedAt || null,
    apps: (state.apps || []).map((app) => ({
      id: app.id,
      title: app.title,
      source: app.source,
      publisher: app.publisher || "",
      capabilities: app.capabilities || [],
      capabilitiesSource: app.capabilitiesSource || "none",
      price: app.price,
      url: app.url,
      reason: app.reason || "",
      allowed: !!state.allows?.[app.id],
    })),
  };
}

let routed = false;
export function installAppRoutes() {
  if (routed) return;
  routed = true;
  addRouteSource(() => {
    try { return routeRows(); } catch { return []; }
  });
}
