// Stay light: lazy registry, one scheduler, add-ons that are not in the installer,
// and the installer / RAM / eager-import budgets. No real key. data/ is not read.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { idsFor, shellIds, ADDONS } from "../web/perf/registry.js";
import { createScheduler } from "../server/perf/scheduler.js";
import { eagerSpecifiers, allSpecifiers, heavySpecifiers } from "../server/perf/eager.js";
import {
  BASELINE, installerCap, installerWithinBudget, idleRamOk, IDLE_RAM_BUDGET, ENGINE_RAM_BUDGET,
} from "../server/perf/budget.js";
import { installAddon, removeAddon, chooseRoute } from "../server/perf/addons.js";
import { loadHelp } from "../server/help.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";
const EN = "\u2013";

test("a page loads its module, and Light mode leaves Command extras unloaded", () => {
  const command = idsFor("command", { light: false });
  const light = idsFor("command", { light: true });
  assert.ok(command.includes("search"));
  assert.ok(command.includes("schedules"));
  assert.ok(command.includes("walkthrough"));
  assert.equal(light.includes("search"), false);
  assert.equal(light.includes("schedules"), false);
  assert.equal(light.length, 0);
  for (const id of shellIds()) {
    assert.equal(command.includes(id), false);
    assert.ok(shellIds().includes("help"));
  }

  const settings = idsFor("settings", { light: true });
  assert.ok(settings.includes("performance"));
  assert.ok(settings.includes("pricing"));
  assert.equal(settings.includes("themes"), false);

  assert.deepEqual(idsFor("brain"), ["brain"]);
  assert.deepEqual(idsFor("marketplace"), ["marketplace"]);
  assert.ok(idsFor("start", { light: true }).includes("walkthrough"));
  assert.equal(idsFor("compare", { light: true }).includes("search"), false);
});

test("background jobs share one timer and pause when idle or on battery", () => {
  let t = 1000;
  let st = { idle: false, battery: false, light: false };
  const calls = [];
  let clears = 0;
  const runs = { schedules: 0, ui: 0 };
  const sch = createScheduler({
    now: () => t,
    state: () => st,
    setTimeout: (fn, ms) => {
      calls.push({ fn, ms });
      return { unref() {} };
    },
    clearTimeout: () => { clears += 1; },
  });
  sch.register({ id: "schedules", everyMs: 15000, lightEveryMs: 60000, pause: true, run: () => { runs.schedules += 1; } });
  sch.register({ id: "ui-refresh", everyMs: 15000, pause: "idle", run: () => { runs.ui += 1; } });
  assert.equal(calls.length, 2);
  assert.equal(clears, 1);
  assert.equal(calls[1].ms, 15000);

  t = 16000;
  sch.tick();
  assert.deepEqual(runs, { schedules: 1, ui: 1 });

  t = 32000;
  st = { idle: true, battery: false, light: false };
  sch.tick();
  assert.deepEqual(runs, { schedules: 1, ui: 1 });

  t = 48000;
  st = { idle: false, battery: true, light: false };
  sch.tick();
  assert.deepEqual(runs, { schedules: 1, ui: 2 });

  st = { idle: false, battery: false, light: true };
  const jobs = sch.list();
  assert.equal(jobs.find((j) => j.id === "schedules").effectiveMs, 60000);
  assert.equal(jobs.find((j) => j.id === "ui-refresh").effectiveMs, 60000);
  sch.stop();
});

test("startup files do not require a heavy module, and the installer budget holds", () => {
  for (const rel of ["electron/main.cjs", "server/index.js"]) {
    const src = read(rel);
    assert.deepEqual(heavySpecifiers(eagerSpecifiers(src)), [], rel);
    assert.deepEqual(heavySpecifiers(allSpecifiers(src)), [], rel);
  }
  const nested = [
    "const local = require('./ports.cjs');",
    "function later() {",
    "  require('tesseract.js');",
    "}",
    "require('playwright');",
    "// require('lighthouse')",
  ].join("\n");
  assert.deepEqual(heavySpecifiers(eagerSpecifiers(nested)), ["playwright"]);
  assert.ok(heavySpecifiers(allSpecifiers(nested)).includes("tesseract.js"));

  const pkg = JSON.parse(read("package.json"));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(heavySpecifiers(names), []);
  assert.equal(pkg.version, "0.4.27");

  const yml = read("electron-builder.yml");
  assert.match(yml, /!addons\/\*\*/);
  assert.match(yml, /playwright/);
  assert.match(yml, /whisperx/);

  assert.equal(installerCap(), 128889249);
  assert.equal(installerWithinBudget(BASELINE.installerBytes), true);
  assert.equal(installerWithinBudget(installerCap()), true);
  assert.equal(installerWithinBudget(installerCap() + 1), false);
  assert.equal(idleRamOk(BASELINE.idleRamBytes), true);
  assert.equal(idleRamOk(IDLE_RAM_BUDGET), true);
  assert.equal(idleRamOk(IDLE_RAM_BUDGET + 1), false);
  assert.ok(BASELINE.engineRamBytes <= ENGINE_RAM_BUDGET);
  assert.ok(ADDONS.every((a) => a.bytes > 0 && a.cloud));
});

test("an add-on downloads only after Install, and the cloud route is the default", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-addon-"));
  const file = path.join(dir, "blob.bin");
  fs.writeFileSync(file, Buffer.from("ocr-bytes"));
  const port = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir);
  try {
    await assert.rejects(
      () => installAddon("ocr", { approve: false, dataDir, sourceUrl: `http://127.0.0.1:${port.port}/blob.bin` }),
      (e) => e.status === 400 && /about 45 MB/.test(e.message),
    );
    assert.equal(chooseRoute(dataDir, "ocr").route, "cloud");
    const row = await installAddon("ocr", { approve: true, dataDir, sourceUrl: `http://127.0.0.1:${port.port}/blob.bin` });
    assert.equal(row.installed, true);
    assert.equal(row.route, "local");
    assert.ok(row.installedBytes > 0);
    assert.equal(chooseRoute(dataDir, "ocr").route, "local");
    removeAddon("ocr", dataDir);
    assert.equal(chooseRoute(dataDir, "ocr").route, "cloud");
    const pending = await installAddon("whisper", { approve: true, dataDir });
    assert.equal(pending.installed, false);
    assert.match(pending.message, /connected speech model/);
  } finally {
    await new Promise((resolve) => port.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the feature loader imports on demand, and the help page is plain", () => {
  const loader = read("web", "features", "index.js");
  const imports = [...loader.matchAll(/^import\s+.+from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["/perf/registry.js"]);
  assert.match(loader, /import\(`\/features\/\$\{fileOf\(id\)\}\.js`\)/);

  const pack = loadHelp();
  const article = pack.articles.find((a) => a.id === "stay-light");
  assert.ok(article);
  assert.equal(article.title, "Stay fast on an older PC");
  assert.match(article.body, /Light mode/);
  assert.match(article.body, /Add-ons/);
  assert.equal(article.lastUpdatedVersion, "0.4.8");
  for (const rel of ["docs/help/stay-light.md", "web/features/performance.js", "docs/PERFORMANCE.md", "web/perf/registry.js"]) {
    const text = read(rel);
    assert.equal(text.includes(EM), false, rel);
    assert.equal(text.includes(EN), false, rel);
  }
});

test("perf stays unloaded until Settings asks, and Light mode slows the shared jobs", async () => {
  const s = await startServer();
  try {
    const before = await s.api("/state");
    assert.equal(before.json.plugins.includes("perf"), false);
    const status = await s.api("/perf");
    assert.equal(status.status, 200);
    const ids = status.json.jobs.map((j) => j.id);
    assert.equal(ids.filter((id) => id === "schedules").length, 1);
    assert.equal(ids.filter((id) => id === "model-watch").length, 1);
    assert.equal(ids.filter((id) => id === "detection").length, 1);
    const after = await s.api("/state");
    assert.equal(after.json.plugins.includes("perf"), true);

    const refused = await s.api("/perf/addons/ocr", { method: "POST", body: {} });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /about 45 MB/);

    const on = await s.api("/perf/light", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.lightMode, true);
    const slowed = await s.api("/perf");
    assert.equal(slowed.json.lightMode, true);
    assert.equal(slowed.json.jobs.find((j) => j.id === "schedules").effectiveMs, 60000);

    if (process.platform === "linux") {
      const proc = fs.readFileSync(`/proc/${s.child.pid}/status`, "utf8");
      const rss = Number(proc.match(/VmRSS:\s+(\d+)/)[1]) * 1024;
      assert.ok(rss <= ENGINE_RAM_BUDGET, `engine RSS ${rss} is over ${ENGINE_RAM_BUDGET}`);
    }
  } finally {
    await s.stop();
  }
});
