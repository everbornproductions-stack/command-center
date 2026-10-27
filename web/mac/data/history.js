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
