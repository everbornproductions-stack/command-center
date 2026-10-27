# DONE: flow (Simple 3 step flow)

## Built
Home ("What do you want to make?": swipe path cards, the box with a Free or rough cost line, quick picks from the existing ideas)
-> 1 Pick a style (popular one already picked, Next) -> 2 Tell us about it (one sentence, cost line, swipeable photo strip, Make it)
-> AIs working (3 progress bars, Show steps, Stop, price question when a price is above the guard)
-> 3 Done (the existing result UI in a big frame, ONE finish button, version pills, Try again, Change this part, More ways, Make something else).
An Incomplete run shows the Incomplete badge, a Retry button and no finish button. Back on every step, Escape goes back, "Just chat instead" shows the normal Simple chat (a "Use the 3 steps" button brings the flow back). Expert never shows it. The dock can start a path with bus "flow" {path, step}.

How it wraps the existing code (nothing re-implemented):
- Send: fills `#orders`, sets `S.skipProjectStart` for website, campaign and mod (so they answer in chat and reach Done), clicks `#go`. Picture and video prompts read as picture and video to `make-intent.js`, so `CC.makeChat` runs them.
- Working: watches `CC.S.live` and `CC.S.make.tiles`. `CC.mac.liveops.mountWorking(host)` is used when present, else the built-in bars.
- Done: reparents `#simple-answer` (tiles, result hero, result card, versions) into the Done frame and puts it back on leaving. The finish button clicks the existing hero main button (`.rh-main`, `.mk-dl`); More ways is `CC.openFinishDrawer`. Retry clicks the existing `[data-rc-retry]`, else re-sends.
- Style cards: `CC.mac.cards.mountCards(host, {path, onPick})` when present, else `/mac/data/cards.js` if it has a list, else 3 built-in styles per path. Photos: `capture-input.js` wireUpload and `upload-strip.js` mountStrip.
- Cost line: the same `/route` estimate the Auto team line uses.

## Files
web/mac/data/flow.js, web/mac/parts/flow.js, web/mac/css/flow.css, test/mac-flow-0423.test.js, MAC-NEEDS-flow.md.

## Tests
- `node --test test/mac-flow-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js`: 27 pass, 0 fail (flow file: 22 tests: 17 unit, 5 real-browser with the demo AIs: image path to Done with one finish button, Back/Escape/quick picks/Just chat, Expert hides it, website path, Incomplete + Retry).
- `npm test` here: 8 failures in agents, libraries, routing/modes, community. They fail the same way on the untouched base commit aa20b7b (this machine has Node 20; the project needs Node 22), so they are not from this part. `npm run smoke` not run.

## Needs from the lead (MAC-NEEDS-flow.md)
`.gitignore` has `data/`, which also hides `web/mac/data/`. Add `!web/mac/data/` after it. I committed `web/mac/data/flow.js` with `git add -f` on that one named file.

## Not done / limits
- The Incomplete browser test forces the engine's result in the page (a stand-in for the retry button); the real mission path is covered by unit tests of `runState` only.
- Photos: uploaded through the existing orders-box upload and shown in the strip; their notes join the prompt for website, campaign and mod only. Picture and video makers do not take them yet.
- Home guesses the path from the typed words (picture, video, website, campaign, mod); otherwise it asks the person to pick a card.
- The shell's real slot layout and theme class names (body.dark / data-theme) were not available; the CSS handles both and creates `#mac-root` and `#mac-flow` when missing.
- "Is this usable?" thumb is not in this part.
