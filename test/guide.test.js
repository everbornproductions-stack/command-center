// Help and tour refresh. Steps and the "What can Meldmind do?" list share one guide.
// A row is hidden when its page is not in the app. Prices are the plan, not the Square link.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GUIDE, PLAN, liveProbe, matchesQuery, rememberWalks, tourSteps, visibleGuide } from "../web/features/guide.js";
import { loadHelp } from "../server/help.js";
import { ROOT } from "./helpers.js";

const EM = "\u2014";
const EN = "\u2013";

const MAIN = {
  features: ["start", "search", "mcp", "schedules", "publish", "browser", "workspaces", "brain", "tour", "help"],
  views: ["command", "projects", "credits", "subscriptions", "settings", "setup", "help", "start", "schedules", "publish", "workspaces", "brain"],
  walks: ["website", "music-video", "marketing", "app", "business-plan", "reels"],
  builtins: ["hub", "council", "mission", "phone", "whats-new"],
};

function ids(probe) {
  return tourSteps(probe).map((s) => s.id);
}

test("the short tour shows only pages that exist, in order, with one idea and Try it", () => {
  const steps = tourSteps(MAIN);
  assert.deepEqual(ids(MAIN), ["hub", "missions", "builders", "research", "connect", "safety", "teams", "whats-new"]);
  assert.ok(steps.length >= 6 && steps.length <= 8, `expected about 6 to 8 steps, got ${steps.length}`);
  for (const step of steps) {
    assert.equal(step.action, "try");
    assert.equal((step.body.match(/\./g) || []).length, 1, step.body);
    assert.ok(step.open?.view, step.id);
    assert.ok(MAIN.views.includes(step.open.view), `${step.id} opens a missing view ${step.open.view}`);
    assert.equal(step.body.includes(EM) || step.body.includes(EN), false);
  }
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.equal(byId.hub.tier, "free");
  assert.match(byId.hub.body, /one hub/i);
  assert.equal(byId.missions.tier, "pro");
  assert.equal(byId.missions.price, PLAN.pro.price);
  assert.match(byId.missions.body, /council/i);
  assert.match(byId.missions.body, /mission/i);
  assert.match(byId.missions.priceNote, /5 councils/);
  assert.match(byId.builders.body, /Start a project/);
  assert.match(byId.builders.body, /website/);
  assert.match(byId.builders.body, /marketing/);
  assert.match(byId.builders.body, /reels/);
  assert.doesNotMatch(byId.builders.body, /HighLevel|accounting|booking|contract/);
  assert.equal(byId.research.tier, "free");
  assert.doesNotMatch(byId.research.body, /Refocus/);
  assert.equal(byId.connect.open.view, "schedules");
  assert.match(byId.connect.body, /MCP/);
  assert.match(byId.connect.body, /webhooks/);
  assert.doesNotMatch(byId.connect.body, /Zapier/);
  assert.match(byId.safety.body, /phone/i);
  assert.equal(byId.safety.tier, "free");
  assert.match(byId.safety.priceNote, /\$18\.99/);
  assert.equal(byId.teams.tier, "pro");
  assert.match(byId.teams.priceNote, /Pro and Extreme/);
  assert.doesNotMatch(byId.teams.body, /PC is off/);
  assert.equal(byId["whats-new"].tier, "free");
  assert.equal(byId["whats-new"].open.article, "after-an-update");
  assert.equal(PLAN.pro.price, "$18.99 a month");
  assert.equal(PLAN.extreme.price, "$29.99 a month");
});

test("missing features stay hidden, and a new page shows up in order", () => {
  assert.deepEqual(ids({}), []);
  const noWalks = {
    ...MAIN,
    walks: [],
    views: MAIN.views.filter((id) => id !== "start"),
    features: MAIN.features.filter((id) => id !== "start"),
  };
  assert.ok(!ids(noWalks).includes("builders"));

  const withRemix = {
    ...MAIN,
    features: [...MAIN.features, "remix"],
    views: [...MAIN.views, "remix"],
  };
  const remixSteps = tourSteps(withRemix);
  assert.deepEqual(remixSteps.map((s) => s.id), ["hub", "missions", "remix", "builders", "research", "connect", "safety", "teams", "whats-new"]);
  const remix = remixSteps.find((s) => s.id === "remix");
  assert.equal(remix.tier, "pro");
  assert.match(remix.body, /screenshot/);
  assert.match(remix.body, /game starter/);
  assert.match(remix.body, /publish only when you click/);
  assert.match(remix.priceNote, /\$29\.99/);
  assert.equal(remix.open.view, "remix");

  const shotOnly = tourSteps({
    features: [],
    views: ["command", "screenshot-to-app", "help", "settings"],
    walks: [],
    builtins: [],
  });
  assert.deepEqual(shotOnly.map((s) => s.id), ["remix"]);
  assert.equal(shotOnly[0].open.view, "screenshot-to-app");
  assert.doesNotMatch(shotOnly[0].body, /publish/);

  const withRefocus = {
    ...MAIN,
    features: [...MAIN.features, "refocus"],
    views: [...MAIN.views, "refocus"],
  };
  const research = tourSteps(withRefocus).find((s) => s.id === "research");
  assert.equal(research.tier, "pro");
  assert.match(research.body, /Refocus/);
  assert.equal(research.open.view, "settings");

  const withHosted = {
    ...MAIN,
    features: [...MAIN.features, "hosted-runs", "userchat"],
    views: [...MAIN.views, "hosted-runs", "userchat"],
  };
  const teams = tourSteps(withHosted).find((s) => s.id === "teams");
  assert.equal(teams.tier, "extreme");
  assert.equal(teams.price, PLAN.extreme.price);
  assert.match(teams.body, /PC is off/);
  assert.match(teams.body, /Teams/);
  assert.match(teams.body, /People/);

  const withAccounting = {
    ...MAIN,
    views: [...MAIN.views, "accounting"],
  };
  const builders = tourSteps(withAccounting).find((s) => s.id === "builders");
  assert.match(builders.body, /accounting/);
  assert.equal(builders.open.view, "start");
});

test("the searchable list uses the same rows and the help articles exist", () => {
  const rows = visibleGuide(MAIN);
  assert.equal(matchesQuery(rows.find((r) => r.id === "missions"), "council"), true);
  assert.equal(matchesQuery(rows.find((r) => r.id === "hub"), "zapier remix"), false);
  assert.equal(rows.filter((r) => matchesQuery(r, "phone")).some((r) => r.id === "safety"), true);
  const pack = loadHelp();
  const ids = new Set(pack.articles.map((a) => a.id));
  for (const area of GUIDE) assert.ok(ids.has(area.helpId), area.helpId);
  assert.ok(ids.has("what-can-meldmind-do"));
  const help = fs.readFileSync(path.join(ROOT, "web", "features", "help.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(help, /What can Meldmind do\?/);
  assert.match(help, /\$18\.99 a month/);
  assert.match(help, /\$29\.99 a month/);
  assert.match(app, /guideBuiltins/);
  assert.match(app, /id="phone-pair"/);
  for (const file of ["web/features/guide.js", "web/features/tour.js", "web/features/help.js"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(text.includes(EM) || text.includes(EN), false, file);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pack.catalog.lastUpdatedVersion, pkg.version);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("live probe reads registered tabs, walks, and built-in pages", async () => {
  const cc = {
    features: [{ id: "remix", tab: { label: "Remix" } }, { id: "search" }, { id: "tour" }],
    guideWalks: ["website"],
    guideBuiltins: ["hub", "phone"],
  };
  const probe = liveProbe(cc);
  assert.ok(probe.views.has("remix"));
  assert.ok(probe.views.has("command"));
  assert.ok(probe.views.has("help"));
  assert.ok(probe.features.has("search"));
  assert.ok(!probe.views.has("search"));
  assert.ok(probe.walks.has("website"));
  assert.ok(probe.builtins.has("whats-new"));
  assert.ok(probe.builtins.has("phone"));
  const fresh = {};
  const walks = await rememberWalks(async () => ({ types: [{ id: "website" }, { id: "reels" }] }), fresh);
  assert.deepEqual(walks, ["website", "reels"]);
  assert.deepEqual(await rememberWalks(async () => ({ types: [] }), fresh), ["website", "reels"]);
});
