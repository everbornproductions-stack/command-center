// 0.4.27 (dogfood batch 1): "Save it as C:\Users\me\Desktop\leads.csv" saved the file in Meldmind's own
// project folder and nowhere else, so the person never found it where they asked. Now a copy also goes to
// the folder the person named in their own words, when that folder is inside their user folder and is not
// an app or system folder. The project copy stays (MindMedia, preview and history read it from there).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN_PATH_RE = /([A-Za-z]:\\(?:[^\\\/:*?"<>|\r\n]+\\)*[^\\\/:*?"<>|\r\n]*)/g;
const BLOCKED = /\\(?:appdata|program files|program files \(x86\)|windows|programdata)(?:\\|$)/i;

// The folder the goal names (a full Windows path), or "" when it names none or one we will not write to.
export function askedFolder(goal = "", { home = os.homedir() } = {}) {
  const hits = String(goal || "").match(WIN_PATH_RE) || [];
  for (let raw of hits) {
    raw = raw.replace(/[\s.,;:!)\]]+$/, "").replace(/\s+(?:as|and|in|with|then)\s.*$/i, "");
    if (!raw) continue;
    const dir = /\.[a-z0-9]{1,5}$/i.test(path.basename(raw)) ? path.dirname(raw) : raw;
    const full = path.resolve(dir);
    const root = path.resolve(home);
    if (full.toLowerCase() !== root.toLowerCase() && !full.toLowerCase().startsWith(root.toLowerCase() + path.sep)) continue;
    if (BLOCKED.test(full.slice(root.length))) continue;
    return full;
  }
  return "";
}

// Copy saved files into the asked folder. Never overwrites: name-2.ext, name-3.ext. Returns what was copied.
export function copyToAskedFolder(folder, files = []) {
  if (!folder) return [];
  const out = [];
  for (const f of files) {
    if (!f?.path || !fs.existsSync(f.path)) continue;
    try {
      fs.mkdirSync(folder, { recursive: true });
      const name = path.basename(f.name || f.path);
      const base = name.replace(/\.[^.]+$/, ""), ext = path.extname(name);
      let dest = path.join(folder, name);
      if (path.resolve(dest).toLowerCase() === path.resolve(f.path).toLowerCase()) { out.push({ name, path: dest }); continue; }
      for (let n = 2; fs.existsSync(dest) && n < 200; n++) dest = path.join(folder, `${base}-${n}${ext}`);
      fs.copyFileSync(f.path, dest);
      out.push({ name: path.basename(dest), path: dest });
    } catch (e) { out.push({ name: path.basename(f.name || f.path), error: `Could not copy to ${folder}: ${String(e.message || e).slice(0, 120)}` }); }
  }
  return out;
}
