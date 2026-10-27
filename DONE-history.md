# Done: History Sidebar (Part: history)

## What was built
- **`web/mac/data/history.js`**: Pure logic module providing `groupByDay(chats, now)` (categorizes chats into Today, Yesterday, This week, Earlier), `filterChats(chats, query)` (case-insensitive search across titles and first messages), and `titleOf(chat)` (plain title extraction with smart fallbacks).
- **`web/mac/parts/history.js`**: Sliding history drawer in `#mac-side` / `#mac-root`. Listens to bus `"open"` (`{ panel: "history" }`), fetches chats via `/chathist`, supports search input autofocus, keyboard navigation (Up/Down/Enter/Escape), clicking outside to close, reopening chats via existing APIs, and a quick "Redo" ("Do this again") action button.
- **`web/mac/css/history.css`**: 280px glass drawer styling with smooth slide-in animations, responsive light and dark mode variables (`--mac-glass2`, `--mac-line`, `--mac-acc`, `--mac-tx`, `--mac-dim`), reduced-motion safety, and hover states.
- **`test/mac-history-0423.test.js`**: Comprehensive unit tests for data logic (`titleOf`, `filterChats`, `groupByDay`) and a real browser test using `bootMac` validating opening, searching, and closing the drawer via Escape.

## Test Results
- `node --test test/mac-history-0423.test.js test/mac-foundation-0423.test.js`: All 7 tests passed successfully.
