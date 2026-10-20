// Minify the renderer (web/*.js and web/*.css) for a packaged build, then put the
// source bytes back. Tests and `npm start` keep the readable files.
//
// bytenode is not used. Compiling to V8 bytecode is tied to one Electron ABI, so
// the next Electron bump refuses to load it, and bytenode does not load ESM.
// server/index.js and the renderer are ESM. Minify is the step that ships.
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";

const EXT = /\.(js|mjs|cjs|css)$/;

export function rendererFiles(dir) {
  const out = [];
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, rel.toString());
    if (!fs.statSync(file).isFile()) continue;
    if (EXT.test(file)) out.push(file);
  }
  return out.sort();
}

// Minify every renderer file under dir. Returns a restore function.
// A failure puts back anything already written and throws.
export function minifyWeb(dir) {
  const backups = new Map();
  const restore = () => {
    for (const [file, buf] of backups) fs.writeFileSync(file, buf);
  };
  restore.count = 0;
  try {
    for (const file of rendererFiles(dir)) {
      const buf = fs.readFileSync(file);
      backups.set(file, buf);
      const loader = file.endsWith(".css") ? "css" : "js";
      let out;
      try {
        out = esbuild.transformSync(buf.toString("utf8"), {
          loader,
          minify: true,
          legalComments: "none",
          target: "es2022",
          charset: "utf8",
        });
      } catch (e) {
        throw new Error(`Could not minify ${path.relative(dir, file)}: ${e.message || e}`);
      }
      fs.writeFileSync(file, out.code);
      restore.count += 1;
    }
  } catch (e) {
    restore();
    throw e;
  }
  return restore;
}
