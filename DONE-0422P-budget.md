# DONE 0422P budget

## What changed (plain words)
- Row 5: the app's own budget stop (402, code budget_cap) no longer turns a provider's light red or puts it in the trouble table.
  - `server/health.js`: `noteCall` ignores a failed call that is the budget stop. New exported `BUDGET_TEXT`.
  - `server/fallback.js`: `kindFromHealth` returns null for budget text. New `clearBudgetTrouble()` drops every "credits" entry whose detail is budget text, for all providers.
  - `server/plugins/cost-guard.js`: saving a new cap and "Add $1" (`/continue`) call it, and the answer carries a plain line: "Your budget went up, so the AIs that were paused by the old limit are back."
- Row 6: `server/cost-guard.js` words the estimate case as "This job is estimated at about $X, and your limit is $Y. Raise the limit or pick Free only." Money really spent keeps the old words. `web/failure-cause.js` shows that sentence as the card title (still the budget card with the Add $1 button).
- Row 7: `server/fallback.js` `fallbackChat`: after a 429 the next stand-in is another company first; a sibling model of the same key is used only when no other company is left. Pinned routes without allowStandIn are unchanged (they still never reach another company; that is the existing 0.4.21 rule).

## Tests
- New: `test/budget-panel0422.test.js`, 5 tests. All fail on the old code (0 of 5) and pass on the new (5 of 5).
- Also run, all passing: budget-0421 6, money-stops 3, fallback 4, smarter-control 8, user-facing-words 2, b0420-limits 8, dogfood15-0421-r 5, simple-onboarding 3, gemini-0421-q 7, credits-pause-0421 11, keys-errors 4, send-check-browser 3, decisions 7, providers 6, qa-estimate-0421-p 4, credit-truth-0421 6, plan-0421-p 5. No old pins changed.

## Skipped / notes
- A pinned model reaching another company stays as is (locked 0.4.21 decision, allowStandIn).
- `npm test` and `npm run smoke` full runs were not done here; only the files above.
- The estimate sentence is matched by exact wording in `web/failure-cause.js`; if the server wording changes, change both.
