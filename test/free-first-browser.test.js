// 0.4.21 K-free, real browser: the first Ctrl+Enter sends (no Pro prompt chip in its place); Simple has the mode picker under
// More options and the Free only switch next to Send; the Get free AIs card opens from Home and from the out-of-credits banner.
// Mock providers only.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { KEYS, mocks } from "./send-check-mock.js";

const skip = findBrowser() ? false : "no Chrome installed";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot(m, mode) {
  const t = await bootPage({ mode, env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_SUBCLI_NO_PATH: "1",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  for (const pid of ["xai", "groq"]) await t.api("/keys", { body: { provider: pid, key: KEYS[pid] } });
  await t.api("/fallback/settings", { body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });
  await t.page.reload();
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
  return t;
}
const posts = (page) => { const seen = []; page.on("request", (r) => { if (r.method() === "POST" && /\/api\/(chat|mission|council)$/.test(new URL(r.url()).pathname)) seen.push(new URL(r.url()).pathname.replace("/api", "")); }); return seen; };

test("browser: the first Ctrl+Enter sends even while a Pro prompt guess is pending; no chip takes its place", { skip }, async () => {
  const m = await mocks();
  const t = await boot(m, "simple");
  try {
    const seen = posts(t.page);
    await goChat(t.page);
    await t.page.fill("#orders", "Write a blog post about our spring sale for my bakery.");
    await t.page.press("#orders", "Control+Enter");
    const end = Date.now() + waitBudget(20000);
    while (!seen.length && Date.now() < end) await sleep(100);
    assert.ok(seen.length >= 1, "the first Ctrl+Enter sent the job");
    await sleep(900); // the debounced guess would have painted by now
    assert.equal(await t.page.$("#pp-use"), null, "no Suggested chip in place of the send");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); await m.close(); }
});

test("browser: Simple shows the mode picker under More options, the Free only switch by Send, and the Get free AIs card", { skip }, async () => {
  const m = await mocks();
  const t = await boot(m, "simple");
  try {
    await goChat(t.page);
    assert.ok(await t.page.$("#cc-freeonly"), "the Free only switch sits by Send");
    assert.match(await t.page.innerText("#sc-team"), /Auto team/);
    // the layout code binds a moment after the page paints: click until More options opens
    for (let n = 0; n < 8; n++) {
      await t.page.click("#sc-team");
      if (await t.page.evaluate(() => document.querySelector("#view .sc-panel").classList.contains("more-open"))) break;
      await sleep(400);
    }
    await t.page.waitForSelector("#simple-run-mode", { state: "visible", timeout: 5000 });
    const labels = await t.page.$$eval("#simple-run-mode button", (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(labels, ["Auto", "Single", "Council", "Mission"]);
    // the switch is the same setting everywhere
    await t.page.click("#cc-freeonly");
    await t.page.waitForFunction(() => window.CC.S.freeOnly && window.CC.S.freeOnly.on === true, null, { timeout: 8000 });
    assert.equal((await t.api("/state")).json.freeOnly.on, true);
    await t.page.click("#cc-freeonly");
    await t.page.waitForFunction(() => window.CC.S.freeOnly && window.CC.S.freeOnly.on === false, null, { timeout: 8000 });
    // picking Single is remembered and shown on the button
    await t.page.click('#simple-run-mode button[data-m="single"]');
    assert.match(await t.page.innerText("#sc-team"), /Single mode/);
    // Get free AIs from Home
    await t.page.click("#cc-get-free-simple");
    await t.page.waitForSelector("#cc-free-ais", { timeout: 10000 });
    const txt = await t.page.innerText("#cc-free-ais");
    for (const w of ["Groq", "Google AI Studio", "OpenRouter", "GitHub Models", "Cloudflare", "Mistral", "Ollama", "LM Studio", "Grok Bot"]) assert.ok(txt.includes(w), w);
    await t.page.keyboard.press("Escape");
    assert.equal(await t.page.$("#cc-free-ais"), null);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); await m.close(); }
});

test("browser: the out-of-credits banner shows '2 ready, 1 out of credits' and opens Get free AIs", { skip }, async () => {
  const m = await mocks();
  const t = await boot(m, "simple");
  try {
    m.behave.xai = 402;
    await t.api("/chat", { body: { prompt: "Write a tagline.", provider: "xai", model: "grok-4.3" } });
    const end = Date.now() + waitBudget(30000);
    for (;;) { const f = (await t.api("/fallback")).json; if (f.skipped.some((x) => x.provider === "xai")) break; assert.ok(Date.now() < end); await sleep(250); }
    await goChat(t.page);
    await t.page.fill("#orders", "Say hello to my customers.");
    await t.page.click("#go");
    await t.page.waitForSelector("#cc-send-banner", { timeout: 15000 });
    assert.match(await t.page.innerText("#cc-send-summary"), /^\d+ ready, 1 out of credits$/);
    await t.page.evaluate(() => document.querySelector('#cc-send-banner [data-sc="free"]').click());
    await t.page.waitForSelector("#cc-free-ais", { timeout: 10000 });
  } finally { await t.close(); await m.close(); }
});
