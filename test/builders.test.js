// Guided builders. Pure checks run in this process. The HTTP checks use a temp
// server and a local mock. No real host, no download, no token in a response.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { allows, assertTier, rankName } from "../server/feature-gate.js";
import { allBuilders, cardCopy, detectNeeds, registerBuilder, CARD_TITLE } from "../server/builder-detect.js";
import {
  applyFix, auditHtml, buildSite, draftAds, draftSequence, reelPlan, sparsePage, toAstro, CAN_SPAM, PLATFORMS,
} from "../server/builder-work.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

test("tiers: free, pro, studio, owner, extreme", () => {
  assert.equal(rankName("free"), "free");
  assert.equal(rankName("studio"), "pro");
  assert.equal(rankName("owner"), "extreme");
  assert.equal(allows("free", "free"), true);
  assert.equal(allows("pro", "free"), false);
  assert.equal(allows("pro", "pro"), true);
  assert.equal(allows("pro", "studio"), true);
  assert.equal(allows("extreme", "studio"), false);
  assert.equal(allows("extreme", "pro"), false);
  assert.equal(allows("extreme", "owner"), true);
  assert.equal(allows("extreme", "extreme"), true);
  assert.equal(assertTier("free", "free").rank, "free");
  assert.throws(() => assertTier("pro", "free"), (e) => e.status === 402 && e.code === "tier" && /Pro/.test(e.message));
  assert.throws(() => assertTier("extreme", "pro"), (e) => e.status === 402 && /Extreme/.test(e.message));
});

test("detection: words, services, files, dismiss, and the master switch", () => {
  const words = detectNeeds({ text: "Please build a website, a reel, a post schedule, and an email series" });
  const ids = words.map((hit) => hit.id);
  for (const id of ["site", "reel", "social", "email"]) assert.ok(ids.includes(id), id);
  const site = words.find((hit) => hit.id === "site");
  assert.equal(cardCopy(site).title, CARD_TITLE);
  assert.match(cardCopy(site).body, /website/i);

  const fromService = detectNeeds({ services: ["netlify"] });
  assert.equal(fromService[0].id, "publish");
  assert.equal(fromService[0].reason.kind, "service");

  const fromFile = detectNeeds({ files: ["clips/launch.mp4", "src/pages/index.astro", "client-page.json"] });
  const fileIds = fromFile.map((hit) => hit.id);
  assert.ok(fileIds.includes("reel"));
  assert.ok(fileIds.includes("static"));
  assert.ok(fileIds.includes("page"));

  const hidden = detectNeeds({
    text: "a website",
    settings: { dismissed: { "site:words:website": true } },
  });
  assert.equal(hidden.some((hit) => hit.id === "site"), false);
  assert.deepEqual(detectNeeds({ text: "a website", settings: { suggestions: false } }), []);
});

test("the next builders pull request can register a builder on the same detector", () => {
  const row = registerBuilder({
    id: "sample-extra",
    name: "Sample extra",
    plain: "Only a test row.",
    tier: "free",
    keywords: [/\bquilt\b/i],
    services: [],
    files: [],
  });
  assert.equal(row.id, "sample-extra");
  assert.equal(registerBuilder(row), null);
  assert.equal(detectNeeds({ text: "make a quilt" })[0].id, "sample-extra");
  assert.equal(allBuilders().filter((b) => b.id === "sample-extra").length, 1);
});

test("health check, ads, email footer, astro export, and remotion default", () => {
  const page = sparsePage("A small bakery");
  let audit = auditHtml(page);
  for (const id of ["title", "meta", "viewport", "h1", "alt", "lang"]) {
    assert.ok(audit.issues.some((issue) => issue.id === id), id);
  }
  assert.equal(audit.engine.license, "Apache-2.0");
  assert.equal(audit.engine.ran, false);
  let html = page;
  html = applyFix(html, "lang");
  html = applyFix(html, "title", "Bakery");
  html = applyFix(html, "meta", "Bread and coffee");
  html = applyFix(html, "viewport");
  html = applyFix(html, "h1", "Bakery");
  html = applyFix(html, "alt");
  audit = auditHtml(html);
  assert.equal(audit.issues.length, 0);

  const site = buildSite({ brief: "Corner bakery" });
  assert.equal(site.model.engine.license, "BSD-3");
  assert.equal(auditHtml(site.html).issues.length, 0);

  const credit = draftAds("A credit card loan with a low apr");
  assert.equal(credit.warning.id, "credit");
  assert.match(credit.warning.warning, /\[VERIFY\]/);
  const insurance = draftAds("Car insurance for new drivers");
  assert.equal(insurance.warning.id, "insurance");
  for (const platform of PLATFORMS) {
    for (const field of insurance.platforms[platform.id].fields) {
      assert.ok(field.length <= field.limit, `${platform.id} ${field.id}`);
    }
  }
  assert.equal(credit.posted, false);

  const series = draftSequence("Welcome to the bakery list", "1 Main Street, Austin TX");
  assert.equal(series.emails.length, 3);
  for (const email of series.emails) {
    assert.ok(email.text.includes("{{unsubscribe_url}}"));
    assert.ok(email.text.includes("1 Main Street, Austin TX"));
    assert.ok(email.text.includes(CAN_SPAM.split("{{postal_address}}")[0].slice(0, 20)));
  }

  const astro = toAstro(site.html, "Corner bakery");
  assert.equal(astro.engine.downloaded, false);
  assert.equal(astro.engine.license, "MIT");
  assert.match(astro.files["src/pages/index.astro"], /Corner bakery|const title/);

  const reel = reelPlan({ brief: "Show the loaf" });
  assert.equal(reel.remotion.on, false);
  assert.equal(reel.composition, null);
  assert.equal(reel.engines[0].license, "BSD-2");
  assert.equal(reel.engines[1].license, "Unlicense");
  assert.equal(reel.engines[0].ran, false);
  const on = reelPlan({ brief: "Show the loaf", remotion: true });
  assert.equal(on.remotion.on, true);
  assert.match(on.remotion.note, /not installed/);
});

test("builder source does not import the engines, Postiz, or Remotion, and has no em dash", () => {
  const files = [
    "server/builder-detect.js",
    "server/builder-work.js",
    "server/plugins/builders.js",
    "server/feature-gate.js",
    "web/features/builders.js",
  ];
  const banned = /from ["'](?:grapesjs|@measured\/puck|astro|lighthouse|remotion|@remotion\/|postiz|whisperx|auto-editor)["']|require\(["'](?:grapesjs|postiz|lighthouse|remotion|astro)["']/;
  for (const file of files) {
    const src = read(file);
    assert.equal(src.includes(EM), false, file);
    assert.doesNotMatch(src, banned, file);
  }
  assert.doesNotMatch(read("server/builder-work.js"), /child_process|execFile\(|spawn\(/);
  assert.match(read("server/builder-detect.js"), /registerBuilder/);
  assert.match(read("server/builder-work.js"), /separate service/i);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.version, "0.4.8");
  const deps = JSON.stringify(pkg.dependencies || {}) + JSON.stringify(pkg.devDependencies || {});
  assert.doesNotMatch(deps, /grapesjs|lighthouse|whisperx|remotion|postiz|astro|puck/i);
});

function mockHost() {
  return new Promise((resolve, reject) => {
    const hits = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      hits.push({ method: req.method, path: req.url, auth: req.headers.authorization || "", body });
      const send = (obj) => {
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "POST" && req.url === "/api/v1/sites") return send({ id: "site_1", url: "http://127.0.0.1/site" });
      if (req.method === "POST" && /\/deploys$/.test(req.url)) return send({ id: "dep_1", url: "http://127.0.0.1/dep" });
      if (req.method === "POST" && req.url === "/v13/deployments") return send({ id: "vc_1", url: "demo.local" });
      if (req.method === "POST" && req.url === "/api/public/v1/posts") return send({ id: "post_1" });
      if (req.method === "POST" && req.url === "/api/campaigns") return send({ id: "camp_1" });
      if (req.method === "POST" && req.url === "/marketing/emails") return send({ id: "em_1" });
      res.writeHead(404, { connection: "close" });
      res.end("{}");
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        hits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function walk(api, id, brief, extra = {}) {
  const opened = await api("/builders/open", { method: "POST", body: { id } });
  assert.equal(opened.status, 200, opened.text);
  const jobId = opened.json.job.id;
  const described = await api(`/builders/jobs/${jobId}/describe`, { method: "POST", body: { brief, askAi: false, ...extra } });
  assert.equal(described.status, 200, described.text);
  assert.equal(described.json.job.step, "preview");
  assert.match(described.json.job.preview.note, /Nothing runs until you click Build|simple draft/);
  const built = await api(`/builders/jobs/${jobId}/build`, { method: "POST", body: {} });
  assert.equal(built.status, 200, built.text);
  assert.equal(built.json.job.step, "build");
  const tested = await api(`/builders/jobs/${jobId}/test`, { method: "POST", body: {} });
  assert.equal(tested.status, 200, tested.text);
  const early = await api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: {} });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, "confirm_required");
  return { jobId, built, tested };
}

describe("builders on a local server", { concurrency: 1 }, () => {
  let mock, owner, free;
  const TOKEN = "netlify-test-token-xyz123";
  const GHL = "ghl-test-token-xyz123";
  const POSTIZ = "postiz-test-token-xyz123";

  before(async () => {
    mock = await mockHost();
    owner = await startServer({ env: {
      CC_DEV_OWNER: "1",
      CC_NETLIFY_API: mock.url,
      CC_VERCEL_API: mock.url,
      CC_POSTIZ_API: mock.url,
      CC_LISTMONK_API: mock.url,
      CC_GHL_API_URL: mock.url,
    } });
    free = await startServer();
  });
  after(async () => {
    await owner?.stop();
    await free?.stop();
    await mock?.close();
  });

  test("free can open the free builders and not the paid ones", async () => {
    const home = await free.api("/builders?draft=" + encodeURIComponent("I need a website and a reel"));
    assert.equal(home.status, 200);
    const offered = [home.json.suggestion?.id, ...(home.json.also || []).map((row) => row.id)];
    assert.ok(offered.includes("site"));
    assert.ok(offered.includes("reel"));
    assert.equal(home.json.gallery.length >= 10, true);
    assert.equal(home.json.gallery.find((row) => row.id === "site").locked, true);
    assert.equal(home.json.gallery.find((row) => row.id === "ads").locked, false);
    assert.equal(home.json.gallery.find((row) => row.id === "reel").locked, true);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "site" } })).status, 402);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "reel" } })).status, 402);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "ads" } })).status, 200);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "health" } })).status, 200);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "seo" } })).status, 200);
    assert.equal((await free.api("/builders/open", { method: "POST", body: { id: "static" } })).status, 200);
  });

  test("dismiss and the settings switch hide the card, and the gallery stays", async () => {
    const first = await owner.api("/builders?draft=" + encodeURIComponent("plan a website for the shop"));
    assert.equal(first.json.suggestion.id, "site");
    const gone = await owner.api("/builders/dismiss?draft=" + encodeURIComponent("plan a website for the shop"), {
      method: "POST",
      body: { signal: first.json.suggestion.signal },
    });
    assert.notEqual(gone.json.suggestion?.id, "site");
    const off = await owner.api("/builders/settings", { method: "POST", body: { suggestions: false } });
    assert.equal(off.json.suggestion, null);
    assert.ok(off.json.gallery.length >= 10);
    const on = await owner.api("/builders/settings", { method: "POST", body: { suggestions: true, clearDismissed: true } });
    assert.equal(on.json.suggestionsOn, true);
  });

  test("ad copy stays inside the limits and is not posted", async () => {
    const { jobId, built } = await walk(owner.api, "ads", "Write an ad for car insurance with a low price");
    assert.equal(built.json.job.result.warning.id, "insurance");
    const saved = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.job.publish.posted, false);
    assert.equal(saved.json.job.publish.sent, false);
    assert.equal(mock.hits.length, 0);
  });

  test("health check Fix it closes a gap, and seo saves without publishing", async () => {
    const health = await walk(owner.api, "health", "A page about the bakery");
    assert.ok(health.tested.json.job.test.issues.some((issue) => issue.id === "title"));
    const fixed = await owner.api(`/builders/jobs/${health.jobId}/fix`, { method: "POST", body: { fixId: "title", value: "Bakery" } });
    assert.equal(fixed.json.job.test.issues.some((issue) => issue.id === "title"), false);
    assert.match(fixed.json.job.result.html, /<title>Bakery<\/title>/);
    const seo = await walk(owner.api, "seo", "seo title for the bakery");
    const title = await owner.api(`/builders/jobs/${seo.jobId}/fix`, { method: "POST", body: { fixId: "title" } });
    assert.match(title.json.job.result.html, /<title>/);
    const kept = await owner.api(`/builders/jobs/${seo.jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(kept.json.job.publish.sent, false);
    assert.equal(mock.hits.length, 0);
  });

  test("static export does not download Astro or call the network", async () => {
    const { jobId, built } = await walk(owner.api, "static", "static export of the menu");
    assert.equal(built.json.job.result.engine.downloaded, false);
    assert.ok(built.json.job.result.files["src/pages/index.astro"]);
    const saved = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(saved.json.job.publish.sent, false);
    assert.equal(mock.hits.length, 0);
  });

  test("publish waits for the click, keeps the token in the vault, and can send once", async () => {
    const before = mock.hits.length;
    const saved = await owner.api("/builders/token", { method: "POST", body: { host: "netlify", token: TOKEN } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.saved, true);
    assert.equal(JSON.stringify(saved.json).includes(TOKEN), false);
    assert.equal(mock.hits.length, before);
    const { jobId } = await walk(owner.api, "publish", "Publish the site for the bakery");
    assert.equal(mock.hits.length, before, "the refused click did not call Netlify");
    const sent = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true, host: "netlify" } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.job.publish.sent, true);
    assert.equal(sent.json.job.publish.host, "netlify");
    assert.equal(JSON.stringify(sent.json).includes(TOKEN), false);
    const suggested = await owner.api("/builders?draft=");
    assert.equal(suggested.json.suggestion.id, "publish");
    assert.equal(suggested.json.suggestion.title, CARD_TITLE);
    const deploy = mock.hits.filter((hit) => hit.path.includes("/deploys"));
    assert.equal(deploy.length, 1);
    assert.equal(deploy[0].auth, `Bearer ${TOKEN}`);
    const again = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "already_sent");
    const disk = fs.readFileSync(path.join(owner.dir, "builders.state.json"), "utf8");
    assert.equal(disk.includes(TOKEN), false);
    const vault = fs.readFileSync(path.join(owner.dir, "vault.bin"), "utf8");
    assert.equal(vault.includes(TOKEN), false);
    assert.equal(owner.log.includes(TOKEN), false);
  });

  test("email series keeps the footer and does not send early", async () => {
    const { jobId, built } = await walk(owner.api, "email", "An email series for new customers");
    for (const email of built.json.job.result.emails) assert.match(email.text, /\{\{unsubscribe_url\}\}/);
    const noAddress = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(noAddress.status, 400);
    assert.equal(noAddress.json.code, "canspam");
    assert.equal(mock.hits.some((hit) => hit.path === "/marketing/emails"), false);
    await owner.api("/builders/settings", { method: "POST", body: { address: "1 Main Street, Austin TX" } });
    await owner.api("/builders/token", { method: "POST", body: { host: "highlevel", token: GHL } });
    const sent = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true, channel: "highlevel" } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.job.publish.sent, true);
    const call = mock.hits.find((hit) => hit.path === "/marketing/emails");
    assert.ok(call);
    assert.match(call.body, /unsubscribe_url/);
    assert.match(call.body, /1 Main Street, Austin TX/);
    assert.equal(call.body.includes(GHL), false);
    assert.equal(sent.text.includes(GHL), false);
    assert.equal(owner.log.includes(GHL), false);
  });

  test("social calendar stays local until Postiz is connected, and Postiz is only a request", async () => {
    const before = mock.hits.filter((hit) => hit.path === "/api/public/v1/posts").length;
    const local = await walk(owner.api, "social", "a post schedule for the week");
    assert.equal(local.built.json.job.result.posts.length, 3);
    assert.match(local.built.json.job.result.engine.note, /own service/i);
    assert.match(local.built.json.job.result.engine.note, /not include Postiz/);
    const saved = await owner.api(`/builders/jobs/${local.jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(saved.json.job.publish.sent, false);
    assert.equal(mock.hits.filter((hit) => hit.path === "/api/public/v1/posts").length, before);
    await owner.api("/builders/token", { method: "POST", body: { host: "postiz", token: POSTIZ } });
    const { jobId } = await walk(owner.api, "social", "another post schedule");
    const sent = await owner.api(`/builders/jobs/${jobId}/publish`, { method: "POST", body: { confirm: true } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.job.publish.host, "postiz");
    const call = mock.hits.filter((hit) => hit.path === "/api/public/v1/posts").at(-1);
    assert.equal(call.auth, `Bearer ${POSTIZ}`);
    assert.equal(sent.text.includes(POSTIZ), false);
  });

  test("reel maker is extreme, Remotion stays off, and WhisperX is not called", async () => {
    const { built } = await walk(owner.api, "reel", "Cut a reel of the baker pulling bread");
    assert.equal(built.json.job.result.remotion.on, false);
    assert.equal(built.json.job.result.composition, null);
    assert.equal(built.json.job.result.engines[0].ran, false);
    await owner.api("/builders/settings", { method: "POST", body: { remotion: true } });
    const opened = await owner.api("/builders/open", { method: "POST", body: { id: "reel" } });
    const jobId = opened.json.job.id;
    await owner.api(`/builders/jobs/${jobId}/describe`, { method: "POST", body: { brief: "Another reel", askAi: false, remotion: true } });
    const again = await owner.api(`/builders/jobs/${jobId}/build`, { method: "POST", body: {} });
    assert.equal(again.json.job.result.remotion.on, true);
    assert.match(again.json.job.result.composition, /not installed|Reel/);
    await owner.api("/builders/settings", { method: "POST", body: { remotion: false } });
  });

});

test("pro can build a site and cannot open Reel Maker", async () => {
  const pro = await startServer({
    cloud: { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "pro@example.com", message: "ok" }) },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })),
  });
  try {
    let tier = "";
    for (let i = 0; i < 50 && tier !== "pro"; i++) {
      tier = (await pro.api("/state")).json.license.tier;
      if (tier !== "pro") await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(tier, "pro");
    assert.equal((await pro.api("/builders/open", { method: "POST", body: { id: "site" } })).status, 200);
    const reel = await pro.api("/builders/open", { method: "POST", body: { id: "reel" } });
    assert.equal(reel.status, 402);
    assert.match(reel.json.error, /Extreme/);
  } finally { await pro.stop(); }
});
