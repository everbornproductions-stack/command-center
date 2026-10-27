# DONE-P (P-qaest)

## Changes
- server/mission.js: with QA on, every AI step ends with a review or a plain "Not reviewed" record (`t.review.unchecked`), including when no reviewer can run (before, `qaStep` returned nothing and the step had no review) and when the QA call throws. The plan estimate now adds the classifier, planner, assembler and one QA review per AI step, each priced as the AI that really runs it after dead AIs are skipped (`openPick`/`openRank`). `mission.estimateParts` shows the split.
- server/precost.js: `overheadCost` (token counts per call), `canTakeWork`, `liveFirst`. The pre-send line now skips dead AIs.
- server/free-first.js: `calibratedEstimate` takes `overhead`; with it, the blanket 1.6 QA factor drops to 1.15. Calibration from real runs (`noteActual`) is unchanged.
- test/qa-estimate-0421-p.test.js: 4 tests (estimate within 2x of a simulated real cost, stand-in price, dead AI skipped, 1-task mission with QA shows a review).

## Tests
- qa-estimate-0421-p 4/4, user-facing-words 2/2, versions 4/4, mission-guard-0421 6/6, codewrite-0421 14/14, step-guard-0421 11/11, plan-0421-p 5/5, dogfood10-0421 5/5.
- free-first: tests 1 to 9 pass; test 10 hangs. It hangs the same way on an unchanged HEAD copy, so it is not from this change.
- Not run: the full `npm test` and `npm run smoke`, which CLAUDE.md requires before a commit. Run them before merging.
- Logs: /tmp/qaest-*.log
