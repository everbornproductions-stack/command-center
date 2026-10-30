// "Save as files" (0.4.21): turn the fenced code blocks of an answer into named files. Pure helpers, no disk.
// A block gets its name from the fence line (```js app.js, ```html:index.html, title="app.js"), from the line
// just above it (**app.py**, `app.py`, File: app.py, ### app.py), or from a first-line comment. Else code-1.js.
const EXT = {
  js: "js", javascript: "js", mjs: "mjs", jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx", json: "json", html: "html", css: "css",
  py: "py", python: "py", sh: "sh", bash: "sh", shell: "sh", zsh: "sh", ps1: "ps1", powershell: "ps1", bat: "bat", sql: "sql", yaml: "yml", yml: "yml",
  md: "md", markdown: "md", java: "java", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs", csharp: "cs", go: "go", rs: "rs", rust: "rs", rb: "rb", ruby: "rb",
  php: "php", swift: "swift", kt: "kt", kotlin: "kt", xml: "xml", toml: "toml", ini: "ini", env: "env", txt: "txt", text: "txt", csv: "csv", vue: "vue", svelte: "svelte",
};
const NAME_RE = /^[\w][\w./-]{0,80}\.[A-Za-z0-9]{1,8}$/;
/** The file type a fence language stands for ("javascript" is js, "powershell" is ps1), or "". */
export const langExt = (lang) => EXT[String(lang || "").toLowerCase().replace(/\.$/, "")] || "";

export function safeFileName(n) {
  const parts = String(n || "").replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").slice(-3);
  const clean = parts.map((p) => p.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 80)).filter(Boolean);
  const last = clean.join("/");
  return NAME_RE.test(last) ? last : "";
}

function nameFromInfo(info) {
  const title = /(?:title|file(?:name)?)\s*=\s*["']?([^"'\s]+)["']?/i.exec(info);
  if (title && safeFileName(title[1])) return safeFileName(title[1]);
  for (const tok of String(info).split(/[\s:]+/)) if (tok && NAME_RE.test(tok) && safeFileName(tok)) return safeFileName(tok);
  return "";
}
function nameFromAbove(line) {
  // 0.4.27 (dogfood batch 2): "## invoice_totals.py" was read as "totals.py" because every "_" was dropped.
  // Only an "_" used for emphasis (at the start or end of a word) is markdown.
  // 0.4.28 (dogfood task-schedule): "**File:** `C:\Users\me\desktop-cleanup.ps1`" names desktop-cleanup.ps1 (a full Windows path)
  const t = String(line || "").trim().replace(/[*`#>]/g, " ").replace(/(^|\s)_+|_+(?=\s|$)/g, "$1 ").replace(/(?:^|\s)[A-Za-z]:\\(?:[^\\\s]+\\)*(?=[^\\\s]+\.[A-Za-z0-9]{1,8}\b)/g, " ");
  if (!t || t.length > 140) return "";
  const m = /(?:^|[\s(:])([\w][\w./-]{0,80}\.[A-Za-z0-9]{1,8})(?=[\s):,.]*$)/.exec(t);
  return m && safeFileName(m[1]) ? safeFileName(m[1]) : "";
}
function nameFromFirstLine(code) {
  const first = String(code).split("\n", 1)[0];
  const m = /^(?:\/\/|#|--|<!--|\/\*)\s*(?:file(?:name)?\s*:?\s*)?([\w][\w./-]{0,80}\.[A-Za-z0-9]{1,8})\s*(?:-->|\*\/)?\s*$/i.exec(first.trim());
  return m && safeFileName(m[1]) ? safeFileName(m[1]) : "";
}

// -> [{ name, lang, text }]
export function extractCodeFiles(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const found = [];
  const used = new Set();
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(```+|~~~+)\s*([^\n`]*)$/.exec(lines[i]);
    if (!open) continue;
    const info = open[2].trim();
    const body = [];
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^\\s*${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}\\s*$`).test(lines[j])) { body.push(lines[j]); j++; }
    const code = body.join("\n");
    let above = "";
    for (let k = i - 1; k >= 0 && k >= i - 3; k--) if (lines[k].trim()) { above = lines[k]; break; }
    const lang = (/^[\w+#.-]+/.exec(info) || [""])[0].toLowerCase();
    if (code.trim()) {
      n++;
      let name = nameFromInfo(info) || nameFromAbove(above) || nameFromFirstLine(code);
      if (!name) name = `code-${n}.${EXT[lang.replace(/\.$/, "")] || "txt"}`;
      let unique = name, c = 2;
      while (used.has(unique.toLowerCase())) { unique = name.replace(/(\.[^./]+)?$/, (e) => `-${c}${e || ""}`); c++; }
      used.add(unique.toLowerCase());
      found.push({ name: unique, lang, text: code.endsWith("\n") ? code : `${code}\n` });
    }
    i = j;
  }
  return found;
}

// ---- 0.4.27 (dogfood batch 2): the body of one named file, looked for in several answers ----
// The assembler dropped the code ("Not saved: there was no code for invoice_totals.py in this answer") while the
// step that wrote it had it. texts: [{ text, from }] in the order to look (the final answer, then each finished
// step, newest first). A block named for the file wins anywhere; else, per text, the one block in the file's
// language, a whole HTML page (the biggest complete one), or for a .csv a Markdown table.
const extOf = (n) => (/\.([A-Za-z0-9]{1,6})$/.exec(String(n || "")) || ["", ""])[1].toLowerCase();
const baseOf = (n) => String(n || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
const langsFor = (ext) => Object.keys(EXT).filter((l) => EXT[l] === ext).concat(ext === "cmd" ? ["bat", "batch", "cmd"] : ext === "bat" ? ["batch", "cmd"] : []);
const csvCell = (c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
/** The first Markdown table in the text as CSV, or "". */
export function markdownTableToCsv(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const row = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1"));
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) continue;
    const head = row(lines[i]);
    const out = [head];
    for (let j = i + 2; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]); j++) out.push(row(lines[j]));
    if (out.length < 2) continue;
    return out.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  }
  return "";
}
// ---- 0.4.28 (dogfood task-schedule): the main block when several are in the file's language ----
// "Save it as desktop-cleanup.ps1": the AI named its script Register-And-Run-DesktopCleanup.ps1 in a sentence and
// added three one-line usage snippets in ```powershell too. The script is the main block: the biggest one, when it is
// clearly bigger (3 times the lines of any other), or the only one that is a real program (param(, def main, a
// function, a class) and still the biggest. Two blocks of about the same size stay a question, never a guess.
const MAIN_MARK = /\bparam\s*\(|\[CmdletBinding|^\s*def\s+main\b|^\s*(?:async\s+)?function\b|^\s*def\s+\w+\s*\(|^\s*class\s+\w+|if\s+__name__\s*==|module\.exports|^\s*export\s+(?:default|function|const|class)\b/m;
const lineCount = (b) => String(b?.text || "").split("\n").filter((l) => l.trim()).length;
/** The one main block of several, or null when it is not clear which is the file. */
export function mainBlock(blocks = []) {
  const list = (blocks || []).filter((b) => b && String(b.text || "").trim());
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const sorted = [...list].sort((a, b) => lineCount(b) - lineCount(a));
  const [big, next] = sorted;
  if (lineCount(big) >= 3 * Math.max(1, lineCount(next))) return big;
  if (MAIN_MARK.test(big.text) && !sorted.slice(1).some((b) => MAIN_MARK.test(b.text)) && lineCount(big) >= 1.5 * lineCount(next)) return big;
  return null;
}

// ---- 0.4.28 (dogfood tip-split): a block of plain sentences is not code ----
// tipsplit.test.js was replaced by an 18-byte block "All tests passed." taken from the run step's answer.
const STRICT_CODE_EXT = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "ps1", "sh", "bat", "cmd", "json", "css", "sql", "gs", "java", "go", "rb", "php", "c", "cpp", "cs", "rs", "swift", "kt", "html", "htm", "xml", "svg", "yml", "yaml"]);
const CODE_LINE = /[{}();=[\]$<>|]|^(?:#!|\/\/|--|\/\*|\*\/|@echo)|^(?:import|from|export|const|let|var|function|def|class|return|if|elif|else|for|foreach|while|param|require|use|package|public|private|echo|set|print|async|await|try|catch|select|insert|create|update|delete)\b|^[A-Z][a-z]+-[A-Z]\w+/i;
/** Does this body look like code of that file type? Text files (md, txt, csv ...) always pass. */
export function looksLikeCode(text, ext = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  const e = String(ext || "").toLowerCase();
  if (!STRICT_CODE_EXT.has(e)) return true;
  if (e === "json") { try { JSON.parse(t); return true; } catch { return /^[{[]/.test(t); } }
  if (["html", "htm", "xml", "svg"].includes(e)) return /<[a-z!?][^>]*>/i.test(t);
  if (e === "yml" || e === "yaml") return /^\s*(?:[\w"'-][^:\n]*:(?:\s|$)|-\s)/m.test(t);
  return t.split("\n").map((l) => l.trim()).filter(Boolean).some((l) => CODE_LINE.test(l) && !/^[A-Z][^{}();=[\]$<>|]*[.!?]$/.test(l));
}

/** { body, from, how } for the file `name`, or null when no answer holds it clearly. */
export function bodyForFile(name, texts = []) {
  const want = baseOf(name), ext = extOf(name);
  if (!want || !ext) return null;
  const list = (Array.isArray(texts) ? texts : []).map((x) => (typeof x === "string" ? { text: x, from: null } : x)).filter((x) => x && String(x.text || "").trim());
  const parsed = list.map((s) => ({ ...s, blocks: extractCodeFiles(s.text) }));
  for (const s of parsed) {
    const b = s.blocks.find((x) => baseOf(x.name) === want);
    if (b) return { body: b.text, from: s.from ?? null, how: "named" };
  }
  if (ext === "html" || ext === "htm") {
    let best = null;
    for (const s of parsed) {
      const docs = [...s.blocks.map((b) => b.text), String(s.text)].map((t) => (/(<!doctype html[\s\S]*?<\/html\s*>|<html[\s\S]*?<\/html\s*>)/i.exec(t) || [])[1]).filter(Boolean);
      for (const d of docs) if (!best || d.length > best.body.length) best = { body: d.trim() + "\n", from: s.from ?? null, how: "page" };
    }
    return best;
  }
  const langs = langsFor(ext);
  if (ext === "txt") return null; // a ```text block is usually sample output, not the file
  for (const s of parsed) {
    const same = s.blocks.filter((b) => langs.includes(b.lang) || (/^code-\d+\./.test(b.name) && extOf(b.name) === ext));
    if (same.length === 1) return { body: same[0].text, from: s.from ?? null, how: "language" };
    // 0.4.28: several blocks in the language and none named for the file: the clear main block, saved under the asked name
    const main = same.length > 1 ? mainBlock(same.filter((b) => /^code-\d+\./.test(b.name) || extOf(b.name) === ext)) : null;
    if (main) return { body: main.text, from: s.from ?? null, how: "main" };
  }
  // a table only when no answer has a CSV block at all (a "expected totals" table is not the data file)
  if (ext === "csv" && !parsed.some((s) => s.blocks.some((b) => langs.includes(b.lang)))) {
    for (const s of parsed) {
      const csv = markdownTableToCsv(s.text.replace(/```[\s\S]*?```/g, ""));
      if (csv) return { body: csv, from: s.from ?? null, how: "table" };
    }
  }
  return null;
}
