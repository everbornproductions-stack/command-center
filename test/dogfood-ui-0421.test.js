// 0.4.21 dogfood fixes, the page side and the small modules: the result card, Esc on dialogs, Live ops that does not go
// stale, the accessibility switch, code that is attached to a code task, and the wiring (read from source).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT, tmpDir } from "./helpers.js";
import * as RC from "../web/result-card.js";
import * as LO from "../web/live-ops.js";
import * as OV from "../web/overlay.js";
import * as CS from "../server/code-source.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const require = createRequire(import.meta.url);

// ---------- the result card ----------
const FILE_OK = { ok: true, name: "index.html", path: "C:\\Users\\chris\\data\\projects\\p\\media\\index.html", previewable: true, ext: "html" };
const MISSION = {
  id: "m-1", status: "done-with-errors",
  banner: { kind: "dry-run", kinds: ["image"], text: "No real image was made. What you see is a placeholder, nothing was generated and nothing was spent. Image needs an image AI key." },
  incomplete: { reasons: [{ taskId: "t2", title: "Check the page", kind: "refusal", reason: "The AI refused. [Claude declined this request (safety refusal).]" }, { taskId: "t1", title: "Build the page", kind: "qa-failed", reason: "QA did not pass this step (score 3 of 10)." }], retryAvoid: ["anthropic"] },
  savedFile: FILE_OK,
  tasks: [{ id: "t1", title: "Build the page", review: { pass: false, score: 3, provider: "groq" } }, { id: "t2", title: "Copy", review: { pass: true, score: 9, provider: "groq" } }, { id: "t3", title: "Style", review: { pass: false, unchecked: true, score: null, provider: "groq" } }],
};

test("result card: a placeholder gets a loud banner, an incomplete run says Incomplete with reasons and a retry button", () => {
  const html = RC.cardHtml(MISSION);
  assert.match(html, /role="alert"/);
  assert.match(html, /This is not a real image\./);
  assert.match(html, /<b>Incomplete\.<\/b> Part of this job did not work, so it is not marked Done\./);
  assert.match(html, /<b>Check the page<\/b>: The AI refused\./);
  assert.match(html, /data-rc-retry>Try again on another AI</);
  assert.equal(RC.runLabel(MISSION), "Incomplete");
  assert.equal(RC.runLabel({ status: "done" }), "Done");
  assert.equal(RC.runLabel({ status: "done", banner: {} }), "Placeholder only");
  assert.equal(RC.runLabel({ status: "failed" }), "Failed");
  assert.equal(RC.cardHtml({ status: "done", tasks: [] }), "", "a clean run shows no card");
  assert.doesNotMatch(html, /—/);
});

test("result card: QA scores on the card, a check that could not be done is not shown as passed", () => {
  const html = RC.qaScoresHtml(MISSION);
  assert.match(html, /Build the page<\/span><span class="chip red">did not pass \(3 of 10\)/);
  assert.match(html, /Copy<\/span><span class="chip green">passed \(9 of 10\)/);
  assert.match(html, /Style<\/span><span class="chip red">could not be checked/);
});

test("result card: the saved file shows its path, an Open file button and phone and desktop previews; a failed write says Not saved", () => {
  const ok = RC.fileBoxHtml(MISSION);
  assert.match(ok, /Saved as index\.html/);
  assert.match(ok, /C:\\Users\\chris\\data\\projects\\p\\media\\index\.html/);
  assert.match(ok, /data-rc-open>Open file</);
  assert.match(ok, /data-rc-preview="phone">Phone view/);
  assert.match(ok, /data-rc-preview="desktop">Desktop view/);
  const md = RC.fileBoxHtml({ savedFile: { ...FILE_OK, name: "campaign.md", previewable: false } });
  assert.match(md, /data-rc-preview="text">Preview/);
  assert.doesNotMatch(md, /Phone view/);
  const bad = RC.fileBoxHtml({ savedFile: { ok: false, name: "index.html", error: "Not saved: the result was cut off (A <style> section is never closed.), so index.html was not written." } });
  assert.match(bad, /<b>Not saved\.<\/b> the result was cut off/);
  assert.doesNotMatch(bad, /Saved as/);
  assert.doesNotMatch(bad, /data-rc-open/);
  assert.equal(RC.fileBoxHtml({}), "");
});

test("result card: the page preview is sandboxed at phone or desktop width, text files show as text", () => {
  const phone = RC.previewHtml({ ...FILE_OK, text: "<h1>Hi</h1><script>alert(1)</script>" }, "phone");
  assert.match(phone, /<iframe sandbox=""/);
  assert.match(phone, /width:390px/);
  assert.match(phone, /srcdoc="&lt;h1&gt;Hi&lt;\/h1&gt;&lt;script&gt;/);
  assert.match(RC.previewHtml({ ...FILE_OK, text: "x" }, "desktop"), /width:1100px/);
  const txt = RC.previewHtml({ ok: true, name: "campaign.md", previewable: false, text: "# Plan <b>" }, "text");
  assert.match(txt, /<pre/); assert.match(txt, /# Plan &lt;b&gt;/);
  assert.match(RC.previewHtml({ ok: false, error: "Not saved: nothing to write." }, "phone"), /Not saved/);
});

test("overlay (page): lines wrap to the width and shrink to fit, same layout as the server", () => {
  const measure = (t, px) => t.length * px * 0.55;
  const a = OV.layoutLines(measure, "Your listings deserve a movie.", 100, 900);
  assert.ok(a.lines.length >= 2 && a.lines.join(" ") === "Your listings deserve a movie.");
  assert.ok(a.lines.every((l) => measure(l, a.px) <= 900));
  const b = OV.layoutLines(measure, "word ".repeat(40).trim(), 100, 900, 4);
  assert.ok(b.lines.length <= 4 && b.px < 100);
});

// ---------- Esc ----------
test("Escape closes the dialog even when the focus is somewhere else on the page", async () => {
  const listeners = [];
  globalThis.document = { addEventListener: (t, f) => listeners.push({ t, f }) };
  const { closeOnEscape, openDialogCount } = await import("../web/esc-close.js?esc");
  const a = { isConnected: true }, b = { isConnected: true };
  let closed = [];
  closeOnEscape(a, () => { closed.push("a"); a.isConnected = false; });
  closeOnEscape(b, () => { closed.push("b"); b.isConnected = false; });
  const press = () => listeners.find((l) => l.t === "keydown").f({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  press(); press();
  assert.deepEqual(closed, ["b", "a"], "the newest dialog closes first");
  assert.equal(openDialogCount(), 0);
  listeners.find((l) => l.t === "keydown").f({ key: "a" });
  delete globalThis.document;
  const desk = read("web", "features", "desk.js"), ask = read("web", "ask-dialog.js");
  assert.match(desk, /closeOnEscape\(wrap/);
  assert.equal((ask.match(/closeOnEscape\(wrap/g) || []).length, 2, "both the text box and the yes/no box");
});

// ---------- Live ops that does not go stale ----------
test("Live ops: polls only while a run is going, refreshes at once on focus, and shows a run that ended while covered", async () => {
  assert.ok(LO.isRunning("running") && LO.isRunning("assembling") && !LO.isRunning("done") && !LO.isRunning("failed"));
  const win = new Map(), docL = new Map();
  const W = { addEventListener: (t, f) => win.set(t, f), removeEventListener: (t) => win.delete(t) };
  const D = { hidden: false, addEventListener: (t, f) => docL.set(t, f), removeEventListener: (t) => docL.delete(t) };
  let tickFn = null; const timerObj = { unref() {} };
  let live = { id: "m-9", status: "running" }, fetched = 0, applied = [];
  const server = { id: "m-9", status: "running", cost: 0.0321 };
  const sync = LO.liveSync({ getLive: () => live, fetchRun: async () => { fetched++; return { ...server }; }, apply: (r) => { applied.push(r); live = { ...live, status: r.status }; if (r.status === "done") live.finishStamp = "x"; },
    doc: D, win: W, setIntervalFn: (fn) => { tickFn = fn; return timerObj; }, clearIntervalFn: () => { tickFn = null; }, pollMs: 4000 });
  await tickFn(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(fetched, 1, "a running run is re-read on every tick");
  server.status = "done"; server.cost = 0.31;
  await win.get("focus")(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(applied.at(-1).status, "done"); assert.equal(applied.at(-1).cost, 0.31);
  const n = fetched;
  await tickFn(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(fetched, n, "a finished run is not polled again");
  live = { id: null, status: null };
  assert.equal(await sync.refreshNow("focus"), false, "nothing on screen, nothing to read");
  // the window shown again after being covered
  live = { id: "m-9", status: "running" }; server.status = "running";
  D.hidden = true; docL.get("visibilitychange")(); await new Promise((r) => setTimeout(r, 5));
  const hiddenFetches = fetched;
  D.hidden = false; docL.get("visibilitychange")(); await new Promise((r) => setTimeout(r, 5));
  assert.ok(fetched > hiddenFetches, "visible again refreshes");
  sync.stop();
  assert.equal(win.size, 0); assert.equal(docL.size, 0);
  const app = read("web", "app.js");
  assert.match(app, /liveSync\(\{ getLive: \(\) => S\.live/);
});

// ---------- Electron accessibility ----------
test("Electron turns accessibility on itself, early, so Windows UI Automation can read and drive the window", () => {
  const A = require("../electron/accessibility.cjs");
  const calls = [];
  const app = { commandLine: { appendSwitch: (s) => calls.push(["switch", s]) }, setAccessibilitySupportEnabled: (v) => calls.push(["enabled", v]) };
  assert.equal(A.early(app, {}), true); assert.equal(A.afterReady(app, {}), true);
  assert.deepEqual(calls, [["switch", "force-renderer-accessibility"], ["enabled", true]]);
  assert.equal(A.early(app, { CC_NO_A11Y: "1" }), false); assert.equal(A.afterReady(app, { CC_NO_A11Y: "1" }), false);
  assert.equal(A.afterReady({}, {}), false, "an Electron without the call does not crash");
  const main = read("electron", "main.cjs");
  assert.match(main, /require\("\.\/accessibility\.cjs"\)/);
  assert.match(main, /a11y\.early\(app\)/);
  const ready = main.slice(main.indexOf("app.whenReady().then"), main.indexOf("app.whenReady().then") + 200);
  assert.match(ready, /a11y\.afterReady\(app\)/);
});

// ---------- code that is attached to a code task ----------
test("code task: a named file in the project's folder is attached; named lines are cut out; secrets and unknown names are not", () => {
  const dir = tmpDir("cc-code-src-");
  fs.mkdirSync(path.join(dir, "server")); fs.mkdirSync(path.join(dir, "node_modules")); 
  const body = Array.from({ length: 120 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n");
  fs.writeFileSync(path.join(dir, "server", "fallback.js"), body);
  fs.writeFileSync(path.join(dir, ".env"), "KEY=secret");
  fs.writeFileSync(path.join(dir, "node_modules", "fallback.js"), "// a dependency");
  assert.deepEqual(CS.namedSources("Fix the parser in server/fallback.js and check README.md, see https://example.com/page.html"), ["server/fallback.js", "README.md"]);
  assert.deepEqual(CS.namedLines("look at lines 40 to 60 of fallback.js"), [40, 60]);
  assert.equal(CS.namedLines("no lines here"), null);
  const whole = CS.attachSources("Fix the bug in server/fallback.js", { folders: [dir] });
  assert.equal(whole.length, 1); assert.match(whole[0].text, /const line120 = 120;/);
  const byName = CS.attachSources("Fix the bug in fallback.js", { folders: [dir] });
  assert.equal(byName.length, 1); assert.ok(byName[0].path.includes(path.join("server", "fallback.js")), "found by name inside the project, not in node_modules");
  const cut = CS.attachSources("Fix the bug in fallback.js lines 40 to 50", { folders: [dir] });
  assert.equal(cut[0].from, 20); assert.equal(cut[0].to, 70);
  assert.match(cut[0].text, /^20: const line20 = 20;/); assert.doesNotMatch(cut[0].text, /line100 /);
  assert.deepEqual(CS.attachSources("Read .env please", { folders: [dir] }), [], "a secrets file is never attached");
  assert.deepEqual(CS.attachSources("Fix nothing.js", { folders: [dir] }), []);
  assert.deepEqual(CS.attachSources("Fix fallback.js", { folders: [] }), [], "no known folder, nothing attached");
  const block = CS.sourceBlock(whole, ["missing.js"]);
  assert.match(block, /ATTACHED FILE server\/fallback\.js/);
  assert.match(block, /Do not invent code/);
  assert.match(block, /NOT ATTACHED: missing\.js/);
});

// ---------- wiring ----------
test("wiring: the result card feature is registered, ratings are per step with a whole-result thumb, preflight shows in the send box", () => {
  assert.match(read("web", "perf", "registry.js"), /\{ id: "resultcard", deliverable: true \}/);
  assert.ok(fs.existsSync(path.join(ROOT, "web", "features", "resultcard.js")));
  const rc = read("web", "features", "resultcard.js");
  assert.match(rc, /id: "resultcard"/); assert.match(rc, /\/dogfood\/retry/); assert.match(rc, /\/dogfood\/overlay/); assert.match(rc, /\/dogfood\/file\/open/);
  const r = read("web", "features", "ratings.js");
  assert.match(r, /Is this usable\?/); assert.match(r, /stepId/); assert.match(r, /A step was wrong/);
  assert.match(r, /scope: "result"/);
  const desk = read("web", "features", "desk.js");
  assert.match(desk, /\/dogfood\/preflight/); assert.match(desk, /Heads up\./);
  for (const f of ["web/result-card.js", "web/features/resultcard.js", "web/features/ratings.js", "web/esc-close.js", "web/overlay.js", "server/step-guard.js", "server/media-preflight.js", "server/plugins/dogfood.js"]) assert.doesNotMatch(read(...f.split("/")), /—/, `${f} has no em-dash`);
});
