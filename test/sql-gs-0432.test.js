// 0.4.32 dogfood fixes: (1) a SQLite script is run once in memory before it counts as done (library-sql had a stray
// comma where a statement should end); (2) a .gs file takes the ```javascript block (sheets-script saved nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sqlCheck, wantsSqlCheck, sqlIssueLine } from "../server/sql-check.js";
import { bodyForFile } from "../server/code-files.js";

const broken = fs.readFileSync(new URL("./fixtures/library-trailing-comma.sql", import.meta.url), "utf8");

test("wantsSqlCheck: only .sql files for a SQLite request that stay in memory", () => {
  assert.equal(wantsSqlCheck("library.sql", "Write a SQLite script for a school library"), true);
  assert.equal(wantsSqlCheck("library.sql", "Write a Postgres schema"), false, "another database's SQL is not run in SQLite");
  assert.equal(wantsSqlCheck("notes.md", "sqlite notes"), false);
  assert.equal(wantsSqlCheck("x.sql", "SQLite", "ATTACH DATABASE 'other.db' AS o;"), false, "a script that touches files is not run");
});

test("sqlCheck: a good script runs; the real broken one names the error; a runaway query is stopped", async () => {
  assert.deepEqual(await sqlCheck("CREATE TABLE a(x INTEGER); INSERT INTO a VALUES (1),(2); SELECT * FROM a;"), { ok: true });
  const bad = await sqlCheck(broken);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /syntax error/);
  assert.match(sqlIssueLine("library.sql", bad.error), /^The SQL in library\.sql does not run in SQLite \(.*syntax error.*\)\. Fix it/);
  const t0 = Date.now();
  const slow = await sqlCheck("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c;", { ms: 800 });
  assert.equal(slow.ok, true); assert.equal(slow.timedOut, true, "a query that never ends is stopped, not counted as broken");
  assert.ok(Date.now() - t0 < 5000);
  const vac = await sqlCheck("CREATE TABLE t(x); VACUUM INTO 'never-written.db';");
  assert.equal(vac.touchesFiles, true, "a script that could write a file is never run");
});

test("a .gs file takes the one ```javascript block (Apps Script is JavaScript), and nothing else changes", () => {
  const answer = "Here is the script.\n\n```javascript\nfunction onOpen() {\n  SpreadsheetApp.getUi().createMenu('Sales Tools').addItem('Highlight stale leads', 'highlight').addToUi();\n}\n```\n\nThen:\n\n```\n1. Open Extensions > Apps Script\n```\n";
  const b = bodyForFile("stale-leads.gs", [answer]);
  assert.ok(b, "a block is found"); assert.match(b.body, /function onOpen/);
  assert.equal(bodyForFile("tool.py", ["```javascript\nlet a = 1\n```"]), null, "a .py file does not take a javascript block");
});
