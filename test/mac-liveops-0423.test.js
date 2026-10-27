// 0.4.23 Mac Live Ops: unit tests for the pure logic, plus browser tests for the part.
// Windows rules: real waits with deadlines, the browser and the server are always closed.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { goChat, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);

const { workingModel, opsHeader, BAR_LABELS, priorityWord } = await import("../web/mac/data/liveops.js");

// Five steps like a real mission: plan, design, write, check, assemble (web/app.js task fields).
function runTasks(statuses) {
  const caps = ["plan", "design", "code", "qa", "assemble"];
  const titles = ["Plan the steps", "Pick colours", "Write the page", "Check quality", "Put it together"];
  const tasks = {};
  statuses.forEach((st, i) => {
    tasks[`t${i + 1}`] = { id: `t${i + 1}`, title: titles[i], status: st, capability: caps[i], provider: "demo-nova", model: "nova", cost: 0.004 };
  });
  return tasks;
}
const running = () => ({ id: "m-1", kind: "mission", status: "running", agents: {}, tasks: runTasks(["done", "done", "running", "queued", "queued"]), mission: { cost: 0.031 }, council: null, deliverable: "", primary: null });

// ---------- pure: workingModel ----------
test("workingModel: running shows exactly 3 bars and 'Working on step 3 of 5'", () => {
  const m = workingModel(running());
  assert.deepEqual(m.bars.map((b) => b.label), BAR_LABELS);
  assert.deepEqual(BAR_LABELS, ["Planning", "Writing", "Checking"]);
  assert.equal(m.bars.length, 3, "exactly 3 plain bars");
  assert.equal(m.line, "Working on step 3 of 5");
  assert.equal(m.showSteps, true);
  for (const b of m.bars) assert.equal(Number.isInteger(b.pct) && b.pct >= 0 && b.pct <= 100, true, JSON.stringify(b));
  assert.equal(m.bars[0].pct, 100, "the plan step is done");
  assert.equal(m.bars[2].pct, 0, "checking has not started");
  assert.ok(m.bars[1].pct > 0 && m.bars[1].pct < 100, `writing is in the middle (${m.bars[1].pct})`);
});

test("workingModel: done fills every bar and says all steps are done", () => {
  const live = running();
  live.status = "done";
  live.tasks = runTasks(["done", "done", "done", "done", "done"]);
  const m = workingModel(live);
  assert.deepEqual(m.bars.map((b) => b.pct), [100, 100, 100]);
  assert.equal(m.line, "All 5 steps done");
  assert.equal(m.showSteps, true);
});

test("workingModel: failed stops at the step that failed", () => {
  const live = running();
  live.status = "failed";
  live.tasks = runTasks(["done", "done", "failed", "queued", "queued"]);
  const m = workingModel(live);
  assert.equal(m.line, "Stopped at step 3 of 5");
  assert.equal(m.showSteps, true);
  assert.equal(m.bars[0].pct, 100, "what finished stays finished");
});

test("workingModel: empty has 3 zero bars, no steps link and a plain line", () => {
  for (const live of [{}, null, { id: null, tasks: {} }]) {
    const m = workingModel(live);
    assert.equal(m.bars.length, 3);
    assert.deepEqual(m.bars.map((b) => b.label), ["Planning", "Writing", "Checking"]);
    assert.deepEqual(m.bars.map((b) => b.pct), [0, 0, 0]);
    assert.equal(m.showSteps, false);
    assert.equal(typeof m.line, "string");
    assert.ok(m.line.length > 0, "the line always says something plain");
  }
});

test("workingModel: planning with no steps yet, and steps without a capability split by place", () => {
  const plan = workingModel({ id: "m-2", kind: "mission", status: "planning", tasks: {} });
  assert.equal(plan.line, "Planning your run");
  assert.equal(plan.showSteps, true);
  assert.deepEqual(plan.bars.map((b) => b.pct), [0, 0, 0]);
  // no capability chips: first third counts as Planning, middle as Writing, last as Checking
  const t = {};
  ["done", "running", "queued", "queued", "queued"].forEach((st, i) => { t[`x${i}`] = { id: `x${i}`, title: `s${i}`, status: st }; });
  const m = workingModel({ id: "m-3", kind: "mission", status: "running", tasks: t });
  assert.equal(m.bars[0].pct, 65, "the first two steps split into Planning: (100 + 30) / 2");
  assert.equal(m.bars[2].pct, 0, "the last step is Checking and has not started");
  assert.equal(m.line, "Working on step 2 of 5");
});

// ---------- pure: opsHeader ----------
test("opsHeader: the header line carries kind, step, cost and priority", () => {
  assert.equal(opsHeader(running(), "balanced"), "Mission running, step 3 of 5, $0.031 so far, Balanced");
  assert.equal(opsHeader({}, "balanced"), "Nothing running");
  const done = running();
  done.status = "paused";
  assert.equal(opsHeader(done, "max"), "Mission paused, step 3 of 5, $0.031 so far, Max quality");
  const noTasks = running();
  noTasks.tasks = {};
  assert.equal(opsHeader(noTasks, "speed"), "Mission running, $0.031 so far, Speed");
  assert.equal(priorityWord("economy"), "Max savings");
  assert.equal(priorityWord(undefined), "Balanced");
});

// ---------- browser: the Simple "AIs working" card ----------
async function demo(t) {
  assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite{display:none!important}" });
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 20000 });
  await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: 30000 });
}

const FAKE = `(() => {
  const S = window.CC.S;
  S.costMode = "balanced";
  const caps = ["plan", "design", "code", "qa", "assemble"];
  const titles = ["Plan the steps", "Pick colours", "Write the page", "Check quality", "Put it together"];
  const sts = ["done", "done", "running", "queued", "queued"];
  const tasks = {};
  titles.forEach((title, i) => {
    tasks["t" + (i + 1)] = { id: "t" + (i + 1), title, status: sts[i], capability: caps[i], provider: "demo-nova", model: "nova", cost: 0.004, estCost: 0.004 };
  });
  tasks.t3.retried = true;
  tasks.t3.review = { score: 9, pass: true, issues: [] };
  S.live = { id: "m-liveops", kind: "mission", status: "running", agents: {}, tasks, mission: { cost: 0.031, prompt: "bakery site" }, council: null, deliverable: "", primary: null };
  window.CC.render();
})()`;

test("browser: the Simple card shows 3 bars and a line, Show steps opens Live Ops, and the card keeps up", { skip }, async () => {
  const t = await bootMac({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    await goChat(t.page);
    await t.page.evaluate(FAKE);
    await t.page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "mac-test-box";
      // With the shell merged, #app is a fixed window; keep the test box on top so clicks reach it.
      box.style.cssText = "position:fixed;top:0;left:0;width:520px;height:600px;z-index:9999;";
      document.body.appendChild(box);
      window.CC.mac.liveops.mountWorking(box);
      window.__macOpen = [];
      window.CC.mac.bus.on("open", (d) => window.__macOpen.push(d));
    });
    await t.page.waitForFunction(() => {
      const card = document.querySelector("#mac-test-box .mac-work");
      if (!card) return false;
      const line = card.querySelector(".mac-work-line")?.textContent || "";
      return card.querySelectorAll(".mac-work-bar").length === 3 && line === "Working on step 3 of 5";
    }, null, { timeout: WAIT });
    const bars = await t.page.evaluate(() => [...document.querySelectorAll("#mac-test-box .mac-work-bar")].map((b) => ({
      label: b.getAttribute("aria-label"), now: b.getAttribute("aria-valuenow"),
      fill: b.querySelector("i")?.style.width || "", role: b.getAttribute("role"),
    })));
    assert.equal(bars.length, 3, "exactly 3 bars");
    assert.deepEqual(bars.map((b) => b.label), ["Planning", "Writing", "Checking"]);
    assert.equal(bars[0].role, "progressbar");
    assert.equal(bars[0].now, "100");
    assert.ok(parseFloat(bars[1].fill) > 0 && parseFloat(bars[1].fill) < 100, `middle bar is part way (${bars[1].fill})`);
    assert.equal(bars[2].now, "0");
    // "Show steps" emits bus open {panel: "live"}
    await t.page.click("#mac-test-box .mac-work-steps");
    await t.page.waitForFunction(() => (window.__macOpen || []).some((d) => d && d.panel === "live"), null, { timeout: WAIT });
    const ev = await t.page.evaluate(() => window.__macOpen.at(-1));
    assert.deepEqual(ev, { panel: "live" });
    assert.equal(await t.page.evaluate(() => document.querySelector("#mac-test-box .mac-work-steps").hidden), false, "the link shows while a run is going");
    // the card follows the run without a reload
    await t.page.evaluate(() => { const S = window.CC.S; S.live.status = "done"; for (const tsk of Object.values(S.live.tasks)) tsk.status = "done"; window.CC.render(); });
    await t.page.waitForFunction(() => (document.querySelector("#mac-test-box .mac-work-line")?.textContent || "") === "All 5 steps done", null, { timeout: WAIT });
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

// ---------- browser: the Expert Live Ops screen ----------
test("browser: the Live Ops screen keeps #ops-panel, graph and steps, wires the buttons and feed", { skip }, async () => {
  const t = await bootMac({ mode: "expert", width: 1400, height: 900 });
  try {
    await demo(t);
    // The sample project keeps its own mode; the switch sets Expert for it (same as test/dock.test.js).
    await t.page.waitForFunction(() => {
      if (window.CC.S.uiMode === "expert") return true;
      document.querySelector("#mode-expert")?.click();
      return false;
    }, null, { timeout: WAIT, polling: 700 });
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
    await goChat(t.page);
    await t.page.waitForSelector("#ops-panel", { timeout: WAIT });
    await t.page.evaluate(FAKE);
    await t.page.waitForFunction(() => /Live ops|#ops-pause/.test(document.getElementById("ops-panel")?.innerHTML || ""), null, { timeout: WAIT });
    // the screen mounts into a container of its own and adopts the app's real nodes
    await t.page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "mac-test-box";
      // With the shell merged, #app is a fixed window; keep the test box on top so clicks reach it.
      box.style.cssText = "position:fixed;top:0;left:0;width:520px;height:600px;z-index:9999;";
      document.body.appendChild(box);
      window.CC.mac.liveops.mountOps(box);
    });
    await t.page.waitForFunction(() => {
      const box = document.getElementById("mac-test-box");
      const p = document.getElementById("ops-panel");
      return !!(box && p && box.contains(p) && p.querySelector("#graph") && p.querySelector("#tasks"))
        && document.querySelectorAll("#ops-panel").length === 1;
    }, null, { timeout: WAIT });
    const r = await t.page.evaluate(() => {
      const box = document.getElementById("mac-test-box");
      const screen = box.querySelector("#mac-lo");
      const panel = document.getElementById("ops-panel");
      const feed = document.getElementById("feed");
      return {
        screenVisible: !!screen && !screen.hidden,
        panelInScreen: !!panel && screen.contains(panel),
        graphKept: document.querySelectorAll("#graph").length === 1 && panel.contains(document.getElementById("graph")),
        tasksKept: !!panel.querySelector("#tasks"),
        feedInScreen: !!feed && screen.contains(feed),
        copies: document.querySelectorAll("#ops-panel").length,
        line: screen.querySelector(".mac-lo-line")?.textContent || "",
        chips: panel.querySelector("#tasks")?.innerHTML || "",
        pauseShown: screen.querySelector("#mac-lo-pause")?.hidden === false,
        resumeHidden: screen.querySelector("#mac-lo-resume")?.hidden === true,
        stopShown: screen.querySelector("#mac-lo-stop")?.hidden === false,
        hintHidden: screen.querySelector("#mac-lo-hint")?.hidden === true,
      };
    });
    assert.equal(r.screenVisible, true, "the screen opens");
    assert.equal(r.panelInScreen, true, "#ops-panel is reparented, not rebuilt");
    assert.equal(r.copies, 1, "one #ops-panel in the document");
    assert.equal(r.graphKept, true, "#graph rides along");
    assert.equal(r.tasksKept, true, "the step list rides along");
    assert.equal(r.feedInScreen, true, "the live feed is a column of the screen");
    assert.equal(r.line, "Mission running, step 3 of 5, $0.031 so far, Balanced");
    assert.match(r.chips, /QA 9/, "the QA chip the app draws is kept");
    assert.match(r.chips, /re-assigned/, "the re-assigned chip the app draws is kept");
    assert.match(r.chips, /st running|class="st running"/, "the status chip the app draws is kept");
    assert.equal(r.pauseShown, true, "Pause shows while a mission runs");
    assert.equal(r.resumeHidden, true, "Resume stays hidden while running");
    assert.equal(r.stopShown, true, "Stop is there");
    assert.equal(r.hintHidden, true, "no hint while the panel is here");
    // Pause reaches the app's own button
    const clicked = await t.page.evaluate(() => {
      const orig = document.getElementById("ops-pause");
      let n = 0;
      orig.addEventListener("click", () => { n += 1; }, { once: true });
      document.getElementById("mac-lo-pause").click();
      return new Promise((res) => setTimeout(() => res(n), 300));
    });
    assert.equal(clicked, 1, "the Mac Pause button presses the app's Pause");
    // Escape closes the screen and gives the panel back to the page
    await t.page.keyboard.press("Escape");
    await t.page.waitForFunction(() => {
      const screen = document.getElementById("mac-lo");
      const p = document.getElementById("ops-panel");
      return !!screen && screen.hidden && !!p && !screen.contains(p) && p.isConnected;
    }, null, { timeout: WAIT });
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});
