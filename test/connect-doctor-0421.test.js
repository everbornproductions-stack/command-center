import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

test("connection doctor: nothing connected says nothing; the route and the button exist", async () => {
  const srv = await startServer({});
  try {
    const r = await srv.api("/publish/connect-doctor");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.checks, []);
  } finally { await srv.stop(); }
  assert.match(fs.readFileSync(path.join(ROOT, "web", "features", "publish.js"), "utf8"), /id="pb-doctor"/);
  const oa = fs.readFileSync(path.join(ROOT, "server", "publish", "oauth.js"), "utf8");
  assert.match(oa, /export function doctor\(\)/);
  assert.match(oa, /is connected but is missing/);
});
