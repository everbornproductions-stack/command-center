// 0.4.38 (Chris, after 0.4.37: "clicking Just chat everything is completely unreadable" ... "the menu you can't see
// anything" ... "we need consistency throughout"): the theme in Settings > Look (html[data-theme]) and the Mac look's own
// light/dark switch (body[data-theme]) disagreed on his PC (theme dark, Mac light), so the sidebar painted white text on
// beige. The saved theme is now the one source. This test starts with them disagreeing both ways, then measures the text
// on every main page in light and dark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBrowser, bootPage } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = 30000;

async function boot({ classic, mac, mode = "simple" }) {
  const t = await bootPage({ mac: "default", hidePopups: true, mode, width: 1366, height: 800 });
  await t.api("/themes", { body: { mode: classic, wallpaper: "image:stage" } });
  await t.page.evaluate((m) => { localStorage.setItem("cc.mac", "1"); localStorage.setItem("cc.mac.theme", m); }, mac);
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite,#cc-whats-new,.toasts{display:none!important}" });
  return t;
}

// the contrast of every visible bit of text in the given places, against the first solid background behind it
const LOW = (sels) => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== "none" && !cs.backgroundImage.startsWith("linear-gradient(rgba(0, 0, 0, 0)")) return null; const c = rgb(cs.backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.9)) return c; } return null; };
  const out = [];
  for (const el of document.querySelectorAll(sels)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || getComputedStyle(el).visibility === "hidden") continue;
    if (!(el.innerText || "").trim()) continue;
    const bg = bgOf(el); if (!bg) continue;
    const fg = rgb(getComputedStyle(el).color);
    const v = ratio(fg.slice(0, 3), bg.slice(0, 3));
    if (v < 4.5) out.push(`${(el.innerText || "").trim().slice(0, 30)} ${v.toFixed(2)}:1`);
  }
  return out;
};
const PLACES = "#mac-side .si .mx-nm, .side .side-item, .side .side-h, .side .side-chat, #side-new, #mx-new-chat, #view h1, #view h2, #view h3, .mf-title, #mf-chat-card b, .sc-empty h2, .vt-bar b";

test("browser: the Mac look follows the saved theme when the two disagree, both ways, and the button changes both", { skip, timeout: 240000 }, async () => {
  for (const [classic, mac] of [["dark", "light"], ["light", "dark"]]) {
    const t = await boot({ classic, mac });
    try {
      const th = await t.page.evaluate(() => ({ html: document.documentElement.dataset.theme, body: document.body.dataset.theme }));
      assert.deepEqual(th, { html: classic, body: classic }, `saved ${classic}, Mac switch ${mac}`);
      await t.page.click("#mac-theme");
      const other = classic === "dark" ? "light" : "dark";
      await t.page.waitForFunction((o) => document.documentElement.dataset.theme === o && document.body.dataset.theme === o, other, { timeout: WAIT });
      assert.equal((await t.api("/themes")).json.mode, other, "the button saved the theme in Settings > Look too");
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }
});

test("browser: every main page reads at 4.5 : 1 in light and dark, Simple and Expert (sidebar, headings, chat)", { skip, timeout: 600000 }, async () => {
  for (const mode of ["simple", "expert"]) {
    for (const theme of ["light", "dark"]) {
      const t = await boot({ classic: theme, mac: theme === "dark" ? "light" : "dark", mode });
      try {
        for (const view of ["command", "projects", "agents", "settings", "history"]) {
          await t.page.evaluate((v) => window.CC.go(v), view);
          await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
          await t.page.waitForTimeout(400);
          const low = await t.page.evaluate(LOW, PLACES);
          assert.deepEqual(low, [], `${mode} ${theme} ${view}`);
        }
        if (mode === "simple") {
          await t.page.evaluate(() => window.CC.go("command"));
          await t.page.evaluate(() => document.querySelector("#mf-chat-card")?.click());
          await t.page.waitForTimeout(600);
          assert.deepEqual(await t.page.evaluate(LOW, PLACES), [], `simple ${theme} Just chat`);
        }
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    }
  }
});
