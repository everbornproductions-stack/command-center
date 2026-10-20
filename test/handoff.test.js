// Manual handoff (Phase 26 extension). Registry CRUD, http(s) only, the prompt builder,
// Grab reply saves a $0 manual ledger line, the clipboard stays unread until that click,
// Continue in appears when there is no key, and no secret is stored or logged.
// No real provider URL is called. A local mock stands in for OpenAI only when a key is saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-handoff-");
const H = await import("../server/handoff.js");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("validateUrl: http and https only; javascript, file and data are refused", () => {
  assert.equal(H.validateUrl("https://chatgpt.com"), "https://chatgpt.com/");
  assert.equal(H.validateUrl("http://127.0.0.1:4747/chat"), "http://127.0.0.1:4747/chat");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "file:///etc/passwd", "data:text/html,hi", "blob:http://chatgpt.com/x", "vbscript:msgbox", ""]) {
    assert.throws(() => H.validateUrl(bad), (e) => e.status === 400, bad);
  }
  assert.throws(() => H.validateUrl("https://user:secret@chatgpt.com/"), (e) => e.status === 400);
  assert.throws(() => H.validateUrl("https://example.com/?api_key=sk-test"), (e) => e.status === 400);
});

test("builtins: ChatGPT, Claude, Gemini, Grok and Google Antigravity, each with its own https page", () => {
  const names = H.BUILTIN_TARGETS.map((t) => t.name);
  assert.deepEqual(names, ["ChatGPT", "Claude", "Gemini", "Grok", "Google Antigravity"]);
  for (const t of H.BUILTIN_TARGETS) {
    assert.equal(H.validateUrl(t.url), t.url);
    assert.equal(new URL(t.url).protocol, "https:");
  }
  assert.equal(H.BUILTIN_TARGETS.find((t) => t.id === "antigravity").provider, null);
  assert.equal(H.viaLabel("ChatGPT"), "via ChatGPT web, manual");
  assert.equal(H.LABEL, "manual handoff");
  assert.match(H.GEMINI_DATA_NOTICE, /Gemini free tier/);
  assert.doesNotMatch(H.GEMINI_DATA_NOTICE + H.INSTRUCTIONS, /—/);
});

test("prompt builder: summary, recent turns, size meter, secrets stripped", () => {
  const turns = [];
  for (let i = 0; i < 8; i++) turns.push({ role: i % 2 ? "assistant" : "user", text: `turn ${i} sk-ant-api03-SECRETVALUE123456` });
  const built = H.buildHandoffPrompt({ targetName: "ChatGPT", summary: "A short welcome note", turns });
  assert.match(built.text, /Manual handoff to ChatGPT/);
  assert.match(built.text, /Summary:\nA short welcome note/);
  assert.match(built.text, /Recent turns:/);
  assert.match(built.text, /You: turn 2/);
  assert.match(built.text, /Assistant: turn 7/);
  assert.doesNotMatch(built.text, /turn 0/);
  assert.doesNotMatch(built.text, /SECRETVALUE/);
  assert.match(built.text, /\[redacted\]/);
  assert.equal(built.chars, built.text.length);
  assert.equal(built.maxChars, H.PROMPT_MAX);
  assert.ok(built.bytes >= built.chars);
  assert.ok(built.pct >= 0 && built.pct <= 100);
  const empty = H.buildHandoffPrompt({ targetName: "Claude" });
  assert.match(empty.text, /\(no summary yet\)/);
  assert.match(empty.text, /\(none yet\)/);
});

test("Continue in shows when there is no key, and also when fallback stands a provider aside", () => {
  assert.equal(H.suggestFromAccess({ key: false, mcp: false, officialSignIn: false, aside: null }), true);
  assert.equal(H.suggestFromAccess({ key: true, mcp: false, officialSignIn: false, aside: null }), false);
  assert.equal(H.suggestFromAccess({ key: false, mcp: true, officialSignIn: false, aside: null }), false);
  assert.equal(H.suggestFromAccess({ key: false, mcp: false, officialSignIn: true, aside: null }), false);
  assert.equal(H.suggestFromAccess({ key: true, mcp: true, officialSignIn: true, aside: { kind: "credits" } }), true);
});

test("clipboard is not read on Continue in; Grab reply reads it once", async () => {
  let reads = 0, writes = 0, opened = 0;
  const clip = { text: "already on the clipboard" };
  const writeClipboard = async (t) => { writes++; clip.text = t; };
  const readClipboard = async () => { reads++; return clip.text; };
  const openUrl = async () => { opened++; };
  const cont = await H.continueClick({ prompt: "Manual handoff prompt", writeClipboard, openUrl });
  assert.equal(reads, 0, "Continue in must not read the clipboard");
  assert.equal(writes, 1);
  assert.equal(opened, 1);
  assert.equal(cont.clipboardReads, 0);
  assert.equal(clip.text, "Manual handoff prompt");
  const grab = await H.grabClick({ readClipboard });
  assert.equal(reads, 1, "Grab reply reads the clipboard once");
  assert.equal(grab.clipboardReads, 1);
  assert.equal(grab.preview, "Manual handoff prompt");
  assert.equal(writes, 1, "Grab reply does not write the clipboard");
});

test("page and server sources: manual handoff, no automation, no secrets, no em-dash", () => {
  const server = read("server/handoff.js");
  const plugin = read("server/plugins/handoff.js");
  const ui = read("web/features/handoff.js");
  const preload = read("electron/desk-preload.cjs");
  const main = read("electron/main.cjs");
  const features = read("web/features/index.js");
  for (const src of [server, plugin, ui, read("web/features/fallback.js")]) assert.ok(!src.includes("—"), "no em-dash");
  assert.match(features, /"handoff"/);
  assert.match(ui, /Manual handoff/);
  assert.match(ui, /Continue in \$\{esc\(t\.name\)\}/);
  assert.match(ui, /\.filter\(\(t\) => t\.suggest\)/);
  assert.match(ui, /Grab reply/);
  assert.match(ui, /window\.CC\.geminiDataNotice = GEMINI_DATA_NOTICE/);
  assert.ok(ui.includes(H.GEMINI_DATA_NOTICE), "the page shows the same Gemini free-tier notice");
  assert.match(read("web/features/fallback.js"), /window\.CC\.geminiDataNotice/);
  assert.equal((ui.match(/navigator\.clipboard\.readText/g) || []).length, 1);
  assert.match(ui, /async function grabReply\(\) \{\s*return navigator\.clipboard\.readText\(\);\s*\}/);
  assert.equal((ui.match(/await grabReply\(/g) || []).length, 1);
  assert.match(ui, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.match(ui, /desk\.openExternal\(url\)/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\("app:open-external"/);
  assert.match(main, /handle\("app:open-external"/);
  assert.match(main, /return shell\.openExternal\(u\.toString\(\)\)/);
  for (const src of [server, plugin, ui]) {
    assert.doesNotMatch(src, /fetch\(/);
    assert.doesNotMatch(src, /BrowserWindow|setInterval|document\.cookie|chrome\.cookies/);
    assert.doesNotMatch(src, /Sign in with ChatGPT/i);
    assert.doesNotMatch(src, /gemini-cli|oauth_creds|application_default_credentials/);
  }
  assert.doesNotMatch(server + plugin, /readText|clipboard\.read/, "the server never reads the clipboard");
  assert.match(ui, /navigator\.clipboard\.readText/, "the page reads the clipboard only inside Grab reply");
});

function walk(dir, hit) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, hit);
    else if (st.size < 2_000_000) hit.push([p, fs.readFileSync(p, "utf8")]);
  }
  return hit;
}

test("server: registry CRUD, prompt, Grab reply ledger, no key, no secrets", { timeout: 90000 }, async () => {
  const mock = http.createServer((req, res) => {
    if (req.url.startsWith("/v1/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "gpt-test" }] })); return; }
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Incorrect API key provided." } }));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${mock.address().port}/v1`;
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_OPENAI: base,
    OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "",
  } });
  const secret = "sk-ant-api03-HANDOFFSECRET123456";
  try {
    assert.equal((await s.api("/handoff", { noToken: true })).status, 401);
    let view = (await s.api("/handoff")).json;
    assert.equal(view.label, "manual handoff");
    assert.match(view.geminiNotice, /Gemini free tier/);
    assert.deepEqual(view.targets.map((t) => t.name), ["ChatGPT", "Claude", "Gemini", "Grok", "Google Antigravity"]);
    for (const t of view.targets) {
      if (t.id === "antigravity") assert.equal(t.provider, null);
      assert.equal(t.suggest, true, t.name);
      assert.equal(t.access.key, false, t.name);
      assert.equal(t.access.mcp, false, t.name);
      assert.equal(t.access.officialSignIn, false, t.name);
      assert.match(t.reason, /no key/);
    }
    assert.ok((await s.api("/state")).json.plugins.includes("handoff"));

    assert.equal((await s.api("/handoff/targets", { method: "POST", body: { name: "Nope", url: "javascript:alert(1)" } })).status, 400);
    assert.equal((await s.api("/handoff/targets", { method: "POST", body: { name: "Nope", url: "file:///tmp/x" } })).status, 400);
    assert.equal((await s.api("/handoff/targets", { method: "POST", body: { name: "Nope", url: "data:text/plain,hi" } })).status, 400);
    assert.equal((await s.api("/handoff/targets", { method: "POST", body: { name: "Nope", url: "https://example.com/ok", note: secret } })).status, 400);
    const added = await s.api("/handoff/targets", { method: "POST", body: { name: "Example Chat", url: "https://example.com/chat", note: "A page I use" } });
    assert.equal(added.status, 200);
    assert.equal(added.json.url, "https://example.com/chat");
    assert.equal(added.json.suggest, true);
    const edited = await s.api(`/handoff/targets/${added.json.id}`, { method: "PATCH", body: { url: "https://example.com/other", note: "Updated" } });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.url, "https://example.com/other");
    assert.equal((await s.api(`/handoff/targets/${added.json.id}`, { method: "PATCH", body: { url: "javascript:alert(1)" } })).status, 400);
    view = (await s.api("/handoff")).json;
    assert.equal(view.targets.find((t) => t.id === added.json.id).url, "https://example.com/other");
    assert.equal((await s.api(`/handoff/targets/${added.json.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/handoff")).json.targets.some((t) => t.id === added.json.id), false);
    assert.equal((await s.api("/handoff/targets/missing", { method: "DELETE" })).status, 404);

    const thread = "s-hand1";
    fs.writeFileSync(path.join(s.dir, "missions", thread + ".json"), JSON.stringify({
      id: thread, kind: "single", title: "Welcome", prompt: "Draft a welcome note",
      deliverable: `Hello. Ignore this ${secret}`, status: "done", startedAt: Date.now(),
      messages: [
        { role: "user", text: "Draft a welcome note" },
        { role: "assistant", text: `Hello. Ignore this ${secret}` },
      ],
    }));
    const built = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", threadId: thread, draft: "unused when the thread exists" } });
    assert.equal(built.status, 200);
    assert.match(built.json.prompt, /Summary:/);
    assert.match(built.json.prompt, /Draft a welcome note/);
    assert.match(built.json.prompt, /Recent turns:/);
    assert.match(built.json.prompt, /\[redacted\]/);
    assert.doesNotMatch(built.json.prompt, /HANDOFFSECRET/);
    assert.equal(built.json.clipboard, "not read");
    assert.equal(built.json.url, "https://chatgpt.com/");
    assert.ok(built.json.chars > 0 && built.json.chars <= built.json.maxChars);
    const gem = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "gemini", draft: "A short note" } });
    assert.equal(gem.status, 200);
    assert.equal(gem.json.gemini, true);
    assert.match(gem.json.geminiNotice, /Gemini free tier/);

    const sentinel = "CLIPBOARD_BEFORE_CLICK_SENTINEL";
    const early = await s.api("/handoff/reply", { method: "POST", body: { targetId: "chatgpt", threadId: thread, text: sentinel, confirm: false } });
    assert.equal(early.status, 400);
    const files = walk(s.dir, []);
    assert.equal(files.some(([, text]) => text.includes(sentinel)), false, "the clipboard text is not stored before confirm");
    assert.doesNotMatch(fs.readFileSync(path.join(s.dir, "handoff.registry.json"), "utf8"), /HANDOFFSECRET/);
    assert.doesNotMatch(s.log, new RegExp(sentinel));
    assert.doesNotMatch(s.log, /HANDOFFSECRET/);

    const saved = await s.api("/handoff/reply", { method: "POST", body: { targetId: "chatgpt", threadId: thread, text: "The shop opens at nine.", confirm: true } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.label, "via ChatGPT web, manual");
    assert.equal(saved.json.ledger.cost, 0);
    assert.equal(saved.json.ledger.manual, true);
    assert.equal(saved.json.ledger.usage.manual, true);
    assert.equal(saved.json.ledger.handoff, "ChatGPT");
    assert.equal(saved.json.ledger.model, "ChatGPT");
    const full = (await s.api(`/missions/${thread}`)).json;
    const reply = full.messages.at(-1);
    assert.equal(reply.manual, true);
    assert.equal(reply.tag, "via ChatGPT web, manual");
    assert.equal(reply.text, "The shop opens at nine.");
    assert.match(full.deliverable, /via ChatGPT web, manual/);
    const line = fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8").trim().split("\n").at(-1);
    const entry = JSON.parse(line);
    assert.equal(entry.cost, 0);
    assert.equal(entry.manual, true);
    assert.equal(entry.usage.manual, true);
    assert.equal(entry.handoff, "ChatGPT");
    assert.equal(entry.model, "ChatGPT");
    assert.equal(entry.role, "manual-handoff");
    assert.doesNotMatch(line, /opens at nine/);
    assert.doesNotMatch(s.log, /opens at nine/);
    assert.doesNotMatch(s.log, /HANDOFFSECRET/);
    const recent = (await s.api("/state")).json.recent;
    assert.ok(recent.some((e) => e.type === "log" && e.text === "Manual handoff saved (via ChatGPT web, manual)."));
    assert.equal(recent.some((e) => e.type === "log" && /opens at nine|HANDOFFSECRET/.test(e.text || "")), false);

    const key = "sk-test-handoff-not-a-real-key";
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key } })).status, 200);
    view = (await s.api("/handoff")).json;
    const gpt = view.targets.find((t) => t.id === "chatgpt");
    assert.equal(gpt.access.key, true);
    assert.equal(gpt.suggest, false, "a saved key hides Continue in");
    const t0 = Date.now();
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Say hi in four words.", provider: "openai", model: "gpt-test" } })).status, 202);
    const deadline = Date.now() + 30000;
    let run = null;
    while (Date.now() < deadline) {
      const st = (await s.api("/state")).json;
      run = st.missions.find((m) => m.kind === "single" && m.startedAt > t0 - 1 && m.status !== "running");
      if (run) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(run, "the refused chat finished");
    view = (await s.api("/handoff")).json;
    const stood = view.targets.find((t) => t.id === "chatgpt");
    assert.equal(stood.access.aside.kind, "key");
    assert.equal(stood.suggest, true, "Continue in comes back when fallback stands the provider aside");
    const reg = fs.readFileSync(path.join(s.dir, "handoff.registry.json"), "utf8");
    assert.doesNotMatch(reg, new RegExp(key));
    assert.doesNotMatch(reg, /javascript:/);
    assert.doesNotMatch(s.log, new RegExp(key));
  } finally {
    await s.stop();
    await new Promise((r) => mock.close(r));
  }
});

test("official sign-in is a boolean only; a token is not treated as signed in and is not returned", { timeout: 60000 }, async () => {
  const s = await startServer({
    env: { CC_STATUS_PAGES: "off", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "" },
    seed(dir) {
      fs.writeFileSync(path.join(dir, "handoff.signin.json"), JSON.stringify({ connected: { openai: true, xai: "ya29.SUPERSECRETTOKEN" } }));
    },
  });
  try {
    const view = (await s.api("/handoff")).json;
    const gpt = view.targets.find((t) => t.id === "chatgpt");
    const grok = view.targets.find((t) => t.id === "grok");
    assert.equal(gpt.access.key, false);
    assert.equal(gpt.access.officialSignIn, true);
    assert.equal(gpt.suggest, false);
    assert.equal(grok.access.officialSignIn, false);
    assert.equal(grok.suggest, true);
    assert.doesNotMatch(JSON.stringify(view), /SUPERSECRETTOKEN/);
    assert.doesNotMatch(s.log, /SUPERSECRETTOKEN/);
  } finally { await s.stop(); }
});
