# DONE-0422P-stepguard

## What Changed
- Updated `stripSearchLeaks` in `server/step-guard.js` to protect fenced code blocks (` ``` ... ``` `), indented code blocks (4+ spaces or a tab at line start following a blank line or start of text), inline code (` `...` `), and array/index bracket numbers attached directly to identifiers or brackets (e.g. `argv[2]`, `a[0]`, `row[1][2]`).
- Ensured prose citation removal (`[1]`, `[1][4]`, `[1, 4]`) only applies when preceded by space or sentence punctuation (`.`, `!`, `?`), preventing false positives on array indices.
- Restricted double space collapsing and trailing whitespace cleanups to outside protected code areas.
- Added comprehensive unit tests in `test/step-guard-0421.test.js` covering fenced code blocks, indented code blocks, inline code, array indexers, and prose citations.

## File Paths
- `server/step-guard.js`
- `test/step-guard-0421.test.js`
- `DONE-0422P-stepguard.md`

## Tests Run & Results
- `node --test test/step-guard-0421.test.js`: 12 tests passed, 0 failed.
- `node --test test/user-facing-words.test.js`: 2 tests passed, 0 failed.
- `node --test test/dogfood-0421.test.js test/file-save-0421-q.test.js test/codewrite-0421.test.js test/input-missing-0421.test.js test/image-route-0421-q.test.js`: 43 tests passed, 0 failed.
