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
  assert.match(wf, /run: npm test/);
  assert.match(wf, /run: npm run smoke/);
  assert.match(wf, /run: npm run dist/);
  assert.match(wf, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.match(wf, /repo secret SUPABASE_PUBLISHABLE_KEY is missing/);
  assert.match(wf, /Never use the service key/);
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
  assert.deepEqual([...new Set(secrets)].sort(), ["RELEASES_TOKEN", "SUPABASE_PUBLISHABLE_KEY"]);
  assert.equal(secrets.some((s) => /SERVICE|SB_SECRET|PASSWORD/.test(s)), false);
  assert.doesNotMatch(wf, /sb_secret_|service_role/);
  assert.doesNotMatch(wf, /—/);
  assert.match(releasing, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(releasing, /RELEASES_TOKEN/);
  assert.match(releasing, /release-windows\.yml/);
  assert.doesNotMatch(releasing, /—/);
});
