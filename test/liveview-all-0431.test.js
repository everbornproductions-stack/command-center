// 0.4.31 (Chris: "I don't see live view showing the different AIs working, just has router, even though it looks like
// you're testing stuff"): the jobs ran outside the project in the bar, and Live view showed that idle project's map,
// so only the Router was on it. Now an idle bar project gives way to everything that is running.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const node = (id, name, extra = {}) => ({ id, name, initials: name.slice(0, 2).toUpperCase(), kind: id === "hub" ? "hub" : "text", color: "#D97757", active: false, presence: id === "hub" ? "anchor" : "idle", x: 340, y: 160, radius: 22, usageScale: 1, tiny: false, cost: 0, credits: 0, pending: 0, ...extra });
const hubOnly = { width: 680, height: 320, nodes: [node("hub", "Router")], edges: [] };
const busyFlow = { width: 680, height: 320, nodes: [node("hub", "Router"), node("anthropic", "Claude", { active: true, presence: "live", y: 64, step: "Writing the plan" }), node("google", "Gemini", { active: true, presence: "live", x: 480, y: 220, step: "Checking" })], edges: [{ from: "hub", to: "anthropic", hot: true }, { from: "hub", to: "google", hot: true }] };
const run = { id: "m-x", kind: "mission", projectId: null, title: "Coffee cart opening checklist", status: "running", working: true, step: "Claude writing", cost: 0.02, credits: 0, pending: 0, providerIds: ["anthropic", "google"], workers: [] };

test("Live view shows the AIs working outside an idle bar project, with All picked", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "expert" });
  try {
    const pid = await t.page.evaluate(() => window.CC.S.projects?.[0]?.id || "my-project");
    const payload = { note: null, projects: [{ id: pid, name: "My project", color: "#22d3ee", working: false, step: null, cost: 0, credits: 0, flow: hubOnly, runs: [], links: [] }], unfiled: { runs: [run] }, runs: [run], flow: busyFlow, cost: 0.02, credits: 0, working: true, hiddenIdle: 0, idleCount: 0, freeAi: null, tutorials: [] };
    await t.page.route("**/api/liveview*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
    await t.page.evaluate((id) => { window.CC.S.project = id; window.CC.go("liveview"); }, pid);
    await t.page.waitForSelector("#lv-root .lv-map-slot svg", { timeout: 20000 });
    const info = await t.page.evaluate(() => ({
      names: [...document.querySelectorAll("#lv-root .lv-node .lv-name")].map((n) => n.textContent),
      live: document.querySelectorAll("#lv-root .lv-node.lv-live").length,
      allOn: document.querySelector('#lv-root [data-proj="*"]')?.classList.contains("on"),
    }));
    assert.ok(info.names.includes("Claude") && info.names.includes("Gemini"), JSON.stringify(info));
    assert.ok(info.live >= 2, "both AIs are drawn as working");
    assert.equal(info.allOn, true, "the All choice is lit, so it is clear what is shown");
  } finally { await t.close(); }
});
