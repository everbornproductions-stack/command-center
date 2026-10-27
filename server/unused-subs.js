// Which subscriptions Meldmind has not used in 30 days (0.4.21 item 14, the weekly report's "Keep, downgrade, cancel").
// "Used through Meldmind" means a call, picture or search was billed to that AI in the ledger, through its API key or
// through the person's signed-in plan app (Claude Code, Codex, Gemini CLI). Pure: rows and ledger entries come in.
export const DAYS = 30;
const PLAN_OF = { anthropic: ["plan-claude-code"], openai: ["plan-codex"], google: ["plan-gemini-cli", "antigravity"] };
const USE_KINDS = new Set(["call", "image", "search", "video"]);

const idsFor = (s) => [s.provider, ...(PLAN_OF[s.provider] || [])].filter(Boolean);

export function usedProviders(entries, now = Date.now(), days = DAYS) {
  const since = now - days * 86400000;
  const used = new Set();
  for (const e of entries || []) if (e && USE_KINDS.has(e.kind) && e.ts >= since && e.provider) used.add(e.provider);
  return used;
}

// -> { unused: [row], unknown: [row] }
//   unused  linked to an AI Meldmind can run, priced or listed, and not used for 30 days (and not added in the last 30 days)
//   unknown not linked to an AI, so Meldmind cannot see whether it is used; the report says so instead of guessing
export function unusedSubscriptions(subs, entries, now = Date.now(), days = DAYS) {
  const used = usedProviders(entries, now, days);
  const unused = [], unknown = [];
  for (const s of subs || []) {
    if (!s || s.cancelled) continue;
    const priced = s.monthly != null || s.listPrice != null;
    if (!priced) continue;
    if (s.addedAt && now - s.addedAt < days * 86400000) continue; // too new to judge
    if (!s.provider) { unknown.push(s); continue; }
    if (!idsFor(s).some((id) => used.has(id))) unused.push(s);
  }
  return { unused, unknown };
}

export const priceWord = (s) => (s.monthly != null ? `$${s.monthly}/month` : s.listPrice ? `list ~$${s.listPrice}/month` : "");
export function unusedLines(subs, entries, now = Date.now()) {
  const { unused, unknown } = unusedSubscriptions(subs, entries, now);
  const lines = unused.map((s) => `- **${s.name}**: not used through Meldmind in ${DAYS} days${priceWord(s) ? `, ${priceWord(s)}` : ""}. Consider cancelling or downgrading, unless you use it outside Meldmind.`);
  if (unknown.length) lines.push(`- Meldmind cannot see use of ${unknown.map((s) => s.name).join(", ")} (not linked to an AI it can run). Check those yourself.`);
  return lines;
}
