// 0.4.31: Mac shell fixes from the 0.4.28 persona panel (meldmind-panel-0428/FIXES-0430.md items 2, 3, 4, 11b, 11c).
// Real server in demo mode (practice AIs, no keys, nothing sent) and headless Chrome; skips only when no Chrome is
// installed. Hit tests use elementFromPoint, contrast is measured on painted pixels. Windows rules: one browser at a
// time, real waits (waitForFunction), every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast } from "./paint-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer";

// Boot as a new user does (Mac look on), practice AIs on when asked, and wait for every Mac part.
async function bootNew({ demo = true, ...opts } = {}) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    if (demo) {
      assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
      await t.page.reload({ waitUntil: "domcontentloaded" });
    }
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
}
async function go(t, view) {
  await t.page.evaluate((v) => window.CC.go(v), view);
  await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
}
// Clear the toasts already on screen, show one, and return its box (and the boxes of the named elements).
async function showToast(page, msg, err, sels) {
  await page.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((e) => e.remove()); });
  await page.evaluate(([m, e]) => window.CC.toast(m, e), [msg, err]);
  await page.waitForFunction((m) => [...document.querySelectorAll("#toasts .toast")].some((e) => e.textContent.includes(m) && e.getBoundingClientRect().height > 0), msg, { timeout: WAIT });
  return page.evaluate(([m, sels]) => {
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    const el = [...document.querySelectorAll("#toasts .toast")].find((e) => e.textContent.includes(m));
    const out = { toast: box(el), vw: innerWidth, vh: innerHeight };
    for (const s of sels) out[s] = box(document.querySelector(s));
    return out;
  }, [msg, sels]);
}
const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const onScreen = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}, sel);

// ---------- items 2 and 11b: Expert 1366 x 800 ----------

test("Expert 1366 x 800: the savings card says Estimate at 0 runs, a toast stays off the Deliverable and the page, and the card catches up after an answer", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 1366, height: 800 });
  try {
    await toExpert(t);
    await go(t, "command");
    // 11b: a new install has no runs yet. "over 0 runs" is gone; the card says Estimate.
    await t.page.waitForSelector("[data-cc-saved-card]", { timeout: WAIT });
    const before = await t.page.evaluate(() => document.querySelector("[data-cc-saved-card]").textContent.replace(/\s+/g, " "));
    assert.match(before, /All time \$\d+\.\d{2}/, before);
    assert.doesNotMatch(before, /over 0 runs?/, before);
    assert.match(before, /Estimate/, before);
    // Send a task to the practice AI so the Deliverable is showing.
    await t.page.waitForSelector("#orders", { timeout: WAIT });
    await t.page.fill("#orders", "Plan a bake sale for Saturday with a full list of steps");
    await t.page.click("#go");
    await t.page.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
    await t.page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
    await t.page.waitForSelector("#deliv-panel", { state: "visible", timeout: WAIT });
    // 2: the toast sits under the title bar, on screen, clear of the Deliverable and the page.
    const b = await showToast(t.page, "Answer done · Free", false, ["#deliv-panel", "#view", "#mac-titlebar", "#vt-bar", "#mac-dock"]);
    assert.ok(b.toast && b["#deliv-panel"] && b["#view"], JSON.stringify(b));
    assert.ok(b.toast.l >= 0 && b.toast.r <= b.vw && b.toast.t >= 0 && b.toast.b <= b.vh, `on screen ${JSON.stringify(b.toast)}`);
    assert.ok(b.toast.t >= b["#mac-titlebar"].b, `under the title bar ${JSON.stringify(b)}`);
    for (const s of ["#deliv-panel", "#view", "#vt-bar", "#mac-dock"]) assert.equal(overlaps(b.toast, b[s]), false, `toast overlaps ${s}: ${JSON.stringify([b.toast, b[s]])}`);
    // An error toast is placed the same way.
    const e = await showToast(t.page, "Could not reach the engine. Try again.", true, ["#deliv-panel", "#view"]);
    assert.equal(overlaps(e.toast, e["#deliv-panel"]) || overlaps(e.toast, e["#view"]), false, JSON.stringify(e));
    // Toasts still close on their own (3.5 s, 6 s for errors).
    await t.page.waitForFunction(() => document.querySelectorAll("#toasts .toast").length === 0, null, { timeout: waitBudget(15000) });
    // 11b: the card repaints after the answer, so it agrees with the title bar pill.
    await t.page.waitForFunction(() => {
      const pill = document.querySelector("#cc-money-saved-mac [data-cc-ms='month']")?.textContent;
      const card = document.querySelector("[data-cc-saved-card] b")?.textContent;
      return !!pill && pill === card;
    }, null, { timeout: WAIT }).catch(async () => {
      const v = await t.page.evaluate(() => ({ pill: document.querySelector("#cc-money-saved-mac [data-cc-ms='month']")?.textContent, card: document.querySelector("[data-cc-saved-card]")?.textContent }));
      assert.fail(`the card and the pill disagree: ${JSON.stringify(v)}`);
    });
    const after = await t.page.evaluate(() => document.querySelector("[data-cc-saved-card]").textContent.replace(/\s+/g, " "));
    assert.doesNotMatch(after, /over 0 runs?/, after);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 2: phone, with the Pro box open ----------

test("390 x 844: a toast sits under the title bar, and below an open Pro box instead of over it", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 390, height: 844 });
  try {
    const plain = await showToast(t.page, "Answer done · Free", false, ["#mac-titlebar", "#mac-dock", "#mobile-nav", "#vt-bar"]);
    assert.ok(plain.toast.t >= plain["#mac-titlebar"].b, JSON.stringify(plain));
    assert.ok(plain.toast.l >= 0 && plain.toast.r <= plain.vw, JSON.stringify(plain.toast));
    for (const s of ["#mac-dock", "#mobile-nav", "#vt-bar"]) assert.equal(overlaps(plain.toast, plain[s]), false, `toast overlaps ${s}: ${JSON.stringify([plain.toast, plain[s]])}`);
    // A free install asking for a Pro feature opens the real "That is a Pro feature" box.
    await t.page.evaluate(() => window.CC.api("/share/public", { method: "POST", body: { missionId: "m-free" } }).catch(() => {}));
    await t.page.waitForSelector("#cc-upgrade .card", { state: "visible", timeout: WAIT });
    const b = await showToast(t.page, "Could not reach the engine. Try again.", true, ["#cc-upgrade .card"]);
    assert.ok(b.toast && b["#cc-upgrade .card"], JSON.stringify(b));
    assert.ok(b.toast.t >= 0 && b.toast.b <= b.vh, `on screen ${JSON.stringify(b.toast)}`);
    assert.equal(overlaps(b.toast, b["#cc-upgrade .card"]), false, `toast overlaps the Pro box: ${JSON.stringify(b)}`);
    const hit = await onScreen(t.page, "#cc-upgrade-x");
    assert.ok(hit.inside && hit.top, `the box's Close button stays clickable ${JSON.stringify(hit)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 3: the savings pill is readable ----------

for (const theme of ["light", "dark"]) {
  test(`savings pill: 4.5 : 1 or better on painted pixels, 12.5 px, Simple and Expert (${theme})`, { skip }, async () => {
    const t = await bootNew({ demo: false, theme, width: 1366, height: 800, mode: "simple" });
    try {
      for (const mode of ["simple", "expert"]) {
        if (mode === "expert") await toExpert(t);
        await t.page.waitForSelector("#mac-titlebar #cc-money-saved-mac", { state: "visible", timeout: WAIT });
        const info = await t.page.evaluate(() => { const cs = getComputedStyle(document.getElementById("cc-money-saved-mac")); return { ui: document.body.dataset.ui, theme: document.body.dataset.theme, fs: cs.fontSize }; });
        assert.equal(info.ui, mode);
        assert.equal(info.theme, theme);
        assert.equal(info.fs, "12.5px", JSON.stringify(info));
        const res = await paintedContrast(t.page, "#cc-money-saved-mac");
        assert.equal(res.length, 1, `measured the pill (${mode})`);
        assert.ok(res[0].ratio >= 4.5, `${mode} ${theme}: ${res[0].ratio} fg ${res[0].fg} on ${res[0].bg}`);
      }
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

// ---------- item 4: the dock on a phone ----------

test("Simple 390 x 844: the dock's Chat button is on screen and on top, a tap puts the cursor in the box, and the dock swipes", { skip }, async () => {
  const t = await bootNew({ demo: false, theme: "light", width: 390, height: 844, mode: "simple" });
  try {
    await t.page.waitForSelector('#mac-dock .di[data-p="Chat"]', { state: "visible", timeout: WAIT });
    const chat = await onScreen(t.page, '#mac-dock .di[data-p="Chat"]');
    assert.ok(chat.inside && chat.top, JSON.stringify(chat));
    const dock = await t.page.evaluate(() => {
      const d = document.getElementById("mac-dock"), a = document.getElementById("app");
      const r = d.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, appBottom: a.getBoundingClientRect().bottom, sw: d.scrollWidth, cw: d.clientWidth, ox: getComputedStyle(d).overflowX, first: d.querySelector(".di")?.dataset.p };
    });
    assert.equal(dock.first, "Chat", "Chat is first");
    assert.ok(dock.l >= 0 && dock.r <= 390, `the dock fits the window width ${JSON.stringify(dock)}`);
    assert.ok(dock.t >= dock.appBottom, `the dock does not cover the window ${JSON.stringify(dock)}`);
    assert.match(dock.ox, /auto|scroll/);
    assert.ok(dock.sw > dock.cw, "more buttons than fit: the dock swipes sideways");
    // The last button can be brought on screen by scrolling the dock.
    await t.page.evaluate(() => { const d = document.getElementById("mac-dock"); d.scrollLeft = d.scrollWidth; });
    await t.page.waitForFunction(() => { const d = document.getElementById("mac-dock"); return d.scrollLeft > 0; }, null, { timeout: WAIT });
    const last = await onScreen(t.page, "#mac-dock .di:last-of-type");
    assert.ok(last.inside && last.top, JSON.stringify(last));
    await t.page.evaluate(() => { document.getElementById("mac-dock").scrollLeft = 0; });
    await t.page.waitForFunction(() => document.getElementById("mac-dock").scrollLeft === 0, null, { timeout: WAIT });
    await t.page.click('#mac-dock .di[data-p="Chat"]');
    await t.page.waitForFunction(() => document.activeElement && document.activeElement.id === "orders", null, { timeout: WAIT });
    const box = await onScreen(t.page, "#orders");
    assert.ok(box.top, JSON.stringify(box));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 11c and the CSS behind the fixes (source checks) ----------

test("source: toasts no longer float at 168 / 280 px, Live view labels are 12 px, the card never says over 0 runs", () => {
  const shell = read("web", "mac", "css", "shell.css");
  assert.doesNotMatch(shell, /\.toasts\s*\{\s*bottom:\s*(168|280)px/);
  const live = read("web", "features", "liveview.js");
  assert.doesNotMatch(live, /\.lv-node \.lv-(name|init|badge) \{ font-size: (?:\d|1[01])(?:\.\d+)?px/);
  const receipt = read("web", "features", "receipt.js");
  assert.doesNotMatch(receipt, /over \$\{t\.runs\} runs/);
  assert.doesNotMatch(receipt, /2014/);
});
