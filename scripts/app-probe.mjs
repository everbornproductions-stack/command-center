// Which pages this build actually ships. The guide PDF uses the same check as the tour.
import fs from "node:fs";
import path from "node:path";
import { TYPES } from "../server/walkthroughs.js";

function skipString(src, i) {
  const q = src[i];
  i += 1;
  if (q === "`") {
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") return i + 1;
      if (src[i] === "$" && src[i + 1] === "{") { i = skipBlock(src, i + 1); continue; }
      i += 1;
    }
    return i;
  }
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i += 1;
  }
  return i;
}

function skipBlock(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

function registerBlock(src) {
  const at = src.search(/(?:window\.)?CC\.register\s*\(/);
  if (at < 0) return "";
  const start = src.indexOf("{", at);
  if (start < 0) return "";
  const end = skipBlock(src, start);
  return src.slice(start, end);
}

export function readAppProbe(root) {
  const index = fs.readFileSync(path.join(root, "web", "features", "index.js"), "utf8");
  const list = index.match(/const FEATURES = \[([^\]]*)\]/);
  if (!list) throw new Error("web/features/index.js is missing the FEATURES list");
  const names = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const features = new Set();
  const views = new Set(["command", "projects", "credits", "subscriptions", "settings", "setup", "help"]);
  for (const name of names) {
    const file = path.join(root, "web", "features", `${name}.js`);
    const src = fs.readFileSync(file, "utf8");
    const block = registerBlock(src);
    const id = block.match(/\bid\s*:\s*"([^"]+)"/);
    if (!id) throw new Error(`${name}.js is in FEATURES but has no CC.register id`);
    features.add(id[1]);
    if (/\btab\s*:/.test(block)) views.add(id[1]);
  }
  const app = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
  const builtinsMatch = app.match(/guideBuiltins\s*:\s*\[([^\]]*)\]/);
  const builtins = new Set(builtinsMatch ? [...builtinsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []);
  if (features.has("tour") || builtins.has("whats-new")) builtins.add("whats-new");
  return {
    features,
    views,
    walks: new Set(TYPES.map((t) => t.id)),
    builtins,
  };
}
