// Free first (0.4.18): light jobs go to free routes first, hard jobs stay paid, a bad free answer falls back
// to paid, a route at its daily limit or switched off is skipped, the graphics card table, and the install
// buttons (never without consent, never a shell string). In-process, no network, no real key, no real AI app:
// the Gemini route runs a fake program (test/fixtures/fake-sub-cli.mjs) through node.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-freefirst-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_HOME = tmpDir("cc-freefirst-home-");
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_EXEC = process.execPath;
process.env.CC_OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.CC_FREE_FIRST;
const FAKE = path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs");

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const FF = await import("../server/free-first.js");
const GPU = await import("../server/gpu.js");
const INS = await import("../server/free-install.js");
const PANEL = await import("../web/free-panel.js");
const BP = await import("../web/backup-panel.js");

const ready = (extra = {}) => async (id) => ({ id, status: "ready", ...(id === "gemini-cli" ? { path: FAKE } : {}), ...(id === "ollama" ? { models: ["llama3.1:8b"] } : {}), ...extra });
const reset = () => { store.putDoc(FF.SETTINGS, {}); store.putDoc(FF.USAGE, {}); };

test("light jobs are free first, hard jobs stay on the paid route, and the mode decides", () => {
  assert.equal(FF.jobKind("Summarize this article in five bullet points", {}).light, true);
  assert.equal(FF.jobKind("Rewrite this email so it sounds friendlier", {}).type, "rewrite");
  assert.equal(FF.jobKind("Draft a short post about our new bakery", {}).light, true);
  assert.equal(FF.jobKind("Implement and debug the payment module", { capability: "code", difficulty: 2 }).light, false);
  assert.equal(FF.jobKind("Write a function to sort these", { capability: "code", difficulty: 2 }).light, false);
  assert.equal(FF.jobKind("Give me the final answer for the board", {}).light, false);
  assert.equal(FF.jobKind("Summarize this", {}, { role: "judge" }).light, false, "council judging stays paid");
  reset();
  assert.equal(FF.modeUsesFree("balanced"), true);
  assert.equal(FF.modeUsesFree("savings"), true);
  assert.equal(FF.modeUsesFree("quality"), false);
  FF.saveFreeSettings({ qualityToo: true });
  assert.equal(FF.modeUsesFree("quality"), true);
});

test("the quick check rejects empty, error, refusal, too short and off-topic answers", () => {
  const q = "Summarize the history of sourdough bread baking in Europe";
  assert.equal(FF.passesCheck("", q).ok, false);
  assert.equal(FF.passesCheck("Error: model overloaded", q).why, "error");
  assert.equal(FF.passesCheck("I'm sorry, but I can't help with that request.", q).why, "refusal");
  assert.equal(FF.passesCheck("Ok.", q).why, "too short");
  assert.equal(FF.passesCheck("Cats are wonderful pets that enjoy naps in warm sunny spots all day.", q).why, "off topic");
  assert.equal(FF.passesCheck("Sourdough bread spread across Europe over centuries; bakers kept starters alive in every town.", q).ok, true);
});

test("the first ready route answers through the real app runner with a fake Gemini program (no shell)", async () => {
  reset();
  FF.saveFreeSettings({ routes: { "openrouter-free": false } });
  const steps = [];
  const r = await FF.tryFree({ prompt: "Summarize: the fake app answers this line", deps: { state: ready() }, onStep: (s) => steps.push(FF.stepLine(s)) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.route, "gemini-cli");
  assert.match(r.text, /Answer from the fake app/);
  assert.equal(steps[0], "Answering through Gemini on this computer, free route 1 of 3");
});

test("a free answer that fails the check moves on, and when every route fails the job goes to the paid route", async () => {
  reset();
  const asked = [];
  const deps = {
    state: ready(),
    complete: async ({ model }) => { asked.push(`or:${model}`); return { text: "", usage: {} }; },
    askApp: async (route) => { asked.push(route.id); return { ok: true, text: "I'm sorry, but I can't help with that." }; },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ message: { content: "" } }) }),
  };
  const r = await FF.tryFree({ prompt: "Summarize the meeting notes about the spring sale", deps });
  assert.equal(r.ok, false);
  assert.deepEqual(r.tried.map((t) => t.id), ["openrouter-free", "gemini-cli", "antigravity", "ollama"]);
  assert.ok(asked.includes("gemini-cli") && asked.some((a) => a.startsWith("or:")));
});

test("a route at its daily limit, rate limited, or switched off is skipped; the main switch turns it all off", async () => {
  reset();
  FF.saveFreeSettings({ limits: { "openrouter-free": 1 }, routes: { antigravity: false } });
  FF.noteFreeJob("openrouter-free", 0.01);
  FF.noteRate("gemini-cli");
  const tried = [];
  const deps = { state: ready(), complete: async () => { tried.push("or"); return { text: "x" }; }, askApp: async (r) => { tried.push(r.id); return { ok: false }; }, fetch: async () => { tried.push("ollama"); return { ok: true, json: async () => ({ message: { content: "The spring sale notes say prices drop ten percent on Friday." } }) }; } };
  const r = await FF.tryFree({ prompt: "Summarize the spring sale notes", deps });
  assert.equal(r.ok, true);
  assert.equal(r.route, "ollama");
  assert.deepEqual(tried, ["ollama"], "openrouter at its limit, gemini rate limited, antigravity off");
  assert.equal(r.tried.find((t) => t.id === "openrouter-free").why, "limit");
  assert.equal(FF.usage().jobs, 1);
  assert.match(FF.todayLine(), /^Free AI used today: 1 job, about \$0\.01 saved$/);
  FF.saveFreeSettings({ on: false });
  assert.equal((await FF.tryFree({ prompt: "Summarize it", deps })).off, true);
});

test("graphics card detection reads nvidia-smi and Windows output, and the table picks a model that fits", () => {
  const smi = fs.readFileSync(path.join(ROOT, "test", "fixtures", "nvidia-smi.txt"), "utf8");
  const g = GPU.parseNvidiaSmi(smi);
  assert.deepEqual(g.map((x) => x.vramGb), [12, 24]);
  const cim = GPU.parseCim(JSON.stringify([{ Name: "Intel(R) Arc(TM) Graphics", AdapterRAM: 2147483648 }, { Name: "NVIDIA GeForce RTX 3060", AdapterRAM: 4293918720 }]));
  assert.equal(cim.length, 1);
  assert.equal(cim[0].atLeast, true);
  assert.equal(GPU.parseCim("not json").length, 0);
  const r12 = GPU.recommend({ found: true, vramGb: 12 });
  assert.equal(r12.tier, "12 GB");
  assert.equal(GPU.recommend({ found: true, vramGb: 12 }, { developer: true }).pickKind, "coding");
  assert.equal(GPU.recommend({ found: true, vramGb: 24 }).tier, "24 GB or more");
  assert.equal(GPU.recommend({ found: true, vramGb: 4 }), null, "no offer on a small card");
  assert.equal(GPU.recommend({ found: false }), null, "no offer with no NVIDIA card");
  assert.equal(GPU.recommend({ found: true, ...cim[0] }).unsure, true);
  assert.equal(PANEL.localHtml({ gpu: { found: false }, local: null }), "");
});

test("install buttons never run without consent and never use a shell string", async () => {
  const calls = [];
  const spawnImpl = (file, args, opts) => { calls.push({ file, args, opts }); const ee = new (require_events())(); setTimeout(() => ee.emit("exit", 0), 10); ee.stdout = null; ee.stderr = null; return ee; };
  const whichImpl = async (b) => (/npm/.test(b) ? path.join(DIR, "npm") : /winget/.test(b) ? path.join(DIR, "winget.exe") : "");
  const no = await INS.runInstall("gemini-cli", { spawnImpl, whichImpl });
  assert.equal(no.code, "consent");
  assert.equal(calls.length, 0);
  const yes = await INS.runInstall("gemini-cli", { consent: true, spawnImpl, whichImpl, platform: "linux" });
  assert.equal(yes.ok, true);
  assert.equal(calls[0].opts.shell, false);
  assert.deepEqual(calls[0].args, ["install", "-g", "@google/gemini-cli"]);
  const ol = await INS.commandFor("ollama", { platform: "win32", whichImpl });
  assert.deepEqual(ol.args.slice(0, 6), ["install", "--id", "Ollama.Ollama", "-e", "--source", "winget"]);
  const noNpm = await INS.runInstall("gemini-cli", { consent: true, spawnImpl, whichImpl: async () => "" });
  assert.equal(noNpm.code, "link");
  assert.match(noNpm.link, /^https:\/\/nodejs\.org/);
  assert.equal((await INS.runInstall("ollama-model", { consent: true, model: "evil; rm -rf /", spawnImpl, whichImpl })).code, "error");
  assert.equal(calls.length, 1, "only the consented install ran");
});

test("wording follows the mode: plain words in Simple, technical names in Expert", () => {
  const row = { id: "gemini-cli", name: "Gemini CLI", plain: "The Gemini app on this computer", ai: "Gemini", status: "missing", label: "Not installed", canSetPath: true };
  const simple = BP.panelHtml({ routes: [row] }, { mode: "simple" });
  const expert = BP.panelHtml({ routes: [row] }, { mode: "expert" });
  assert.match(simple, /The Gemini app on this computer/);
  assert.doesNotMatch(simple, /\bCLI\b|\bMCP\b|stdin/);
  assert.match(expert, /Gemini CLI/);
  assert.match(expert, /title="The Gemini app on this computer"/);
  assert.match(simple, /data-aw-path="gemini-cli"/, "a custom program location can be set");
  const ff = PANEL.panelHtml({ routes: [{ id: "gemini-cli", status: "signin", label: "Sign in needed", on: true, perDay: 1000 }] }, { mode: "simple" });
  assert.doesNotMatch(ff, /\bCLI\b|\bMCP\b|stdin/);
  assert.match(PANEL.panelHtml({ routes: [{ id: "gemini-cli", status: "ready", label: "Ready", on: true, perDay: 1 }] }, { mode: "expert" }), /Gemini CLI/);
});

test("a custom program path must be a real file named after the app", async () => {
  const SR = await import("../server/sub-routes.js");
  const r = SR.routeById("gemini-cli");
  assert.match(SR.checkCustomPath(r, "gemini"), /full location/);
  assert.match(SR.checkCustomPath(r, path.join(DIR, "nope.cmd")), /No program/);
  const bad = path.join(DIR, "other.cmd"); fs.writeFileSync(bad, "");
  assert.match(SR.checkCustomPath(r, bad, { platform: "win32" }), /not Gemini CLI/);
  const good = path.join(DIR, "gemini.cmd"); fs.writeFileSync(good, "");
  assert.equal(SR.checkCustomPath(r, good, { platform: "win32" }), "");
  SR.saveRouteSettings({ paths: { "gemini-cli": good } });
  assert.equal(SR.routeSettings().paths["gemini-cli"], good);
  assert.equal(await SR.findBin(r, { env: { CC_SUBCLI_NO_PATH: "1" } }), good);
});

import { createRequire } from "node:module";
function require_events() { return createRequire(import.meta.url)("node:events"); }
