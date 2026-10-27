# DONE: expert (0.4.23 Mac-style GUI)

## Built
- `web/mac/data/expert.js` (pure): `buildRegistry(views, LABELS, locks, src)`, `GROUPS_MAC` (Work, Create, Agents, Library, My day, People, Business, Settings, Help), `groupsOf`, `pages(items, 21)`, `search`, `coverage(allViews, items)`, `lockOf` (same rule as nav.js `lockFor`).
  Non-page items map to run modes (Missions, Councils, Research, Second opinion), Settings spots (CONNECT_LINKS, Zapier and Make, Outside agents), bus panels (`live`, `history`, `settings` with a `section`), and the help actions from `helpItems()` (tour, connect-setup, news, demo-on, updates, user guide, contact, About).
- `web/mac/parts/expert.js`: Expert only. Sidebar in `#mac-side` (search, groups, Pro/Extreme tags, selected state follows `CC.S.view`, collapse and reopen, open groups kept in `localStorage cc.mac.groups`, collapse state in `cc.mac.side`). Launchpad in `#mac-launchpad` (bus `open {panel:"launchpad"}`, pages of 21, page dots, PageUp/PageDown and arrow keys, search across pages, swipe, Escape closes, focus returns). Opening an item reuses `CC.go`, `CC.openSettings`, `CC.tour`, `CC.connectSetup` and the existing `data-action` handlers (a short lived button is clicked for `demo-on` and `updates`). Plan locks only tag the item; the page still opens.
- `web/mac/css/expert.css`: all selectors start with `body[data-style="mac"]`.
- Works alone: creates `#mac-root`, `#mac-side`, `#mac-launchpad` when missing, and watches `CC.uiMode()` as well as the bus `mode` event.

## Tests
`/tmp/mmtools/clean.sh node --test test/mac-expert-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js`
-> 20 tests, 20 pass, 0 fail (Node 22). `test/mac-expert-0423.test.js` alone: 15 tests.
Completeness test: real view list (LABELS, registry views, feature `tab:` ids, NAV_ORDER, index.html buttons); `coverage()` is empty and the allow list `NOT_PAGES` is empty.
The browser test clicks every launchpad item and checks the real target (view, action or panel event).

## Notes and left undone
- Panel items (`Cost and speed`, `Memories`, and so on) and `Live Ops` and `Recent chats` emit bus `open` events. The panel, liveops and history parts must listen for `{panel:"settings", section}`, `"live"` and `"history"`. Until they do, those items do nothing visible. The classic Settings page ("All settings") and History tab stay reachable as real views.
- Selected state uses a 400 ms check of `CC.S.view` as well as the bus `view` event, because no shared file emits `view` yet. The shell part can emit `view` and `mode` to make it instant.
- The sidebar toggle in the title bar can emit bus `open {panel:"sidebar"}` to collapse or show the sidebar.
- No shared files were edited, so no MAC-NEEDS file.
