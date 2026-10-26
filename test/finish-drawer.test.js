// Finish drawer (0.4.20): the export route behind Save as PDF / Word, and the wiring of Finish everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("source: Finish opens the drawer, one meaning for Finish, no dashes", () => {
  const drawer = read("web", "features", "finish-drawer.js");
  for (const w of ["Done? Choose where this goes.", "Save as PDF", "Save as Word", "Save to MindMedia", "Print", "Copy", "Publish"]) assert.ok(drawer.includes(w), w);
  assert.equal(drawer.includes("—") || drawer.includes("–"), false);
  assert.match(read("web", "finishpath-ui.js"), /openFinishDrawer/);
  assert.match(read("web", "next-actions-ui.js"), /openFinishDrawer/);
  assert.equal(read("web", "next-actions.js").includes("Send to Finish"), false);
  assert.match(read("web", "perf", "registry.js"), /id: "finish-drawer", shell: true/);
  assert.match(read("web", "perf", "registry.js"), /id: "mindmedia", views: \["mindmedia"\]/);
});

test("source: result cards end Start a project, builders, Compare and Artifacts", () => {
  assert.match(read("web", "features", "walkthrough.js"), /mountDoneCard/);
  assert.match(read("web", "features", "webbuilders.js"), /resultCard/);
  assert.match(read("web", "features", "compare.js"), /resultCard/);
  assert.match(read("web", "features", "artifacts.js"), /Save to MindMedia/);
  assert.match(read("server", "plugins", "webbuilders.js"), /keepSite/);
});

test("POST /api/mindmedia/export makes a real PDF and Word file, and refuses empty text", async () => {
  const srv = await startServer({});
  try {
    for (const [format, magic] of [["pdf", "%PDF"], ["docx", "PK"]]) {
      const r = await srv.api("/mindmedia/export", { method: "POST", body: { text: "Hello there.\nSecond line.", title: "Spring sale", format } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.match(r.json.name, new RegExp(`^Spring-sale\\.${format}$`));
      assert.equal(Buffer.from(r.json.data, "base64").subarray(0, magic.length).toString("latin1"), magic);
    }
    const bad = await srv.api("/mindmedia/export", { method: "POST", body: { text: "  ", format: "pdf" } });
    assert.equal(bad.status, 400);
  } finally { await srv.stop(); }
});
