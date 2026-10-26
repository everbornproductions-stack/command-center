// People "Set up hub": the saved address is what the server reads, a bad address never saves or breaks the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import * as store from "../server/store.js";
import { setHub, hubTarget } from "../server/user-chat.js";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hubset-"));
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
delete process.env.CC_USERCHAT_HUB;

test("a bad address is refused in plain words and nothing is saved", async () => {
  for (const bad of ["not a url", "ftp://x.example.com", "http://example.com", "https://u:p@example.com"]) {
    const r = await setHub(bad, { fetchImpl: async () => ({ status: 200 }) });
    assert.equal(r.ok, false, bad);
    assert.ok(r.message && !/[–—]/.test(r.message));
  }
  assert.equal(hubTarget().configured, false);
});

test("an unreachable hub is not saved and does not throw", async () => {
  const r = await setHub("https://hub.example.com", { fetchImpl: async () => { throw new Error("down"); } });
  assert.equal(r.ok, false);
  assert.match(r.message, /could not reach/);
  assert.equal(hubTarget().configured, false);
});

test("a reachable hub is saved and the server reads it back; clearing works", async () => {
  const srv = http.createServer((q, s) => { s.end("{}"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const r = await setHub(url);
    assert.equal(r.ok, true);
    assert.equal(hubTarget().configured, true);
    const c = await setHub("");
    assert.equal(c.cleared, true);
    assert.equal(hubTarget().configured, false);
  } finally { await new Promise((r) => srv.close(r)); }
});
