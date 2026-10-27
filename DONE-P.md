# DONE-P (codewrite, dogfood 12)

## What changed
- `server/named-file.js`: `writeProjectFile` (writes inside the project folder only, rejects `../`, absolute, drive and `~` paths, reads back), `codeFor`, `insideFolder`, `NOT_SAVED_LINE`. `saveNamedFile` no longer guesses a code file out of an answer with several code blocks.
- `server/run-node-test.js` (new): `runNodeTest` runs only `node <file>` / `node --test <file>` inside the project folder, no shell, 30 s limit, output trimmed to 4000 chars, injectable `spawn`. Anything else gives "Not run: Meldmind only runs node tests in your project folder."
- `server/export-check.js` (new): export names (ESM, `module.exports = {..}`, `exports.x =`), compare, "Changed the file's exports (cronToWords is gone)".
- `server/step-guard.js`: `claimCheck` (says "saved"/"wrote" or shows "test output"/"tests passed" with no tool record). Code in fences and "not saved" lines are ignored.
- `server/mission.js`: code steps write their named file (toolCalls `{tool:"write_file", path, bytes}` on step `toolRecords` and `mission.toolCalls`); "run tests" steps run locally (`{tool:"run", cmd, exit, output}`) and pass real output on; no folder gives step `notSaved` ("Not saved: Meldmind can only show this code here."), step `notRun`, not a green dot, mission "done-with-errors", `planNote` up front, line added to the final answer; export loss means the file is NOT overwritten and QA fails the step; deterministic QA runs before the AI review (and with QA off); instruction "Do not change exported names or the shape of exports." added when editing an existing file; an agent step (Antigravity) that says done with no words and no files fails and goes to a working AI.
- `web/app.js`, `web/result-card.js`: "Not saved" / "Not run" chips, "Wrote x (N bytes)" chip, plan note and tool record list on the card.
- `code-source.js`: exports `find`.

## Tests
- New `test/codewrite-0421.test.js`: 14 pass, 0 fail (write, path escape, real node run, non-node refused, injectable spawn, export check, claim check, 5 end-to-end missions against local mock AIs).
- Also run: user-facing-words 2/0, step-guard-0421 11/0, mission-guard-0421 6/0, dogfood-0421 6/0, dogfood10-0421 5/0, dogfood-ui-0421 10/0, input-missing-0421 4/0, remix-fail-0421 4/0, decisions 7/0, grokbot 3/0, mcp 11/0.
- Full `npm test`: 1539 pass, 8 fail. All 8 (agents, community, libraries x2, market-catalog, modes, projectfiles, savings) fail the same way on a clean checkout of HEAD (this box has Node 20; node:sqlite needs 22). `npm run smoke`: only the 6 library checks fail (same cause). Logs in /tmp/cw-*.log.

## Notes
- The agent-step "empty" path (Antigravity / Grok Bot) has no end-to-end test; it needs the Grok Bot webhook mock. Plain empty steps are tested end to end.
- Deviation from the brief: the export comparison happens BEFORE the write, so a rewrite that drops an export never replaces the user's file.
- Code writes need a project (`projectId`) with a linked folder; with no project nothing is written, so one project's folder is never used for another's work. A bare `index.html` with no folder still goes to MindMedia as before.
