// 0.4.23 Mac-style GUI: History data & pure logic (no DOM, unit tested)
// Implements groupByDay, filterChats, and titleOf.

export function titleOf(chat) {
  if (!chat) return "Untitled chat";
  const t = (chat.title || "").trim();
  if (t) return t;
  const msg = chat.messages?.[0]?.text || chat.text || chat.summary || "";
  const clean = msg.replace(/\s+/g, " ").trim();
  if (clean) return clean.slice(0, 40) + (clean.length > 40 ? "..." : "");
  return "Untitled chat";
}

export function filterChats(chats, query) {
  if (!Array.isArray(chats)) return [];
  const q = (query || "").trim().toLowerCase();
  if (!q) return chats;
  return chats.filter((c) => {
    const title = titleOf(c).toLowerCase();
    const firstMsg = (c.messages?.[0]?.text || c.text || "").toLowerCase();
    return title.includes(q) || firstMsg.includes(q);
  });
}

export function groupByDay(chats, now = Date.now()) {
  if (!Array.isArray(chats)) return [];
  const nowDate = new Date(now);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 7 * 86400000;

  const groups = {
    today: { label: "Today", items: [] },
    yesterday: { label: "Yesterday", items: [] },
    week: { label: "This week", items: [] },
    earlier: { label: "Earlier", items: [] },
  };

  for (const c of chats) {
    const time = Number(c.updatedAt || c.createdAt || c.at || 0);
    if (time >= todayStart) {
      groups.today.items.push(c);
    } else if (time >= yesterdayStart) {
      groups.yesterday.items.push(c);
    } else if (time >= weekStart) {
      groups.week.items.push(c);
    } else {
      groups.earlier.items.push(c);
    }
  }

  const result = [];
  for (const k of ["today", "yesterday", "week", "earlier"]) {
    if (groups[k].items.length > 0) {
      groups[k].items.sort((a, b) => Number(b.updatedAt || b.createdAt || b.at || 0) - Number(a.updatedAt || a.createdAt || a.at || 0));
      result.push(groups[k]);
    }
  }
  return result;
}

// 0.4.34 (Chris: "the history page that pops up in simple is getting really long... organize it into general categories
// so people can find things easier, with the latest category used moved up depending on last project worked on"):
// work in a project is grouped under that project; everything else by kind of work. The current project's group comes
// first, then every other group by its newest item. Pure, so tests import it.
export const CATEGORIES = [
  { id: "web", label: "Websites", ext: /\.(?:html?|css)$/i, words: /\b(?:website|web ?page|landing page|site)\b/i },
  { id: "docs", label: "Documents", ext: /\.(?:docx?|md|txt|pdf|rtf)$/i, words: /\b(?:letter|document|handbook|guide|policy|report|essay|checklist|menu|sop|plan)\b/i },
  { id: "sheets", label: "Spreadsheets and data", ext: /\.(?:xlsx?|csv|json|sql|db)$/i, words: /\b(?:spreadsheet|excel|budget|tracker|csv|table|list of|database|payroll|invoice)\b/i },
  { id: "slides", label: "Slides", ext: /\.(?:pptx?|key)$/i, words: /\b(?:slides?|deck|powerpoint|presentation)\b/i },
  { id: "media", label: "Pictures and video", ext: /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|mp3|wav)$/i, words: /\b(?:image|picture|photo|logo|video|clip|reel|thumbnail|song|music|voice)\b/i },
  { id: "code", label: "Code and apps", ext: /\.(?:js|mjs|cjs|ts|py|ps1|bat|cmd|sh|gs|java|cs|go|rs)$/i, words: /\b(?:script|app|code|program|function|python|powershell|node|bot|game|mod)\b/i },
];
export const CHATS = { id: "chats", label: "Chats" };
export const SHOW_FIRST = 5;

/** The kind of work a history row is: its file's type first, else the words in its title. */
export function categoryOf(row) {
  const file = String(row?.file || "");
  if (file) { const c = CATEGORIES.find((x) => x.ext.test(file)); if (c) return c; }
  const title = String(row?.title || "");
  return CATEGORIES.find((x) => x.words.test(title)) || CHATS;
}

const timeOf = (r) => Number(r?.at || r?.updatedAt || r?.createdAt || 0);

/**
 * Groups for the drawer. projects: [{ id, name }]; current: the project in use now.
 * Returns [{ key, label, kind: "project" | "category", items, latest, current }].
 */
export function groupForDrawer(rows, { projects = [], current = "", filter = "all" } = {}) {
  const names = new Map((projects || []).map((p) => [p.id, p.name]));
  const groups = new Map();
  // a filter chip shows one kind of work (across projects too), or only project groups
  const keep = (r) => filter === "all" || (filter === "projects" ? !!(r.projectId && names.has(r.projectId)) : categoryOf(r).id === filter);
  const list0 = (Array.isArray(rows) ? rows : []).filter(keep);
  // pinned items get their own group at the very top
  const pinned = list0.filter((r) => r.pinned);
  if (pinned.length) groups.set("pinned", { key: "pinned", label: "Pinned", kind: "pinned", items: pinned, latest: Math.max(...pinned.map(timeOf)), current: false });
  for (const r of list0) {
    if (r.pinned) continue;
    if (filter !== "all" && filter !== "projects") { const c = categoryOf(r); const key = `c:${c.id}`; if (!groups.has(key)) groups.set(key, { key, label: c.label, kind: "category", items: [], latest: 0, current: false }); const g = groups.get(key); g.items.push(r); g.latest = Math.max(g.latest, timeOf(r)); continue; }
    const inProject = r.projectId && names.has(r.projectId);
    const key = inProject ? `p:${r.projectId}` : `c:${categoryOf(r).id}`;
    if (!groups.has(key)) groups.set(key, { key, label: inProject ? names.get(r.projectId) : categoryOf(r).label, kind: inProject ? "project" : "category", items: [], latest: 0, current: !!inProject && r.projectId === current });
    const g = groups.get(key);
    g.items.push(r);
    g.latest = Math.max(g.latest, timeOf(r));
  }
  const list = [...groups.values()];
  for (const g of list) g.items.sort((a, b) => (Number(b.pinned || 0) - Number(a.pinned || 0)) || (timeOf(b) - timeOf(a)));
  const rank = (g) => (g.kind === "pinned" ? 2 : g.current ? 1 : 0);
  list.sort((a, b) => (rank(b) - rank(a)) || (b.latest - a.latest));
  return list;
}

/** The chips across the top of the drawer, with how many rows each would show. */
export function filterChips(rows, projects = []) {
  const names = new Set((projects || []).map((p) => p.id));
  const all = Array.isArray(rows) ? rows : [];
  const count = (fn) => all.filter(fn).length;
  const chips = [{ id: "all", label: "All", n: all.length }, { id: "projects", label: "Projects", n: count((r) => r.projectId && names.has(r.projectId)) }];
  for (const c of [...CATEGORIES, CHATS]) chips.push({ id: c.id, label: c.label.split(" and ")[0], n: count((r) => categoryOf(r).id === c.id) });
  return chips.filter((c) => c.id === "all" || c.n > 0);
}

/** "2h ago", "3d ago", "just now". */
export function agoWord(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(ms || 0)) / 1000));
  if (!ms || s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
