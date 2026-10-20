// Fails when server/ or the Electron main process imports a package that is not
// in package.json dependencies. The packaged app only ships those dependencies.
// A package that is present only because something else installed it (the v0.4.5
// undici crash) passes unit tests and then the engine dies with ERR_MODULE_NOT_FOUND.
// Node built-ins and electron itself are allowed. devDependencies are not.
import fs from "node:fs";
import path from "node:path";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS_FILE = /\.(?:c|m)?js$/;

function isIdentStart(c) {
  return /[A-Za-z_$]/.test(c || "");
}
function isIdent(c) {
  return /[A-Za-z0-9_$]/.test(c || "");
}

function readQuoted(source, at) {
  const q = source[at];
  if (q !== '"' && q !== "'") return null;
  let j = at + 1;
  let value = "";
  while (j < source.length) {
    const c = source[j];
    if (c === "\\") { value += source[j + 1] || ""; j += 2; continue; }
    if (c === q) return { value, end: j + 1 };
    if (c === "\n") return null;
    value += c;
    j++;
  }
  return null;
}

function skipSpace(source, at) {
  let j = at;
  while (j < source.length && /[\s]/.test(source[j])) j++;
  return j;
}

// Specifiers of require(), require.resolve(), import(), and import/export ... from.
// Comments and string contents are not imports. A template expression is scanned.
export function bareSpecifiers(source) {
  const s = String(source);
  const n = s.length;
  const found = [];
  const seen = new Set();

  function add(spec, at) {
    if (!spec || seen.has(`${at}\0${spec}`)) return;
    seen.add(`${at}\0${spec}`);
    found.push({ specifier: spec, index: at });
  }

  function skipLineComment(at) {
    let j = at;
    while (j < n && s[j] !== "\n") j++;
    return j;
  }
  function skipBlockComment(at) {
    let j = at + 2;
    while (j < n && !(s[j] === "*" && s[j + 1] === "/")) j++;
    return Math.min(n, j + 2);
  }
  function skipPlainString(at) {
    const q = s[at];
    let j = at + 1;
    while (j < n) {
      if (s[j] === "\\") { j += 2; continue; }
      if (s[j] === q) return j + 1;
      if (s[j] === "\n") return j;
      j++;
    }
    return j;
  }

  function seekFrom(at) {
    let j = at;
    let depth = 0;
    const limit = Math.min(n, at + 4000);
    while (j < limit) {
      if (s[j] === "/" && s[j + 1] === "/") { j = skipLineComment(j); continue; }
      if (s[j] === "/" && s[j + 1] === "*") { j = skipBlockComment(j); continue; }
      if (s[j] === '"' || s[j] === "'") { j = skipPlainString(j); continue; }
      if (s[j] === "`") break;
      if (s[j] === "(" || s[j] === "{" || s[j] === "[") { depth++; j++; continue; }
      if (s[j] === ")" || s[j] === "}" || s[j] === "]") { depth = Math.max(0, depth - 1); j++; continue; }
      if (depth === 0 && (s[j] === ";" || s[j] === "=")) return j + (s[j] === ";" ? 1 : 0);
      if (depth === 0 && isIdentStart(s[j])) {
        const start = j;
        j++;
        while (j < n && isIdent(s[j])) j++;
        const word = s.slice(start, j);
        if (word === "function" || word === "class") return start;
        if (word === "from") {
          const k = skipSpace(s, j);
          const lit = readQuoted(s, k);
          if (lit) { add(lit.value, k); return lit.end; }
        }
        continue;
      }
      j++;
    }
    return j;
  }

  function afterCall(at) {
    let j = skipSpace(s, at);
    if (s.slice(j, j + 8) === ".resolve" && !isIdent(s[j + 8])) j = skipSpace(s, j + 8);
    if (s[j] !== "(") return j;
    j = skipSpace(s, j + 1);
    const lit = readQuoted(s, j);
    if (lit) { add(lit.value, j); return lit.end; }
    return j;
  }

  function walk(start, end) {
    let i = start;
    while (i < end) {
      const c = s[i];
      const next = s[i + 1];
      if (c === "/" && next === "/") { i = skipLineComment(i); continue; }
      if (c === "/" && next === "*") { i = skipBlockComment(i); continue; }
      if (c === '"' || c === "'") { i = skipPlainString(i); continue; }
      if (c === "`") {
        i++;
        while (i < end) {
          if (s[i] === "\\") { i += 2; continue; }
          if (s[i] === "`") { i++; break; }
          if (s[i] === "$" && s[i + 1] === "{") {
            i += 2;
            const expr = i;
            let depth = 1;
            while (i < end && depth > 0) {
              if (s[i] === "/" && s[i + 1] === "/") { i = skipLineComment(i); continue; }
              if (s[i] === "/" && s[i + 1] === "*") { i = skipBlockComment(i); continue; }
              if (s[i] === '"' || s[i] === "'") { i = skipPlainString(i); continue; }
              if (s[i] === "{") depth++;
              else if (s[i] === "}") depth--;
              if (depth > 0) i++;
            }
            walk(expr, i);
            if (s[i] === "}") i++;
            continue;
          }
          i++;
        }
        continue;
      }
      if (isIdentStart(c) && (i === 0 || !isIdent(s[i - 1]))) {
        const startWord = i;
        i++;
        while (i < end && isIdent(s[i])) i++;
        const word = s.slice(startWord, i);
        if (word === "require") { i = afterCall(i); continue; }
        if (word === "import") {
          const j = skipSpace(s, i);
          if (s[j] === ".") { i = j; continue; }
          if (s[j] === "(") { i = afterCall(j); continue; }
          if (s[j] === '"' || s[j] === "'") {
            const lit = readQuoted(s, j);
            if (lit) { add(lit.value, j); i = lit.end; continue; }
          }
          i = seekFrom(j);
          continue;
        }
        if (word === "export") { i = seekFrom(i); continue; }
        continue;
      }
      i++;
    }
  }

  walk(0, n);
  return found;
}

// null means the specifier is not an npm package we have to ship.
export function packageName(specifier) {
  const spec = String(specifier || "").trim();
  if (!spec) return null;
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("\\")) return null;
  if (/^[a-zA-Z]:[\\/]/.test(spec)) return null;
  if (spec.startsWith("node:") || isBuiltin(spec)) return isBuiltin(spec) || isBuiltin(spec.slice(5)) ? null : spec;
  if (spec === "electron" || spec.startsWith("electron/")) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2 || !parts[1]) return spec;
    return `${parts[0]}/${parts[1]}`;
  }
  return spec.split("/")[0] || null;
}

export function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "data") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(full));
    else if (ent.isFile() && JS_FILE.test(ent.name)) out.push(full);
  }
  return out;
}

export function runtimeRoots(root = ROOT) {
  return [path.join(root, "server"), path.join(root, "electron")];
}

export function checkRuntimeDeps({ root = ROOT, dependencies, files } = {}) {
  const deps = dependencies || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies || {};
  const depNames = new Set(Object.keys(deps));
  const list = files || runtimeRoots(root).flatMap((dir) => walkJs(dir));
  const missing = [];
  const packages = new Set();
  const seen = new Set();
  for (const file of list) {
    let code;
    try { code = fs.readFileSync(file, "utf8"); }
    catch { continue; }
    for (const hit of bareSpecifiers(code)) {
      const name = packageName(hit.specifier);
      if (!name) continue;
      packages.add(name);
      if (depNames.has(name)) continue;
      const key = `${file}\0${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push({
        file: path.relative(root, file).split(path.sep).join("/"),
        specifier: hit.specifier,
        packageName: name,
      });
    }
  }
  missing.sort((a, b) => a.file.localeCompare(b.file) || a.packageName.localeCompare(b.packageName));
  return { ok: missing.length === 0, missing, packages: [...packages].sort(), dependencies: depNames };
}

export function formatMissing(missing) {
  const lines = (missing || []).map((m) => `  ${m.file}: ${m.packageName} (from "${m.specifier}")`);
  return [
    "Runtime dependency check failed.",
    "These imports are not in package.json dependencies. Node built-ins and electron are allowed. devDependencies are not packaged into the app.",
    ...lines,
    "A packaged app would crash at startup with ERR_MODULE_NOT_FOUND. Unit tests can still pass when the package is only installed transitively.",
  ].join("\n");
}

function main() {
  const result = checkRuntimeDeps();
  if (!result.ok) {
    console.error(formatMissing(result.missing));
    return 1;
  }
  console.log(`Runtime dependencies: ${result.packages.length} package import(s) in server/ and electron/ are listed in dependencies (${result.packages.join(", ")}).`);
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main());
