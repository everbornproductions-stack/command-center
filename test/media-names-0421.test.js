// Pictures and clips are named after the words that made them, and an SVG shows as a picture (M36).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { startServer } from "./helpers.js";

test("a picture made from words is named after them and an SVG is served inline as an image", async () => {
  const now = Date.now();
  const SVG = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/>");
  const srv = await startServer({
    seed(dir) {
      const media = path.join(dir, "projects", "unfiled", "media");
      fs.mkdirSync(media, { recursive: true });
      const f = path.join(media, "img-abc123-dry-run.svg");
      fs.writeFileSync(f, SVG);
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: [
        { id: "img-abc123", source: "images", kind: "image", provider: "demo", op: "generate", status: "done", projectId: null, params: { prompt: "A woman on a beach at sunset" }, createdAt: now, outputs: [f], mimes: ["image/svg+xml"] },
      ] }));
    },
  });
  try {
    const list = (await srv.api("/mindmedia")).json;
    const it = list.items.find((i) => i.kind === "image");
    assert.ok(it, JSON.stringify(list.items.map((i) => i.name)));
    assert.equal(it.name, "A woman on a beach at sunset.svg");
    const r = await srv.api(`/projectmedia/file?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers?.["content-type"] || ""), /image\/svg\+xml/);
  } finally { await srv.stop(); }
});
