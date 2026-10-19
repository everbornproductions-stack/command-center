// Spend caps and alerts: per-AI monthly caps (amber at 80%, hard stop at 100%), renewal warnings,
// red-light alerts. Delivered in-app (log events), by email (Resend, if a key is saved) and by
// Web Push (VAPID, implemented with Node crypto; no extra dependency).
import crypto from "node:crypto";
import { PROVIDERS } from "../registry.js";
export const id = "alerts";

const CAPS = "alerts.caps";      // { [providerId]: usd }
const STATE = "alerts.state";    // { month, perProvider: { id: { spend, cap, pct, level } }, stop: [ids], fired: { key: ts } }
const SUBS = "alerts.push";      // { subs: [subscription] }
const VAPID = "alerts.vapid";    // { publicKey, privateKey } (base64url)
const PREFS = "alerts.prefs";    // { email, emailOn, pushOn }

let H = null;
export async function init(h) { H = h; }

function monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

function recompute(h) {
  const caps = h.doc(CAPS, () => ({}));
  const st = h.doc(STATE, () => ({ month: monthKey(), perProvider: {}, stop: [], fired: {} }));
  if (st.month !== monthKey()) { st.month = monthKey(); st.perProvider = {}; st.stop = []; st.fired = {}; }
  const led = h.ledgerSummary();
  const stop = [];
  const changes = [];
  const previous = st.perProvider || {};
  st.perProvider = {}; // rebuilt from the current caps so removed caps disappear
  for (const [pid, cap] of Object.entries(caps)) {
    if (!cap || cap <= 0) continue;
    const spend = led.byProvider?.[pid]?.month || 0;
    const pct = Math.round((spend / cap) * 100);
    const level = pct >= 100 ? "stop" : pct >= 80 ? "amber" : "ok";
    const prev = previous[pid]?.level || "ok";
    st.perProvider[pid] = { spend: +spend.toFixed(4), cap, pct, level };
    if (level === "stop") stop.push(pid);
    if (level !== prev && level !== "ok") changes.push({ pid, level, pct, spend, cap });
  }
  st.stop = stop;
  h.putDoc(STATE, st);
  return { st, changes };
}

async function notify(h, key, title, body, level = "amber") {
  const st = h.doc(STATE, () => ({ month: monthKey(), perProvider: {}, stop: [], fired: {} }));
  if (st.fired[key] && Date.now() - st.fired[key] < 12 * 3600 * 1000) return; // once per 12 h per alert
  st.fired[key] = Date.now(); h.putDoc(STATE, st);
  h.emit("log", { text: `${level === "stop" ? "⛔" : "⚠"} ${title}: ${body}`, level: level === "stop" ? "error" : undefined });
  const prefs = h.doc(PREFS, () => ({ email: "", emailOn: false, pushOn: true }));
  if (prefs.emailOn && prefs.email) await sendEmail(h, prefs.email, title, body).catch((e) => h.emit("log", { text: `Alert email failed: ${e.message}`, level: "error" }));
  if (prefs.pushOn) await pushAll(h, { title, body, level }).catch(() => {});
}

async function sendEmail(h, to, subject, text) {
  const k = h.getSecret("resend")?.key;
  if (!k) return;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Command AI <alerts@everbornproductions.com>", to, subject: `[Everborn Command] ${subject}`, text }) });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

// ---------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ----------
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function vapidKeys(h) {
  let v = h.doc(VAPID, () => null);
  if (!v) {
    const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
    v = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
    h.putDoc(VAPID, v);
  }
  return v;
}

function vapidJwt(h, audience) {
  const v = vapidKeys(h);
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:hello@everbornproductions.com" }));
  const key = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: v.privateKey, x: b64u(fromB64u(v.publicKey).subarray(1, 33)), y: b64u(fromB64u(v.publicKey).subarray(33, 65)) }, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64u(sig)}`;
}

function hkdf(salt, ikm, info, len) { return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len)); }

function encryptPayload(sub, plaintext) {
  const clientPub = fromB64u(sub.keys.p256dh), auth = fromB64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPub);
  const salt = crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), clientPub, serverPub]);
  const ikm = hkdf(auth, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  const header = Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub]);
  return Buffer.concat([header, ct]);
}

async function pushOne(h, sub, payload) {
  const url = new URL(sub.endpoint);
  const body = encryptPayload(sub, JSON.stringify(payload));
  const jwt = vapidJwt(h, `${url.protocol}//${url.host}`);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { TTL: "86400", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: `vapid t=${jwt}, k=${vapidKeys(h).publicKey}`, Urgency: payload.level === "stop" ? "high" : "normal" }, body });
  return r.status;
}

async function pushAll(h, payload) {
  const d = h.doc(SUBS, () => ({ subs: [] }));
  const keep = [];
  for (const s of d.subs) {
    try { const st = await pushOne(h, s, payload); if (st !== 404 && st !== 410) keep.push(s); } catch { keep.push(s); }
  }
  if (keep.length !== d.subs.length) { d.subs = keep; h.putDoc(SUBS, d); }
}

// ---------- events ----------
export function onEvent(ev, h) {
  if (ev.type === "ledger.entry" && ev.entry?.kind === "call") {
    const { changes } = recompute(h);
    for (const c of changes) {
      const name = PROVIDERS[c.pid]?.name || c.pid;
      if (c.level === "amber") notify(h, `cap80:${c.pid}:${monthKey()}`, `${name} at ${c.pct}% of its $${c.cap} monthly cap`, `$${c.spend.toFixed(2)} spent this month. It keeps working; the router leans away from it.`, "amber");
      if (c.level === "stop") notify(h, `cap100:${c.pid}:${monthKey()}`, `${name} hit its $${c.cap} monthly cap`, `Hard stop: the router will not send it new work until the cap is raised or the month rolls over.`, "stop");
    }
  }
  if (ev.type === "provider.status" && ev.status === "red") {
    const name = PROVIDERS[ev.provider]?.name || ev.provider;
    notify(h, `red:${ev.provider}:${ev.detail}`, `${name} is red`, ev.detail || "key rejected or provider down", "stop");
  }
}

function renewalSweep(h) {
  const soon = h.subscriptionView().filter((s) => s.daysLeft != null && s.daysLeft >= 0 && s.daysLeft <= 3);
  for (const s of soon) notify(h, `renew:${s.id}:${s.renews}`, `${s.name} renews in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`, s.monthly != null ? `$${s.monthly} on ${s.renews}` : `on ${s.renews}`, "amber");
  const low = h.subscriptionView().filter((s) => s.signal === "low");
  for (const s of low) notify(h, `low:${s.id}:${monthKey()}`, `${s.name} credits running low`, s.why || "", "amber");
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/alerts/, "");
  if (req.method === "GET" && p === "/state") { const { st } = recompute(h); return h.json(res, 200, { ...st, caps: h.doc(CAPS, () => ({})), prefs: h.doc(PREFS, () => ({ email: "", emailOn: false, pushOn: true })), vapidPublicKey: vapidKeys(h).publicKey, pushDevices: h.doc(SUBS, () => ({ subs: [] })).subs.length }); }
  if (req.method === "POST" && p === "/caps") { const caps = {}; for (const [k, v] of Object.entries(body.caps || {})) if (PROVIDERS[k] && Number(v) >= 0) caps[k] = Number(v); h.putDoc(CAPS, caps); const { st } = recompute(h); h.emit("log", { text: "Spend caps saved." }); return h.json(res, 200, st); }
  if (req.method === "POST" && p === "/prefs") { const prefs = { ...h.doc(PREFS, () => ({})), ...(body.email !== undefined ? { email: String(body.email).trim() } : {}), ...(body.emailOn !== undefined ? { emailOn: !!body.emailOn } : {}), ...(body.pushOn !== undefined ? { pushOn: !!body.pushOn } : {}) }; h.putDoc(PREFS, prefs); return h.json(res, 200, prefs); }
  if (req.method === "POST" && p === "/subscribe") { if (!body.endpoint || !body.keys?.p256dh) return h.json(res, 400, { error: "bad subscription" }); const d = h.doc(SUBS, () => ({ subs: [] })); if (!d.subs.some((s) => s.endpoint === body.endpoint)) d.subs.push({ endpoint: body.endpoint, keys: body.keys, addedAt: Date.now() }); h.putDoc(SUBS, d); return h.json(res, 200, { devices: d.subs.length }); }
  if (req.method === "POST" && p === "/test") { await notify(h, `test:${Date.now()}`, "Test alert", "If you can read this on your phone, push works.", "amber"); return h.json(res, 200, { ok: true }); }
  if (req.method === "POST" && p === "/sweep") { renewalSweep(h); return h.json(res, 200, { ok: true }); }
  return false;
}

// renewal sweep twice a day
setInterval(() => { try { if (H && !H.HOSTED) renewalSweep(H); } catch {} }, 12 * 3600 * 1000).unref();
