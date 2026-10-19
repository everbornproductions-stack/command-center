// Optional encrypted chat sync (Phase 23), desktop side. Off by default. Chats (single-AI chats and imported
// chats) go to the person's Supabase project through four functions (supabase/sync.sql) as sealed blobs: the
// key comes from their passphrase (web/sync-crypto.js) and never leaves the device, the server keeps
// ciphertext, an opaque item id and a sequence number only. The phone (hosted hub in a browser) runs the same
// crypto in the browser, so neither the hub nor Supabase sees the text.
//   space   = the sync code shown on the first device and typed on the second
//   token   = HMAC of the key; the functions keep its SHA-256 and refuse a push or pull without it
// The derived key is kept in the vault (Windows DPAPI / Keychain), never the passphrase. Forget removes it.
import crypto from "node:crypto";
import * as K from "../web/sync-crypto.js";
import { ctx, doc, putDoc } from "./store.js";
import { cloud } from "./license.js";
import { setSecret, getSecret } from "./vault.js";

export const SECRET_ID = "history-sync";
export const KINDS = new Set(["single", "imported"]);
export const MAX_ITEM_BYTES = 1024 * 1024;
const err = (status, msg, code) => Object.assign(new Error(msg), { status, code });

const st = () => doc("history.sync", () => ({ enabled: false, space: null, salt: null, kdf: null, deviceId: crypto.randomBytes(6).toString("hex"), cursor: 0, pushed: {}, lastSyncAt: null, lastError: null, last: null }));
const save = (patch) => putDoc("history.sync", { ...st(), ...patch });

// ---------- transport: Supabase RPC (PostgREST /rest/v1/rpc/<fn>) with the publishable key ----------
let transportOverride = null;
export const setTransport = (t) => { transportOverride = t; };
export function supabaseTransport(cfg = cloud()) {
  if (!cfg.url || !cfg.anonKey) throw err(400, "Sync needs your Supabase project. Fill in Settings > Cloud (project address and publishable key) first.", "no_cloud");
  const host = new URL(cfg.url).host;
  return async (fn, args) => {
    let r;
    try { r = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: cfg.anonKey, authorization: `Bearer ${cfg.anonKey}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw err(502, `Could not reach ${host}: ${e.name === "TimeoutError" ? "timed out" : e.cause?.code || e.message}`, "unreachable"); }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = j?.message || j?.error || `HTTP ${r.status}`;
      if (/bad sync token/i.test(msg)) throw err(401, "The sync service did not accept this device's key. Set sync up again with the same sync code and passphrase.", "bad_token");
      if (/no sync space/i.test(msg)) throw err(404, "No sync space with that code. Check the code, or start a new sync on this device.", "no_space");
      if (/space exists/i.test(msg)) throw err(409, "That sync code is already in use.", "space_exists");
      if (r.status === 404) throw err(502, `${host} has no sync functions yet. Run supabase/sync.sql on that project first.`, "no_functions");
      throw err(502, `${host} refused the sync (${msg}).`, "sync_failed");
    }
    return j;
  };
}
const rpc = () => transportOverride || supabaseTransport();

// ---------- keys ----------
async function keys() {
  const c = ctx();
  const raw = c.syncRaw || getSecret(SECRET_ID)?.key;
  if (!raw) throw err(400, "Sync is not set up on this device. Enter your sync code and passphrase.", "no_key");
  return K.keysFromRaw(raw);
}
async function keepRaw(raw, remember) {
  const c = ctx();
  c.syncRaw = raw;
  if (!remember) return "memory";
  try { await setSecret(SECRET_ID, { key: raw }); return "vault"; }
  catch (e) { if (e.code === "vault_unavailable") return "memory"; throw e; }
}

export function status() {
  const s = st();
  const c = ctx();
  return {
    enabled: !!s.enabled, code: s.enabled ? s.space : null, lastSyncAt: s.lastSyncAt, lastError: s.lastError, last: s.last,
    keyOnDevice: !!(c.syncRaw || getSecret(SECRET_ID)?.key), pushedCount: Object.keys(s.pushed || {}).length,
    cloud: (() => { const x = cloud(); return { configured: !!(x.url && x.anonKey), host: x.url ? new URL(x.url).host : null }; })(),
  };
}

// Start a new space on this device (a fresh sync code), or join one with a code from another device.
export async function setup({ passphrase, code, remember = true, kdf } = {}) {
  K.checkPassphrase(passphrase);
  const call = rpc();
  let space, salt, useKdf, raw;
  if (code) {
    if (!K.validCode(code)) throw err(400, "That sync code does not look right. It is four groups of five letters and digits.", "bad_code");
    space = K.normCode(code);
    const meta = await call("cc_sync_meta", { p_space: space });
    if (!meta?.salt) throw err(404, "No sync space with that code. Check the code, or start a new sync on this device.", "no_space");
    salt = meta.salt; useKdf = meta.kdf || K.KDF_DEFAULT;
    raw = await K.deriveRaw(passphrase, salt, useKdf);
    if (!(await K.verifyCheck(await K.keysFromRaw(raw), meta.check))) throw err(401, "Wrong passphrase for this sync code.", "wrong_passphrase");
  } else {
    space = K.newSyncCode(); salt = K.randomB64(16); useKdf = { ...K.KDF_DEFAULT, ...(kdf || {}) };
    raw = await K.deriveRaw(passphrase, salt, useKdf);
    const k = await K.keysFromRaw(raw);
    await call("cc_sync_create", { p_space: space, p_token: k.token, p_salt: salt, p_kdf: useKdf, p_check: await K.makeCheck(k) });
  }
  const kept = await keepRaw(raw, remember);
  save({ enabled: true, space, salt, kdf: useKdf, cursor: 0, pushed: {}, lastError: null });
  return { ...status(), code: space, keptIn: kept };
}

// Turn sync off on this device. The key is forgotten too; deleteRemote also empties the space in the cloud.
export async function turnOff({ deleteRemote = false } = {}) {
  const s = st();
  if (deleteRemote && s.space) { const k = await keys(); await rpc()("cc_sync_delete_space", { p_space: s.space, p_token: k.token }); }
  const c = ctx(); delete c.syncRaw;
  if (getSecret(SECRET_ID)) { try { await setSecret(SECRET_ID, null); } catch {} }
  save({ enabled: false, space: null, salt: null, kdf: null, cursor: 0, pushed: {}, lastError: null });
  return status();
}

// what goes into a blob for one chat
export function payloadOf(m, deviceId) {
  const messages = Array.isArray(m.messages) && m.messages.length ? m.messages
    : [{ role: "user", text: String(m.prompt || ""), at: m.startedAt || null }, { role: "assistant", text: String(m.deliverable || ""), at: m.finishedAt || null, ...(m.model ? { model: m.model } : {}) }].filter((x) => x.text);
  return { v: 1, chatId: m.id, kind: m.kind, source: m.source || (m.kind === "single" ? "command-ai" : "sync"), provider: m.provider || null, model: m.model || null, title: m.title || String(m.prompt || "").slice(0, 90) || "Untitled chat", startedAt: m.startedAt || null, finishedAt: m.finishedAt || null, updatedAt: m.updatedAt || m.finishedAt || m.startedAt || 0, messages, origin: deviceId };
}
const updatedOf = (s) => s.updatedAt || s.finishedAt || s.startedAt || 0;
const safeId = (id) => String(id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);

// One round: push chats changed since the last push, then pull everything new from other devices.
export async function syncNow({ listSummaries, getMission } = {}) {
  const s = st();
  if (!s.enabled || !s.space) throw err(400, "Sync is off. Turn it on in the History tab first.", "off");
  const k = await keys();
  const call = rpc();
  const store = ctx().store;
  const pushed = { ...(s.pushed || {}) };
  const res = { pushed: 0, pulled: 0, skipped: 0, tooBig: 0 };
  try {
    // push
    const summaries = (listSummaries ? listSummaries() : store.listMissions((m) => m)).filter((m) => m && KINDS.has(m.kind) && ["done", "failed"].includes(m.status) && !m.synced);
    const batch = [];
    for (const sm of summaries) {
      const u = updatedOf(sm);
      if (pushed[sm.id] && pushed[sm.id] >= u) continue;
      const m = getMission ? await getMission(sm.id) : await store.getMission(sm.id);
      if (!m || m.synced) continue;
      const item = await K.itemId(k, m.id);
      const blob = await K.seal(k, payloadOf(m, s.deviceId), item);
      if (blob.length > MAX_ITEM_BYTES) { res.tooBig++; continue; }
      batch.push({ item, blob, updated_at: new Date(updatedOf(m) || Date.now()).toISOString(), _id: m.id, _u: updatedOf(m) || u });
      if (batch.length >= 50) { await flush(); }
    }
    async function flush() {
      if (!batch.length) return;
      await call("cc_sync_push", { p_space: s.space, p_token: k.token, p_items: batch.map(({ item, blob, updated_at }) => ({ item, blob, updated_at })) });
      for (const b of batch) { pushed[b._id] = b._u; res.pushed++; }
      batch.length = 0;
    }
    await flush();
    // pull
    let cursor = Number(s.cursor) || 0;
    for (let round = 0; round < 1000; round++) {
      const rows = (await call("cc_sync_pull", { p_space: s.space, p_token: k.token, p_since: cursor, p_limit: 200 })) || [];
      for (const r of rows) {
        cursor = Math.max(cursor, Number(r.seq) || 0);
        let p;
        try { p = await K.open(k, r.blob, r.item); } catch { res.skipped++; continue; }
        if (!p?.chatId || p.origin === s.deviceId) continue;
        const id = safeId(p.chatId);
        const mine = await store.getMission(id);
        if (mine && !mine.synced) continue; // a chat made here keeps winning
        if (mine && updatedOf(mine) >= (p.updatedAt || 0)) continue;
        const m = { id, kind: "imported", source: p.source || "sync", provider: p.provider || "Synced chat", model: p.model || null, title: String(p.title || "Untitled chat").slice(0, 200), prompt: p.messages?.find((x) => x.role === "user")?.text?.slice(0, 2000) || p.title, projectId: null, status: "done", startedAt: p.startedAt || Date.now(), finishedAt: p.finishedAt || p.startedAt || Date.now(), updatedAt: p.updatedAt || 0, cost: 0, messages: Array.isArray(p.messages) ? p.messages : [], tasks: [], synced: { at: Date.now(), from: p.origin || null } };
        m.deliverable = m.messages.map((x) => `**${x.role === "user" ? "You" : x.model || "AI"}**\n\n${x.text}`).join("\n\n---\n\n");
        store.saveMission(m, { id, kind: m.kind, title: m.title, projectId: null, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, cost: 0, tasks: 0, providers: [m.provider], source: m.source, synced: true });
        pushed[id] = m.updatedAt || 1; // never echo it back
        res.pulled++;
      }
      if (rows.length < 200) break;
    }
    save({ pushed, cursor, lastSyncAt: Date.now(), lastError: null, last: res });
    return { ...status(), result: res };
  } catch (e) {
    save({ pushed, lastError: e.message });
    throw e;
  }
}
