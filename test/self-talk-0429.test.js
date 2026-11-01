// 0.4.29: Ask about Meldmind (read-only talk to Meldmind about itself, docs/flow/PLAN.md item 26) and the Expert
// Settings layout fix.
// 1. The context builder includes ledger, mission and worker facts and never a key, a file body or a private chat
//    (fake data carries the fake key "sk-test-1234567890abcdef"; it must never come back).
// 2. With no AI the template answers from the facts; with an AI, only the facts reach it.
// 3. The cheapest working AI is picked, free first, never a paid one while Free only is on.
// 4. POST /api/self/ask on a real server in demo mode returns an answer and facts, and seeded records with a fake key
//    and a private run never leak into the reply.
// 5. Headless Chrome: Help shows the box and an answer appears; the Live feed button opens it in Expert.
// 6. Headless Chrome: Expert Settings at 1366 x 800 (and 1440 x 900, 1024 x 768) has no element of the right column
//    under the Live feed (elementFromPoint checks).
// No real key, nothing sent, no data/ folder. Windows rules: real waits, every server and browser is closed, one at a time.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { buildContext, templateAnswer, askSelf, pickProviders, missionFacts, fromLine, scrub, topicsOf } from "../server/self-talk.js";

const FAKE_KEY = "sk-test-1234567890abcdef";
const FILE_BODY = "SECRET FILE BODY: line one of the customer contract";
const PRIVATE_CHAT = "my private chat about the custody hearing";
const NOW = new Date(2026, 9, 30, 15, 0, 0).getTime();
const skipChrome = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);

function fakeSources() {
  const mission = {
    id: "m-abc123", kind: "mission", title: `Plan a bake sale (key ${FAKE_KEY})`, prompt: `Plan a bake sale. My key is ${FAKE_KEY}`, status: "done-with-errors",
    startedAt: NOW - 60000, finishedAt: NOW - 30000, cost: 0.03, mode: "balanced",
    planner: { provider: "google", model: "gemini-3.5-flash-lite" }, assembler: { provider: "anthropic", model: "claude-haiku" },
    tasks: [
      { title: "Write the flyer", provider: "anthropic", model: "claude-haiku", status: "done", cost: 0.02, output: FILE_BODY, attempts: [{ kind: "limit" }] },
      { title: "Price list", provider: "google", model: "gemini-3.5-flash-lite", status: "failed", cost: 0, error: `Key rejected (401) for ${FAKE_KEY}`, output: FILE_BODY },
    ],
    deliverable: FILE_BODY, attachedFiles: [{ name: "contract.txt", text: FILE_BODY }], thread: [{ role: "user", text: PRIVATE_CHAT }],
    incomplete: { reasons: [{ title: "Price list", reason: "The step failed." }] },
    log: [{ ts: NOW, text: "Planning with Gemini" }, { ts: NOW, text: `Using key ${FAKE_KEY}` }, { ts: NOW, text: "Incomplete: Price list (The step failed.)" }],
  };
  const privateRun = { id: "m-priv01", kind: "mission", private: true, title: PRIVATE_CHAT, prompt: PRIVATE_CHAT, status: "done", startedAt: NOW - 10000, cost: 0.5, tasks: [{ title: PRIVATE_CHAT, output: PRIVATE_CHAT }], log: [{ text: PRIVATE_CHAT }] };
  return {
    now: NOW,
    ledger: [
      { ts: NOW - 50000, kind: "call", provider: "google", model: "gemini-3.5-flash-lite", cost: 0, free: true, role: "plan", missionId: "m-abc123" },
      { ts: NOW - 40000, kind: "call", provider: "anthropic", model: "claude-haiku", cost: 0.02, role: "work", missionId: "m-abc123" },
      { ts: NOW - 35000, kind: "call", provider: "anthropic", model: "claude-haiku", cost: 0.01, role: "assemble", missionId: "m-abc123" },
      { ts: NOW - 9000, kind: "call", provider: "openai", model: "gpt-mini", cost: 0.5, role: "work", missionId: "m-priv01" },
    ],
    missions: [mission, privateRun],
    workers: [
      { id: "gemini-cli", label: "Gemini CLI", kind: "cli", status: "resting", statusLabel: "Resting, back at 5:00 PM", restingUntil: NOW + 2 * 3600 * 1000, lastError: `Quota exceeded for ${FAKE_KEY}`, cooldownHours: 22 },
      { id: "claude-code", label: "Claude Code", kind: "cli", status: "ready", statusLabel: "Ready" },
      { id: "codex", label: "Codex", kind: "cli", status: "off", statusLabel: "Off" },
    ],
    status: { google: { status: "amber", detail: "slow" }, anthropic: { status: "green", detail: "ok" } },
    providers: { google: { id: "google", name: "Google Gemini", kind: "text" }, anthropic: { id: "anthropic", name: "Claude", kind: "text" }, openai: { id: "openai", name: "ChatGPT", kind: "text" } },
    settings: { defaultMode: "savings", freeOnly: false, speechPaid: false, fallbackOn: true, demo: false, cloudKey: FAKE_KEY },
    news: { "0.4.29": { bullets: ["Your AI helpers list shows who is resting.", "Ask about Meldmind answers from its own records."] } },
    version: "0.4.29",
    help: [{ id: "spreadsheets", title: "Make a spreadsheet", summary: "Simple mode, Spreadsheet", excerpt: "Pick Spreadsheet in Simple mode and say what goes in it." }],
  };
}
const everything = (c) => JSON.stringify(c);

// ---------- 1. the context ----------

test("context builder: ledger, mission and worker facts are in, a key, a file body and a private chat never are", () => {
  const src = fakeSources();
  for (const q of ["why did my last job cost 3 cents", "which AI did the planning", "why is Gemini resting", "what changed in this version", "how do I make a spreadsheet", "tell me everything", `is my key ${FAKE_KEY} ok`]) {
    const c = buildContext(q, src);
    const all = everything(c);
    assert.ok(!all.includes(FAKE_KEY), `${q}: the fake key never appears`);
    assert.ok(!all.includes("1234567890abcdef"), `${q}: no part of the fake key appears`);
    assert.ok(!all.includes("SECRET FILE BODY"), `${q}: no file body or step output`);
    assert.ok(!all.includes("custody"), `${q}: no private chat or private run`);
    assert.ok(c.facts.length > 0, `${q}: some facts`);
  }
  const cost = buildContext("why did my last job cost 3 cents", src);
  assert.ok(cost.facts.some((f) => f.source === "ledger" && /Ledger for m-abc123: 3 calls, \$0\.03/.test(f.text)), JSON.stringify(cost.facts));
  assert.ok(cost.facts.some((f) => f.source === "mission" && /m-abc123/.test(f.text)));
  assert.match(fromLine(cost.facts), /^From: last mission m-abc123, ledger 3 calls/);
  const who = buildContext("which AI did the planning", src);
  assert.ok(who.facts.some((f) => /Planning on m-abc123 was done by Google Gemini/.test(f.text)));
  const rest = buildContext("why is Gemini resting", src);
  assert.ok(rest.facts.some((f) => f.source === "workers" && /Helper Gemini CLI: resting until/.test(f.text) && /\[hidden\]/.test(f.text)), JSON.stringify(rest.facts));
  assert.ok(rest.facts.some((f) => f.source === "status" && /Google Gemini light: amber/.test(f.text)));
  assert.ok(rest.suggest.some((s) => s.focus === "#cc-helpers"), "suggests the helpers panel");
  assert.match(fromLine(rest.facts), /worker pool/);
  const news = buildContext("what changed in this version", src);
  assert.ok(news.facts.some((f) => f.source === "news" && /0\.4\.29/.test(f.text)));
  const how = buildContext("how do I make a spreadsheet", src);
  assert.ok(how.facts.some((f) => f.source === "help"));
  assert.ok(how.suggest.some((s) => s.article === "spreadsheets"));
  // Private runs are counted, never shown, and their ledger lines are not the "last mission".
  const any = buildContext("tell me about my jobs", src);
  assert.ok(any.facts.some((f) => /1 private run not shown/.test(f.text)));
  assert.equal(any.last, "m-abc123");
  // No em-dashes in anything said to the person.
  assert.ok(!/[—–]/.test(everything(any)));
});

test("mission summaries keep titles and short lines only, and the scrubber hides secret-looking text", () => {
  const m = missionFacts(fakeSources().missions[0]);
  assert.ok(!JSON.stringify(m).includes(FAKE_KEY));
  assert.ok(!("deliverable" in m) && !("thread" in m) && !("attachedFiles" in m));
  assert.ok(m.steps.every((s) => !("output" in s)));
  assert.deepEqual(missionFacts({ id: "m-p", private: true, title: PRIVATE_CHAT }), { id: "m-p", private: true, startedAt: 0 });
  assert.equal(scrub(`password: hunter2 and ${FAKE_KEY}`).includes("hunter2"), false);
  assert.equal(scrub("token=abcDEF1234567890abcdef1234567890xyz").includes("abcDEF1234567890"), false);
  assert.equal(scrub("Bearer abcdefghijklmnop1234").includes("abcdefghijklmnop1234"), false);
  assert.equal(scrub("SSN 123-45-6789"), "SSN ***-**-6789");
  assert.ok(topicsOf("why is Gemini resting").has("rest"));
});

// ---------- 2. the answer ----------

test("no-AI template answers from the facts", async () => {
  const src = fakeSources();
  const r = await askSelf("why did my last job cost 3 cents", { sources: async () => src });
  assert.equal(r.source, "facts");
  assert.equal(r.provider, null);
  assert.match(r.answer, /m-abc123/);
  assert.match(r.answer, /\$0\.03/);
  assert.ok(r.facts.length > 0 && /^From: /.test(r.from));
  const rest = await askSelf("why is Gemini resting", { sources: async () => src });
  assert.match(rest.answer, /Gemini CLI: resting until/);
  const news = await askSelf("what changed in this version", { sources: async () => src });
  assert.match(news.answer, /What's new in 0\.4\.29/);
  const how = await askSelf("how do I make a spreadsheet", { sources: async () => src });
  assert.match(how.answer, /Make a spreadsheet/);
  const empty = await askSelf("what is the weather", { sources: async () => ({}) });
  assert.match(empty.answer, /could not find anything/);
  for (const x of [r, rest, news, how, empty]) { assert.ok(!JSON.stringify(x).includes(FAKE_KEY)); assert.ok(!/[—–]/.test(x.answer)); }
  await assert.rejects(askSelf("   ", {}), /Type a question/);
});

test("with an AI, only the facts reach it, the ledger gets one self-talk line, and a failure falls back to the template", async () => {
  const src = fakeSources();
  const sent = [];
  const recorded = [];
  const r = await askSelf("why did my last job cost 3 cents", {
    sources: async () => src,
    candidates: () => [{ providerId: "groq", model: "openai/gpt-oss-20b", tier: 1, cost: 0 }],
    complete: async (opts) => { sent.push(opts); return { text: "Your last job cost $0.03 — mostly Claude.", usage: { input: 10, output: 5 } }; },
    record: (e) => recorded.push(e),
  });
  assert.equal(r.source, "ai");
  assert.equal(r.provider, "groq");
  assert.ok(!/—/.test(r.answer), "no em-dash in the answer");
  assert.equal(sent.length, 1);
  const wire = JSON.stringify(sent[0]);
  assert.ok(!wire.includes(FAKE_KEY) && !wire.includes("SECRET FILE BODY") && !wire.includes("custody"), "nothing private goes to the AI");
  assert.match(sent[0].system, /Use ONLY the facts below/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].role, "self-talk");
  assert.equal(recorded[0].usage.free, true);
  const down = await askSelf("why did my last job cost 3 cents", { sources: async () => src, candidates: () => [{ providerId: "groq", model: "x", tier: 1 }], complete: async () => { throw new Error("down"); } });
  assert.equal(down.source, "facts");
  assert.match(down.answer, /m-abc123/);
});

test("the cheapest working AI is picked: this PC, then free, then the cheapest paid; none paid while Free only is on", () => {
  const providers = {
    "demo-nova": { id: "demo-nova", kind: "text", demo: true, models: [{ id: "nova" }] },
    "plan-claude-code": { id: "plan-claude-code", kind: "text", models: [{ id: "cc" }] },
    anthropic: { id: "anthropic", kind: "text", keyEnv: "A", models: [{ id: "opus" }, { id: "haiku" }] },
    openai: { id: "openai", kind: "text", keyEnv: "O", models: [{ id: "mini" }] },
    groq: { id: "groq", kind: "text", keyEnv: "G", models: [{ id: "openai/gpt-oss-20b" }] },
    xai: { id: "xai", kind: "text", keyEnv: "X", models: [{ id: "grok" }] },
    ollama: { id: "ollama", kind: "text", custom: true, noKey: true, models: [{ id: "llama", default: true }] },
  };
  const price = { opus: 15, haiku: 1, mini: 0.5, grok: 3, "openai/gpt-oss-20b": 0.1 };
  const deps = {
    providers, hasSecret: (id) => ["anthropic", "openai", "groq", "xai"].includes(id), statusOf: (id) => ({ status: id === "xai" ? "red" : "green" }),
    troubled: () => false, usable: () => true, freeModels: { groq: ["openai/gpt-oss-20b"] }, freeNow: () => true, priceOf: (m) => price[m],
  };
  const all = pickProviders({ ...deps, freeOnly: false });
  assert.deepEqual(all.map((x) => `${x.providerId}:${x.model}:${x.tier}`), ["ollama:llama:0", "groq:openai/gpt-oss-20b:1", "openai:mini:3", "anthropic:haiku:3"]);
  const free = pickProviders({ ...deps, freeOnly: true });
  assert.deepEqual(free.map((x) => x.providerId), ["ollama", "groq"]);
  const benched = pickProviders({ ...deps, freeOnly: false, troubled: (id) => id === "groq", usable: (id) => id !== "ollama" });
  assert.deepEqual(benched.map((x) => x.providerId), ["openai", "anthropic"]);
});

// ---------- 4. the API ----------

test("POST /api/self/ask in demo mode returns an answer and facts, and seeded secrets and private runs never leak", { timeout: waitBudget(120000) }, async () => {
  const s = await startServer({
    seed: (dir) => {
      fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
      const src = fakeSources();
      for (const m of src.missions) fs.writeFileSync(path.join(dir, "missions", `${m.id}.json`), JSON.stringify(m));
      fs.writeFileSync(path.join(dir, "ledger.jsonl"), src.ledger.map((e) => JSON.stringify({ ...e, ts: Date.now() - 1000 })).join("\n") + "\n");
    },
  });
  try {
    const demo = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(demo.status, 200);
    const bad = await s.api("/self/ask", { method: "POST", body: { question: " " } });
    assert.equal(bad.status, 400);
    for (const question of ["why did my last job cost 3 cents", "which AI did the planning", "what changed in this version", "why is Gemini resting", "how do I make a spreadsheet"]) {
      const r = await s.api("/self/ask", { method: "POST", body: { question } });
      assert.equal(r.status, 200, r.text);
      assert.ok(typeof r.json.answer === "string" && r.json.answer.length > 10, `${question}: ${r.text}`);
      assert.ok(Array.isArray(r.json.facts) && r.json.facts.length > 0, `${question}: facts`);
      assert.ok("provider" in r.json, "provider is in the reply");
      assert.equal(r.json.provider, null, "practice AIs never phrase an answer about Meldmind");
      assert.match(r.json.from, /^From: /);
      assert.ok(!r.text.includes(FAKE_KEY) && !r.text.includes("1234567890abcdef"), `${question}: no key`);
      assert.ok(!r.text.includes("SECRET FILE BODY") && !r.text.includes("custody"), `${question}: no file body or private run`);
      assert.ok(!/[—–]/.test(r.json.answer));
    }
    const cost = await s.api("/self/ask", { method: "POST", body: { question: "why did my last job cost 3 cents" } });
    assert.ok(cost.json.facts.some((f) => /Ledger for m-abc123: 3 calls/.test(f.text)), cost.text);
    assert.ok(!s.log.includes("why did my last job"), "the question is not written to the log");
  } finally { await s.stop(); }
});

// ---------- 5. Help and the Live feed button ----------

async function toExpert(t) {
  await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
  await t.page.addStyleTag({ content: "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts{display:none!important}" });
  await t.page.waitForTimeout(1200);
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
  await t.page.waitForTimeout(800);
  assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "expert", "body[data-ui] is expert after the switch");
}
async function go(t, view) {
  await t.page.evaluate((v) => window.CC.go(v), view);
  await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
  await t.page.waitForTimeout(1200);
}

test("Help shows the Ask about Meldmind box and an answer with its facts appears", { skip: skipChrome, timeout: waitBudget(150000) }, async () => {
  const t = await bootPage({ width: 1366, height: 800 });
  try {
    await t.api("/demo", { body: { on: true } });
    await go(t, "help");
    await t.page.waitForSelector("#self-ask-help [data-self-q]", { timeout: WAIT });
    assert.match(await t.page.textContent("#self-ask-help h3"), /Ask about Meldmind/);
    await t.page.fill("#self-ask-help [data-self-q]", "what changed in this version");
    await t.page.click("#self-ask-help [data-self-go]");
    await t.page.waitForSelector("#self-ask-help [data-self-text]", { timeout: WAIT });
    const shown = await t.page.evaluate(() => ({
      answer: document.querySelector("#self-ask-help [data-self-text]").textContent.trim(),
      from: document.querySelector("#self-ask-help [data-self-from]").textContent.trim(),
      facts: document.querySelectorAll("#self-ask-help [data-self-facts] li").length,
    }));
    assert.ok(shown.answer.length > 10, JSON.stringify(shown));
    assert.match(shown.from, /^From: /);
    assert.ok(shown.facts > 0, "the facts list has items");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("Expert: the Live feed header opens Ask about Meldmind", { skip: skipChrome, timeout: waitBudget(150000) }, async () => {
  const t = await bootPage({ mac: "default", hidePopups: false, width: 1366, height: 800 });
  try {
    await toExpert(t);
    await go(t, "command");
    const btn = await t.page.evaluate(() => { const b = document.getElementById("feed-ask"); if (!b) return null; const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, top: hit === b || b.contains(hit) }; });
    assert.ok(btn && btn.w > 0 && btn.top, `the feed button is on screen and on top: ${JSON.stringify(btn)}`);
    await t.page.click("#feed-ask");
    await t.page.waitForSelector("#cc-self-pop [data-self-q]", { timeout: WAIT });
    await t.page.fill("#cc-self-pop [data-self-q]", "which AI did the planning");
    await t.page.click("#cc-self-pop [data-self-go]");
    await t.page.waitForSelector("#cc-self-pop [data-self-text]", { timeout: WAIT });
    assert.ok((await t.page.textContent("#cc-self-pop [data-self-text]")).trim().length > 10);
    await t.page.click("#cc-self-close");
    assert.equal(await t.page.$("#cc-self-pop"), null);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- 6. Settings layout beside the Live feed ----------

for (const [width, height] of [[1366, 800], [1440, 900], [1024, 768]]) {
  test(`Expert Settings at ${width} x ${height}: no element of either column is under the Live feed`, { skip: skipChrome, timeout: waitBudget(150000) }, async () => {
    const t = await bootPage({ mac: "default", hidePopups: false, width, height, theme: "dark" });
    try {
      await toExpert(t);
      await go(t, "settings");
      await t.page.waitForSelector("#settings-cols", { timeout: WAIT });
      const base = await t.page.evaluate(() => {
        const feed = document.getElementById("feed"), cols = document.getElementById("settings-cols"), v = document.getElementById("view");
        const fs = getComputedStyle(feed), fr = feed.getBoundingClientRect();
        return { feedOn: fs.display !== "none" && fs.visibility !== "hidden" && fr.width > 0, feedLeft: Math.round(fr.left), colsRight: Math.round(cols.getBoundingClientRect().right), children: cols.children.length, overflowX: v.scrollWidth - v.clientWidth };
      });
      if (width >= 1366) assert.ok(base.feedOn, "the Live feed rail is on at this width");
      assert.equal(base.children, 2, "two Settings columns");
      assert.ok(base.overflowX <= 1, `the page does not run sideways (${base.overflowX}px)`);
      if (base.feedOn) assert.ok(base.colsRight <= base.feedLeft, `columns end at ${base.colsRight}, feed starts at ${base.feedLeft}`);
      // Every panel of the right (second) column, and the first column's panels too: scrolled into view, its right edge
      // and centre are the panel itself, never the feed.
      for (const col of [1, 0]) {
        const count = await t.page.evaluate((col) => document.getElementById("settings-cols").children[col].querySelectorAll(":scope > .panel, :scope > div > .panel").length, col);
        assert.ok(count > 0, `column ${col + 1} has panels`);
        for (let i = 0; i < Math.min(count, 6); i++) {
          const hit = await t.page.evaluate(async ({ col, i }) => {
            const el = document.getElementById("settings-cols").children[col].querySelectorAll(":scope > .panel, :scope > div > .panel")[i];
            el.scrollIntoView({ block: "center" });
            await new Promise((r) => setTimeout(r, 120));
            const r = el.getBoundingClientRect(), feed = document.getElementById("feed");
            const y = Math.min(Math.max(r.top + 20, 0), innerHeight - 1);
            const pts = [[r.right - 6, y], [r.left + r.width / 2, y]];
            const bad = [];
            for (const [x, yy] of pts) {
              if (x < 0 || x >= innerWidth) { bad.push(`off screen at x ${Math.round(x)}`); continue; }
              const top = document.elementFromPoint(x, yy);
              if (top && feed.contains(top)) bad.push(`feed at ${Math.round(x)},${Math.round(yy)}`);
            }
            return { id: el.id || el.querySelector("h3")?.textContent.slice(0, 30) || `#${i}`, right: Math.round(r.right), bad };
          }, { col, i });
          assert.deepEqual(hit.bad, [], `column ${col + 1} panel ${hit.id} (right ${hit.right}) is not under the feed`);
        }
      }
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}
