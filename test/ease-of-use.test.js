// Ease-of-use checks for the panel items that ship with 0.4.10.
// These read source and help files. They do not start the app or touch data/.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { loadHelp } from "../server/help.js";
import { searchArticles, tryThese } from "../web/help-rank.js";
import { riskyAction } from "../server/action-policy.js";
import { TERMS } from "../web/plain.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("help search answers plain questions with a relevant article first", () => {
  const pack = loadHelp();
  const first = (q) => searchArticles(pack.articles, q, 5)[0]?.id;
  assert.equal(first("how do I ask a question"), "start-here");
  assert.equal(first("make text bigger"), "text-size");
  assert.equal(first("what is a key"), "api-keys");
  assert.equal(first("does this cost money"), "license");
  assert.equal(searchArticles(pack.articles, "SmartScreen unsigned installer")[0].id, "troubleshooting");
  const help = read("web", "features", "help.js");
  assert.match(help, /Back to all help/);
  assert.match(help, /No article used those words\. Try these:/);
  assert.doesNotMatch(help, /No matching article/);
  assert.equal(tryThese(pack.articles).length, 3);
  assert.equal(fs.existsSync(path.join(ROOT, "docs", "help", "start-here.md")), true);
});

test("text size scales from the html element and Simple stays at least 14px", () => {
  const css = read("web", "styles.css");
  const a11y = read("web", "features", "a11y.js");
  assert.match(a11y, /html\[data-text="small"\] \{ font-size: 14px; \}/);
  assert.match(a11y, /html\[data-text="default"\] \{ font-size: 16px; \}/);
  assert.match(a11y, /html\[data-text="large"\] \{ font-size: 20px; \}/);
  assert.match(a11y, /html\[data-text="xlarge"\] \{ font-size: 22\.4px; \}/);
  assert.doesNotMatch(a11y, /html\[data-text="large"\] body/);
  assert.match(css, /html \{ font-size: 16px; \}/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /\.topbar, \.tabs, \.top-right \{ flex-wrap: nowrap; \}/);
  assert.match(css, /font-size: max\(1rem, 16px\) !important/);
  assert.match(css, /font-size: max\(0\.875rem, 14px\) !important/);
  // .task .cost and the .mrow rows now use rem, so they grow with the text size too.
  const allowed = new Set([".ev .t", ".tile .badge", ".node-label", ".node-sub", ".cc-spark-tip"]);
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel || sel.startsWith("@")) continue;
    for (const hit of m[2].matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      if (Number(hit[1]) < 14) found.push(sel);
    }
  }
  assert.deepEqual(found.sort(), [...allowed].sort());
  const app = read("web", "app.js");
  // 0.4.17: text size is a row on the one welcome screen, not its own page.
  const step = app.slice(app.indexOf("function welcomeLookHtml"), app.indexOf("function welcomeAiHtml"));
  assert.match(step, /WELCOME\.textTitle/);
  assert.match(step, /id="su-text-preview"/);
  assert.match(step, /TEXT_SIZES\.map/);
  assert.doesNotMatch(step, /data-text="small"/);
  const ui = read("web", "simple-ui.js");
  assert.match(ui, /\["xlarge", "Extra large"\]/);
  assert.doesNotMatch(ui, /\["small"/);
});

test("Simple Settings opens five cards, then More options, and Expert keeps the full page", () => {
  const app = read("web", "app.js");
  const basics = app.slice(app.indexOf("function renderSimpleBasics"), app.indexOf("function renderSettings"));
  for (const label of ["Your AI", "Text and reading", "Privacy", "Your plan", "Get help", "More options"]) {
    assert.match(basics, new RegExp(label));
  }
  assert.match(basics, /id="basics-reading"/);
  assert.doesNotMatch(basics, /per 1M/);
  assert.doesNotMatch(basics, /EVB-/);
  assert.doesNotMatch(basics, /Vault file/);
  const settings = app.slice(app.indexOf("function renderSettings"), app.indexOf("async function refresh"));
  assert.match(settings, /S\.uiMode === "simple" && S\.settingsMore !== true/);
  assert.match(settings, /id="settings-plan"/);
  assert.match(settings, /id="settings-find"/);
  assert.match(settings, /Back to basics/);
  assert.match(settings, /per 1M/);
  assert.match(app, /Say what you want in the box/);
  assert.doesNotMatch(app.slice(app.indexOf("function renderOutput"), app.indexOf("function renderOutput") + 2500), /The council picks the AI/);
});

test("acting words wait for a click, and a reader is read-only only by its name", () => {
  const cases = [
    [{ name: "list_files", description: "post the files somewhere" }, true],
    [{ name: "list_files", description: "post the files somewhere", annotations: { readOnlyHint: true } }, false],
    [{ name: "get_status", description: "Deletes all files and sends them by email" }, true],
    [{ name: "get_contact" }, false],
    [{ name: "search_mail" }, false],
    [{ name: "read_calendar" }, false],
    [{ name: "lookup", description: "Find a row" }, false],
    [{ name: "get_result", description: "Nothing new is sent" }, false],
    [{ name: "search_docs" }, false],
    [{ name: "fetch_page" }, false],
    [{ name: "read_note" }, false],
    [{ name: "view_status" }, false],
    [{ name: "find_item" }, false],
    [{ name: "inspect_job" }, false],
    [{ name: "discover_tools" }, false],
    [{ name: "send_mail", annotations: { readOnlyHint: true } }, true],
    [{ name: "reply_email" }, true],
    [{ name: "forward_email" }, true],
    [{ name: "gmail_reply" }, true],
    [{ name: "remove_contact" }, true],
    [{ name: "create_invoice" }, true],
    [{ name: "book_meeting" }, true],
    [{ name: "share_doc" }, true],
    [{ name: "invite_user" }, true],
    [{ name: "submit_form" }, true],
    [{ name: "transfer_funds" }, true],
    [{ name: "refund_payment" }, true],
    [{ name: "cancel_order" }, true],
    [{ name: "remove_file" }, true],
    [{ name: "archive_thread" }, true],
    [{ name: "move_file" }, true],
    [{ name: "unsubscribe_list" }, true],
    [{ name: "order_item" }, true],
    [{ name: "checkout_cart" }, true],
    [{ name: "sign_doc" }, true],
    [{ name: "approve_request" }, true],
    [{ name: "update_record" }, true],
    [{ name: "edit_page" }, true],
    [{ name: "write_note" }, true],
    [{ name: "create_event" }, true],
    [{ name: "schedule_post" }, true],
    [{ name: "book_room" }, true],
    [{ name: "list_orders" }, true],
    [{ name: "get_or_create" }, true],
    [{ name: "delete_row" }, true],
    [{ name: "charge_card", description: "read the receipt" }, true],
    [{ name: "publish_post" }, true],
    [{ name: "pay_invoice" }, true],
    [{ name: "lookup_then_send" }, true],
    [{ name: "execute_zapier_read_action", description: "send it" }, false],
    [{ name: "execute_zapier_write_action" }, true],
    [{ name: "clock", annotations: { readOnlyHint: true } }, false],
    [{ name: "echo" }, true],
    [{ name: "design_review" }, true],
  ];
  assert.ok(cases.length >= 40, `expected about 40 names, got ${cases.length}`);
  for (const [tool, risky] of cases) {
    assert.equal(riskyAction(tool), risky, tool.name);
  }
});

test("the Simple tour is five short steps and the full tour stays available", () => {
  const tour = read("web", "features", "tour.js");
  const chunk = tour.slice(tour.indexOf("export const SIMPLE_STEPS"), tour.indexOf("\n];", tour.indexOf("export const SIMPLE_STEPS")));
  const bodies = [...chunk.matchAll(/body: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(bodies.length, 5);
  const banned = /\b(council|mission|pipelines?|MCP|webhook|API|model|Ctrl)\b/;
  for (const body of bodies) {
    assert.ok(body.trim().split(/\s+/).length <= 30, body);
    assert.equal(banned.test(body), false, body);
  }
  assert.match(tour, /export function startFull/);
  assert.match(tour, /See what else it can do/);
  // The full tour is the guide tour (web/features/guide.js) plus the kept stops.
  assert.match(tour, /function fullSteps\(\)/);
  assert.match(read("web", "features", "guide.js"), /title: "Missions and councils"/);
});

test("icon buttons include a word, and help does not keep stale lines", () => {
  function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".js")) out.push(p);
    }
    return out;
  }
  const bad = [];
  for (const file of walk(path.join(ROOT, "web"))) {
    const text = fs.readFileSync(file, "utf8");
    const re = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
    let m;
    while ((m = re.exec(text))) {
      const inner = m[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
      if (inner && !/[A-Za-z0-9]/.test(inner)) bad.push(`${path.relative(ROOT, file)}: ${inner}`);
    }
  }
  assert.deepEqual(bad, []);
  const helpDir = path.join(ROOT, "docs", "help");
  const stale = ["stand-in pages", "cancelled with abort", "right-click, then Open", "abort"];
  for (const name of fs.readdirSync(helpDir)) {
    if (!name.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(helpDir, name), "utf8");
    for (const phrase of stale) assert.equal(text.includes(phrase), false, `${name} still says ${phrase}`);
  }
  assert.match(read("web", "features", "desk.js"), /Sample answer: add a key for real answers\. Nothing was spent\./);
  assert.match(read("web", "features", "desk.js"), /Get real answers/);
  for (const term of Object.values(TERMS)) {
    assert.ok(term.plain && term.explain, term.label);
  }
  assert.match(read("web", "team-words.js"), /Chat with people you invite/);
  assert.match(read("web", "app.js"), /What's this\?/);
  const notes = read("docs", "RELEASE-NOTES.md");
  const first = notes.indexOf("## v");
  const current = notes.slice(first, notes.indexOf("## v", first + 4));
  for (const phrase of ["Home", "Private mode", "Backup", "Background runs", "Together", "People", "Remix", "Zapier", "Make", "hosted runs", "Mac"]) {
    assert.match(current, new RegExp(phrase));
  }
  const banned = /\b(council|deliverable|vault|tokens|licence|recipe)\b/i;
  const simpleBits = [
    read("web", "simple-ui.js").match(/export const PLACEHOLDER[\s\S]*?export const FAILURE/)[0],
    read("web", "features", "tour.js").match(/export const SIMPLE_STEPS[\s\S]*?\n\];/)[0],
    read("web", "app.js").match(/function renderSimpleBasics[\s\S]*?function renderSettings/)[0],
    read("web", "app.js").match(/function renderSimpleChat[\s\S]*?function paintStarters/)[0],
  ];
  for (const bit of simpleBits) assert.equal(banned.test(bit), false, bit.slice(0, 80));
});
