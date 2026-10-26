// Momentum Mode (flag_momentum, 0.4.19): suggests the next step, saves a small checkpoint, offers
// Resume. It never acts on its own: every route only reads or stores a small note, and the page waits
// for a click. No AI call, no timer. Off, every route says so. Owner tuning needs the owner tier.
import { flagOn } from "../flags.js";
import {
  suggest, cleanWeights, checkpoint, shouldResume, CATALOG, WEIGHT_KEYS, DEFAULT_WEIGHTS, DEFAULT_IDLE_MS,
} from "../../web/momentum.js";

export const id = "momentum";
const KIND = "momentum.state";
const MAX_SESSIONS = 40;
const CATALOG_IDS = new Set(CATALOG.map((a) => a.id));

function load(h) {
  const d = h.doc(KIND, () => ({ sessions: {}, tuning: {}, history: {} }));
  if (!d.sessions || typeof d.sessions !== "object") d.sessions = {};
  if (!d.tuning || typeof d.tuning !== "object") d.tuning = {};
  if (!d.history || typeof d.history !== "object") d.history = {};
  return d;
}
const keyOf = (v) => String(v || "main").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64) || "main";
const isOwner = (h) => { try { return h.licenseState().tier === "owner"; } catch { return false; } };
const lowPower = (h) => { try { return !!h.settings().lightMode; } catch { return false; } };

export function tuningOf(d) {
  const t = d.tuning || {};
  return {
    weights: cleanWeights(t.weights),
    idleMs: Math.min(24 * 3600 * 1000, Math.max(5000, Number(t.idleMs) || DEFAULT_IDLE_MS)),
    disabled: Array.isArray(t.disabled) ? t.disabled.filter((x) => CATALOG_IDS.has(x)) : [],
  };
}
function trim(d) {
  const keys = Object.keys(d.sessions);
  if (keys.length <= MAX_SESSIONS) return;
  keys.sort((a, b) => (d.sessions[a].updatedAt || 0) - (d.sessions[b].updatedAt || 0));
  for (const k of keys.slice(0, keys.length - MAX_SESSIONS)) delete d.sessions[k];
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/momentum/, "") || "/";
  if (!flagOn("momentum")) return h.json(res, 404, { error: "Momentum is turned off on this install.", code: "flag_off" });
  const d = load(h);
  const tune = tuningOf(d);
  const now = Date.now();

  if (req.method === "GET" && (p === "/" || p === "/state")) {
    const key = keyOf(url.searchParams.get("project"));
    const s = d.sessions[key];
    return h.json(res, 200, {
      enabled: true, lowPower: lowPower(h), owner: isOwner(h), exited: !!s?.exited,
      resume: shouldResume(s, now, tune.idleMs) ? { checkpoint: s.checkpoint, savedAt: s.checkpoint.savedAt } : null,
      history: d.history[key] || {},
      weights: tune.weights, disabled: tune.disabled,
    });
  }

  if (req.method === "GET" && p === "/owner/view") {
    if (!isOwner(h)) return h.json(res, 403, { error: "Momentum tuning is for the owner account.", code: "owner_only" });
    return h.json(res, 200, { ...tuningOf(d), defaults: DEFAULT_WEIGHTS, keys: WEIGHT_KEYS, catalog: CATALOG.map((a) => ({ id: a.id, label: a.label })) });
  }
  if (req.method !== "POST") return false;

  if (p === "/suggest") {
    const key = keyOf(body?.project);
    const ctx = { ...(body?.context || {}), history: d.history[key] || {}, now };
    const out = suggest(ctx, { weights: tune.weights, disabled: tune.disabled, lowPower: lowPower(h) });
    return h.json(res, 200, out);
  }

  if (p === "/checkpoint") {
    const key = keyOf(body?.project);
    const cp = checkpoint({ ...(body?.checkpoint || {}), savedAt: now });
    if (!cp.draft && !cp.runId) return h.json(res, 200, { ok: true, saved: false });
    d.sessions[key] = { checkpoint: cp, exited: false, updatedAt: now };
    trim(d);
    h.putDoc(KIND, d);
    return h.json(res, 200, { ok: true, saved: true, savedAt: now });
  }

  if (p === "/pick") {
    const key = keyOf(body?.project);
    const aid = String(body?.actionId || "");
    if (!CATALOG_IDS.has(aid)) return h.json(res, 400, { error: "That action is not known.", code: "action" });
    const hist = d.history[key] || (d.history[key] = {});
    hist[aid] = Math.min(99, (Number(hist[aid]) || 0) + 1);
    h.putDoc(KIND, d);
    return h.json(res, 200, { ok: true, history: hist });
  }

  if (p === "/exit" || p === "/resume") {
    const key = keyOf(body?.project);
    const s = d.sessions[key];
    if (!s) return h.json(res, 200, { ok: true, checkpoint: null });
    if (p === "/exit") { s.exited = !!(body?.exit ?? true); s.updatedAt = now; h.putDoc(KIND, d); return h.json(res, 200, { ok: true, exited: s.exited }); }
    // Resume hands the saved note back and clears it, so the offer does not repeat.
    const cp = s.checkpoint;
    delete d.sessions[key];
    h.putDoc(KIND, d);
    return h.json(res, 200, { ok: true, checkpoint: body?.accept === false ? null : cp });
  }

  if (p.startsWith("/owner")) {
    if (!isOwner(h)) return h.json(res, 403, { error: "Momentum tuning is for the owner account.", code: "owner_only" });
    if (p === "/owner/tune") {
      if (body?.confirm !== true) return h.json(res, 409, { error: "Confirm the change first.", code: "confirm" });
      const next = { ...d.tuning };
      if (body.weights !== undefined) {
        if (body.weights === null) delete next.weights;
        else next.weights = cleanWeights({ ...tune.weights, ...body.weights });
      }
      if (body.idleMs !== undefined) next.idleMs = Math.min(24 * 3600 * 1000, Math.max(5000, Number(body.idleMs) || DEFAULT_IDLE_MS));
      if (Array.isArray(body.disabled)) next.disabled = body.disabled.filter((x) => CATALOG_IDS.has(x));
      d.tuning = { ...next, previous: { weights: d.tuning.weights, idleMs: d.tuning.idleMs, disabled: d.tuning.disabled } };
      h.putDoc(KIND, d);
      return h.json(res, 200, { ok: true, ...tuningOf(d) });
    }
    if (p === "/owner/undo") {
      if (body?.confirm !== true) return h.json(res, 409, { error: "Confirm the change first.", code: "confirm" });
      const prev = d.tuning.previous || {};
      d.tuning = { ...prev };
      h.putDoc(KIND, d);
      return h.json(res, 200, { ok: true, ...tuningOf(d) });
    }
  }
  return false;
}
