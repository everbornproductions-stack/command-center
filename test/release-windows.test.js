// The Windows release workflow publishes a normal release. It must not embed a token,
// must refuse a missing publishable key, and must upload the three update files together.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("Windows release workflow: test, inject the publishable key, publish a normal release", () => {
  const wf = read(".github/workflows/release-windows.yml");
  const releasing = read("docs/RELEASING.md");
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.match(wf, /run: npm ci/);
  const testStep = wf.slice(wf.indexOf("name: Test"), wf.indexOf("name: Smoke"));
  assert.equal((testStep.match(/npm test/g) || []).length, 2, "the release still runs the suite, then once more if that run fails");
  assert.match(testStep, /Tests failed once\. Retrying the test step once\./);
  assert.match(testStep, /shell: bash/);
  assert.doesNotMatch(testStep, /continue-on-error/);
  assert.match(wf, /run: npm run smoke/);
  assert.match(wf, /run: npm run dist/);
  assert.match(wf, /CC_SUPABASE_ANON_KEY: \$\{\{ secrets\.CC_SUPABASE_ANON_KEY \|\| vars\.CC_SUPABASE_ANON_KEY \}\}/);
  assert.match(wf, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \|\| vars\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.match(wf, /node scripts\/inject-cloud-key\.mjs --check/);
  assert.match(wf, /The release stops when neither is set/);
  assert.match(wf, /Never use the service key/);
  assert.doesNotMatch(wf, /CC_PACK_UNPUBLISHED/, "a release build must not skip the publishable key");
  assert.match(wf, /GH_TOKEN: \$\{\{ secrets\.RELEASES_TOKEN \}\}/);
  assert.match(wf, /repo secret RELEASES_TOKEN is missing/);
  assert.match(wf, /everbornproductions-stack\/command-center-releases/);
  assert.match(wf, /Meldmind-Setup-\$\{V\}\.exe/);
  assert.match(wf, /Meldmind-Setup-\$\{V\}\.exe\.blockmap/);
  assert.match(wf, /dist\/latest\.yml/);
  assert.match(wf, /gh release create "\$TAG" --repo "\$R" --title "Meldmind v\$\{V\}" --latest --notes-file release-notes.txt "\$EXE" "\$MAP" "\$YML"/);
  assert.match(wf, /--draft=false/, "an existing draft is published, not left as a draft");
  assert.doesNotMatch(wf, /--draft(?!=false)/);
  assert.doesNotMatch(wf, /--prerelease/);
  const secrets = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "CC_SUPABASE_ANON_KEY", "RELEASES_TOKEN", "SUPABASE_PUBLISHABLE_KEY"]);
  assert.equal(secrets.some((s) => /SERVICE|SB_SECRET|PASSWORD/.test(s)), false);
  assert.doesNotMatch(wf, /sb_secret_|service_role/);
  assert.doesNotMatch(wf, /—/);
  assert.match(releasing, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(releasing, /RELEASES_TOKEN/);
  assert.match(releasing, /release-windows\.yml/);
  assert.match(releasing, /CC_SUPABASE_ANON_KEY/);
  assert.match(releasing, /windows-ci\.yml/);
  assert.doesNotMatch(releasing, /—/);
});

test("Windows CI workflow: test and package on pull requests and main, never publish", () => {
  const wf = read(".github/workflows/windows-ci.yml");
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /pull_request:/);
  assert.match(wf, /branches: \["main"\]/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /run: npm run smoke/);
  assert.match(wf, /run: npm run dist/);
  assert.match(wf, /CC_PACK_UNPUBLISHED: "1"/);
  assert.match(wf, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(wf, /GH_TOKEN: ""/);
  assert.match(wf, /Meldmind-Setup-\$\{V\}\.exe/);
  assert.match(wf, /Meldmind-Setup-\$\{V\}\.exe\.blockmap/);
  assert.match(wf, /dist\/latest\.yml/);
  assert.doesNotMatch(wf, /\$\{\{ secrets\./, "no signing or release secrets");
  assert.doesNotMatch(wf, /gh release/);
  assert.doesNotMatch(wf, /RELEASES_TOKEN|CSC_LINK|WIN_CSC_LINK|CSC_KEY_PASSWORD/);
  assert.doesNotMatch(wf, /sb_secret_|service_role|sb_publishable_/);
  assert.doesNotMatch(wf, /—/);
  assert.match(read("electron-builder.yml"), /winCodeSign: "1\.1\.0"/, "legacy 7z codesign bundle cannot unpack on a Windows runner");
  assert.equal((wf.match(/npm test/g) || []).length, 1, "the pull request check runs the suite once, with no retry");
});

test("npm test runs the MCP stdio and demo file alone, then the other files", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.test, "node scripts/test-all.mjs");
  const runner = read("scripts/test-all.mjs");
  assert.match(runner, /mcp\.test\.js/);
  assert.match(runner, /--test-concurrency=1/);
  const serialAt = runner.indexOf("run([serialName], [\"--test-concurrency=1\"])");
  const restAt = runner.indexOf("run(rest, extra)");
  assert.ok(serialAt > 0 && restAt > serialAt, "the stdio and demo file runs before the other files");
  assert.match(runner, /process\.platform === "win32" \? \["--test-concurrency=2"\]/);
  assert.doesNotMatch(runner, /--test-skip|testNamePattern/);
  assert.match(read("docs/RELEASING.md"), /runs `npm test` once more before it stops/);
});
