// Optional Azure Trusted Signing. No real keys, no network, no helper process.
// Temp directories are removed when the test ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers.js";

const require = createRequire(import.meta.url);
const signing = require("../scripts/windows-signing.cjs");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SECRET = "SENTINEL-SECRET-do-not-print-9f3a";
const SIGN_ENV = {
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000000",
  AZURE_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
  AZURE_CLIENT_SECRET: SECRET,
  AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  AZURE_SIGNING_ACCOUNT: "EverTest",
  AZURE_CERT_PROFILE: "MeldmindProfile",
  AZURE_PUBLISHER_NAME: "CN=Everborn Productions, O=Everborn Productions, C=US",
};

function hidden(text) {
  assert.equal(String(text).includes(SECRET), false);
}

test("signing is skipped when the Azure secrets are absent", () => {
  const plan = signing.signingPlan({});
  assert.equal(plan.mode, "skip");
  assert.equal(plan.azureSignOptions, null);
  assert.match(plan.message, /unsigned installer/);
  assert.match(plan.message, /AZURE_TENANT_ID/);
  const varsOnly = signing.signingPlan({
    AZURE_SIGNING_ENDPOINT: SIGN_ENV.AZURE_SIGNING_ENDPOINT,
    AZURE_SIGNING_ACCOUNT: SIGN_ENV.AZURE_SIGNING_ACCOUNT,
    AZURE_CERT_PROFILE: SIGN_ENV.AZURE_CERT_PROFILE,
    AZURE_PUBLISHER_NAME: SIGN_ENV.AZURE_PUBLISHER_NAME,
  });
  assert.equal(varsOnly.mode, "skip");
  const blank = signing.signingPlan({ AZURE_TENANT_ID: "  ", AZURE_CLIENT_ID: "", AZURE_CLIENT_SECRET: "\n" });
  assert.equal(blank.mode, "incomplete", "a line break in a secret is not treated as absent");
  hidden(blank.message);
});

test("a partial signing setup stops the build and does not reveal the secret", () => {
  const plan = signing.signingPlan({ AZURE_TENANT_ID: SECRET, AZURE_CLIENT_ID: "", AZURE_CLIENT_SECRET: "" });
  assert.equal(plan.mode, "incomplete");
  assert.match(plan.message, /AZURE_CLIENT_ID is missing/);
  assert.match(plan.message, /AZURE_CLIENT_SECRET is missing/);
  assert.match(plan.message, /AZURE_SIGNING_ENDPOINT is missing/);
  assert.match(plan.message, /unsigned installer/);
  hidden(plan.message);
  const badEndpoint = signing.signingPlan({ ...SIGN_ENV, AZURE_SIGNING_ENDPOINT: SECRET });
  assert.equal(badEndpoint.mode, "incomplete");
  assert.match(badEndpoint.message, /codesigning\.azure\.net/);
  hidden(badEndpoint.message);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sign-"));
  const marker = path.join(dir, "marker");
  try {
    assert.throws(() => signing.applySigningConfig({ AZURE_CLIENT_SECRET: SECRET }, { markerPath: marker, log() {} }), (err) => {
      hidden(err.message);
      assert.match(err.message, /AZURE_TENANT_ID is missing/);
      return true;
    });
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a complete signing setup configures azureSignOptions and keeps the secret out of the config", () => {
  const lines = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sign-"));
  const marker = path.join(dir, "nested", "marker");
  try {
    const config = signing.applySigningConfig(SIGN_ENV, { markerPath: marker, log: (line) => lines.push(line) });
    assert.equal(fs.readFileSync(marker, "utf8"), "sign\n");
    assert.deepEqual(config.win.azureSignOptions, {
      endpoint: "https://eus.codesigning.azure.net/",
      codeSigningAccountName: "EverTest",
      certificateProfileName: "MeldmindProfile",
      publisherName: "CN=Everborn Productions, O=Everborn Productions, C=US",
      fileDigest: "SHA256",
      timestampRfc3161: signing.TIMESTAMP_SERVER,
      timestampDigest: "SHA256",
    });
    hidden(JSON.stringify(config));
    hidden(lines.join("\n"));
    hidden(fs.readFileSync(marker, "utf8"));
    assert.match(lines.join("\n"), /NSIS installer/);
    assert.match(lines.join("\n"), /latest\.yml/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("latest.yml hash and size must match the installer that will be published", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sign-"));
  const installer = path.join(dir, "Meldmind-Setup-0.4.5.exe");
  try {
    fs.writeFileSync(installer, Buffer.from("signed-installer-bytes"));
    fs.writeFileSync(`${installer}.blockmap`, Buffer.from("map"));
    const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest("base64");
    const size = fs.statSync(installer).size;
    const yml = [
      "version: 0.4.5",
      "files:",
      "  - url: Meldmind-Setup-0.4.5.exe",
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      "path: Meldmind-Setup-0.4.5.exe",
      `sha512: ${sha512}`,
      "releaseDate: '2026-10-20T00:00:00.000Z'",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "latest.yml"), yml);
    const ok = await signing.verifyInstallerFeed({ dir, env: {}, platform: "linux", markerText: "skip\n" });
    assert.equal(ok.ok, true, ok.errors.join("\n"));
    assert.equal(ok.signature, false);
    assert.match(ok.summary, /unsigned/);

    const parsed = signing.parseLatestYml(yml);
    assert.equal(parsed.sha512, sha512);
    assert.equal(parsed.files[0].size, size);

    fs.writeFileSync(path.join(dir, "latest.yml"), yml.replace(sha512, sha512.slice(0, -2) + (sha512.endsWith("a") ? "b" : "a")));
    const bad = await signing.verifyInstallerFeed({ dir, env: {}, platform: "linux", markerText: "skip" });
    assert.equal(bad.ok, false);
    assert.match(bad.errors.join("\n"), /sha512 does not match/);

    fs.writeFileSync(path.join(dir, "latest.yml"), yml.replace(`size: ${size}`, "size: 1"));
    const badSize = await signing.verifyInstallerFeed({ dir, env: {}, platform: "linux", markerText: "" });
    assert.equal(badSize.ok, false);
    assert.match(badSize.errors.join("\n"), /size does not match/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a signed build requires a valid signature on the app exe and the installer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sign-"));
  const installerName = "Meldmind-Setup-0.4.5.exe";
  const installer = path.join(dir, installerName);
  const appExe = path.join(dir, "win-unpacked", "Meldmind.exe");
  try {
    fs.mkdirSync(path.dirname(appExe), { recursive: true });
    fs.writeFileSync(installer, Buffer.from("installer"));
    fs.writeFileSync(appExe, Buffer.from("app"));
    fs.writeFileSync(`${installer}.blockmap`, Buffer.from("map"));
    const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installer)).digest("base64");
    const size = fs.statSync(installer).size;
    fs.writeFileSync(path.join(dir, "latest.yml"), [
      "version: 0.4.5",
      "files:",
      `  - url: ${installerName}`,
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      `path: ${installerName}`,
      `sha512: ${sha512}`,
      "",
    ].join("\n"));
    const calls = [];
    const ok = await signing.verifyInstallerFeed({
      dir,
      env: SIGN_ENV,
      platform: "win32",
      markerText: "sign\n",
      signStatus(file) { calls.push(path.basename(file)); return "Valid"; },
    });
    assert.equal(ok.ok, true, ok.errors.join("\n"));
    assert.equal(ok.signature, true);
    assert.deepEqual(calls.sort(), ["Meldmind-Setup-0.4.5.exe", "Meldmind.exe"]);
    hidden(JSON.stringify(ok));

    const rejected = await signing.verifyInstallerFeed({
      dir,
      env: SIGN_ENV,
      platform: "win32",
      markerText: "sign",
      signStatus: () => "NotSigned",
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.errors.join("\n"), /NotSigned/);
    hidden(rejected.errors.join("\n"));

    const skipped = await signing.verifyInstallerFeed({
      dir,
      env: SIGN_ENV,
      platform: "win32",
      markerText: "skip",
      signStatus() { throw new Error("signature check ran for an unsigned build"); },
    });
    assert.equal(skipped.ok, false);
    assert.match(skipped.errors.join("\n"), /did not sign/);
    hidden(skipped.errors.join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the signature command is a fixed PowerShell call and does not carry secrets", () => {
  const command = signing.authenticodeScript("C:\\dist\\Meldmind.exe");
  assert.equal(command, "Get-AuthenticodeSignature -LiteralPath 'C:\\dist\\Meldmind.exe' | Select-Object -ExpandProperty Status");
  hidden(command);
  assert.throws(() => signing.authenticodeScript("C:\\dist\\it's.exe"), /refused/);
});

test("electron-builder config, workflows, and the signing doc stay free of secret values", () => {
  const yml = read("electron-builder.yml");
  const release = read(".github/workflows/release-windows.yml");
  const ci = read(".github/workflows/windows-ci.yml");
  const doc = read("docs/release/code-signing.md");
  const releasing = read("docs/RELEASING.md");
  const pkg = JSON.parse(read("package.json"));
  assert.match(yml, /extends: scripts\/windows-signing-config\.cjs/);
  assert.match(yml, /appId: com\.everborn\.command/);
  assert.match(yml, /winCodeSign: "1\.1\.0"/);
  assert.doesNotMatch(yml, /signAndEditExecutable:\s*false/);
  assert.doesNotMatch(yml, /signExecutable:\s*false/);
  assert.match(pkg.devDependencies["electron-builder"], /^\^26\./);
  assert.match(release, /AZURE_TENANT_ID: \$\{\{ secrets\.AZURE_TENANT_ID \}\}/);
  assert.match(release, /AZURE_CLIENT_ID: \$\{\{ secrets\.AZURE_CLIENT_ID \}\}/);
  assert.match(release, /AZURE_CLIENT_SECRET: \$\{\{ secrets\.AZURE_CLIENT_SECRET \}\}/);
  assert.match(release, /AZURE_SIGNING_ENDPOINT: \$\{\{ vars\.AZURE_SIGNING_ENDPOINT \}\}/);
  assert.match(release, /AZURE_SIGNING_ACCOUNT: \$\{\{ vars\.AZURE_SIGNING_ACCOUNT \}\}/);
  assert.match(release, /AZURE_CERT_PROFILE: \$\{\{ vars\.AZURE_CERT_PROFILE \}\}/);
  assert.match(release, /AZURE_PUBLISHER_NAME: \$\{\{ vars\.AZURE_PUBLISHER_NAME \}\}/);
  assert.match(release, /node scripts\/verify-latest-yml\.mjs/);
  assert.match(ci, /node scripts\/verify-latest-yml\.mjs/);
  const build = release.slice(release.indexOf("- name: Build the Windows installer"), release.indexOf("- name: Check latest.yml matches the installer"));
  const check = release.slice(release.indexOf("- name: Check latest.yml matches the installer"), release.indexOf("- name: Publish the normal release"));
  const publish = release.slice(release.indexOf("- name: Publish the normal release"));
  assert.match(build, /secrets\.AZURE_CLIENT_SECRET/);
  assert.match(check, /secrets\.AZURE_CLIENT_SECRET/);
  assert.doesNotMatch(publish, /AZURE_/);
  assert.doesNotMatch(ci, /\$\{\{ secrets\./);
  assert.doesNotMatch(ci, /AZURE_TENANT_ID|AZURE_CLIENT_ID|AZURE_CLIENT_SECRET/);
  for (const text of [yml, release, ci, doc, releasing, read("scripts/windows-signing.cjs"), read("scripts/windows-signing-config.cjs"), read("scripts/verify-latest-yml.mjs")]) {
    assert.equal(text.includes("\u2014"), false);
    assert.equal(text.includes(SECRET), false);
    assert.doesNotMatch(text, /sb_secret_|BEGIN [A-Z ]*PRIVATE KEY/);
  }
  assert.match(doc, /Microsoft\.CodeSigning/);
  assert.match(doc, /EIN/);
  assert.match(doc, /Trusted Signing Certificate Profile Signer/);
  assert.match(doc, /Artifact Signing Certificate Profile Signer/);
  assert.match(doc, /filesubmission/);
  assert.match(doc, /false positive/i);
  assert.match(doc, /latest\.yml/);
  assert.match(releasing, /docs\/release\/code-signing\.md/);
  assert.match(read(".gitignore"), /^\.windows-signing-mode$/m);
  assert.match(read("docs/help/troubleshooting.md"), /unsigned installer/);
});

test("electron-builder merges azureSignOptions only when signing is on", async () => {
  const { getConfig } = require("app-builder-lib/out/util/config/config.js");
  const marker = path.join(ROOT, ".windows-signing-mode");
  const names = [...signing.SECRET_NAMES, ...signing.VAR_NAMES];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const apply = (env) => {
    for (const name of names) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  };
  try {
    apply({});
    fs.rmSync(marker, { force: true });
    const unsigned = await getConfig(ROOT, null, null);
    assert.equal(unsigned.win.azureSignOptions, undefined);
    assert.equal(unsigned.appId, "com.everborn.command");
    assert.equal(unsigned.toolsets.winCodeSign, "1.1.0");
    assert.equal(fs.readFileSync(marker, "utf8"), "skip\n");
    assert.ok(unsigned.win.target, "the Windows target stays in the merged config");

    apply(SIGN_ENV);
    const signed = await getConfig(ROOT, null, null);
    assert.equal(signed.win.azureSignOptions.certificateProfileName, "MeldmindProfile");
    assert.equal(signed.win.azureSignOptions.publisherName, SIGN_ENV.AZURE_PUBLISHER_NAME);
    assert.equal(signed.win.icon, "build/icon.ico");
    hidden(JSON.stringify(signed.win.azureSignOptions));
    assert.equal(fs.readFileSync(marker, "utf8"), "sign\n");
    hidden(fs.readFileSync(marker, "utf8"));
  } finally {
    apply(saved);
    fs.rmSync(marker, { force: true });
  }
});
