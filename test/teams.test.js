// Phase 24: per-workspace API keys and Team SSO.
// Local (desktop): a workspace key is used only while that workspace is active; Personal and other workspaces
// keep your own key; removed or deleted means your own key again; masked only; Studio only.
// Hosted hub: a local stand-in plays Supabase Auth and PostgREST (with the RLS rules of
// supabase/workspace-keys.sql and supabase/team-sso.sql), a Google-like identity provider for the mocked
// OIDC round trip, and the OpenAI API that records which key each call carried. No real URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { startServer, freePort, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_KEYS = { XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "" };

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\n`);
  res.write("data: [DONE]\n\n"); res.end();
}
// the OpenAI API: remembers the key on every chat call
function openai(u, req, res, body, seen, send) {
  if (u.pathname === "/oai/v1/models") return send(200, { data: [{ id: "gpt-6-luna" }] }), true;
  if (u.pathname === "/oai/v1/chat/completions") { seen.push(String(req.headers.authorization || "")); sse(res, "Fresh rye at nine."); return true; }
  return false;
}

async function chatKey(api, seen) {
  const n = seen.length;
  const r = await api("/chat", { method: "POST", body: { prompt: "One line for the shop window.", provider: "openai", model: "gpt-6-luna" } });
  assert.equal(r.status, 202, r.text);
  for (let i = 0; i < 100 && seen.length === n; i++) await sleep(100);
  return seen.length > n ? seen.at(-1).replace(/^Bearer /, "") : null;
}

test("local: a workspace key is used only for that workspace's calls", { timeout: 120000 }, async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (s, j) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (!openai(new URL(req.url, "http://x"), req, res, body, seen, send)) send(404, {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = await startServer({ env: { ...NO_KEYS, CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_OPENAI: `${base}/oai/v1` } });
  const PERSONAL = "sk-personal-1111111111111111", TEAM = "sk-team-a-2222222222222222";
  const active = (id) => s.api("/workspaces/active", { method: "POST", body: { id } });
  try {
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: PERSONAL } })).json.status.status, "green");
    const A = (await s.api("/workspaces", { method: "POST", body: { name: "Bakery team" } })).json.id;
    const B = (await s.api("/workspaces", { method: "POST", body: { name: "Other client" } })).json.id;

    assert.equal((await s.api(`/wskeys/${A}`, { method: "POST", body: { provider: "openai", key: TEAM }, noToken: true })).status, 401);
    assert.equal((await s.api(`/wskeys/${A}`, { method: "POST", body: { provider: "demo-nova", key: TEAM } })).status, 400);
    assert.equal((await s.api(`/wskeys/${A}`, { method: "POST", body: { provider: "openai", key: "short" } })).status, 400);
    assert.equal((await s.api("/wskeys/w-nope", { method: "POST", body: { provider: "openai", key: TEAM } })).status, 404);
    let r = await s.api(`/wskeys/${A}`, { method: "POST", body: { provider: "openai", key: TEAM } });
    assert.equal(r.status, 200); assert.equal(r.json.masked, "sk-t…2222");
    assert.ok(!r.text.includes(TEAM), "the key never comes back");
    r = (await s.api(`/wskeys?workspace=${A}`)).json;
    assert.equal(r.canManage, true); assert.deepEqual(r.keys.map((k) => [k.provider, k.masked]), [["openai", "sk-t…2222"]]);
    assert.deepEqual(r.using, [], "Personal is active: nothing from the workspace is used");
    if (process.platform === "win32") assert.ok(!fs.readFileSync(path.join(s.dir, "vault.bin"), "utf8").includes("sk-team"), "sealed in the vault");

    assert.equal(await chatKey(s.api, seen), PERSONAL, "Personal: your own key");
    assert.equal((await active(A)).status, 200);
    assert.equal(await chatKey(s.api, seen), TEAM, "workspace A active: A's key");
    const st = (await s.api("/state")).json.providers.find((p) => p.id === "openai");
    assert.equal(st.keyScope, "workspace"); assert.equal(st.masked, "sk-t…2222");
    assert.deepEqual((await s.api("/wskeys")).json.using, ["openai"]);
    // saving your own key while A is active changes your key, not A's
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-personal-9999999999999999" } })).status, 200);
    assert.equal(await chatKey(s.api, seen), TEAM);
    await active(B);
    assert.equal(await chatKey(s.api, seen), "sk-personal-9999999999999999", "another workspace never uses A's key");
    await active(null);
    assert.equal(await chatKey(s.api, seen), "sk-personal-9999999999999999");

    // removed: your own key again
    await active(A);
    assert.equal((await s.api(`/wskeys/${A}/openai`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/wskeys/${A}/openai`, { method: "DELETE" })).status, 404);
    assert.equal(await chatKey(s.api, seen), "sk-personal-9999999999999999");
    // a deleted workspace's key is never used
    await s.api(`/wskeys/${A}`, { method: "POST", body: { provider: "openai", key: TEAM } });
    assert.equal(await chatKey(s.api, seen), TEAM);
    assert.equal((await s.api(`/workspaces/${A}`, { method: "DELETE" })).status, 200);
    assert.equal(await chatKey(s.api, seen), "sk-personal-9999999999999999");
    assert.equal((await s.api(`/wskeys?workspace=${A}`)).status, 404);
  } finally { await s.stop(); await new Promise((r) => srv.close(r)); }
});

test("local: workspace keys need Studio; SSO is a hub feature", { timeout: 60000 }, async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    const r = await s.api("/wskeys/w-abc", { method: "POST", body: { provider: "openai", key: "sk-xxxxxxxxxxxxxxxx" } });
    assert.equal(r.status, 402); assert.equal(r.json.code, "studio");
    assert.deepEqual((await s.api("/wskeys")).json.keys, []);
    assert.equal((await s.api("/sso")).json.hosted, false);
    assert.deepEqual((await s.api("/config")).json.sso, []);
    assert.equal((await s.api("/sso/start?provider=google&redirect=http://127.0.0.1/")).status, 400);
  } finally { await s.stop(); }
});

// ---------- hosted hub ----------
const WS = "11111111-1111-4111-8111-111111111111";
const IDS = { owner: "00000000-0000-4000-8000-000000000001", member: "00000000-0000-4000-8000-000000000002", viewer: "00000000-0000-4000-8000-000000000003", contractor: "00000000-0000-4000-8000-000000000005", outsider: "00000000-0000-4000-8000-000000000004" };
const EMAIL = { owner: "owner@example.com", member: "member@example.com", viewer: "viewer@example.com", contractor: "pat@other.org", outsider: "outsider@example.com" };
const ROLE = { owner: "owner", member: "member", viewer: "viewer", contractor: "member" };
const IDENT = { owner: [["email", EMAIL.owner]], member: [["email", EMAIL.member], ["google", EMAIL.member]], viewer: [["email", EMAIL.viewer]], contractor: [["azure", EMAIL.contractor]], outsider: [["email", EMAIL.outsider]] };
// tokens shaped like Supabase access tokens: the amr claim says how the session signed in
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = (who, method) => `eyJhbGciOiJIUzI1NiJ9.${b64({ sub: IDS[who], exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }], tag: crypto.randomBytes(4).toString("hex") })}.sig`;
const T = { owner: tok("owner", "otp"), member: tok("member", "otp"), memberGoogle: tok("member", "oauth"), viewer: tok("viewer", "otp"), contractor: tok("contractor", "oauth"), outsider: tok("outsider", "otp") };
const whoOf = (t) => Object.keys(IDS).find((k) => { try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub === IDS[k]; } catch { return false; } });

async function fakeHub() {
  const port = await freePort();
  const sb = `http://127.0.0.1:${port}`;
  const secrets = [], sso = [], seen = [], states = new Map();
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const u = new URL(req.url, sb);
    const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    const go = (to) => { res.writeHead(302, { location: to }); res.end(); };
    if (openai(u, req, res, body, seen, send)) return;
    // ---- the OIDC round trip: Supabase authorize -> identity provider -> Supabase callback -> back to the hub with the session ----
    if (u.pathname === "/auth/v1/authorize") {
      const state = crypto.randomBytes(8).toString("hex");
      states.set(state, { provider: u.searchParams.get("provider"), back: u.searchParams.get("redirect_to"), scopes: u.searchParams.get("scopes") });
      return go(`${sb}/idp/authorize?${new URLSearchParams({ client_id: "test-client", response_type: "code", scope: "openid email", redirect_uri: `${sb}/auth/v1/callback`, state, nonce: "n-1" })}`);
    }
    if (u.pathname === "/idp/authorize") return go(`${u.searchParams.get("redirect_uri")}?${new URLSearchParams({ code: "code-123", state: u.searchParams.get("state") })}`);
    if (u.pathname === "/auth/v1/callback") {
      const st = states.get(u.searchParams.get("state"));
      if (!st || u.searchParams.get("code") !== "code-123") return send(400, { error: "bad state" });
      states.delete(u.searchParams.get("state"));
      return go(`${st.back}#access_token=${T.memberGoogle}&expires_in=3600&refresh_token=r-1&token_type=bearer`);
    }
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const who = Object.values(T).includes(token) ? whoOf(token) : null;
    if (u.pathname === "/auth/v1/user") return who ? send(200, { id: IDS[who], email: EMAIL[who], identities: IDENT[who].map(([provider, email]) => ({ provider, identity_data: { email } })) }) : send(401, { msg: "bad token" });
    if (!who) return send(401, { message: "no user" });
    const role = (ws) => (ws === WS ? ROLE[who] || null : null);
    const eq = (k) => (u.searchParams.get(k) || "").replace(/^eq\./, "") || null;
    const b = body ? JSON.parse(body) : {};
    if (u.pathname === "/rest/v1/rpc/ws_role") return send(200, role(b.ws));
    if (u.pathname === "/rest/v1/rpc/ws_join_by_email") return send(200, null);
    if (u.pathname === "/rest/v1/workspaces") return send(200, role(WS) && (!eq("id") || eq("id") === WS) ? [{ id: WS, owner_id: IDS.owner, name: "Hosted bakery", created_at: "2026-10-01T00:00:00Z" }] : []);
    if (u.pathname === "/rest/v1/workspace_members") {
      const rows = ["member", "viewer", "contractor"].map((k) => ({ workspace_id: WS, email: EMAIL[k], user_id: IDS[k], role: ROLE[k], status: "active", invited_at: "2026-10-01T00:00:00Z" }));
      return send(200, role(WS) ? rows.filter((r) => !eq("email") || r.email === decodeURIComponent(eq("email"))) : []);
    }
    if (u.pathname === "/rest/v1/workspace_projects") return send(200, role(WS) ? [{ workspace_id: WS, project_id: "p1", data: { id: "p1", name: "Bread launch", categories: [] }, updated_at: "2026-10-02T00:00:00Z" }] : []);
    if (u.pathname === "/rest/v1/workspace_usage") return send(200, []);
    // ---- supabase/workspace-keys.sql, played out ----
    if (u.pathname === "/rest/v1/workspace_secrets") {
      const ro = role(eq("workspace_id") || b.workspace_id);
      if (req.method === "GET") return send(200, ["owner", "admin", "member"].includes(ro) ? secrets.filter((r) => r.workspace_id === eq("workspace_id")) : []);
      if (!["owner", "admin"].includes(ro)) return send(403, { message: "row-level security" });
      if (req.method === "POST") { const i = secrets.findIndex((r) => r.workspace_id === b.workspace_id && r.provider === b.provider); if (i >= 0) secrets.splice(i, 1); secrets.push(b); return send(201); }
      if (req.method === "DELETE") { const i = secrets.findIndex((r) => r.workspace_id === eq("workspace_id") && r.provider === eq("provider")); if (i >= 0) secrets.splice(i, 1); return send(204); }
    }
    // ---- supabase/team-sso.sql, played out ----
    if (u.pathname === "/rest/v1/workspace_sso") {
      const ro = role(eq("workspace_id") || b.workspace_id);
      if (req.method === "GET") return send(200, ro ? sso.filter((r) => r.workspace_id === eq("workspace_id")) : []);
      if (!["owner", "admin"].includes(ro)) return send(403, { message: "row-level security" });
      const i = sso.findIndex((r) => r.workspace_id === b.workspace_id); if (i >= 0) sso.splice(i, 1); sso.push(b); return send(201);
    }
    return req.method === "GET" ? send(200, []) : send(201);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: sb, secrets, sso, seen, close: () => new Promise((r) => server.close(r)) };
}

test("hosted hub: Google / Microsoft sign-in (mocked OIDC), workspace rule, workspace keys for members only", { timeout: 180000 }, async () => {
  const sb = await fakeHub();
  const TEAM = "sk-team-hub-3333333333333333";
  const s = await startServer({ env: { ...NO_KEYS, CC_MODE: "hosted", CC_SUPABASE_URL: sb.url, CC_SUPABASE_ANON_KEY: "anon-test-key", CC_MASTER_KEY: crypto.randomBytes(32).toString("base64"), CC_OWNER_EMAILS: "owner@example.com,member@example.com", CC_STATUS_PAGES: "off", CC_SSO_PROVIDERS: "google, azure, github", CC_BASE_URL_OPENAI: `${sb.url}/oai/v1` } });
  const as = (t) => (p, o = {}) => s.api(p, { ...o, headers: { authorization: `Bearer ${t}` } });
  const owner = as(T.owner), member = as(T.member), memberG = as(T.memberGoogle), viewer = as(T.viewer), contractor = as(T.contractor), outsider = as(T.outsider);
  const teamCalls = () => sb.seen.filter((x) => x === `Bearer ${TEAM}`).length;
  try {
    // ---- sign-in options and the start of the flow ----
    const cfg = (await s.api("/config")).json;
    assert.deepEqual(cfg.sso, [{ id: "google", name: "Google" }, { id: "azure", name: "Microsoft" }], "only known providers the hub turned on");
    const back = `${s.base}/`;
    let r = await s.raw({ path: `/api/sso/start?provider=google&redirect=${encodeURIComponent(back)}` });
    assert.equal(r.status, 302, "public: no sign-in needed to start signing in");
    const loc = new URL(r.headers.location);
    assert.equal(loc.origin + loc.pathname, `${sb.url}/auth/v1/authorize`);
    assert.equal(loc.searchParams.get("provider"), "google"); assert.equal(loc.searchParams.get("redirect_to"), back); assert.match(loc.searchParams.get("scopes"), /openid email/);
    assert.equal((await s.raw({ path: `/api/sso/start?provider=github&redirect=${encodeURIComponent(back)}` })).status, 400);
    assert.equal((await s.raw({ path: `/api/sso/start?provider=google&redirect=${encodeURIComponent("https://evil.example/")}` })).status, 400, "no open redirect");
    assert.equal((await s.raw({ path: `/api/sso/start?provider=google&redirect=${encodeURIComponent(`http://evil.example:${s.port}/`)}` })).status, 400);
    // the mocked OIDC round trip ends back on the hub with a session in the hash
    let next = r.headers.location, hops = 0;
    while (!next.startsWith(back) && hops++ < 5) { const x = await fetch(next, { redirect: "manual" }); next = x.headers.get("location"); }
    assert.ok(next.startsWith(`${back}#access_token=`), next);
    const sessionToken = new URLSearchParams(next.split("#")[1]).get("access_token");
    r = await as(sessionToken)("/sso");
    assert.equal(r.status, 200); assert.equal(r.json.session.sso, true); assert.equal(r.json.session.method, "oauth");
    assert.ok(r.json.session.providers.some((i) => i.provider === "google" && i.email === EMAIL.member));
    assert.equal((await member("/sso")).json.session.sso, false, "the emailed link is not single sign-on");

    // ---- the workspace rule: owner or admin sets it ----
    assert.equal((await outsider(`/sso/policy/${WS}`)).status, 404);
    assert.equal((await member(`/sso/policy/${WS}`, { method: "POST", body: { required: true, providers: ["google"] } })).status, 403, "a member cannot set it");
    assert.equal((await owner(`/sso/policy/${WS}`, { method: "POST", body: { required: true, providers: [] } })).status, 400);
    assert.equal((await owner(`/sso/policy/${WS}`, { method: "POST", body: { required: true, providers: ["google"], domains: "not a domain" } })).status, 400);
    r = await owner(`/sso/policy/${WS}`, { method: "POST", body: { required: true, providers: ["google", "azure"], domains: "@Example.com" } });
    assert.equal(r.status, 200, r.text); assert.deepEqual(r.json.policy, { required: true, providers: ["google", "azure"], domains: ["example.com"] });
    assert.equal(sb.sso.length, 1);

    // ---- a workspace key: owner saves it, the row is ciphertext only ----
    assert.equal((await viewer(`/wskeys/${WS}`, { method: "POST", body: { provider: "openai", key: TEAM } })).status, 402, "a viewer (Free) cannot");
    r = await memberG(`/wskeys/${WS}`, { method: "POST", body: { provider: "openai", key: TEAM } });
    assert.equal(r.status, 403); assert.equal(r.json.code, "role", "a member cannot, even on a paid plan");
    r = await owner(`/wskeys/${WS}`, { method: "POST", body: { provider: "openai", key: TEAM } });
    assert.equal(r.status, 200, r.text); assert.ok(!r.text.includes(TEAM));
    assert.equal(sb.secrets.length, 1);
    assert.ok(!JSON.stringify(sb.secrets).includes(TEAM) && !JSON.stringify(sb.secrets).includes("3333333333"), "only ciphertext is stored");
    assert.equal(sb.secrets[0].masked, "sk-t…3333"); assert.equal(sb.secrets[0].added_by_email, EMAIL.owner);

    // ---- the rule at work ----
    r = await member("/workspaces/active", { method: "POST", body: { id: WS } });
    assert.equal(r.status, 403); assert.equal(r.json.code, "sso"); assert.match(r.json.error, /sign in with Google or Microsoft with an address at @example\.com/);
    let view = (await member("/workspaces")).json.memberOf.find((w) => w.id === WS);
    assert.ok(view.locked, "locked for an emailed-link session"); assert.deepEqual(view.projects, []); assert.deepEqual(view.members, []);
    r = await contractor("/workspaces/active", { method: "POST", body: { id: WS } });
    assert.equal(r.status, 403, "Microsoft sign-in, but not an @example.com address"); assert.equal(r.json.code, "sso");
    assert.equal((await owner("/workspaces/active", { method: "POST", body: { id: WS } })).status, 200, "the owner is never locked out");
    view = (await memberG("/workspaces")).json.memberOf.find((w) => w.id === WS);
    assert.ok(!view.locked); assert.equal(view.projects[0].name, "Bread launch");
    assert.equal((await memberG("/workspaces/active", { method: "POST", body: { id: WS } })).status, 200, "Google with an @example.com address: in");

    // the member has no key of their own: the workspace's key carries their calls while the workspace is active
    let w; for (let i = 0; i < 50 && !(w?.using?.length); i++) { await sleep(100); w = (await memberG("/wskeys")).json; }
    assert.deepEqual(w.using, ["openai"]); assert.equal(w.canUse, true); assert.equal(w.canManage, false);
    assert.deepEqual(w.keys.map((k) => k.masked), ["sk-t…3333"]); assert.ok(!JSON.stringify(w).includes(TEAM));
    assert.equal(await chatKey(memberG, sb.seen), TEAM);
    // the same person on an emailed-link session (phone) does not get it
    const before = teamCalls();
    const rr = await member("/chat", { method: "POST", body: { prompt: "One more line.", provider: "openai", model: "gpt-6-luna" } });
    assert.equal(rr.status, 202); await sleep(1500);
    assert.equal(teamCalls(), before, "a session that does not meet the rule never uses the workspace key");
    // back to Personal: never the workspace key
    await memberG("/workspaces/active", { method: "POST", body: { id: null } });
    await sleep(300);
    assert.deepEqual((await memberG("/wskeys")).json.using, []);
    await memberG("/chat", { method: "POST", body: { prompt: "And another.", provider: "openai", model: "gpt-6-luna" } }); await sleep(1500);
    assert.equal(teamCalls(), before);

    // ---- rule off: a viewer may switch in, but a viewer uses their own keys ----
    assert.equal((await owner(`/sso/policy/${WS}`, { method: "POST", body: { required: false, providers: [], domains: [] } })).status, 200);
    await sleep(50);
    assert.equal((await viewer("/workspaces/active", { method: "POST", body: { id: WS } })).status, 200);
    w = (await viewer("/wskeys")).json;
    assert.equal(w.canUse, false); assert.deepEqual(w.keys, []); assert.deepEqual(w.using, []); assert.match(w.note, /viewer uses their own keys/);
    // the owner removes it
    assert.equal((await owner(`/wskeys/${WS}/openai`, { method: "DELETE" })).status, 200);
    assert.equal(sb.secrets.length, 0);
  } finally { await s.stop(); await sb.close(); }
});

test("Phase 24 team files: no em-dashes in user-facing text, migrations turn on RLS", () => {
  for (const f of ["server/sso.js", "server/workspace-keys.js", "server/plugins/sso.js", "server/plugins/wskeys.js", "web/features/sso.js", "web/features/wskeys.js", "supabase/workspace-keys.sql", "supabase/team-sso.sql"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
  for (const f of ["supabase/workspace-keys.sql", "supabase/team-sso.sql"]) { const sql = fs.readFileSync(path.join(ROOT, f), "utf8"); assert.match(sql, /enable row level security/); assert.match(sql, /MIGRATION FILE ONLY/); }
});
