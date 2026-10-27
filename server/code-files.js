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
  const t = String(line || "").trim().replace(/[*_`#>]/g, " ");
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
