# Item P-rate Summary

## Changes Made:
1. **Extracted Pure Functions into `web/features/ratings-rows.js`**:
   - Implemented `contributors(run, pnameFn)` returning one rating row per step/task (by step id), including code steps, QA steps, agent steps (Antigravity), failed or empty steps, and the assembly row, without deduplicating by provider or model.
   - Implemented `preferLine({up, rated, ran, top})` enforcing that the "Meldmind now prefers X" line only displays after a thumbs up when the named AI actually ran in the run and got the thumbs up. After a thumbs down, or if the top pick never ran, no preference line is shown.
2. **Updated `web/features/ratings.js`**:
   - Integrated `contributors` and `preferLine` from `web/features/ratings-rows.js`.
   - Updated UI rating workflow to pass rating states correctly to `preferLine`.
3. **Added Tests in `test/ratings-rows-0421.test.js`**:
   - Tested `contributors(run)` ensuring a 3-step run gives 3 step rows + assembly, with no deduplication and proper handling of all step types.
   - Tested `preferLine({up, rated, ran, top})` covering various scenarios including the dogfood 12 case (thumbs down on Groq, Antigravity, Claude, and top pick GPT-6 Astra never ran => no prefers line).

## File Paths:
- `web/features/ratings-rows.js` (new)
- `web/features/ratings.js` (updated)
- `test/ratings-rows-0421.test.js` (new)
- `DONE-P.md` (new)

## Tests Run:
- `node --test test/ratings-rows-0421.test.js test/ratings.test.js` -> All tests passed successfully (6/6 pass).
- `node --test test/user-facing-words.test.js` -> Passed successfully.
