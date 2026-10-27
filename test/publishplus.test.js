// Slice C4: social and website publishing (flag: publish). Variations, a content calendar with hand approval,
// and website publish with a plan, a preview copy, a live deploy and rollback. The server runs on a temp
// data dir, the hosts are loopback mocks, and nothing leaves the machine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { captionVariations, hashtagsFor, hashOf, normalize, LIMITS } from "../server/publish/plus.js";
import { planSite, safePath, collectFiles, siteHash } from "../server/publish/sites.js";
import { buildPayload } from "../server/plugins/publish.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);

test("flag is off by default, env turns it on or off, other flags stay", () => {
  const was = process.env.CC_FLAG_PUBLISH;
  try {
    delete process.env.CC_FLAG_PUBLISH;
    assert.equal(flagOn("publish"), false);
    assert.equal(flagView().publish, false);
    assert.equal(flagView().finishrouter, true);
    assert.ok("projectmedia" in flagView() && "nextactions" in flagView() && "promptdrop" in flagView() && "projectbar" in flagView());
    process.env.CC_FLAG_PUBLISH = "1";
    assert.equal(flagOn("publish"), true);
    assert.equal(flagView().publish, true);
    process.env.CC_FLAG_PUBLISH = "0";
    assert.equal(flagOn("publish"), false);
  } finally { if (was === undefined) delete process.env.CC_FLAG_PUBLISH; else process.env.CC_FLAG_PUBLISH = was; }
});

test("variations: platform limits hold, hashtags are capped, an empty caption says so", () => {
  const text = "We just opened a new bakery in Sacramento. Fresh sourdough every morning, baked on site. Come say hello!";
  const x = captionVariations({ text, platform: "x" });
  assert.ok(x.variations.length >= 3);
  for (const v of x.variations) { assert.ok(v.text.length <= 280, `${v.id} is ${v.text.length}`); assert.equal(v.fits, true); assert.ok(v.tags <= LIMITS.x.tags); }
  const ig = captionVariations({ text, platform: "instagram" });
  assert.ok(ig.variations.some((v) => v.tags > 0 && v.tags <= 30));
  assert.ok(ig.variations.find((v) => v.id === "clean").tags === 0);
  assert.ok(ig.variations.every((v) => !v.text.includes(DASH)));
  const slack = captionVariations({ text, platform: "slack" });
  assert.ok(slack.variations.every((v) => v.tags === 0), "Slack gets no hashtags");
  assert.ok(captionVariations({ text: "   " }).note);
  assert.deepEqual(hashtagsFor("#Local bread bread bread flour", { limit: 3 }).slice(0, 2), ["#Local", "#bread"]);
  const long = captionVariations({ text: "word ".repeat(700), platform: "x" });
  assert.ok(long.variations.every((v) => v.text.length <= 280));
});

test("a calendar hash matches the hash of the stored preview payload", () => {
  const item = { channel: "ghl", title: "Sale", text: "Big sale", mediaUrl: " https://cdn.example/a.jpg ", when: Date.now() + 86400000, accountIds: ["b", "a"], channelId: "" };
  const pl = buildPayload({ ...item, when: item.when }, null);
  assert.equal(hashOf(item), hashOf(pl));
  assert.notEqual(hashOf(item), hashOf({ ...item, text: "Big sale!" }));
  assert.notEqual(hashOf(item), hashOf({ ...item, accountIds: ["a"] }));
  assert.equal(normalize({ channel: "instagram", text: "x", when: Date.now() + 5000 }).when, null, "only HighLevel holds a post for later");
  const ig = { channel: "instagram", title: "t", text: "hi", mediaUrl: "https://x.example/a.jpg" };
  assert.equal(hashOf(ig), hashOf(buildPayload(ig, null)));
});

test("site plan: files, problems, a stable hash that changes with the files, the host or live/preview", () => {
  const draft = { id: "bd-1", name: "Bakery", files: [{ path: "index.html", text: "<h1>Hi</h1>" }, { path: "css/a.css", text: "h1{}" }, { path: "../evil.txt", text: "x" }, { path: "/abs.txt", text: "ok" }] };
  assert.equal(safePath("../x"), null); assert.equal(safePath("a\\b"), null); assert.equal(safePath("/a/b.html"), "a/b.html");
  assert.deepEqual(collectFiles(draft).map((f) => f.path), ["abs.txt", "css/a.css", "index.html"]);
  const cfg = { project: "bakery", accountId: "acc1" };
  const a = planSite({ draft, target: "cloudflare", production: false, config: cfg, connected: true });
  assert.equal(a.ready, true); assert.equal(a.count, 3); assert.equal(a.mode, "Preview copy"); assert.match(a.summary, /live site does not change/);
  const b = planSite({ draft, target: "cloudflare", production: true, config: cfg, connected: true });
  assert.notEqual(a.hash, b.hash); assert.match(b.summary, /LIVE site/);
  assert.equal(a.hash, planSite({ draft, target: "cloudflare", production: false, config: cfg, connected: true }).hash);
  draft.files[1].text = "h1{color:red}";
  assert.notEqual(a.hash, planSite({ draft, target: "cloudflare", production: false, config: cfg, connected: true }).hash);
  const none = planSite({ draft: { files: [{ path: "a.txt", text: "x" }] }, target: "netlify", config: {}, connected: false });
  assert.ok(none.problems.some((p) => /index\.html/.test(p)) && none.problems.some((p) => /site id/i.test(p)));
  assert.equal(none.ready, false); assert.equal(none.dryRun, true);
  assert.throws(() => planSite({ draft, target: "nope" }), /Pick Cloudflare/);
  assert.equal(siteHash({ target: "vercel", production: true, files: [], config: {} }).length, 24);
});

test("source: no em dash, wrapping text, buttons are wired by data attributes, no token is echoed", () => {
  for (const f of [["server", "publish", "plus.js"], ["server", "publish", "sites.js"], ["server", "plugins", "publishplus.js"], ["web", "features", "publish-plus.js"], ["test", "publishplus.test.js"]]) {
    assert.ok(!read(...f).includes(DASH), `${f.join("/")} has an em dash`);
  }
  const ui = read("web", "features", "publish-plus.js");
  assert.match(ui, /overflow-wrap:anywhere/); assert.match(ui, /word-break:break-word/);
  assert.match(ui, /sandbox=""/, "the site preview runs with scripts off");
  for (const m of ui.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /data-pp/, m[0]);
  assert.ok(!/value="\$\{[^}]*tok/i.test(ui), "a saved token is never put back in a field");
  assert.ok(read("web", "perf", "registry.js").includes('id: "publishplus"'));
});

// ---------- the running server, with loopback hosts ----------
let s, mock, calls, ghlPosts;
const sha = (t, a = "sha256") => crypto.createHash(a).update(t).digest("hex");
const INDEX = "<!doctype html><title>Bakery</title><h1>Fresh bread</h1>";

function startMock() {
  calls = []; ghlPosts = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || "", ct: req.headers["content-type"] || "", raw });
      const out = (code, o) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith("/social-media-posting/")) {
        if (req.method === "GET") return out(200, { results: { accounts: [{ id: "acc-1", name: "Bakery page", platform: "facebook" }] } });
        ghlPosts.push(JSON.parse(raw)); return out(200, { results: { post: { _id: "ghlpost1" } }, id: "ghlpost1" });
      }
      if (req.url === "/api/v1/sites/site1/deploys" && req.method === "POST") { const b = JSON.parse(raw); return out(200, { id: b.draft ? "nd-prev" : "nd-live", required: Object.values(b.files), deploy_ssl_url: "https://nd.example.test" }); }
      if (req.url.startsWith("/api/v1/deploys/") && req.method === "PUT") return out(200, {});
      if (/\/restore$/.test(req.url)) return out(200, { ssl_url: "https://restored.example.test" });
      if (req.url === "/v13/deployments") return out(200, { id: "vd-" + (JSON.parse(raw).target || "prev"), url: "bakery-abc.vercel.example" });
      if (/\/promote\//.test(req.url)) return out(200, {});
      if (/\/pages\/projects\/pr\/deployments$/.test(req.url)) return out(200, { success: true, result: { id: "cd-1", url: "https://cd1.pages.example" } });
      if (/\/rollback$/.test(req.url)) return out(200, { success: true, result: { url: "https://rolled.pages.example" } });
      out(404, { message: "no" });
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

before(async () => {
  mock = await startMock();
  const u = `http://127.0.0.1:${mock.address().port}`;
  s = await startServer({
    env: { CC_FLAG_PUBLISH: "1", CC_GHL_API_URL: u, CC_NETLIFY_API: u, CC_VERCEL_API: u, CC_CLOUDFLARE_API: u },
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, "builders.drafts.json"), JSON.stringify({ items: [
        { id: "bd-site", builderId: "landing", name: "Bakery site", files: [{ path: "index.html", text: INDEX }, { path: "about/index.html", text: "<p>About</p>" }] },
        { id: "bd-empty", builderId: "calendar", name: "Posts only", files: [] },
      ] }));
    },
  });
});
after(async () => { await s?.stop(); await new Promise((r) => mock?.close(r)); });

test("calendar: nothing is sent without approval of the exact post, and any edit takes the approval away", async () => {
  await s.api("/publish/keys", { method: "POST", body: { channel: "ghl", token: "test-ghl-token-123", locationId: "loc1" } });
  const when = Date.now() + 3 * 3600000;
  const add = await s.api("/publishplus/calendar", { method: "POST", body: { channel: "ghl", title: "Bread day", text: "Fresh bread today #bakery", when, accountIds: ["acc-1"] } });
  assert.equal(add.status, 200); assert.equal(add.json.approved, false); assert.equal(add.json.status, "draft");
  const id = add.json.id;

  const pv = await s.api("/publish/preview", { method: "POST", body: add.json.payload });
  assert.equal(pv.status, 200); assert.equal(pv.json.ready, true); assert.deepEqual(pv.json.problems, []);

  // not approved yet: refused, and the preview is still good afterwards
  const no = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv.json.previewId, confirmed: true, calendarId: id } });
  assert.equal(no.status, 409); assert.equal(no.json.code, "not_approved"); assert.equal(ghlPosts.length, 0);

  // approval needs the click and the exact hash
  assert.equal((await s.api(`/publishplus/calendar/${id}/approve`, { method: "POST", body: { hash: add.json.hash } })).json.code, "confirm_required");
  const stale = await s.api(`/publishplus/calendar/${id}/approve`, { method: "POST", body: { hash: "0".repeat(24), confirmed: true } });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, "changed");
  const ok = await s.api(`/publishplus/calendar/${id}/approve`, { method: "POST", body: { hash: add.json.hash, confirmed: true } });
  assert.equal(ok.status, 200); assert.equal(ok.json.approved, true); assert.equal(ok.json.status, "approved");

  // an edit removes the approval, even a one-character edit
  const ed = await s.api(`/publishplus/calendar/${id}`, { method: "PUT", body: { text: "Fresh bread today #bakery!" } });
  assert.equal(ed.json.approved, false); assert.equal(ed.json.status, "draft");
  const after = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv.json.previewId, confirmed: true, calendarId: id } });
  assert.equal(after.status, 409); assert.equal(after.json.code, "not_approved");
  assert.equal(ghlPosts.length, 0, "still nothing sent");

  // approve the edited post; a preview of the OLD text no longer matches
  assert.equal((await s.api(`/publishplus/calendar/${id}/approve`, { method: "POST", body: { hash: ed.json.hash, confirmed: true } })).status, 200);
  const mismatch = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv.json.previewId, confirmed: true, calendarId: id } });
  assert.equal(mismatch.status, 409); assert.equal(mismatch.json.code, "mismatch"); assert.equal(ghlPosts.length, 0);

  // the matching preview, the confirm click and the approval together send exactly the approved text
  const pv2 = await s.api("/publish/preview", { method: "POST", body: ed.json.payload });
  const go = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv2.json.previewId, confirmed: true, calendarId: id } });
  assert.equal(go.status, 200); assert.equal(go.json.status, "posted");
  assert.equal(ghlPosts.length, 1); assert.equal(ghlPosts[0].summary, "Fresh bread today #bakery!"); assert.equal(ghlPosts[0].status, "scheduled");
  assert.deepEqual(ghlPosts[0].accountIds, ["acc-1"]);
  const cal = (await s.api("/publishplus/calendar")).json.items.find((x) => x.id === id);
  assert.equal(cal.status, "sent"); assert.equal(cal.historyId, go.json.id);
  assert.equal((await s.api(`/publishplus/calendar/${id}`, { method: "PUT", body: { text: "again" } })).status, 409, "a sent post cannot be edited");
  const dup = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv2.json.previewId, confirmed: true, calendarId: id } });
  assert.equal(dup.status, 409, "one preview, one post");
  assert.equal(ghlPosts.length, 1);
});

test("calendar: Instagram and Slack items ignore the planned time; a bad channel or empty text is refused; delete works", async () => {
  const ig = await s.api("/publishplus/calendar", { method: "POST", body: { channel: "instagram", text: "Photo post", mediaUrl: "https://cdn.example/a.jpg", when: Date.now() + 99999 } });
  assert.equal(ig.json.payload.when, null, "Instagram has no later-send");
  assert.equal((await s.api("/publishplus/calendar", { method: "POST", body: { channel: "tiktok", text: "x" } })).status, 400);
  assert.equal((await s.api("/publishplus/calendar", { method: "POST", body: { channel: "slack", text: "  " } })).status, 400);
  assert.equal((await s.api(`/publishplus/calendar/${ig.json.id}`, { method: "DELETE" })).json.ok, true);
  assert.equal((await s.api("/publishplus/calendar/cal-nope/approve", { method: "POST", body: { hash: "x", confirmed: true } })).status, 404);
  // a plain /publish/post with no calendarId still works as before
  const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", text: "hello" } });
  const post = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: pv.json.previewId, confirmed: true } });
  assert.equal(post.json.status, "dry-run");
});

test("variations route and status route", async () => {
  const v = await s.api("/publishplus/variations", { method: "POST", body: { text: "New menu is out. Come taste it!", platform: "linkedin" } });
  assert.equal(v.status, 200); assert.ok(v.json.variations.length >= 3);
  const st = await s.api("/publishplus/status");
  assert.deepEqual(st.json.targets.map((t) => t.id).sort(), ["cloudflare", "netlify", "vercel"]);
  assert.ok(st.json.targets.every((t) => t.connected === false));
});

test("website: tokens go to the vault and never come back; plan, preview copy, live deploy and rollback each need the click", async () => {
  const TOKEN = "nf-token-SECRET-123456";
  assert.equal((await s.api("/publishplus/sites/connect", { method: "POST", body: { target: "netlify", token: "x" } })).status, 400);
  const con = await s.api("/publishplus/sites/connect", { method: "POST", body: { target: "netlify", token: TOKEN } });
  assert.equal(con.status, 200); assert.ok(!JSON.stringify(con.json).includes(TOKEN));
  assert.ok(!JSON.stringify((await s.api("/publishplus/status")).json).includes(TOKEN));
  assert.equal((await s.api("/publishplus/sites/config", { method: "POST", body: { target: "netlify", siteId: "bad id!" } })).status, 400);
  assert.equal((await s.api("/publishplus/sites/config", { method: "POST", body: { target: "netlify", siteId: "site1" } })).status, 200);

  const drafts = (await s.api("/publishplus/sites/drafts")).json.items;
  assert.deepEqual(drafts.map((d) => d.id), ["bd-site"], "a draft with no files is not offered");

  // preview copy
  const plan = (await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: false } })).json;
  assert.equal(plan.ready, true); assert.equal(plan.count, 2); assert.match(plan.previewHtml, /Fresh bread/);
  const before = calls.length;
  const noClick = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: false, hash: plan.hash } });
  assert.equal(noClick.json.code, "confirm_required"); assert.equal(calls.length, before, "nothing sent without the click");
  const wrongHash = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: false, hash: "0".repeat(24), confirmed: true } });
  assert.equal(wrongHash.status, 409); assert.equal(wrongHash.json.code, "plan_changed"); assert.equal(calls.length, before);
  // a preview plan's hash cannot be used for a live deploy
  const asLive = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: true, hash: plan.hash, confirmed: true } });
  assert.equal(asLive.status, 409); assert.equal(calls.length, before);

  const prev = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: false, hash: plan.hash, confirmed: true } });
  assert.equal(prev.status, 200); assert.equal(prev.json.status, "deployed"); assert.equal(prev.json.deployId, "nd-prev");
  const mk = calls.find((c) => c.url === "/api/v1/sites/site1/deploys");
  assert.equal(mk.auth, `Bearer ${TOKEN}`); assert.equal(JSON.parse(mk.raw).draft, true, "a preview copy is a draft deploy");
  assert.equal(calls.filter((c) => c.method === "PUT").length, 2, "both files uploaded");
  assert.equal(JSON.parse(mk.raw).files["/index.html"], sha(INDEX, "sha1"));

  // live deploy: its own plan, its own click
  const lp = (await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: true } })).json;
  assert.match(lp.summary, /LIVE site/);
  const live = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: true, hash: lp.hash, confirmed: true } });
  assert.equal(live.json.status, "deployed"); assert.equal(live.json.deployId, "nd-live");
  assert.equal(JSON.parse(calls.filter((c) => c.url === "/api/v1/sites/site1/deploys").at(-1).raw).draft, false);

  // a second live deploy, then roll back to the first
  const live2 = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "netlify", production: true, hash: lp.hash, confirmed: true } });
  assert.equal(live2.json.status, "deployed");
  let hist = (await s.api("/publishplus/sites/history")).json.items;
  const lives = hist.filter((x) => x.production && x.status === "deployed");
  assert.equal(lives.length, 2); assert.equal(lives[0].live, true); assert.equal(lives[0].canRollBack, false, "the newest live deploy is already live");
  assert.equal(lives[1].canRollBack, true); assert.equal(hist.find((x) => !x.production).canRollBack, false, "a preview is not a rollback target");
  const rp = (await s.api("/publishplus/sites/rollback-plan", { method: "POST", body: { historyId: lives[1].id } })).json;
  assert.match(rp.summary, /go back to the one you published/);
  const beforeRb = calls.length;
  assert.equal((await s.api("/publishplus/sites/rollback", { method: "POST", body: { historyId: lives[1].id } })).json.code, "confirm_required");
  assert.equal(calls.length, beforeRb);
  const rb = await s.api("/publishplus/sites/rollback", { method: "POST", body: { historyId: lives[1].id, confirmed: true } });
  assert.equal(rb.status, 200); assert.equal(rb.json.status, "rolled-back");
  assert.ok(calls.some((c) => c.method === "POST" && c.url === `/api/v1/sites/site1/deploys/${lives[1].deployId}/restore`));
  hist = (await s.api("/publishplus/sites/history")).json.items;
  const nowLives = hist.filter((x) => x.production && x.status === "deployed");
  assert.equal(nowLives.find((x) => x.live).id, lives[1].id, "the older one is live now");
  assert.equal((await s.api("/publishplus/sites/rollback", { method: "POST", body: { historyId: lives[1].id, confirmed: true } })).status, 409, "already live");

  // the token never appears in the history or the log
  assert.ok(!JSON.stringify(hist).includes(TOKEN)); assert.ok(!s.log.includes(TOKEN));
});

test("website: Vercel and Cloudflare Pages send the right shape; an unconnected host records a dry run", async () => {
  await s.api("/publishplus/sites/connect", { method: "POST", body: { target: "vercel", token: "vc-token-abcdef12" } });
  await s.api("/publishplus/sites/config", { method: "POST", body: { target: "vercel", project: "bakery" } });
  const vp = (await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-site", target: "vercel", production: true } })).json;
  const vd = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "vercel", production: true, hash: vp.hash, confirmed: true } });
  assert.equal(vd.json.status, "deployed"); assert.equal(vd.json.url, "https://bakery-abc.vercel.example");
  const vc = calls.find((c) => c.url === "/v13/deployments");
  const vb = JSON.parse(vc.raw);
  assert.equal(vb.target, "production"); assert.deepEqual(vb.files.map((f) => f.file), ["about/index.html", "index.html"]); assert.equal(vc.auth, "Bearer vc-token-abcdef12");

  // Cloudflare Pages is not connected yet: the plan says so and a deploy is a dry run that sends nothing
  await s.api("/publishplus/sites/config", { method: "POST", body: { target: "cloudflare", accountId: "acc9", project: "pr" } });
  const cp = (await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-site", target: "cloudflare", production: false } })).json;
  assert.equal(cp.dryRun, true);
  const n = calls.length;
  const dry = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "cloudflare", production: false, hash: cp.hash, confirmed: true } });
  assert.equal(dry.json.status, "dry-run"); assert.equal(calls.length, n);
  await s.api("/publishplus/sites/connect", { method: "POST", body: { target: "cloudflare", token: "cf-token-abcdef12" } });
  await s.api("/publishplus/sites/config", { method: "POST", body: { target: "cloudflare", accountId: "acc9" } });
  const cd = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-site", target: "cloudflare", production: false, hash: cp.hash, confirmed: true } });
  assert.equal(cd.json.status, "deployed", JSON.stringify(cd.json)); assert.equal(cd.json.url, "https://cd1.pages.example");
  const cc = calls.find((c) => /\/pages\/projects\/pr\/deployments$/.test(c.url));
  assert.equal(cc.auth, "Bearer cf-token-abcdef12");
  assert.match(cc.ct, /multipart\/form-data/);
  assert.match(cc.raw, /name="manifest"/);
  assert.match(cc.raw, /"\/index\.html"/);
  assert.match(cc.raw, /name="branch"\r\n\r\npreview/);
});

test("website: missing pieces are problems, and a failed host never leaks the token", async () => {
  const none = (await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-empty", target: "netlify" } })).json;
  assert.ok(none.problems.length && none.ready === false);
  const blocked = await s.api("/publishplus/sites/deploy", { method: "POST", body: { draftId: "bd-empty", target: "netlify", hash: none.hash, confirmed: true } });
  assert.equal(blocked.status, 400); assert.equal(blocked.json.code, "plan_problems");
  assert.equal((await s.api("/publishplus/sites/plan", { method: "POST", body: { draftId: "bd-site", target: "nope" } })).status, 400);
  assert.equal((await s.api("/publishplus/sites/connect/netlify", { method: "DELETE" })).json.connected, false);
});

test("flag off: every route says so and nothing changes", async () => {
  const off = await startServer({ env: { CC_FLAG_PUBLISH: "0" } });
  try {
    for (const [m, p] of [["GET", "/publishplus/status"], ["GET", "/publishplus/calendar"], ["POST", "/publishplus/variations"], ["GET", "/publishplus/sites/drafts"]]) {
      const r = await off.api(p, { method: m, body: m === "POST" ? {} : undefined });
      assert.equal(r.status, 404, p); assert.equal(r.json.code, "flag_off");
    }
    const st = await off.api("/state");
    assert.equal(st.json.flags.publish, false);
    // the old publish routes are untouched, and a calendarId means nothing while the flag is off
    const pv = await off.api("/publish/preview", { method: "POST", body: { channel: "slack", text: "hi" } });
    const post = await off.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: pv.json.previewId, confirmed: true, calendarId: "cal-x" } });
    assert.equal(post.status, 200); assert.equal(post.json.status, "dry-run");
  } finally { await off.stop(); }
});
