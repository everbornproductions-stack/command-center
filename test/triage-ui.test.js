// Triage line under the answer's "who wrote it" label: "Triage: <Tier> · <reason>", muted, on screen and inside the
// card at phone (390 x 844, 360 x 740) and tablet (768 x 1024) sizes, in light and dark. Each size boots fresh, the
// way a phone or tablet opens the app (a desktop window shrunk to 390 keeps the Mac sidebar over the page).
// Real server in demo mode (practice AIs, no key, nothing sent) and headless Chrome (skips when none is installed).
// Windows rules: one server and one browser at a time, real waits, everything closed.
import test from "node:test";
import assert from "node:assert/strict";
import { waitBudget } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer,.toasts";
const LINE = /^Triage: (Trivial|Standard|Hard|Top) · \S/;
const SIZES = [[390, 844], [360, 740], [768, 1024]];

async function boot(theme, width, height) {
  const t = await bootPage({ mac: "default", hidePopups: false, theme, width, height, mode: "expert" });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.api("/settings", { body: { uiMode: "expert", uiModeChosen: true, expertConfirmed: true } });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.S?.settingsLoaded && window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    return t;
  } catch (e) { await t.close(); throw e; }
}
// Expert shows "<AI> · <model>" over the answer, the line the triage sits under. Read the mode back (LESSONS 2026-10-30).
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.evaluate(() => document.getElementById("mac-expert")?.click());
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
}

for (const theme of ["light", "dark"]) {
  for (const [width, height] of SIZES) {
    const at = `${width} x ${height} ${theme}`;
    test(`the answer shows its triage at ${at}`, { skip }, async () => {
      const t = await boot(theme, width, height);
      try {
        await toExpert(t);
        assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "expert");
        await t.page.evaluate(() => window.CC.go("command"));
        await t.page.waitForSelector("#orders", { timeout: WAIT });
        await t.page.fill("#orders", "Add a dark mode toggle to settings.js that saves the choice");
        await t.page.evaluate(() => document.getElementById("go").click());
        await t.page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !!window.CC.S.live?.mission?.triage, null, { timeout: RUN });
        await t.page.waitForFunction(() => { const el = document.getElementById("out-triage"); return el && !el.hidden && el.textContent.trim(); }, null, { timeout: WAIT });
        await t.page.evaluate(() => document.getElementById("out-triage").scrollIntoView({ block: "center" }));
        // the page settles (answer reveal, fades) before the hit test; a real deadline, not a fixed pause
        await t.page.waitForFunction(() => {
          const el = document.getElementById("out-triage"), b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(b.left + 4, innerWidth - 1), b.top + b.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        }, null, { timeout: WAIT }).catch(() => {});
        const r = await t.page.evaluate(() => {
          const el = document.getElementById("out-triage"), card = el.closest(".sc-card") || el.parentElement;
          const b = el.getBoundingClientRect(), c = card.getBoundingClientRect(), cs = getComputedStyle(el);
          const hit = document.elementFromPoint(Math.min(b.left + 4, innerWidth - 1), b.top + b.height / 2);
          const who = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}` : "nothing";
          return { text: el.textContent.trim(), hidden: el.hidden, h: b.height, left: b.left, right: b.right, cardLeft: c.left, cardRight: c.right, vw: innerWidth, sw: document.documentElement.scrollWidth, display: cs.display, ownHit: !!hit && (hit === el || el.contains(hit)), who, tier: window.CC.S.live.mission.triage.tier };
        });
        assert.match(r.text, LINE, at);
        assert.ok(r.text.toLowerCase().includes(r.tier), `${at}: the line names the run's tier`);
        assert.doesNotMatch(r.text, /—/, at);
        assert.equal(r.hidden, false, at);
        assert.notEqual(r.display, "none", at);
        assert.ok(r.h > 0, `${at}: the line has height`);
        assert.ok(r.left >= r.cardLeft - 1 && r.right <= r.cardRight + 1, `${at}: inside the answer card (${r.left}..${r.right} in ${r.cardLeft}..${r.cardRight})`);
        assert.ok(r.right <= r.vw + 1 && r.sw <= r.vw + 1, `${at}: no sideways overflow`);
        assert.ok(r.ownHit, `${at}: nothing covers the line (hit ${r.who})`);
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    });
  }
}
