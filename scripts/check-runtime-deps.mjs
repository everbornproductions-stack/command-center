// Fails when server/ or the Electron main process imports a package that is not
// in dependencies. electron-builder installs dependencies into the packaged app
// and leaves out devDependencies and transitive packages. v0.4.5 imported undici
// from server/loopback-fetch.js without listing it, so the installed engine
// crashed at startup with ERR_MODULE_NOT_FOUND and nothing listened on port 4747.
// Unit tests still passed because node_modules had undici from another package.
import fs from "node:fs";
import path from "node:path";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE_EXT = new Set([".js", ".cjs", ".mjs"]);

export function findSpecifiers(code) {
  const found = [];
  const n = code.length;
  let i = 0;

  function lineAt(index) {
    let line = 1;
    for (let k = 0; k < index && k < n; k++) if (code[k] === "\n") line++;
    return line;
  }

  function wordAt(index, word) {
    if (!code.startsWith(word, index)) return false;
    const before = index > 0 ? code[index - 1] : "";
    const after = code[index + word.length] || "";
    if (before && /[A-Za-z0-9_$]/.test(before)) return false;
    if (after && /[A-Za-z0-9_$]/.test(after)) return false;
    return true;
  }

  function gap() {
    for (;;) {
      while (i < n && /[\t\r\n \f\v]/.test(code[i])) i++;
      if (code[i] === "/" && code[i + 1] === "/") {
        i += 2;
        while (i < n && code[i] !== "\n") i++;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "*") {
        i += 2;
        while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
        i = Math.min(n, i + 2);
        continue;
      }
      break;
    }
  }

  function readString() {
    const q = code[i];
    if (q !== "'" && q !== '"') return null;
    let k = i + 1;
    let out = "";
    while (k < n) {
      const c = code[k++];
      if (c === "\\") {
        if (k < n) out += code[k++];
        continue;
      }
      if (c === q) {
        i = k;
        return out;
      }
      if (c === "\n") return null;
      out += c;
    }
    return null;
  }

  function record(spec, at) {
    if (typeof spec === "string") found.push({ specifier: spec, line: lineAt(at), index: at });
  }

  function scanFrom(at) {
    let depth = 0;
    while (i < n) {
      if (code[i] === "/" && code[i + 1] === "/") {
        i += 2;
        while (i < n && code[i] !== "\n") i++;
        continue;
      }
      if (code[i] === "/" && code[i + 1] === "*") {
        i += 2;
        while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
        i = Math.min(n, i + 2);
        continue;
      }
      if (code[i] === "'" || code[i] === '"') {
        const start = i;
        if (readString() == null) i = start + 1;
        continue;
      }
      if (code[i] === "(" || code[i] === "{" || code[i] === "[") { depth++; i++; continue; }
      if (code[i] === ")" || code[i] === "}" || code[i] === "]") { depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0 && wordAt(i, "from")) {
        i += 4;
        gap();
        record(readString(), at);
        return;
      }
      if (depth === 0 && code[i] === ";") { i++; return; }
      if (depth === 0 && (wordAt(i, "import") || wordAt(i, "export") || wordAt(i, "const") || wordAt(i, "let") || wordAt(i, "var") || wordAt(i, "function") || wordAt(i, "class"))) return;
      i++;
    }
  }

  while (i < n) {
    if (code[i] === "/" && code[i + 1] === "/") {
      i += 2;
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (code[i] === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (code[i] === "'" || code[i] === '"') {
      const start = i;
      if (readString() == null) i = start + 1;
      continue;
    }
    if (code[i] === "`") {
      i++;
      while (i < n) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === "`") { i++; break; }
        if (code[i] === "$" && code[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (code[i] === "/" && code[i + 1] === "/") { i += 2; while (i < n && code[i] !== "\n") i++; continue; }
            if (code[i] === "/" && code[i + 1] === "*") {
              i += 2;
              while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
              i = Math.min(n, i + 2);
              continue;
            }
            if (code[i] === "'" || code[i] === '"') {
              const start = i;
              if (readString() == null) i = start + 1;
              continue;
            }
            if (code[i] === "{") depth++;
            else if (code[i] === "}") depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }

    if (wordAt(i, "import")) {
      const at = i;
      i += "import".length;
      gap();
      if (code[i] === ".") { i++; continue; }
      if (code[i] === "(") {
        i++;
        gap();
        record(readString(), at);
        continue;
      }
      if (code[i] === "'" || code[i] === '"') {
        record(readString(), at);
        continue;
      }
      scanFrom(at);
      continue;
    }

    if (wordAt(i, "export")) {
      const at = i;
      i += "export".length;
      scanFrom(at);
      continue;
    }

    if (wordAt(i, "require")) {
      const at = i;
      i += "require".length;
      gap();
      if (code[i] === "." && code.startsWith(".resolve", i) && !/[A-Za-z0-9_$]/.test(code[i + ".resolve".length] || "")) {
        i += ".resolve".length;
        gap();
      }
      if (code[i] === "(") {
        i++;
        gap();
        record(readString(), at);
      }
      continue;
    }

    i++;
  }

  return found;
}

// Bare package name for a specifier, or null when it is not a third-party package.
export function packageName(specifier) {
  const spec = String(specifier || "");
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:") || spec.startsWith("data:")) return null;
  if (spec === "electron" || spec.startsWith("electron/")) return null;
  if (isBuiltin(spec)) return null;
  if (spec.startsWith("node:")) return spec;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split("/")[0];
}

function walkCode(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "data") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkCode(full, out);
    else if (CODE_EXT.has(path.extname(ent.name))) out.push(full);
  }
}

export function codeFiles(root) {
  const files = [];
  walkCode(path.join(root, "server"), files);
  walkCode(path.join(root, "electron"), files);
  return files.sort();
}

export function collectPackageImports(root) {
  const rows = [];
  for (const file of codeFiles(root)) {
    const code = fs.readFileSync(file, "utf8");
    for (const hit of findSpecifiers(code)) {
      const name = packageName(hit.specifier);
      if (!name) continue;
      rows.push({ file, line: hit.line, specifier: hit.specifier, name });
    }
  }
  return rows;
}

export function readDependencies(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};
}

export function missingRuntimeDeps(root = ROOT) {
  const deps = readDependencies(root);
  return collectPackageImports(root).filter((row) => !Object.prototype.hasOwnProperty.call(deps, row.name));
}

export function reportRuntimeDeps(root = ROOT) {
  const missing = missingRuntimeDeps(root);
  if (!missing.length) {
    const count = collectPackageImports(root).length;
    console.log(`Runtime dependency check passed (${count} package imports, all listed in dependencies).`);
    return 0;
  }
  console.error("Runtime dependency check failed. The packaged app only installs dependencies. A bare import has to be listed there. Node built-ins and electron are allowed.");
  for (const row of missing) {
    const rel = path.relative(root, row.file);
    console.error(`  ${rel}:${row.line} imports "${row.name}"`);
  }
  return 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(reportRuntimeDeps());
