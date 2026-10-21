// Test with personas (0.4.14). Pure checks: the panel is the 18-person Meldmind persona panel, the smart
// default fits each output type (and brings topic experts), the panel's JSON is read safely. Then the
// running server with the demo AIs (local mock, no real key or URL): test an output, apply one fix,
// apply all. Web checks: the button shows under every output and on the draft, post, page and design
// screens, with the advanced picker tucked away.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { PANEL, KINDS, smartPick, pickPanel, guessKind, parseReactions, cleanFixes, cleanRevision, testSystem, fixPrompt, FIX_SYSTEM } from "../server/persona-panel.js";
import { shellIds } from "../web/perf/registry.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("the panel is the Meldmind persona panel (18 people)", () => {
  assert.equal(PANEL.length, 18);
  assert.deepEqual(PANEL.map((p) => p.name), ["Dana", "Marcus", "Priya", "Jordan", "Leo", "Sofia", "Helen", "Ray", "Tasha", "Kai", "Walt", "Nadia", "Elena", "Derek", "Carla", "Jaylen", "Priya Natarajan", "Dorothy"]);
  assert.equal(new Set(PANEL.map((p) => p.id)).size, 18);
  for (const p of PANEL) assert.ok(p.who && p.cares, p.id);
  for (const k of ["chat", "mission", "draft", "post", "page", "design"]) assert.ok(KINDS[k], `output type ${k}`);
});

test("smart default: the right people for each kind of output", () => {
  assert.deepEqual(smartPick("post", "Fall menu is here!"), ["dana", "kai", "jordan"]);
  assert.deepEqual(smartPick("page", "Welcome to our shop"), ["dorothy", "carla", "elena"]);
  assert.deepEqual(smartPick("design", "A flyer"), ["elena", "sofia", "kai"]);
  assert.deepEqual(smartPick("chat", "Here is how to reset your router."), ["dorothy", "carla", "helen"]);
  assert.ok(smartPick("post", "First-time home buyer? Our mortgage team can help.").includes("ray"), "mortgage wording brings Ray");
  assert.ok(smartPick("draft", "We can raise your credit score fast").includes("tasha"), "credit repair claims bring Tasha");
  assert.ok(smartPick("post", "mortgage credit score insurance attorney").length <= 4);
  assert.deepEqual(pickPanel({ kind: "post", text: "x", personas: ["walt", "nobody", "walt"] }), { ids: ["walt"], smart: false });
  assert.equal(pickPanel({ kind: "post", text: "x", personas: [] }).smart, true);
  assert.equal(pickPanel({ kind: "post", personas: PANEL.map((p) => p.id) }).ids.length, 6, "6 people at most");
  assert.equal(guessKind("```js\nconst a = 1;\n```"), "code");
  assert.equal(guessKind("Subject: quick one\n\nHi Ana"), "email");
  assert.equal(guessKind("New flavors this week! #bakery #fall"), "post");
  assert.equal(guessKind("Hello there, here is your answer."), "chat");
});

test("prompts and parsing: the panel's JSON is read safely, fixes are clean", () => {
  const sys = testSystem(["dana", "priya-n"], "post");
  assert.match(sys, /^Meldmind persona test:/);
  assert.match(sys, /^- dana: Dana, 48, owns a two-location bakery/m);
  assert.match(sys, /^- priya-n: Priya Natarajan, 31/m);
  assert.match(FIX_SYSTEM, /^Meldmind persona fixes:/);
  const raw = `Sure! {"reactions":[{"id":"dana","reaction":"Too long — cut it.","score":2,"fixes":[{"fix":"Cut to 3 lines.","why":"Phone readers."},"Add the price."]},{"id":"zed","reaction":"x"}]} thanks`;
  const out = parseReactions(raw, ["dana", "priya-n"]);
  assert.equal(out[0].name, "Dana"); assert.equal(out[0].score, 2);
  assert.equal(out[0].reaction.includes("—"), false, "no em-dash reaches the screen");
  assert.deepEqual(out[0].fixes.map((f) => [f.id, f.fix, f.by]), [["dana-1", "Cut to 3 lines.", "Dana"], ["dana-2", "Add the price.", "Dana"]]);
  assert.equal(out[1].missing, true, "a persona the model skipped says so");
  assert.deepEqual(parseReactions("not json", ["dana"])[0].missing, true);
  assert.deepEqual(cleanFixes([{ fix: " Shorter " }, "", { by: "x" }, "Warmer"]), [{ fix: "Shorter", by: "" }, { fix: "Warmer", by: "" }]);
  assert.equal(cleanRevision("```markdown\nNew text\n```"), "New text");
  assert.equal(cleanRevision("Here is the revised output:\n\nNew text"), "New text");
  assert.match(fixPrompt("Hello", [{ fix: "Warmer", by: "Dana" }]), /^FIXES TO APPLY:\n1\. Warmer \(from Dana\)\n\nOUTPUT TO REVISE:\nHello$/);
});

test("web: Test with personas under every output and on drafts, posts, pages and designs", () => {
  assert.ok(shellIds().includes("personas"), "loaded on every page, so any screen can offer the test");
  const ui = read("web", "features", "personas.js");
  assert.match(ui, /window\.CC\.register\(\{ id: "personas", deliverable: \{ order: 4, render: renderDeliverable \} \}\);/);
  assert.match(ui, /window\.CC\.testWithPersonas = /);
  assert.match(ui, /<b>Smart pick:<\/b>/);
  assert.match(ui, /<summary class="small">Choose people myself<\/summary>/, "picking people yourself is tucked away");
  assert.match(ui, /Apply all fixes/);
  assert.match(ui, />\$\{flow\.applied\.has\(f\.id\) \? "Applied" : "Apply"\}</);
  assert.match(ui, /Use this version/);
  assert.match(ui, /Undo last change/);
  assert.match(ui, /Nothing is sent or posted\./);
  for (const f of ["publish.js", "images.js", "builders.js", "webbuilders.js", "everyday-inbox.js"]) assert.match(read("web", "features", f), /personaButton|testWithPersonas/, f);
});

test("server: test an output, apply one fix, apply all", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await s.api("/personas", { noToken: true })).status, 401, "session token required");
    const panel = (await s.api("/personas")).json;
    assert.equal(panel.personas.length, 18);
    assert.match(panel.note, /simulated/);
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const pick = (await s.api(`/personas/pick?kind=post&text=${encodeURIComponent("Our new mortgage rates")}`)).json;
    assert.deepEqual(pick.personas, ["dana", "kai", "jordan", "ray"]);
    assert.equal(pick.kindLabel, "a post");

    assert.equal((await s.api("/personas/test", { method: "POST", body: { text: "  ", kind: "post" } })).status, 400);
    const post = "Fall menu is here! Pumpkin muffins all week. #bakery";
    const t = (await s.api("/personas/test", { method: "POST", body: { text: post, kind: "post" } }));
    assert.equal(t.status, 200, t.text);
    assert.equal(t.json.smart, true);
    assert.deepEqual(t.json.reactions.map((r) => r.name), ["Dana", "Kai", "Jordan"]);
    assert.ok(t.json.reactions.every((r) => r.reaction && r.score >= 1 && r.score <= 5 && r.fixes.length === 1));
    const mine = (await s.api("/personas/test", { method: "POST", body: { text: post, kind: "post", personas: ["dorothy", "walt"] } })).json;
    assert.equal(mine.smart, false);
    assert.deepEqual(mine.reactions.map((r) => r.id), ["dorothy", "walt"]);

    const one = (await s.api("/personas/apply", { method: "POST", body: { text: post, kind: "post", fixes: [t.json.reactions[0].fixes[0]] } })).json;
    assert.ok(one.text.startsWith(post));
    assert.match(one.text, /Revised in demo mode: 1 fix applied\./);
    const all = (await s.api("/personas/apply", { method: "POST", body: { text: post, kind: "post", fixes: t.json.reactions.flatMap((r) => r.fixes) } })).json;
    assert.equal(all.applied, 3);
    assert.match(all.text, /3 fixes applied/);
    assert.equal((await s.api("/personas/apply", { method: "POST", body: { text: post, fixes: [] } })).status, 400);
  } finally { await s.stop(); }
});
