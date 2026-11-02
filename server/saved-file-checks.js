// 0.4.36 (panel 0432 item 3): a demo Mission saved library.sql with SQL that does not run in SQLite and ended "done".
// The SQLite and PowerShell checks ran only on files a code step wrote; a file saved from the final answer at the end
// was never checked. Every saved .sql and .ps1 is now checked the same way, and a failure goes on the Done card.
import fs from "node:fs";
import path from "node:path";
import { wantsSqlCheck, sqlCheck } from "./sql-check.js";
import { psTraps } from "./ps-lint.js";
import { psParse } from "./ps-parse.js";

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

/** Check the saved files a code step did not already check. Resolves [{ name, path, kind, ok, issue? }], one per file checked. */
export async function checkSavedScripts(saved = [], { goal = "", checked = [], sql = sqlCheck, parse = psParse } = {}) {
  const done = new Set(checked.filter(Boolean).map((p) => String(p).toLowerCase()));
  const out = [];
  for (const f of saved) {
    if (!f?.ok || !f.path || done.has(String(f.path).toLowerCase())) continue;
    done.add(String(f.path).toLowerCase());
    const name = path.basename(String(f.name || f.path));
    if (/\.ps1$/i.test(name)) {
      const text = read(f.path); if (text == null) continue;
      const traps = psTraps(text);
      if (traps.length) { out.push({ name, path: f.path, kind: "powershell", ok: false, issue: `Saved, but it would stop on Windows PowerShell: ${traps.join("; ")}.` }); continue; }
      // 0.4.38 (dogfood 0436 batch-rename): PowerShell's own parser reads it (never runs it)
      const pp = await parse(text);
      const e = pp.ok ? null : pp.errors?.[0];
      out.push(e ? { name, path: f.path, kind: "powershell", ok: false, issue: `Saved, but it has a PowerShell syntax error${e.line ? ` on line ${e.line}` : ""}: ${String(e.message || "").replace(/\s+/g, " ").replace(/\.$/, "")}.` } : { name, path: f.path, kind: "powershell", ok: true });
    } else if (/\.sql$/i.test(name)) {
      const text = read(f.path); if (text == null || !wantsSqlCheck(name, goal, text)) continue;
      const r = await sql(text);
      if (!r.ok) out.push({ name, path: f.path, kind: "sqlite", ok: false, issue: `Saved, but it does not run in SQLite: ${String(r.error || "").replace(/\s+/g, " ").trim()}.` });
      else if (!r.skipped) out.push({ name, path: f.path, kind: "sqlite", ok: true });
    }
  }
  return out;
}
