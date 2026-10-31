// Hub address: the Cloudflare Worker and the Fly fallback both use hub.everbornproductions.com today
// (a zone in Chris's Cloudflare account). hub.meldmind.ai is a one-line switch once meldmind.ai is a zone.
// The appId, the updater feed, the installer names and CC_OWNER_EMAILS stay as they are.
// No secret values belong in wrangler.jsonc.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("wrangler and fly use one hub address and do not carry secrets", () => {
  const wrangler = read("wrangler.jsonc");
  const fly = read("fly.toml");
  assert.match(wrangler, /"name": "meldmind-hub"/);
  assert.match(wrangler, /^  "routes": \[\{ "pattern": "hub\.everbornproductions\.com", "custom_domain": true \}\],$/m);
  assert.match(wrangler, /^    "CC_HUB_URL": "https:\/\/hub\.everbornproductions\.com",$/m);
  // the switch to hub.meldmind.ai is written out in a comment, not live
  assert.match(wrangler, /^\s*\/\/\s+"CC_HUB_URL": "https:\/\/hub\.meldmind\.ai",$/m);
  assert.doesNotMatch(wrangler, /^\s*"routes": \[\{ "pattern": "hub\.meldmind\.ai"/m);
  assert.match(wrangler, /"CC_OWNER_EMAILS": "everbornproductions@gmail\.com"/);
  assert.doesNotMatch(wrangler, /command\.everbornproductions\.com/);
  assert.doesNotMatch(wrangler, /CC_MASTER_KEY|CC_SUPABASE_ANON_KEY|CC_SUPABASE_SERVICE_KEY|CC_TICK_SECRET"\s*:/);
  assert.match(fly, /CC_HUB_URL = "https:\/\/hub\.everbornproductions\.com"/);
  assert.match(fly, /app = "everborn-command"/, "the Fly fallback app name stays");
  assert.doesNotMatch(fly, /command\.everbornproductions\.com/);
});

test("the worker and the desktop default use the same hub address, not a hard-coded host", async () => {
  const worker = read("worker/index.js") + read("worker/hub-clock.js");
  assert.doesNotMatch(worker, /https:\/\/hub\.meldmind\.ai/);
  assert.match(worker, /env\?\.CC_HUB_URL/);
  const { DEFAULT_HUB_URL } = await import("../server/hub-address.js");
  assert.equal(DEFAULT_HUB_URL, "https://hub.everbornproductions.com");
  const { HUB_PING_URL } = await import("../server/usage.js");
  assert.equal(HUB_PING_URL, `${DEFAULT_HUB_URL}/api/metrics/ping`);
  for (const f of ["server/usage.js", "server/privacy.js", "fly.toml", "README.md"]) {
    assert.doesNotMatch(read(f), /hub\.meldmind\.ai\/|"https:\/\/hub\.meldmind\.ai"/, f);
  }
});

test("appId, updater feed and installer names are unchanged", () => {
  const builder = read("electron-builder.yml");
  const main = read("electron/main.cjs");
  assert.match(builder, /appId: com\.everborn\.command/);
  assert.match(builder, /artifactName: "Meldmind-Setup-\$\{version\}\.\$\{ext\}"/);
  assert.match(builder, /repo: command-center-releases/);
  assert.match(main, /command-center-releases/);
  assert.match(read("docs/hosted-hub.md"), /https:\/\/hub\.everbornproductions\.com\/\*\*/);
  assert.match(read("docs/hosted-hub.md"), /Site URL = `https:\/\/hub\.everbornproductions\.com`/);
});
