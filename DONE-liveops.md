# DONE: liveops (0.4.23 Mac-style GUI)

## What I built

**Pure logic, `web/mac/data/liveops.js`** (new, no DOM, unit tested)
- `workingModel(live)` returns `{ bars, line, showSteps }` with exactly 3 plain bars (Planning, Writing, Checking, pct 0 to 100), one plain line such as "Working on step 3 of 5", and `showSteps`.
- It reads the real run shape only: `CC.S.live` tasks (`status`, `capability`), `mission.cost` / `council.cost`, run `status`. Step fills match what `web/app.js renderTasks` draws (done 100, failed 100, review 85, running 30).
- A step belongs to Planning, Writing or Checking by its `capability` chip (plan, qa, check, test and friends, everything else), and by its place in the plan when it has no chip.
- `opsHeader(live, priorityRaw)` builds the screen header line, e.g. "Mission running, step 3 of 5, $0.031 so far, Balanced". `priorityWord` maps the cost mode to the plain words from `web/app.js PRIORITY`.

**Part, `web/mac/parts/liveops.js`** (lead stub replaced)
- `CC.mac.liveops = { mountWorking(container), mountOps(container) }`.
- `mountWorking`: the Simple "AIs working" card with the 3 progress bars (`role="progressbar"`, aria value now), one status line, and a big "Show steps" button that emits bus `open` with `{ panel: "live" }`. It redraws on state ticks (`CC.register({ id: "mac-liveops", onState })`) and on a light 1 second interval while it is on screen, so the line follows the run (running to done) without a reload.
- `mountOps` and the screen itself: opens on bus `open` with `{ panel: "live" }`, and (lead change at merge: no longer on `CC.go("command")`, so Expert Chat keeps the run bar), and when `mountOps(container)` is called. Slots are created when missing (`#mac-root`, `#mac-main`, `#mac-flow`) and reused when the shell already made them.
- The screen reparents, never rebuilds: `#ops-panel` (which carries `#graph`, `#tasks`, `#council`, the status chips, the QA score chip and the re-assigned chips exactly as the app draws them) and `#feed` move into the screen. While the screen is open it adopts the fresh copy each time the app re-renders Command, drops its stale copy, and on close hands the nodes back to where they came from (the app's fresh copy always wins).
- Header line from `opsHeader`. Pause, Resume and Stop press the app's own `#ops-pause`, `#ops-resume` and `#abort` buttons, so every rule and call stays the app's; their small copies in the panel heading are hidden by CSS inside the screen only. Button visibility mirrors the app's inline display state.
- The live feed is a collapsible column with an aria-expanded toggle, and it is hidden in Simple (FEATURE-MAP.md section 3).
- Escape or the Close button closes the screen, focus moves to the screen title when it opens, and a plain hint shows when there is no step list yet.

**Styles, `web/mac/css/liveops.css`** (lead stub replaced): every rule starts with `body[data-style="mac"]`, so nothing changes while the Mac style is off. Big targets (36 to 40 px), visible focus rings, theme colors reused from `web/styles.css`.

## Files
- `web/mac/data/liveops.js` (new)
- `web/mac/parts/liveops.js` (replaced the lead stub)
- `web/mac/css/liveops.css` (replaced the lead stub)
- `test/mac-liveops-0423.test.js` (new)

## Test commands and results
- `node --test test/mac-liveops-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js`: **13 pass, 0 fail, 0 skipped** (log `/tmp/liveops-final.log`).
- `node --test test/mac-liveops-0423.test.js` on its own: 8 pass, 0 fail. Six unit tests (running, done, failed, empty, planning and no-capability grouping, header line) plus two real browser tests with `bootMac` and the practice AIs: the card shows 3 bars and "Working on step 3 of 5", "Show steps" emits the open event, the card follows the run to done, and the Expert screen keeps one `#ops-panel` with `#graph` and `#tasks` inside it, `#feed` in its column, the chips kept, Pause wired to the app's button, Escape closing.
- Full `npm test`: 1583 pass, 8 fail. `npm run smoke`: 6 checks failed (all library). I re-ran those 8 test files and smoke on a clean tree at `aa20b7b` in a detached worktree: the same 8 tests and the same 6 smoke checks fail there, so they are pre-existing in this environment (library indexing and 7 others), not caused by this part. Logs `/tmp/npm-test.log`, `/tmp/base-fails.log`, `/tmp/base-smoke.log`.

## Left undone / notes
- No shared file needed a hook, so there is no `MAC-NEEDS-liveops.md`.
- The flow and expert parts are still stubs in this worktree, so nothing calls `mountWorking` or `mountOps` yet. They are ready on `CC.mac.liveops`, and the screen also opens from the bus event and from `CC.go("command")` in Expert.
- The Deliverable panel, the pause and edit form and the Reply boxes were not rebuilt on purpose: they live inside the adopted `#ops-panel` and keep working as the app draws them.
