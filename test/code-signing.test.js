// Windows code signing (Azure Artifact Signing) turns on only when every value exists.
// With any value missing the release builds unsigned, as before, and the verify step
// does not fail. Pull request CI and the Mac build never sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers.js";
import { signingFromEnv, builderArgs, NOT_SET_UP, SET_UP, SIGNING_VARS, SIGNING_SECRETS } from "../scripts/azure-sign-config.mjs";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FULL = {
  AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  AZURE_SIGNING_ACCOUNT: "test-account",
  AZURE_SIGNING_PROFILE: "test-profile",
  AZURE_SIGNING_PUBLISHER: "Test Publisher",
  AZURE_TENANT_ID: "tenant-test",
  AZURE_CLIENT_ID: "client-test",
  AZURE_CLIENT_SECRET: "secret-test-value",
};
const SCRIPT = path.join(ROOT, "scripts", "azure-sign-config.mjs");

function runScript(mode, extraEnv) {
  const env = { ...process.env };
  for (const k of [...Object.keys(SIGNING_VARS), ...SIGNING_SECRETS, "GITHUB_OUTPUT"]) delete env[k];
  Object.assign(env, extraEnv);
  const r = spawnSync(process.execPath, [SCRIPT, mode], { env, encoding: "utf8", timeout: 30000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("signing is on only when all seven values exist", () => {
  assert.equal(signingFromEnv(FULL).on, true);
  assert.equal(signingFromEnv({}).on, false);
  for (const name of Object.keys(FULL)) {
    const env = { ...FULL, [name]: "  " };
    const s = signingFromEnv(env);
    assert.equal(s.on, false, `${name} missing means unsigned`);
    assert.deepEqual(s.missing, [name]);
    assert.deepEqual(builderArgs(env), [], "no signing flags, so the build is the same as today");
  }
  const args = builderArgs(FULL);
  assert.deepEqual(args.sort(), [
    "-c.win.azureSignOptions.certificateProfileName=test-profile",
    "-c.win.azureSignOptions.codeSigningAccountName=test-account",
    "-c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net/",
    "-c.win.azureSignOptions.publisherName=Test Publisher",
  ]);
  assert.equal(args.some((a) => /secret-test-value|tenant-test|client-test/.test(a)), false, "secrets are never passed as flags");
});

test("the check prints one plain line, writes signing=off, and never prints a value", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sign-"));
  try {
    const out = path.join(dir, "out.txt");
    const missing = runScript("--check", { GITHUB_OUTPUT: out, AZURE_SIGNING_ENDPOINT: FULL.AZURE_SIGNING_ENDPOINT });
    assert.equal(missing.code, 0, "a missing value never stops the release");
    assert.equal(missing.out.trim(), NOT_SET_UP);
    assert.equal(NOT_SET_UP, "Code signing is not set up yet, building unsigned.");
    assert.match(fs.readFileSync(out, "utf8"), /^signing=off$/m);
    assert.equal(runScript("--args", {}).out, "", "no flags when signing is not set up");

    fs.writeFileSync(out, "");
    const full = runScript("--check", { ...FULL, GITHUB_OUTPUT: out });
    assert.equal(full.code, 0);
    assert.equal(full.out.trim(), SET_UP);
    assert.match(fs.readFileSync(out, "utf8"), /^signing=on$/m);
    for (const v of Object.values(FULL)) assert.equal(full.out.includes(v), false, "the check never prints a value");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("release workflow: secrets only in the build step, unsigned build continues, verify fails only when signing is on", () => {
  const wf = read(".github/workflows/release-windows.yml");
  const win = wf.slice(0, wf.indexOf("\n  mac-release:"));
  const mac = wf.slice(wf.indexOf("\n  mac-release:"));
  const build = win.slice(win.indexOf("- name: Build the Windows installer"), win.indexOf("- name: Verify the installer signature"));
  const verify = win.slice(win.indexOf("- name: Verify the installer signature"), win.indexOf("- name: Publish the normal release"));
  assert.ok(build.length > 0 && verify.length > 0, "build and verify steps exist, in that order");
  assert.match(build, /id: build/);
  assert.match(build, /node scripts\/azure-sign-config\.mjs --check/, "the signing check runs in the build step");
  assert.match(build, /node scripts\/azure-sign-config\.mjs --args/);
  assert.match(build, /if \[ "\$\{#SIGN_ARGS\[@\]\}" -eq 0 \]; then\s+npm run dist\s+else\s+npm run dist -- "\$\{SIGN_ARGS\[@\]\}"/, "no values means the plain unsigned build");
  for (const name of SIGNING_SECRETS) {
    assert.match(build, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
    assert.equal((wf.match(new RegExp(`secrets\\.${name}\\b`, "g")) || []).length, 1, `${name} goes to the build step only`);
  }
  for (const name of Object.keys(SIGNING_VARS)) {
    assert.match(build, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`));
    assert.doesNotMatch(wf, new RegExp(`secrets\\.${name}\\b`), `${name} is a repository variable, not a secret`);
  }
  assert.doesNotMatch(build, /echo .*AZURE_|\$\{?AZURE_CLIENT_SECRET/, "no value is echoed");
  assert.match(verify, /SIGNING: \$\{\{ steps\.build\.outputs\.signing \}\}/);
  assert.match(verify, /Get-AuthenticodeSignature/);
  assert.match(verify, /Meldmind-Setup-\$v\.exe/);
  assert.match(verify, /\$env:SIGNING -eq "on" -and "\$status" -ne "Valid"/, "fails only when signing was set up");
  assert.doesNotMatch(verify, /secrets\./);
  assert.doesNotMatch(verify, /continue-on-error/);
  assert.doesNotMatch(mac, /AZURE_|azureSignOptions/, "the Mac build stays unsigned");
  assert.doesNotMatch(wf, /\u2014|\u2013/);
});

test("PR CI and the static config never sign", () => {
  assert.doesNotMatch(read(".github/workflows/windows-ci.yml"), /azureSignOptions|AZURE_/);
  const cfg = read("electron-builder.yml");
  assert.doesNotMatch(cfg.replace(/#.*$/gm, ""), /azureSignOptions/, "signing options are added only by the release job");
  assert.match(cfg, /identity: null/, "the Mac build stays unsigned");
  const releasing = read("docs/RELEASING.md");
  for (const name of [...Object.keys(SIGNING_VARS), ...SIGNING_SECRETS]) assert.match(releasing, new RegExp(name));
  assert.match(releasing, /Artifact Signing Certificate Profile Signer/);
  assert.match(releasing, /Identity validation/);
  assert.match(releasing, /Code signing is not set up yet, building unsigned\./);
  assert.doesNotMatch(releasing, /\u2014|\u2013/);
  const pkg = JSON.parse(read("package.json"));
  const major = Number(String(pkg.devDependencies["electron-builder"]).replace(/^[^\d]*/, "").split(".")[0]);
  assert.ok(major >= 26, "electron-builder 26 has win.azureSignOptions");
});
