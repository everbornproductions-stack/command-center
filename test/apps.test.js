// App discovery: names only, a curated catalog, allow per app, score like a tool, suggest while planning.
// No real catalog URL, no file contents, no install.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

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
  fs.writeFileSync(path.join(bin, "ffmpeg"), "");
  fs.chmodSync(path.join(bin, "ffmpeg"), 0o755);
  fs.writeFileSync(path.join(bin, "zznoise"), "");
  fs.chmodSync(path.join(bin, "zznoise"), 0o755);
  fs.writeFileSync(path.join(bin, "readme.txt"), "secret words that must stay unread");
  const s = await startServer({ env: { PATH: bin, CC_DEV_OWNER: "1" }, dataDir: dir });
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
  assert.match(news["0.4.8"].bullets[1], /Nova, Atlas and Sage/);
  const plan = fs.readFileSync(path.join(ROOT, "docs", "BUILD-PLAN.md"), "utf8");
  assert.match(plan, /Do last: 14,/);
  assert.match(plan, /Phases 45 to 51 use fixture drivers/);
  const help = fs.readFileSync(path.join(ROOT, "docs", "help", "desktop-apps.md"), "utf8");
  assert.match(help, /lastUpdatedVersion: 0\.4\.9/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.4.8");
  const catalogJson = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "help", "catalog.json"), "utf8"));
  assert.equal(catalogJson.lastUpdatedVersion, "0.4.8");
});
