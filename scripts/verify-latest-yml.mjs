// Confirm latest.yml was written from the installer that will be published.
// electron-builder signs first and writes the hash second. This check refuses
// a release whose hash does not match that file. Secret values are not printed.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { verifyInstallerFeed } = require("./windows-signing.cjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = path.join(root, ".windows-signing-mode");
const markerText = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8") : "";

const result = await verifyInstallerFeed({
  dir: path.join(root, "dist"),
  env: process.env,
  platform: process.platform,
  markerText,
});

if (!result.ok) {
  for (const line of result.errors) console.error(line);
  process.exit(1);
}
console.log(result.summary);
