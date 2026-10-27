# Done: dock (0.4.23 Mac-style GUI)

## What was built
- **web/mac/data/dock.js**: Pure data and logic defining `DOCK_ITEMS` for Simple (Chat, Website, Image, Video, Campaign, Game mod | Projects, MindMedia, History) and Expert (adds All tools and Live Ops), `magnifyScale(distancePx)` curve implementation, and `itemsFor(mode)`.
- **web/mac/parts/dock.js**: Renders into `#mac-dock`, handles magnification on mousemove via `requestAnimationFrame`, bounce/run animations on click, active view highlighting, tooltips, keyboard navigation (arrow keys + Enter/Space), bus integration (`mode`, `view`, `open`, `flow`), and fallback path handling with starter text in `#orders`/`#ask`.
- **web/mac/css/dock.css**: Frosted glass pill at bottom centre with light/dark theme support, magnify/bounce effects, accessibility, reduced-motion safety, and mobile hiding under 761px.
- **test/mac-dock-0423.test.js**: Unit tests for data logic (`magnifyScale`, `itemsFor`, action types) and browser tests using `bootMac` (verifying 9 items in Simple, 2 added in Expert, view switching on Projects, history panel opening on History, and arrow key focus movement).

## Files Owned
- `web/mac/data/dock.js`
- `web/mac/parts/dock.js`
- `web/mac/css/dock.css`
- `test/mac-dock-0423.test.js`

## Test Command & Results
```bash
node --test test/mac-dock-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js
```
- **Passed**: 8 tests
- **Failed**: 0 tests
