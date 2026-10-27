// Backup when API credits run out: the first-run Setup step and the Settings panel (one shared panel),
// the waiting box, and the clipboard block check the desktop app uses. Pure, no server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { panelHtml, waitBoxHtml, findBlock, TITLE, INTRO, ORDER_LINE } from "../web/backup-panel.js";
import { EXPERT_SETUP } from "../web/simple-ui.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const EM = String.fromCharCode(0x2014);
const VIEW = {
  on: true, website: false, chainLine: ORDER_LINE, appsNote: "Uses the official app for each AI, signed in with your own plan.",
  websiteLabel: "Let Meldmind use the website for me (ChatGPT, Claude, Grok)",
  websiteWarning: "This uses browser control to type into the website and read the reply. The websites' terms do not allow automated use, and your account could be suspended. Use the official apps above when you can.",
  websiteNote: "Website mode is on. If the apps cannot answer, Meldmind tries the website in its own window and asks you before it sends.",
  routes: [
    { id: "claude-code", name: "Claude Code", ai: "Claude", status: "ready", label: "Installed and signed in", on: true, setupUrl: "https://docs.anthropic.com/en/docs/claude-code/setup" },
    { id: "codex", name: "Codex", ai: "ChatGPT", status: "missing", label: "Not installed", on: true, setupUrl: "https://developers.openai.com/codex/cli" },
    { id: "gemini-cli", name: "Gemini CLI", ai: "Gemini", status: "signin", label: "Not signed in", on: true, setupUrl: "https://github.com/google-gemini/gemini-cli" },
    { id: "antigravity", name: "Antigravity", ai: "Gemini", status: "missing", label: "Not installed", on: true, setupUrl: "https://antigravity.google/" },
  ],
};

test("the setup step: status rows come from detection, website mode is off, and the order is in plain words", () => {
  const html = panelHtml(VIEW, { setup: true });
  assert.ok(html.includes(TITLE) && html.includes(INTRO));
  assert.ok(html.includes("1. Official apps on this PC, 2. Website (if you turned it on), 3. You copy it over"));
  for (const r of VIEW.routes) {
    assert.match(html, new RegExp(`data-aw-route="${r.id}"[\\s\\S]*?data-aw-status="${r.status}">${r.label}<`));
  }
  assert.doesNotMatch(html, /data-aw-route="claude-code"[\s\S]*?How to set it up[\s\S]*?data-aw-route="codex"/, "a ready app needs no setup button");
  assert.match(html, /data-aw-setup="https:\/\/developers\.openai\.com\/codex\/cli">How to set it up/);
  assert.match(html, /id="cc-aw-website" >/, "website mode is not checked");
  assert.ok(html.includes(VIEW.websiteWarning.replace(/'/g, "&#39;")));
  assert.ok(!html.includes(VIEW.websiteNote), "the later-update note shows only when it is on");
  assert.match(html, /Check again/);
  assert.match(html, /change this later in Settings/);
  assert.ok(!html.includes(EM));
  const on = panelHtml({ ...VIEW, website: true });
  assert.match(on, /id="cc-aw-website" checked/);
  assert.ok(on.includes(VIEW.websiteNote));
});

test("website mode needs an explicit confirm in the page, and the step is in both setup flows", () => {
  const mod = read("web", "features", "answer-wait.js");
  assert.match(mod, /await window\.CC\.confirm\(/);
  assert.match(mod, /website: true, confirm: true/);
  const app = read("web", "app.js");
  // 0.4.17: Simple setup is one welcome screen, and the backup step fills its reserved slot.
  assert.match(app, /id="su-backup-slot" data-slot="credit-backup"/);
  assert.match(app, /window\.CC\.renderBackupPanel\(box, \{ setup: true \}\)/);
  assert.ok(EXPERT_SETUP.some((s) => s.id === "backup" && s.title === "Backup when API credits run out"));
  assert.match(app, /step\.id === "backup"\) window\.CC\.renderBackupPanel/);
  assert.match(read("web", "perf", "registry.js"), /\{ id: "answer-wait", shell: true \}/);
});

test("the waiting box: plain words, the step in use, the three buttons, how long it has waited", () => {
  const html = waitBoxHtml({ jobId: "ans-ABCDEF123", ai: "Claude", since: 1000, step: "apps", trying: "Claude Code", headline: "Out of API credits. Answering through Claude Code on this PC." }, { now: 1000 + 125000 });
  assert.match(html, /Out of API credits\. Answering through Claude Code on this PC\./);
  assert.match(html, /<li class="on">Official apps on this PC \(now\)<\/li>/);
  assert.match(html, /Continue in Claude/); assert.match(html, /Paste reply/); assert.match(html, /Stop waiting/);
  assert.match(html, /Waiting <span data-aw-since="1000">2 min<\/span>/);
  const copy = waitBoxHtml({ jobId: "ans-ABCDEF123", ai: "Claude", step: "copy", website: true }, { now: 5 });
  assert.match(copy, /Out of API credits\. Answering through your Claude subscription\./);
  assert.match(copy, /Website mode is on: Meldmind tries the website in its own window/);
  assert.ok(!html.includes(EM) && !copy.includes(EM));
  assert.equal(waitBoxHtml({}), "");
});

test("the clipboard check takes only a block for a waiting job", () => {
  const clip = `random page text\nMELDMIND ANSWER ans-OTHER1234\nnot mine\nEND MELDMIND ANSWER\nMELDMIND ANSWER ans-MINE12345\nThe answer.\nEND MELDMIND ANSWER\nmore`;
  assert.deepEqual(findBlock(clip, ["ans-MINE12345"]), { jobId: "ans-MINE12345", answer: "The answer." });
  assert.equal(findBlock(clip, ["ans-NOPE12345"]), null);
  assert.equal(findBlock("MELDMIND ANSWER ans-MINE12345\n(your full answer here)\nEND MELDMIND ANSWER", ["ans-MINE12345"]), null, "our own prompt template is not an answer");
  assert.equal(findBlock("just a reply", ["ans-MINE12345"]), null);
});
