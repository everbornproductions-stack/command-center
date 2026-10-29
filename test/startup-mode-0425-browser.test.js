// 0.4.25 in a real browser: (1) when the engine stops, the first 90 s show "Meldmind is starting up" and no full-screen
// "engine is not responding" box at 15.5 s; (2) a project whose own mode differs from the global one shows a note with
// "Use Simple everywhere", and that button clears every project's own choice. Skips only when no Chrome is installed.
// Windows rules: real waits, the browser and server are always closed.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("engine stops soon after launch: calm starting-up line, no box at 15.5 s", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    await t.page.waitForFunction(() => document.getElementById("conn-txt")?.textContent === "live", null, { timeout: 30000 });
    const pageAge = await t.page.evaluate(() => performance.now());
    await t.s.stop(); // the engine goes away while the page is young
    await t.page.waitForSelector("#engine-starting", { timeout: 15000 });
    const line = await t.page.evaluate(() => {
      const el = document.getElementById("engine-starting");
      return { text: el.textContent, role: el.getAttribute("role"), pe: getComputedStyle(el).pointerEvents, conn: document.getElementById("conn-txt").textContent };
    });
    assert.match(line.text, /^Meldmind is starting up\./);
    assert.equal(line.role, "status");
    assert.equal(line.pe, "none", "the line never takes a click");
    assert.equal(line.conn, "starting up");
    if (pageAge < 60000) {
      await new Promise((r) => setTimeout(r, 17000)); // past the old 15.5 s box
      assert.equal(await t.page.evaluate(() => !!document.getElementById("engine-down")), false, "no full-screen box during a cold start");
      assert.equal(await t.page.evaluate(() => !!document.getElementById("engine-starting")), true);
    }
  } finally { await t.close(); }
});

test("a project set to Expert under a global Simple shows the note, and 'Use Simple everywhere' clears every project's own mode", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    const st = (await t.api("/state")).json;
    const first = (st.projects || [])[0];
    assert.ok(first && first.id, "a project exists");
    assert.equal((await t.api("/projects", { body: { id: first.id, uiMode: "expert" } })).status, 200);
    const extra = await t.api("/projects", { body: { name: "Review replies", uiMode: "simple" } }); // may be refused by the free plan's project limit
    await t.page.evaluate((id) => localStorage.setItem("cc.project", id), first.id);
    await t.page.reload();
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.S.settingsLoaded, null, { timeout: 30000 });
    await t.page.waitForSelector("#cc-project-mode-note", { timeout: 15000 });
    const note = await t.page.evaluate(() => ({ text: document.getElementById("cc-project-mode-note").innerText, mode: window.CC.S.uiMode, inNotices: !!document.querySelector("#notices #cc-project-mode-note") }));
    assert.match(note.text, /This project is set to Expert\./);
    assert.match(note.text, /Use Simple everywhere/);
    assert.equal(note.mode, "expert", "the project's own choice still applies until the person picks");
    assert.equal(note.inNotices, true);
    await t.page.click("#cc-mode-everywhere");
    await t.page.waitForFunction(() => window.CC.S.uiMode === "simple" && !document.getElementById("cc-project-mode-note"), null, { timeout: 15000 });
    let left = null;
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const projects = (await t.api("/state")).json.projects || [];
      left = projects.filter((p) => p.uiMode === "simple" || p.uiMode === "expert").map((p) => p.id);
      if (!left.length) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.deepEqual(left, [], `every project's own mode is cleared (extra project ${extra.status === 200 ? "made" : "refused"})`);
    assert.equal((await t.api("/state")).json.settings.uiMode, "simple", "the global choice is saved");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
