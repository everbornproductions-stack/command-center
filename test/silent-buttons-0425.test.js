// 0.4.25 (audit A5): Images and Media "Generate" with no key show one short line and a press says what is missing,
// never a dead button. Real server and headless browser, demo off, no keys, nothing sent anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootPage } from "./pw-helpers.js";
import { IMAGE_NO_KEY_LINE, MEDIA_NO_KEY_LINE } from "../web/features/key-hints.js";

const WAIT = process.platform === "win32" ? 30000 : 15000;

test("Images and Media Generate with no key: a visible line, and a press shows it", async (t) => {
  const b = await bootPage({ env: { CC_STATUS_PAGES: "off", OPENAI_API_KEY: "", GEMINI_API_KEY: "", REPLICATE_API_TOKEN: "", FAL_KEY: "" } });
  if (!b) return t.skip("no browser");
  try {
    await b.api("/demo", { body: { on: false } });
    const { page } = b;
    await page.waitForFunction(() => window.CC && window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await page.evaluate(() => window.CC.go("images"));
    await page.waitForSelector("#im-go", { timeout: WAIT });
    const img = await page.evaluate(() => ({ disabled: document.getElementById("im-go").disabled, hidden: document.getElementById("im-need").hidden, text: document.getElementById("im-need").textContent }));
    assert.equal(img.disabled, false, "Generate can be pressed");
    assert.equal(img.hidden, false);
    assert.match(img.text, new RegExp(IMAGE_NO_KEY_LINE.replace(/\./g, "\\.")));
    await page.fill("#im-prompt", "a bakery window");
    await page.click("#im-go");
    await page.waitForFunction((line) => [...document.querySelectorAll(".toast")].some((x) => x.textContent.includes(line)), IMAGE_NO_KEY_LINE, { timeout: WAIT });

    await page.evaluate(() => window.CC.go("media"));
    await page.waitForSelector("#md-go", { timeout: WAIT });
    const med = await page.evaluate(() => ({ disabled: document.getElementById("md-go").disabled, hidden: document.getElementById("md-need").hidden, text: document.getElementById("md-need").textContent }));
    assert.equal(med.disabled, false, "Generate can be pressed");
    // the line shows only when the chosen media service has no key and no MCP
    const keyless = await page.evaluate(() => /needs a key/.test(document.querySelector("#md-prov option:checked")?.textContent || ""));
    if (keyless) { assert.equal(med.hidden, false); assert.ok(med.text.includes(MEDIA_NO_KEY_LINE)); }
    await page.click("#md-go");
    await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((x) => /Write what you want first/.test(x.textContent)), null, { timeout: WAIT });
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
});
