// Phase 21: image generation in chat. The running server in a temp data dir; OpenAI, Google Gemini, xAI,
// Replicate and fal are one local mock server on a random port (CC_BASE_URL_<ID>), with made-up keys from the
// environment. No real key or URL is used.
//  - each provider's mock returns an image that is saved to the gallery with its prompt, one ledger line per image
//  - edit and variation requests carry the source image (gallery image or upload)
//  - the estimate comes first; a provider at its cap (or one a batch would push over it) is refused before any call
//  - no key means a clear "add a key" message; demo mode draws a free local sketch
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, tmpDir, freePort } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-img-unit-");
for (const k of ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY"]) delete process.env[k]; // the pure test must not see a real key
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
const { estimate, demoSvg, IMAGE_PROVIDERS, VARIATION_PROMPT } = await import("../server/images.js");

// a real 1x1 PNG and a JPEG-looking blob, so the bytes can be compared end to end
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body")]);
const KEYS = { openai: "sk-test-openai-000", google: "AIza-test-google-000", xai: "xai-test-000", replicate: "r8_test_000", fal: "fal-test:000" };

async function mocks() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const hits = [];
  const behave = {}; // provider -> HTTP status to answer with
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const u = new URL(req.url, base);
    const prov = u.pathname.split("/")[1];
    let body = null; try { body = JSON.parse(raw.toString("utf8")); } catch {}
    hits.push({ prov, method: req.method, path: u.pathname, search: u.search, headers: req.headers, body, raw });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && u.pathname.endsWith("/models")) return send(200, { data: [{ id: "gpt-5" }] });
    if (behave[prov]) return send(behave[prov], { error: { message: "mock refusal" } });
    if (prov === "files") { res.writeHead(200, { "content-type": u.pathname.endsWith(".jpg") ? "image/jpeg" : "image/png" }); return res.end(u.pathname.endsWith(".jpg") ? JPG : PNG); }
    if (prov === "openai" && /\/images\/(generations|edits)$/.test(u.pathname)) {
      const n = body?.n || Number((raw.toString("latin1").match(/name="n"\r\n\r\n(\d+)/) || [])[1]) || 1;
      return send(200, { created: 1, data: Array.from({ length: n }, () => ({ b64_json: PNG.toString("base64") })) });
    }
    if (prov === "xai" && u.pathname.endsWith("/images/generations")) return send(200, { data: Array.from({ length: body.n || 1 }, () => ({ b64_json: JPG.toString("base64") })) });
    if (prov === "google" && u.pathname.endsWith(":generateContent")) return send(200, { candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] });
    if (prov === "replicate" && req.method === "POST" && u.pathname.endsWith("/predictions")) return send(201, { id: "p1", status: "starting", urls: { get: `${base}/replicate/v1/predictions/p1` } });
    if (prov === "replicate" && req.method === "GET" && u.pathname.endsWith("/predictions/p1")) return send(200, { id: "p1", status: "succeeded", output: [`${base}/files/out.png`] });
    if (prov === "fal") return send(200, { images: Array.from({ length: body.num_images || 1 }, () => ({ url: `${base}/files/fal.jpg` })) });
    send(404, { error: "mock: no route" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  // Background health checks GET /models. On Windows those land after the test's baseline.
  // They are not image calls. since() is still the raw hit count (used as a slice index below).
  const imageCalls = () => hits.filter((h) => !h.path.endsWith("/models")).length;
  return { base, hits, behave, since: () => hits.length, imageCalls, close: () => new Promise((r) => server.close(r)) };
}

const env = (m, keys = true) => ({
  CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
  CC_BASE_URL_OPENAI: `${m.base}/openai/v1`, CC_BASE_URL_GOOGLE: `${m.base}/google/v1beta/openai`, CC_BASE_URL_XAI: `${m.base}/xai/v1`,
  CC_BASE_URL_REPLICATE: `${m.base}/replicate/v1`, CC_BASE_URL_FAL: `${m.base}/fal`,
  OPENAI_API_KEY: keys ? KEYS.openai : "", GEMINI_API_KEY: keys ? KEYS.google : "", XAI_API_KEY: keys ? KEYS.xai : "", REPLICATE_API_TOKEN: keys ? KEYS.replicate : "", FAL_KEY: keys ? KEYS.fal : "",
  ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "", GROQ_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "",
});

// estimate, then make: the generate call repeats the price it was shown
async function make(s, body) {
  const est = await s.api("/images/estimate", { method: "POST", body });
  assert.equal(est.status, 200, JSON.stringify(est.json));
  return s.api("/images", { method: "POST", body: { ...body, estimate: est.json.usd } });
}
const imageLines = async (s) => (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "image");

test("images: estimates, model choice and the demo sketch (pure)", () => {
  const e = estimate({ provider: "openai", n: 2, quality: "high", size: "portrait" });
  assert.equal(e.perImage, 0.25); assert.equal(e.usd, 0.5); assert.equal(e.model, "gpt-image-1"); assert.equal(e.keyed, false);
  assert.match(e.keyMessage, /Add your OpenAI key in Settings > AI keys/);
  assert.equal(estimate({ provider: "replicate", op: "edit" }).model, "black-forest-labs/flux-kontext-pro", "Replicate edits go through Kontext");
  assert.equal(estimate({ provider: "fal", op: "variation", model: "fal-ai/flux/dev" }).model, "fal-ai/flux-pro/kontext");
  assert.equal(estimate({ provider: "google" }).usd, 0.039);
  assert.throws(() => estimate({ provider: "xai", op: "edit" }), /new images only/);
  assert.throws(() => estimate({ provider: "openai", n: 9 }), /1 to 4/);
  assert.throws(() => estimate({ provider: "openai", model: "dall-e-9" }), /no image model/);
  assert.throws(() => estimate({ provider: "midjourney" }), /Pick an image provider/);
  assert.throws(() => estimate({ provider: "demo-image" }), /demo mode/);
  const svg = demoSvg({ prompt: `<script>alert("x")</script> & cats`, op: "generate", size: "square" });
  assert.ok(!svg.includes("<script>") && svg.includes("&lt;script&gt;") && svg.includes("&amp; cats"), "the prompt is escaped in the sketch");
  for (const p of Object.values(IMAGE_PROVIDERS)) for (const t of [p.name, p.keyName, p.where]) assert.ok(!/—/.test(t), "no em-dashes");
});

test("server: each provider makes images into the gallery with the prompt; edits and variations carry the source; estimate first; caps; key errors; delete", async () => {
  const m = await mocks();
  const s = await startServer({ env: env(m) });
  try {
    assert.equal((await s.api("/images/providers", { noToken: true })).status, 401, "session token required");
    assert.ok((await s.api("/state")).json.plugins.includes("images"), "the plugin is mounted");
    const pv = (await s.api("/images/providers")).json.items;
    assert.deepEqual(pv.map((p) => p.id), ["openai", "google", "xai", "replicate", "fal"], "demo images only in demo mode");
    assert.ok(pv.every((p) => p.keyed), "all keyed from the test environment");

    // the estimate comes first: none, or a lower one, is refused with the current figure and nothing is called
    let from = m.imageCalls();
    let r = await s.api("/images", { method: "POST", body: { provider: "openai", prompt: "A red bicycle", n: 2 } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "estimate_first"); assert.equal(r.json.estimate.usd, 0.084);
    r = await s.api("/images", { method: "POST", body: { provider: "openai", prompt: "A red bicycle", n: 2, estimate: 0.01 } });
    assert.equal(r.status, 409);
    assert.equal(m.imageCalls(), from, "no provider call before the price is seen");
    assert.equal((await s.api("/images", { method: "POST", body: { provider: "openai", prompt: "  ", estimate: 1 } })).status, 400, "a prompt is needed");

    // 1. OpenAI: two images, both in the gallery, one ledger line each
    r = await make(s, { provider: "openai", prompt: "A red bicycle on a beach", n: 2, projectId: "p-bikes" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const oa = r.json;
    assert.equal(oa.params.prompt, "A red bicycle on a beach"); assert.equal(oa.files.length, 2); assert.equal(oa.cost, 0.084); assert.equal(oa.kind, "image");
    let hit = m.hits.findLast((h) => h.prov === "openai" && h.path.endsWith("/images/generations"));
    assert.equal(hit.headers.authorization, `Bearer ${KEYS.openai}`); assert.equal(hit.body.model, "gpt-image-1"); assert.equal(hit.body.n, 2); assert.equal(hit.body.size, "1024x1024");
    const file = await s.raw({ path: `/api/images/${oa.id}/file?i=1`, headers: { "x-cc-token": s.token } });
    assert.equal(file.status, 200); assert.equal(file.headers["content-type"], "image/png"); assert.equal(file.headers["x-content-type-options"], "nosniff");
    assert.equal((await s.raw({ path: `/api/images/${oa.id}/file` })).status, 401, "files need the token too");
    let lines = await imageLines(s);
    assert.equal(lines.filter((e) => e.provider === "openai").length, 2, "one ledger line per image");
    assert.ok(lines.every((e) => e.cost === 0.042 && !JSON.stringify(e).includes("bicycle")), "priced per image, no prompt text in the ledger");
    let gallery = (await s.api("/images")).json.items;
    assert.equal(gallery[0].id, oa.id); assert.equal((await s.api("/images?projectId=p-bikes")).json.items.length, 1);
    const mediaJobs = (await s.api("/media/jobs")).json;
    assert.ok(mediaJobs.some((j) => j.id === oa.id && j.kind === "image" && j.status === "done"), "listed in the Media tab's gallery too");

    // 2. OpenAI edit of a gallery image: multipart with the source picture
    r = await make(s, { provider: "openai", op: "edit", prompt: "Make the bicycle blue", source: { imageId: oa.id, index: 0 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    hit = m.hits.findLast((h) => h.prov === "openai" && h.path.endsWith("/images/edits"));
    assert.match(hit.headers["content-type"], /multipart\/form-data/);
    assert.ok(hit.raw.includes(PNG) && hit.raw.toString("latin1").includes('name="image[]"'), "the edit carries the source image");
    assert.deepEqual(r.json.params.from, { imageId: oa.id, index: 0 });
    assert.equal((await s.api("/images", { method: "POST", body: { provider: "openai", op: "edit", prompt: "x", estimate: 1 } })).json.error.includes("source image"), true, "an edit without a source is refused");

    // 3. Gemini variation of an upload: inline data, the key in a header (never the URL), the default variation prompt
    const upload = { dataUrl: `data:image/jpeg;base64,${JPG.toString("base64")}`, name: "shop.jpg" };
    r = await make(s, { provider: "google", op: "variation", source: upload, size: "landscape" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    hit = m.hits.findLast((h) => h.prov === "google");
    assert.equal(hit.path, "/google/v1beta/models/gemini-2.5-flash-image:generateContent");
    assert.equal(hit.headers["x-goog-api-key"], KEYS.google); assert.ok(!hit.search.includes(KEYS.google) && !hit.path.includes(KEYS.google));
    const parts = hit.body.contents[0].parts;
    assert.equal(parts[0].text, VARIATION_PROMPT); assert.equal(parts[1].inline_data.data, JPG.toString("base64")); assert.equal(parts[1].inline_data.mime_type, "image/jpeg");
    assert.equal(hit.body.generationConfig.imageConfig.aspectRatio, "3:2");
    assert.equal(r.json.params.prompt, VARIATION_PROMPT); assert.equal(r.json.params.from.upload, "shop.jpg");

    // 4. xAI: new images only
    r = await make(s, { provider: "xai", prompt: "A lighthouse at dusk" });
    assert.equal(r.status, 200); assert.equal(r.json.files[0].mime, "image/jpeg");
    assert.equal(m.hits.findLast((h) => h.prov === "xai").body.response_format, "b64_json");
    assert.equal((await s.api("/images/estimate", { method: "POST", body: { provider: "xai", op: "edit" } })).status, 400);

    // 5. Replicate: generate (poll, then download), and an edit through Kontext with the source as a data URL
    r = await make(s, { provider: "replicate", prompt: "A paper crane", size: "portrait" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    hit = m.hits.findLast((h) => h.prov === "replicate" && h.method === "POST");
    assert.equal(hit.path, "/replicate/v1/models/black-forest-labs/flux-schnell/predictions"); assert.equal(hit.body.input.aspect_ratio, "2:3"); assert.equal(hit.headers.authorization, `Bearer ${KEYS.replicate}`);
    assert.ok(m.hits.some((h) => h.path === "/replicate/v1/predictions/p1"), "polled until done");
    r = await make(s, { provider: "replicate", op: "edit", prompt: "Gold paper", source: { imageId: oa.id } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    hit = m.hits.findLast((h) => h.prov === "replicate" && h.method === "POST");
    assert.equal(hit.path, "/replicate/v1/models/black-forest-labs/flux-kontext-pro/predictions");
    assert.equal(hit.body.input.input_image, `data:image/png;base64,${PNG.toString("base64")}`, "the edit carries the source image");

    // 6. fal: generate, and a variation with image_url
    r = await make(s, { provider: "fal", prompt: "A neon sign", n: 2 });
    assert.equal(r.status, 200); assert.equal(r.json.files.length, 2);
    hit = m.hits.findLast((h) => h.prov === "fal");
    assert.equal(hit.path, "/fal/fal-ai/flux/dev"); assert.equal(hit.headers.authorization, `Key ${KEYS.fal}`); assert.equal(hit.body.num_images, 2);
    r = await make(s, { provider: "fal", op: "variation", source: upload });
    assert.equal(r.status, 200);
    hit = m.hits.findLast((h) => h.prov === "fal");
    assert.equal(hit.path, "/fal/fal-ai/flux-pro/kontext"); assert.equal(hit.body.image_url, upload.dataUrl);

    lines = await imageLines(s);
    for (const [pid, count] of Object.entries({ openai: 3, google: 1, xai: 1, replicate: 2, fal: 3 })) assert.equal(lines.filter((e) => e.provider === pid).length, count, `${pid} ledger lines`);
    assert.equal((await s.api("/images")).json.items.length, 8, "every batch is in the gallery");

    // 7. spend caps: a provider at its cap is refused before any call; so is a batch that would cross it
    await s.api("/alerts/caps", { method: "POST", body: { caps: { openai: 0.05, xai: 0.1 } } });
    from = m.imageCalls();
    r = await s.api("/images", { method: "POST", body: { provider: "openai", prompt: "One more", estimate: 1 } });
    assert.equal(r.status, 402); assert.equal(r.json.code, "capped"); assert.match(r.json.error, /monthly spend cap/);
    assert.equal((await s.api("/images/estimate", { method: "POST", body: { provider: "openai" } })).json.capped, true);
    const xe = (await s.api("/images/estimate", { method: "POST", body: { provider: "xai" } })).json;
    assert.equal(xe.wouldExceed, true, "0.07 spent + 0.07 more is over a 0.10 cap"); assert.equal(xe.capLeft, 0.03);
    r = await s.api("/images", { method: "POST", body: { provider: "xai", prompt: "Another lighthouse", estimate: 1 } });
    assert.equal(r.status, 402); assert.match(r.json.error, /would take xAI Grok over its monthly spend cap/);
    assert.equal(m.imageCalls(), from, "no provider call when capped");
    assert.equal((await s.api("/alerts/state")).json.stop.includes("openai"), true, "the alerts plugin sees image spend");
    await s.api("/alerts/caps", { method: "POST", body: { caps: {} } });

    // 8. provider errors read clearly and save nothing
    m.behave.google = 401;
    r = await make(s, { provider: "google", prompt: "A cat" });
    assert.equal(r.status, 502); assert.match(r.json.error, /^Key rejected \(401\)/);
    m.behave.fal = 429;
    r = await make(s, { provider: "fal", prompt: "A dog" });
    assert.match(r.json.error, /rate limited or out of quota/);
    delete m.behave.google; delete m.behave.fal;
    assert.equal((await s.api("/images")).json.items.length, 8, "failed calls add nothing to the gallery");
    assert.equal((await imageLines(s)).length, 10, "and nothing to the ledger");

    // 9. delete removes the row and its files
    assert.equal((await s.api(`/images/${oa.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/images/${oa.id}`)).status, 404);
    assert.equal((await s.raw({ path: `/api/images/${oa.id}/file`, headers: { "x-cc-token": s.token } })).status, 404);
    assert.equal((await s.api("/images", { method: "POST", body: { provider: "openai", op: "edit", prompt: "x", source: { imageId: oa.id }, estimate: 1 } })).status, 404, "a deleted source is gone");
  } finally { await s.stop(); await m.close(); }
});

test("server: no key means a clear add-a-key message and no call; demo mode draws a free sketch", async () => {
  const m = await mocks();
  const s = await startServer({ env: env(m, false) });
  try {
    const from = m.since();
    for (const [pid, where] of [["openai", "Settings > AI keys"], ["google", "Settings > AI keys"], ["xai", "Settings > AI keys"], ["replicate", "Settings > Media"], ["fal", "Settings > Media"]]) {
      const est = (await s.api("/images/estimate", { method: "POST", body: { provider: pid } })).json;
      assert.equal(est.keyed, false, pid);
      const r = await s.api("/images", { method: "POST", body: { provider: pid, prompt: "A tree", estimate: est.usd } });
      assert.equal(r.status, 400, pid); assert.equal(r.json.code, "no_key");
      assert.ok(r.json.error.startsWith("No ") && r.json.error.includes(`key in ${where}`), r.json.error);
    }
    assert.equal(m.hits.slice(from).filter((h) => !h.path.endsWith("/models")).length, 0, "nothing was called");
    // a saved Replicate key (the vault) turns it on
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "replicate", key: KEYS.replicate } })).status, 200);
    assert.equal((await s.api("/images/providers")).json.items.find((p) => p.id === "replicate").keyed, true);

    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    assert.ok((await s.api("/images/providers")).json.items.some((p) => p.id === "demo-image"));
    let r = await make(s, { provider: "demo-image", prompt: "A <b>bold</b> bakery sign", n: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.cost, 0); assert.equal(r.json.demo, true); assert.equal(r.json.files[0].mime, "image/svg+xml");
    const f = await s.raw({ path: `/api/images/${r.json.id}/file`, headers: { "x-cc-token": s.token } });
    assert.match(f.text, /^<svg/); assert.ok(f.text.includes("&lt;b&gt;bold") && !f.text.includes("<b>"));
    assert.match(f.headers["content-security-policy"], /sandbox/);
    const v = await make(s, { provider: "demo-image", op: "variation", source: { dataUrl: `data:image/png;base64,${PNG.toString("base64")}` } });
    assert.equal(v.status, 200);
    assert.equal((await s.api("/images", { method: "POST", body: { provider: "demo-image", op: "edit", prompt: "x", source: { imageId: r.json.id }, estimate: 0 } })).status, 400, "a demo sketch is not a source image");
    assert.equal((await s.api("/images", { method: "POST", body: { provider: "demo-image", op: "edit", prompt: "x", source: { dataUrl: "data:text/html;base64,PGgxPg==" }, estimate: 0 } })).status, 400, "only pictures are accepted as a source");
  } finally { await s.stop(); await m.close(); }
});
