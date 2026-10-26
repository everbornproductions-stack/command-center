// Teams gate: Pro and Extreme (and the older studio name and owner) can create a workspace; Free cannot.
// Teams page names the plan and has no "Studio licence" or docs path text. Invite message is plain.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { inviteOrigin, inviteLink, inviteMessage } from "../server/plugins/teamspaces.js";

const seedTier = (tier) => (dir) => {
  if (tier === "free") return;
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-TEST-TEST-TEST", email: "a@example.com", tier, status: "active", checkedAt: now, lastOkAt: now }));
};

for (const [tier, allowed] of [["free", false], ["pro", true], ["studio", true], ["extreme", true], ["owner", true]]) {
  test(`workspace create with tier ${tier}: ${allowed ? "allowed" : "402 in plain words"}`, { timeout: 60000 }, async () => {
    const h = await startServer({ seed: seedTier(tier) });
    try {
      const r = await h.api("/workspaces", { method: "POST", body: { name: "Crew" } });
      if (allowed) assert.equal(r.status, 200, r.text);
      else {
        assert.equal(r.status, 402);
        assert.match(r.text, /Pro and Extreme/);
        assert.doesNotMatch(r.text, /Studio licence/i);
      }
    } finally { await h.stop(); }
  });
}

test("invite link never uses this computer's own address", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "192.168.1.5:3000", "10.0.0.2", "[::1]:3000", ""]) {
    assert.equal(inviteLink("CODE1234", { headers: { host } }), "", host);
  }
  assert.equal(inviteOrigin({ headers: { host: "127.0.0.1:1" } }, { CC_PUBLIC_URL: "https://team.example.com/" }), "https://team.example.com");
  assert.equal(inviteLink("CODE1234", { headers: { host: "hub.example.com" } }), "https://hub.example.com/#teamjoin=CODE1234");
});

test("invite message is plain, has the code, and no dashes", () => {
  const m = inviteMessage({ space: "Crew", code: "CODE1234", link: "", role: "member" });
  assert.match(m, /CODE1234/);
  assert.match(m, /Together, then Team spaces/);
  assert.doesNotMatch(m, /[\u2013\u2014]|http/);
});

test("Teams page source names the plan and drops the docs path", () => {
  const s = fs.readFileSync(new URL("../web/features/workspaces.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(s, /Studio licence|docs\/hosted-hub/);
  assert.match(s, /your plan:/);
  const a = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(a, /teamjoin=/);
});
