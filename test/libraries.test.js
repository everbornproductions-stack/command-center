// Phase 18: knowledge libraries (RAG). The running server in a temp data dir with the demo AIs and the demo
// embedder (a local mock, no real key or URL); Google Drive and Notion are a local mock server on a random port.
//  - a fixture folder is indexed with the mock embedder; every embedding call is in the ledger
//  - a question returns an answer citing the right chunk (single and council)
//  - keyword-only and vector-only queries both find their target
//  - a capped embedder is refused before any call; questions fall back to keyword search
//  - deleting a library removes its index
//  - Drive and Notion adapters ask for read-only access only, and only read
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import { startServer, ROOT, tmpDir, freePort } from "./helpers.js";

// the server modules are imported with a throwaway data folder (they create it on import), never data/
process.env.CC_DATA_DIR = tmpDir("cc-lib-unit-");
const { chunkText, terms } = await import("../server/libraries.js");
const { extract, docxText, pdfText, walkFolder } = await import("../server/library-extract.js");
const { notionAllowed, DRIVE_SCOPE } = await import("../server/library-sources.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = path.join(ROOT, "test", "fixtures", "library");

// a minimal .docx (zip with word/document.xml) and a text PDF with a compressed content stream
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const comp = zlib.deflateRawSync(data), nameBuf = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const DOCX = () => zip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }, { name: "word/document.xml", data: Buffer.from(`<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Refund policy</w:t></w:r></w:p><w:p><w:r><w:t>Customers can ask for a refund within 30 days &amp; keep the receipt.</w:t></w:r></w:p></w:body></w:document>`) }]);
const PDF = () => {
  const content = zlib.deflateSync(Buffer.from("BT /F1 12 Tf 72 712 Td (Invoice terms: payment is due within 14 days.) Tj 0 -14 Td [(Late) -250 (fees apply after that.)] TJ ET"));
  return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
};
function fixtureCopy() {
  const dir = tmpDir("cc-lib-fixture-");
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "refunds.docx"), DOCX());
  fs.writeFileSync(path.join(dir, "invoice-terms.pdf"), PDF());
  fs.writeFileSync(path.join(dir, "scanned.pdf"), Buffer.from("%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 4 >>\nstream\nABCD\nendstream\nendobj\n%%EOF\n", "latin1"));
  return dir;
}

test("libraries: chunking, extraction, folder walk, query terms (pure)", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} talks about topic ${i} with enough words to fill a line or two of text.`).join("\n\n");
  const chunks = chunkText(long, { size: 600, overlap: 100 });
  assert.ok(chunks.length > 3 && chunks.every((c) => c.length <= 760), "chunks stay near the size");
  assert.ok(chunks[1].includes("Paragraph") && long.includes(chunks[0].slice(0, 50)));
  assert.deepEqual(chunkText("   "), []);
  assert.match(docxText(DOCX()), /refund within 30 days & keep the receipt/);
  const pdf = pdfText(PDF());
  assert.match(pdf, /payment is due within 14 days/); assert.match(pdf, /Late fees apply/);
  assert.ok(extract("x.pdf", Buffer.from("%PDF-1.4\n%%EOF")).skipped, "a PDF without text is skipped");
  assert.ok(extract("a.exe", Buffer.from("MZ")).skipped);
  assert.match(extract("p.html", Buffer.from("<style>x{}</style><p>Hello <b>there</b></p>")).text, /Hello there/);
  const w = walkFolder(fixtureCopy());
  const rels = w.files.map((f) => f.rel).sort();
  assert.deepEqual(rels, ["handbook.md", "invoice-terms.pdf", "parts.csv", "policies/fleet.html", "refunds.docx", "scanned.pdf"]);
  assert.ok(!rels.some((r) => r.includes("hidden")), "hidden folders are never read");
  assert.ok(w.skipped.some((s) => s.path === "logo.png"));
  assert.deepEqual(terms("What is the price of the ZX-4471?"), ["price", "zx-4471"]);
});

test("libraries: Notion adapter allows read endpoints only; Drive scope is read-only", () => {
  assert.equal(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.readonly");
  assert.ok(notionAllowed("POST", "/v1/search"));
  assert.ok(notionAllowed("GET", "/v1/pages/abc-123"));
  assert.ok(notionAllowed("GET", "/v1/blocks/abc-123/children"));
  for (const [m, p] of [["PATCH", "/v1/pages/abc"], ["POST", "/v1/pages"], ["DELETE", "/v1/blocks/abc"], ["PATCH", "/v1/blocks/abc/children"], ["POST", "/v1/databases/abc/query"], ["POST", "/v1/comments"]]) assert.equal(notionAllowed(m, p), false, `${m} ${p} refused`);
});

async function waitJob(s, id, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = (await s.api(`/libraries/${id}`)).json; if (r.job && r.job.status !== "indexing") return r; if (!r.job && r.chunks) return r; await sleep(200); }
  throw new Error("indexing did not finish");
}
async function waitRun(s, kind, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const st = (await s.api("/state")).json; const m = st.missions.find((x) => x.kind === kind && (x.status === "done" || x.status === "failed")); if (m) return (await s.api(`/missions/${m.id}`)).json; await sleep(400); }
  throw new Error(`${kind} did not finish`);
}
const ledger = async (s) => (await s.api("/state")).json.ledger.recent;

test("libraries: index a fixture folder, cited answers, keyword and vector search, caps, delete", { timeout: 240000 }, async () => {
  const s = await startServer();
  const folder = fixtureCopy();
  try {
    assert.equal((await s.api("/libraries", { noToken: true })).status, 401, "session token required");
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const ov = (await s.api("/libraries")).json;
    assert.equal(ov.available, true);
    const emb = ov.embedders.find((e) => e.provider === "demo-nova" && e.model === "nova-embed");
    assert.ok(emb && emb.keyed, "the demo embedder is offered in demo mode");

    // create
    assert.equal((await s.api("/libraries", { method: "POST", body: { name: "", provider: "demo-nova", model: "nova-embed" } })).status, 400);
    assert.equal((await s.api("/libraries", { method: "POST", body: { name: "X", provider: "demo-nova", model: "nope" } })).status, 400);
    const lib = (await s.api("/libraries", { method: "POST", body: { name: "Handbook", provider: "demo-nova", model: "nova-embed" } })).json;
    assert.match(lib.id, /^lib-[a-f0-9]{12}$/);
    assert.equal((await s.api("/libraries", { method: "POST", body: { name: "handbook", provider: "demo-nova", model: "nova-embed" } })).status, 409, "names are unique");
    const file = path.join(s.dir, "libraries", `${lib.id}.sqlite`);
    assert.ok(fs.existsSync(file), "the index file is in the app data folder");

    // stage: read, chunk, estimate; nothing spent
    const before = (await ledger(s)).length;
    const stg = await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "folder", path: folder } });
    assert.equal(stg.status, 200, stg.text);
    const titles = stg.json.files.map((f) => f.title).sort();
    assert.deepEqual(titles, ["handbook.md", "invoice-terms.pdf", "parts.csv", "policies/fleet.html", "refunds.docx"]);
    assert.ok(stg.json.skipped.some((x) => x.title === "logo.png") && stg.json.skipped.some((x) => x.title === "scanned.pdf"), "unsupported and text-less files are skipped with a reason");
    assert.ok(stg.json.estimate.cost > 0 && stg.json.estimate.tokens > 0 && stg.json.estimate.calls >= 1);
    assert.equal((await ledger(s)).length, before, "staging spends nothing");
    assert.equal((await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "folder", path: path.join(folder, "nope") } })).status, 404);

    // index: every embedding call in the ledger
    const ix = await s.api(`/libraries/${lib.id}/index`, { method: "POST", body: { stageId: stg.json.stageId } });
    assert.equal(ix.status, 202, ix.text);
    const done = await waitJob(s, lib.id);
    assert.equal(done.job.status, "done", done.job.error);
    assert.equal(done.docs, 5); assert.ok(done.chunks >= 5);
    assert.equal((await s.api(`/libraries/${lib.id}/index`, { method: "POST", body: { stageId: stg.json.stageId } })).status, 410, "a staged list indexes once");
    const embeds = (await ledger(s)).filter((e) => e.role === "embed");
    assert.equal(embeds.length, done.job.calls);
    assert.ok(embeds.every((e) => e.kind === "call" && e.provider === "demo-nova" && e.model === "nova-embed" && e.inTok > 0 && e.cost > 0));
    assert.equal(+embeds.reduce((a, e) => a + e.cost, 0).toFixed(9), done.job.cost);
    assert.ok(!JSON.stringify(embeds).includes("vacation"), "no text in the ledger");
    // the same folder again: nothing new
    const again = (await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "folder", path: folder } })).json;
    assert.equal(again.files.length, 0); assert.ok(again.skipped.filter((x) => /unchanged/.test(x.reason)).length === 5);

    // keyword-only and vector-only both find their target
    const kw = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "ZX-4471", mode: "keyword" })}`)).json;
    assert.equal(kw.mode, "keyword"); assert.equal(kw.results[0]?.title, "parts.csv"); assert.equal(kw.cost, 0, "keyword search is free");
    const vec = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "car upkeep", mode: "vector" })}`)).json;
    assert.equal(vec.mode, "vector"); assert.equal(vec.results[0]?.title, "policies/fleet.html", "meaning search finds 'automobile' for 'car'"); assert.ok(vec.cost > 0);
    const kwMiss = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "car upkeep", mode: "keyword" })}`)).json;
    assert.ok(!kwMiss.results.some((r) => r.title === "policies/fleet.html"), "keywords alone cannot find it");
    const hyb = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "refund receipt days" })}`)).json;
    assert.equal(hyb.mode, "hybrid"); assert.equal(hyb.results[0]?.title, "refunds.docx"); assert.ok(hyb.results[0].keyword && hyb.results[0].vector);
    const pdfHit = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "when is payment due", mode: "keyword" })}`)).json;
    assert.equal(pdfHit.results[0]?.title, "invoice-terms.pdf");

    // attach to the chat (no project) and ask: the answer cites the right chunk
    assert.equal((await s.api("/libraries/attach", { method: "POST", body: { libraryId: lib.id, scope: "nope", target: "_", on: true } })).status, 400);
    assert.equal((await s.api("/libraries/attach", { method: "POST", body: { libraryId: lib.id, scope: "chat", target: "_", on: true } })).status, 200);
    const att = (await s.api("/libraries/attached")).json;
    assert.deepEqual(att.ids, [lib.id]); assert.equal(att.libraries[0].chat, true);
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "How many vacation days do full-time staff get?" } })).status, 202);
    const chat = await waitRun(s, "single");
    assert.equal(chat.status, "done", chat.error);
    assert.equal(chat.librarySources[0].title, "handbook.md");
    assert.match(chat.librarySources[0].snippet, /25 days of paid vacation/);
    assert.equal(chat.librarySources[0].n, "L1"); assert.equal(chat.librarySources[0].libraryId, lib.id);
    assert.match(chat.deliverable, /25 days of paid vacation[^\n]*\[L1\]/, "the answer cites [L1]");
    assert.ok(!("text" in chat.librarySources[0]), "the run keeps a snippet, not the full passage");
    assert.ok((await ledger(s)).some((e) => e.role === "embed-query" && e.missionId === chat.id), "the question's embedding is in the ledger under the run");
    // a council uses the same excerpts
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "What is in the fleet rules about servicing a company car?", lite: true } })).status, 202);
    const council = await waitRun(s, "council", 180000);
    assert.ok(council.librarySources.some((x) => x.title === "policies/fleet.html"), "council has the library sources");

    // spend cap: indexing refused before any call; questions fall back to keyword search
    const cap = await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-nova": 0.000001 } } });
    assert.ok(cap.json.stop.includes("demo-nova"));
    const ov2 = (await s.api("/libraries")).json;
    assert.equal(ov2.embedders.find((e) => e.model === "nova-embed").capped, true);
    fs.writeFileSync(path.join(folder, "extra.txt"), "Parking is free for visitors on weekends.");
    const stg2 = (await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "folder", path: folder } })).json;
    assert.equal(stg2.files.length, 1); assert.equal(stg2.estimate.capped, true);
    const n0 = (await ledger(s)).length;
    const refused = await s.api(`/libraries/${lib.id}/index`, { method: "POST", body: { stageId: stg2.stageId } });
    assert.equal(refused.status, 402); assert.match(refused.json.error, /spend cap/);
    const fb = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "ZX-4471 gasket" })}`)).json;
    assert.equal(fb.mode, "keyword"); assert.match(fb.note, /Keyword search only.*spend cap/); assert.equal(fb.results[0]?.title, "parts.csv");
    assert.equal((await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "car", mode: "vector" })}`)).status, 402);
    assert.equal((await ledger(s)).length, n0, "a capped embedder is never called");
    await s.api("/alerts/caps", { method: "POST", body: { caps: {} } });

    // remove one document
    const det = (await s.api(`/libraries/${lib.id}`)).json;
    const parts = det.documents.find((d) => d.title === "parts.csv");
    assert.equal((await s.api(`/libraries/${lib.id}/docs/${parts.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "ZX-4471", mode: "keyword" })}`)).json.results.length, 0);

    // deleting a library removes its index and its attachments
    const del = await s.api(`/libraries/${lib.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(file), "the index file is gone");
    assert.equal((await s.api(`/libraries/${lib.id}`)).status, 404);
    assert.equal((await s.api("/libraries")).json.libraries.length, 0);
    assert.deepEqual((await s.api("/libraries/attached")).json.ids, []);
    assert.equal((await s.api(`/libraries/${lib.id}/search?q=x`)).status, 404);
  } finally { await s.stop(); fs.rmSync(folder, { recursive: true, force: true }); }
});

// ---------- Google Drive and Notion: a local mock of both ----------
async function mockSources() {
  const port = await freePort();
  const hits = [];
  const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    // Google sign-in
    if (url.pathname === "/token") {
      const f = new URLSearchParams(body);
      if (f.get("code") === "wide") return json(res, 200, { access_token: "g-wide-token", expires_in: 3600, scope: `${"https://www.googleapis.com/auth/drive"} ${"https://www.googleapis.com/auth/drive.readonly"}` });
      return json(res, 200, { access_token: "g-access-SECRET", refresh_token: "g-refresh-SECRET", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.readonly" });
    }
    // Drive (GET only expected)
    if (url.pathname === "/drive/v3/files" && !url.searchParams.get("q")?.includes("'fold1abc' in parents")) return json(res, 200, { files: [{ id: "gdoc12345", name: "Onboarding guide", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/gdoc12345/edit" }, { id: "fold1abc", name: "Policies", mimeType: "application/vnd.google-apps.folder" }] });
    if (url.pathname === "/drive/v3/files" ) return json(res, 200, { files: [{ id: "txt98765", name: "dress-code.txt", mimeType: "text/plain" }] });
    if (url.pathname === "/drive/v3/files/gdoc12345") return json(res, 200, { id: "gdoc12345", name: "Onboarding guide", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/gdoc12345/edit" });
    if (url.pathname === "/drive/v3/files/gdoc12345/export") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("New starters get a laptop and a badge on their first morning. The welcome lunch is on Friday."); }
    if (url.pathname === "/drive/v3/files/fold1abc") return json(res, 200, { id: "fold1abc", name: "Policies", mimeType: "application/vnd.google-apps.folder" });
    if (url.pathname === "/drive/v3/files/txt98765" && url.searchParams.get("alt") === "media") { res.writeHead(200); return res.end("Dress code: smart casual, no flip-flops in the warehouse."); }
    if (url.pathname === "/drive/v3/files/txt98765") return json(res, 200, { id: "txt98765", name: "dress-code.txt", mimeType: "text/plain", size: "60", webViewLink: "https://drive.google.com/file/d/txt98765/view" });
    // Notion
    if (url.pathname === "/v1/oauth/token") return json(res, 200, { access_token: "n-access-SECRET", workspace_name: "Acme (fake)", bot_id: "b1" });
    if (url.pathname === "/v1/search") return json(res, 200, { results: [{ object: "page", id: "page-0001-aaaa", url: "https://www.notion.so/page-0001", last_edited_time: "2026-10-01T00:00:00.000Z", properties: { Name: { type: "title", title: [{ plain_text: "Expense rules" }] } } }] });
    if (url.pathname === "/v1/pages/page-0001-aaaa") return json(res, 200, { object: "page", id: "page-0001-aaaa", url: "https://www.notion.so/page-0001", properties: { Name: { type: "title", title: [{ plain_text: "Expense rules" }] } } });
    if (url.pathname === "/v1/blocks/page-0001-aaaa/children") return json(res, 200, { results: [{ id: "b-1", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Meals" }] } }, { id: "b-2", type: "paragraph", has_children: true, paragraph: { rich_text: [{ plain_text: "Client dinners are reimbursed up to the limit below." }] } }], has_more: false });
    if (url.pathname === "/v1/blocks/b-2/children") return json(res, 200, { results: [{ id: "b-3", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Receipts must be uploaded within a week." }] } }], has_more: false });
    json(res, 404, { message: "mock: no route" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

test("libraries: Google Drive and Notion through read-only OAuth (mocked)", { timeout: 120000 }, async () => {
  const mock = await mockSources();
  const s = await startServer({ env: { CC_GOOGLE_AUTH_URL: mock.url, CC_GOOGLE_TOKEN_URL: mock.url, CC_DRIVE_API_URL: mock.url, CC_NOTION_API_URL: mock.url } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const lib = (await s.api("/libraries", { method: "POST", body: { name: "Shared docs", provider: "demo-nova", model: "nova-embed" } })).json;

    // ---- Google: drive.readonly only ----
    assert.equal((await s.api("/libraries/google/start", { method: "POST", body: { origin: s.base } })).status, 400, "no client yet");
    assert.equal((await s.api("/libraries/google/client", { method: "POST", body: { clientId: "1234-test.apps.googleusercontent.com", clientSecret: "GOCSPX-test-SECRET" } })).status, 200);
    const gs = (await s.api("/libraries/google/start", { method: "POST", body: { origin: s.base } })).json;
    const gu = new URL(gs.url);
    assert.equal(gu.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.readonly", "only drive.readonly is asked for");
    assert.equal(gu.searchParams.get("code_challenge_method"), "S256");
    assert.equal(gu.searchParams.get("redirect_uri"), `${s.base}/`);
    assert.match(gu.searchParams.get("state"), /^lib-g-/);
    // a wider grant is refused and nothing is kept
    const wide = await s.api("/libraries/google/finish", { method: "POST", body: { code: "wide", state: gu.searchParams.get("state") } });
    assert.equal(wide.status, 400); assert.match(wide.json.error, /read-only/);
    assert.equal((await s.api("/libraries/google")).json.connected, false);
    const gs2 = new URL((await s.api("/libraries/google/start", { method: "POST", body: { origin: s.base } })).json.url);
    const fin = await s.api("/libraries/google/finish", { method: "POST", body: { code: "good", state: gs2.searchParams.get("state") } });
    assert.equal(fin.status, 200, fin.text); assert.equal(fin.json.connected, true);
    assert.equal((await s.api("/libraries/google/finish", { method: "POST", body: { code: "good", state: gs2.searchParams.get("state") } })).status, 400, "a state is single use");
    const tokenHit = mock.hits.filter((x) => x.path === "/token").at(-1);
    assert.equal(new URLSearchParams(tokenHit.body).get("code_verifier")?.length > 40, true, "PKCE verifier sent");
    const files = (await s.api("/libraries/google/files")).json.files;
    assert.deepEqual(files.map((f) => f.name), ["Onboarding guide", "Policies"]);
    const gst = await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "drive", ids: ["gdoc12345", "fold1abc"] } });
    assert.equal(gst.status, 200, gst.text);
    assert.deepEqual(gst.json.files.map((f) => f.title).sort(), ["Onboarding guide", "dress-code.txt"], "a picked folder brings its files");
    const driveHits = mock.hits.filter((x) => x.path.startsWith("/drive/"));
    assert.ok(driveHits.length >= 5 && driveHits.every((x) => x.method === "GET"), "Drive is only ever read");
    assert.ok(driveHits.every((x) => x.headers.authorization === "Bearer g-access-SECRET"));

    // ---- Notion: no scopes in the link, read endpoints only ----
    await s.api("/libraries/notion/client", { method: "POST", body: { clientId: "notion-client-0001", clientSecret: "secret_notion_SECRET" } });
    const nu = new URL((await s.api("/libraries/notion/start", { method: "POST", body: { origin: s.base } })).json.url);
    assert.equal(nu.pathname, "/v1/oauth/authorize"); assert.equal(nu.searchParams.get("owner"), "user"); assert.equal(nu.searchParams.get("scope"), null);
    const nf = await s.api("/libraries/notion/finish", { method: "POST", body: { code: "n-code", state: nu.searchParams.get("state") } });
    assert.equal(nf.status, 200, nf.text); assert.equal(nf.json.workspace, "Acme (fake)");
    const tok = mock.hits.find((x) => x.path === "/v1/oauth/token");
    assert.equal(tok.headers.authorization, `Basic ${Buffer.from("notion-client-0001:secret_notion_SECRET").toString("base64")}`);
    const pages = (await s.api("/libraries/notion/pages?q=expense")).json.pages;
    assert.deepEqual(pages.map((p) => p.name), ["Expense rules"]);
    const nst = await s.api(`/libraries/${lib.id}/stage`, { method: "POST", body: { kind: "notion", ids: ["page-0001-aaaa"], stageId: gst.json.stageId } });
    assert.equal(nst.status, 200, nst.text);
    assert.equal(nst.json.files.length, 3, "Drive and Notion items in one list");
    const notionHits = mock.hits.filter((x) => x.path.startsWith("/v1/") && x.path !== "/v1/oauth/token");
    assert.ok(notionHits.every((x) => notionAllowed(x.method, x.path)), `Notion is only read: ${notionHits.map((x) => `${x.method} ${x.path}`).join(", ")}`);
    assert.ok(notionHits.every((x) => x.headers["notion-version"]));

    // index and find them; Drive results link back to Drive
    assert.equal((await s.api(`/libraries/${lib.id}/index`, { method: "POST", body: { stageId: nst.json.stageId } })).status, 202);
    const done = await waitJob(s, lib.id);
    assert.equal(done.job.status, "done", done.job.error);
    const hit = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "laptop badge first morning" })}`)).json.results[0];
    assert.equal(hit.title, "Onboarding guide"); assert.equal(hit.source, "drive"); assert.equal(hit.url, "https://docs.google.com/document/d/gdoc12345/edit");
    const nhit = (await s.api(`/libraries/${lib.id}/search?${new URLSearchParams({ q: "receipts uploaded within a week", mode: "keyword" })}`)).json.results[0];
    assert.equal(nhit.title, "Expense rules"); assert.match(nhit.text, /Receipts must be uploaded/);

    // secrets and tokens never reach the browser
    const all = JSON.stringify([(await s.api("/libraries")).json, (await s.api("/libraries/google")).json, (await s.api("/libraries/notion")).json, (await s.api("/state")).json]);
    for (const secret of ["GOCSPX-test-SECRET", "g-access-SECRET", "g-refresh-SECRET", "secret_notion_SECRET", "n-access-SECRET"]) assert.ok(!all.includes(secret), `${secret} not sent to the browser`);
    // disconnect removes the tokens
    assert.equal((await s.api("/libraries/notion", { method: "DELETE" })).json.connected, false);
    assert.equal((await s.api("/libraries/notion/pages")).status, 400);
  } finally { await s.stop(); await mock.close(); }
});

test("Phase 18 files: no em-dashes in user-facing text", () => {
  for (const f of ["server/libraries.js", "server/library-extract.js", "server/library-sources.js", "server/plugins/libraries.js", "web/features/libraries.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
