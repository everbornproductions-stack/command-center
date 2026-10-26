// Decision 23. Optional advanced setting: bring your own Supabase project.
// Off by default. Never part of normal onboarding. The licence server connection is a different setting.
// The service key is stored in the vault and is never returned to the browser.
import { doc, putDoc } from "./store.js";
import { getSecret, setSecret } from "./vault.js";
import { gate } from "./feature-gate.js";

const DOC = "ownsupabase";
const SERVICE = "own-supabase-service";

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

function load() {
  const d = doc(DOC, () => ({ on: false, url: "", publishable: "" }));
  return { on: !!d.on, url: String(d.url || ""), publishable: String(d.publishable || "") };
}

function mask(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 8) return "saved";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function serviceKeySaved() {
  try { return !!getSecret(SERVICE)?.key; } catch { return false; }
}

export function ownSupabaseView() {
  const d = load();
  const ready = !!(d.on && d.url && d.publishable);
  return {
    on: d.on,
    url: d.url,
    publishableSet: !!d.publishable,
    publishableMask: mask(d.publishable),
    serviceKeySet: serviceKeySaved(),
    using: ready ? "yours" : "everborn",
    note: "Off by default. The normal app uses Everborn's Supabase. Customers do not need their own project. This is separate from the license server connection and is not part of setup. Nothing is charged.",
  };
}

export function serverConfig() {
  const d = load();
  if (!d.on || !d.url || !d.publishable) return null;
  let serviceKey = "";
  try { serviceKey = getSecret(SERVICE)?.key || ""; } catch { serviceKey = ""; }
  return { url: d.url.replace(/\/$/, ""), publishable: d.publishable, serviceKey };
}

function validUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol === "https:" || (u.protocol === "http:" && loopback)) {
    if (u.username || u.password) return null;
    return u.origin;
  }
  return null;
}

function validPublishable(value) {
  const s = String(value || "").trim();
  if (!s || s.length > 400 || /\s/.test(s)) return null;
  if (/service_role/i.test(s) || s.startsWith("sb_secret_")) return null;
  return s;
}

function validService(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length > 400 || /\s/.test(s)) return null;
  return s;
}

export async function saveOwnSupabase(body = {}) {
  gate("ownSupabase");
  const current = load();
  const on = body.on === undefined ? current.on : !!body.on;
  let url = body.url === undefined ? current.url : String(body.url || "").trim();
  let publishable = current.publishable;
  if (body.publishable !== undefined && String(body.publishable).trim()) {
    publishable = validPublishable(body.publishable);
    if (!publishable) throw err(400, "The publishable key is not valid. A service key does not go in that field.", "publishable");
  }
  if (on || url || publishable) {
    const parsed = url ? validUrl(url) : null;
    if (on && !parsed) throw err(400, "The project URL must be https, or http on this computer for a test.", "url");
    if (parsed) url = parsed;
    if (on && !publishable) throw err(400, "The publishable key is required when this is on.", "publishable");
  }
  if (body.serviceKey !== undefined) {
    const next = validService(body.serviceKey);
    if (next === null) throw err(400, "That service key is not valid.", "service");
    try {
      await setSecret(SERVICE, next ? { key: next } : null);
    } catch (e) {
      throw err(e.status || 400, "The service key could not be saved in the vault. It was not stored anywhere else.", e.code || "vault");
    }
  }
  putDoc(DOC, { on: !!on, url: url || "", publishable: publishable || "" });
  return ownSupabaseView();
}

export async function checkOwnSupabase(fetchImpl = globalThis.fetch) {
  gate("ownSupabase");
  const cfg = serverConfig();
  if (!cfg) throw err(400, "Turn on Use your own Supabase and save the project URL and publishable key first.", "off");
  const headers = { apikey: cfg.publishable, accept: "application/json" };
  if (cfg.serviceKey) headers.authorization = `Bearer ${cfg.serviceKey}`;
  let r;
  try {
    r = await fetchImpl(`${cfg.url}/auth/v1/health`, { headers, signal: AbortSignal.timeout(8000), redirect: "error" });
  } catch {
    throw err(502, "Could not reach that Supabase project.", "network");
  }
  return { ok: r.ok, status: r.status, using: "yours", serviceKeyUsed: !!cfg.serviceKey };
}
