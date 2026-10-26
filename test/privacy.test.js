// Three-level learning and sharing defaults (0.4.18), regional consent (US vs EU/UK),
// anonymous quality signal payload validation, and Settings > Privacy disclosure.
// Server tests use a temp data dir, demo only, no real key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  decideShare,
  decideOnDevice,
  decideContentSharing,
  decideLearningLevels,
  isConsentFirstLocale,
  applyShareDefaults,
  buildQualitySignal,
  buildQualitySignalPayload,
  validateQualitySignalPayload,
  WELCOME_QUALITY_NOTICE,
  QUALITY_SENT_ITEMS,
  QUALITY_NEVER_ITEMS,
  QUALITY_SIGNALS_DETAIL,
  CONTENT_SHARING_LABEL,
  SENDERS,
  privacyView,
} from "../server/privacy.js";

const DASHES = /[–—]/;

test("US locale new install has levels 1 and 2 ON and level 3 OFF; EU and UK locale new install has level 1 ON, level 2 OFF, and level 3 OFF", () => {
  // US locale new install
  for (const loc of ["en-US", "en_US.UTF-8", "en-CA", "en-AU", "ja-JP", "pt-BR", "es-MX"]) {
    assert.equal(isConsentFirstLocale(loc), false, loc);
    const us = decideLearningLevels({ locale: loc, stored: {}, docExists: false, hasHistory: false });
    assert.equal(us.onDevice, true, `${loc} level 1 onDevice`);
    assert.equal(us.qualitySignals, true, `${loc} level 2 qualitySignals`);
    assert.equal(us.contentOptIn, false, `${loc} level 3 contentOptIn`);
  }

  // EU, EEA, UK, and CH locale new installs
  for (const loc of ["de-DE", "fr-FR", "en-GB", "es-ES", "it-IT", "nl-NL", "pl-PL", "sv-SE", "pt-PT", "en-IE", "de-AT", "de-CH", "no-NO", "EU", "UK"]) {
    assert.equal(isConsentFirstLocale(loc), true, loc);
    const eu = decideLearningLevels({ locale: loc, stored: {}, docExists: false, hasHistory: false });
    assert.equal(eu.onDevice, true, `${loc} level 1 onDevice`);
    assert.equal(eu.qualitySignals, false, `${loc} level 2 qualitySignals`);
    assert.equal(eu.contentOptIn, false, `${loc} level 3 contentOptIn`);
  }

  // Saved choices always win in any locale, and Level 3 is never pre-checked unless explicitly true.
  assert.equal(decideShare({ stored: true, locale: "de-DE" }), true);
  assert.equal(decideShare({ stored: false, locale: "en-US", hasHistory: true, docExists: true }), false);
  assert.equal(decideOnDevice({}), true);
  assert.equal(decideOnDevice({ stored: false }), false);
  assert.equal(decideContentSharing({}), false);
  assert.equal(decideContentSharing({ stored: "yes" }), false);
  assert.equal(decideContentSharing({ stored: true }), true);
});

test("applyShareDefaults: US vs EU new installs, and existing installs keep their choice and see the notice once", () => {
  const usWrites = {};
  const usFresh = applyShareDefaults({
    docs: {},
    hasHistory: false,
    locale: "en-US",
    putDoc: (k, v) => { usWrites[k] = v; },
    freshBrain: (on) => ({ settings: { on: true, shareOptIn: on } }),
    freshUsage: (on) => ({ share: on }),
  });
  assert.equal(usFresh.onDevice, true);
  assert.equal(usFresh.brain, true);
  assert.equal(usFresh.usage, true);
  assert.equal(usFresh.contentOptIn, false);
  assert.equal(usWrites.brain.settings.on, true);
  assert.equal(usWrites.brain.settings.shareOptIn, true);
  assert.equal(usWrites.usage.share, true);

  const euWrites = {};
  const euFresh = applyShareDefaults({
    docs: {},
    hasHistory: false,
    locale: "de-DE",
    putDoc: (k, v) => { euWrites[k] = v; },
    freshBrain: (on) => ({ settings: { on: true, shareOptIn: on } }),
    freshUsage: (on) => ({ share: on }),
  });
  assert.equal(euFresh.onDevice, true);
  assert.equal(euFresh.brain, false);
  assert.equal(euFresh.usage, false);
  assert.equal(euFresh.contentOptIn, false);
  assert.equal(euWrites.brain.settings.on, true);
  assert.equal(euWrites.brain.settings.shareOptIn, false);
  assert.equal(euWrites.usage.share, false);

  // Saved choices on an existing install are preserved and not rewritten.
  const kept = {};
  const r = applyShareDefaults({
    docs: { brain: { settings: { on: true, shareOptIn: true } }, usage: { share: false } },
    hasHistory: true,
    locale: "de-DE",
    putDoc: (k, v) => { kept[k] = v; },
  });
  assert.equal(r.brain, true);
  assert.equal(r.usage, false);
  assert.equal(r.showNotice, true, "existing install shows notice once until acknowledged");
  assert.deepEqual(kept, {}, "saved choices are not rewritten");

  const acked = applyShareDefaults({
    docs: {
      brain: { settings: { on: true, shareOptIn: false } },
      usage: { share: false },
      privacy: { noticeSeen: true, contentOptIn: false },
    },
    hasHistory: true,
    locale: "en-US",
  });
  assert.equal(acked.brain, false);
  assert.equal(acked.showNotice, false, "notice already shown once");

  // Existing install that never made a choice gets the regional default.
  const old = {};
  const r2 = applyShareDefaults({
    docs: { brain: { jobs: 4, settings: { on: true } }, usage: { installId: "x" } },
    hasHistory: true,
    locale: "en-US",
    putDoc: (k, v) => { old[k] = v; },
  });
  assert.equal(r2.brain, true);
  assert.equal(r2.usage, true);
  assert.equal(old.brain.settings.shareOptIn, true);
  assert.equal(old.brain.jobs, 4);
  assert.equal(old.usage.installId, "x");
});

test("anonymous quality signal payload cannot contain text from a prompt or answer, nor file names, emails, keys, or personal ids", () => {
  const secretPrompt = "Draft a confidential merger offer for ACME-CORP-9921";
  const secretAnswer = "Here is the confidential merger offer for ACME-CORP-9921 with terms";
  const secretEmail = "ceo@acme-corp.example.com";
  const secretKey = "sk-or-v1-secretkey999999999999";
  const secretFile = "C:/Users/alice/Documents/merger-terms.pdf";
  const secretUser = "alice-personal-id-12345";

  const payload = buildQualitySignalPayload({
    installId: secretUser, // invalid hex -> scrubbed to 0000...
    version: `0.4.17-${secretPrompt}`, // invalid semver -> scrubbed to 0.0.0
    prompt: secretPrompt,
    answer: secretAnswer,
    email: secretEmail,
    apiKey: secretKey,
    fileName: secretFile,
    signals: [
      {
        provider: secretPrompt,
        taskType: secretAnswer,
        thumbsUp: 3,
        thumbsDown: 1,
        accepted: 5,
        retried: 2,
        cost: 0.02,
        ms: 3400,
        version: "0.4.17",
        prompt: secretPrompt,
        answer: secretAnswer,
        text: secretAnswer,
        messages: [{ role: "user", content: secretPrompt }],
        deliverable: secretAnswer,
        file: secretFile,
        files: [secretFile],
        email: secretEmail,
        key: secretKey,
        userId: secretUser,
        runId: "run-secret-123",
      },
      {
        provider: "openai",
        capability: "writing",
        up: 2,
        down: 0,
        ok: 4,
        fail: 0,
        costPerJob: 0.003,
        avgSec: 1.2,
        version: "0.4.17",
      },
    ],
  });

  const serialized = JSON.stringify(payload);
  for (const forbidden of [secretPrompt, secretAnswer, "ACME-CORP-9921", "merger", secretEmail, secretKey, secretFile, secretUser, "run-secret-123"]) {
    assert.equal(serialized.includes(forbidden), false, `payload must not contain ${forbidden}`);
  }
  const checked = validateQualitySignalPayload(payload);
  assert.equal(checked.ok, true, checked.error);
  assert.deepEqual(Object.keys(payload).sort(), ["installId", "signals", "version"]);
  for (const sig of payload.signals) {
    assert.deepEqual(
      Object.keys(sig).sort(),
      ["accepted", "costBucket", "latencyBucket", "provider", "retried", "taskType", "thumbsDown", "thumbsUp", "version"],
    );
  }
  assert.equal(payload.signals[0].provider, "custom");
  assert.equal(payload.signals[0].taskType, "reasoning");
  assert.equal(payload.signals[0].costBucket, "1c_to_5c");
  assert.equal(payload.signals[0].latencyBucket, "2s_to_10s");
  assert.equal(payload.signals[1].provider, "openai");
  assert.equal(payload.signals[1].taskType, "writing");
  assert.equal(payload.signals[1].costBucket, "under_1c");
  assert.equal(payload.signals[1].latencyBucket, "under_2s");

  // Validator rejects any raw object that tries to smuggle prompt, answer, file, email, key, or unbucketed text
  const validBase = buildQualitySignal({ provider: "anthropic", taskType: "code", thumbsUp: 1, accepted: 1, cost: 0.01, ms: 1500 }, "0.4.17");
  assert.equal(validateQualitySignalPayload({ installId: "a".repeat(32), version: "0.4.17", signals: [validBase], prompt: secretPrompt }).ok, false);
  assert.equal(validateQualitySignalPayload({ installId: "a".repeat(32), version: "0.4.17", signals: [{ ...validBase, prompt: secretPrompt }] }).ok, false);
  assert.equal(validateQualitySignalPayload({ installId: "a".repeat(32), version: "0.4.17", signals: [{ ...validBase, answer: secretAnswer }] }).ok, false);
  assert.equal(validateQualitySignalPayload({ installId: "a".repeat(32), version: "0.4.17", signals: [{ ...validBase, provider: secretPrompt }] }).ok, false);
  assert.equal(validateQualitySignalPayload({ installId: "a".repeat(32), version: "0.4.17", signals: [{ ...validBase, taskType: secretAnswer }] }).ok, false);
});

test("Settings text and Welcome screen text match what is sent, and the privacy list names every sender in plain words", () => {
  const ids = SENDERS.map((s) => s.id);
  for (const want of ["ai-providers", "licence", "updates", "usage-counts", "track-records", "content-sharing", "live-prices", "status-pages", "apps", "community", "chat-sync", "handoff", "alerts", "share-links", "phone"]) {
    assert.ok(ids.includes(want), `missing ${want}`);
  }
  for (const s of SENDERS) {
    for (const k of ["name", "what", "to", "when", "off"]) {
      assert.ok(String(s[k] || "").length > 3, `${s.id} ${k}`);
      assert.equal(DASHES.test(s[k]), false, `${s.id} ${k} has a dash`);
    }
  }
  const v = privacyView({ onDevice: true, usage: true, trackRecords: true, contentOptIn: false });
  assert.equal(v.title, "Privacy: what leaves this computer");
  assert.equal(v.levels.onDevice, true);
  assert.equal(v.levels.qualitySignals, true);
  assert.equal(v.levels.contentOptIn, false);
  assert.equal(v.items.find((i) => i.id === "usage-counts").on, true);
  assert.equal(v.items.find((i) => i.id === "track-records").on, true);
  assert.equal(v.items.find((i) => i.id === "content-sharing").on, false);
  assert.equal(v.items.find((i) => i.id === "chat-sync").on, null, "unknown stays unknown");

  // Verify Settings text and Welcome screen text match the exact fields sent and never sent.
  const privacyUi = fs.readFileSync(path.join(ROOT, "web/features/privacy.js"), "utf8");
  const usageUi = fs.readFileSync(path.join(ROOT, "web/features/usage.js"), "utf8");
  const brainUi = fs.readFileSync(path.join(ROOT, "web/features/brain.js"), "utf8");
  const simpleUi = fs.readFileSync(path.join(ROOT, "web/simple-ui.js"), "utf8");
  const appUi = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");

  for (const sent of QUALITY_SENT_ITEMS) {
    assert.ok(QUALITY_SIGNALS_DETAIL.includes(sent), `server detail mentions ${sent}`);
    assert.ok(privacyUi.includes(sent), `Settings > Privacy mentions ${sent}`);
    assert.ok(usageUi.includes(sent), `Settings > Usage mentions ${sent}`);
    assert.ok(brainUi.includes(sent), `Who's best mentions ${sent}`);
    assert.ok(simpleUi.includes(sent), `Welcome screen mentions ${sent}`);
    assert.ok(appUi.includes(sent), `Simple Settings basics mentions ${sent}`);
  }
  for (const never of QUALITY_NEVER_ITEMS) {
    assert.ok(QUALITY_SIGNALS_DETAIL.includes(never), `server detail excludes ${never}`);
    assert.ok(privacyUi.includes(never), `Settings > Privacy excludes ${never}`);
    assert.ok(usageUi.includes(never), `Settings > Usage excludes ${never}`);
    assert.ok(brainUi.includes(never), `Who's best excludes ${never}`);
    assert.ok(simpleUi.includes(never), `Welcome screen excludes ${never}`);
    assert.ok(appUi.includes(never), `Simple Settings basics excludes ${never}`);
  }
  assert.ok(privacyUi.includes(WELCOME_QUALITY_NOTICE));
  assert.ok(simpleUi.includes(WELCOME_QUALITY_NOTICE));
  assert.ok(privacyUi.includes(CONTENT_SHARING_LABEL));
  assert.ok(simpleUi.includes(CONTENT_SHARING_LABEL));

  for (const rel of ["server/privacy.js", "web/features/privacy.js", "docs/help/privacy.md"]) {
    assert.equal(DASHES.test(fs.readFileSync(path.join(ROOT, rel), "utf8")), false, rel);
  }
  const help = fs.readFileSync(path.join(ROOT, "docs/help/privacy.md"), "utf8");
  assert.match(help, /Privacy: what leaves this computer/);
  assert.match(help, /Three levels of learning and sharing/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/DECISIONS.md"), "utf8"), /Three-level learning and sharing defaults/);
});

test("server: US locale new install starts with levels 1 and 2 ON and level 3 OFF, and EU locale new install starts with level 1 ON and levels 2 and 3 OFF", async () => {
  const us = await startServer({ env: { CC_LOCALE: "en-US" } });
  try {
    const usage = (await us.api("/usage")).json;
    assert.equal(usage.share, true, "US new install: usage counts ON");
    const brain = (await us.api("/brain/settings")).json;
    assert.equal(brain.settings.on, true, "US new install: level 1 on-device learning ON");
    assert.equal(brain.settings.shareOptIn, true, "US new install: level 2 quality signals ON");
    const p = await us.api("/privacy");
    assert.equal(p.status, 200);
    assert.equal(p.json.title, "Privacy: what leaves this computer");
    assert.equal(p.json.levels.onDevice, true);
    assert.equal(p.json.levels.qualitySignals, true);
    assert.equal(p.json.levels.contentOptIn, false, "US new install: level 3 content sharing OFF");
    assert.equal(p.json.items.find((i) => i.id === "usage-counts").on, true);
    assert.equal(p.json.items.find((i) => i.id === "track-records").on, true);
    assert.equal(p.json.items.find((i) => i.id === "content-sharing").on, false);
    assert.ok(Array.isArray(p.json.connected));
    assert.equal((await us.api("/privacy", { noToken: true })).status, 401, "session token required");
    const off = await us.api("/privacy", { method: "POST", body: { qualitySignals: false } });
    assert.equal(off.json.levels.qualitySignals, false);
    assert.equal((await us.api("/usage")).json.share, false);
    const saved = JSON.parse(fs.readFileSync(path.join(us.dir, "usage.json"), "utf8"));
    assert.equal(saved.share, false, "the person's choice is saved");
  } finally {
    await us.stop();
  }

  const eu = await startServer({ env: { CC_LOCALE: "de-DE" } });
  try {
    const usage = (await eu.api("/usage")).json;
    assert.equal(usage.share, false, "EU new install: usage counts OFF");
    const brain = (await eu.api("/brain/settings")).json;
    assert.equal(brain.settings.on, true, "EU new install: level 1 on-device learning ON");
    assert.equal(brain.settings.shareOptIn, false, "EU new install: level 2 quality signals OFF");
    const p = (await eu.api("/privacy")).json;
    assert.equal(p.levels.onDevice, true);
    assert.equal(p.levels.qualitySignals, false);
    assert.equal(p.levels.contentOptIn, false, "EU new install: level 3 content sharing OFF");
    assert.equal(p.levels.consentFirst, true);
  } finally {
    await eu.stop();
  }
});

test("an existing install keeps its choice: history with no saved value in US stays on", async () => {
  const s = await startServer({
    env: { CC_LOCALE: "en-US" },
    seed(dir) {
      fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ v: 1, installId: "c".repeat(32), day: "2026-10-20", counts: {}, seen: [], lastSentDay: null }));
      fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({ version: 1, completed: true, completedAt: Date.now() - 86400000, reason: "user" }));
    },
  });
  try {
    assert.equal((await s.api("/usage")).json.share, true, "older usage document keeps default on");
    assert.equal((await s.api("/brain/settings")).json.settings.shareOptIn, true, "an install with history keeps default on");
  } finally {
    await s.stop();
  }
});

test("an existing install that turned sharing off stays off", async () => {
  const s = await startServer({
    env: { CC_LOCALE: "en-US" },
    seed(dir) {
      fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ v: 1, share: false, installId: "d".repeat(32), day: "2026-10-20", counts: {}, seen: [], lastSentDay: null }));
      fs.writeFileSync(path.join(dir, "brain.json"), JSON.stringify({ v: 1, since: Date.now(), settings: { on: true, shareOptIn: false }, jobs: 3, stats: {}, runs: {} }));
      fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({ version: 1, completed: true, completedAt: Date.now() - 86400000, reason: "user" }));
    },
  });
  try {
    assert.equal((await s.api("/usage")).json.share, false);
    assert.equal((await s.api("/brain/settings")).json.settings.shareOptIn, false);
  } finally {
    await s.stop();
  }
});

test("0.4.21: Privacy page badge, honest quality-signal note, Sharing changed card, and Help section link", async () => {
  const web = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
  const ui = web("web", "features", "privacy.js");
  assert.match(ui, /Nothing left this computer/);
  assert.match(ui, /box\.id = "cc-sharing-changed"/);
  assert.match(ui, /kept on this computer for now/);
  assert.match(web("web", "app.js"), /S\.helpSection = "What leaves this computer"/);
  assert.match(web("web", "features", "help.js"), /helpSection/);
  assert.match(web("docs", "help", "privacy.md"), /Sharing changed/);
  assert.match(web("docs", "help", "privacy.md"), /this computer's name/);
  const view = privacyView({ localOnly: true, signalSending: false });
  assert.equal(view.localOnly, true);
  assert.equal(view.localOnlyBadge, "Nothing left this computer");
  assert.equal(DASHES.test(JSON.stringify(view)) || DASHES.test(ui), false);

  const s = await startServer();
  try {
    const v = (await s.api("/privacy")).json;
    assert.equal(typeof v.localOnly, "boolean");
    assert.equal(v.signalSending, false, "quality signal sending is off by default");
    // a finished first run counts as having seen the notice
    await s.api("/setup/done", { method: "POST", body: {} });
    assert.equal((await s.api("/privacy")).json.levels.showNotice, false);
  } finally { await s.stop(); }
});
