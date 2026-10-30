// 0.4.23 Mac dock data and logic (pure logic, no DOM, unit tested)

export const DOCK_ITEMS = [
  { id: "chat", label: "Chat", icon: "💬", gradient: "g1", action: { type: "chat", view: "command" } }, // 0.4.28: opens chat and puts the cursor in the box
  { id: "website", label: "Website", icon: "🌐", gradient: "g2", action: { type: "path", path: "website" } },
  { id: "image", label: "Image", icon: "🎨", gradient: "g3", action: { type: "path", path: "image" } },
  { id: "video", label: "Video", icon: "🎬", gradient: "g4", action: { type: "path", path: "video" } },
  { id: "campaign", label: "Campaign", icon: "📈", gradient: "g5", action: { type: "path", path: "campaign" } },
  { id: "gamemod", label: "Game mod", icon: "🎮", gradient: "g6", action: { type: "path", path: "gamemod" } },
  { type: "sep" },
  { id: "projects", label: "Projects", icon: "📁", gradient: "g7", action: { type: "view", view: "projects" } },
  { id: "mindmedia", label: "MindMedia", icon: "🖼️", gradient: "g8", action: { type: "view", view: "mindmedia" } },
  { id: "history", label: "History", icon: "🕒", gradient: "g7", action: { type: "open", panel: "history" } },
  { type: "sep", expert: true },
  { id: "launchpad", label: "All tools", icon: "🚀", gradient: "g1", action: { type: "open", panel: "launchpad" }, expert: true },
  { id: "live", label: "Live Ops", icon: "⚡", gradient: "g2", action: { type: "open", panel: "live" }, expert: true }
];

export function magnifyScale(distancePx) {
  const d = Math.abs(distancePx);
  const s = Math.max(0, 1 - d / 150);
  return 54 + 34 * s;
}

export function itemsFor(mode) {
  const isExpert = mode === "expert";
  return DOCK_ITEMS.filter((item) => {
    if (item.expert && !isExpert) return false;
    return true;
  });
}
