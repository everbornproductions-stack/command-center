// 0.4.20 area B item 2: "Use this" fills the chat box, Sort/Filter hide in Simple, forms scroll into view,
// "Use <employee>" re-runs the request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDraftStore, captureViewDraft, restoreViewDraft } from "../web/nav-state.js";
import { boardControls } from "../web/features/prompt-board.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("an empty saved chat box never wipes words a prompt just filled in", () => {
  const store = createDraftStore();
  const before = { querySelectorAll: () => [{ tagName: "TEXTAREA", type: "textarea", id: "orders", value: "" }] };
  captureViewDraft("command", before, store);
  const orders = { tagName: "TEXTAREA", type: "textarea", id: "orders", value: "Write my weekly update" };
  restoreViewDraft("command", { querySelectorAll: () => [orders] }, store);
  assert.equal(orders.value, "Write my weekly update");
  // other fields still restore normally
  const store2 = createDraftStore();
  captureViewDraft("x", { querySelectorAll: () => [{ tagName: "INPUT", type: "text", id: "other", value: "kept" }] }, store2);
  const other = { tagName: "INPUT", type: "text", id: "other", value: "" };
  restoreViewDraft("x", { querySelectorAll: () => [other] }, store2);
  assert.equal(other.value, "kept");
});

test("Sort and Filter are Expert only and really hidden in Simple", () => {
  assert.equal(boardControls("simple").sort, false);
  assert.equal(boardControls("simple").filter, false);
  assert.equal(boardControls("expert").sort, true);
  assert.match(read("web", "features", "prompt-board.js"), /tools\.style\.display = controls\.sort \? "" : "none"/);
});

test("opened prompt forms scroll into view and the employee pick re-runs the request", () => {
  const prompts = read("web", "features", "prompts.js");
  assert.equal((prompts.match(/scrollToForm\(box\)/g) || []).length >= 3, true);
  const ui = read("web", "employees-ui.js");
  assert.match(ui, /onPick = null/);
  assert.match(ui, /onPick\(state\.employee\)/);
  assert.match(read("web", "app.js"), /Running it again with this helper/);
});
