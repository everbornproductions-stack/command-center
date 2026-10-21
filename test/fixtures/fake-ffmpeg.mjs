// Copies the input file to the output path. Used as CC_FFMPEG_BIN in tests.
import fs from "node:fs";

const args = process.argv.slice(2);
const inputAt = args.indexOf("-i");
const input = inputAt >= 0 ? args[inputAt + 1] : "";
const output = args[args.length - 1];
if (!input || !output || output === input) process.exit(1);
fs.copyFileSync(input, output);
