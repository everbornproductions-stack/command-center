// Safety check for what a customer built (website, app, game mod, script). Runs before Publish and before a
// download. Everything here is local and built in: no scanner to install, no network, no code leaves the PC.
//   runSafetyCheck({ files: [{ path, text }] | dir, now }) -> { light, groups, ignored, summary, checkedAt, ... }
//   applySafetyFix({ files, fixId })  -> patched file texts (never writes) plus a fresh rescan
//   runSafetyCheckOsv({ ..., osvFetch })  optional online lookup, OFF unless osvFetch is passed; it is given
//                                         package names and versions only, never code
// Four ideas copied from the Aikido first scan (security/AIKIDO-FIRST-SCAN.md): many similar hits become ONE
// group, secrets in test files are downgraded, noise is auto-ignored with a stated reason, and every group has
// a short plain TL;DR. Secret values are never stored or returned, only the first 3 characters + "****".
import fs from "node:fs";
import path from "node:path";

const ADVISORIES = (() => {
  try { return JSON.parse(fs.readFileSync(new URL("./safety-advisories.json", import.meta.url), "utf8")).advisories || []; }
  catch { return []; }
})();

export const FIX_NOTE = "If this key was ever shared or published, change it at its website, because it may already be seen.";
const MAX_FILES = 600, MAX_BYTES = 400 * 1024, MAX_FILES_PER_GROUP = 20;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "media", "vendor", "__pycache__", ".venv"]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|mp[34]|mov|webm|wav|ogg|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|woff2?|ttf|otf|eot|class|jar|bin|dat|db|sqlite)$/i;
const JS_EXT = /\.(?:js|mjs|cjs|ts|jsx|tsx)$/i;
const NODE_ENV_EXT = /\.(?:js|mjs|cjs|ts)$/i;
const HTML_EXT = /\.(?:html?|vue|svelte)$/i;
const CODE_EXT = /\.(?:js|mjs|cjs|ts|jsx|tsx|html?|vue|svelte)$/i;
const SEV_RANK = { high: 0, medium: 1, low: 2 };

export const mask = (v) => `${String(v).slice(0, 3)}****`;
const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
const isTestPath = (p) => /(^|\/)(tests?|__tests__|__mocks__|spec|specs|fixtures?|mocks?|e2e|cypress)\//i.test(p) || /\.(test|spec)\.[a-z0-9]+$/i.test(p);
const isExamplePath = (p) => /\.(example|sample|template)$/i.test(p) || /(^|\/)(examples?|samples?)\//i.test(p);
const isEnvPath = (p) => /(^|\/)\.env(\.[\w-]+)?$/i.test(p) && !isExamplePath(p);
const isBundled = (p) => /(^|\/)(node_modules|vendor|dist|build|\.git)\//i.test(p) || /\.min\.(js|css)$/i.test(p) || /\.map$/i.test(p);

// ---------- reading ----------
function readDir(dir) {
  const out = [], root = path.resolve(dir);
  const walk = (d, depth) => {
    if (depth > 8 || out.length >= MAX_FILES) return;
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile() || BINARY_EXT.test(e.name)) continue;
      try {
        if (fs.statSync(full).size > MAX_BYTES) { out.push({ path: norm(path.relative(root, full)), text: "", tooBig: true }); continue; }
        out.push({ path: norm(path.relative(root, full)), text: fs.readFileSync(full, "utf8") });
      } catch { /* unreadable file: skipped */ }
    }
  };
  walk(root, 0);
  return out;
}

export function loadFiles(dir) { return readDir(dir); }

function normalizeFiles(files) {
  return (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.path === "string" && !BINARY_EXT.test(f.path))
    .slice(0, MAX_FILES)
    .map((f) => ({ path: norm(f.path), text: String(f.text ?? "").replace(/\r\n/g, "\n"), tooBig: !!f.tooBig || String(f.text ?? "").length > MAX_BYTES }));
}

// ---------- helpers ----------
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return { line: lo + 1, start: starts[lo] }; };
}
function entropy(s) {
  const n = s.length; if (!n) return 0;
  const c = {}; for (const ch of s) c[ch] = (c[ch] || 0) + 1;
  return -Object.values(c).reduce((a, k) => a + (k / n) * Math.log2(k / n), 0);
}
const PLACEHOLDER_RE = /fake|test|example|sample|dummy|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|xxxx|changeme|change[-_ ]me|placeholder|redacted|<[^>]+>|\.\.\.|todo|replace|insert[-_ ]|mock|\$\{|\{\{/i;
function looksPlaceholder(v) {
  if (PLACEHOLDER_RE.test(v)) return true;
  if (/(.)\1{5,}/.test(v)) return true;
  if (new Set(v.replace(/^[a-z]{1,4}[-_]/i, "")).size <= 4) return true;
  return false;
}
const snippetOf = (lineText, col, width = 150) => {
  const t = lineText.replace(/\t/g, " ");
  if (t.length <= width) return t.trim();
  const from = Math.max(0, col - 50);
  return (from > 0 ? "..." : "") + t.slice(from, from + width).trim() + "...";
};

// ---------- (a) secrets ----------
const KEY_SHAPES = [
  { kind: "openai-style", label: "AI service key", name: "API_KEY", re: /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "google", label: "Google key", name: "GOOGLE_API_KEY", re: /AIza[0-9A-Za-z_-]{35}/g },
  { kind: "github", label: "GitHub token", name: "GITHUB_TOKEN", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: "slack", label: "Slack token", name: "SLACK_TOKEN", re: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws", label: "Amazon access key", name: "AWS_ACCESS_KEY_ID", re: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g },
];
const PRIVATE_KEY_RE = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g;
const ASSIGN_RE = /([A-Za-z_][\w.-]*?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)[\w-]*)(["']?\s*[:=]\s*)(["'])([^"'\s]{8,})\3/gi;
const ENV_LINE_RE = /^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*)[ \t]*=[ \t]*([^\s#"']{16,})[ \t]*$/gm;

const upperName = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();

// Internal: raw hits WITH the value (never leaves this module except through applySafetyFix's patched text).
function scanSecrets(file) {
  const { path: p, text } = file;
  const at = lineIndex(text), hits = [], taken = [];
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
  const lineText = (start) => { const e = text.indexOf("\n", start); return text.slice(start, e < 0 ? text.length : e); };
  const push = (h) => {
    const { line, start: ls } = at(h.start);
    const test = isTestPath(p), example = isExamplePath(p);
    let ignoreReason = "";
    if (h.placeholder || example) ignoreReason = example && !h.placeholder ? "Example file, values here are meant to be fake" : "Looks like a placeholder, not a real key";
    hits.push({ ...h, path: p, line, col: h.start - ls, lineText: lineText(ls), test, ignoreReason, live: !ignoreReason && !test });
    taken.push([h.start, h.end]);
  };
  for (const s of KEY_SHAPES) {
    for (const m of text.matchAll(s.re)) push({ kind: s.kind, label: s.label, name: s.name, start: m.index, end: m.index + m[0].length, value: m[0], placeholder: looksPlaceholder(m[0]) });
  }
  for (const m of text.matchAll(PRIVATE_KEY_RE)) push({ kind: "private-key", label: "Private key block", name: "PRIVATE_KEY", start: m.index, end: m.index + m[0].length, value: m[0], placeholder: false, noFix: true });
  for (const m of text.matchAll(ASSIGN_RE)) {
    const varName = m[1], value = m[4];
    const start = m.index + m[0].length - 1 - value.length, end = start + value.length;
    if (overlaps(start, end)) continue;
    if (/^(?:https?:|\/|\.{1,2}\/|[\w-]+\.(?:js|json|html|css)$)/i.test(value)) continue;
    const pw = /pass|pwd/i.test(varName);
    const placeholder = looksPlaceholder(value);
    if (pw ? value.length < 12 : value.length < 16 || (!placeholder && entropy(value) < 3.5)) continue;
    push({ kind: pw ? "password" : "secret-value", label: pw ? "Password" : "Secret value", name: upperName(varName) || "SECRET_VALUE", start, end, value, placeholder });
  }
  if (isEnvPath(p) || isExamplePath(p) || /\.env$/i.test(p)) {
    for (const m of text.matchAll(ENV_LINE_RE)) {
      const start = m.index + m[0].length - m[2].length - (m[0].length - m[0].trimEnd().length), end = start + m[2].length;
      if (overlaps(start, end)) continue;
      push({ kind: "secret-value", label: "Secret value", name: m[1], start, end, value: m[2], placeholder: looksPlaceholder(m[2]), noFix: true });
    }
  }
  return hits;
}

// A line with every secret value replaced, so it can be shown.
function redactLine(lineText, hits) {
  let t = lineText;
  for (const h of hits) if (h.value && t.includes(h.value)) t = t.split(h.value).join(mask(h.value));
  for (const s of KEY_SHAPES) t = t.replace(s.re, (v) => mask(v));
  t = t.replace(ASSIGN_RE, (all, n, mid, q, v) => (v.length >= 12 && !/^https?:/.test(v) ? `${n}${mid}${q}${mask(v)}${q}` : all));
  return t;
}

// ---------- (c) code rules ----------
const LOCAL_HOST = "(?!localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])";
const ESCAPED_CALL = /^\s*(?:window\.)?(?:esc\w*|escape\w*|sanitize\w*|DOMPurify\.sanitize|encodeURIComponent|textContent)\(/;
const KNOWN_HTTPS_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "ajax.googleapis.com", "www.googletagmanager.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "code.jquery.com", "maxcdn.bootstrapcdn.com", "stackpath.bootstrapcdn.com", "stackpath.bootstrapcdn.com", "www.youtube.com", "player.vimeo.com", "platform.twitter.com", "github.com", "raw.githubusercontent.com", "www.google.com", "www.gstatic.com", "use.fontawesome.com", "kit.fontawesome.com"];
const KNOWN_RE = new RegExp(`http://(${KNOWN_HTTPS_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})(?=[/:"'\\s)>?#]|$)`, "gi");

export const RULES = {
  "code-eval": { title: "Code that runs text as a program (eval or new Function)", tldr: "Your code turns text into a running program. If any of that text can come from a visitor, they could run their own code. Use plain data (JSON) instead." },
  "code-html": { title: "Page content built from a variable (innerHTML or document.write)", tldr: "Your code puts a variable straight into the page as HTML. If it can hold text typed by someone else, they could add their own script. Use textContent, or clean the text first." },
  "code-exec": { title: "A command line built from text (exec with a template string)", tldr: "Your code builds a command from pieces of text and runs it in a shell. Odd text could add extra commands. Pass the pieces as a list (spawn or execFile) instead." },
  "form-http": { title: "Information sent over http://, not https://", tldr: "A form or request sends what a visitor typed over a plain, unlocked connection. Anyone on the same network could read it. Use https://." },
  "admin-password": { title: "A password written into the code", tldr: "An admin or default password is written in your files, so anyone who gets the files can sign in. Store it outside the code and use a strong one." },
  "cors-open": { title: "Any website can read signed-in answers (CORS * with credentials)", tldr: "Your server allows every website to call it while sending login cookies. Name the exact sites you trust instead of *." },
  "mixed-content": { title: "A https:// page loads something over http://", tldr: "Your page loads an image, script or style over an unlocked connection. Browsers may block it and others can change it on the way. Switch the link to https://." },
  "site-csp": { title: "Page has no Content-Security-Policy tag", tldr: "Pages with this tag tell the browser which sources it may load, which blocks most injected scripts. Adding one is a safe, small step." },
};
const FALSE_ALARM = new Set(["code-eval", "code-html", "code-exec", "admin-password", "cors-open"]);

const plainString = (r) => /^(["'])(?:(?!\1)[^\\]|\\.)*\1$/.test(r) || /^`[^`$]*`$/.test(r);
function rhsAt(text, idx) {
  let r = text.slice(idx).replace(/^\s+/, "");
  if (r.startsWith("`")) { let i = 1; while (i < r.length && i < 4000 && !(r[i] === "`" && r[i - 1] !== "\\")) i++; return r.slice(0, i + 1); }
  const nl = r.indexOf("\n"); return (nl < 0 ? r : r.slice(0, nl)).trim().replace(/;\s*$/, "");
}
// "dynamic" = not a plain string. Returns "yes", "escaped" (every inserted value is cleaned) or "no".
function dynamicRhs(rhs) {
  const r = rhs.trim();
  if (!r || plainString(r)) return "no";
  if (ESCAPED_CALL.test(r) && /\)\s*;?$/.test(r) && (r.match(/\(/g) || []).length === (r.match(/\)/g) || []).length && !/[+]/.test(r)) return "escaped";
  if (r.startsWith("`")) {
    const exprs = [...r.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]);
    if (exprs.length && exprs.every((e) => ESCAPED_CALL.test(e) || /^\s*["'`][^"'`]*["'`]\s*$/.test(e) || /^\s*\d+\s*$/.test(e))) return "escaped";
    if (!exprs.length) return "no";
  }
  return "yes";
}

function scanCode(file, hasChildProcess) {
  const { path: p, text } = file, out = [];
  if (!CODE_EXT.test(p)) return out;
  const at = lineIndex(text), lines = text.split("\n");
  const add = (rule, i, col, extra = {}) => out.push({ rule, path: p, line: i + 1, col, lineText: lines[i], ...extra });
  let off = 0;
  const corsWild = [];
  lines.forEach((ln, i) => {
    const base = off; off += ln.length + 1;
    const t = ln.trim();
    if (!t || /^(\/\/|\/\*|\*|<!--|#)/.test(t)) return;
    // eval / new Function
    for (const m of ln.matchAll(/(?<![\w.$])(?:eval\s*\(|new\s+Function\s*\()/g)) {
      const args = ln.slice(m.index + m[0].length).match(/^([^)]*)\)/)?.[1] ?? "x";
      if (!/^\s*(["'`])[^"'`$]*\1\s*(,\s*(["'`])[^"'`$]*\3\s*)*$/.test(args)) add("code-eval", i, m.index);
    }
    // innerHTML / outerHTML / insertAdjacentHTML / document.write
    const h = /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)/.exec(ln);
    if (h) { const d = dynamicRhs(rhsAt(text, base + h.index + h[0].length)); if (d !== "no") add("code-html", i, h.index, d === "escaped" ? { ignoreReason: "Every inserted value is cleaned first" } : {}); }
    const ia = /\.insertAdjacentHTML\s*\(\s*["'][a-z]+["']\s*,/.exec(ln);
    if (ia) { const d = dynamicRhs(rhsAt(text, base + ia.index + ia[0].length)); if (d !== "no") add("code-html", i, ia.index, d === "escaped" ? { ignoreReason: "Every inserted value is cleaned first" } : {}); }
    const dw = /document\.write(?:ln)?\s*\(/.exec(ln);
    if (dw) { const d = dynamicRhs(rhsAt(text, base + dw.index + dw[0].length).replace(/\)\s*;?$/, "")); if (d !== "no") add("code-html", i, dw.index, d === "escaped" ? { ignoreReason: "Every inserted value is cleaned first" } : {}); }
    // exec with a template string
    if (hasChildProcess) {
      const ex = /(?:(?<![\w.$])|(?:child_process|cp|childProcess)\.)(?:exec|execSync)\s*\(\s*(`[^`]*\$\{|["'][^"']*["']\s*\+|[A-Za-z_$][\w$.]*\s*\+)/.exec(ln);
      if (ex) add("code-exec", i, ex.index);
    }
    // http:// forms and posts
    const fm = new RegExp(`<form\\b[^>]*\\baction=["']http://${LOCAL_HOST}`, "i").exec(ln);
    if (fm) add("form-http", i, fm.index, { knownHost: new RegExp(KNOWN_RE.source, "i").test(ln) });
    const fp = new RegExp(`(?:fetch|axios\\.post|\\.post)\\(\\s*["'\`]http://${LOCAL_HOST}`, "i").exec(ln);
    if (fp && /post/i.test(ln)) add("form-http", i, fp.index, { knownHost: new RegExp(KNOWN_RE.source, "i").test(ln) });
    // hard-coded admin password
    if (/\b(?:admin\w*(?:pass|pwd)\w*|(?:pass|pwd)\w*admin\w*|root_?pass\w*)["']?\s*[:=]+\s*["'][^"']+["']/i.test(ln) || /\bpass(?:word)?["']?\s*[:=]+\s*["'](?:admin|root|password|123456|admin123|letmein)["']/i.test(ln)) add("admin-password", i, 0);
    // wide-open CORS
    if (/Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']/i.test(ln) || /\borigin\s*:\s*["']\*["']/.test(ln)) corsWild.push(i);
    // mixed content: html only
    if (HTML_EXT.test(p)) {
      const mx = new RegExp(`(?:\\b(?:src|srcset|data-src)=|<link\\b[^>]*\\bhref=)["']http://${LOCAL_HOST}`, "i").exec(ln);
      if (mx) add("mixed-content", i, mx.index, { knownHost: new RegExp(KNOWN_RE.source, "i").test(ln) });
    }
  });
  if (corsWild.length && /(?:Allow-Credentials["']?\s*[,:]\s*["']?true|credentials\s*:\s*true)/i.test(text)) for (const i of corsWild) add("cors-open", i, 0);
  void at;
  return out;
}

// ---------- (d) site headers ----------
function siteHasHeaderConfig(files) {
  return files.some((f) => /(^|\/)(_headers|vercel\.json|netlify\.toml|\.htaccess|nginx\.conf|firebase\.json)$/i.test(f.path) && /content-security-policy/i.test(f.text));
}
function scanSite(files) {
  const out = [];
  if (siteHasHeaderConfig(files)) return out;
  for (const f of files) {
    if (!/\.html?$/i.test(f.path) || !/<head[\s>]/i.test(f.text)) continue;
    if (/http-equiv\s*=\s*["']?content-security-policy/i.test(f.text)) continue;
    out.push({ rule: "site-csp", path: f.path, line: 1, col: 0, lineText: "No Content-Security-Policy tag in this page", fixable: true });
  }
  return out;
}

// ---------- (b) dependencies ----------
function parseVer(v) {
  const m = /(\d+(?:\.\d+){0,3})/.exec(String(v || ""));
  return m ? m[1].split(".").map(Number) : null;
}
function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x < y ? -1 : 1; }
  return 0;
}
const lineOfText = (text, needle) => { const i = text.indexOf(needle); return i < 0 ? 1 : text.slice(0, i).split("\n").length; };

export function collectDeps(files) {
  const deps = [], locked = new Set();
  for (const f of files) {
    const base = f.path.split("/").pop();
    if (base === "package-lock.json") {
      let j; try { j = JSON.parse(f.text); } catch { continue; }
      const add = (name, e) => { if (name && e && typeof e.version === "string") { locked.add(name); deps.push({ ecosystem: "npm", name, version: e.version, path: f.path, dev: !!e.dev, exact: true, needle: `"node_modules/${name}"` }); } };
      for (const [k, e] of Object.entries(j.packages || {})) { const i = k.lastIndexOf("node_modules/"); if (i >= 0) add(k.slice(i + 13), e); }
      const walk = (o, dev) => { for (const [n, e] of Object.entries(o || {})) { add(n, { ...e, dev: dev || e.dev }); walk(e.dependencies, dev || e.dev); } };
      if (!j.packages) walk(j.dependencies, false);
    }
  }
  for (const f of files) {
    const base = f.path.split("/").pop();
    if (base === "package.json" && !/node_modules\//.test(f.path)) {
      let j; try { j = JSON.parse(f.text); } catch { continue; }
      for (const [field, dev] of [["dependencies", false], ["optionalDependencies", false], ["devDependencies", true]]) {
        for (const [name, range] of Object.entries(j[field] || {})) {
          if (locked.has(name) || typeof range !== "string") continue;
          if (/^(?:latest|\*|workspace:|file:|link:|git|https?:)/i.test(range)) continue;
          if (parseVer(range)) deps.push({ ecosystem: "npm", name, version: parseVer(range).join("."), path: f.path, dev, exact: false, needle: `"${name}"` });
        }
      }
    }
    if (/^requirements[\w.-]*\.txt$/i.test(base)) {
      for (const ln of f.text.split("\n")) {
        const m = /^\s*([A-Za-z0-9_.-]+)\s*(?:==|>=|~=|===)\s*([0-9][\w.]*)/.exec(ln);
        if (m) deps.push({ ecosystem: "pypi", name: m[1].toLowerCase().replace(/_/g, "-"), version: m[2], path: f.path, dev: false, exact: /==/.test(ln), needle: ln.trim() });
      }
    }
  }
  return deps;
}

function scanDeps(files, deps) {
  const out = [], byPath = new Map(files.map((f) => [f.path, f.text]));
  for (const d of deps) {
    const v = parseVer(d.version); if (!v) continue;
    for (const adv of ADVISORIES) {
      if (adv.ecosystem !== d.ecosystem || adv.name !== d.name) continue;
      if (cmpVer(v, parseVer(adv.below)) >= 0) continue;
      const fixture = isTestPath(d.path);
      out.push({ rule: "dependency", adv, path: d.path, line: lineOfText(byPath.get(d.path) || "", d.needle), lineText: `${d.name} ${d.version}${d.exact ? "" : " (allowed by the version range)"}, fixed in ${adv.below}`, dev: d.dev, ignoreReason: fixture ? "Test fixture, not shipped" : "" });
    }
  }
  return out;
}

// ---------- build the result ----------
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }

function secretFindings(files) {
  const out = [];
  for (const f of files) {
    if (f.tooBig || isBundled(f.path)) continue;
    const hits = scanSecrets(f);
    for (const h of hits) {
      const same = hits.filter((x) => x.line === h.line);
      const snippet = h.kind === "private-key" ? "-----BEGIN ... PRIVATE KEY----- (key body hidden)" : snippetOf(redactLine(h.lineText, same), h.col);
      const live = h.live, test = h.test && !h.ignoreReason;
      out.push({
        rule: "secret", path: h.path, line: h.line, snippet, label: h.label, masked: mask(h.value),
        gid: live ? "secret-live" : test ? "secret-test" : "secret-ignored",
        severity: live ? "high" : "low",
        ignoreReason: h.ignoreReason,
        fixable: live && !h.noFix && !isEnvPath(h.path),
      });
    }
  }
  return out;
}

function toFinding(c) {
  if (c.rule === "dependency") {
    const sev = c.dev && c.adv.severity !== "high" ? "low" : c.adv.severity;
    return { rule: "dependency", gid: `dep-${c.adv.id}`, severity: sev, title: c.adv.title, tldr: c.adv.tldr, path: c.path, line: c.line, snippet: c.lineText, ignoreReason: c.ignoreReason, fixable: false };
  }
  const inTest = isTestPath(c.path);
  const ignoreReason = c.ignoreReason || (inTest ? "Test file, not shipped" : "");
  const R = RULES[c.rule];
  return { rule: c.rule, gid: c.rule, severity: c.rule === "cors-open" || c.rule === "site-csp" || c.rule === "mixed-content" ? "medium" : "medium", title: R.title, tldr: R.tldr, path: c.path, line: c.line, snippet: c.rule === "site-csp" ? c.lineText : snippetOf(redactLine(c.rule === "admin-password" ? c.lineText.replace(/([:=]+\s*)(["'])[^"']+\2/g, "$1$2****$2") : c.lineText, []), c.col || 0), ignoreReason, fixable: c.rule === "site-csp" ? true : (c.rule === "mixed-content" || c.rule === "form-http") ? !!c.knownHost : false, mayBeFalseAlarm: FALSE_ALARM.has(c.rule) };
}

const SECRET_TEXT = {
  "secret-live": { title: "Live secret found", tldr: "A real-looking key, token or password is written inside your files. Anyone who gets the files can use it. Move it out of the code. If it was ever shared or published, change it at its website." },
  "secret-test": { title: "Secret-looking text in test files", tldr: "These look like practice values inside test files, so the risk is low. Glance at them once to be sure none is real." },
  "secret-ignored": { title: "Placeholder keys", tldr: "These look like made-up or example values, so they were left out." },
};

function collect(opts = {}) {
  let files = opts.files;
  if (!files && opts.dir) files = readDir(opts.dir);
  files = normalizeFiles(files);
  const findings = [];
  const skipped = { bundled: 0, big: 0 };
  const scannable = [];
  for (const f of files) {
    if (isBundled(f.path)) { skipped.bundled++; continue; }
    if (f.tooBig) { skipped.big++; continue; }
    scannable.push(f);
  }
  for (const s of secretFindings(scannable)) findings.push(s);
  const hasCP = (f) => /child_process/.test(f.text);
  for (const f of scannable) for (const c of scanCode(f, hasCP(f))) findings.push(toFinding(c));
  for (const c of scanSite(scannable.filter((f) => !isTestPath(f.path)))) findings.push(toFinding(c));
  const deps = collectDeps(scannable);
  for (const c of scanDeps(scannable, deps)) findings.push(toFinding(c));
  return { files, scannable, findings, skipped, deps };
}

function buildResult({ files, findings, skipped }, now) {
  const groups = new Map(), ignored = new Map();
  for (const f of findings) {
    const isIgnored = !!f.ignoreReason;
    const map = isIgnored ? ignored : groups;
    const key = isIgnored ? `${f.gid}~${slug(f.ignoreReason)}` : f.gid;
    let g = map.get(key);
    if (!g) {
      const txt = SECRET_TEXT[f.gid] || {};
      g = {
        id: key, rule: f.rule, severity: f.severity, title: txt.title || f.title, tldr: txt.tldr || f.tldr, count: 0, files: [],
        ignored: isIgnored, ignoreReason: f.ignoreReason || "", fixable: false, fixId: "",
        ...(f.mayBeFalseAlarm ? { mayBeFalseAlarm: true } : {}),
      };
      map.set(key, g);
    }
    g.count++;
    if (SEV_RANK[f.severity] < SEV_RANK[g.severity]) g.severity = f.severity;
    if (g.files.length < MAX_FILES_PER_GROUP) g.files.push({ path: f.path, line: f.line, snippet: f.snippet });
    if (f.fixable && !isIgnored) { g.fixable = true; g.fixId = f.rule === "secret" ? "secrets" : f.rule === "site-csp" ? "csp" : "https"; }
  }
  if (skipped.bundled) ignored.set("skipped-bundled", { id: "skipped-bundled", rule: "skipped", severity: "low", title: "Built or downloaded code", tldr: "Files that came from a tool or a download, not from you.", count: skipped.bundled, files: [], ignored: true, ignoreReason: "Built or downloaded code is not checked", fixable: false, fixId: "" });
  if (skipped.big) ignored.set("skipped-big", { id: "skipped-big", rule: "skipped", severity: "low", title: "Very large files", tldr: "Files too big to read here.", count: skipped.big, files: [], ignored: true, ignoreReason: "Too large to check", fixable: false, fixId: "" });
  const sorted = [...groups.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count);
  const real = sorted.filter((g) => g.severity !== "low");
  const lows = sorted.length - real.length;
  const live = sorted.some((g) => g.id === "secret-live");
  const light = live ? "red" : real.length ? "amber" : "green";
  const n = real.reduce((a, g) => a + g.count, 0);
  const nf = files.length;
  const lowNote = lows ? ` ${lows} low-risk note${lows === 1 ? "" : "s"} below, nothing to worry about.` : "";
  const summary = live
    ? `A live secret is written in your files. Fix it before you publish, because anyone who gets the files can use it.${n > 1 ? ` ${n - sorted.find((g) => g.id === "secret-live").count} other thing${n - sorted.find((g) => g.id === "secret-live").count === 1 ? "" : "s"} to look at too.` : ""}`
    : real.length ? `${n} thing${n === 1 ? "" : "s"} worth a look in ${nf} file${nf === 1 ? "" : "s"}. You can still publish.${lowNote}`
    : nf ? `No problems found in ${nf} file${nf === 1 ? "" : "s"}. Nothing left your PC.${lowNote}`
    : "There was nothing to check yet. Nothing left your PC.";
  const t = now === undefined ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
  return { light, groups: sorted, ignored: [...ignored.values()], summary, checkedAt: new Date(t).toISOString(), filesChecked: nf, counts: { issues: n, low: lows, ignored: [...ignored.values()].reduce((a, g) => a + g.count, 0) }, hasLive: live };
}

export function runSafetyCheck(opts = {}) {
  return buildResult(collect(opts), opts.now);
}

// Optional online lookup. osvFetch(queries) gets [{ ecosystem, name, version }] (names and versions only)
// and answers an array of the same length: [{ vulns: [{ id, summary }] }]. Off unless it is passed.
export async function runSafetyCheckOsv(opts = {}) {
  const c = collect(opts);
  if (typeof opts.osvFetch === "function" && c.deps.length) {
    const seen = new Set(), qs = [];
    for (const d of c.deps) { const k = `${d.ecosystem}:${d.name}@${d.version}`; if (!seen.has(k)) { seen.add(k); qs.push({ ecosystem: d.ecosystem, name: d.name, version: d.version }); } }
    let answers = [];
    try { answers = await opts.osvFetch(qs); } catch { answers = []; }
    qs.forEach((q, i) => {
      for (const v of answers?.[i]?.vulns || []) {
        const d = c.deps.find((x) => x.name === q.name && x.version === q.version);
        c.findings.push({ rule: "dependency", gid: "dep-osv", severity: "medium", title: "Packages with a published weakness", tldr: "An online list of known weaknesses names these packages. Update each one to the newest version.", path: d.path, line: 1, snippet: `${q.name} ${q.version}: ${String(v.summary || v.id).slice(0, 100)}`, ignoreReason: "", fixable: false });
      }
    });
  }
  return buildResult(c, opts.now);
}

// ---------- Fix it ----------
const CSP_TAG = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; object-src 'none'; base-uri 'self'; form-action 'self' https:">`;

function fixSecrets(map, envNames) {
  const used = new Set(), byValue = new Map();
  let fixed = 0;
  for (const f of [...map.values()]) {
    if (f.tooBig || isBundled(f.path) || isEnvPath(f.path)) continue;
    const hits = scanSecrets(f).filter((h) => h.live && !h.noFix).sort((a, b) => b.start - a.start);
    if (!hits.length) continue;
    let text = f.text;
    for (const h of hits) {
      let name = byValue.get(h.value);
      if (!name) {
        name = h.name; for (let n = 2; used.has(name); n++) name = `${h.name}_${n}`;
        used.add(name); byValue.set(h.value, name);
      }
      envNames.add(name);
      const before = text[h.start - 1], after = text[h.end];
      let from = h.start, to = h.end, rep;
      if (NODE_ENV_EXT.test(f.path)) {
        if ((before === '"' || before === "'" || before === "`") && after === before) { from = h.start - 1; to = h.end + 1; rep = `process.env.${name}`; }
        else {
          const lineStart = text.lastIndexOf("\n", h.start - 1) + 1;
          const q = [...text.slice(lineStart, h.start)].reverse().find((ch) => ch === '"' || ch === "'" || ch === "`") || '"';
          rep = q === "`" ? `\${process.env.${name}}` : `${q} + process.env.${name} + ${q}`;
        }
      } else rep = `REPLACE_WITH_${name}`;
      text = text.slice(0, from) + rep + text.slice(to);
      fixed++;
    }
    map.set(f.path, { ...f, text, changed: true });
  }
  return fixed;
}

function fixCsp(map) {
  const files = [...map.values()];
  if (siteHasHeaderConfig(files)) return 0;
  let n = 0;
  for (const f of files) {
    if (!/\.html?$/i.test(f.path) || isTestPath(f.path) || isBundled(f.path) || !/<head[\s>]/i.test(f.text) || /http-equiv\s*=\s*["']?content-security-policy/i.test(f.text)) continue;
    const text = f.text.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n  ${CSP_TAG}`);
    if (text !== f.text) { map.set(f.path, { ...f, text, changed: true }); n++; }
  }
  return n;
}

function fixHttps(map) {
  let n = 0;
  for (const f of [...map.values()]) {
    if (f.tooBig || isBundled(f.path) || isTestPath(f.path)) continue;
    const bad = new Set(scanCode(f, false).filter((c) => (c.rule === "mixed-content" || c.rule === "form-http") && c.knownHost).map((c) => c.line - 1));
    if (!bad.size) continue;
    const lines = f.text.split("\n");
    for (const i of bad) lines[i] = lines[i].replace(KNOWN_RE, (m, host) => { n++; return `https://${host}`; });
    map.set(f.path, { ...f, text: lines.join("\n"), changed: true });
  }
  return n;
}

// Returns patched texts; the caller decides whether to write them. fixId: "secrets" | "csp" | "https" | "all".
export function applySafetyFix({ files, fixId = "all", now } = {}) {
  const map = new Map(normalizeFiles(files).map((f) => [f.path, f]));
  const envNames = new Set();
  const did = {};
  if (fixId === "all" || fixId === "secrets") did.secrets = fixSecrets(map, envNames);
  if (fixId === "all" || fixId === "csp") did.csp = fixCsp(map);
  if (fixId === "all" || fixId === "https") did.https = fixHttps(map);
  if (envNames.size) {
    const ex = map.get(".env.example") || { path: ".env.example", text: "" };
    let text = ex.text;
    for (const n of envNames) if (!new RegExp(`^${n}=`, "m").test(text)) text += `${text && !text.endsWith("\n") ? "\n" : ""}${n}=\n`;
    map.set(".env.example", { ...ex, text, changed: true });
  }
  const all = [...map.values()];
  const changed = all.filter((f) => f.changed).map((f) => ({ path: f.path, text: f.text }));
  const result = runSafetyCheck({ files: all.map(({ path: p, text }) => ({ path: p, text })), now });
  const left = result.groups.filter((g) => g.severity !== "low").reduce((a, g) => a + g.count, 0);
  const total = (did.secrets || 0) + (did.csp || 0) + (did.https || 0);
  return {
    fixed: total, did, changed, files: all.map(({ path: p, text }) => ({ path: p, text })), result, left,
    message: `Fixed, rescanned: ${left} left`,
    ...(did.secrets ? { note: FIX_NOTE, envNames: [...envNames] } : {}),
  };
}

// What Publish needs: the light, in a small shape with no snippets.
export function lightOf(result) {
  return result ? { light: result.light, summary: result.summary, checkedAt: result.checkedAt, hasLive: !!result.hasLive, issues: result.counts?.issues ?? 0 } : null;
}
