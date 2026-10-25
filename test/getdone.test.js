// Get it done: one job can run ordinary steps without asking.
// Spending money and a permanent delete always ask. Sending stays off unless turned on.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { newContext, FileStore, runAs } from "../server/store.js";
import * as GD from "../server/getdone.js";
import * as H from "../server/handoff.js";
import { loadHelp, releaseHelpOk } from "../server/help.js";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EM = "\u2014";
const SECRET = "sk-ant-SECRETVALUE88421";

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-"));
  const c = newContext("gd-test", new FileStore(dir));
  c.ready = true;
  try { return runAs(c, fn); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the phrase grants autopilot and a loose sentence does not", () => {
  assert.equal(GD.saidGetItDone("get it done, don't ask me"), true);
  assert.equal(GD.saidGetItDone("Get it done. Do not ask me."), true);
  assert.equal(GD.saidGetItDone("please GET IT DONE dont ask me now"), true);
  assert.equal(GD.saidGetItDone("get it done by Friday"), false);
  assert.equal(GD.saidGetItDone("don't ask me"), false);
  assert.equal(GD.saidGetItDone("get it done"), false);
});

test("a grant skips ordinary steps, still asks for money, deletes, and sending, and ends with the job", () => {
  withStore(() => {
    const phrase = GD.openGrant({ runId: "m-phrase", text: `Write ${SECRET}. Get it done, don't ask me.` });
    assert.equal(phrase.source, "phrase");
    assert.equal(phrase.send, false);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "form submit" }).skip, true);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "purchase" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "delete" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "send" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "post" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "your turn" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-other", kind: "form submit" }).skip, false);
    const blob = JSON.stringify(GD.view());
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes("Bearer"), false);
    assert.ok(blob.includes("A step went ahead without asking."));
    assert.ok(blob.includes("Still asked, because it spends money."));
    GD.endGrant("m-phrase");
    assert.equal(GD.grantFor("m-phrase"), null);
    assert.equal(GD.maySkipAsk({ runId: "m-phrase", kind: "form submit" }).skip, false);

    const toggled = GD.openGrant({ runId: "m-toggle", text: "hello", toggle: true, send: true });
    assert.equal(toggled.source, "toggle");
    assert.equal(toggled.send, true);
    assert.equal(GD.maySkipAsk({ runId: "m-toggle", kind: "send" }).skip, true);
    assert.equal(GD.maySkipAsk({ runId: "m-toggle", kind: "post" }).skip, true);
    assert.equal(GD.maySkipAsk({ runId: "m-toggle", kind: "purchase" }).skip, false);
    assert.equal(GD.maySkipAsk({ runId: "m-toggle", kind: "delete" }).skip, false);
    const quiet = GD.openGrant({ runId: "m-quiet", text: "hello", toggle: true });
    assert.equal(quiet.send, false);
    assert.equal(GD.maySkipAsk({ runId: "m-quiet", kind: "send" }).skip, false);
  });
});

test("a rule for a kind of job can be revoked, and a phrase does not turn sending on", () => {
  withStore(() => {
    const rule = GD.saveRule({ jobKind: "writing", send: true });
    assert.equal(rule.send, true);
    const fromRule = GD.openGrant({ runId: "m-rule", text: "Write a blog post about the chairs." });
    assert.equal(fromRule.source, "rule");
    assert.equal(fromRule.send, true);
    assert.equal(fromRule.jobKind, "writing");
    const fromPhrase = GD.openGrant({ runId: "m-words", text: "Write a blog post. Get it done, don't ask me." });
    assert.equal(fromPhrase.source, "phrase");
    assert.equal(fromPhrase.send, false, "the words do not turn sending on");
    GD.revokeRule(rule.id);
    assert.equal(GD.view().rules.length, 0);
    assert.equal(GD.openGrant({ runId: "m-after", text: "Write a blog post about the chairs." }), null);
    assert.throws(() => GD.saveRule({ jobKind: "billing" }), (e) => e.status === 400);
    GD.openGrant({ runId: "m-live", text: "Write a note", toggle: true });
    GD.noteJobEnd({ type: "browser.job", job: { id: "bh-child", status: "done" } });
    assert.ok(GD.grantFor("m-live"), "a finished browser step does not end the parent job");
    GD.noteJobEnd({ type: "mission.update", mission: { id: "m-live", status: "done" } });
    assert.equal(GD.grantFor("m-live"), null);
  });
});

test("permission lines stay plain, and a long handoff keeps the line with the report block", () => {
  assert.equal(GD.permissionLine(null).includes(EM), false);
  assert.match(GD.permissionLine(null), /ask before each step/);
  assert.match(GD.permissionLine({ send: false }), /Do not send a message to anyone/);
  assert.match(GD.permissionLine({ send: true }), /Sending a message is allowed for this job/);
  assert.equal(GD.AUTO_LINE.includes(EM), false);
  assert.equal(GD.SEND_LINE.includes(EM), false);
  const turns = [];
  for (let i = 0; i < 6; i++) turns.push({ role: i % 2 ? "assistant" : "user", text: "t".repeat(2000) });
  const built = H.buildHandoffPrompt({
    targetName: "ChatGPT",
    summary: "y".repeat(2000),
    turns,
    reportBlockText: `When finished, let Meldmind know: POST https://example.test/done\n${"n".repeat(8000)}`,
    permissionText: GD.AUTO_LINE,
  });
  assert.ok(built.text.includes(GD.AUTO_LINE));
  assert.ok(built.text.includes("When finished, let Meldmind know:"));
  assert.ok(built.text.includes("[cut to fit]"));
  assert.equal(built.text.includes(EM), false);
  const plain = H.buildHandoffPrompt({ targetName: "Claude", summary: "A short note" });
  assert.match(plain.text, /ask before each step/);
  assert.doesNotMatch(plain.text, /Get it done for this job only/);
});

test("the page, the tour, Help, and the guide say Get it done in plain words", () => {
  const files = [
    "server/getdone.js",
    "web/features/getdone.js",
    "web/features/tour.js",
    "web/features/browser.js",
    "docs/help/what-meldmind-can-do.md",
    "docs/help/handoff.md",
    "docs/WHATS-NEW.json",
    "docs/USER-GUIDE.md",
    "docs/guide-pdf.json",
    "electron/browser-bar.html",
  ];
  for (const f of files) assert.equal(read(f).includes(EM), false, f);
  const ui = read("web/features/getdone.js");
  assert.match(ui, /Get it done/);
  assert.match(ui, /Don't ask me on this job/);
  assert.match(ui, /Also send messages/);
  assert.match(ui, /Always for this kind of job/);
  assert.match(ui, /id="gd-send"/);
  assert.match(ui, /choice\.send && on \? "checked"/);
  assert.match(ui, /Get it done is on for this job\. Stop is still here\./);
  assert.match(ui, /Activity log/);
  assert.match(read("web/perf/registry.js"), /"getdone"/);
  assert.match(read("web/features/tour.js"), /title: "Get it done"/);
  assert.match(read("web/app.js"), /getItDone: !!window\.CC\?\.getDoneChoice\?\.on/);
  assert.match(read("web/app.js"), /sendMessages: !!window\.CC\?\.getDoneChoice\?\.send/);
  const news = JSON.parse(read("docs/WHATS-NEW.json"));
  const bullet = Object.values(news).flatMap((v) => v.bullets || []).find((b) => b.startsWith("Get it done lets one job"));
  assert.ok(bullet);
  assert.match(bullet, /Spending money and a permanent delete still need one tap/);
  assert.match(bullet, /Sending a message stays off unless you turn that on/);
  assert.match(bullet, /Stop and the activity log stay on/);
  const guide = JSON.parse(read("docs/guide-pdf.json"));
  assert.ok(guide.sections.some((s) => s.title === "Get it done"));
  assert.match(read("docs/USER-GUIDE.md"), /## 9\. When another AI finishes/);
  assert.match(read("docs/USER-GUIDE.md"), /Always for this kind of job/);
  assert.match(read("docs/help/what-meldmind-can-do.md"), /lastUpdatedVersion: \d+\.\d+\.\d+/);
  assert.match(read("docs/help/what-meldmind-can-do.md"), /Get it done lets one job run its steps without asking/);
  assert.match(read("docs/help/handoff.md"), /still need one tap/);
  const browser = read("server/browser.js");
  const refuseAt = browser.indexOf("if (risk.refuse)");
  const skipAt = browser.indexOf("maySkipAsk({");
  assert.ok(refuseAt > 0 && skipAt > refuseAt, "a hard refuse still happens before Get it done");
  assert.match(browser, /kind: risk\.ask\.kind/);
  assert.match(read("server/grokbot.js"), /const taskOut = `\$\{j\.task\}/);
  assert.match(read("server/grokbot.js"), /perm\.line/);
  assert.match(read("server/media-jobs.js"), /awaiting_ok/);
  assert.match(read("server/handoff.js"), /permissionText/);
  const pkg = JSON.parse(read("package.json"));
  const pack = loadHelp();
  const gate = releaseHelpOk({ version: pkg.version, news, articles: pack.articles, catalog: pack.catalog });
  assert.equal(gate.ok, true, gate.problems.join("\n"));
  assert.equal(pkg.version, "0.4.18");
});

test("rules, the handoff prompt, and Stop go through the app", async () => {
  const s = await startServer();
  try {
    const made = await s.api("/getdone/rules", { method: "POST", body: { jobKind: "writing", send: false } });
    assert.equal(made.status, 200);
    assert.equal(made.json.rules.some((r) => r.jobKind === "writing" && r.send === false), true);
    const bad = await s.api("/getdone/rules", { method: "POST", body: { jobKind: "billing", send: true } });
    assert.equal(bad.status, 400);
    const id = made.json.rules.find((r) => r.jobKind === "writing").id;
    const gone = await s.api(`/getdone/rules/${id}`, { method: "DELETE" });
    assert.equal(gone.status, 200);
    assert.equal(gone.json.rules.some((r) => r.jobKind === "writing"), false);

    const auto = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", draft: "Write a short note. Get it done, don't ask me." } });
    assert.equal(auto.status, 200);
    assert.match(auto.json.prompt, /Get it done for this job only/);
    assert.match(auto.json.prompt, /Do not send a message to anyone/);
    assert.match(auto.json.prompt, /When finished, let Meldmind know:/);
    assert.equal(auto.json.prompt.includes(EM), false);
    assert.equal(auto.json.prompt.includes("Bearer"), false);
    const view = await s.api("/getdone");
    const grant = view.json.grants.find((g) => g.send === false);
    assert.ok(grant, "the handoff opened a grant");
    assert.equal(JSON.stringify(view.json).includes(SECRET), false);
    const stopped = await s.api(`/getdone/stop/${encodeURIComponent(grant.runId)}`, { method: "POST", body: {} });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.grants.some((g) => g.runId === grant.runId), false);
    assert.ok(stopped.json.log.some((row) => row.text.includes("Stopped. Get it done is off for this job.")));

    const friday = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", draft: "Get it done by Friday." } });
    assert.match(friday.json.prompt, /ask before each step/);
    assert.doesNotMatch(friday.json.prompt, /Get it done for this job only/);

    const send = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", draft: "Send the weekly note.", getItDone: true, sendMessages: true } });
    assert.match(send.json.prompt, /Sending a message is allowed for this job/);
    assert.match(send.json.prompt, /Still stop and ask before spending money or a permanent delete/);
    const state = await s.api("/state");
    assert.ok(state.json.plugins.includes("getdone"));
  } finally {
    await s.stop();
  }
});
