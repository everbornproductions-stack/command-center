// Hub address move: the Cloudflare Worker and the Fly fallback both use hub.meldmind.ai.
// The appId, the updater feed, the installer names and CC_OWNER_EMAILS stay as they are.
// No secret values belong in wrangler.jsonc.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("wrangler and fly use hub.meldmind.ai and do not carry secrets", () => {
  const wrangler = read("wrangler.jsonc");
  const fly = read("fly.toml");
  assert.match(wrangler, /"name": "meldmind-hub"/);
  assert.match(wrangler, /"pattern": "hub\.meldmind\.ai"/);
  assert.match(wrangler, /"CC_HUB_URL": "https:\/\/hub\.meldmind\.ai"/);
  assert.match(wrangler, /"CC_OWNER_EMAILS": "everbornproductions@gmail\.com"/);
  assert.doesNotMatch(wrangler, /command\.everbornproductions\.com/);
  assert.doesNotMatch(wrangler, /CC_MASTER_KEY|CC_SUPABASE_ANON_KEY|CC_SUPABASE_SERVICE_KEY|CC_TICK_SECRET"\s*:/);
  assert.match(fly, /CC_HUB_URL = "https:\/\/hub\.meldmind\.ai"/);
  assert.match(fly, /app = "everborn-command"/, "the Fly fallback app name stays");
  assert.doesNotMatch(fly, /command\.everbornproductions\.com/);
});

test("appId, updater feed and installer names are unchanged", () => {
  const builder = read("electron-builder.yml");
  const main = read("electron/main.cjs");
  assert.match(builder, /appId: com\.everborn\.command/);
  assert.match(builder, /artifactName: "Meldmind-Setup-\$\{version\}\.\$\{ext\}"/);
  assert.match(builder, /repo: command-center-releases/);
  assert.match(main, /command-center-releases/);
  assert.match(read("docs/hosted-hub.md"), /https:\/\/hub\.meldmind\.ai\/\*\*/);
  assert.match(read("docs/hosted-hub.md"), /Site URL = `https:\/\/hub\.meldmind\.ai`/);
});
