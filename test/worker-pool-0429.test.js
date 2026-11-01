// 0.4.29: "Your AI helpers", the in-app AI worker pool (docs/flow/PLAN.md section 7).
// 1. Registry defaults and detection with fakes.
// 2. The picker skips resting and switched-off helpers and prefers free ones on Max savings.
// 3. A limit message rests a helper until the time it gave; every rest event (plan-first, Antigravity, smart
//    fallback) lands in the same list.
// 4. GET /api/workers lists, POST /api/workers/:id toggles, and a step re-assigned after a limit keeps
//    "Try 1 (Claude Code: out of usage)" (a real server, a fake Claude Code script, one loopback mock).
// 5. A real headless Chrome check of the panel and of the helper names in the Live view.
// No real CLI worker is ever run (the "Claude Code" here is test/fixtures-style fake script), no real key, no
// network, no data/ folder. Windows rules: real waits, every server and browser is closed, one at a time.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT, startMockOpenAI, startServer, waitBudget } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";

const DIR = tmpDir("cc-wp0429-");
const HOME = tmpDir("cc-wp0429-home-");
Object.assign(process.env, { CC_DATA_DIR: DIR, CC_SUBCLI_HOME: HOME, CC_SUBCLI_NO_PATH: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off" });
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "PERPLEXITY_API_KEY"]) process.env[k] = "";
delete process.env.CC_DEV_OWNER;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const WP = await import("../server/worker-pool.js");
const SR = await import("../server/sub-routes.js");
const PF = await import("../server/plan-first.js");
const AGY = await import("../server/antigravity-cli.js");
const FB = await import("../server/fallback.js");
const { PROVIDERS } = await import("../server/registry.js");

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const LIMIT_LINE = "You've hit your session limit · resets 2:30pm (America/Los_Angeles)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKES = {
  apps: () => [{ id: "claude-code", status: "ready" }, { id: "codex", status: "signin" }, { id: "gemini-cli", status: "missing" }, { id: "antigravity", status: "ready" }],
  opencode: () => ({ installed: false }),
  freebuff: () => ({ installed: true, signedIn: true }),
  grokbot: () => ({ installed: true, signedIn: false, needs: "not set up" }),
  browser: () => ({ installed: true, signedIn: true }),
};
const reset = () => {
  const s = store.doc("settings", () => ({})) || {};
  store.putDoc("settings", { ...s, workerPool: { workers: {} } });
  store.putDoc(WP.ROUTE_DOC, { routes: {}, website: false });
};

// ---------- 1. registry and detection ----------
test("registry defaults: the prototype's field shapes, the apps Chris uses, and the official-app switch is shared", () => {
  reset();
  const ids = WP.DEFAULT_WORKERS.map((w) => w.id);
  for (const id of ["claude-code", "antigravity", "gemini-cli", "codex", "opencode", "freebuff", "grokbot", "browser-helper"]) assert.ok(ids.includes(id), id);
  for (const w of WP.DEFAULT_WORKERS) {
    assert.ok(WP.KINDS.includes(w.kind), `${w.id} kind`);
    assert.equal(typeof w.free, "boolean", `${w.id} free`);
    assert.ok(w.cooldownHours > 0, `${w.id} cooldownHours`);
    assert.ok(w.label && w.good && w.needs, `${w.id} label, good for, needs`);
  }
  assert.equal(WP.workerSpec("antigravity").free, true);
  assert.equal(WP.workerSpec("claude-code").free, false, "Claude Code uses a paid plan");
  assert.equal(WP.ROUTE_DOC, SR.SETTINGS, "the same switch as the subscription backup");
  assert.equal(WP.workerIdFor("plan-claude-code"), "claude-code");
  assert.equal(WP.workerIdFor("antigravity"), "antigravity");
  assert.equal(WP.workerIdFor("anthropic"), "api:anthropic");
  assert.equal(WP.workerIdFor("meldmind"), "");
  // nothing stored yet: everything is on and nothing rests
  for (const id of ids) { assert.equal(WP.isEnabled(id), true, id); assert.equal(WP.restingUntil(id), 0, id); }
});

test("detection with fakes: ready, needs sign-in, not installed, and API AIs with a key", async () => {
  reset();
  const v = await WP.workersView({ detectors: FAKES, apiSource: () => [{ id: "groq", name: "Groq", keyed: true }, { id: "anthropic", name: "Claude", keyed: true }] });
  const by = Object.fromEntries(v.workers.map((w) => [w.id, w]));
  assert.equal(v.title, "Your AI helpers");
  assert.equal(by["claude-code"].status, "ready");
  assert.equal(by["claude-code"].light, "green");
  assert.equal(by.codex.status, "signin");
  assert.equal(by.codex.statusLabel, "Needs sign-in");
  assert.ok(by.codex.needs, "says what it needs");
  assert.equal(by["gemini-cli"].status, "missing");
  assert.equal(by["gemini-cli"].light, "grey");
  assert.equal(by.opencode.status, "missing");
  assert.equal(by.grokbot.status, "signin");
  assert.equal(by["api:groq"].kind, "api");
  assert.equal(by["api:groq"].free, true, "Groq has a free allowance");
  assert.equal(by["api:anthropic"].free, false);
  assert.equal(by["api:anthropic"].status, "ready");
  // apps first, then helpers, then API AIs
  const kinds = v.workers.map((w) => w.kind);
  assert.ok(kinds.lastIndexOf("cli") < kinds.indexOf("agent") && kinds.lastIndexOf("agent") < kinds.indexOf("api"), kinds.join(","));
  // a detector that throws reads as not installed, never as a crash
  const bad = await WP.detectAll({ detectors: { ...FAKES, opencode: () => { throw new Error("boom"); } } });
  assert.equal(bad.opencode.installed, false);
  // the real detectors (no program on PATH in tests) give a full list too
  const real = await WP.workersView({ apiSource: () => [] });
  assert.ok(real.workers.length >= WP.DEFAULT_WORKERS.length);
  for (const w of real.workers) assert.ok(["ready", "resting", "signin", "off", "missing"].includes(w.status), `${w.id} ${w.status}`);
});

// ---------- 2. the picker ----------
test("the picker skips resting and switched-off helpers and prefers free ones on Max savings", async () => {
  reset();
  const view = async () => (await WP.workersView({ detectors: { ...FAKES, apps: () => [{ id: "claude-code", status: "ready" }, { id: "codex", status: "ready" }, { id: "gemini-cli", status: "ready" }, { id: "antigravity", status: "ready" }] }, apiSource: () => [] })).workers;
  let rows = await view();
  assert.equal(WP.pickWorker(rows, { kinds: ["cli"] }).id, "claude-code", "in order on Balanced");
  assert.equal(WP.pickWorker(rows, { kinds: ["cli"], mode: "savings" }).id, "antigravity", "free first on Max savings");
  assert.equal(WP.pickWorker(rows, { kinds: ["cli"], mode: "economy" }).id, "antigravity", "economy is the old name");
  WP.noteRest("claude-code", { until: Date.now() + 3600e3 });
  WP.setEnabled("antigravity", false);
  rows = await view();
  assert.equal(rows.find((w) => w.id === "claude-code").status, "resting");
  assert.equal(rows.find((w) => w.id === "antigravity").status, "off");
  assert.equal(WP.pickWorker(rows, { kinds: ["cli"] }).id, "gemini-cli", "resting and off are skipped");
  assert.equal(WP.pickWorker(rows, { kinds: ["cli"], exclude: ["gemini-cli"] }).id, "codex");
  assert.equal(SR.routeSettings().routes.antigravity, false, "the off switch is the official-app switch");

  // the router's ranked list for a mission step goes through the same rules
  const ranked = [{ provider: "plan-claude-code" }, { provider: "xai" }, { provider: "plan-codex" }, { provider: "antigravity" }, { provider: "plan-gemini-cli" }, { provider: "anthropic" }];
  assert.deepEqual(WP.poolRank(ranked).map((m) => m.provider), ["xai", "plan-codex", "plan-gemini-cli", "anthropic"], "resting and off apps are left out, API order kept");
  WP.clearRest("claude-code");
  WP.setEnabled("antigravity", true);
  assert.deepEqual(WP.poolRank(ranked, { mode: "savings" }).map((m) => m.provider), ["plan-codex", "xai", "antigravity", "plan-gemini-cli", "plan-claude-code", "anthropic"], "on Max savings free apps take the app places first; API rows stay put");
  assert.deepEqual(WP.poolRank(ranked).map((m) => m.provider), ranked.map((m) => m.provider), "Balanced: unchanged");
  // never strands a run: if every row is out, the router's own list is used
  WP.setEnabled("claude-code", false);
  assert.deepEqual(WP.poolRank([{ provider: "plan-claude-code" }]).map((m) => m.provider), ["plan-claude-code"]);
  WP.setEnabled("claude-code", true);
  // an API AI the person switched off here is left out of steps while another can take them
  WP.setEnabled("api:xai", false);
  assert.equal(WP.poolRank(ranked).some((m) => m.provider === "xai"), false);
  WP.setEnabled("api:xai", true);
});

// ---------- 3. limits and rest events ----------
test("a limit message rests a helper until the time it gave, else for its cooldown, and an answer clears it", () => {
  reset();
  const now = Date.UTC(2026, 9, 30, 20, 18, 0); // 1:18 PM in Los Angeles
  const r = WP.noteLimit("claude-code", LIMIT_LINE, now);
  assert.ok(r, "read as a limit");
  assert.equal(r.until - now, 72 * 60 * 1000, "until 2:30 PM Los Angeles time");
  assert.equal(WP.restingUntil("claude-code", now), now + 72 * 60 * 1000);
  assert.equal(WP.workerUsable("claude-code", now), false);
  assert.equal(WP.workerUsable("claude-code", now + 73 * 60 * 1000), true, "back after the reset time");
  assert.match(WP.poolState().workers["claude-code"].lastError, /session limit/);
  assert.equal(WP.noteLimit("codex", "All tests passed.", now), null, "an ordinary answer is not a limit");
  const g = WP.noteLimit("gemini-cli", "Quota exceeded for this project.", now);
  assert.equal(g.until - now, 22 * 3600e3, "no time given: the helper's own cooldown (22 hours for Gemini CLI)");
  assert.equal(WP.clearRest("gemini-cli"), true);
  assert.equal(WP.restingUntil("gemini-cli", now), 0);
  // the row says when it is back
  const row = WP.listWorkers({ detected: { "claude-code": { installed: true, signedIn: true } }, now }).find((w) => w.id === "claude-code");
  assert.equal(row.status, "resting");
  assert.equal(row.light, "amber");
  assert.match(row.statusLabel, /^Resting, back at \d{1,2}:\d{2} (AM|PM)$/);
});

test("every rest event lands in the list: plan-first, Antigravity and smart fallback (decision 16 still benches the API AI)", () => {
  reset();
  const until = Date.now() + 2 * 3600e3;
  PF.noteOutOfQuota("codex", Date.now(), until);
  assert.ok(Math.abs(WP.restingUntil("codex") - until) < 1000, "plan-first rest mirrored");
  PF.noteAnswer("codex");
  assert.equal(WP.restingUntil("codex"), 0, "an answer clears it");
  const back = AGY.noteAgyLimit(until);
  assert.ok(Math.abs(WP.restingUntil("antigravity") - back) < 1000, "Antigravity rest mirrored");
  assert.ok(PROVIDERS.groq, "groq is in the registry");
  FB.markTrouble("groq", "rate", "429 Too Many Requests", { quiet: true });
  assert.ok(FB.trouble("groq"), "smart fallback benches it as before");
  assert.ok(WP.restingUntil("api:groq") > Date.now(), "and the helper list shows it resting");
  FB.clearTrouble("groq", "test");
  assert.equal(WP.restingUntil("api:groq"), 0);
  // a switched-off or resting app on this PC leaves the router (plan-first and Antigravity rows)
  const src = read("server", "plan-first.js");
  assert.match(src, /if \(!workerUsable\(r\.id\)\) continue;/);
  assert.match(read("server", "antigravity-cli.js"), /if \(!workerUsable\("antigravity"\)\) return \[\];/);
  assert.match(read("server", "agents.js"), /workerUsable\(GB\.AGENT_ID\)/);
  WP.clearRest("antigravity");
});

test("a step's helper and its earlier tries read in plain words", () => {
  assert.equal(WP.tryLine(1, { provider: "plan-claude-code", kind: "limit", reason: "Claude Code is out of its own plan's quota" }), "Try 1 (Claude Code: out of usage)");
  assert.equal(WP.tryLine(2, { provider: "xai", kind: "error", reason: "502 provider error" }, PROVIDERS), `Try 2 (${PROVIDERS.xai.name} (API): 502 provider error)`);
  assert.deepEqual(WP.helperFor({ provider: "plan-gemini-cli" }), { id: "gemini-cli", label: "Gemini CLI" });
  assert.deepEqual(WP.helperFor({ provider: "meldmind", save: true }), { id: "meldmind", label: "Meldmind" });
  assert.deepEqual(WP.helperFor({ app: true, appId: "freebuff", model: "Freebuff" }), { id: "freebuff", label: "Freebuff" });
  const src = read("server", "mission.js");
  assert.match(src, /const openRank = \(opts\) => poolRank\(/, "mission steps are picked through the helper list");
  assert.match(src, /helper: helperFor\(t, PROVIDERS\), tries:/, "each step carries its helper and its tries");
  assert.match(src, /kind: isLimitError\(lastErr\) \? "limit" : "error"/, "a re-assigned step keeps the try that did not finish");
  assert.match(src, /kind: ev\.kind === "credits" \|\| ev\.kind === "rate" \? "limit" : "error"/, "a stand-in keeps the try it replaced");
});

test("no em-dashes in the new user-facing words", () => {
  for (const f of [["server", "worker-pool.js"], ["server", "plugins", "workers.js"], ["web", "features", "workers.js"]]) assert.equal(read(...f).includes("—"), false, f.join("/"));
});

// ---------- 4. the real server: /api/workers, and a re-assigned step keeps its first try ----------
// A fake "Claude Code" (a small node script, never the real app): it draws up the plan, then says its session
// limit when asked to do the step. A loopback mock stands in for a paid API AI.
function fakeClaude(dir) {
  const file = path.join(dir, "fake-claude.mjs");
  const plan = JSON.stringify({ title: "Bake sale", tasks: [{ id: "t1", title: "Write the bake sale flyer", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write a short flyer for a Saturday bake sale.", deliverable: "A short flyer" }], assembly: "Hand over the flyer." });
  fs.writeFileSync(file, `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  if (/You are a specialist/.test(input)) { process.stdout.write(${JSON.stringify(LIMIT_LINE)} + "\\n"); process.exit(1); }
  if (/Break the goal into/.test(input)) { process.stdout.write(${JSON.stringify(plan)}); process.exit(0); }
  if (/Reply with JSON only/.test(input)) { process.stdout.write('{"capability":"writing","difficulty":1,"needWeb":false,"summary":"flyer"}'); process.exit(0); }
  process.stdout.write("Bake sale on Saturday. Fresh bread and cakes.\\n"); process.exit(0);
});
`);
  return file;
}

test("GET /api/workers lists, POST toggles, and a step re-assigned after a limit keeps Try 1 (Claude Code: out of usage)", { timeout: 300000 }, async () => {
  const mock = await startMockOpenAI({ inTok: 10, outTok: 10 });
  const home = tmpDir("cc-wp0429-srvhome-");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
  const bin = fakeClaude(tmpDir("cc-wp0429-bin-"));
  let s;
  try {
    s = await startServer({ env: {
      CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_SUBCLI_HOME: home, CC_SUBCLI_EXEC: process.execPath, CC_CLAUDE_BIN: bin,
      CC_BASE_URL_XAI: `${mock.base}/xai/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "",
    } });
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } })).json.status.status, "green");
    await s.api("/settings", { method: "POST", body: { planFirst: true } });

    // list
    let r = await s.api("/workers?refresh=1");
    assert.equal(r.status, 200, r.text);
    let by = Object.fromEntries(r.json.workers.map((w) => [w.id, w]));
    assert.equal(by["claude-code"].status, "ready", JSON.stringify(by["claude-code"]));
    assert.equal(by.codex.status, "missing", "nothing else is found on the test PC");
    assert.equal(by["api:xai"].status, "ready");
    // toggle off and on
    r = await s.api("/workers/codex", { method: "POST", body: { enabled: false } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.worker.enabled, false);
    assert.equal(r.json.worker.status, "off");
    r = await s.api("/workers/codex", { method: "POST", body: { enabled: true } });
    assert.equal(r.json.worker.enabled, true);
    assert.equal((await s.api("/workers/nobody", { method: "POST", body: { enabled: false } })).status, 404);
    assert.equal((await s.api("/workers/codex", { method: "POST", body: { enabled: "yes" } })).status, 400);
    // a full settings save from the page never wipes the helper list
    await s.api("/workers/freebuff", { method: "POST", body: { enabled: false } });
    await s.api("/settings", { method: "POST", body: { workerPool: { workers: {} }, planFirst: true } });
    assert.equal(Object.fromEntries((await s.api("/workers")).json.workers.map((w) => [w.id, w])).freebuff.enabled, false);
    await s.api("/workers/freebuff", { method: "POST", body: { enabled: true } });

    // a mission: Claude Code plans, then hits its session limit on the step; the paid mock finishes it
    const posted = await s.api("/mission", { method: "POST", body: { goal: "Write a short flyer for our Saturday bake sale.", mode: "balanced", qa: false, budgetUsd: 2 } });
    assert.equal(posted.status, 202, posted.text);
    let m = null;
    const t0 = Date.now();
    while (Date.now() - t0 < waitBudget(120000)) {
      const done = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && ["done", "done-with-errors", "failed"].includes(x.status));
      if (done) { m = (await s.api(`/missions/${done.id}`)).json; break; }
      await sleep(300);
    }
    assert.ok(m, "the mission finished\n" + s.log.slice(-800));
    const step = (m.tasks || []).find((t) => (t.tries || []).length);
    assert.ok(step, `a step was re-assigned and kept its try: ${JSON.stringify((m.tasks || []).map((t) => ({ p: t.provider, a: t.attempts, h: t.helper })))}\n${(m.log || []).map((l) => l.text || l).join("\n").slice(-1500)}`);
    assert.equal(step.tries[0].line, "Try 1 (Claude Code: out of usage)");
    assert.equal(step.tries[0].kind, "limit");
    assert.ok(step.helper?.label, "the step names its helper");
    assert.notEqual(step.helper.id, "claude-code", "another helper has the step now");
    // Claude Code rests until the time it gave, and the list says so
    by = Object.fromEntries((await s.api("/workers")).json.workers.map((w) => [w.id, w]));
    assert.equal(by["claude-code"].status, "resting", JSON.stringify(by["claude-code"]));
    assert.match(by["claude-code"].statusLabel, /^Resting, back at /);
    assert.ok(by["claude-code"].restingUntil > Date.now());
    // the Live view's run lists each step with its helper
    const lv = (await s.api("/liveview")).json;
    const run = (lv.runs || []).find((x) => x.id === m.id);
    assert.ok(run, "the run is on the Live view");
    const ls = (run.steps || []).find((x) => x.id === step.id);
    assert.equal(ls?.helper, step.helper.label, JSON.stringify(run.steps));
    assert.equal(ls.tries, 1, "and how many earlier tries it took");
  } finally {
    try { await s?.stop(); } catch {}
    await mock.close();
  }
});

// ---------- 5. headless Chrome: the panel, and the helper names in the Live view ----------
const skipBrowser = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts";

test("the Your AI helpers panel in Expert Settings: lights, plain states, a working switch; the Live view names each step's helper", { skip: skipBrowser, timeout: 300000 }, async () => {
  const t = await bootPage({ mac: "default", hidePopups: false, theme: "dark", width: 1366, height: 860, env: { CC_DEV_OWNER: "1" } });
  if (!t) return;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    // a resting helper so the amber light and "back at" show
    await t.api("/workers/codex", { body: { enabled: false } });
    await t.page.evaluate(() => { localStorage.setItem("cc.mac", "1"); });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForTimeout(1200);
    if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "expert", "body[data-ui] is expert (LESSONS 2026-10-30)");
    await t.page.evaluate(() => window.CC.go("settings"));
    await t.page.waitForSelector("#cc-helpers [data-helper]", { timeout: WAIT });
    const rows = await t.page.evaluate(() => [...document.querySelectorAll("#cc-helpers [data-helper]")].map((r) => ({
      id: r.dataset.helper, status: r.dataset.status, light: [...r.querySelector(".dot").classList].find((c) => c !== "dot"),
      state: r.querySelector("[data-helper-state]").textContent.trim(), on: r.querySelector("[data-helper-switch]").checked, text: r.textContent,
    })));
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of ["claude-code", "antigravity", "gemini-cli", "codex", "opencode"]) assert.ok(by[id], `${id} is listed`);
    assert.equal(by.codex.status, "off");
    assert.equal(by.codex.light, "grey");
    assert.equal(by.codex.on, false);
    assert.equal(by["claude-code"].light, "grey", "not installed on the test PC: grey");
    assert.equal(by["claude-code"].state, "Not installed");
    assert.match(by.antigravity.text, /Good for: /);
    for (const r of rows) assert.equal(r.text.includes("—"), false, `no em-dash in ${r.id}`);
    // the panel is on screen and takes the click on its switch (hit test, then a real click)
    await t.page.evaluate(() => document.querySelector('[data-helper-switch="codex"]').scrollIntoView({ block: "center" }));
    await t.page.waitForTimeout(400);
    const hit = await t.page.evaluate(() => { const el = document.querySelector('[data-helper-switch="codex"]'); const v = document.getElementById("view"); const vb = v.getBoundingClientRect(); const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { inside: b.top >= 0 && b.bottom <= innerHeight && b.width > 0 && b.left >= vb.left && b.right <= vb.right, scrolledSideways: v.scrollLeft, top: h === el || el.contains(h) || h === el.closest("label") }; });
    assert.ok(hit.inside && hit.top && hit.scrolledSideways === 0, `the codex switch is on screen inside the page with no sideways scroll, and on top: ${JSON.stringify(hit)}`);
    if (process.env.CC_SHOTS) { fs.mkdirSync(process.env.CC_SHOTS, { recursive: true }); await t.page.screenshot({ path: path.join(process.env.CC_SHOTS, "helpers-panel.png") }); }
    await t.page.click('[data-helper-switch="codex"]');
    await t.page.waitForFunction(() => document.querySelector('[data-helper="codex"]')?.dataset.status !== "off", null, { timeout: WAIT });
    const after = (await t.api("/workers")).json.workers.find((w) => w.id === "codex");
    assert.equal(after.enabled, true, "the click turned it on in the app");

    // Live view: a practice mission, then each step names its helper
    const posted = await t.api("/mission", { body: { goal: "Plan a bake sale for Saturday with a flyer and a price list", mode: "balanced", qa: false, budgetUsd: 1 } });
    assert.equal(posted.status, 202, posted.text);
    const t0 = Date.now();
    let done = null;
    while (Date.now() - t0 < waitBudget(90000)) {
      done = ((await t.api("/state")).json.missions || []).find((x) => x.kind === "mission" && ["done", "done-with-errors", "failed"].includes(x.status));
      if (done) break;
      await sleep(400);
    }
    assert.ok(done, "the practice mission finished");
    await t.page.evaluate(() => window.CC.go("liveview"));
    await t.page.waitForSelector(".lv-picks [data-proj]", { timeout: WAIT });
    await t.page.click('.lv-picks [data-proj="*"]'); // All runs (the practice mission is not filed under a project)
    await t.page.waitForSelector(".lv-helpers .lv-helper", { timeout: WAIT });
    const helpers = await t.page.evaluate(() => [...document.querySelectorAll(".lv-helpers li")].map((li) => ({ step: li.querySelector("span").textContent.trim(), helper: li.querySelector(".lv-helper").textContent.trim() })));
    assert.ok(helpers.length >= 1, "steps are listed");
    for (const h of helpers) assert.ok(h.step && h.helper, JSON.stringify(h));
    if (process.env.CC_SHOTS) await t.page.locator(".lv-helpers").first().screenshot({ path: path.join(process.env.CC_SHOTS, "live-helpers.png") });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(HOME, { recursive: true, force: true }); } catch {} });
