// 0.4.22 free AIs bid first: the "Free" label on each step, the "Saved about $X versus paid AIs" header, and a
// Settings panel with the "Free AIs bid first" switch and each free AI's daily limit (used / left).
// The text helpers are plain functions so they can be tested without a page.
const CC = () => globalThis.window?.CC;
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const esc = (s) => (CC()?.esc || escape)(s);

// "Free: Groq" for a step done by a free AI, "" for a paid one
export function freeLabel(step) {
  if (!step || !step.free) return "";
  return step.freeAi || step.ai ? `Free: ${step.freeAi || step.ai}` : "Free";
}
// "Saved about $0.12 versus paid AIs", or "" when nothing was saved
export function savedHeader(steps) {
  const usd = (steps || []).filter((s) => s && s.free).reduce((a, s) => a + (Number(s.paidEst) || 0), 0);
  if (!(usd > 0)) return "";
  return `Saved about ${usd < 0.01 ? "less than 1 cent" : `$${usd.toFixed(2)}`} versus paid AIs`;
}
export const stepBadgeHtml = (step) => { const t = freeLabel(step); return t ? `<span class="chip green cc-free-badge">${esc(t)}</span> ` : ""; };
export const savedHeaderHtml = (steps) => { const t = savedHeader(steps); return t ? `<div class="small cc-saved-line" id="cc-saved-line">${esc(t)}</div>` : ""; };

// "Groq free tier: 120 used, 880 left today" / "... out until tomorrow"
export function limitLine(l) {
  if (!l) return "";
  if (l.out) return `${l.name}: out for today${l.reason ? `, ${l.reason}` : ""}. Back tomorrow.`;
  if (l.limit == null) return `${l.name}: ${l.used} used today, no known limit`;
  return `${l.name}: ${l.used} used, ${l.left} left today`;
}

async function renderSettings(el) {
  const { api, toast } = CC();
  let d;
  try { d = await api("/free-bids/limits"); } catch { d = { bidsFirst: true, parallel: 3, limits: [] }; }
  el.innerHTML = `<div class="panel" id="cc-freebids-settings"><h3>Free AIs bid first</h3>
    <label class="row small" style="gap:6px"><input type="checkbox" id="cc-bids-first" ${d.bidsFirst ? "checked" : ""}> Free AIs bid first</label>
    <p class="small muted" style="margin:4px 0 8px">Every step goes to the best free AI with room left. A paid AI is used only when no free AI is ready, or a free one would be clearly worse. Steps that do not depend on each other run at the same time on different free AIs.</p>
    <h4 style="margin:6px 0">Free AI limits today</h4>
    <div id="cc-free-limits" class="small">${(d.limits || []).filter((l) => l.used || l.out || l.limit).map((l) => `<div>${esc(limitLine(l))}</div>`).join("") || '<span class="dim">No free AI has been used yet today.</span>'}</div></div>`;
  el.querySelector("#cc-bids-first").addEventListener("change", async (ev) => {
    const box = ev.target;
    try { await api("/settings", { method: "POST", body: { freeBidsFirst: box.checked } }); toast(box.checked ? "Free AIs will bid first." : "Free AIs will not bid first."); }
    catch (e) { box.checked = !box.checked; toast(e.message, true); }
  });
}

if (CC()?.register) {
  CC().freeBids = { freeLabel, savedHeader, stepBadgeHtml, savedHeaderHtml, limitLine };
  CC().register({ id: "free-bids-ui", settings: { order: 3, render: renderSettings } });
}
