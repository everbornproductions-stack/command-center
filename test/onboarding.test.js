// Setup shows once. A completed flag (with a version) in the data folder, or any existing
// history (vault keys, saved settings, chats/jobs, bookmarks), keeps the hub on later launches.
// The background catalog check runs at most once per 24 hours and only names what is new.
// No real keys, no browser profiles, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  DAY_MS, ONBOARDING_VERSION, historyReasons, planOnboarding, applyDailyCheck,
  completeRecord, shouldOpenSetup, noticeText, normalizeRecord,
} from "../server/onboarding.js";

const DEFAULTS = { budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Meldmind" };
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const hist = (extra = {}) => historyReasons({ settings: DEFAULTS, defaults: DEFAULTS, ...extra });
const open = (history, record) => planOnboarding({ record, history, now: 1_700_000_000_000 });

test("fresh install with factory settings shows setup", () => {
  const history = hist();
  assert.deepEqual(history, []);
  const plan = open(history, null);
  assert.equal(plan.show, true);
  assert.equal(plan.changed, false);
  assert.equal(shouldOpenSetup({ mode: "local", show: plan.show, legacyOnboarded: false }), true);
  assert.equal(shouldOpenSetup({ mode: "hosted", show: true, legacyOnboarded: false }), false);
});

test("onboarding is not shown when the completed flag or existing keys are present", () => {
  const flagged = open([], { version: 1, completed: true, reason: "user" });
  assert.equal(flagged.show, false);
  assert.equal(flagged.reason, "user");
  assert.equal(shouldOpenSetup({ mode: "local", show: false, legacyOnboarded: false }), false);

  const older = open([], { version: 2, completed: true, reason: "user" });
  assert.equal(older.show, false, "a completed flag from another version still counts; setup does not run again");
  assert.equal(older.record.version, ONBOARDING_VERSION);

  const keys = hist({ vaultKeyIds: ["google"] });
  assert.deepEqual(keys, ["vault"]);
  const migrated = open(keys, null);
  assert.equal(migrated.show, false);
  assert.equal(migrated.reason, "vault");
  assert.equal(migrated.changed, true);
  assert.equal(migrated.record.completed, true);
  assert.equal(migrated.record.version, ONBOARDING_VERSION);
  assert.equal(JSON.stringify(migrated.record).includes("AIza"), false);

  assert.deepEqual(hist({ vaultKeyIds: ["demo-nova", "demo-atlas"] }), [], "pretend demo keys are not history");
  assert.equal(open(hist({ vaultKeyIds: ["demo-nova"] }), null).show, true);
});

test("saved settings, past jobs and bookmarks each count as setup already done", () => {
  assert.deepEqual(hist({ settings: { ...DEFAULTS, budgetMonthly: 40 } }), ["settings"]);
  assert.equal(open(hist({ settings: { ...DEFAULTS, budgetMonthly: 40 } }), null).show, false);
  assert.deepEqual(hist({ settings: { ...DEFAULTS, onboarded: true } }), ["flag"]);
  assert.equal(open(hist({ settings: { ...DEFAULTS, onboarded: false } }), null).show, true, "factory settings plus an explicit false flag are still a new install");

  const secretish = { ...DEFAULTS, cloud: { url: "http://127.0.0.1", anonKey: "not-a-real-key" } };
  const saved = open(hist({ settings: secretish }), null);
  assert.equal(saved.show, false);
  assert.equal(saved.reason, "settings");
  assert.equal(JSON.stringify(saved.record).includes("not-a-real-key"), false, "onboarding.json never stores setting secrets");

  assert.deepEqual(hist({ ledgerCount: 2 }), ["jobs"]);
  assert.deepEqual(hist({ missionCount: 1 }), ["jobs"]);
  assert.equal(open(hist({ ledgerCount: 1 }), null).show, false);
  assert.deepEqual(hist({ bookmarkCount: 3 }), ["bookmarks"]);
  assert.equal(open(hist({ bookmarkCount: 1 }), null).show, false);
  assert.equal(open(hist({ bookmarkCount: 0, ledgerCount: 0 }), null).show, true);
});

test("daily check is throttled to once per 24h and only integrates what is new", () => {
  const t0 = 1_700_000_000_000;
  const base = [
    { id: "anthropic", name: "Claude", models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }] },
    { id: "google", name: "Google Gemini", models: [{ id: "gemini-4-argon", name: "Gemini 4 Argon" }] },
  ];
  const done = completeRecord(null, t0);
  assert.equal(applyDailyCheck({ record: { completed: false }, catalog: base, now: t0 }).skipped, true, "no background check before setup is done");

  let step = applyDailyCheck({ record: done, catalog: base, keyIds: [], now: t0 });
  assert.equal(step.ran, true);
  assert.equal(step.notice, null, "the first look only records history; it does not announce everything");
  assert.equal(step.record.catalogBaselined, true);
  assert.ok(step.record.known.providers.includes("google"));
  assert.ok(step.record.known.models.includes("gemini-4-argon"));

  const again = applyDailyCheck({ record: step.record, catalog: base, now: t0 + DAY_MS - 1 });
  assert.equal(again.ran, false);
  assert.equal(again.throttled, true);
  assert.equal(again.record.lastDailyCheckAt, t0);

  const grown = [
    ...base.map((p) => p.id === "google" ? { ...p, models: [...p.models, { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] } : p),
    { id: "groq", name: "Groq", models: [{ id: "llama-3.3-70b", name: "Llama 3.3 70B" }] },
  ];
  step = applyDailyCheck({ record: step.record, catalog: grown, keyIds: ["google", "groq"], now: t0 + DAY_MS });
  assert.equal(step.ran, true);
  assert.equal(step.throttled, false);
  assert.equal(step.notice, "New: Gemini 3.8 Flash, Groq, Google Gemini key added");
  assert.equal(step.added.includes("Groq"), true);
  assert.equal(step.added.includes("Llama 3.3 70B"), false, "a brand-new provider is one notice, not one per model");
  assert.equal(step.added.includes("Groq key"), false, "a key for a provider that was just added is not a second notice");
  assert.equal(step.added.includes("Google Gemini key"), true, "a new key on a provider already in history is integrated on its own");
  assert.ok(step.record.known.models.includes("llama-3.3-70b"));
  assert.ok(step.record.known.keys.includes("google"));
  assert.equal(JSON.stringify(step.record).includes("AIza"), false);
  assert.doesNotMatch(step.notice, /\u2014/);

  const keyOnly = applyDailyCheck({
    record: { ...step.record, lastDailyCheckAt: t0 },
    catalog: grown,
    keyIds: ["google", "groq", "anthropic"],
    now: t0 + DAY_MS * 2,
  });
  assert.equal(keyOnly.notice, "New: Claude key added");
  assert.deepEqual(noticeText(["One", "Two", "Three", "Four"]), "New: One, Two, Three and 1 more added");
});

test("the hub skips setup from the server flag, and bookmarks are not part of the daily check", () => {
  const app = read("web", "app.js");
  const main = read("electron", "main.cjs");
  const server = read("server", "index.js");
  const mod = read("server", "onboarding.js");
  assert.match(app, /S\.mode !== "hosted" && !S\.visitedSetup && \(S\.onboarding \? S\.onboarding\.show === true : !S\.settings\?\.onboarded\)/);
  assert.match(app, /Run setup again/);
  assert.doesNotMatch(app, /localStorage\.setItem\(["']cc\.onboard/);
  assert.match(main, /onboarding\.json/);
  assert.match(main, /storages: \["serviceworkers", "cachestorage"\]/);
  assert.doesNotMatch(mod, /scanHistory|applyToBrowser|bookmarksHtml|detectKeys|localStorage/);
  const daily = server.slice(server.indexOf("function runDailyCheck"), server.indexOf("function fullState"));
  assert.doesNotMatch(daily, /scanHistory|applyToBrowser|bookmarksHtml|detectKeys/);
  assert.match(server, /budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Meldmind"/);
  assert.match(read("docs", "DECISIONS.md"), /Onboarding runs once; daily background check only\./);
});

test("server: setup stays closed for a completed flag, saved settings, jobs or bookmarks", async () => {
  const flagged = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({
    version: 1, completed: true, reason: "user", catalogBaselined: true, lastDailyCheckAt: Date.now(),
    known: { providers: ["anthropic"], models: [], keys: [] }, notice: null,
  })) });
  const saved = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ ...DEFAULTS, budgetMonthly: 40 })) });
  const jobs = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "ledger.jsonl"), JSON.stringify({ ts: 1, kind: "call", provider: "openai", model: "gpt-test", cost: 0 }) + "\n") });
  const marks = await startServer({ seed: (dir) => {
    fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: [{ id: "my-project", name: "My project", categories: [{ id: "links", name: "Links", links: [{ name: "Site", url: "https://example.com" }] }] }] }));
    fs.writeFileSync(path.join(dir, "bookmarks-backup-chrome-Default-1.json"), "{}");
  } });
  try {
    const flag = await flagged.api("/onboarding");
    assert.equal(flag.json.show, false);
    assert.equal(flag.json.completed, true);
    assert.equal(flag.json.version, 1);
    assert.equal((await flagged.api("/state")).json.onboarding.show, false);
    assert.equal((await flagged.api("/state")).json.settings.onboarded, true, "legacy flag is filled in so older code agrees");

    const settingsView = await saved.api("/onboarding");
    assert.equal(settingsView.json.show, false);
    assert.equal(settingsView.json.reason, "settings");
    const savedFile = JSON.parse(fs.readFileSync(path.join(saved.dir, "onboarding.json"), "utf8"));
    assert.equal(savedFile.completed, true);
    assert.equal(savedFile.version, ONBOARDING_VERSION);
    assert.equal(savedFile.reason, "settings");

    assert.equal((await jobs.api("/onboarding")).json.show, false);
    assert.equal((await jobs.api("/onboarding")).json.reason, "jobs");
    assert.equal((await marks.api("/onboarding")).json.show, false);
    assert.equal((await marks.api("/onboarding")).json.reason, "bookmarks");
    for (const s of [flagged, saved, jobs, marks]) {
      assert.doesNotMatch(s.log, /AI bookmark folder|scanHistory|Bookmarks added/i);
      assert.doesNotMatch(JSON.stringify((await s.api("/onboarding")).json), /sk-|AIza|api[_-]?key/i);
    }
  } finally {
    await Promise.all([flagged, saved, jobs, marks].map((s) => s.stop()));
  }
});

test("server: a new install can finish once, then the daily check refuses a second run", async () => {
  const s = await startServer();
  try {
    const first = await s.api("/onboarding");
    assert.equal(first.json.show, true);
    assert.equal(first.json.completed, false);
    assert.equal(fs.existsSync(path.join(s.dir, "onboarding.json")), false, "a new install does not write the flag until setup is finished");
    const early = await s.api("/onboarding/check", { method: "POST", body: {} });
    assert.equal(early.json.skipped, true);
    assert.equal(early.json.ran, false);

    const done = await s.api("/setup/done", { method: "POST", body: {} });
    assert.equal(done.json.onboarded, true);
    const file = JSON.parse(fs.readFileSync(path.join(s.dir, "onboarding.json"), "utf8"));
    assert.equal(file.completed, true);
    assert.equal(file.version, ONBOARDING_VERSION);
    assert.equal(file.catalogBaselined, true, "finishing setup records the current catalog so later checks only see what is new");
    assert.equal(file.notice, null);
    assert.equal((await s.api("/onboarding")).json.show, false);

    const second = await s.api("/onboarding/check", { method: "POST", body: {} });
    assert.equal(second.json.ran, false);
    assert.equal(second.json.throttled, true);
    assert.equal(second.json.notice, null);
    assert.doesNotMatch(s.log, /AI bookmark folder|Bookmarks added/i);
    const backups = fs.readdirSync(s.dir).filter((f) => f.startsWith("bookmarks-backup-"));
    assert.equal(backups.length, 0, "bookmark organizing does not run on launch or on the daily check");
  } finally { await s.stop(); }
});

test("server: a due daily check names only a provider that was not already in history", async () => {
  const s = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({
    version: 1, completed: true, reason: "vault", catalogBaselined: true,
    lastDailyCheckAt: Date.now() - DAY_MS - 60_000,
    known: { providers: ["anthropic"], models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], keys: [] },
    notice: null,
  })) });
  try {
    const ran = await s.api("/onboarding/check", { method: "POST", body: {} });
    const view = await s.api("/onboarding");
    const notice = ran.json.notice || view.json.notice;
    assert.ok(notice, "a check more than 24h after the last one integrates what the history did not already have");
    assert.match(notice, /^New: .+ added$/);
    assert.doesNotMatch(notice, /\u2014|bookmark/i);
    const file = JSON.parse(fs.readFileSync(path.join(s.dir, "onboarding.json"), "utf8"));
    assert.ok(file.known.providers.includes("google"), "Google Gemini was not in history, so it is integrated");
    assert.ok(file.known.providers.includes("anthropic"), "a provider already in history stays");
    assert.equal(file.known.providers.includes("demo-nova"), false);
    assert.equal(JSON.stringify(file).includes("AIza"), false);
    const again = await s.api("/onboarding/check", { method: "POST", body: {} });
    assert.equal(again.json.throttled, true);
    assert.equal(again.json.ran, false);
  } finally { await s.stop(); }
});
