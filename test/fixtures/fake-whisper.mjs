// Test stand-in for a local whisper program. It writes in.txt and exits.
// FAKE_WHISPER_FAIL=1 exits with an error so the server can try a connected AI.
import fs from "node:fs";

if (process.env.FAKE_WHISPER_FAIL === "1") process.exit(1);
const args = process.argv.slice(2);
const at = args.indexOf("--output_dir");
const dir = at >= 0 ? args[at + 1] : ".";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/in.txt`, "I want a connection for my calendar\n");
