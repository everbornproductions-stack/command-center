# Simple layout (0.4.21, area H)

> **0.4.37 (Chris, 2026-11-01): the Chat page changed.** It is now one centred column (about 780 px) on a flat background like Expert: the question as a bubble, each answer a card (`#simple-answer .sc-card`, replies in `#sc-turns`) with exactly Copy, Try again, Make changes and Save as file, follow-ups in the same run's thread, and the short box pinned at the bottom (`.sc-chat .orders`). The Next bar, Finish, versions, More actions and the rest are behind Make changes (`#sc-changes`). The answer check is inside the card (`#sc-check`). The Build panel opens only from Preview on the Chat page. The sidebar is Chat, Make something, Projects, MindMedia, History and Settings and more (AI News and Create are in Settings and more). The old first screen below lives on as Make something (the Mac look's steps; in the classic look `S.scPage = "make"`). Styles: web/chat.css. Test: test/simple-chat-0437.test.js. The rest of this page is the 0.4.21 history.

The Simple window uses the whole screen. It follows design-ref/LAYOUT-STUDY.md section 3 and Chris's "Use the space" note (Oct 26, 1:11 PM PT): lean toward Claude's layout, chat plus a Build panel that fill the window, results big, no narrow centered column.

```
+---------+---------------------------+--------------------------------------+
| sidebar | chat column               | Build panel (the canvas, docked)     |
| New     | greeting (empty screen)   | versions < v2 of 3 >  Preview        |
| Projects| results inline            | Download  Close  [Publish]           |
| MindMed.|                           |  live canvas: page, picture, video   |
| Create  | [ the box, docked at the  |                                      |
| Recent  |   bottom after Send ]     |                                      |
| (Settings and more)                 |                                      |
+---------+---------------------------+--------------------------------------+
```

## Where things are

| Piece | File | Notes |
|---|---|---|
| Sidebar `#cc-side` | web/features/layout.js, web/layout.css | Simple, 761px and wider. New, Projects, MindMedia, Create, Recent chats, and "Settings and more" at the bottom. Collapsible (`#side-collapse`, remembered in `cc.side`); icons only under 1100px. Every menu item is a click on the original hidden top menu button (`#tabs`), so nothing was removed and the lock notes stay right. |
| Profile menu `#side-menu` | layout.js | Settings, Keys and connections, Look and theme, Expert mode, Community, AI News, Help, More pages. |
| First screen | web/app.js `renderSimpleChat`, layout.css | `#sc-hello` ("What do you want to make?"), the box (`.sc-box`), four chips `[data-sc-chip]` (Image, Video, Website, Campaign: each fills a starter request and sends nothing), `#sc-team` ("Auto team, about $0.04": the real estimate from /api/route, click for options), then tiles: example ideas `#sc-ideas`, made recently `#sc-media`, `#sc-projects`, My day, Welcome back. |
| Behind the Auto team control | `#sc-more` | Project picker, the old starters, Prompts, the hints, spend line, Show my AIs, the Project tools row `#projbar` and the Finish bar `#fpbar`. Grouped, not removed. |
| The box docked | layout.css | `.cmd.simple-chat[data-state="empty" or "run"]`. Empty: the box sits under the greeting. After the first Send it is sticky at the bottom of the chat column. Other screens use the dock (`#cc-dock`). |
| Results inline | web/features/make-chat.js | Unchanged. Tiles show in `#simple-answer` above the box, a picture up to 70vh. |
| Build panel | web/features/canvas.js (`openCanvas({ docked: true })`), layout.css `#cc-canvas.docked` | Version arrows `#cv-prev` `#cv-next`, `#cv-preview`, `#cv-download`, one `#cv-publish`. Opens by itself: from 1500px when there is a result; from 1000px for a big build (a web page answer, a mission with steps, or Start a project through `CC.layout.buildFeed`). Small things stay inline below 1500px. `CC.layout.openInPanel()` opens it on request. Under 1000px the canvas stays the old full window overlay. |
| Live Ops | layout.js, web/features/dock.js | One line ("3 AIs working, step 2 of 5", `#sc-live` in Simple, `#cc-ops-slim` in Expert) with a "See live" button. The full map and the step list open as an overlay (`#cc-live-over`, `CC.layout.seeLive`). |
| AI icons | web/app.js `renderComposerAis`, layout.css | `.composer-ai.working` while an AI works, dark when done. Under the box the row shows while a run is going, or when Auto team is open. |
| AI News | web/features/news-rail.js | The floating card is hidden in Simple (sidebar layout). AI News is in the profile menu. Expert is unchanged. |

## Rules

- Expert is unchanged apart from the Live Ops line ("See live" opens the overlay).
- Phones (760px and under) keep the bottom tab bar and the stacked page. `#cc-side` is not drawn.
- The practice picture is an SVG, so `/api/projectmedia/file` now serves `image/svg+xml` inline (the response keeps its sandbox CSP and nosniff).
- Test: test/layout-0421.test.js pins each point. test/simple-send-visible.test.js opens Auto team before it checks Show my AIs.
