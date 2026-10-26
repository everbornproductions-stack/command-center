// The Prompts dropdown under every creation box (flag_promptdrop, 0.4.19). Pure: no DOM, so the
// tests can call it. Picking a prompt never overwrites typed words: applySuggestion keeps them.
import { applySuggestion, undoState } from "./prompt-suggest.js";

// The creation boxes that get a Prompts button. id is the stage the server uses.
export const DROP_BOXES = ["orders", "im-prompt", "md-prompt", "remix-idea", "remix-looks", "builders-need", "bd-notice"];

export const RECENT_KEY = "cc.pdRecent";
export const RECENT_MAX = 6;
export const GROUP_ORDER = ["recent", "saved", "stage", "sources", "video"];
export const GROUP_LABEL = { recent: "Recent", saved: "Saved", stage: "Stage", sources: "From sources", video: "Video" };

export function readRecent(storage) {
  try {
    const list = JSON.parse(storage?.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && r.id && r.prompt).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

// Newest first, one row per prompt, at most RECENT_MAX. Returns the new list.
export function pushRecent(storage, item) {
  if (!item?.id || !item?.prompt) return readRecent(storage);
  const mine = { id: String(item.id), title: String(item.title || ""), prompt: String(item.prompt), tag: "Recent" };
  const next = [mine, ...readRecent(storage).filter((r) => r.id !== mine.id)].slice(0, RECENT_MAX);
  try { storage?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage can be off */ }
  return next;
}

// Server groups plus the browser's Recent group, in the fixed order, empty groups left out.
export function mergeGroups(serverGroups, recent) {
  const by = new Map((serverGroups || []).map((g) => [g.id, g]));
  if (recent?.length) by.set("recent", { id: "recent", label: GROUP_LABEL.recent, items: recent });
  return GROUP_ORDER.filter((id) => by.get(id)?.items?.length).map((id) => ({ ...by.get(id), label: GROUP_LABEL[id] }));
}

// The new box text for a pick. Typed words are kept (see applySuggestion); Undo restores them.
export function pickInto(typed, item, subject = "") {
  const next = applySuggestion(typed, item, subject);
  return { next, undo: undoState(String(typed ?? ""), next) };
}

// Video tips as plain lines for the panel. Pure so a test can check the wording.
export function tipsFor(data, toolId) {
  const tool = (data?.tools || []).find((t) => t.id === toolId) || (data?.tools || [])[0] || null;
  return { tool, checklist: data?.checklist || [] };
}
