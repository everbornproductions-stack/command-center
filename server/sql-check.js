// 0.4.32 (dogfood library-sql): an AI wrote a SQLite script with a stray comma where a statement should end, and the
// file was saved as done. A saved .sql file for a SQLite request is now run once in an empty in-memory database; an
// error fails the step's check with the plain reason, so the AI is asked to fix it.
// The run is a separate Node process (a worker thread cannot be stopped while SQLite is busy, a process can), killed
// after 3 seconds, fenced in with --permission where this Node supports it. That fence does not cover SQLite's own file
// writes, so a script that could touch files (ATTACH, VACUUM INTO, load_extension) is never run.
// 0.4.36 (panel 0432 item 4): a query for the person's existing database fails in the empty one with "no such table".
// That is not checked rather than wrong: a missing table or column the script never creates is skipped, and a request
// that names a .db file is not run at all.
import { spawn } from "node:child_process";
import { sandboxSupported } from "./run-node-test.js";

export const SQL_CHECK_MS = 3000;
const TOUCHES_FILES = /\battach\b|\bvacuum\s+into\b|\bload_extension\b|\bdetach\b/i;

/** Should this file be checked? Only for a SQLite request, and only when it stays in memory. */
export const wantsSqlCheck = (name, goal = "", text = "") => /\.sql$/i.test(String(name || "")) && /\bsqlite\b/i.test(`${goal}\n${String(text || "").slice(0, 400)}`) && !TOUCHES_FILES.test(String(text || "")) && !NAMES_DB.test(String(goal || ""));
const NAMES_DB = /[\w-]\.(?:db|db3|sqlite3?)\b/i;
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A "no such table/column" error for something the script never creates means it reads an existing database. */
export function readsExistingDb(text, error) {
  const e = String(error || ""), s = String(text || "");
  const table = /no such table:\s*(?:main\.)?["'`[]?(\w+)/i.exec(e);
  if (table) return !new RegExp(`create\\s+(?:temp(?:orary)?\\s+)?(?:table|view)\\s+(?:if\\s+not\\s+exists\\s+)?(?:main\\.)?["'\`[]?${esc(table[1])}\\b`, "i").test(s);
  return /no such column/i.test(e) && !/create\s+table/i.test(s);
}

// reads the script on stdin, prints one JSON line
const CHILD = `let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(c)=>{s+=c});process.stdin.on("end",()=>{let D=null;try{({DatabaseSync:D}=require("node:sqlite"))}catch{}if(!D){process.stdout.write(JSON.stringify({ok:true,skipped:true}));return}const db=new D(":memory:");try{db.exec(s);process.stdout.write(JSON.stringify({ok:true}))}catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e&&e.message||e).slice(0,240)}))}finally{try{db.close()}catch{}}});`;
const childEnv = () => ({ PATH: process.env.PATH || "", SystemRoot: process.env.SystemRoot || "", TEMP: process.env.TEMP || "", TMP: process.env.TMP || "", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) });

/** Run the script once. Resolves { ok, error?, skipped?, timedOut? }; never throws. */
export function sqlCheck(text, { ms = SQL_CHECK_MS, exec = process.execPath } = {}) {
  // checked again here: Node's --permission fence does not cover SQLite's own file writes (VACUUM INTO wrote a file)
  if (TOUCHES_FILES.test(String(text || ""))) return Promise.resolve({ ok: true, skipped: true, touchesFiles: true });
  return new Promise((resolve) => {
    let done = false, out = "", child = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { child?.kill(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: true, skipped: true, timedOut: true }), ms);
    try {
      const fence = sandboxSupported(exec) ? ["--permission"] : [];
      child = spawn(exec, [...fence, "-e", CHILD], { env: childEnv(), windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => { out += c; });
      child.on("error", (e) => finish({ ok: true, skipped: true, error: String(e?.message || e).slice(0, 120) }));
      child.on("close", () => {
        let r; try { r = JSON.parse(out); } catch { r = { ok: true, skipped: true }; }
        finish(!r.ok && readsExistingDb(text, r.error) ? { ok: true, skipped: true, existingDb: true } : r);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(String(text || ""));
    } catch (e) { finish({ ok: true, skipped: true, error: String(e?.message || e).slice(0, 120) }); }
  });
}

/** The words a failed check puts on the step. */
export const sqlIssueLine = (name, error) => `The SQL in ${name} does not run in SQLite (${String(error).replace(/\s+/g, " ").trim()}). Fix it so the whole file runs from top to bottom.`;
