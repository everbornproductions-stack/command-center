# PUBLISHUI Fix Report

- **Task:** Panel bug row 17 (Medium): The Publish preview never draws WARNINGS.
- **Files Changed:**
  - `web/features/publish.js`: Updated `#pb-prev` handler to render `r.warnings` as plain amber lines (supporting both string and object warning shapes with `plain`/`why`), escaping text with `esc()`. Ensured warnings do not disable the Publish button.
  - `web/features/mindmedia-parts.js`: Updated `[data-a="preview"]` handler to render `r.warnings` as plain amber lines supporting string and object warning shapes, escaped with `esc()`, without disabling the Send button.
  - `test/publish.test.js`: Added a server-side test asserting that `/api/publish/preview` for channel instagram with text containing "guaranteed" returns a non-empty warnings array.
  - `test/publish-warnings-0422.test.js`: Added unit tests verifying warning formatting (strings and objects) and that warning-only previews leave Publish enabled.
- **Tests Run & Pass Count:**
  - `node --test test/publish-warnings-0422.test.js test/publish.test.js test/user-facing-words.test.js` -> 7 tests passed successfully.
- **Skipped:** None.
