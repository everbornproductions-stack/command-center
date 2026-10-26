// 0.4.21 M-hub items 11, 12 and 20: report-back and Teams across two computers through the Supabase
// project (stand-in cloud, no real network), "Needs the Meldmind hub (coming soon)" for what needs
// paid hosting, the Owner checklist (app and docs/RELEASING.md), and the waiting-for-purchase text.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, ROOT, waitBudget } from "./helpers.js";
import { ITEMS } from "../server/owner-checklist.js";
import { createPaidWatch } from "../web/paid-watch.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VALID_JOB = /^[a-z]{1,12}-[A-Za-z0-9_-]{6,64}$/;

// A stand-in for the Supabase REST functions (rb_* and team_*), with the same rules as the SQL.
function fakeCloud({ missing = false } = {}) {
  const jobs = new Map(); const spaces = new Map(); const invites = new Map(); const members = new Map(); const recipes = new Map();
  const calls = [];
  const fns = {
    rb_register: ({ p_owner, p_job }) => { if (!VALID_JOB.test(p_job)) return { ok: false }; const tok = crypto.randomBytes(18).toString("hex"); jobs.set(p_job, { owner: sha(p_owner), tok: sha(tok), result: null }); return { ok: true, token: tok }; },
    rb_report: ({ p_job, p_token, p_status, p_summary, p_links }) => { const j = jobs.get(p_job); if (!j || j.tok !== sha(p_token)) return { ok: false, message: "Job or token not recognised." }; j.result = { status: p_status, summary: p_summary, links: p_links || [] }; return { ok: true }; },
    rb_inbox: ({ p_owner }) => [...jobs.entries()].filter(([, j]) => j.owner === sha(p_owner) && j.result).map(([id, j]) => ({ jobId: id, ...j.result })),
    rb_ack: ({ p_owner, p_job }) => { const j = jobs.get(p_job); if (j && j.owner === sha(p_owner)) jobs.delete(p_job); return { ok: true }; },
    team_invite_create: ({ p_owner, p_ws, p_name, p_role, p_code_hash }) => { const oh = sha(p_owner); const s = spaces.get(p_ws); if (!s) spaces.set(p_ws, { owner: oh, name: p_name }); else if (s.owner !== oh) return { ok: false }; invites.set(p_code_hash, { ws: p_ws, role: p_role, used: false }); return { ok: true }; },
    team_invite_accept: ({ p_code, p_device, p_label }) => { const i = invites.get(sha(p_code)); if (!i || i.used) return { ok: false, message: "That invite code is wrong, used, or expired. Ask for a new one." }; i.used = true; members.set(`${i.ws}:${sha(p_device)}`, { label: p_label, role: i.role }); return { ok: true, wsId: i.ws, name: spaces.get(i.ws).name, role: i.role }; },
    team_state: ({ p_device, p_ws }) => { const s = spaces.get(p_ws); const dh = sha(p_device); const m = members.get(`${p_ws}:${dh}`); if (!s || (!m && s.owner !== dh)) return { ok: false, message: "You are not in this team." }; return { ok: true, role: s.owner === dh ? "owner" : m.role, name: s.name, seatCap: 5, members: [...members.entries()].filter(([k]) => k.startsWith(`${p_ws}:`)).map(([, v]) => v), recipes: [...(recipes.get(p_ws) || [])] }; },
    team_recipe_put: ({ p_device, p_ws, p_data }) => { const s = spaces.get(p_ws); if (!s || s.owner !== sha(p_device)) return { ok: false, message: "Only the owner or an admin can share a recipe." }; recipes.set(p_ws, [p_data]); return { ok: true }; },
  };
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => {
      const name = req.url.split("/rpc/")[1]?.split("?")[0];
      calls.push({ name, apikey: req.headers.apikey, body: b });
      res.setHeader("content-type", "application/json");
      if (missing || !fns[name]) { res.statusCode = 404; res.end(JSON.stringify({ code: "PGRST202", message: "Could not find the function" })); return; }
      res.end(JSON.stringify(fns[name](JSON.parse(b || "{}"))));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, calls, jobs, close: () => new Promise((r) => server.close(r)),
  })));
}
const KEY = "sb_publishable_hubtest_0421";
const envFor = (c, extra = {}) => ({ CC_SUPABASE_URL: c.url, CC_SUPABASE_ANON_KEY: KEY, CC_REPORTBACK_SB_POLL_MS: "250", CC_DEV_OWNER: "1", ...extra });
async function until(fn, ms = waitBudget(15000)) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; }

test("report-back through the cloud: the other AI reports with the job token, this computer picks it up", async () => {
  const cloud = await fakeCloud();
  const s = await startServer({ env: envFor(cloud) });
  try {
    const st = (await s.api("/handoff/report")).json ?? null;
    // ask for a hand-off prompt: it must carry the cloud address, the job id and a token
    const mk = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", draft: "Write a haiku about tea." } });
    const text = JSON.stringify(mk.json || "");
    const jobId = text.match(/"?(rb-[A-Za-z0-9_-]{6,64})/)?.[1];
    assert.ok(jobId, `a job id is in the prompt (${mk.status}) ${text.slice(0, 200)}`);
    assert.match(text, /rb_report/);
    assert.ok(text.includes(KEY), "the publishable key is the apikey header");
    assert.equal(cloud.calls[0].name, "rb_register");
    const tok = [...cloud.jobs.keys()].length && text.match(/p_token\\?":\\?"([0-9a-f]{36})/)?.[1];
    assert.ok(tok, "a one-time job token is in the prompt");
    // the other AI posts the result straight to the cloud function
    const rep = await fetch(`${cloud.url}/rest/v1/rpc/rb_report`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ p_job: jobId, p_token: tok, p_status: "done", p_summary: "Leaves drift down", p_links: [] }) });
    assert.equal((await rep.json()).ok, true);
    const bad = await fetch(`${cloud.url}/rest/v1/rpc/rb_report`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ p_job: jobId, p_token: "wrong", p_status: "done", p_summary: "x" }) });
    assert.equal((await bad.json()).ok, false);
    const gone = await until(() => cloud.jobs.size === 0);
    assert.ok(gone, "the app picked the result up and confirmed it, so the cloud deleted it");
    assert.ok(cloud.calls.some((c) => c.name === "rb_inbox"));
    assert.ok(cloud.calls.some((c) => c.name === "rb_ack"));
    assert.equal(s.log.includes(tok), false, "the job token is not in the log");
    void st;
  } finally { await s.stop(); await cloud.close(); }
});

test("before the SQL is run: report-back falls back to Paste result and the setup step shows", async () => {
  const cloud = await fakeCloud({ missing: true });
  const s = await startServer({ env: envFor(cloud) });
  try {
    const mk = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", draft: "Hello" } });
    assert.match(JSON.stringify(mk.json), /DONE: <summary>/);
    const hub = (await s.api("/hub")).json;
    const rb = hub.features.find((f) => f.id === "reportback");
    assert.equal(rb.state, "needs_setup");
    assert.match(rb.message, /Not switched on yet/);
  } finally { await s.stop(); await cloud.close(); }
});

test("hosted runs and phone use with the PC off say 'Needs the Meldmind hub (coming soon)'", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const hub = (await s.api("/hub")).json;
    for (const id of ["hosted-runs", "phone-off"]) {
      const f = hub.features.find((x) => x.id === id);
      assert.equal(f.state, "soon");
      assert.equal(f.message, "Needs the Meldmind hub (coming soon)");
    }
    const hr = (await s.api("/hosted-runs")).json;
    assert.equal(hr.hub.note, "Needs the Meldmind hub (coming soon)");
  } finally { await s.stop(); }
  assert.match(read("web/features/hosted-runs.js"), /data-hub-soon/);
  assert.match(read("web/app.js"), /Needs the Meldmind hub \(coming soon\)/);
});

test("teams across computers: the owner's invite code lets a second computer join and see the same team", async () => {
  const cloud = await fakeCloud();
  const owner = await startServer({ env: envFor(cloud) });
  const guest = await startServer({ env: envFor(cloud, { CC_DEV_OWNER: "" }) });
  try {
    const ws = await owner.api("/workspaces", { method: "POST", body: { name: "Snap team" } });
    assert.equal(ws.status, 200, ws.text);
    const inv = await owner.api(`/workspaces/${ws.json.id}/members`, { method: "POST", body: { email: "pat@example.com", role: "member" } });
    assert.equal(inv.status, 200, inv.text);
    assert.equal(inv.json.acrossOk, true);
    assert.match(inv.json.code, /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(cloud.calls.some((c) => c.body.includes(inv.json.code)), false, "the cloud never sees the plain code");
    const bad = await guest.api("/workspaces/join", { method: "POST", body: { code: "wrongcodewrongcode1234" } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /wrong, used, or expired/);
    const ok = await guest.api("/workspaces/join", { method: "POST", body: { code: inv.json.code } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.name, "Snap team");
    const again = await guest.api("/workspaces/join", { method: "POST", body: { code: inv.json.code } });
    assert.equal(again.status, 400, "a code works once");
    const view = (await guest.api("/workspaces")).json;
    const mine = view.memberOf.find((w) => w.name === "Snap team");
    assert.ok(mine, "the second computer lists the team");
    assert.equal(mine.role, "member");
    assert.equal(mine.across, true);
    const ownerView = (await owner.api("/workspaces")).json;
    assert.equal(ownerView.owned[0].across.members.length, 1, "the owner sees the new member from the cloud");
  } finally { await owner.stop(); await guest.stop(); await cloud.close(); }
});

test("teams with no cloud set up keep the old message", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const j = await s.api("/workspaces/join", { method: "POST", body: { code: "abcdefghijklmnop1234" } });
    assert.equal(j.json.code, "local");
    assert.ok((await s.api("/workspaces")).json.across.note);
  } finally { await s.stop(); }
});

test("sql file: tables closed to the public, hashes only, marked not run", () => {
  const sql = read("supabase/hub_reportback_teams.sql");
  assert.match(sql, /NOT RUN/);
  for (const t of ["rb_jobs", "team_spaces", "team_members", "team_invites", "team_recipes"]) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.match(sql, /revoke all on table public\.rb_jobs from anon, authenticated/);
  assert.match(sql, /code_hash/);
  assert.equal(/[–—]/.test(read("server/hub-supabase.js") + read("server/team-sync.js")), false);
});

test("Owner checklist: the same ten steps in the app and in docs/RELEASING.md, with the licence key deadline", () => {
  const docs = read("docs/RELEASING.md");
  const sec = docs.slice(docs.indexOf("## Owner checklist"));
  assert.equal(ITEMS.length, 10);
  for (const needle of ["20261026_stripe_unlock_proof.sql", "Google and Azure", "STRIPE_READ_KEY", "price-tiers.js", "2026-12-31", "hub_reportback_teams.sql", "marketplace_catalog.sql", "community_free_posting.sql", "consent", "Billing go-live"]) {
    assert.ok(sec.includes(needle), `docs mention ${needle}`);
    assert.ok(JSON.stringify(ITEMS).includes(needle.replace("Google and Azure", "Google and Azure")), `app mentions ${needle}`);
  }
  const licence = ITEMS.find((i) => i.id === "licence-key");
  assert.equal(licence.deadline, "2026-12-31");
  assert.equal(/[–—]/.test(JSON.stringify(ITEMS) + sec), false);
});

test("Owner checklist route: only the owner sees it, ticks stick, the licence key shows days left", async () => {
  const owner = await startServer({ env: { CC_DEV_OWNER: "1" } });
  const free = await startServer({});
  try {
    const hub = (await owner.api("/hub")).json;
    assert.equal(hub.owner, true);
    assert.equal(hub.checklist.length, 10);
    assert.equal(typeof hub.checklist.find((c) => c.id === "licence-key").daysLeft, "number");
    const tick = await owner.api("/hub/checklist", { method: "POST", body: { id: "unlock-sql", done: true } });
    assert.equal(tick.json.checklist.find((c) => c.id === "unlock-sql").done, true);
    assert.equal((await owner.api("/hub/checklist", { method: "POST", body: { id: "nope" } })).status, 404);
    const f = (await free.api("/hub")).json;
    assert.equal(f.checklist, undefined);
    assert.equal((await free.api("/hub/checklist", { method: "POST", body: { id: "unlock-sql" } })).status, 403);
  } finally { await owner.stop(); await free.stop(); }
});

test("waiting for a purchase: the screen says so, then explains the timeout, with the license key fallback", async () => {
  const states = [];
  let t = 0;
  const w = createPaidWatch({ check: async () => ({ tier: "free", status: "active" }), onState: (s) => states.push(s), current: () => ({ tier: "free" }), now: () => t, setTimer: (fn) => { w.tick = fn; return 1; }, clearTimer: () => {} });
  w.start();
  assert.deepEqual(states, ["waiting"]);
  t = 3 * 60 * 1000;
  w.tick();
  assert.deepEqual(states, ["waiting", "timeout"]);
  const app = read("web/app.js");
  assert.match(app, /Waiting for your purchase to confirm\./);
  assert.match(app, /type your license key under Settings > Your plan/);
  assert.match(app, /Your plan stays Free until one of these works/);
  assert.equal(/[–—]/.test(app.slice(app.indexOf("const PAID_WAIT"), app.indexOf("const paidWatch"))), false);
});
