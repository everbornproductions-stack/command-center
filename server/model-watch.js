// Model watch (Phase 32). Once a day, read the public model list for each connected
// AI using the key saved for that provider. Read only. A new model or a price change
// becomes a plain note. A newer version can be accepted as a routing switch, or undone.
// The key is never logged and never leaves the provider's own address.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TEXT_PROVIDERS, geminiBase } from "./registry.js";
import { localFetch } from "./loopback-fetch.js";
import { redact, bad } from "./redact-text.js";

export const DAY = 24 * 60 * 60 * 1000;
export const DOC = "modelwatch.state";

const empty = () => ({ checkedAt: null, providers: {}, notes: [], suggestions: [], accepted: [] });

export function due(checkedAt, now = Date.now()) {
  return !checkedAt || now - Number(checkedAt) >= DAY;
}

export function listUrl(p) {
  if (!p?.baseUrl || p.id === "perplexity") return null;
  const base = String(p.baseUrl).replace(/\/$/, "");
  if (p.api === "anthropic") return `${base}/v1/models?limit=100`;
  if (p.id === "google" || p.api === "gemini") return `${geminiBase(p)}/models?pageSize=100`;
  if (p.api === "openai" || p.custom) return `${base}/models`;
  return null;
}

export function listHeaders(p, sec) {
  const headers = { accept: "application/json", "x-meldmind-watch": "read" };
  if (sec?.headers && typeof sec.headers === "object") {
    for (const [name, value] of Object.entries(sec.headers)) {
      if (!name || /^(host|content-length|authorization|x-api-key|x-goog-api-key)$/i.test(name)) continue;
      headers[name] = String(value).slice(0, 2000);
    }
  }
  const key = sec?.key && sec.key !== "no-key" ? sec.key : "";
  if (p.api === "anthropic") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    if (sec?.workspaceId) headers["anthropic-workspace-id"] = sec.workspaceId;
  } else if (p.id === "google" || p.api === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
  } else if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

// Per-token prices (OpenRouter style, tiny numbers) become USD per 1M tokens.
// Numbers already at or above $0.02 are treated as per 1M.
export function priceOf(row) {
  const p = row?.pricing && typeof row.pricing === "object" ? row.pricing : null;
  if (!p) return null;
  let inp = num(p.prompt ?? p.input ?? p.in);
  let out = num(p.completion ?? p.output ?? p.out);
  if (inp == null || out == null || inp < 0 || out < 0) return null;
  if (inp < 0.02 && out < 0.02) { inp *= 1e6; out *= 1e6; }
  if (inp > 1000 || out > 1000) return null;
  return { in: +inp.toFixed(4), out: +out.toFixed(4) };
}

export function parseModelList(json) {
  if (!json || typeof json !== "object") return null;
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : null;
  if (!rows) return null;
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    let id = String(row.id || row.name || row.model || "").trim();
    if (id.startsWith("models/")) id = id.slice("models/".length);
    id = id.split(":")[0].trim();
    if (!id || id.length > 160 || seen.has(id)) continue;
    seen.add(id);
    const rawName = row.display_name || row.displayName;
    const name = String(rawName || id).replace(/^models\//, "").slice(0, 120) || id;
    const price = priceOf(row);
    out.push(price ? { id, name, price } : { id, name });
    if (out.length >= 400) break;
  }
  return out;
}

export function familyKey(id) {
  return String(id || "")
    .toLowerCase()
    .replace(/-latest$/, "")
    .replace(/\d+(?:[._-]\d+)*/g, "")
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function versionParts(id) {
  const m = String(id || "").match(/\d+(?:[._-]\d+)*/);
  if (!m) return [];
  return m[0].split(/[._-]/).map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

export function isNewer(nextId, prevId) {
  const prevLatest = /-latest$/i.test(String(prevId || ""));
  const a = versionParts(nextId);
  const b = versionParts(prevId);
  if (a.length && prevLatest && !b.length) return true;
  if (!a.length || !b.length) return false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function suggestionsFor(known, added) {
  const out = [];
  for (const model of added) {
    const fam = familyKey(model.id);
    if (!fam || fam.length < 2) continue;
    const older = known.filter((k) => familyKey(k.id) === fam && isNewer(model.id, k.id));
    if (!older.length) continue;
    const from = older.find((k) => k.default) || older.slice().sort((a, b) => (isNewer(a.id, b.id) ? -1 : 1))[0];
    out.push({ from, to: model });
  }
  return out;
}

export function diffSnapshot(prev, nextModels) {
  const before = new Map((prev?.models || []).map((m) => [m.id, m]));
  const added = [];
  const priceChanges = [];
  for (const model of nextModels) {
    const old = before.get(model.id);
    if (!old) { added.push(model); continue; }
    if (model.price && old.price && (model.price.in !== old.price.in || model.price.out !== old.price.out)) {
      priceChanges.push({ id: model.id, name: model.name || model.id, from: old.price, to: model.price });
    }
  }
  return { first: !prev, added, priceChanges };
}

export function safeError(name, status, message) {
  const who = redact(name, 80);
  if (status === 401 || status === 403) return `${who} refused the key.`;
  if (status) return `Could not reach ${who}: HTTP ${status}.`;
  const msg = redact(String(message || "network error").replace(/https?:\/\/\S+/g, "the provider"), 160);
  return `Could not reach ${who}: ${msg}.`;
}

export function newsTarget() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "plugins", "newsfeed.js");
  return fs.existsSync(file) ? "shared" : "local";
}

export function watchable(list, secretFor) {
  const out = [];
  for (const p of list || []) {
    if (!p || p.demo || (p.kind && p.kind !== "text") || !listUrl(p)) continue;
    const sec = secretFor(p) || null;
    if (sec?.fromEnv || sec?.managed) continue;
    if (!p.noKey && !sec?.key) continue;
    out.push({ provider: p, secret: sec });
  }
  return out;
}

function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : "";
}

function noteId() { return "nw-" + crypto.randomBytes(6).toString("hex"); }

function pushNote(bucket, row) {
  bucket.push({
    id: noteId(),
    title: redact(row.title, 140),
    body: redact(row.body, 400),
    provider: row.provider,
    model: row.model || row.provider,
    at: row.at,
  });
}

export function buildChanges({ provider, known, diff, now, count = 0 }) {
  const notes = [];
  const suggestions = [];
  const name = provider.name || provider.id;
  if (diff.first) {
    pushNote(notes, {
      provider: provider.id,
      model: provider.id,
      title: `${name}: first look`,
      body: `${name}: first look saved ${count} models. Nothing to switch yet.`,
      at: now,
    });
    // The first look stores the list. "added" is every model, and that is not news.
    return { notes, suggestions };
  }
  for (const model of diff.added) {
    pushNote(notes, {
      provider: provider.id,
      model: model.id,
      title: `${name} has a new model: ${model.name || model.id}`,
      body: `${name} listed ${model.name || model.id}. Nothing changes until you accept a switch.`,
      at: now,
    });
  }
  for (const change of diff.priceChanges) {
    pushNote(notes, {
      provider: provider.id,
      model: change.id,
      title: `${name} changed the price of ${change.name}`,
      body: `${name} changed the list price of ${change.name} from ${money(change.from.in)} in and ${money(change.from.out)} out to ${money(change.to.in)} in and ${money(change.to.out)} out per 1M tokens. A price you typed yourself still wins.`,
      at: now,
    });
  }
  for (const hit of suggestionsFor(known, diff.added)) {
    const id = `sw-${provider.id}-${hit.to.id}`.replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 140);
    suggestions.push({
      id,
      provider: provider.id,
      providerName: name,
      fromId: hit.from.id,
      fromName: hit.from.name || hit.from.id,
      toId: hit.to.id,
      toName: hit.to.name || hit.to.id,
      toIn: hit.to.price?.in ?? null,
      toOut: hit.to.price?.out ?? null,
      status: "open",
      at: now,
      title: `Use ${hit.to.name || hit.to.id} instead of ${hit.from.name || hit.from.id}`,
      body: `${name} listed ${hit.to.name || hit.to.id}, which is newer than ${hit.from.name || hit.from.id}. Accept to let the router use it. Undo puts ${hit.from.name || hit.from.id} back.`,
    });
  }
  return { notes, suggestions };
}

function load(h) {
  const d = h.doc(DOC, empty);
  d.providers ||= {};
  d.notes ||= [];
  d.suggestions ||= [];
  d.accepted ||= [];
  d.checkedAt = d.checkedAt || null;
  return d;
}

export function present(state, extra = {}) {
  const now = extra.now || Date.now();
  return {
    checkedAt: state.checkedAt || null,
    nextAt: state.checkedAt ? state.checkedAt + DAY : null,
    due: due(state.checkedAt, now),
    skipped: !!extra.skipped,
    watched: extra.watched == null ? undefined : extra.watched,
    reason: extra.reason || null,
    news: newsTarget(),
    notes: state.notes.slice(-40).reverse(),
    suggestions: state.suggestions.slice(-40),
    accepted: state.accepted.map((a) => ({
      id: a.id, provider: a.provider, hide: a.hide, model: a.model?.id || null, name: a.model?.name || a.model?.id || "", at: a.at,
    })),
    providers: Object.entries(state.providers).map(([id, row]) => ({
      id, count: Array.isArray(row.models) ? row.models.length : 0, error: row.error || null, at: row.at || null,
    })),
    note: "Checked at most once a day. Your own key is used, read only. Nothing is switched until you accept it.",
  };
}

async function fetchList(p, sec) {
  const url = listUrl(p);
  const headers = listHeaders(p, sec);
  let r;
  try {
    r = await localFetch(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(8000) });
  } catch (e) {
    const timed = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw Object.assign(new Error(safeError(p.name, 0, timed ? "no answer in 8 seconds" : e.message)), { status: 0 });
  }
  if (r.status >= 300 && r.status < 400) {
    throw Object.assign(new Error(safeError(p.name, 0, "the model list redirected")), { status: r.status });
  }
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(safeError(p.name, r.status)), { status: r.status });
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  const models = parseModelList(json);
  if (!models) throw Object.assign(new Error(`${p.name} did not return a model list.`), { status: 502 });
  return models;
}

function remember(state, providerId, models, error, now) {
  const prev = state.providers[providerId] || {};
  state.providers[providerId] = {
    at: now,
    models: models || prev.models || [],
    error: error || null,
  };
}

const flights = new Map();

export function runWatch(h, opts = {}) {
  const key = (() => { try { return h.ctx().userId || "local"; } catch { return "local"; } })();
  if (flights.has(key)) return flights.get(key);
  const job = runWatchOnce(h, opts).finally(() => flights.delete(key));
  flights.set(key, job);
  return job;
}

async function runWatchOnce(h, { source = "daily", now = Date.now() } = {}) {
  const state = load(h);
  if (!due(state.checkedAt, now)) return present(state, { skipped: true, reason: "Already checked today.", watched: 0, now });
  const rows = watchable(TEXT_PROVIDERS, (p) => {
    try { return h.getSecret(p.id, p.keyEnv); } catch { return null; }
  });
  if (!rows.length) {
    return present(state, { skipped: false, watched: 0, reason: "No connected AI to watch yet. A key you save is used, and the list is read only.", now });
  }
  const freshNotes = [];
  const freshSuggestions = [];
  for (const { provider, secret } of rows) {
    try {
      const models = await fetchList(provider, secret);
      if (!models.length) {
        remember(state, provider.id, null, `${provider.name} returned an empty model list.`, now);
        if (source === "click") pushNote(freshNotes, { provider: provider.id, model: provider.id, title: `${provider.name}: empty list`, body: `${provider.name} returned an empty model list. Nothing was changed.`, at: now });
        continue;
      }
      const stored = state.providers[provider.id];
      const prev = stored?.models?.length ? stored : null;
      const known = (provider.models || []).map((m) => ({ id: m.id, name: m.name || m.id, default: !!m.default }));
      const diff = diffSnapshot(prev, models);
      const built = buildChanges({ provider, known, diff, now, count: models.length });
      if (!(diff.first && source !== "click")) freshNotes.push(...built.notes);
      if (!diff.first) freshSuggestions.push(...built.suggestions);
      remember(state, provider.id, models, null, now);
    } catch (e) {
      const message = e?.message || safeError(provider.name, e?.status, "network error");
      remember(state, provider.id, null, message, now);
      if (source === "click") pushNote(freshNotes, { provider: provider.id, model: provider.id, title: `${provider.name}: could not check`, body: message, at: now });
    }
  }
  for (const suggestion of freshSuggestions) {
    const at = state.suggestions.findIndex((s) => s.id === suggestion.id);
    if (at >= 0) {
      const prevStatus = state.suggestions[at].status;
      state.suggestions[at] = { ...suggestion, status: prevStatus === "accepted" ? "accepted" : "open" };
    } else state.suggestions.push(suggestion);
  }
  state.notes.push(...freshNotes);
  if (state.notes.length > 40) state.notes.splice(0, state.notes.length - 40);
  if (state.suggestions.length > 40) state.suggestions.splice(0, state.suggestions.length - 40);
  state.checkedAt = now;
  h.putDoc(DOC, state);
  for (const note of freshNotes) {
    try { h.emit("model.version", { model: note.model || note.title, title: note.title, note: note.body }); } catch { /* the news list is optional */ }
  }
  return present(state, { skipped: false, watched: rows.length, now });
}

export function acceptSuggestion(h, id) {
  const state = load(h);
  const s = state.suggestions.find((x) => x.id === id);
  if (!s) throw bad(404, "That suggestion is not here.", "missing");
  if (!state.accepted.some((a) => a.id === s.id)) {
    state.accepted.push({
      id: s.id,
      provider: s.provider,
      hide: s.fromId,
      model: { id: s.toId, name: s.toName, in: s.toIn, out: s.toOut },
      at: Date.now(),
    });
  }
  s.status = "accepted";
  h.putDoc(DOC, state);
  return present(state);
}

export function undoSuggestion(h, id) {
  const state = load(h);
  const s = state.suggestions.find((x) => x.id === id);
  if (!s) throw bad(404, "That suggestion is not here.", "missing");
  const before = state.accepted.length;
  state.accepted = state.accepted.filter((a) => a.id !== id);
  if (before === state.accepted.length && s.status !== "accepted") throw bad(400, "Nothing to undo.", "undo");
  s.status = "open";
  h.putDoc(DOC, state);
  return present(state);
}

export function readState(h) {
  return present(load(h));
}

let timer = null;
export function startLoop(run) {
  if (timer || process.env.CC_MODEL_WATCH === "off") return;
  const tick = () => { Promise.resolve().then(run).catch(() => {}); };
  setTimeout(tick, 5000).unref?.();
  timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
}
