// Hosted mode: Supabase-backed store, token verification and the encrypted-at-rest key vault.
// Configuration comes from the environment only (nothing in data/ is read in hosted mode):
//   CC_MODE=hosted
//   CC_SUPABASE_URL          https://xxxx.supabase.co
//   CC_SUPABASE_ANON_KEY     publishable key (safe to ship to the browser)
//   CC_MASTER_KEY            base64 of 32 random bytes; encrypts every API key at rest (AES-256-GCM)
//   CC_SUPABASE_SERVICE_KEY  optional: lets the server keep writing after a user's token expires
//   CC_OWNER_EMAILS          optional: comma-separated emails that get the owner tier
//   CC_HUB_URL               optional: the public address of this hub (shown in the pairing QR)
import crypto from "node:crypto";
import { emit } from "./events.js";

export const CFG = {
  url: (process.env.CC_SUPABASE_URL || "").replace(/\/$/, ""),
  anonKey: process.env.CC_SUPABASE_ANON_KEY || "",
  serviceKey: process.env.CC_SUPABASE_SERVICE_KEY || null,
  masterKey: process.env.CC_MASTER_KEY || "",
  hubUrl: (process.env.CC_HUB_URL || "").replace(/\/$/, "") || null,
  ownerEmails: (process.env.CC_OWNER_EMAILS || "").toLowerCase().split(/[,\s]+/).filter(Boolean),
};

const ENV_NAMES = { url: "CC_SUPABASE_URL", anonKey: "CC_SUPABASE_ANON_KEY", masterKey: "CC_MASTER_KEY" };
export function assertHostedConfig() {
  const missing = Object.keys(ENV_NAMES).filter((k) => !CFG[k]);
  if (missing.length) throw new Error(`Hosted mode needs ${missing.map((k) => ENV_NAMES[k]).join(", ")}`);
  if (masterKeyBytes().length !== 32) throw new Error("CC_MASTER_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)");
}
function masterKeyBytes() { return Buffer.from(CFG.masterKey, "base64"); }

// ---------- AES-256-GCM ----------
// Layout: base64( iv[12] | tag[16] | ciphertext ). AAD binds the blob to one user and provider,
// so a row copied to another account does not decrypt.
export function encrypt(plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterKeyBytes(), iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(b64, aad) {
  const buf = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", masterKeyBytes(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

// ---------- PostgREST / Auth helpers ----------
function authHeaders(token) {
  const h = { apikey: CFG.anonKey, "content-type": "application/json" };
  const bearerToken = CFG.serviceKey || token;
  if (bearerToken) h.authorization = `Bearer ${bearerToken}`;
  return h;
}
export async function rest(pathq, { method = "GET", body, token, prefer } = {}) {
  const headers = authHeaders(token);
  if (prefer) headers.prefer = prefer;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`${CFG.url}/rest/v1/${pathq}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) throw Object.assign(new Error(j?.message || j?.error || `HTTP ${r.status}`), { status: r.status, hint: j?.hint, details: j?.details });
    return j;
  } finally { clearTimeout(t); }
}

// Verify a Supabase access token by asking Auth who it belongs to. Cached for 5 minutes per token.
const tokenCache = new Map(); // sha256(token) -> { user, until }
export async function verifyToken(token) {
  if (!token || token.length < 20) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const h = crypto.createHash("sha256").update(token).digest("hex");
  const hit = tokenCache.get(h);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${CFG.url}/auth/v1/user`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) throw Object.assign(new Error(j?.msg || j?.message || "Session expired. Sign in again."), { status: 401 });
  // never cache past the token's own expiry
  let exp = 0, claims = {}; try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) || {}; exp = claims.exp * 1000; } catch {}
  // Team SSO (Phase 24): how this session signed in (Supabase's amr claim: "oauth" for Google / Microsoft,
  // "otp" or "magiclink" for the emailed link) and which sign-in identities the account has, with their addresses.
  // The token was just accepted by Supabase Auth, so its claims are the ones Auth issued.
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  const latest = amr.reduce((a, x) => (!a || Number(x?.timestamp || 0) > Number(a?.timestamp || 0) ? x : a), null);
  const method = latest?.method ? String(latest.method) : null;
  const identities = (Array.isArray(j.identities) ? j.identities : []).map((i) => ({ provider: String(i?.provider || "").toLowerCase(), email: String(i?.identity_data?.email || i?.email || "").toLowerCase() })).filter((i) => i.provider);
  const user = { id: j.id, email: (j.email || "").toLowerCase(), auth: { method, identities } };
  tokenCache.set(h, { user, until: Math.min(Date.now() + 5 * 60 * 1000, exp || Infinity) });
  if (tokenCache.size > 5000) tokenCache.delete(tokenCache.keys().next().value);
  return user;
}

// ---------- the per-user store ----------
const LEDGER_WINDOW_DAYS = 35;
export class SupabaseStore {
  constructor(c) { this.c = c; this.pending = new Map(); this.writes = 0; }
  get uid() { return this.c.userId; }
  q(pathq, opts) { return rest(pathq, { ...opts, token: this.c.token }); }
  ok(what) { console.log(`[store] ${this.c.email || this.uid}: ${what} saved`); }
  fail(what, e) {
    console.error(`[store] ${what} failed for ${this.c.email || this.uid}: ${e.message}`);
    try { emit("log", { text: `Cloud save failed (${what}): ${e.message}`, level: "error" }); } catch {}
  }
  // A write that has been handed to the network, or is still waiting out the coalesce timer.
  hasPending() { return this.pending.size > 0 || this.writes > 0; }
  track(p) {
    this.writes++;
    const done = () => { this.writes = Math.max(0, this.writes - 1); };
    return Promise.resolve(p).then((v) => { done(); return v; }, (e) => { done(); throw e; });
  }
  // Coalesce by key. `run` is called once, with the latest value, when the timer fires or flush() runs.
  queue(key, run, delay = 250) {
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      if (this.pending.get(key)?.timer !== timer) return;
      this.pending.delete(key);
      this.track(run()).catch(() => {});
    }, delay);
    timer.unref?.();
    this.pending.set(key, { timer, run });
  }
  // Send every coalesced write now and wait until those requests, and any already in flight, finish.
  async flush() {
    const jobs = [];
    for (const [key, job] of this.pending) {
      clearTimeout(job.timer);
      this.pending.delete(key);
      jobs.push(this.track(job.run()).catch(() => {}));
    }
    await Promise.all(jobs);
    const start = Date.now();
    while (this.writes > 0 && Date.now() - start < 20000) await new Promise((r) => setTimeout(r, 15));
    if (this.writes > 0) throw new Error("timed out waiting for cloud writes");
  }

  async loadAll(c) {
    const since = new Date(Date.now() - LEDGER_WINDOW_DAYS * 86400000).toISOString();
    const [docs, ledger, missions, secrets] = await Promise.all([
      this.q(`user_docs?select=kind,data&user_id=eq.${this.uid}`),
      this.q(`user_ledger?select=entry&user_id=eq.${this.uid}&ts=gte.${since}&order=ts.asc&limit=5000`),
      this.q(`user_missions?select=id,summary&user_id=eq.${this.uid}&order=started_at.desc&limit=200`),
      this.q(`user_secrets?select=provider,ciphertext&user_id=eq.${this.uid}`),
    ]);
    for (const d of docs || []) c.docs[d.kind] = d.data;
    c.ledger = (ledger || []).map((r) => r.entry);
    c.missions = new Map((missions || []).map((m) => [m.id, m.summary]));
    c.secrets = {};
    for (const s of secrets || []) {
      try { c.secrets[s.provider] = JSON.parse(decrypt(s.ciphertext, `${this.uid}:${s.provider}`)); }
      catch (e) { console.error(`[vault] could not decrypt ${s.provider} for ${this.uid}: ${e.message} (master key changed?)`); }
    }
  }

  // write-behind, coalesced per document kind
  putDoc(kind, value) {
    this.queue(kind, () => this.q("user_docs", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: this.uid, kind, data: value, updated_at: new Date().toISOString() } }).then(() => this.ok(kind)).catch((e) => this.fail(kind, e)));
  }
  appendLedger(e) {
    this.track(this.q("user_ledger", { method: "POST", prefer: "return=minimal", body: { user_id: this.uid, ts: new Date(e.ts || Date.now()).toISOString(), entry: e } }).then(() => this.ok("ledger entry")).catch((err) => this.fail("ledger", err))).catch(() => {});
  }
  saveMission(m, summary) {
    if (summary) this.c.missions?.set(m.id, summary);
    const key = "mission:" + m.id;
    this.queue(key, () => this.q("user_missions", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: this.uid, id: m.id, kind: m.kind, status: m.status, started_at: new Date(m.startedAt || Date.now()).toISOString(), summary: summary || this.c.missions?.get(m.id) || null, data: m, updated_at: new Date().toISOString() } }).then(() => this.ok(`mission ${m.id} (${m.status})`)).catch((e) => this.fail("mission", e)), 400);
  }
  listMissions() { return [...(this.c.missions?.values() || [])].filter(Boolean); }
  async getMission(id) {
    const r = await this.q(`user_missions?select=data&user_id=eq.${this.uid}&id=eq.${encodeURIComponent(id)}&limit=1`);
    return r?.[0]?.data || null;
  }
  putSecret(provider, value) {
    const p = encodeURIComponent(provider);
    const op = value
      ? this.q("user_secrets", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: this.uid, provider, ciphertext: encrypt(JSON.stringify(value), `${this.uid}:${provider}`), key_version: 1, updated_at: new Date().toISOString() } })
      : this.q(`user_secrets?user_id=eq.${this.uid}&provider=eq.${p}`, { method: "DELETE", prefer: "return=minimal" });
    return this.track(op.then(() => this.ok(`secret ${provider} ${value ? "stored (encrypted)" : "removed"}`)).catch((e) => this.fail("vault", e)));
  }
}
