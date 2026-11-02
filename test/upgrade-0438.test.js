// 0.4.38 (Chris: "There needs to be a way to upgrade in the app ... I mean to a paid plan"). On Free a plain Upgrade
// chip sits in the Mac title bar and in the classic top bar; it, Simple Settings' Upgrade button and a real Pro gate
// all open the Pro box, which holds the same buy buttons as Settings > Your plan (labels and pay links come from the
// server), the paid-watch waiting line once a pay link opens, and a link to the license key box.
// No real pay link is ever opened: window.open is stubbed and the test reads the URL it was given. Nothing calls
// Stripe. Real server and headless Chrome (skips when no Chrome); Windows rules: one server and one browser at a time,
// real waits, every test closes what it opens. Set CC_SHOTS to a folder to keep screenshots.
// @helper-process: bootPage starts the app server and a browser, so npm test runs this file on its own on Windows.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const SHOTS = process.env.CC_SHOTS || "";
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer";
const EMAIL = "free.user@example.com";
const EM_DASH = String.fromCharCode(0x2014);

// A verified one-click sign-in, so the server prefills the pay links with this email (the existing helper).
const signedIn = (dir) => fs.writeFileSync(path.join(dir, "signin-identity.json"), JSON.stringify({ email: EMAIL, provider: "google", at: Date.now() }));

async function shot(t, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await t.page.screenshot({ path: path.join(SHOTS, name) });
}

// Boot with the Mac look (as a new user does) or the classic look, and stub the pay link opener.
async function boot({ mac = true, ...opts } = {}) {
  const t = await bootPage({ mac: mac ? "default" : undefined, hidePopups: false, seed: signedIn, ...opts });
  if (!t) return null;
  try {
    await t.page.addInitScript(() => {
      window.__opened = [];
      window.open = (url, target, features) => { window.__opened.push({ url: String(url), target, features }); return null; };
      // The desktop bridge, if a page path ever used it, is stubbed too.
      if (window.ccDesk) window.ccDesk.openExternal = async (url) => { window.__opened.push({ url: String(url), desk: true }); return true; };
    });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go && window.CC.S.license, null, { timeout: WAIT });
    if (mac) await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    return t;
  } catch (e) { await t.close(); throw e; }
}

const onScreen = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}, sel);

async function plans(t) { const r = await t.api("/billing-plans"); assert.equal(r.status, 200); return r.json; }

// The box's buy buttons hold the server's own labels, and nothing in it has an em-dash or the old wording.
async function checkBox(t, p) {
  await t.page.waitForSelector("#cc-upgrade .card", { state: "visible", timeout: WAIT });
  const box = await t.page.evaluate(() => {
    const c = document.querySelector("#cc-upgrade .card");
    return {
      text: c.innerText,
      main: [...c.querySelectorAll("[data-up-main] .btn")].map((b) => ({ text: b.textContent.trim(), href: b.getAttribute("href"), plan: b.dataset.upgradeLink || b.dataset.proPlan })),
      key: !!c.querySelector("#cc-upgrade-key"),
      compare: !!c.querySelector(".plan-compare, table"),
    };
  });
  const want = [p.monthly, p.yearly].map((x) => x.button);
  assert.deepEqual(box.main.map((b) => b.text), want, `Go Pro monthly and yearly with the server's labels: ${JSON.stringify(box.main)}`);
  assert.equal(box.main[0].href, p.monthly.payLink, "the monthly button carries the server's pay link");
  assert.ok(box.key, "Have a license key? is there");
  assert.ok(box.compare, "the plan comparison is there");
  assert.match(box.text, /Pay on the secure Stripe page\. Meldmind unlocks by itself when it sees the payment\./);
  assert.doesNotMatch(box.text, /license key in Settings/i);
  assert.ok(!box.text.includes(EM_DASH), "no em-dash in the box");
  return box;
}

// Every button the box needs is on screen and on top (not under the dock, the Talk bar or anything else).
async function checkFits(t, label) {
  const card = await t.page.evaluate(() => { const r = document.querySelector("#cc-upgrade .card").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, vh: innerHeight, sx: document.documentElement.scrollWidth }; });
  assert.ok(card.top >= 0 && card.bottom <= card.vh && card.left >= 0 && card.right <= card.vw, `${label}: the box fits the window ${JSON.stringify(card)}`);
  for (const sel of ["#cc-upgrade-x", "#cc-upgrade [data-up-main] .btn:first-child", "#cc-upgrade [data-up-main] .btn:nth-child(2)", "#cc-upgrade-key", "#cc-upgrade-close"]) {
    await t.page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "nearest" }), sel);
    const h = await onScreen(t.page, sel);
    assert.ok(h.found && h.inside && h.top, `${label}: ${sel} is on screen and on top ${JSON.stringify(h)}`);
  }
}

test("source: the old 'license key in Settings' upgrade lines are gone and the entries open the box", () => {
  const app = read("web", "app.js");
  assert.doesNotMatch(app, /Upgrade means adding a license key in Settings/);
  assert.match(app, /\$\("#basics-upgrade"\)\.addEventListener\("click", \(\) => openUpgrade\(\)\)/);
  const growth = read("web", "features", "growth.js");
  assert.doesNotMatch(growth, /Upgrading means adding a license key in Settings/);
  assert.match(growth, /window\.CC\.openUpgrade\(\)/);
  assert.match(read("web", "index.html"), /id="cc-upgrade-chip"[^>]*hidden>Upgrade</);
  assert.match(read("web", "mac", "parts", "shell.js"), /id="mac-upgrade"[^>]*hidden>Upgrade</);
  // The billing side is untouched: the box only reuses the plan-compare buttons and openPayLink.
  assert.match(app, /upgradeButtonsHtml\(\{ plans: pickPlans\(split\[0\]\), tier, primary: true \}\)/);
  for (const f of [["web", "app.js"], ["web", "features", "growth.js"], ["web", "mac", "parts", "shell.js"], ["web", "index.html"]]) {
    const src = read(...f);
    for (const line of src.split("\n").filter((l) => /0\.4\.38 \(Chris: upgrade in the app\)|Pay on the secure Stripe page|See all plans|Have a license key\?|Upgrade to a paid plan/.test(l))) {
      assert.ok(!line.includes(EM_DASH), `${f.join("/")}: no em-dash in ${line.trim().slice(0, 80)}`);
    }
  }
});

test("Mac look on Free (1366 x 800, light, Simple): the Upgrade chip opens the box; Go Pro opens the pay link and shows the waiting line", { skip }, async () => {
  const t = await boot({ theme: "light", mode: "simple", width: 1366, height: 800 });
  try {
    const p = await plans(t);
    assert.ok(p.monthly.payLink && p.monthly.payLink.includes("prefilled_email="), `the server prefills the email: ${p.monthly.payLink}`);
    await t.page.waitForSelector("#mac-upgrade", { state: "visible", timeout: WAIT });
    const chip = await onScreen(t.page, "#mac-upgrade");
    assert.ok(chip.inside && chip.top, `the chip is on screen ${JSON.stringify(chip)}`);
    assert.equal((await t.page.textContent("#mac-upgrade")).trim(), "Upgrade");
    await shot(t, "upgrade-chip-mac-1366-light.png");
    await t.page.click("#mac-upgrade");
    await checkBox(t, p);
    assert.equal((await t.page.textContent("#cc-upgrade-title")).trim(), "Upgrade to a paid plan");
    await checkFits(t, "1366 light Simple");
    await shot(t, "upgrade-box-mac-1366-light.png");
    // See all plans shows the other buy buttons, each with the server's label.
    await t.page.click("#cc-upgrade-all");
    const more = await t.page.$$eval("#cc-upgrade-more .btn", (bs) => bs.map((b) => b.textContent.trim()));
    for (const k of ["extremeMonthly", "extremeYearly", "developerMonthly", "developerYearly", "lifetime"]) {
      if (p[k]) assert.ok(more.includes(p[k].button), `${k} is under See all plans: ${JSON.stringify(more)}`);
    }
    // Go Pro monthly: the stubbed opener gets the server's link (email prefilled), and the waiting line shows.
    assert.equal(await t.page.isVisible("#cc-upgrade [data-paid-now]"), false, "I paid, check now waits until a link opens");
    await t.page.click("#cc-upgrade [data-up-main] .btn:first-child");
    await t.page.waitForFunction(() => window.__opened.length > 0, null, { timeout: WAIT });
    const opened = await t.page.evaluate(() => window.__opened);
    assert.equal(opened.length, 1, JSON.stringify(opened));
    assert.equal(opened[0].url, p.monthly.payLink);
    assert.equal(new URL(opened[0].url).searchParams.get("prefilled_email"), EMAIL);
    await t.page.waitForSelector("#cc-upgrade [data-paid-wait]:not([hidden])", { timeout: WAIT });
    assert.match(await t.page.textContent("#cc-upgrade [data-paid-wait]"), /Waiting for your purchase to confirm/);
    assert.equal(await t.page.isVisible("#cc-upgrade [data-paid-now]"), true, "I paid, check now shows after the link opens");
    assert.equal(await t.page.evaluate(() => location.pathname), "/", "the app did not navigate away");
    await shot(t, "upgrade-box-mac-1366-light-waiting.png");
    // Have a license key? reaches the key box.
    await t.page.click("#cc-upgrade-key");
    await t.page.waitForFunction(() => !document.getElementById("cc-upgrade"), null, { timeout: WAIT });
    await t.page.waitForSelector("#lic-key", { state: "visible", timeout: WAIT });
    await t.page.waitForFunction(() => document.activeElement?.id === "lic-key", null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("Mac look Simple Settings (1366 x 800, dark): the Upgrade button opens the same box", { skip }, async () => {
  const t = await boot({ theme: "dark", mode: "simple", width: 1366, height: 800 });
  try {
    const p = await plans(t);
    await t.page.evaluate(() => window.CC.go("settings"));
    await t.page.waitForSelector("#basics-upgrade", { state: "visible", timeout: WAIT });
    await t.page.click("#basics-upgrade");
    await checkBox(t, p);
    await checkFits(t, "1366 dark Simple Settings");
    await shot(t, "upgrade-box-mac-1366-dark.png");
    await t.page.click("#cc-upgrade-close");
    await t.page.waitForFunction(() => !document.getElementById("cc-upgrade"), null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("classic look on Free (1366 x 800, dark, Expert): the top bar Upgrade chip opens the box", { skip }, async () => {
  const t = await boot({ mac: false, theme: "dark", mode: "expert", width: 1366, height: 800 });
  try {
    const p = await plans(t);
    assert.notEqual(await t.page.evaluate(() => document.body.dataset.style), "mac");
    await t.page.waitForSelector("#cc-upgrade-chip", { state: "visible", timeout: WAIT });
    const chip = await onScreen(t.page, "#cc-upgrade-chip");
    assert.ok(chip.inside && chip.top, `the chip is on screen ${JSON.stringify(chip)}`);
    await shot(t, "upgrade-chip-classic-1366-dark.png");
    await t.page.click("#cc-upgrade-chip");
    await checkBox(t, p);
    await checkFits(t, "classic 1366 dark Expert");
    await shot(t, "upgrade-box-classic-1366-dark.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

for (const [theme, mode] of [["dark", "simple"], ["light", "expert"]]) {
  test(`390 x 844 (${theme}, ${mode}): a real Pro gate opens the box with the buy buttons, and it all fits`, { skip }, async () => {
    const t = await boot({ theme, mode, width: 390, height: 844 });
    try {
      const p = await plans(t);
      // The chip stays in the title bar at phone width, on screen and on top.
      await t.page.waitForSelector("#mac-upgrade", { state: "visible", timeout: WAIT });
      const chip = await onScreen(t.page, "#mac-upgrade");
      assert.ok(chip.inside && chip.top, `the chip is on screen at 390 ${JSON.stringify(chip)}`);
      const bar = await t.page.evaluate(() => { const b = document.getElementById("mac-titlebar"); return { sw: b.scrollWidth, cw: b.clientWidth, page: document.documentElement.scrollWidth, vw: innerWidth }; });
      assert.ok(bar.sw <= bar.cw + 1 && bar.page <= bar.vw, `the title bar does not overflow ${JSON.stringify(bar)}`);
      // Nothing in the bar sits on top of the chip (the page name gives up its room at phone width, as for "3 steps").
      const clash = await t.page.evaluate(() => {
        const chip = document.getElementById("mac-upgrade").getBoundingClientRect();
        const kids = [...document.querySelectorAll("#mac-titlebar > *, #mac-titlebar .mac-title > *")].filter((e) => e.id !== "mac-upgrade" && e.id !== "mac-flash" && !e.classList.contains("mac-gap") && !e.classList.contains("mac-title"));
        return kids.map((e) => ({ e: e.id || e.tagName, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.left < chip.right - 1 && r.right > chip.left + 1).map(({ e, r }) => `${e} ${Math.round(r.left)}-${Math.round(r.right)}`);
      });
      assert.deepEqual(clash, [], "nothing overlaps the Upgrade chip");
      for (const sel of ["#mac-expert", "#mac-theme", "#mac-help"]) {
        const h = await onScreen(t.page, sel);
        assert.ok(h.inside && h.top, `${sel} is still on screen next to the chip ${JSON.stringify(h)}`);
      }
      await shot(t, `upgrade-chip-mac-390-${theme}-${mode}.png`);
      // A free install asking for a Pro feature (a public share link) gets the real "That is a Pro feature" box.
      await t.page.evaluate(() => window.CC.api("/share/public", { method: "POST", body: { missionId: "m-free" } }).catch(() => {}));
      await checkBox(t, p);
      assert.equal((await t.page.textContent("#cc-upgrade-title")).trim(), "That is a Pro feature");
      await checkFits(t, `390 ${theme} ${mode}`);
      await t.page.evaluate(() => { const c = document.querySelector("#cc-upgrade .card"); c.scrollTop = 0; });
      await shot(t, `upgrade-box-mac-390-${theme}-${mode}.png`);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

test("classic look at 390 x 844 (light, Simple): the chip stays on screen with no sideways scroll, and the box fits", { skip }, async () => {
  const t = await boot({ mac: false, theme: "light", mode: "simple", width: 390, height: 844 });
  try {
    const p = await plans(t);
    for (const v of ["projects", "command"]) {
      await t.page.evaluate((x) => window.CC.go(x), v);
      await t.page.waitForTimeout(500);
      const sw = await t.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
      assert.ok(sw.sw <= sw.vw, `${v}: no sideways scroll ${JSON.stringify(sw)}`);
    }
    // On the home page (no Back button) the chip is in the top bar, on screen and on top.
    await t.page.waitForSelector("#cc-upgrade-chip", { state: "visible", timeout: WAIT });
    const chip = await onScreen(t.page, "#cc-upgrade-chip");
    assert.ok(chip.inside && chip.top, `the chip is on screen ${JSON.stringify(chip)}`);
    await t.page.evaluate(() => window.CC.go("command"));
    await shot(t, "upgrade-chip-classic-390-light.png");
    await t.page.click("#cc-upgrade-chip");
    await checkBox(t, p);
    await checkFits(t, "classic 390 light Simple");
    await t.page.evaluate(() => { const c = document.querySelector("#cc-upgrade .card"); c.scrollTop = 0; });
    await shot(t, "upgrade-box-classic-390-light.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("owner license (CC_DEV_OWNER=1): no Upgrade chip in the Mac title bar or the classic top bar", { skip }, async () => {
  const t = await boot({ env: { CC_DEV_OWNER: "1" }, width: 1366, height: 800 });
  try {
    const tier = await t.page.evaluate(() => window.CC.S.license.tier);
    assert.notEqual(tier, "free", `the owner license is on (${tier})`);
    await t.page.waitForTimeout(1500); // the title bar paints once a second
    assert.equal(await t.page.isVisible("#mac-upgrade"), false, "no chip in the Mac title bar");
    assert.equal(await t.page.evaluate(() => window.CC.upgradeOffered()), false);
    await t.page.evaluate(() => { localStorage.setItem("cc.mac", "0"); });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.S.license && window.CC.S.settingsLoaded, null, { timeout: WAIT });
    await t.page.waitForTimeout(800);
    assert.notEqual(await t.page.evaluate(() => document.body.dataset.style), "mac");
    assert.equal(await t.page.isVisible("#cc-upgrade-chip"), false, "no chip in the classic top bar");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
