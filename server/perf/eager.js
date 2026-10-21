// Static check: the main process and the server entry must not import a
// heavy tool. Local files (./ports.cjs) are fine. A require inside a
// function still counts in the entry files, because startup calls those
// functions. The registry may name the tool. It must not import it.

const HEAVY = [
  "playwright", "playwright-core", "puppeteer", "puppeteer-core", "lighthouse",
  "tesseract.js", "tesseract", "@xenova/transformers", "onnxruntime-node",
  "ffmpeg-static", "whisperx", "whisper", "piper-tts", "piper", "godot", "bevy",
  "postiz", "chatwoot", "docuseal", "sharp", "canvas",
];

export function isHeavySpecifier(spec) {
  const raw = String(spec || "").trim();
  if (!raw || raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("node:")) return false;
  const name = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];
  return HEAVY.some((h) => name === h || name.startsWith(`${h}-`));
}

function stripLine(line, block) {
  let text = line;
  let nextBlock = block;
  if (nextBlock) {
    const end = text.indexOf("*/");
    if (end < 0) return { code: "", block: true };
    text = text.slice(end + 2);
    nextBlock = false;
  }
  const start = text.indexOf("/*");
  if (start >= 0) {
    const end = text.indexOf("*/", start + 2);
    if (end < 0) {
      text = text.slice(0, start);
      nextBlock = true;
    } else {
      text = text.slice(0, start) + text.slice(end + 2);
    }
  }
  return { code: text.replace(/\/\/.*$/, ""), block: nextBlock };
}

function specifiersOn(code) {
  const out = [];
  const re = /require\(\s*["']([^"']+)["']\s*\)|from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1] || m[2] || m[3]);
  return out;
}

function depthDelta(code) {
  const bare = code.replace(/"(?:\\.|[^"\\])*"/g, "").replace(/'(?:\\.|[^'\\])*'/g, "").replace(/`(?:\\.|[^`\\])*`/g, "");
  let d = 0;
  for (const ch of bare) {
    if (ch === "{") d += 1;
    else if (ch === "}") d -= 1;
  }
  return d;
}

// Specifiers that run as soon as the file is loaded (brace depth 0).
export function eagerSpecifiers(source) {
  const hits = [];
  let depth = 0;
  let block = false;
  for (const raw of String(source || "").split(/\n/)) {
    const { code, block: next } = stripLine(raw, block);
    block = next;
    if (depth === 0) hits.push(...specifiersOn(code));
    depth = Math.max(0, depth + depthDelta(code));
  }
  return hits;
}

export function allSpecifiers(source) {
  const hits = [];
  let block = false;
  for (const raw of String(source || "").split(/\n/)) {
    const { code, block: next } = stripLine(raw, block);
    block = next;
    hits.push(...specifiersOn(code));
  }
  return hits;
}

export function heavySpecifiers(list) {
  return (list || []).filter(isHeavySpecifier);
}
