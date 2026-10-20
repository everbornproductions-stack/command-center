// Bare imports in the packaged engine must be dependencies, not transitive
// packages. v0.4.5 imported undici, unit tests passed, and the installed app
// crashed at startup with ERR_MODULE_NOT_FOUND.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bareSpecifiers, checkRuntimeDeps, packageName } from "../scripts/check-runtime-deps.mjs";
import { ROOT } from "./helpers.js";

const names = (code) => bareSpecifiers(code).map((hit) => packageName(hit.specifier)).filter(Boolean);

test("scanner ignores comments, strings, relative paths, node built-ins, and electron", () => {
  const code = [
    "// require(\"left-pad\")",
    "/* import \"also-fake\" */",
    "const text = \"require(\\\"left-pad\\\")\";",
    "import fs from \"node:fs\";",
    "import path from \"path\";",
    "import { promises as fsp } from \"node:fs/promises\";",
    "const { app } = require(\"electron\");",
    "import \"electron/main\";",
    "require(\"./ports.cjs\");",
    "import { Agent } from \"undici\";",
    "import Anthropic from \"@anthropic-ai/sdk\";",
    "require.resolve(\"electron-updater\");",
    "const dyn = import(\"ws\");",
    "export { x } from \"qrcode-generator/build/qrcode\";",
    "const t = `kept ${require(\"undici\")}`;",
  ].join("\n");
  assert.deepEqual(names(code), ["undici", "@anthropic-ai/sdk", "electron-updater", "ws", "qrcode-generator", "undici"]);
});

test("a package that is only a devDependency is not allowed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-deps-"));
  const file = path.join(dir, "main.js");
  fs.writeFileSync(file, "import \"electron\";\nimport \"electron-builder\";\n");
  try {
    const result = checkRuntimeDeps({ root: dir, files: [file], dependencies: { electron: "1.0.0" } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing.map((m) => m.packageName), ["electron-builder"]);
    const allowed = checkRuntimeDeps({ root: dir, files: [file], dependencies: { electron: "1.0.0", "electron-builder": "1.0.0" } });
    assert.equal(allowed.missing.some((m) => m.packageName === "electron"), false);
    assert.equal(allowed.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("undici is required by the engine and must be a dependency (v0.4.5 hole)", () => {
  const file = path.join(ROOT, "server", "loopback-fetch.js");
  const without = checkRuntimeDeps({
    files: [file],
    dependencies: { ws: "1", "qrcode-generator": "1", "@anthropic-ai/sdk": "1", "electron-updater": "1" },
  });
  assert.equal(without.ok, false);
  assert.ok(without.missing.some((m) => m.packageName === "undici" && m.file.endsWith("server/loopback-fetch.js")));
});

test("server and electron imports are all in dependencies", () => {
  const result = checkRuntimeDeps();
  assert.equal(result.ok, true, result.missing.map((m) => `${m.file}: ${m.packageName}`).join("\n"));
  for (const name of ["undici", "ws", "qrcode-generator", "@anthropic-ai/sdk", "electron-updater"]) {
    assert.ok(result.packages.includes(name), name);
  }
  assert.equal(result.dependencies.has("electron"), false, "electron is the runtime, not a packaged npm dependency");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["check:deps"], "node scripts/check-runtime-deps.mjs");
});
