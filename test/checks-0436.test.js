// 0.4.36 (panel 0432 item 4): the SQL and PowerShell checks stop flagging correct files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { psTraps, loadedAssemblies } from "../server/ps-lint.js";
import { sqlCheck, wantsSqlCheck, readsExistingDb } from "../server/sql-check.js";

const USE = "$z = [System.IO.Compression.ZipFile]::Open($p, [System.IO.Compression.ZipArchiveMode]::Create)";

test("every correct way to load both zip assemblies passes", () => {
  const ok = {
    comma: "Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem",
    assembly: "Add-Type -Assembly System.IO.Compression\nAdd-Type -Assembly System.IO.Compression.FileSystem",
    short: "Add-Type -A System.IO.Compression\nAdd-Type -A 'System.IO.Compression.FileSystem'",
    using: "using assembly System.IO.Compression\nusing assembly System.IO.Compression.FileSystem",
    load: "[Reflection.Assembly]::LoadWithPartialName(\"System.IO.Compression\")\n[System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')",
  };
  for (const [k, head] of Object.entries(ok)) assert.deepEqual(psTraps(`${head}\n${USE}`), [], k);
});

test("a commented-out Add-Type still counts as missing", () => {
  const s = `# Add-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n${USE}`;
  assert.equal(psTraps(s).length, 1);
  assert.match(psTraps(s)[0], /ZipArchive/);
  assert.equal(loadedAssemblies(s).has("system.io.compression"), false);
  assert.equal(psTraps(USE).length, 2);
});

test("a request that names a .db file is not run in the empty database", () => {
  assert.equal(wantsSqlCheck("q.sql", "write a SQLite query for library.db", "SELECT * FROM books;"), false);
  assert.equal(wantsSqlCheck("q.sql", "write a SQLite script for a library", "SELECT 1;"), true);
});

test("a missing table the script never creates is skipped, one it creates is a real error", () => {
  assert.equal(readsExistingDb("SELECT * FROM books;", "no such table: books"), true);
  assert.equal(readsExistingDb("CREATE TABLE loans(id);\nSELECT * FROM books;", "no such table: books"), true);
  assert.equal(readsExistingDb("CREATE TABLE IF NOT EXISTS books(id);\nSELECT * FROM bookz;", "no such table: bookz"), true);
  assert.equal(readsExistingDb("CREATE TABLE books(id);\nDROP TABLE books;\nSELECT * FROM books;", "no such table: books"), false);
  assert.equal(readsExistingDb("SELECT title FROM books;", "no such column: title"), true);
  assert.equal(readsExistingDb("CREATE TABLE books(id);\nSELECT title FROM books;", "no such column: title"), false);
});

test("sqlCheck: an existing-database query passes, a syntax error still fails", async () => {
  const existing = await sqlCheck("SELECT title, author FROM books WHERE year > 2000;");
  if (existing.skipped && !existing.existingDb) return; // this Node has no node:sqlite
  assert.equal(existing.ok, true);
  assert.equal(existing.existingDb, true);
  const broken = await sqlCheck("CREATE TABLE books(id INTEGER, title TEXT),\nSELECT * FROM books;");
  assert.equal(broken.ok, false);
});

// ---------- item 3: files saved at the end of a Mission get the same checks ----------
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget, tmpDir } from "./helpers.js";
import { checkSavedScripts } from "../server/saved-file-checks.js";

test("checkSavedScripts: a saved broken .sql and a .ps1 with a trap fail; good, already checked and other files pass", async () => {
  const dir = tmpDir("cc-chk-");
  const put = (n, t) => { const p = path.join(dir, n); fs.writeFileSync(p, t); return { ok: true, name: n, path: p }; };
  try {
    const files = [
      put("library.sql", "CREATE TABLE books(id INTEGER, title TEXT),\nSELECT * FROM books;"),
      put("good.sql", "CREATE TABLE books(id INTEGER, title TEXT);\nINSERT INTO books VALUES (1, 'A');"),
      put("backup.ps1", USE),
      put("step.sql", "CREATE TABLE x(,"),
      put("notes.md", "CREATE TABLE x(,"),
      { ok: false, name: "missing.sql", error: "Not saved" },
    ];
    const sql = async (t) => (/\),\nSELECT/.test(t) ? { ok: false, error: "near \"SELECT\": syntax error" } : { ok: true });
    const r = await checkSavedScripts(files, { goal: "a SQLite script and a PowerShell backup", checked: [files[3].path], sql });
    assert.deepEqual(r.map((c) => [c.name, c.ok]), [["library.sql", false], ["good.sql", true], ["backup.ps1", false]]);
    const bad = r.filter((c) => !c.ok);
    assert.match(bad[0].issue, /^Saved, but it does not run in SQLite: near "SELECT": syntax error\.$/);
    assert.match(bad[1].issue, /^Saved, but it would stop on Windows PowerShell: /);
    assert.equal(bad.some((c) => c.issue.includes("—")), false, "no em-dash");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a demo Mission for a SQLite script named library.sql checks the saved file and says what it found", { timeout: waitBudget(180000) }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const before = new Set(((await s.api("/state")).json.missions || []).map((m) => m.id));
    const r = await s.api("/mission", { method: "POST", body: { goal: "Write a SQLite script named library.sql that creates a books table and lists the books.", qa: false, search: false } });
    assert.equal(r.status, 202, r.text);
    let m = null; const t0 = Date.now();
    while (Date.now() - t0 < waitBudget(90000)) {
      const row = ((await s.api("/state")).json.missions || []).find((x) => !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
      if (row) { m = (await s.api(`/missions/${row.id}`)).json; break; }
      await new Promise((res) => setTimeout(res, 300));
    }
    assert.ok(m, `the mission did not finish:\n${s.log.slice(-1500)}`);
    const saved = (m.savedFiles || []).find((f) => f.ok && /library(-\d+)?\.sql$/i.test(f.name || ""));
    assert.ok(saved, `library.sql was saved: ${JSON.stringify(m.savedFiles)}`);
    // the demo answer is a SQLite script that runs (0.4.36): it was saved from the final answer and checked here
    assert.equal((m.tasks || []).some((t) => (t.writes || []).some((w) => w.path === saved.path)), false, "saved at the end, not by a code step");
    assert.ok((await sqlCheck(fs.readFileSync(saved.path, "utf8"))).ok);
    const logText = (m.log || []).map((l) => l.text || l.msg || l.message || String(l)).join("\n");
    if (!(await sqlCheck("SELECT 1;")).skipped) assert.match(logText, /Checked library(-\d+)?\.sql in SQLite: it runs\./);
    assert.equal(m.fileChecks, null, "a script that runs is not flagged");
    assert.doesNotMatch(m.deliverable, /does not run in SQLite/);
  } finally { await s.stop(); }
});
