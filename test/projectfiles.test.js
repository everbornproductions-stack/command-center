// Phase 6: chat with files. The running server in a temp data dir with the demo AIs and the demo embedder
// (local mocks, no real key or URL); the files are made up in the test.
//  - drop a text file, a text PDF and an image into a project: read and estimate first (nothing spent), then
//    Add with that estimate; the project gets its own library, attached to its chats
//  - the image is saved to the project and described once by the demo AI, which receives the picture itself
//  - a chat in the project answers from the files and cites them; a chat in another project does not see them
//  - every call is in the ledger without file text; removing a file removes its passages and the image
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { startServer, tmpDir, waitBudget } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-pf-unit-"); // the server modules are imported with a throwaway data folder
const { messageShapes } = await import("../server/providers.js");

test("project files: an image part is sent in each API's own shape (pure)", () => {
  const msgs = [{ role: "user", content: [{ type: "text", text: "File name: a.png" }, { type: "image", mime: "image/png", data: "QUJD" }] }];
  assert.deepEqual(messageShapes.openai(msgs)[0].content, [{ type: "text", text: "File name: a.png" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }]);
  assert.deepEqual(messageShapes.anthropic(msgs)[0].content, [{ type: "text", text: "File name: a.png" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }]);
  assert.equal(messageShapes.openai([{ role: "user", content: "plain" }])[0].content, "plain", "text turns are unchanged");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PDF = () => {
  const content = zlib.deflateSync(Buffer.from("BT /F1 12 Tf 72 712 Td (Warranty: every pump is covered for 18 months from delivery.) Tj ET"));
  return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
};
// a 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function waitRun(s, pred, ms = 90000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < budget) {
    try {
      const m = (await s.api("/missions")).json.find(pred);
      if (m && ["done", "done-with-errors", "failed"].includes(m.status)) return (await s.api(`/missions/${m.id}`)).json;
    } catch (e) { last = e?.message || String(e); }
    await sleep(250);
  }
  throw new Error(`run did not finish${last ? `\n${last}` : ""}`);
}
async function waitIndexed(s, pid, ms = 60000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < budget) {
    try {
      const o = (await s.api(`/projectfiles/${pid}`)).json;
      if (o.library && o.library.job?.status !== "indexing" && o.files.length) return o;
    } catch (e) { last = e?.message || String(e); }
    await sleep(200);
  }
  throw new Error(`indexing did not finish${last ? `\n${last}` : ""}`);
}
const ledger = async (s) => (await s.api("/state")).json.ledger.recent;

test("project files: drop documents and an image into a project, ask about them, cited; remove", { timeout: 600000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/projectfiles/x", { noToken: true })).status, 401, "session token required");
    await s.api("/demo", { method: "POST", body: { on: true } });
    const pid = (await s.api("/projects", { method: "POST", body: { name: "Fleet Co" } })).json.id;
    const other = (await s.api("/projects", { method: "POST", body: { name: "Other Co" } })).json.id;
    assert.equal((await s.api("/projectfiles/nope")).status, 404, "files are kept per project");
    const ov0 = (await s.api(`/projectfiles/${pid}`)).json;
    assert.equal(ov0.library, null); assert.deepEqual(ov0.files, []);
    assert.equal(ov0.describer.provider.startsWith("demo-"), true, "the demo AI describes images in demo mode");

    // stage: read and estimate; nothing spent
    const before = (await ledger(s)).length;
    const files = [
      { name: "pumps.md", text: "# Price list\n\nThe ZX-4471 pump costs 312 dollars and ships in two days." },
      { name: "warranty.pdf", data: PDF().toString("base64") },
      { name: "logo.png", data: PNG.toString("base64") },
      { name: "tool.exe", data: Buffer.from("MZ").toString("base64") },
    ];
    const stg = await s.api(`/projectfiles/${pid}/stage`, { method: "POST", body: { files } });
    assert.equal(stg.status, 200, stg.text);
    assert.deepEqual(stg.json.files.map((f) => f.title).sort(), ["pumps.md", "warranty.pdf"]);
    assert.deepEqual(stg.json.images.map((i) => i.title), ["logo.png"]);
    assert.ok(stg.json.skipped.some((x) => x.title === "tool.exe"));
    assert.ok(stg.json.estimate.usd > 0 && stg.json.estimate.images === 1);
    assert.equal((await ledger(s)).length, before, "staging spends nothing");
    const libId = stg.json.libraryId;
    const att = (await s.api(`/libraries/attached?projectId=${pid}`)).json;
    assert.ok(att.ids.includes(libId), "the project's library is attached to its chats");
    assert.ok(!(await s.api("/libraries/attached?projectId=" + other)).json.ids.includes(libId), "not to another project's");

    // add: the click carries the estimate
    const no = await s.api(`/projectfiles/${pid}/add`, { method: "POST", body: { stageId: stg.json.stageId } });
    assert.equal(no.status, 409); assert.equal(no.json.code, "estimate_first");
    const add = await s.api(`/projectfiles/${pid}/add`, { method: "POST", body: { stageId: stg.json.stageId, estimate: stg.json.estimate.usd } });
    assert.equal(add.status, 202, add.text);
    assert.deepEqual(add.json.described, ["logo.png"]); assert.deepEqual(add.json.failed, []);
    assert.equal((await s.api(`/projectfiles/${pid}/add`, { method: "POST", body: { stageId: stg.json.stageId, estimate: 1 } })).status, 410, "a staged list is added once");
    const ov = await waitIndexed(s, pid);
    assert.deepEqual(ov.files.map((f) => f.title).sort(), ["logo.png", "pumps.md", "warranty.pdf"]);
    assert.equal(ov.files.find((f) => f.title === "logo.png").image, true);
    assert.match(ov.library.name, /^Project files: Fleet Co$/);

    // the image is in the project's files folder and was described by the demo AI, which got the picture
    assert.deepEqual(fs.readFileSync(path.join(s.dir, "projects", pid, "files", "logo.png")), PNG);
    const led = await ledger(s);
    const desc = led.filter((e) => e.role === "describe-image");
    assert.equal(desc.length, 1); assert.ok(desc[0].provider.startsWith("demo-") && desc[0].kind === "call");
    assert.ok(led.some((e) => e.role === "embed"), "embedding calls are in the ledger");
    assert.ok(!JSON.stringify(led).includes("ZX-4471") && !JSON.stringify(led).includes("logo.png"), "no file text or names in the ledger");
    const imgDoc = ov.files.find((f) => f.title === "logo.png");
    assert.equal((await s.api(`/projectfiles/${pid}/files/${imgDoc.id}/image`, { noToken: true })).status, 401);
    const img = await s.api(`/projectfiles/${pid}/files/${imgDoc.id}/image`);
    assert.equal(img.status, 200); assert.equal(img.headers["content-type"], "image/png"); assert.equal(img.headers["x-content-type-options"], "nosniff");

    // a chat in the project answers from its files, cited
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "What does the ZX-4471 pump cost?", provider: "demo-nova", model: "nova-lite", projectId: pid } })).status, 202);
    const c1 = await waitRun(s, (x) => x.kind === "single" && x.projectId === pid);
    assert.equal(c1.status, "done", c1.error);
    assert.equal(c1.librarySources[0].title, "pumps.md"); assert.equal(c1.librarySources[0].libraryId, libId);
    assert.match(c1.deliverable, /312 dollars[^\n]*\[L1\]/, "the answer cites [L1]");
    // and about the image, through its description
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Describe the logo.png picture", provider: "demo-nova", model: "nova-lite", projectId: pid } })).status, 202);
    const c2 = await waitRun(s, (x) => x.kind === "single" && x.projectId === pid && x.id !== c1.id);
    const src = c2.librarySources.find((x) => x.title === "logo.png");
    assert.ok(src, "the image's description is found");
    assert.match(src.snippet, /Demo description of logo\.png: a picture received as image\/png/, "the picture itself reached the model");
    // a chat in another project does not see these files
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "What does the ZX-4471 pump cost?", provider: "demo-nova", model: "nova-lite", projectId: other } })).status, 202);
    const c3 = await waitRun(s, (x) => x.kind === "single" && x.projectId === other);
    assert.deepEqual(c3.librarySources || [], []);

    // remove the image: its passages and file go
    const after = (await s.api(`/projectfiles/${pid}/files/${imgDoc.id}`, { method: "DELETE" })).json;
    assert.deepEqual(after.files.map((f) => f.title).sort(), ["pumps.md", "warranty.pdf"]);
    assert.ok(!fs.existsSync(path.join(s.dir, "projects", pid, "files", "logo.png")));
    assert.equal((await s.api(`/projectfiles/${pid}/files/${imgDoc.id}`, { method: "DELETE" })).status, 404);

    // demo off and no embedding key: a clear message, nothing read
    await s.api("/demo", { method: "POST", body: { on: false } });
    const third = (await s.api("/projects", { method: "POST", body: { name: "No Keys" } })).json.id;
    const nk = await s.api(`/projectfiles/${third}/stage`, { method: "POST", body: { files: [{ name: "a.txt", text: "hello" }] } });
    assert.equal(nk.status, 400); assert.equal(nk.json.code, "no_embedder"); assert.match(nk.json.error, /embedding key/);
  } finally { await s.stop(); }
});
