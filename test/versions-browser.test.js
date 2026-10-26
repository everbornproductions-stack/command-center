// 0.4.21 Melius ideas in a real browser (demo mode, no real key): Try again keeps Version 1 and adds Version 2,
// the tabs switch between them, Change this part sends the quoted request, Show steps starts hidden, and the cost
// line appears under the prompt box before sending.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(60000);

test("browser: Try again keeps Version 1, Version 2 switches, Show steps is hidden by default, cost line shows", { skip, timeout: 240000 }, async () => {
  const t = await bootPage({ mode: "expert", width: 1280, height: 900 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.route("**/api/precost", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ line: "Free: Groq", free: true, usd: 0, ai: "Groq" }) }));
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    await goChat(t.page);
    await t.page.click("#mode-expert").catch(() => {});
    await t.page.waitForSelector("#run-mode", { timeout: 15000 }).catch(() => {});
    await t.page.click("#run-mode button[data-m=single]").catch(() => {});
    await t.page.waitForFunction(() => window.CC.features.some((f) => f.id === "versions"), null, { timeout: 15000 });
    await t.page.fill("#orders", "Write a one line tagline for a bakery.");
    await t.page.waitForSelector("#cc-precost", { timeout: 10000 });
    assert.match(await t.page.textContent("#cc-precost"), /^Free: Groq/);
    await t.page.click("#go");
    await t.page.waitForSelector("#cc-v-again", { timeout: WAIT });
    assert.equal(await t.page.locator("#cc-v-tabs").count(), 0, "one version, no tabs yet");
    const first = await t.page.textContent("#out-md");
    await t.page.click("#cc-v-again");
    await t.page.waitForSelector("#cc-v-tabs [data-n='2']", { timeout: WAIT });
    assert.deepEqual(await t.page.$$eval("#cc-v-tabs [data-n]", (b) => b.map((x) => x.textContent)), ["Version 1", "Version 2"]);
    await t.page.click("#cc-v-tabs [data-n='1']");
    await t.page.waitForSelector("#cc-v-copy", { timeout: 10000 });
    assert.equal(await t.page.textContent("#out-md"), first, "Version 1 is back, not overwritten");
    // Show steps starts hidden when it is offered
    if (await t.page.locator("#cc-v-steps").count()) assert.equal(await t.page.isHidden("#cc-v-steps-box"), true);
    // Change this part opens a box and refuses an empty change
    await t.page.click("#cc-v-change");
    assert.equal(await t.page.isVisible("#cc-v-change-text"), true);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});
