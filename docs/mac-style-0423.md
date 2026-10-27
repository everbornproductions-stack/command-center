# Mac-style GUI (0.4.23): part contract

Goal: the Simple / Expert window in `docs/design-0423/mockup-v2.html` (frosted window, magnifying dock, swipe cards, 3 step flow, Expert sidebar and All tools launchpad, right settings panel), with every 0.4.21 feature still reachable in Expert. `docs/design-0423/FEATURE-MAP.md` lists where every feature lives. Keep Simple easy for non-technical people: plain short words, no jargon, no em or en dashes.

## Switch
`web/mac/index.js` mounts the Mac layer only when it is on: `?mac=1`, `localStorage cc.mac = "1"`, or setting `uiStyle: "mac"`. Off means the 0.4.21 look, byte for byte. While on, `document.body.dataset.style === "mac"`, and ALL Mac CSS is scoped under `body[data-style="mac"]`. The Simple/Expert choice is the existing one (`CC.uiMode()`, `#mode-simple`, `#mode-expert`, `CC.S.uiMode`): never invent a second mode state. Switching must call the existing handler (click the original button) so settings and per-project mode keep working.

## Parts (one owner each, one file each)
`web/mac/parts.js` lists them: shell, dock, cards, flow, history, expert, runbar, liveops, panel.
- Code: `web/mac/parts/<part>.js` (`export default { id, mount(ctx), unmount(ctx) }`, ctx = `{ CC, bus, slot(id) }`), CSS: `web/mac/css/<part>.css`, pure data and logic (no DOM, unit tested): `web/mac/data/<part>.js`, tests: `test/mac-<part>-0423.test.js`.
- Touch ONLY your own files. Do not edit `web/app.js`, `web/nav.js`, `web/mode.js`, `web/index.html`, `web/features/layout.js`, or any other shared file. If you truly need a hook in a shared file, write the exact change you need in `MAC-NEEDS-<part>.md` in your worktree root and stop; the lead adds it.
- Slots (created by the shell part inside `#mac-root`, which the shell appends to `body`): `#mac-titlebar`, `#mac-side` (left sidebar, Expert groups and History live here), `#mac-main` (the window body; the existing `#app` / `#view` stays the page content and is reparented or overlaid, never rebuilt), `#mac-flow` (overlay inside main for the Simple flow), `#mac-dock`, `#mac-launchpad`, `#mac-panel` (right settings panel). Before the shell part exists, parts must create a missing slot themselves with `slot(id) || create...`, so each part can be built and tested alone.
- Bus (`CC.mac.bus`): `mode` (simple|expert), `theme` (light|dark), `view` (view id), `flow` ({path, step}), `open` ({panel}). Parts talk through the bus and through `window.CC` only, never by importing each other.
- Existing features are reused, never copied: `CC.go(view)`, `CC.S`, `CC.api`, `CC.makeChat`, `CC.openSettings`, `web/nav.js` exports (`LABELS`, `GROUPS`, `VIEW_LOCKS`, `lockFor`, `allMenuItems`), `web/features/chat-history.js`, the run box `#orders` / `#go`. Search the code before writing anything (`grep -rn` in web/ and test/).

## Rules
- Tests: `node --test test/mac-<part>-0423.test.js` plus `node --test test/user-facing-words.test.js`. Browser tests use `test/mac-helpers.js` (`bootMac`), real waits with deadlines (20 to 30 s), always close the browser and server. No network, no real keys, no money.
- The whole suite must stay at 0 fail with the Mac style OFF (that is the default during the build).
- Commit after each item with a message ending `[skip ci]`, `git add <named paths>` only. Never push, never `git stash`, never check out another branch.
