# Meldmind: current 0.4.21 vs proposed Mac-style look (Oct 26, 2026)

Mockup: mockup.html (open in any browser; no internet needed). Shots: 01-07 PNGs, demo.mp4 / demo.gif.
Current shots: current/01-06 (taken from integration/0.4.21 on Oct 26, 2:04 PM PT).

## Current (0.4.21)
- Dark, full-bleed window over a blurred photo. Left sidebar (New, Projects, MindMedia, Create, Recent chats, Settings).
- The "dock" in 0.4.21 is the **chat box docked at the bottom** of every screen (Chat · Media, suggestion + Send), not an app launcher.
- Paths (Website, Image, Video...) are reached through Create / chat; results show as cards with Keep / Publish / Discard.
- Simple / Expert switch and a Live indicator at top right. Glass look exists but is mostly a dark tint.

## Proposed (mockup)
- Frosted glass window with Mac traffic lights, soft colour background, light and dark.
- RocketDock/macOS dock at the bottom: Website, Video, Image, Campaign, Game mod, Chat | MindMedia, History. Icons magnify under the mouse and bounce on click.
- Each path: 1 Pick a style (swipe cards like Launchpad pages: drag, trackpad, ← →, dots, "Most popular" pre-picked) → 2 Tell us about it (one sentence + swipeable photo strip, tap for full screen) → AIs working (3 progress bars) → 3 Done: big finished result with ONE finish button (Publish / Download / Post).
- History sidebar (search, Today/Yesterday) slides in and out.

## What already matches the plan
Big result + one finish button, History in the sidebar, swipeable upload strip, chat on every screen, light/dark: all in the 0.4.21 notes. **Not planned anywhere:** an app-launcher dock with magnification, swipe carousels for choosing, spring animations, Mac window chrome.

## Effort to adopt (honest guess)
| Piece | Effort | Confidence |
|---|---|---|
| Dock with magnification (CSS/JS, as in mockup) living beside the chat dock | 1-2 days incl. tests | High |
| Glass + light theme polish (needs the GPU/glass fix from 0.4.21 notes first) | 1-2 days | Medium (Windows blur is the risk) |
| Swipe style cards per path (needs real preset lists per builder) | 2-3 days | Medium |
| 3-step flow wrapping existing builders + result card | 3-5 days | Medium-low (touches every path, many pinned tests, layout-0421 gap tests) |
| Animations everywhere | 1 day, tune ongoing | High |
Total: roughly 1.5-2.5 weeks of agent build time plus a dogfood pass. Confidence: medium.

## Fit
- **0.4.22:** dock with magnification, light/dark glass polish, swipe style cards on 1-2 paths (Website, Image). Low risk, very visible.
- **0.4.23 or later:** the full 3-step flow on every path and retiring the left nav items the dock replaces; do it after 0.4.22 rechecks that every path ends in the shared result card.
- Watch: two docks (chat dock + app dock) at the bottom; mockup suggests app dock at the very bottom, chat box inside the window.
