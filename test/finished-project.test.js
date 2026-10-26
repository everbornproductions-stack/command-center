// A finished project stays editable and exports as a zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { startServer, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function zipNames(buf) {
  const names = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), el = buf.readUInt16LE(i + 28);
    names.push(buf.slice(i + 30, i + 30 + nl).toString());
    i += 30 + nl + el + size;
  }
  return names;
}

test("after Finish the text can be edited, and the project exports as a zip", { timeout: 240000 }, async () => {
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const started = await s.api("/buildall/start", { method: "POST", body: { surface: "start", type: "website", idea: "A weekend bakery site for Harbor and Rye. It is for neighbors who want fresh bread." } });
    assert.equal(started.status, 202);
    let job;
    for (let i = 0; i < 400; i++) { job = (await s.api(`/buildall/${started.json.id}`)).json; if (job.status !== "running") break; await sleep(150); }
    assert.equal(job.status, "done");
    const id = job.result.walkId;
    const fin = await s.api(`/walkthrough/${id}/finish`, { method: "POST", body: {} });
    assert.equal(fin.status, 200);
    assert.equal(fin.json.stage, "done");

    const edit = await s.api(`/walkthrough/${id}/edit`, { method: "POST", body: { deliverable: "My own words for the bakery site." } });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(edit.json.deliverable, "My own words for the bakery site.");
    assert.equal((await s.api(`/walkthrough/${id}/edit`, { method: "POST", body: { deliverable: "  " } })).status, 400);
    assert.equal((await s.api(`/walkthrough/${id}`)).json.deliverable, "My own words for the bakery site.", "the edit is kept");

    const zip = await s.api(`/walkthrough/${id}/export?format=zip`);
    assert.equal(zip.status, 200);
    assert.match(zip.json.filename, /\.zip$/);
    const buf = Buffer.from(zip.json.zipBase64, "base64");
    assert.equal(buf.readUInt32LE(0), 0x04034b50, "a real zip");
    const names = zipNames(buf);
    assert.ok(names.some((n) => n.endsWith("/deliverable.md")), names.join());
    assert.ok(names.some((n) => n.includes("/steps/")), "each step is a file");
    assert.ok(names.some((n) => n.endsWith("README.txt")));
    const md = await s.api(`/walkthrough/${id}/export`);
    assert.ok(md.json.markdown.includes("My own words"), "text export has the edit too");
  } finally { await s.stop(); }
});

test("the finished page offers editing and the zip", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "walkthrough.js"), "utf8");
  for (const needle of ["Edit this project", "Save my edit", "Export as a zip", "Revise with AI", "format=zip"]) assert.ok(ui.includes(needle), needle);
});
