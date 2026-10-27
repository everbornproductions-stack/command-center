# DONE-P (credits pause and auto recovery)

## What changed
- server/pause.js: backoff 5 min, 15 min, 1 h, then hourly (`BACKOFF_MS`, `backoffMs`); label "Out of credits" (plain 429 = "Rate limited", about 1 min or retry-after); `recheckProvider()` recovery order: live balance (OpenRouter, DeepSeek, xAI with mgmt key) > 0, tracked balance raised after the failure, rate window passed, 1 token probe on a free model (OpenRouter free, Gemini, Groq), else models-list key check only (paid-only AIs never get a completion automatically). Gemini rechecks are capped at midnight Pacific (`nextPacificMidnight`). `creditLine()` gives "$3.20 left" / "Tracked: $5.00 left" / "Free tier, resets at midnight Pacific".
- server/health.js: `markRecovered`, `FREE_PROBE`, `keyOnly` check, probe `maxTokens` 1 for paused AIs, retry-after kept on 429.
- server/providers.js: 429 `retry-after` header read. server/credit-tracker.js: emits `credits.raised` (pause.js rechecks at once). server/services.js: exports `liveSecret`.
- server/plugins/providers.js: `POST /api/providers/<id>/recheck` (the "Check again" click; may send one 1 token test). Key save already calls noteKeySaved (now restarts the backoff) then checkProvider.
- Run-level skip: server/fallback.js (`run.skipProviders`, `run.onTrouble`), server/mission.js (planner, workers, QA, revise, assemble, continue) and server/council.js.
- UI: server/provider-access.js (`access.pause`, `access.credits`), web/access-label.js, web/app.js (bar tile red + next check + credits, Simple mode list + Check again, Settings card), web/features/services.js (Subscriptions Check again), server/live-bubble.js + web/features/liveview.js (Live Ops Free AI line no longer counts a dead AI as working), server/readers.js + web/features/desk.js ("Who will read this" shows next check).
- Tests: test/credits-pause-0421.test.js (11 tests).

## Pins changed on purpose
test/access.test.js: `RECHECK_MS` 15 min pin became the `BACKOFF_MS` pin; `PAUSE_LABEL` is now "Out of credits". `RECHECK_MS` is still exported.

## Tests run (all pass)
credits-pause-0421 11/11, access 6, livebubble 9, liveview 8, desk 5, credit-tracker 8, provider-balance 6, credit-truth-0421 6, pdf-0421 13, send-check 3, free-first (see log), fallback 4, keys-errors 4, answer-wait 9, user-facing-words 2. Run on Node 20.19 here (Node 22 not installed).

## Notes
- Run-level skip is tested at the fallbackChat level plus a source check that every mission/council call passes the skip set; no full mock mission was run.
- Health lights stay amber for a 402/billing 429 in health.js; the screens show every paused AI as red.
- The existing 30 minute 16 token health probe of healthy AIs is unchanged (not part of this item); it now uses 1 token only for paused AIs.
