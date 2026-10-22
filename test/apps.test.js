// App discovery: names only, a curated catalog, allow per app, score like a tool, suggest while planning.
// No real catalog URL, no file contents, no install.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { startServer, tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-apps-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const scan = await import("../server/app-scan.js");
const catalog = await import("../server/app-catalog.js");
const apps = await import("../server/apps.js");
const { rank, pick } = await import("../server/router.js");

const REG = [
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Git_is1",
  "    DisplayName    REG_SZ    Git",
  "    Publisher    REG_SZ    The Git Development Community",
  "",
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KB",
  "    DisplayName    REG_SZ    Security Update for Windows (KB5034441)",
  "",
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hide",
  "    DisplayName    REG_SZ    Hidden Helper",
  "    SystemComponent    REG_DWORD    0x1",
  "",
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Widget",
  "    DisplayName    REG_SZ    Widget Maker",
  "    Publisher    REG_SZ    Example",
  "",
].join("\r\n");

function fakeIo() {
  const reads = [];
  return {
    reads,
    platform: "win32",
    env: {
      PATH: "C:\\Tools",
      Path: "C:\\Tools",
      ProgramData: "C:\\ProgramData",
      APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    },
    regQuery() { return Promise.resolve(REG); },
    listDir(dir) {
      const d = String(dir).replace(/\\/g, "/");
      if (d.endsWith("Start Menu/Programs")) {
        return Promise.resolve([
          { name: "FFmpeg.lnk", directory: false },
          { name: "Notes.txt", directory: false },
          { name: "Suite", directory: true },
        ]);
      }
      if (d.endsWith("/Suite")) return Promise.resolve([{ name: "Blender.lnk", directory: false }]);
      if (d.endsWith("/Tools")) {
        return Promise.resolve([
          { name: "ffmpeg.exe", directory: false },
          { name: "noise.exe", directory: false },
          { name: "readme.txt", directory: false },
        ]);
      }
      return Promise.resolve([]);
    },
    isExecutable() { return Promise.resolve(true); },
    readFile() { reads.push("readFile"); throw new Error("file contents were read"); },
  };
}

const KDENLIVE = {
  id: "kdenlive",
  names: ["Kdenlive"],
  title: "Kdenlive",
  capabilities: ["creative"],
  price: "free",
  url: "https://kdenlive.org/",
  reason: "Edits a video timeline on this PC.",
  keywords: "kdenlive",
};

test("registry, Start menu, and PATH stay names only", async () => {
  const parsed = scan.parseRegUninstall(REG);
  assert.ok(parsed.some((row) => row.name === "Git" && row.source === "registry"));
  assert.equal(parsed.some((row) => /KB|Hidden|Security Update/i.test(row.name)), false);
  const io = fakeIo();
  const found = await scan.scanInstalled(io);
  assert.equal(io.reads.length, 0);
  assert.ok(found.some((row) => row.name === "FFmpeg" && row.source === "start-menu"));
  assert.ok(found.some((row) => row.name === "Blender" && row.source === "start-menu"));
  assert.ok(found.some((row) => row.name === "ffmpeg" && row.source === "path"));
  assert.equal(found.some((row) => row.name === "noise"), true);
  assert.equal(found.some((row) => /readme|Notes/i.test(row.name)), false);
  const src = fs.readFileSync(path.join(ROOT, "server", "app-scan.js"), "utf8");
  assert.doesNotMatch(src, /readFile/);
  assert.match(src, /reg query|regQuery/);
});

test("catalog matches names, refuses an installer, and merges an https list", async () => {
  const bundled = catalog.bundledCatalog();
  assert.equal(catalog.matchOne("FFmpeg 6.1", bundled).id, "ffmpeg");
  assert.equal(catalog.matchOne("Git", bundled).id, "git");
  assert.equal(catalog.matchOne("noise", bundled), null);
  for (const row of catalog.BUNDLED) {
    for (const key of ["install", "installer", "command", "script", "buy", "checkout"]) assert.equal(row[key], undefined);
    assert.equal(row.url.startsWith("https://"), true);
  }
  assert.throws(() => catalog.compileEntry({ ...KDENLIVE, install: "setup.exe" }), /installer or a purchase/);
  let called = false;
  await assert.rejects(catalog.pullCatalog("http://example.com/apps.json", async () => { called = true; return { ok: true }; }), /https/);
  assert.equal(called, false);
  let opts = null;
  const extra = await catalog.pullCatalog("https://catalog.example/apps.json", async (_url, options) => {
    opts = options;
    return { ok: true, headers: { get: () => null }, async text() { return JSON.stringify({ apps: [KDENLIVE] }); } };
  });
  assert.equal(opts.redirect, "error");
  assert.equal(opts.credentials, "omit");
  assert.equal(extra[0].id, "kdenlive");
  assert.equal(extra[0].keywords instanceof RegExp, true);
});

test("opt in, allow, score, suggest, and dismiss", async () => {
  process.env.CC_DEV_OWNER = "1";
  assert.deepEqual(apps.suggestFor("Trim the client video for the reel"), []);
  const state = await apps.optIn(true, fakeIo());
  assert.equal(state.optedIn, true);
  const titles = state.apps.map((row) => row.title);
  assert.ok(titles.includes("FFmpeg"));
  assert.ok(titles.includes("Git"));
  assert.ok(titles.includes("Blender"));
  assert.ok(titles.includes("Widget Maker"));
  assert.equal(titles.includes("noise"), false);
  assert.equal(titles.some((t) => /Security Update|Hidden Helper/i.test(t)), false);
  const dumped = JSON.stringify(apps.publicState(state));
  assert.equal(dumped.includes("C:\\Tools"), false);
  assert.equal(dumped.includes("readme"), false);
  const ffmpeg = state.apps.find((row) => row.id === "ffmpeg");
  assert.equal(ffmpeg.price, "free");
  assert.equal(ffmpeg.url, "https://ffmpeg.org/");
  assert.ok(ffmpeg.capabilities.includes("creative"));

  const video = "Trim the client video for the reel";
  let hits = apps.suggestFor(video);
  assert.equal(hits[0].id, "ffmpeg");
  assert.equal(hits[0].price, "Free");
  assert.equal(hits[0].url, "https://ffmpeg.org/");
  assert.match(hits[0].reason, /video/i);
  assert.equal(hits[0].installed, true);
  assert.equal(apps.suggestFor("video").length, 0);

  apps.dismissSuggestion("ffmpeg");
  hits = apps.suggestFor(video);
  assert.equal(hits.some((row) => row.id === "ffmpeg"), false);
  apps.setSuggestions(false);
  assert.deepEqual(apps.suggestFor(video), []);
  apps.setSuggestions(true);
  assert.ok(apps.suggestFor(video).length > 0);

  await apps.updateCatalog("https://catalog.example/apps.json", async () => ({
    ok: true,
    headers: { get: () => null },
    async text() { return JSON.stringify({ apps: [KDENLIVE] }); },
  }), fakeIo());
  const custom = apps.suggestFor("A creative kdenlive job for the client");
  assert.equal(custom.some((row) => row.id === "kdenlive" && row.price === "Free" && row.url === "https://kdenlive.org/"), true);

  apps.installAppRoutes();
  apps.setAllowed("ffmpeg", true);
  const shown = rank({ capability: "creative", difficulty: 2, mode: "balanced", includeApps: true });
  const app = shown.find((row) => row.kind === "app" && row.model === "app:ffmpeg");
  assert.ok(app, "allowed FFmpeg joins the router");
  assert.equal(app.quality, 90);
  assert.equal(app.score, 86.5);
  assert.equal(app.name, "FFmpeg");
  const plain = rank({ capability: "creative", difficulty: 2, mode: "balanced" });
  assert.equal(plain.some((row) => row.kind === "app"), false);
  assert.notEqual(pick({ capability: "creative", difficulty: 2, mode: "balanced" })?.kind, "app");
  await apps.optIn(false, fakeIo());
  assert.deepEqual(apps.suggestFor(video), []);
  assert.equal(rank({ capability: "creative", includeApps: true }).some((row) => row.kind === "app"), false);
});

test("routes: scan a tiny PATH, suggest, score, and refuse http", async () => {
  const dir = tmpDir("cc-apps-http-");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  // Windows only lists .exe, .cmd, .bat, and .com on PATH. Linux lists an executable with no extension.
  const exe = process.platform === "win32" ? ".exe" : "";
  fs.writeFileSync(path.join(bin, `ffmpeg${exe}`), "");
  fs.chmodSync(path.join(bin, `ffmpeg${exe}`), 0o755);
  fs.writeFileSync(path.join(bin, `zznoise${exe}`), "");
  fs.chmodSync(path.join(bin, `zznoise${exe}`), 0o755);
  fs.writeFileSync(path.join(bin, "readme.txt"), "secret words that must stay unread");
  // Node on Windows keeps Path and PATH as separate keys. Set both so the scan sees this folder.
  const s = await startServer({ env: { PATH: bin, Path: bin, CC_DEV_OWNER: "1" }, dataDir: dir });
  try {
    const before = await s.api("/apps");
    assert.equal(before.status, 200);
    assert.equal(before.json.optedIn, false);
    assert.equal(before.json.suggestions, true);
    assert.deepEqual(await (await s.api(`/apps/suggestions?prompt=${encodeURIComponent("Trim the client video for the reel")}`)).json, []);
    const on = await s.api("/apps/opt-in", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.optedIn, true);
    assert.equal(JSON.stringify(on.json).includes("secret words"), false);
    assert.ok(on.json.apps.some((row) => row.id === "ffmpeg" && row.allowed === false));
    assert.equal(on.json.apps.some((row) => row.id === "zznoise" || row.title === "zznoise"), false);
    const sug = await s.api(`/apps/suggestions?prompt=${encodeURIComponent("Trim the client video for the reel")}`);
    assert.equal(sug.json[0].id, "ffmpeg");
    assert.equal(sug.json[0].price, "Free");
    assert.equal(sug.json[0].url, "https://ffmpeg.org/");
    await s.api("/apps/dismiss", { method: "POST", body: { id: "ffmpeg" } });
    const hidden = await s.api(`/apps/suggestions?prompt=${encodeURIComponent("Trim the client video for the reel")}`);
    assert.equal(hidden.json.some((row) => row.id === "ffmpeg"), false);
    const off = await s.api("/apps/settings", { method: "POST", body: { suggestions: false } });
    assert.equal(off.json.suggestions, false);
    assert.deepEqual((await s.api(`/apps/suggestions?prompt=${encodeURIComponent("Trim the client video for the reel")}`)).json, []);
    await s.api("/apps/settings", { method: "POST", body: { suggestions: true } });
    const allowed = await s.api("/apps/allow", { method: "POST", body: { id: "ffmpeg", allowed: true } });
    assert.equal(allowed.json.apps.find((row) => row.id === "ffmpeg").allowed, true);
    const route = await s.api(`/route?prompt=${encodeURIComponent("Trim the client video for the reel")}`);
    assert.equal(route.status, 200);
    assert.equal(route.json.ranked.some((row) => row.kind === "app"), false);
    const routed = route.json.apps.find((row) => row.model === "app:ffmpeg");
    assert.ok(routed);
    assert.equal(typeof routed.score, "number");
    assert.equal(routed.quality, 90);
    const bad = await s.api("/apps/catalog", { method: "POST", body: { url: "http://example.com/apps.json" } });
    assert.equal(bad.status, 400);
    const stopped = await s.api("/apps/opt-in", { method: "POST", body: { on: false } });
    assert.equal(stopped.json.optedIn, false);
    assert.equal((await s.api("/state")).json.plugins.includes("apps"), true);
  } finally { await s.stop(); }
});

test("Free cannot scan or allow a program", async () => {
  const prev = process.env.CC_DEV_OWNER;
  delete process.env.CC_DEV_OWNER;
  try {
    await assert.rejects(() => apps.optIn(true, fakeIo()), (err) => err.status === 402 && /Program scan is part of Pro/.test(err.message));
    assert.deepEqual(apps.suggestFor("Trim the client video for the reel"), []);
    const s = await startServer();
    try {
      const view = await s.api("/apps");
      assert.equal(view.status, 200);
      assert.equal(view.json.pro, false);
      const denied = await s.api("/apps/opt-in", { method: "POST", body: { on: true } });
      assert.equal(denied.status, 402);
      assert.match(denied.json.error, /Program scan is part of Pro/);
      const off = await s.api("/apps/opt-in", { method: "POST", body: { on: false } });
      assert.equal(off.status, 200);
      assert.equal(off.json.optedIn, false);
    } finally { await s.stop(); }
  } finally { if (prev) process.env.CC_DEV_OWNER = prev; }
});

test("user-facing copy has no em dash and no install button", () => {
  const files = [
    "server/app-scan.js", "server/app-catalog.js", "server/apps.js", "server/plugins/apps.js",
    "web/features/apps.js", "docs/help/desktop-apps.md", "docs/USER-GUIDE.md", "docs/roadmap.md", "docs/WHATS-NEW.json",
  ];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "apps.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(ui, /will not install or buy/);
  assert.match(app, /Let Meldmind use your desktop/);
  assert.match(app, /id="su-desktop"/);
  assert.match(app, /id="su-apps"/);
  assert.doesNotMatch(ui, /<button[^>]*>\s*Install/i);
  assert.doesNotMatch(ui, /auto-install/i);
  const tour = fs.readFileSync(path.join(ROOT, "web", "features", "tour.js"), "utf8");
  assert.match(tour, /Programs on this PC/);
  assert.match(tour, /Nothing is installed or bought/);
  const news = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "WHATS-NEW.json"), "utf8"));
  assert.ok(news["0.4.9"].bullets.some((b) => /Free or Paid/.test(b)));
  assert.ok(news["0.4.8"].bullets.some((b) => /Nova, Atlas and Sage/.test(b)));
  const plan = fs.readFileSync(path.join(ROOT, "docs", "BUILD-PLAN.md"), "utf8");
  assert.match(plan, /Do last: 14,/);
  assert.match(plan, /Phases 45 to 51 use fixture drivers/);
  const help = fs.readFileSync(path.join(ROOT, "docs", "help", "desktop-apps.md"), "utf8");
  assert.match(help, /lastUpdatedVersion: 0\.4\.9/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.4.15");
  const catalogJson = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "help", "catalog.json"), "utf8"));
  assert.equal(catalogJson.lastUpdatedVersion, "0.4.15");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ZAP_TOKEN = "zap-test-token-not-real";
const MAKE_TOKEN = "make-test-token-not-real";
const HOOK_SECRET = "hook-test-secret-not-real";
const MAKE_HOOK_SECRET = "make-hook-secret-not-real";
const GROQ_KEY = "gsk_apps_test_key_0001";
const NO_DASH = /—/;

const { connectionLimit, limitMessage, PRO_APP_CONNECTIONS } = await import("../server/feature-gate.js");
const { riskyAction } = await import("../server/action-policy.js");
const { takeTokenFromUrl, looksLikeMakeHook, normalizeSchema, GUIDE, ZAPIER_MCP_URL, MAKE_OAUTH_URL } = await import("../server/apps.js");

test("connection gate: Free 1, Pro and Studio several (5), Extreme and Owner unlimited", () => {
  assert.equal(PRO_APP_CONNECTIONS, 5);
  assert.equal(connectionLimit("free"), 1);
  assert.equal(connectionLimit(""), 1);
  assert.equal(connectionLimit("pro"), 5);
  assert.equal(connectionLimit("studio"), 5);
  assert.equal(connectionLimit("extreme"), Infinity);
  assert.equal(connectionLimit("OWNER"), Infinity);
  assert.match(limitMessage(1), /Free includes 1 app connection\. Pro includes several \(5\)\. Extreme is unlimited\./);
  assert.match(limitMessage(5), /This plan includes 5 app connections\. Extreme is unlimited\./);
  assert.doesNotMatch(limitMessage(1), NO_DASH);
});

test("risky actions wait for Allow: send, post, charge, pay, delete, and Zapier writes", () => {
  assert.equal(riskyAction({ name: "lookup", description: "Find a row" }), false);
  assert.equal(riskyAction({ name: "list_files", description: "post the files somewhere" }), false);
  assert.equal(riskyAction({ name: "execute_zapier_read_action", description: "send it" }), false);
  assert.equal(riskyAction({ name: "execute_zapier_write_action" }), true);
  assert.equal(riskyAction({ name: "send_mail", annotations: { readOnlyHint: true } }), true);
  assert.equal(riskyAction({ name: "charge_card", description: "read the receipt" }), true);
  assert.equal(riskyAction({ name: "publish_post" }), true);
  assert.equal(riskyAction({ name: "pay_invoice" }), true);
  assert.equal(riskyAction({ name: "delete_row" }), true);
  assert.equal(riskyAction({ name: "lookup_then_send" }), true);
});

test("pasted addresses: token query and Make /mcp/u/ go to the vault, not the stored URL", () => {
  const z = takeTokenFromUrl(`https://mcp.zapier.com/api/v1/connect?token=${ZAP_TOKEN}`);
  assert.equal(z.token, ZAP_TOKEN);
  assert.equal(z.url.includes("token="), false);
  assert.match(z.url, /^https:\/\/mcp\.zapier\.com\/api\/v1\/connect\/?$/);
  const m = takeTokenFromUrl(`https://eu1.make.com/mcp/u/${MAKE_TOKEN}`);
  assert.equal(m.token, MAKE_TOKEN);
  assert.equal(m.url, "https://eu1.make.com/mcp/stateless");
  assert.throws(() => takeTokenFromUrl("https://user:secret@mcp.zapier.com/api/v1/connect"), /token box/);
  assert.throws(() => takeTokenFromUrl("not a url"), /http/);
  assert.equal(looksLikeMakeHook("https://hook.make.com/abc"), true);
  assert.equal(looksLikeMakeHook("https://hook.eu2.make.com/abc"), true);
  assert.equal(looksLikeMakeHook("https://mcp.make.com"), false);
  assert.equal(looksLikeMakeHook("https://example.com/hook.make.com"), false);
  assert.deepEqual(normalizeSchema(""), { type: "object", properties: {} });
  assert.deepEqual(normalizeSchema('{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}').required, ["q"]);
  assert.throws(() => normalizeSchema("{"), /JSON/);
  assert.equal(ZAPIER_MCP_URL, "https://mcp.zapier.com/api/v1/connect");
  assert.equal(MAKE_OAUTH_URL, "https://mcp.make.com");
  for (const text of Object.values(GUIDE)) assert.doesNotMatch(text, NO_DASH);
});

test("Meldmind webhook template and the setup copy have no token and no em-dash", () => {
  const raw = read("docs/integrations/meldmind-webhook.json");
  const tpl = JSON.parse(raw);
  assert.equal(tpl.name, "Meldmind");
  assert.match(tpl.request.url, /\/api\/hooks\/meldmind$/);
  assert.match(tpl.request.headers.Authorization, /\{\{MELDMIND_TOKEN\}\}/);
  assert.equal(tpl.request.examples.map((e) => e.kind).join(","), "chat,council,mission");
  assert.match(raw, /The token is shown once/);
  assert.doesNotMatch(raw, NO_DASH);
  assert.doesNotMatch(raw, /gsk_|sk-|Bearer [A-Za-z0-9_-]{20,}/);
  const help = read("docs/help/zapier-make.md");
  const ui = read("web/features/apps.js");
  assert.match(help, /More > Connections > Zapier and Make/);
  assert.match(ui, /Connect Zapier/);
  assert.match(ui, /Connect Make/);
  assert.doesNotMatch(read("web/app.js"), /cc-zapier-slot/);
  assert.match(ui, /Create the Meldmind webhook/);
  assert.match(read("docs/USER-GUIDE.md"), /Zapier and Make/);
  assert.match(read("README.md"), /Zapier and Make/);
  for (const file of ["docs/help/zapier-make.md", "docs/USER-GUIDE.md", "web/features/apps.js", "server/apps.js", "server/plugins/apps.js"]) {
    assert.doesNotMatch(read(file), NO_DASH, file);
  }
});

const TOOLS = [
  { name: "lookup", description: "Look up a record", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "send_mail", description: "Send a message", inputSchema: { type: "object", properties: { to: { type: "string" }, body: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "execute_zapier_read_action", description: "Run a Zapier read", inputSchema: { type: "object", properties: {} } },
  { name: "execute_zapier_write_action", description: "Run a Zapier write", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
];

function rpcAnswer(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "mock-zap", version: "0.1" } } };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    if (params.name === "lookup") return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Found: ${params.arguments?.q || "row"}` }] } };
    if (params.name === "send_mail") return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Sent to ${params.arguments?.to}` }] } };
    if (params.name === "execute_zapier_read_action") return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "read-ok" }] } };
    if (params.name === "execute_zapier_write_action") return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "write-ok" }] } };
    return { jsonrpc: "2.0", id, error: { code: -32602, message: "unknown tool" } };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } };
}

async function mockMcp(bearer) {
  const allowed = new Set((Array.isArray(bearer) ? bearer : bearer ? [bearer] : []).map((t) => `Bearer ${t}`));
  const seen = { posts: [], auth: [] };
  const sessions = new Set();
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = "";
    for await (const c of req) body += c;
    seen.auth.push(req.headers.authorization || null);
    const send = (code, j, headers = {}) => { res.writeHead(code, { "content-type": "application/json", connection: "close", ...headers }); res.end(JSON.stringify(j)); };
    if (allowed.size && !allowed.has(req.headers.authorization || "")) return send(401, { error: "unauthorized" });
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/stateless") return send(404, { error: "no route" });
    if (req.method === "DELETE") { sessions.delete(req.headers["mcp-session-id"]); res.writeHead(204, { connection: "close" }); return res.end(); }
    if (req.method !== "POST") return send(405, {});
    const msg = JSON.parse(body);
    seen.posts.push({ path: url.pathname, msg });
    if (msg.method === "initialize") {
      const sid = "sess-apps";
      sessions.add(sid);
      return send(200, rpcAnswer(msg), { "mcp-session-id": sid });
    }
    if (!sessions.has(req.headers["mcp-session-id"])) return send(404, { error: "no session" });
    if (msg.id === undefined) { res.writeHead(202, { connection: "close" }); return res.end(); }
    return send(200, rpcAnswer(msg));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, seen, close: () => new Promise((r) => srv.close(r)) };
}

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
function reply(res, text) {
  return sse(res, [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5 } }]);
}
async function mockModel() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (req.url.endsWith("/v1/models")) return send(200, { data: [{ id: "openai/gpt-oss-120b" }] });
    if (!req.url.endsWith("/chat/completions")) return send(404, {});
    const j = JSON.parse(body);
    seen.push(j);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    if (/chief of staff/i.test(sys)) {
      return reply(res, JSON.stringify({
        title: "Lookup plan",
        tasks: [{ id: "t1", title: "Look it up", capability: "research", difficulty: 1, needWeb: false, deps: [], instructions: "Use lookup for the name.", deliverable: "The found line" }],
        assembly: "Use the lookup result.",
      }));
    }
    if (/You chair a council/i.test(sys)) return reply(res, "Council verdict: the shorter headline wins.");
    if (/assemble the final deliverable/i.test(sys)) return reply(res, "Mission deliverable: lookup finished.");
    if (/Classify the user's request/i.test(sys) || /JSON only/i.test(sys)) return reply(res, '{"capability":"research","difficulty":1,"needWeb":false,"summary":"mock"}');
    const toolMsgs = j.messages.filter((m) => m.role === "tool");
    if (j.tools?.length && !toolMsgs.length) {
      const wanted = j.tools.filter((t) => new RegExp(`\\b${t.function.name.split("__").pop()}\\b`, "i").test(user));
      if (wanted.length) {
        const calls = wanted.map((t, i) => ({ index: i, id: `call_${i}`, type: "function", function: { name: t.function.name, arguments: "" } }));
        const frag = (i, s) => ({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: s } }] } }] });
        return sse(res, [
          { choices: [{ delta: { content: "Let me check. " } }] },
          { choices: [{ delta: { tool_calls: calls } }] },
          ...wanted.flatMap((t, i) => {
            const a = JSON.stringify(/send_mail/.test(t.function.name) ? { to: "x@y.z", body: "hi" } : { q: "row" });
            return [frag(i, a.slice(0, 3)), frag(i, a.slice(3))];
          }),
          { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 10 } },
        ]);
      }
    }
    const text = toolMsgs.length ? `Tool said: ${toolMsgs.map((m) => m.content).join(" | ")}` : "No tool needed.";
    return reply(res, text);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

async function mockHook() {
  const hits = [];
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    hits.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null, apiKey: req.headers["x-make-apikey"] || null, body });
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ ok: true, echo: "hook-ok" }));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, hits, close: () => new Promise((r) => srv.close(r)) };
}

async function waitRun(s, pred, label, ms = 60000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    const st = (await s.api("/state")).json;
    const hit = pred(st);
    if (hit) return hit;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}\n${s.log.split("\n").slice(-30).join("\n")}`);
}
const finished = (kind, after) => (st) => st.missions.find((m) => m.kind === kind && m.startedAt > after && ["done", "done-with-errors", "failed"].includes(m.status));
async function waitPending(s, ms = 20000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    const v = (await s.api("/tools")).json;
    if (v.pending.length) return v.pending[0];
    await sleep(200);
  }
  throw new Error("no approval request appeared");
}

function absent(text, secret, label) {
  assert.equal(String(text).includes(secret), false, `${label} leaked`);
}

async function pollHook(s, token, first) {
  if (first.status !== 202) return first;
  assert.ok(first.json.poll, "a running reply names the poll address");
  const t0 = Date.now();
  let g = first;
  while (Date.now() - t0 < waitBudget(70000)) {
    g = await s.raw({
      method: "GET", path: first.json.poll,
      headers: { authorization: `Bearer ${token}`, host: "tunnel.example" },
      timeout: 15000,
    });
    if (g.status === 200 && !["running", "planning", "assembling"].includes(g.json?.status)) return g;
    await sleep(300);
  }
  throw new Error(`inbound run did not finish: ${g.text}`);
}

async function hookCall(s, token, body) {
  const r = await s.raw({
    method: "POST", path: "/api/hooks/meldmind",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, host: "tunnel.example" },
    body, timeout: waitBudget(70000),
  });
  return pollHook(s, token, r);
}

test("Free: one app connection, a second remote is refused, local and demo tools are not counted, a mission webhook is refused", async () => {
  const mcp = await mockMcp(null);
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    assert.ok((await s.api("/state")).json.plugins.includes("apps"));
    assert.equal((await s.api("/apps", { noToken: true })).status, 401);
    let view = (await s.api("/apps")).json;
    assert.equal(view.gate.tier, "free");
    assert.equal(view.gate.limit, 1);
    assert.equal(view.gate.used, 0);
    assert.match(view.guide.simple, /Connect Zapier/);
    assert.equal(view.presets.zapier, ZAPIER_MCP_URL);

    const remote = await s.api("/tools/servers", { method: "POST", body: { name: "Loose MCP", transport: "http", url: `${mcp.base}/mcp` } });
    assert.equal(remote.status, 200, JSON.stringify(remote.json));
    assert.equal(remote.json.ok, true, remote.json.error);
    view = (await s.api("/apps")).json;
    assert.equal(view.gate.used, 1, "an unlinked remote MCP counts");
    const blocked = await s.api("/apps/webhook", { method: "POST", body: { name: "Blocked", url: `${mcp.base}/hook` } });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.json.code, "app_connection_limit");
    assert.match(blocked.json.error, /Free includes 1 app connection/);

    const stdio = await s.api("/tools/servers", { method: "POST", body: { name: "Local only", transport: "stdio", command: "definitely-not-a-program-xyz" } });
    assert.notEqual(stdio.status, 402);
    assert.equal((await s.api("/apps")).json.gate.used, 1, "a local command is not an app connection");
    const demo = await s.api("/tools/demo", { method: "POST", body: {} });
    assert.notEqual(demo.status, 402, JSON.stringify(demo.json));
    assert.equal((await s.api("/apps")).json.gate.used, 1, "demo tools are not an app connection");

    await s.api(`/tools/servers/${remote.json.server.id}`, { method: "DELETE" });
    assert.equal((await s.api("/apps")).json.gate.used, 0);
    const first = await s.api("/apps/webhook", { method: "POST", body: { name: "Only one", url: `${mcp.base}/only` } });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const second = await s.api("/apps/mcp", { method: "POST", body: { name: "Second", url: `${mcp.base}/mcp` } });
    assert.equal(second.status, 402);

    const made = await s.api("/apps/inbound", { method: "POST", body: {} });
    assert.equal(made.status, 200);
    const token = made.json.token;
    assert.ok(token);
    absent(JSON.stringify({ ...made.json, token: undefined }), token, "create response aside from the one-time field");
    const again = await s.api("/apps");
    absent(JSON.stringify(again.json), token, "later view");
    const stored = fs.readFileSync(path.join(s.dir, "apps.inbound.json"), "utf8");
    absent(stored, token, "inbound file");
    assert.match(stored, /"hash":/);
    const bare = await s.raw({ method: "POST", path: "/api/hooks/meldmind", headers: { "content-type": "application/json", host: "tunnel.example" }, body: { kind: "chat", prompt: "hi" } });
    assert.equal(bare.status, 401);
    assert.equal(bare.json.error, "token not recognised");
    const mission = await s.raw({
      method: "POST", path: "/api/hooks/meldmind",
      headers: { "content-type": "application/json", host: "tunnel.example", authorization: `Bearer ${token}` },
      body: { kind: "mission", goal: "Do a job" },
    });
    assert.equal(mission.status, 402, mission.text);
    assert.equal(mission.json.code, "pro_required");
    const pinned = await s.raw({ path: "/api/apps", headers: { host: "tunnel.example", "x-cc-token": s.token } });
    assert.equal(pinned.status, 421, "other routes keep the Host pin");
  } finally {
    await s.stop();
    await mcp.close();
  }
});

test("Pro includes 5 app connections and the sixth is refused", async () => {
  const s = await startServer({
    env: { CC_STATUS_PAGES: "off" },
    cloud: { rpc: (fn) => (fn === "verify_license" ? { ok: true, tier: "pro", status: "active", email: "t@example.com", period_end: null, message: "ok" } : { ok: false }) },
  });
  try {
    const lic = await s.api("/license", { method: "POST", body: { key: "EVB-APPS-PRO-0001" } });
    assert.equal(lic.json.tier, "pro", lic.text);
    for (let i = 1; i <= 5; i++) {
      const r = await s.api("/apps/webhook", { method: "POST", body: { name: `Hook ${i}`, url: `http://127.0.0.1:9/hook-${i}` } });
      assert.equal(r.status, 200, r.text);
    }
    const view = (await s.api("/apps")).json;
    assert.equal(view.gate.tier, "pro");
    assert.equal(view.gate.limit, 5);
    assert.equal(view.gate.used, 5);
    assert.equal(view.gate.remaining, 0);
    const sixth = await s.api("/apps/webhook", { method: "POST", body: { name: "Hook 6", url: "http://127.0.0.1:9/hook-6" } });
    assert.equal(sixth.status, 402);
    assert.match(sixth.json.error, /5 app connections/);
  } finally { await s.stop(); }
});

test("an active Extreme licence row is unlimited in the app gate and does not unlock the rest of the product", async () => {
  const s = await startServer({
    env: { CC_STATUS_PAGES: "off" },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
      key: null, tier: "extreme", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(),
    })),
  });
  try {
    const state = (await s.api("/state")).json;
    assert.equal(state.license.tier, "extreme", "an active Extreme licence is Extreme");
    for (let i = 1; i <= 6; i++) {
      const r = await s.api("/apps/webhook", { method: "POST", body: { name: `Extra ${i}`, url: `http://127.0.0.1:9/x-${i}` } });
      assert.equal(r.status, 200, r.text);
    }
    const view = (await s.api("/apps")).json;
    assert.equal(view.gate.tier, "extreme");
    assert.equal(view.gate.unlimited, true);
    assert.equal(view.gate.limit, null);
    assert.equal(view.gate.used, 6);
  } finally { await s.stop(); }
});

test("Zapier and Make actions, webhook tools, and the inbound webhook", async () => {
  const mcp = await mockMcp([ZAP_TOKEN, MAKE_TOKEN]);
  const hook = await mockHook();
  const model = await mockModel();
  const s = await startServer({
    env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_GROQ: `${model.base}/v1`, GROQ_API_KEY: "" },
  });
  try {
    const key = await s.api("/keys", { method: "POST", body: { provider: "groq", key: GROQ_KEY } });
    assert.equal(key.json.status.status, "green", key.text);

    const zap = await s.api("/apps/zapier", { method: "POST", body: { url: `${mcp.base}/mcp?token=${ZAP_TOKEN}`, name: "Zapier" } });
    assert.equal(zap.status, 200, zap.text);
    assert.equal(zap.json.ok, true, zap.json.error);
    assert.equal(zap.json.connection.url.includes("token="), false);
    assert.equal(zap.json.connection.url, `${mcp.base}/mcp`);
    const byName = Object.fromEntries(zap.json.connection.actions.map((a) => [a.name, a]));
    assert.equal(byName.lookup.needsApproval, false);
    assert.equal(byName.send_mail.needsApproval, true, "a send asks even when the server marks it read only");
    assert.equal(byName.execute_zapier_read_action.needsApproval, false);
    assert.equal(byName.execute_zapier_write_action.needsApproval, true);
    absent(JSON.stringify(zap.json), ZAP_TOKEN, "zapier response");
    absent(s.log, ZAP_TOKEN, "zapier log");
    assert.ok(mcp.seen.auth.some((a) => a === `Bearer ${ZAP_TOKEN}`), "the token was sent as a header");
    assert.equal((await s.api("/apps")).json.gate.used, 1, "the Zapier row and its MCP server count once");

    let t0 = Date.now();
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Please lookup the row", provider: "groq", model: "openai/gpt-oss-120b" } })).status, 202);
    let run = await waitRun(s, finished("single", t0 - 1), "lookup chat");
    let full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error || full.deliverable);
    assert.equal(full.toolCalls.some((c) => c.tool === "lookup" && c.ok && !c.denied), true);
    assert.equal(mcp.seen.posts.some((p) => p.msg.method === "tools/call" && p.msg.params.name === "lookup"), true);
    assert.equal((await s.api("/tools")).json.pending.length, 0);

    const writesBefore = mcp.seen.posts.filter((p) => p.msg.method === "tools/call" && p.msg.params?.name === "send_mail").length;
    t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "please send_mail now", provider: "groq", model: "openai/gpt-oss-120b" } });
    const ask = await waitPending(s);
    assert.equal(ask.tool, "send_mail");
    await sleep(800);
    const writesMid = mcp.seen.posts.filter((p) => p.msg.method === "tools/call" && p.msg.params?.name === "send_mail").length;
    assert.equal(writesMid, writesBefore, "nothing is sent until Allow");
    assert.equal((await s.api(`/tools/approvals/${ask.id}`, { method: "POST", body: { allow: true } })).json.allowed, true);
    run = await waitRun(s, finished("single", t0 - 1), "send chat");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.toolCalls.some((c) => c.tool === "send_mail" && c.ok), true);
    assert.equal(mcp.seen.posts.filter((p) => p.msg.method === "tools/call" && p.msg.params?.name === "send_mail").length, writesBefore + 1);

    const make = await s.api("/apps/make", { method: "POST", body: { url: `${mcp.base}/mcp/u/${MAKE_TOKEN}`, token: MAKE_TOKEN, name: "Make" } });
    assert.equal(make.status, 200, make.text);
    assert.equal(make.json.connection.url, `${mcp.base}/mcp/stateless`);
    assert.equal(make.json.ok, true, make.json.error);
    absent(JSON.stringify(make.json), MAKE_TOKEN, "make response");
    absent(s.log, MAKE_TOKEN, "make log");

    const scenario = await s.api("/apps/make", { method: "POST", body: { mode: "webhook", name: "Scenario", url: `${hook.base}/scenario`, token: MAKE_HOOK_SECRET } });
    assert.equal(scenario.status, 200, scenario.text);
    assert.equal(scenario.json.connection.kind, "make");
    assert.equal(scenario.json.connection.headerName, "x-make-apikey");
    absent(JSON.stringify(scenario.json), MAKE_HOOK_SECRET, "scenario response");
    const called = await s.api(`/apps/${scenario.json.connection.id}/call`, { method: "POST", body: { args: { topic: "draft" } } });
    assert.equal(called.json.ok, true, called.text);
    assert.match(called.json.text, /hook-ok/);
    assert.equal(hook.hits.at(-1).apiKey, MAKE_HOOK_SECRET);
    absent(called.text, MAKE_HOOK_SECRET, "manual call");
    absent(s.log, MAKE_HOOK_SECRET, "scenario log");

    const tool = await s.api("/apps/webhook", {
      method: "POST",
      body: { name: "notify_team", url: `${hook.base}/notify`, headerName: "Authorization", headerValue: HOOK_SECRET, schema: '{"type":"object","properties":{"q":{"type":"string"}}}' },
    });
    assert.equal(tool.status, 200, tool.text);
    absent(JSON.stringify(tool.json), HOOK_SECRET, "webhook response");
    const quiet = await s.api("/apps/webhook", { method: "POST", body: { name: "lookup_status", url: `${hook.base}/status`, readOnly: true } });
    const loud = await s.api("/apps/webhook", { method: "POST", body: { name: "send_digest", url: `${hook.base}/digest`, readOnly: true } });
    assert.equal(quiet.json.connection.readOnly, true);
    assert.equal(loud.json.connection.readOnly, false, "a send still asks when marked read only");
    const enabled = (await s.api("/tools/enabled")).json.tools;
    assert.equal(enabled.find((t) => t.tool === "notify_team").needsApproval, true);
    assert.equal(enabled.find((t) => t.tool === "lookup_status").needsApproval, false);
    assert.equal(enabled.find((t) => t.tool === "send_digest").needsApproval, true);

    const hitsBefore = hook.hits.length;
    t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "please notify_team about the row", provider: "groq", model: "openai/gpt-oss-120b" } });
    const hold = await waitPending(s);
    assert.equal(hold.tool, "notify_team");
    await sleep(800);
    assert.equal(hook.hits.length, hitsBefore, "the webhook is not called until Allow");
    await s.api(`/tools/approvals/${hold.id}`, { method: "POST", body: { allow: true } });
    run = await waitRun(s, finished("single", t0 - 1), "webhook chat");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.match(full.deliverable, /hook-ok/);
    const sent = hook.hits.find((h) => h.url === "/notify");
    assert.ok(sent);
    assert.equal(sent.authorization, `Bearer ${HOOK_SECRET}`);
    absent(JSON.stringify(full), HOOK_SECRET, "chat deliverable");
    absent(s.log, HOOK_SECRET, "webhook log");

    const inbound = await s.api("/apps/inbound", { method: "POST", body: {} });
    const token = inbound.json.token;
    const tpl = await s.api("/apps/template");
    assert.equal(tpl.json.template.name, "Meldmind");
    absent(JSON.stringify(tpl.json), token, "template");
    const early = await s.raw({
      method: "POST", path: "/api/hooks/meldmind",
      headers: { "content-type": "application/json", "x-meldmind-token": token, host: "tunnel.example" },
      body: { kind: "chat", prompt: "Say hello from the tunnel", provider: "groq", model: "openai/gpt-oss-120b", waitMs: 0 },
      timeout: 15000,
    });
    assert.equal(early.status, 202, early.text);
    const chat = await pollHook(s, token, early);
    assert.equal(chat.status, 200, chat.text);
    assert.match(chat.json.text, /No tool needed/);
    assert.equal(chat.json.kind, "chat");

    const mission = await hookCall(s, token, { kind: "mission", goal: "Look something up", search: false, qa: false });
    assert.equal(mission.status, 200, mission.text);
    assert.equal(mission.json.kind, "mission");
    assert.match(mission.json.text, /Mission deliverable/);
    assert.equal(mission.json.toolCalls.some((c) => c.tool === "lookup" && c.ok), true);

    const council = await s.raw({
      method: "POST", path: `/api/hooks/meldmind?t=${encodeURIComponent(token)}`,
      headers: { "content-type": "application/json", host: "tunnel.example" },
      body: { kind: "council", prompt: "Which headline is stronger?", search: false },
      timeout: waitBudget(70000),
    });
    const councilDone = await pollHook(s, token, council);
    assert.equal(councilDone.status, 200, councilDone.text);
    assert.equal(councilDone.json.kind, "council");
    assert.match(councilDone.json.text, /Council verdict/);
    absent(s.log, token, "inbound token log");
    absent(fs.readFileSync(path.join(s.dir, "apps.inbound.json"), "utf8"), token, "inbound file");
  } finally {
    await s.stop();
    await mcp.close();
    await hook.close();
    await model.close();
  }
});