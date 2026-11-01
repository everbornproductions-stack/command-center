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
