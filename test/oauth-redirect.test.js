// Publishing OAuth redirects: 127.0.0.1 on the desktop, https from CC_HUB_URL on the hub.
// The setup text for Meta, Slack, HighLevel and Google shows that exact URL. No network calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishRedirect, setupText, start } from "../server/publish/oauth.js";

const FOUR = ["google", "meta", "ghl", "slack"];
const HUB = "https://hub.meldmind.ai/";

test("desktop redirects stay on 127.0.0.1", () => {
  assert.equal(publishRedirect({ hosted: false, port: 4747, hubUrl: HUB }), "http://127.0.0.1:4747/");
  assert.equal(publishRedirect({ hosted: false, port: 5123 }), "http://127.0.0.1:5123/");
  assert.throws(() => publishRedirect({ hosted: false, port: 0 }), (e) => e.status === 500);
});

test("hosted redirects are https from CC_HUB_URL and a non-https redirect is refused", () => {
  assert.equal(publishRedirect({ hosted: true, hubUrl: "https://hub.meldmind.ai" }), HUB);
  assert.equal(publishRedirect({ hosted: true, hubUrl: "https://hub.meldmind.ai/app" }), HUB);
  assert.throws(() => publishRedirect({ hosted: true, hubUrl: "http://hub.meldmind.ai" }), (e) => e.status === 400 && /https/.test(e.message));
  assert.throws(() => publishRedirect({ hosted: true, hubUrl: "" }), (e) => e.status === 500);
  assert.throws(() => publishRedirect({ hosted: true, hubUrl: "not a url" }), (e) => e.status === 400);
  for (const id of FOUR) {
    assert.throws(() => start(id, { redirectUri: "http://127.0.0.1:4747/", hosted: true }), (e) => e.status === 400 && /https/.test(e.message), id);
    assert.throws(() => start(id, { redirectUri: "http://hub.meldmind.ai/", hosted: true }), (e) => e.status === 400, id);
  }
});

test("setup text shows the exact redirect URL for Meta, Slack, HighLevel and Google", () => {
  for (const id of FOUR) {
    const hosted = setupText(id, HUB);
    const local = setupText(id, "http://127.0.0.1:4747/");
    assert.ok(hosted.includes(`Add this exact redirect URL: ${HUB}`), id);
    assert.ok(local.includes("Add this exact redirect URL: http://127.0.0.1:4747/"), id);
    assert.equal(hosted.includes("—") || local.includes("—"), false, id);
  }
});
