// 0.4.23 Mac-style GUI: the list of parts. One file per part under /mac/parts, one CSS file per part under /mac/css.
// Each part is owned by one builder. Add a part here only from the lead branch (integration/0.4.23).
// Mount order matters: the shell makes the slots the other parts draw into.
export const PARTS = [
  "shell",      // window frame, title bar (crumb, ready pill, Simple/Expert switch, theme, help), glass, light/dark, slots
  "dock",       // the magnifying app dock at the bottom
  "cards",      // swipe style cards (Pick a style) and the preset lists per path
  "flow",       // 3 step flow: style, tell us, AIs working, Done with ONE finish button
  "history",    // History sidebar that slides in from the left
  "expert",     // Expert sidebar groups and the All tools launchpad (every view reachable)
  "runbar",     // Expert run bar: run mode, priority, when, free only
  "liveops",    // Live Ops screen, Simple "AIs working" bars and "Show steps"
  "panel",      // the advanced settings panel that slides in from the right
  "inside",     // 0.4.26: Chaos-style paper inside the Expert window (page header, cards, KPI tiles, one notice row)
];
