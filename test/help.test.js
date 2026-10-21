// Help tab: bundled guides, Ask Meldmind from those guides, search when no AI is connected.
// A release fails when What's new lists a feature the updated help articles do not mention.
// No real key, no real URL, and the fake key must never show up in a response or the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { loadHelp, releaseHelpOk, pickHelpProvider, searchArticles } from "../server/help.js";
import { menuModel } from "../web/nav.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";
const KEY = "xai-helpTestKey000000000001";
const pkg = JSON.parse(read("package.json"));

const BLANK_KEYS = {
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
  CC_STATUS_PAGES: "off",
};

test("help catalog matches this version and What's new bullets have a matching article", () => {
  const pack = loadHelp();
  const news = JSON.parse(read("docs", "WHATS-NEW.json"));
  const gate = releaseHelpOk({ version: pkg.version, news, articles: pack.articles, catalog: pack.catalog });
  assert.equal(gate.ok, true, gate.problems.join("\n"));
  assert.equal(pack.catalog.lastUpdatedVersion, pkg.version);
  assert.ok(pack.articles.some((a) => a.lastUpdatedVersion === pkg.version));

  const joined = pack.articles.map((a) => `${a.title}\n${a.summary}\n${a.body}`).join("\n");
  for (const phrase of ["Getting started", "AQ.", "AIza", "Simple", "Expert", "council", "Approve", "handoff", "Licence", "license", "Check for updates", "SmartScreen", "antivirus", "Ask Meldmind", "Take the tour again"]) {
    assert.ok(joined.includes(phrase), phrase);
  }
  for (const file of fs.readdirSync(path.join(ROOT, "docs", "help"))) {
    assert.equal(read("docs", "help", file).includes(EM), false, file);
  }
  const missed = releaseHelpOk({
    version: "9.9.9",
    news: { "9.9.9": { bullets: ["A quantum knitting loom joins the council"] } },
    articles: pack.articles,
    catalog: { lastUpdatedVersion: "9.9.9" },
  });
  assert.equal(missed.ok, false);
  assert.match(missed.problems.join("\n"), /quantum knitting/);

  const stale = releaseHelpOk({ version: pkg.version, news, articles: pack.articles, catalog: { lastUpdatedVersion: "0.0.1" } });
  assert.equal(stale.ok, false);
});

test("search finds a guide, and a rejected key is not a connected AI", () => {
  const pack = loadHelp();
  const hits = searchArticles(pack.articles, "SmartScreen unsigned installer");
  assert.equal(hits[0].id, "troubleshooting");
  const providers = {
    "demo-nova": { id: "demo-nova", kind: "text", demo: true, models: [{ id: "demo", tier: "economy" }] },
    xai: { id: "xai", kind: "text", keyEnv: "XAI_API_KEY", models: [{ id: "big", tier: "flagship", default: true }, { id: "small", tier: "economy" }] },
  };
  assert.equal(pickHelpProvider(providers, { hasSecret: () => true, statusOf: () => ({ status: "red", detail: "Key rejected (401)" }) }), null);
  assert.deepEqual(
    pickHelpProvider(providers, { hasSecret: (id) => id === "xai", statusOf: () => ({ status: "green" }) }),
    { providerId: "xai", model: "small" },
  );
});

test("the Help tab is in Simple and Expert, and the installer keeps the articles", () => {
  const app = read("web", "app.js");
  const html = read("web", "index.html");
  const nav = read("web", "nav.js");
  const features = read("web", "perf", "registry.js");
  const help = read("web", "features", "help.js");
  const yml = read("electron-builder.yml");
  const releasing = read("docs", "RELEASING.md");
  assert.match(app, /f\.id !== "help"/);
  assert.match(html, /data-view="help"/);
  assert.match(nav, /buttonFor\(buttons, "help", "Help"\)/);
  const settingsMenu = menuModel(["command", "settings", "setup", "help"]).find((g) => g.id === "help");
  assert.ok(settingsMenu.items.some((i) => i.view === "help" && i.label === "Help"));
  assert.ok(settingsMenu.items.some((i) => i.action === "tour" && i.label === "Take the tour again"));
  assert.match(features, /"help"/);
  assert.match(help, /Ask Meldmind/);
  assert.match(help, /Take the tour again/);
  assert.match(help, /Check for updates/);
  assert.match(help, /\/help\/ask/);
  assert.match(yml, /docs\/help\/\*\*/);
  assert.match(releasing, /lastUpdatedVersion/);
  for (const t of [app, html, nav, help, releasing]) assert.equal(t.includes(EM), false);
});

test("Ask Meldmind searches when nothing is connected, and answers with a connected AI", async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, authorization: req.headers.authorization || "", body });
    const send = (code, payload, type = "application/json") => {
      res.writeHead(code, { "content-type": type });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    if (req.url.includes(KEY)) return send(500, { error: { message: "key leaked into the URL" } });
    if (req.url.includes("/models")) return send(200, { data: [{ id: "grok-build-0.1" }] });
    if (req.url.includes("/chat/completions")) {
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: "Paste the key in Settings." } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 6 } })}\n\ndata: [DONE]\n\n`;
      return send(200, payload, "text/event-stream");
    }
    send(404, { error: { message: "no route" } });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const s = await startServer({ env: { ...BLANK_KEYS, CC_BASE_URL_XAI: base } });
  try {
    const listed = await s.api("/help");
    assert.equal(listed.status, 200);
    assert.ok(listed.json.articles.some((a) => a.id === "api-keys" && a.body.includes("AQ.")));

    const offline = await s.api("/help/ask", { method: "POST", body: { question: "How do I get past SmartScreen?" } });
    assert.equal(offline.status, 200);
    assert.equal(offline.json.source, "search");
    assert.match(offline.json.answer, /search of the help articles/);
    assert.ok(offline.json.hits.some((h) => h.id === "troubleshooting"));
    assert.equal(seen.filter((x) => x.url.includes("/chat/completions")).length, 0);
    assert.equal(JSON.stringify(offline.json).includes(KEY), false);

    const empty = await s.api("/help/ask", { method: "POST", body: { question: "   " } });
    assert.equal(empty.status, 400);

    const saved = await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } });
    assert.equal(saved.json.status.status, "green", JSON.stringify(saved.json.status));
    assert.equal(JSON.stringify(saved.json).includes(KEY), false);

    const asked = await s.api("/help/ask", { method: "POST", body: { question: "Where do I paste a Gemini key?" } });
    assert.equal(asked.status, 200, asked.text);
    assert.equal(asked.json.source, "ai");
    assert.match(asked.json.answer, /Paste the key in Settings/);
    assert.equal(asked.json.provider, "xai");
    assert.ok(asked.json.hits.some((h) => h.id === "api-keys"));
    assert.equal(JSON.stringify(asked.json).includes(KEY), false);
    assert.equal(s.log.includes(KEY), false);
    const calls = seen.filter((x) => x.url.includes("/chat/completions"));
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /help excerpts/i);
    assert.match(calls[0].body, /Do not invent steps/);
  } finally {
    await s.stop();
    await new Promise((r) => srv.close(r));
  }
});
