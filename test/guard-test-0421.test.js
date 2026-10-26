import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

test("POST /api/guardtest says what the guard would do and sends nothing", async () => {
  const srv = await startServer({});
  try {
    const bad = await srv.api("/guardtest", { method: "POST", body: { text: "We guarantee we will remove all your negative items. Pay up front.", channel: "sms" } });
    assert.equal(bad.status, 200);
    assert.equal(bad.json.ok, false);
    assert.match(bad.json.summary, /would be stopped/);
    assert.equal(bad.json.sent, false);
    const warn = await srv.api("/guardtest", { method: "POST", body: { text: "Big sale this week", channel: "sms", consent: true } });
    assert.equal(warn.json.ok, true);
    assert.match(warn.json.summary, /warning first/);
    const fine = await srv.api("/guardtest", { method: "POST", body: { text: "Fresh bread daily. Reply STOP to opt out.", channel: "sms", consent: true } });
    assert.match(fine.json.summary, /No problems/);
    assert.equal((await srv.api("/guardtest", { method: "POST", body: { text: " " } })).status, 400);
  } finally { await srv.stop(); }
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "guard-test.js"), "utf8");
  assert.match(ui, /Try the send guard/);
  assert.equal(/[–—]/.test(ui), false);
});
