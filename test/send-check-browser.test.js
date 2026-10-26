// 0.4.21 dogfood finding 01, real browser: the "out of credits" banner sits on the prompt box BEFORE sending and names the AI
// and the one-click fix; Auto splits a coding job into a mission while a chosen Single stays a chat; an empty answer shows
// as a plain "Nothing came back" failure with Try again. Mock providers only, no real key, no data/ folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { KEYS, mocks } from "./send-check-mock.js";
import { failureKind, failureCopy } from "../web/failure-cause.js";
import { bannerHtml, splitNote } from "../web/send-check.js";

const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");
const skip = findBrowser() ? false : "no Chrome installed";
const CODE = "Write a TypeScript function that parses a CSV file, add unit tests, and fix the failing build script in this repository.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("unit: failure card words for an empty result, banner html, no dashes", () => {
  assert.equal(failureKind("Nothing came back. Gemini is out of quota or credits. Add credits in Settings, or press Try again to send it to another AI."), "empty");
  const c = failureCopy("Nothing came back. Gemini is out of quota or credits. Press Try again to send it to another AI.");
  assert.match(c.title, /^Nothing came back/);
  assert.match(c.hint, /Gemini is out of quota or credits/);
  const html = bannerHtml({ banner: { kind: "some-out", title: "Grok is out of credits or quota.", text: "Meldmind will use Groq for this instead.", fix: { switchTo: { provider: "groq", model: "m", name: "Groq" }, addCredits: "https://x.example/billing" } } });
  assert.match(html, /role="alert"/); assert.match(html, /Use Groq for this/); assert.match(html, /Add credits/); assert.match(html, /Open Settings/);
  assert.equal(bannerHtml({ banner: null }), "");
  assert.match(splitNote({ autoMode: "mission", working: [1, 2, 3] }), /splitting it across 3 AIs: plan, build, review/);
  for (const f of ["send-check.js", "failure-cause.js"]) assert.doesNotMatch(read("web", f), /[–—]/, f);
});

async function boot(m, mode) {
  const t = await bootPage({ mode, env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  for (const pid of ["xai", "groq"]) await t.api("/keys", { body: { provider: pid, key: KEYS[pid] } });
  await t.api("/fallback/settings", { body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });
  await t.page.reload();
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
  return t;
}
const posts = (page) => { const seen = []; page.on("request", (r) => { if (r.method() === "POST" && /\/api\/(chat|mission|council|send-check)$/.test(new URL(r.url()).pathname)) seen.push(new URL(r.url()).pathname.replace("/api", "")); }); return seen; };

test("browser: the banner names the AI that is out and the fix; Auto splits coding; Single stays Single", { skip }, async () => {
  const m = await mocks();
  const t = await boot(m, "expert");
  try {
    const seen = posts(t.page);
    // Grok runs out of quota (a pinned chat finds out and the app remembers it)
    m.behave.xai = "quota";
    const r = await t.api("/chat", { body: { prompt: "Write a tagline.", provider: "xai", model: "grok-4.3" } });
    assert.equal(r.status, 202);
    const end = Date.now() + waitBudget(30000);
    for (;;) { const f = (await t.api("/fallback")).json; if (f.skipped.some((x) => x.provider === "xai")) break; assert.ok(Date.now() < end, "xai remembered as out"); await sleep(250); }
    await t.page.click("#mode-expert");
    await goChat(t.page);
    await t.page.waitForSelector("#run-mode", { timeout: 15000 });
    await t.page.fill("#orders", CODE);
    await t.page.click("#run-mode button[data-m=single]");
    await t.page.click("#go");
    await t.page.waitForSelector("#cc-send-banner", { timeout: 15000 });
    const txt = await t.page.innerText("#cc-send-banner");
    assert.match(txt, /Grok is out of credits or quota/);
    assert.match(txt, /Use Groq for this/);
    assert.match(txt, /Open Settings/);
    const box = await t.page.evaluate(() => { const b = document.getElementById("cc-send-banner").getBoundingClientRect(); const o = document.getElementById("orders").getBoundingClientRect(); return { bottom: b.bottom, top: o.top, h: b.height }; });
    assert.ok(box.bottom <= box.top + 1 && box.h > 30, "a visible banner sits above the prompt box, not a small note");
    assert.ok(seen.includes("/chat"), "an explicit Single stays a chat");
    assert.ok(!seen.includes("/mission"));
    await t.page.click('#cc-send-banner [data-sc="switch"]');
    assert.equal(await t.page.$("#cc-send-banner"), null, "the banner leaves after the one-click fix");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); await m.close(); }
});

test("browser: with two working AIs Auto sends a coding job as a mission; an empty answer reads Nothing came back with Try again", { skip }, async () => {
  const m = await mocks();
  const t = await boot(m, "simple");
  try {
    const seen = posts(t.page);
    await goChat(t.page);
    await t.page.fill("#orders", CODE);
    await t.page.click("#go");
    const end = Date.now() + waitBudget(20000);
    while (!seen.includes("/mission") && Date.now() < end) await sleep(200);
    assert.ok(seen.includes("/mission"), `Auto splits the coding job (saw ${seen.join(",")})`);
    assert.ok(!seen.includes("/chat"));
    assert.equal(await t.page.$("#cc-send-banner"), null, "no banner when everything works");
  } finally { await t.close(); await m.close(); }
  // an empty reply from every AI
  const m2 = await mocks();
  const t2 = await boot(m2, "simple");
  try {
    m2.behave.xai = "empty"; m2.behave.groq = "empty";
    await goChat(t2.page);
    await t2.page.fill("#orders", "Say hello to my customers.");
    await t2.page.click("#go");
    await t2.page.waitForSelector("#cc-fail", { timeout: waitBudget(30000) });
    const txt = await t2.page.innerText("#cc-fail");
    assert.match(txt, /Nothing came back/);
    assert.match(txt, /Try again/);
    const st = (await t2.api("/state")).json;
    assert.ok(!st.missions.some((x) => x.status === "done" && !String(x.deliverable || "").trim()), "no job is done with nothing in it");
  } finally { await t2.close(); await m2.close(); }
});
