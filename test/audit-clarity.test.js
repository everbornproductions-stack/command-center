import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chatRows, isInternalPrompt } from "../server/desk.js";
import { plainPaths } from "../server/projects.js";

test("internal planning prompts are not listed as chats", () => {
  assert.equal(isInternalPrompt("WALKTHROUGH_PLAN\nsteps"), true);
  assert.equal(isInternalPrompt("Write a post about tea"), false);
  const rows = chatRows([
    { id: "a", kind: "single", title: "WALKTHROUGH_PLAN", prompt: "WALKTHROUGH_PLAN x", status: "done" },
    { id: "b", kind: "single", title: "Write a post", prompt: "Write a post", status: "done" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["b"]);
});

test("raw file paths become plain words", () => {
  assert.equal(plainPaths("Open C:\\Users\\x\\AppData\\Local\\Temp\\a.txt now"), "Open a file on this computer now");
  assert.equal(plainPaths("See /tmp/abc/def.md please"), "See a file on this computer please");
  assert.equal(plainPaths("Ship it?"), "Ship it?");
});

test("the connect wizard does not reopen after welcome", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../web/app.js", import.meta.url)), "utf8");
  assert.match(src, /!S\.visitedConnect && !S\.settings\?\.onboarded && S\.connectSetup\?\.show/);
});

test("no window.prompt is left in the web app (Electron does not support it)", () => {
  const dir = fileURLToPath(new URL("../web/", import.meta.url)).replace(/[\\/]$/, "");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + "/" + e.name; if (e.isDirectory()) { if (e.name !== "vendor") walk(p); } else if (p.endsWith(".js")) files.push(p); } };
  walk(dir);
  const bad = files.filter((f) => /(?<![\w.])prompt\(\s*["'`]/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

test("the ask dialog resolves with text, null on cancel and null on Escape", async () => {
  const listeners = {};
  const mk = (tag) => {
    const el = { tag, children: [], style: {}, listeners: {}, value: "", attrs: {}, remove() { el.removed = true; }, append(...c) { el.children.push(...c); }, setAttribute(k, v) { el.attrs[k] = v; }, addEventListener(t, f) { el.listeners[t] = f; }, focus() {}, select() {} };
    return el;
  };
  const made = [];
  globalThis.document = { activeElement: null, createElement: (t) => { const e = mk(t); made.push(e); return e; }, body: mk("body") };
  const { askText } = await import("../web/ask-dialog.js");
  let p = askText("Name", "x");
  const form = made.find((e) => e.tag === "form");
  const input = made.find((e) => e.tag === "input");
  assert.equal(input.value, "x");
  input.value = "Hello";
  form.listeners.submit({ preventDefault() {} });
  assert.equal(await p, "Hello");
  made.length = 0;
  p = askText("Name");
  const cancel = made.find((e) => e.tag === "button");
  cancel.listeners.click();
  assert.equal(await p, null);
  made.length = 0;
  p = askText("Name");
  const wrap = made.find((e) => e.tag === "div" && e.listeners.keydown);
  wrap.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(await p, null);
  delete globalThis.document;
});
