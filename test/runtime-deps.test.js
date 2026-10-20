// Bare imports in the packaged engine must be dependencies. v0.4.5 imported undici
// without listing it. Tests passed because another package had pulled it in, and
// the installed app then crashed before it listened.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers.js";
import { collectPackageImports, findSpecifiers, missingRuntimeDeps, packageName } from "../scripts/check-runtime-deps.mjs";

function fixture(files, pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-deps-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
  }));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}

test("this repo's server and main process only import declared packages", () => {
  const rows = collectPackageImports(ROOT);
  const undici = rows.filter((row) => row.name === "undici");
  assert.ok(undici.some((row) => row.file.endsWith(path.join("server", "loopback-fetch.js"))), "loopback-fetch.js imports undici");
  assert.ok(rows.some((row) => row.name === "ws"));
  assert.ok(rows.some((row) => row.name === "qrcode-generator"));
  assert.ok(rows.some((row) => row.name === "@anthropic-ai/sdk"));
  assert.ok(rows.some((row) => row.name === "electron-updater" && row.file.endsWith(path.join("electron", "main.cjs"))));
  assert.deepEqual(missingRuntimeDeps(ROOT), []);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.dependencies.undici, "undici stays in dependencies so the packaged engine can start");
  assert.equal(pkg.devDependencies.undici, undefined);
});

test("comments, strings, relative files, built-ins and electron are not missing packages", () => {
  const dir = fixture({
    "server/app.js": [
      'import { Agent } from "undici";',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import local from "./local.js";',
      'import qr from "qrcode-generator/dist";',
      'const { DatabaseSync } = await import("node:sqlite");',
      'export { WebSocketServer } from "ws";',
      '// import "not-in-a-comment"',
      '/* require("also-not-real") */',
      'const note = "import \\"still-not-real\\" from \\"nope\\"";',
      "const other = `require(\"template-missing\")`;",
    ].join("\n"),
    "electron/main.cjs": [
      'const { app } = require("electron");',
      'const path = require("node:path");',
      'require("./ports.cjs");',
      'require.resolve("electron-updater");',
      '// globalShortcut is passed in (no require("electron") here)',
      'const s = "require(\\"comment-only\\")";',
    ].join("\n"),
  }, {
    dependencies: { undici: "1.0.0", ws: "1.0.0", "qrcode-generator": "1.0.0", "electron-updater": "1.0.0" },
    devDependencies: { electron: "1.0.0", "not-in-a-comment": "1.0.0" },
  });
  try {
    assert.deepEqual(missingRuntimeDeps(dir), []);
    const names = collectPackageImports(dir).map((row) => row.name).sort();
    assert.deepEqual(names, ["electron-updater", "qrcode-generator", "undici", "ws"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a package that is only a devDependency or only transitive fails", () => {
  const dir = fixture({
    "server/use.js": 'import "electron-builder";\nimport { Agent } from "undici";\nimport x from "@anthropic-ai/sdk/resources";\n',
    "electron/main.cjs": 'require("electron");\n',
  }, {
    dependencies: {},
    devDependencies: { "electron-builder": "1.0.0", undici: "1.0.0" },
  });
  try {
    const missing = missingRuntimeDeps(dir).map((row) => `${path.basename(row.file)}:${row.name}`).sort();
    assert.deepEqual(missing, ["use.js:@anthropic-ai/sdk", "use.js:electron-builder", "use.js:undici"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("specifier kinds: built-ins and electron are allowed, scoped names keep the scope", () => {
  assert.equal(packageName("undici"), "undici");
  assert.equal(packageName("undici/lib/agent"), "undici");
  assert.equal(packageName("@anthropic-ai/sdk/resources"), "@anthropic-ai/sdk");
  assert.equal(packageName("./local.js"), null);
  assert.equal(packageName("node:fs"), null);
  assert.equal(packageName("fs/promises"), null);
  assert.equal(packageName("electron"), null);
  assert.equal(packageName("electron/renderer"), null);
  assert.equal(packageName("node:not-a-real-builtin"), "node:not-a-real-builtin");
  const hits = findSpecifiers('import {\n  Agent\n} from "undici";\n');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].specifier, "undici");
  assert.equal(hits[0].line, 1);
});

test("the dependency script exits 0 on this repo and does not print a secret", () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-runtime-deps.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CC_SUPABASE_ANON_KEY: "sb_publishable_testdummyvalue" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Runtime dependency check passed/);
  assert.equal(`${result.stdout}${result.stderr}`.includes("testdummyvalue"), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /—/);
});
