// MindMedia small things (F18, M48, M49): bad status, truncated flag, 413, "Unfiled" reserved, Drive folder name.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";

test("hub: bad status is refused, long text is flagged, a huge body gets 413, Unfiled is reserved", async () => {
  const srv = await startServer({});
  try {
    const bad = await srv.api("/mindmedia/save", { method: "POST", body: { kind: "text", text: "hello", name: "x", status: "Banana" } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /Status must be one of/);
    const ok = await srv.api("/mindmedia/save", { method: "POST", body: { kind: "text", text: "w ".repeat(15000), name: "Long one", status: "Review" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const it = ok.json.items[0];
    const got = await srv.api(`/mindmedia/item?projectId=${encodeURIComponent(ok.json.projectId)}&assetId=${encodeURIComponent(it.id || it.assetId)}`);
    assert.equal(got.json.truncated, true);
    assert.equal(got.json.text.length, 20000);
    const big = await srv.api("/mindmedia/save", { method: "POST", body: { kind: "text", text: "x".repeat(19_000_000), name: "big" } });
    assert.equal(big.status, 413);
    assert.match(big.json.error, /too large/);
    const proj = await srv.api("/projects", { method: "POST", body: { name: " Unfiled " } });
    assert.equal(proj.status, 400);
    assert.match(proj.json.error, /Unfiled/);
  } finally { await srv.stop(); }
});

test("Drive folder is called Meldmind and an old Everborn Command folder is renamed once", async () => {
  const drive = await import("../server/publish/drive.js");
  const base = tmpDir("cc-drive0421-");
  fs.mkdirSync(path.join(base, "Everborn Command", "unfiled"), { recursive: true });
  fs.writeFileSync(path.join(base, "Everborn Command", "unfiled", "old.md"), "old");
  const r = await drive.post({ title: "Hello", text: "hi", files: [], projectId: "" }, { driveFolder: base }, null);
  assert.ok(r, "posted");
  assert.ok(fs.existsSync(path.join(base, "Meldmind", "unfiled", "old.md")));
  assert.equal(fs.existsSync(path.join(base, "Everborn Command")), false);
  assert.ok(fs.readdirSync(path.join(base, "Meldmind", "unfiled")).some((f) => /Hello\.md$/.test(f)));
});
