# DONE: 0.4.23 runbar (work/0423-runbar)

## What was built

The Expert run bar (`#mac-runbar`) that sits above the chat box. The first builder left it uncommitted with real bugs; this pass fixes them.

1. **No repaint loop.** The `MutationObserver` on `document.body` (subtree) is gone. The bar repaints on `CC.mac.bus` `mode` and `view` events, and on a `setInterval` of 1000 ms that repaints only when its signature changed (`CC.S.view`, `CC.uiMode()`, `CC.S.cmdMode`, `CC.S.costMode`, `CC.S.whenMode`, `CC.S.freeOnly.on`, the cost line). Nothing is repainted when nothing changed: `innerHTML` is rewritten only when the signature is new or the bar was dropped by a view render.
2. **No direct state writes.** The bar never assigns to `CC.S`. Clicking a run mode clicks `#run-mode button[data-m]`, the priority select clicks `#cost-mode button[data-m]`, the When segment clicks `#when-mode button[data-m]`, and Free only calls `setFreeOnly` from `/features/free-ais.js`. Checked state is read from `CC.S.freeOnly?.on`.
3. **Real priority ids.** `PRIORITIES` in `web/mac/data/runbar.js` uses the ids from `PRIORITY` in `web/app.js`: `max`, `quality`, `balanced`, `savings`, `speed`.
4. **Cost line.** A cost above 0 and under a cent says "Less than 1 cent". Only exactly `0` or `"free"` says "Free".
5. **Placement.** The bar is inserted before the box that holds `#orders`, only when `CC.uiMode()` is `expert` and `CC.S.view === "command"`. Anywhere else it is removed from the page.
6. **Tests.** `test/mac-runbar-0423.test.js` checks the data, checks the part source (no em or en dashes, no observer, no direct `CC.S` writes), and drives a real browser: boot in Expert, open Command, wait for `#mac-runbar` and `#orders`, click Council, check `CC.S.cmdMode === "council"`, pick priority `max`, check `CC.S.costMode === "max"` and that `#cost-mode button[data-m="max"]` is `on`, click `#mode-simple` and wait for the bar to be hidden or gone, then assert `t.errors` is empty. No fixed sleeps, all waits are `waitForFunction` with a 20 s deadline.

Also fixed: `web/mac/css/runbar.css` had `display: flex !important` (it could never be hidden) and a hard-coded `background: #2c2c2e`, which failed `test/light-theme-cards.test.js` (N9).

## Files

- `web/mac/parts/runbar.js`
- `web/mac/css/runbar.css`
- `web/mac/data/runbar.js` (added)
- `test/mac-runbar-0423.test.js` (added)

Not touched: any shared file. `.gitignore` still carries the first builder's uncommitted `!web/mac/data/` line; it is not mine to commit.

## Tests

```
node --test test/mac-runbar-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js
```

- pass 8, fail 0 (8 tests, 0 skipped)
- `test/light-theme-cards.test.js` also passes now (13 pass, 0 fail when run together with the three above)

Full suite, for the record:

- `npm test`: 1594 tests, 1585 pass, 8 fail. The 8 are server side and pre-existing (agents, community pricing, libraries x2, marketplace offline, modes, project files, savings). None of those files reads `web/mac/*`, and the one failure inside this part (`runbar.css:72`, N9) is fixed.
- `npm run smoke`: 55 pass, 6 fail, all of them the library staging and indexing checks. Also server side, also outside this part.
