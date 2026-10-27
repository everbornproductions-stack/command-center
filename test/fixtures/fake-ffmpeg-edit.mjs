// Stand-in for ffmpeg in the video editor tests (CC_FFMPEG_BIN). With only "-i file" it prints probe lines
// and exits 1, like the real tool. Otherwise it logs its arguments and writes the last argument as the output.
// FAKE_FFMPEG_LOG: file to append one JSON line of arguments to. FAKE_FFMPEG_SLOW: ms to wait before writing.
import fs from "node:fs";

const args = process.argv.slice(2);
const out = args[args.length - 1];
const isRender = args.includes("-filter_complex");
if (!isRender) {
  process.stderr.write("Input #0, mov,mp4, from 'x':\n  Duration: 00:00:10.00, start: 0.000000, bitrate: 800 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps\n  Stream #0:1: Audio: aac, 44100 Hz, stereo\n");
  process.exit(1);
}
if (process.env.FAKE_FFMPEG_LOG) fs.appendFileSync(process.env.FAKE_FFMPEG_LOG, JSON.stringify({ args, cwd: process.cwd(), ass: fs.existsSync("subs.ass") ? fs.readFileSync("subs.ass", "utf8") : "" }) + "\n");
const slow = Number(process.env.FAKE_FFMPEG_SLOW) || 0;
setTimeout(() => {
  process.stderr.write("time=00:00:02.00 bitrate=1\n");
  fs.writeFileSync(out, "FAKE-MP4");
  process.exit(0);
}, slow);
