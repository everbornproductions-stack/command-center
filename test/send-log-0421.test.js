// The send log (idea 4): what went out, to whom, which warnings showed, and numbers hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, startServer, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-sendlog-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { recordSend, sendLog } = await import("../server/send-log.js");

test("recordSend keeps who, when, the words and the warnings, and hides private numbers", () => {
  recordSend({ channel: "highlevel", kind: "send_message", to: "contact-9", title: "Text to Sam", text: "My SSN is 123-45-6789, call me", rules: ["sms_no_optout"], sendAnyway: true });
  recordSend({ channel: "email", kind: "gmail", to: "a@b.com", title: "Hello", text: "Hi" });
  const log = sendLog();
  assert.equal(log.length, 2);
  assert.equal(log[1].channel, "highlevel");
  assert.doesNotMatch(log[1].text, /123-45-6789/);
  assert.match(log[1].text, /\*\*\*-\*\*-6789/);
  assert.equal(log[1].sendAnyway, true);
  assert.deepEqual(log[1].rules, ["sms_no_optout"]);
  assert.ok(log[1].at > 0);
});

test("GET /api/publish/send-log answers, and the Publish page lists it", async () => {
  const srv = await startServer({});
  try {
    const r = await srv.api("/publish/send-log");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items, []);
  } finally { await srv.stop(); }
  const t = fs.readFileSync(path.join(ROOT, "web", "features", "publish.js"), "utf8");
  assert.match(t, /id="pb-sendlog"/);
  for (const f of ["server/highlevel-tools.js", "server/google.js", "server/plugins/builders.js", "server/plugins/publish.js"]) assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /recordSend/, f);
});
