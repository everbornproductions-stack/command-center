// A play preview for a remix (0.4.21): the generated page as ONE self-contained document, so it can run in a
// sandboxed frame (scripts allowed, no network origin, no access to Meldmind). Local scripts, styles and small
// pictures are folded in; anything that points outside the folder is left out. Pure file reading, nothing runs here.
import fs from "node:fs";
import path from "node:path";

const MAX_FILE = 1.5 * 1024 * 1024;
const MAX_TOTAL = 4 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

function inside(folder, rel) {
  const clean = String(rel || "").replace(/^\.\//, "").replace(/[?#].*$/, "");
  if (!clean || /^(?:[a-z]+:|\/\/|\/)/i.test(clean) || clean.split(/[\\/]/).includes("..")) return null;
  const full = path.resolve(folder, clean);
  if (!full.startsWith(path.resolve(folder) + path.sep)) return null;
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_FILE) return null;
    // a real path check too, so a symlinked folder cannot lead outside
    if (!fs.realpathSync(full).startsWith(fs.realpathSync(folder) + path.sep)) return null;
  } catch { return null; }
  return full;
}

export function inlinePage(folder) {
  const index = path.join(folder, "index.html");
  if (!fs.existsSync(index)) return { ok: false, error: "This project has no index.html to play yet." };
  let html = fs.readFileSync(index, "utf8");
  let total = Buffer.byteLength(html);
  const used = ["index.html"];
  const take = (rel) => {
    const f = inside(folder, rel);
    if (!f) return null;
    const buf = fs.readFileSync(f);
    if (total + buf.length > MAX_TOTAL) return null;
    total += buf.length;
    used.push(String(rel).replace(/^\.\//, ""));
    return { buf, ext: path.extname(f).toLowerCase() };
  };
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (all, a, src, b) => {
    const got = take(src);
    return got ? `<script${a}${b}>\n${got.buf.toString("utf8").replace(/<\/script/gi, "<\\/script")}\n</script>` : all;
  });
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (all) => {
    const href = /href=["']([^"']+)["']/i.exec(all)?.[1];
    const got = href ? take(href) : null;
    return got ? `<style>\n${got.buf.toString("utf8").replace(/<\/style/gi, "<\\/style")}\n</style>` : all;
  });
  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (all, a, src, c) => {
    const got = take(src);
    return got && MIME[got.ext] ? `${a}data:${MIME[got.ext]};base64,${got.buf.toString("base64")}${c}` : all;
  });
  return { ok: true, html, bytes: total, files: used };
}
