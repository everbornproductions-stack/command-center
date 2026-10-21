// Guided builders. Detection, gates, licenses, click-to-publish, and mocked tools.
// No real network, no heavy tool, no token in a response or a log.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";
import { resolveTier } from "../server/license.js";
import { builderGate } from "../server/feature-gate.js";
import { includesPhrase, loadBuilderExtras, registerBuilder, suggestBuilders, unregisterBuilder } from "../server/builders/registry.js";
import { ensureCatalog, resetCatalogForTests } from "../server/builders/catalog.js";
import { buildBuilder, fixBuilder, previewBuilder, publishBuilder, testBuilder } from "../server/builders/flow.js";

ensureCatalog();

const EM = "\u2014";
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const ids = (rows) => rows.map((row) => row.id).sort();
const TOKEN = "nf-test-token-123456";

function suggest(signals) {
  resetCatalogForTests();
  return suggestBuilders(signals);
}

describe("guided builders", { concurrency: 1 }, () => {
  test("the registry suggests a builder only when it detects the need, and workstream B can plug in", async () => {
    assert.deepEqual(ids(suggest({ text: "", projects: [], connectors: [] })), []);
    const web = ids(suggest({ text: "I need a website for the bakery", projects: [], connectors: [] }));
    for (const id of ["site-builder", "client-page", "astro-export", "site-health", "seo-fixer"]) assert.ok(web.includes(id), id);
    assert.equal(web.includes("reel-maker"), false);
    assert.equal(web.includes("ad-copy"), false);
    assert.equal(web.includes("email-sequences"), false);

    const posts = ids(suggest({ text: "three posts this week", projects: [], connectors: [] }));
    assert.deepEqual(posts, ["social-calendar"]);
    const reels = ids(suggest({ text: "reels for the shop", projects: [], connectors: [] }));
    assert.ok(reels.includes("reel-maker"));
    assert.ok(reels.includes("social-calendar"));
    assert.equal(reels.includes("site-builder"), false);

    const netlify = ids(suggest({ text: "", projects: [], connectors: ["netlify"] }));
    assert.ok(netlify.includes("site-builder"));
    assert.ok(netlify.includes("seo-fixer"));
    assert.equal(netlify.includes("email-sequences"), false);

    const social = ids(suggest({ text: "", projects: [], connectors: ["instagram"] }));
    assert.ok(social.includes("social-calendar"));
    assert.ok(social.includes("reel-maker"));
    assert.equal(social.includes("ad-copy"), false);

    const project = ids(suggest({ text: "", projects: [{ name: "Harbor", kind: "website", summary: "", categories: "" }], connectors: [] }));
    assert.ok(project.includes("site-builder"));
    assert.equal(includesPhrase("advertisement", "ad"), false);
    assert.equal(includesPhrase("an ad for shoes", "ad"), true);
    assert.equal(includesPhrase("post", "posts"), false);

    registerBuilder({
      id: "b-sample",
      title: "Sample builder",
      group: "marketing",
      tier: "free",
      summary: "A sample so workstream B can plug in.",
      detect: { words: ["widgetpress"], connectors: [], projectKinds: [], projectWords: [] },
      tools: [{ name: "Sample", license: "MIT", how: "Test only." }],
    });
    assert.ok(ids(suggestBuilders({ text: "widgetpress", projects: [], connectors: [] })).includes("b-sample"));
    unregisterBuilder("b-sample");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "builders-extra-"));
    try {
      fs.writeFileSync(path.join(dir, "extra.js"), `export async function register({ registerBuilder }) {
        registerBuilder({
          id: "b-extra",
          title: "Extra builder",
          group: "web",
          tier: "free",
          summary: "Loaded from the extras folder.",
          detect: { words: ["extraword"], connectors: [], projectKinds: [], projectWords: [] },
          tools: [{ name: "Extra", license: "MIT", how: "Test only." }],
        });
      }\n`);
      await loadBuilderExtras(dir, { registerBuilder });
      assert.ok(ids(suggestBuilders({ text: "extraword please", projects: [], connectors: [] })).includes("b-extra"));
    } finally {
      unregisterBuilder("b-extra");
      fs.rmSync(dir, { recursive: true, force: true });
      resetCatalogForTests();
    }
    assert.equal(suggestBuilders({ text: "extraword", projects: [], connectors: [] }).some((row) => row.id === "b-extra"), false);
  });

  test("gates, licenses, CAN-SPAM, ad limits, health fixes, and Remotion stay off", async () => {
    assert.equal(builderGate("pro", "free").ok, false);
    assert.equal(builderGate("pro", "free").code, "plan_required");
    assert.equal(builderGate("free", "free").ok, true);
    assert.equal(builderGate("pro", "pro").ok, true);
    assert.equal(builderGate("pro", "studio").ok, true);
    assert.equal(builderGate("extreme", "studio").ok, false);
    assert.equal(builderGate("extreme", "pro").ok, false);
    assert.equal(builderGate("extreme", "extreme").ok, true);
    assert.equal(builderGate("extreme", "owner").ok, true);
    assert.equal(resolveTier({ lic: { tier: "extreme", status: "active", lastOkAt: Date.now() } }).tier, "extreme");

    const ctx = { tier: "owner", ranked: [{ providerName: "Demo", name: "Nova", model: "nova", provider: "demo-nova" }] };
    const preview = previewBuilder("site-builder", { name: "Harbor", about: "Bread" }, ctx);
    assert.equal(preview.ran, false);
    assert.equal(preview.sent, false);
    assert.equal(preview.recipients.ais[0].name, "Nova");
    assert.match(preview.recipients.services.map((row) => row.name).join(" "), /GrapesJS/);
    assert.match(preview.recipients.services.map((row) => `${row.name} ${row.license}`).join(" "), /BSD-3/);

    const site = buildBuilder("site-builder", { name: "Harbor", about: "Bread", confirm: true }, { tier: "pro", ranked: [] });
    assert.equal(site.ok, true);
    assert.equal(site.sent, false);
    assert.equal(site.draft.artifact.started, false);
    assert.match(site.draft.files.find((file) => file.path === "TOOLS.txt").text, /GrapesJS/);
    assert.match(site.draft.files.find((file) => file.path === "TOOLS.txt").text, /BSD-3/);
    const noClick = buildBuilder("site-builder", { name: "Harbor", about: "Bread" }, { tier: "pro" });
    assert.equal(noClick.code, "confirm");
    assert.equal(buildBuilder("site-builder", { confirm: true }, { tier: "free" }).code, "plan_required");
    assert.equal(buildBuilder("reel-maker", { confirm: true }, { tier: "pro" }).code, "plan_required");
    assert.equal(buildBuilder("astro-export", { confirm: true, name: "Harbor", about: "Bread" }, { tier: "free" }).ok, true);
    assert.match(buildBuilder("client-page", { confirm: true, name: "Harbor", about: "Bread" }, { tier: "pro" }).draft.artifact.note, /Puck was not started/);
    assert.match(buildBuilder("astro-export", { confirm: true, name: "Harbor", about: "Bread" }, { tier: "free" }).draft.artifact.note, /Astro was not downloaded/);

    const reelOff = buildBuilder("reel-maker", { confirm: true, name: "Harbor", about: "A short clip" }, { tier: "extreme" });
    assert.equal(reelOff.ok, true);
    assert.equal(reelOff.draft.artifact.remotion.on, false);
    assert.equal(reelOff.draft.artifact.remotion.included, false);
    assert.equal(reelOff.draft.artifact.toolsRun.every((tool) => tool.started === false), true);
    assert.match(reelOff.draft.artifact.toolsRun.map((tool) => `${tool.name} ${tool.license}`).join(" "), /WhisperX BSD-2/);
    assert.match(reelOff.draft.artifact.toolsRun.map((tool) => tool.license).join(" "), /Unlicense/);
    const reelPaid = buildBuilder("reel-maker", { confirm: true, remotion: true }, { tier: "owner" });
    assert.equal(reelPaid.code, "remotion_license");
    const reelAck = buildBuilder("reel-maker", { confirm: true, remotion: true, remotionAck: true, about: "A short clip" }, { tier: "owner" });
    assert.equal(reelAck.draft.artifact.remotion.included, false);
    assert.match(reelAck.draft.artifact.remotion.note, /does not include/);

    const calendar = buildBuilder("social-calendar", { confirm: true, name: "Harbor", about: "Fresh bread", posts: 3 }, { tier: "pro" });
    assert.equal(calendar.draft.artifact.bundled, false);
    assert.equal(calendar.draft.artifact.posts.length, 3);
    assert.match(calendar.draft.artifact.note, /not included/);

    const blocked = buildBuilder("ad-copy", { confirm: true, topic: "credit repair", name: "North", about: "We help people read their reports" }, { tier: "free" });
    assert.equal(blocked.code, "compliance");
    assert.match(blocked.compliance.banner, /does not give/);
    const ad = buildBuilder("ad-copy", {
      confirm: true, topic: "credit repair", name: "North", about: "We help people read their reports",
      compliance: { noPromises: true, followLaws: true, notAdvice: true },
    }, { tier: "free", ranked: ctx.ranked });
    assert.equal(ad.ok, true);
    const adText = JSON.stringify(ad.draft.artifact);
    assert.doesNotMatch(adText, /your score will|we guarantee|this is legal advice|you should dispute|act now to fix your credit/i);
    assert.match(ad.draft.compliance.banner, /not a review/);
    const insurance = buildBuilder("ad-copy", { confirm: true, topic: "car insurance", name: "North", about: "A local office" }, { tier: "free" });
    assert.equal(insurance.code, "compliance");
    const fromNote = buildBuilder("ad-copy", { confirm: true, topic: "fresh bread", name: "North", about: "A bakery" }, { tier: "free", note: "credit repair ads" });
    assert.equal(fromNote.code, "compliance");
    assert.match(fromNote.compliance.banner, /does not give/);

    const long = buildBuilder("ad-copy", { confirm: true, platform: "google", name: "This headline is definitely longer than thirty characters", about: "Short" }, { tier: "free" });
    assert.ok(long.draft.issues.some((issue) => issue.id === "limit:headline"));
    const trimmed = fixBuilder(long.draft, "limit:headline");
    assert.equal(trimmed.draft.artifact.lines.find((line) => line.part === "headline").text.length, 30);
    assert.equal(trimmed.issues.some((issue) => issue.id === "limit:headline"), false);
    const x = buildBuilder("ad-copy", { confirm: true, platform: "x", copy: "x".repeat(300), name: "North", about: "Hi" }, { tier: "free" });
    assert.ok(x.draft.issues.some((issue) => issue.part === "post" && issue.max === 280));

    const mail = buildBuilder("email-sequences", { confirm: true, name: "Harbor", about: "This week's loaf", address: "" }, { tier: "pro" });
    assert.match(mail.draft.artifact.footer, /Unsubscribe/);
    assert.match(mail.draft.artifact.emails[0].body, /Harbor/);
    assert.ok(mail.draft.issues.some((issue) => issue.id === "address"));
    const held = await publishBuilder(mail.draft, { confirmed: true, target: "listmonk" }, { tier: "pro", token: "", fetchImpl: () => { throw new Error("should not send"); } });
    assert.equal(held.code, "test_failed");
    const ready = buildBuilder("email-sequences", {
      confirm: true, name: "Harbor", about: "This week's loaf", address: "1 Main Street, Town 00000", unsubscribe: "",
    }, { tier: "pro" });
    assert.equal(ready.draft.issues.some((issue) => issue.blocking), false);
    assert.match(ready.draft.artifact.footer, /1 Main Street/);
    assert.match(ready.draft.artifact.footer, /Reply with the word unsubscribe/);

    const health = buildBuilder("site-health", { confirm: true, name: "Harbor", about: "Bread and coffee" }, { tier: "free" });
    assert.match(health.draft.artifact.note, /Lighthouse was not started/);
    assert.equal(health.draft.artifact.license, "Apache-2.0");
    assert.ok(health.draft.issues.some((issue) => issue.fixable && issue.title));
    let draft = health.draft;
    for (const issue of [...draft.issues]) {
      if (!issue.fixable) continue;
      const fixed = fixBuilder(draft, issue.id);
      assert.equal(fixed.ok, true, issue.id);
      draft = fixed.draft;
    }
    assert.equal(draft.issues.filter((issue) => issue.blocking).length, 0);
    const seo = buildBuilder("seo-fixer", { confirm: true, name: "Harbor Bakery", about: "Fresh bread baked every morning" }, { tier: "free", ranked: ctx.ranked });
    assert.ok(seo.draft.issues.some((issue) => issue.id === "seo-title"));
    assert.match(seo.draft.artifact.note, /Nothing was sent/);
    let seoDraft = seo.draft;
    for (const issue of [...seoDraft.issues]) {
      if (!issue.fixable) continue;
      seoDraft = fixBuilder(seoDraft, issue.id).draft;
    }
    assert.equal(seoDraft.issues.filter((issue) => issue.blocking).length, 0);
    assert.match(seoDraft.artifact.html, /Harbor Bakery/);

    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, async text() { return "{}"; } }; };
    const quiet = await publishBuilder(site.draft, { target: "netlify" }, { tier: "pro", token: TOKEN, fetchImpl });
    assert.equal(quiet.code, "confirm_required");
    assert.equal(calls, 0);
    const dry = await publishBuilder(site.draft, { confirmed: true, target: "netlify" }, { tier: "pro", token: "", fetchImpl });
    assert.equal(dry.status, "dry-run");
    assert.equal(dry.sent, false);
    assert.equal(calls, 0);
    const blockedNet = await publishBuilder(site.draft, { confirmed: true, target: "netlify" }, { tier: "free", token: TOKEN, fetchImpl });
    assert.equal(blockedNet.status, 402);
    assert.equal(calls, 0);
    const sent = await publishBuilder(site.draft, { confirmed: true, target: "netlify" }, { tier: "pro", token: TOKEN, fetchImpl });
    assert.equal(sent.sent, true);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(sent).includes(TOKEN), false);
  });

  test("the page, the help, and the packages stay plain and local", () => {
    const ui = read("web", "features", "builders.js");
    const plugin = read("server", "plugins", "builders.js");
    for (const phrase of ["Suggested for you", "Show all", "More options", "Preview the AIs", "Fix it", "Nothing is sent until you click Publish"]) {
      assert.ok(ui.includes(phrase), phrase);
    }
    assert.equal(ui.includes(EM), false);
    assert.equal(plugin.includes(EM), false);
    const pkg = JSON.parse(read("package.json"));
    const deps = JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const name of ["grapesjs", "puck", "astro", "lighthouse", "postiz", "remotion", "whisperx"]) {
      assert.equal(deps.includes(name), false, name);
    }
    const folder = path.join(ROOT, "server", "builders");
    for (const file of fs.readdirSync(folder)) {
      const src = read("server", "builders", file);
      assert.equal(src.includes(EM), false, file);
      assert.doesNotMatch(src, /from ["'](?:grapesjs|@measured\/puck|astro|lighthouse|postiz|@remotion\/|whisperx)/);
      assert.doesNotMatch(src, /child_process/);
    }
    assert.equal(read("docs", "help", "builders.md").includes(EM), false);
    assert.equal(pkg.version, "0.4.8");
    assert.match(read("web", "nav.js"), /builders: "Builders"/);
    assert.match(read("web", "mode.js"), /"builders"/);
  });

  test("a free copy suggests from a sentence and blocks Pro tools", async () => {
    const s = await startServer();
    try {
      const empty = await s.api("/builders");
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.json.suggested, []);
      assert.ok(empty.json.all.length >= 9);
      const noted = await s.api("/builders/notice", { method: "POST", body: { text: "I need a website for the bakery sk-test-secret-should-not-stick" } });
      assert.equal(noted.status, 200);
      assert.equal(JSON.stringify(noted.json).includes("sk-test"), false);
      const suggested = await s.api("/builders");
      const names = suggested.json.suggested.map((row) => row.id);
      assert.ok(names.includes("site-builder"));
      assert.equal(names.includes("reel-maker"), false);
      assert.equal(JSON.stringify(suggested.json).includes("sk-test"), false);
      const notes = fs.readFileSync(path.join(s.dir, "builders.notes.json"), "utf8");
      assert.equal(notes.includes("sk-test"), false);

      const blocked = await s.api("/builders/site-builder/build", { method: "POST", body: { confirm: true, name: "Harbor", about: "Bread" } });
      assert.equal(blocked.status, 402);
      assert.equal(blocked.json.code, "plan_required");
      const reel = await s.api("/builders/reel-maker/build", { method: "POST", body: { confirm: true, about: "A clip" } });
      assert.equal(reel.status, 402);
      const ad = await s.api("/builders/ad-copy/build", { method: "POST", body: { confirm: true, name: "Harbor", about: "Fresh bread", platform: "instagram" } });
      assert.equal(ad.status, 200);
      assert.equal(ad.json.sent, false);
      assert.equal(JSON.stringify(ad.json).includes(TOKEN), false);
      const astro = await s.api("/builders/astro-export/build", { method: "POST", body: { confirm: true, name: "Harbor", about: "Fresh bread" } });
      assert.equal(astro.status, 200);
      const remote = await s.api("/builders/astro-export/publish", { method: "POST", body: { draftId: astro.json.draft.id, confirmed: true, target: "netlify" } });
      assert.equal(remote.status, 402);
      const local = await s.api("/builders/astro-export/publish", { method: "POST", body: { draftId: astro.json.draft.id, confirmed: true, target: "local" } });
      assert.equal(local.status, 200);
      assert.equal(local.json.sent, false);
      assert.equal(local.json.status, "saved");
      const written = astro.json.draft.written || [];
      assert.ok(written.some((file) => file.endsWith("index.html")));
      assert.ok(written.every((file) => file.startsWith("projects/")));
      assert.ok(fs.existsSync(path.join(s.dir, written[0])));
    } finally { await s.stop(); }
  });

  test("publish waits for a click, keeps the token in the vault, and uses the mock", async () => {
    const port = await freePort();
    const hits = [];
    const mock = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        hits.push({ path: req.url, auth: req.headers.authorization || "", body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ssl_url: "https://example.test/harbor" }));
      });
    });
    await new Promise((resolve) => mock.listen(port, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${port}`;
    let s;
    try {
      s = await startServer({ env: { CC_DEV_OWNER: "1", CC_NETLIFY_API: base, CC_VERCEL_API: base } });
      const preview = await s.api("/builders/site-builder/preview", { method: "POST", body: { name: "Harbor", about: "Fresh bread" } });
      assert.equal(preview.status, 200);
      assert.equal(preview.json.ran, false);
      assert.equal(hits.length, 0);
      const built = await s.api("/builders/site-builder/build", { method: "POST", body: { confirm: true, name: "Harbor", about: "Fresh bread" } });
      assert.equal(built.status, 200, built.json?.error);
      assert.equal(built.json.sent, false);
      const again = await s.api("/builders");
      assert.ok(again.json.suggested.some((row) => row.id === "site-builder"));

      const early = await s.api("/builders/site-builder/publish", { method: "POST", body: { draftId: built.json.draft.id, target: "netlify" } });
      assert.equal(early.status, 400);
      assert.equal(early.json.code, "confirm_required");
      assert.equal(hits.length, 0);

      const saved = await s.api("/builders/connect", { method: "POST", body: { service: "netlify", token: TOKEN } });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.connected, true);
      assert.equal(JSON.stringify(saved.json).includes(TOKEN), false);
      const listed = await s.api("/builders/connect");
      assert.equal(listed.json.services.find((row) => row.id === "netlify").connected, true);
      assert.equal(JSON.stringify(listed.json).includes(TOKEN), false);

      const published = await s.api("/builders/site-builder/publish", { method: "POST", body: { draftId: built.json.draft.id, confirmed: true, target: "netlify" } });
      assert.equal(published.status, 200, published.json?.error);
      assert.equal(published.json.sent, true);
      assert.equal(published.json.link, "https://example.test/harbor");
      assert.equal(hits.length, 1);
      assert.equal(hits[0].auth, `Bearer ${TOKEN}`);
      assert.equal(hits[0].path, "/api/v1/sites");
      assert.equal(hits[0].body.includes(TOKEN), false);
      assert.equal(JSON.stringify(published.json).includes(TOKEN), false);
      assert.equal(s.log.includes(TOKEN), false);
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) walk(full);
          else if (/\.(json|jsonl|html|txt|md)$/i.test(name)) assert.equal(fs.readFileSync(full, "utf8").includes(TOKEN), false, full);
        }
      };
      walk(s.dir);

      const health = await s.api("/builders/site-health/build", { method: "POST", body: { confirm: true, name: "Harbor", about: "Fresh bread" } });
      assert.equal(health.status, 200);
      assert.ok(health.json.draft.issues.length >= 1);
      let current = health.json.draft;
      for (const issue of [...current.issues]) {
        if (!issue.fixable) continue;
        const fixed = await s.api("/builders/site-health/fix", { method: "POST", body: { draftId: current.id, issueId: issue.id, confirm: true } });
        assert.equal(fixed.status, 200, fixed.json?.error);
        current = fixed.json.draft;
      }
      assert.equal(current.issues.filter((issue) => issue.blocking).length, 0);
      const unconfirmed = await s.api("/builders/site-health/fix", { method: "POST", body: { draftId: current.id, issueId: "title:0" } });
      assert.equal(unconfirmed.status, 400);
    } finally {
      if (s) await s.stop();
      await new Promise((resolve) => mock.close(resolve));
    }
  });
});
