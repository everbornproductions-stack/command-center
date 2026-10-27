// Keep a file's exports (0.4.21, dogfood 12): a rewrite of cronwords.js changed `{ cronToWords }` into a bare function
// and broke every caller. This reads the export names of the old and the new text (a simple regex pass, not a parser)
// and says which ones went missing. Pure: no disk, no network.

const clean = (s) => String(s ?? "").replace(/\r\n/g, "\n");
const NAME = "[A-Za-z_$][\\w$]*";

// the plain names inside `{ a, b: c, d }` (the name that callers see is the one before the colon)
function listNames(inner) {
  const out = [];
  for (const part of String(inner).split(",")) {
    const p = part.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!p) continue;
    const as = new RegExp(`^(${NAME})\\s+as\\s+(${NAME})$`).exec(p); // export { a as b }
    if (as) { out.push(as[2]); continue; }
    const m = new RegExp(`^(?:['"]?)(${NAME})(?:['"]?)\\s*(?::|$)`).exec(p);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The names a JS file exports: ESM `export ...`, `module.exports = { ... }`, `exports.x = ...`. Sorted, no repeats. */
export function exportNames(source) {
  const t = clean(source).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = new Set();
  for (const m of t.matchAll(new RegExp(`^\\s*export\\s+(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+(${NAME})`, "gm"))) out.add(m[1]);
  for (const m of t.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) for (const n of listNames(m[1])) out.add(n);
  if (/^\s*export\s+default\b/m.test(t)) out.add("default");
  for (const m of t.matchAll(/\bmodule\.exports\s*=\s*\{([^}]*)\}/g)) for (const n of listNames(m[1])) out.add(n);
  // module.exports = someName: one export, called "module.exports" (a bare function or class instead of an object is a changed shape)
  if (/\bmodule\.exports\s*=\s*(?![\s{])/.test(t)) out.add("module.exports");
  for (const m of t.matchAll(new RegExp(`\\b(?:module\\.)?exports\\.(${NAME})\\s*=`, "g"))) out.add(m[1]);
  return [...out].sort();
}

/** { ok, removed: [names the old file exported that the new one does not], added: [...], before, after } */
export function compareExports(before, after) {
  const a = exportNames(before), b = exportNames(after);
  const removed = a.filter((n) => !b.includes(n));
  return { ok: removed.length === 0, removed, added: b.filter((n) => !a.includes(n)), before: a, after: b };
}

/** The plain line for QA: "Changed the file's exports (cronToWords is gone)". */
export function exportLossLine(removed = []) {
  const names = removed.filter(Boolean);
  if (!names.length) return "";
  const gone = names.map((n) => (n === "module.exports" ? "the module.exports object" : n));
  return `Changed the file's exports (${gone.join(", ")} ${gone.length > 1 ? "are" : "is"} gone)`;
}

export const KEEP_EXPORTS_LINE = "Do not change exported names or the shape of exports.";
