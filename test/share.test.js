// Phase 4: live-share links (R8). Pure checks (feed scrubbing, what of the brand kit is public), then the
// running server in a temp data dir, demo AIs only (local mock, no real key or URL): a finished chat is
// shared without a session token, the owner's brand kit rides along, costs only appear when toggled,
// the link survives a restart, an expired link says so, a revoked link is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-share-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const { scrub, publicBrand } = await import("../server/plugins/share.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("scrub: dollar amounts hidden unless costs are shown, key-shaped strings always hidden", () => {
  assert.equal(scrub("Nova done ($0.0123)", false), "Nova done ([cost hidden])");
  assert.equal(scrub("Nova done ($0.0123)", true), "Nova done ($0.0123)");
  assert.equal(scrub("spent US$ 1,204.50 today", false), "spent [cost hidden] today");
  for (const k of ["sk-ant-abcdefghijklmnop1234", "sk-proj-abcdefghijklmnop", "AIzaSyA1234567890abcdefghijk", "xai-abcdefghijklmnop", "gsk_abcdefghijklmnop", "Bearer abcdefghijklmnopqrstu"]) {
    const out = scrub(`error with ${k} here`, true);
    assert.ok(!out.includes(k), `${k} hidden`); assert.match(out, /\[hidden\]/);
  }
  assert.equal(scrub("Plan written for the bakery", false), "Plan written for the bakery");
});

test("publicBrand: only name, tagline, colours and logo", () => {
  const b = publicBrand({ name: "Acme", tagline: "t", primary: "#ff7000", secondary: null, logo: PNG, updatedAt: 1, limits: {} });
  assert.deepEqual(Object.keys(b).sort(), ["logo", "name", "primary", "secondary", "tagline"]);
});

async function finishedChat(s) {
  assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" } })).status, 202);
  let m = null;
  for (let i = 0; i < 240 && !m; i++) { m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done"); if (!m) await sleep(250); }
  assert.ok(m, "the chat finished");
  return m;
}

test("share link: public read-only view with the brand kit, costs only when toggled, list, restart, expiry, revoke", { timeout: 180000 }, async () => {
  const dir = tmpDir("cc-share-srv-");
  let s = await startServer({ dataDir: dir, env: { CC_DEV_OWNER: "1" } });
  let s2 = null;
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal((await s.api("/brand", { method: "POST", body: { name: "Rye and Crumb", tagline: "Baked at dawn", primary: "#ff7000", logo: PNG } })).status, 200);
    const m = await finishedChat(s);

    assert.equal((await s.api("/share/create", { method: "POST", body: {} })).status, 400, "missionId required");
    assert.equal((await s.api("/share/create", { method: "POST", body: { missionId: m.id }, noToken: true })).status, 401, "only the owner creates links");
    const hidden = (await s.api("/share/create", { method: "POST", body: { missionId: m.id, ttlMinutes: 60 } })).json;
    assert.match(hidden.url, /^\/share\.html\?t=[A-Za-z0-9_-]{20,}$/);
    assert.ok(hidden.expiresAt > Date.now() + 55 * 60000 && hidden.expiresAt <= Date.now() + 61 * 60000);

    // the public view needs no session token
    let v = await s.api(`/share/t/${hidden.token}`, { noToken: true });
    assert.equal(v.status, 200);
    assert.equal(v.json.brand.name, "Rye and Crumb"); assert.equal(v.json.brand.primary, "#ff7000"); assert.equal(v.json.brand.tagline, "Baked at dawn"); assert.equal(v.json.brand.logo, PNG);
    assert.equal(v.json.mission.id, m.id); assert.equal(v.json.mission.status, "done");
    assert.equal(v.json.showCosts, false);
    assert.ok(!/"(cost|estCost|estimatedCost|budgetUsd)"/.test(v.text), "no cost fields when costs are hidden");
    for (const e of v.json.feed) assert.doesNotMatch(e.text, /\$\s?\d/, "no dollar amounts in the feed");
    assert.doesNotMatch(v.text, /sk-|AIza|x-cc-token/);

    const shown = (await s.api("/share/create", { method: "POST", body: { missionId: m.id, showCosts: true } })).json;
    v = await s.api(`/share/t/${shown.token}`, { noToken: true });
    assert.equal(v.json.showCosts, true);
    assert.ok(typeof v.json.mission.cost === "number" && v.json.mission.cost > 0, "cost shown when toggled");

    let list = (await s.api(`/share/list?missionId=${m.id}`)).json;
    assert.equal(list.length, 2); assert.ok(list.every((l) => l.missionId === m.id && !l.expired && l.url.startsWith("/share.html?t=")));
    assert.equal((await s.api("/share/list", { noToken: true })).status, 401, "the list is owner only");
    assert.deepEqual((await s.api("/share/list?missionId=nope")).json, []);

    assert.equal((await s.api("/share/t/not-a-real-token", { noToken: true })).status, 404);
    assert.equal((await s.api(`/share/t/${shown.token}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/share/t/${shown.token}`, { noToken: true })).status, 404, "a revoked link is gone");

    // restart on the same data folder: the link still works; an expired one says so
    s.child.kill(); await new Promise((r) => { s.child.once("exit", r); setTimeout(r, 2000); }); await s.stub.close(); s = null;
    s2 = await startServer({ dataDir: dir, seed: (d) => {
      const f = path.join(d, "share.tokens.json"); const tok = JSON.parse(fs.readFileSync(f, "utf8"));
      tok.oldtokenoldtokenoldtoken = { missionId: m.id, createdAt: Date.now() - 7200000, expiresAt: Date.now() - 3600000, showCosts: false };
      fs.writeFileSync(f, JSON.stringify(tok));
    } });
    v = await s2.api(`/share/t/${hidden.token}`, { noToken: true });
    assert.equal(v.status, 200, "the link survives a restart"); assert.equal(v.json.mission.id, m.id); assert.equal(v.json.brand.name, "Rye and Crumb");
    assert.equal((await s2.api("/share/t/oldtokenoldtokenoldtoken", { noToken: true })).status, 410, "expired");
    list = (await s2.api(`/share/list?missionId=${m.id}`)).json;
    assert.equal(list.find((l) => l.token === "oldtokenoldtokenoldtoken")?.expired, true);
  } finally { if (s) await s.stop(); if (s2) await s2.stop(); }
});

test("share page and button: brand kit applied, no referrer, revoke, no em-dashes", () => {
  const page = fs.readFileSync(path.join(ROOT, "web/share.html"), "utf8");
  assert.match(page, /<meta name="referrer" content="no-referrer"/, "the token never leaks in a Referer header");
  assert.match(page, /applyBrand\(d\.brand\)/); assert.match(page, /setProperty\("--accent"/); assert.match(page, /class="client-logo"/);
  const ui = fs.readFileSync(path.join(ROOT, "web/features/share.js"), "utf8");
  assert.match(ui, /method: "DELETE"/); assert.match(ui, /\/share\/list\?missionId=/);
  for (const f of ["web/share.html", "web/features/share.js", "server/plugins/share.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
