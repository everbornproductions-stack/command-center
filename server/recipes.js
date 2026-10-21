// Phase 57. Record a desktop-control task once and replay it on a schedule.
// A scheduled send, buy, or delete waits for a second yes. Unlimited on Extreme.
// This does not replace saved pipelines or the existing schedules.

import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { gate } from "./feature-gate.js";
import { loadState } from "./control-apps.js";
import { ask } from "./phone-approvals.js";
import { parseCron, cronDue } from "./schedules.js";

const DOC = "control.recipes";
const RISKY = /\b(send|submit|post|publish|buy|purchase|pay|delete|remove)\b/i;

function empty() {
  return { list: [] };
}
function load() {
  const saved = doc(DOC, empty);
  return { list: Array.isArray(saved?.list) ? saved.list : [] };
}
function save(next) {
  putDoc(DOC, next);
  return next;
}

function publicRecipe(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    appId: recipe.appId,
    appName: recipe.appName,
    steps: recipe.steps,
    cron: recipe.cron || "",
    enabled: !!recipe.enabled,
    lastStatus: recipe.lastStatus || "",
    lastPlain: recipe.lastPlain || "",
  };
}

export function publicState() {
  return { recipes: load().list.map(publicRecipe) };
}

function cleanSteps(steps) {
  const out = [];
  for (const step of steps || []) {
    const action = String(step?.action || "").slice(0, 20);
    if (!action) continue;
    const text = String(step?.text || step?.name || "").replace(/password/gi, "").slice(0, 80);
    out.push({
      action,
      ref: String(step?.ref || "").slice(0, 40),
      text,
      needsApproval: !!(step?.needsApproval || RISKY.test(`${action} ${text}`)),
    });
  }
  return out.slice(0, 24);
}

export function recordRecipe({ appId, name, cron, steps } = {}) {
  const state = load();
  gate("recipes", { count: state.list.length });
  const app = loadState().apps.find((item) => item.id === appId);
  if (!app || !app.allowed) {
    const err = new Error("Allow the app before you record a recipe.");
    err.status = 403;
    throw err;
  }
  const taken = cleanSteps(steps && steps.length ? steps : app.lastSteps);
  if (!taken.length) {
    const err = new Error("Run the task once before you save a recipe.");
    err.status = 400;
    throw err;
  }
  let parsed = null;
  if (cron) parsed = parseCron(cron);
  const recipe = {
    id: `rc-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    name: String(name || app.name).trim().slice(0, 60) || app.name,
    appId: app.id,
    appName: app.name,
    steps: taken,
    cron: parsed ? parsed.expr : "",
    enabled: !!parsed,
    lastSlot: 0,
    lastStatus: "saved",
    lastPlain: "Saved. A replay uses the same Allow and the same yes before a send, buy, or delete.",
  };
  state.list.push(recipe);
  save(state);
  return publicRecipe(recipe);
}

const LAYOUT_PLAIN = "The app layout changed. Meldmind tried another way, then stopped so you can finish it by hand.";

export function replay(id, { confirm = false, layoutChanged = false, scheduled = false } = {}) {
  const state = load();
  const recipe = state.list.find((item) => item.id === id);
  if (!recipe) {
    const err = new Error("That recipe is not saved.");
    err.status = 404;
    throw err;
  }
  const app = loadState().apps.find((item) => item.id === recipe.appId);
  if (!app || !app.allowed) {
    recipe.lastStatus = "stopped";
    recipe.lastPlain = "That app is not allowed. Nothing ran.";
    save(state);
    return publicRecipe(recipe);
  }
  if (layoutChanged) {
    recipe.lastStatus = "ask";
    recipe.lastPlain = LAYOUT_PLAIN;
    save(state);
    return { ...publicRecipe(recipe), performed: false };
  }
  const risky = recipe.steps.find((step) => step.needsApproval);
  if (risky && !confirm) {
    const kind = /\b(buy|purchase|pay)\b/i.test(risky.text) ? "buy" : /\b(delete|remove)\b/i.test(risky.text) ? "delete" : "send";
    const approval = ask({ kind, action: `${recipe.name}: ${risky.text || risky.action}`, amount: null });
    recipe.lastStatus = "needs_approval";
    recipe.lastPlain = scheduled
      ? "A scheduled replay wants to send, buy, or delete. It is waiting for your yes."
      : "This replay wants to send, buy, or delete. It is waiting for your yes.";
    save(state);
    return { ...publicRecipe(recipe), performed: false, approvalId: approval.id };
  }
  recipe.lastStatus = "done";
  recipe.lastPlain = `Replayed ${recipe.steps.length} step${recipe.steps.length === 1 ? "" : "s"} on ${recipe.appName}.`;
  save(state);
  return { ...publicRecipe(recipe), performed: true };
}

export function tick(now = Date.now()) {
  const state = load();
  const ran = [];
  for (const recipe of state.list) {
    if (!recipe.enabled || !recipe.cron) continue;
    let due = null;
    try { due = cronDue(parseCron(recipe.cron), recipe.lastSlot || 0, now); } catch { due = null; }
    if (due == null) continue;
    recipe.lastSlot = due;
    save(state);
    ran.push(replay(recipe.id, { scheduled: true }));
  }
  return ran;
}

export { LAYOUT_PLAIN };
