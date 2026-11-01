// 0.4.31 (Chris: "if you hover over an item.. it should have a small pop up on what it does? like single? council
// mission?"): one tip for the whole app. Hover a button (or reach it with Tab) and a small box says what it does.
// The words come from, in order: data-tip, the button's own title (moved to data-tip so the slow grey browser
// tooltip does not show twice), a plain sentence from TIPS below for the run modes and other controls, or the
// aria-label of an icon-only button. The pure part (tipFor, TIPS) has no window, so tests import it.

export const SHOW_MS = 350; // hover delay; keyboard focus shows at once
export const MAX_WIDTH = 280;

// Plain sentences for the controls people ask about. Keyed by the group the button sits in and its data-m.
export const TIPS = {
  "mode:auto": "Auto: Meldmind picks the best way to run it (one AI, a team, or a plan) and tells you which.",
  "mode:single": "Single: one AI answers. Fastest and cheapest. Good for questions, emails and quick drafts.",
  "mode:council": "Council: several AIs answer the same question, check each other, and one writes the final answer. Good when you want more than one opinion.",
  "mode:mission": "Mission: Meldmind plans the job, splits it into steps, gives each step to the best AI, checks the work and puts it together. Good for big jobs like a website, an app or a report.",
  "mode:research": "Research: searches the web and answers with numbered sources you can check.",
  "mode:opinion": "Second opinion: two AIs answer the same request and Meldmind shows where they differ. Both answers stay.",
  "prio:max": "Max quality: the strongest AIs, whatever they cost. Your spending limit still applies.",
  "prio:quality": "Quality: strong AIs, with an eye on cost.",
  "prio:balanced": "Balanced: good answers at a fair price. The usual choice.",
  "prio:savings": "Max savings: free and low-cost AIs first. Paid AIs only for the hard parts.",
  "prio:speed": "Speed: the fastest AIs, for quick answers.",
  "when:now": "Now: start right away.",
  "when:offpeak": "Off-peak: wait for the next discount window (some AIs cost less at night) and run it then.",
  // the pages in the sidebar and menus (data-view)
  "view:command": "Command: type what you want and send it to your AIs.",
  "view:projects": "Projects: your work grouped by project, with files and history.",
  "view:compare": "Compare: send one request to several AIs and see the answers side by side.",
  "view:pipelines": "Pipelines: saved jobs with the steps already chosen. Nothing starts until you click Run.",
  "view:agents": "Agents: your AI employees. Pick one, say what you need, and it does the work with your own AI keys.",
  "view:liveview": "Live: watch your AIs work, step by step, as it happens.",
  "view:schedules": "Schedules: run a job by itself at a set time or every day.",
  "view:libraries": "Libraries: your own documents that the AIs can read and quote.",
  "view:artifacts": "Artifacts: mini apps, charts and pages from your answers, opened safely, with versions you can edit and export.",
  "view:history": "History: every past job and answer, searchable.",
  "view:everyday-inbox": "Inbox and tasks: your email and to-dos, sorted with help from your AIs.",
  "view:everyday-plan": "Day plan: a plan for today from your calendar and tasks.",
  "view:everyday-work": "Docs and follow-up: drafts, notes and follow-ups in one place.",
  "view:refocus": "Refocus: find unfinished work on a topic across your chats and files, then rebuild one complete version.",
  "view:brain": "Who's best: which AI does best at which kind of job, learned from your own results.",
  "view:prompts": "Pro prompts: ready-made requests you can use or change, with new ones every week.",
  "view:images": "Images: make or edit pictures.",
  "view:media": "Media: make videos, voice and music.",
  "view:mindmedia": "MindMedia: every picture, video and file Meldmind made for you.",
  "view:publish": "Publish: post or send finished work. Nothing goes out without your click.",
  "view:remix": "Remix: say what to build or change, and Meldmind makes it in its own folder, tests it and hands you the files.",
  "view:builders": "Builders: guided makers for invoices, receipts, contracts, booking pages, posts and ads. Nothing is sent until Publish.",
  "view:webbuilders": "Web and marketing: build pages, emails and campaigns.",
  "view:marketplace": "Marketplace: add-ons and helpers you can turn on.",
  "view:subscriptions": "Subscriptions: use the AI plans you already pay for, like ChatGPT or Claude.",
  "view:credits": "Credits: what each AI has left, what you spent and what Meldmind saved you.",
  "view:workspaces": "Teams: share projects and AIs with people you invite.",
  "view:together": "Together: team spaces, a group chat with your AIs, and rooms where you watch builds live.",
  "view:userchat": "People: talk with the people on your team.",
  "view:reports": "Reports: summaries of your spending, savings and work.",
  "view:community": "Community: chat channels with other Meldmind users and the weekly AI News.",
  "view:ai-news": "AI News: what changed in the AI world this week.",
  "view:settings": "Settings: your AIs, keys, limits and how Meldmind looks.",
  "view:setup": "Find my AIs: Meldmind looks for the AIs you already have on this PC.",
  "view:help": "Help: search answers, take the tour or contact us.",
  "view:start": "Start a project: describe it once and Meldmind sets it up.",
};

const GROUPS = [
  { re: /(^|-)(run-mode|simple-run-mode|mac-rb-modes)$/, prefix: "mode" },
  { re: /(^|-)(cost-mode)$/, prefix: "prio" },
  { re: /(^|-)(when-mode|mac-rb-when)$/, prefix: "when" },
];

/**
 * The tip for one control, from plain facts about it (so it can be tested without a page):
 * { tip, title, label, text, m, groupId }. Returns "" when nothing useful can be said.
 */
export function tipFor({ tip = "", title = "", label = "", text = "", m = "", groupId = "", view = "" } = {}) {
  if (m && groupId) {
    const g = GROUPS.find((x) => x.re.test(groupId));
    if (g && TIPS[`${g.prefix}:${m}`]) return TIPS[`${g.prefix}:${m}`];
  }
  const own = String(tip || title || "").trim();
  if (own) return own;
  if (view && TIPS[`view:${view}`]) return TIPS[`view:${view}`];
  // an icon-only button: its accessible name is the only words it has
  const shown = String(text || "").replace(/\s+/g, " ").trim();
  const name = String(label || "").trim();
  if (name && (!shown || /^[^\p{L}\p{N}]+$/u.test(shown))) return name;
  return "";
}

// ---------- the page part ----------
const TARGET = "button, a[href], [role=button], [role=tab], [role=menuitem], label, select, input[type=checkbox], input[type=radio], summary, [data-tip], [title]";
const SKIP = "#mac-dock, #mac-dock *, [data-no-tip], .cc-tip"; // the dock shows its own name labels

function factsOf(el) {
  const group = el.closest("[role=group], .seg, .mac-runbar-seg");
  return {
    tip: el.dataset.tip || "", title: el.getAttribute("title") || "", label: el.getAttribute("aria-label") || "",
    text: el.textContent || "", m: el.dataset.m || "", groupId: group?.id || "",
    view: el.dataset.view && !el.dataset.focus ? el.dataset.view : "",
  };
}

export function installTips(doc = typeof document !== "undefined" ? document : null) {
  if (!doc || doc.__ccTips) return null;
  doc.__ccTips = true;
  const win = doc.defaultView;
  const box = doc.createElement("div");
  box.className = "cc-tip"; box.id = "cc-tip"; box.setAttribute("role", "tooltip"); box.hidden = true;
  const style = doc.createElement("style");
  style.textContent = `.cc-tip{position:fixed;z-index:2147483000;max-width:${MAX_WIDTH}px;padding:7px 10px;border-radius:8px;font:500 12.5px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;--tip-fg:#f5f7fa;--tip-bg:#1f2430;color:var(--tip-fg);background:var(--tip-bg);box-shadow:0 6px 20px rgba(0,0,0,.28);pointer-events:none;opacity:0;transform:translateY(2px);transition:opacity .12s,transform .12s}
.cc-tip.on{opacity:1;transform:none}
[data-theme="light"] .cc-tip,body[data-theme="light"] .cc-tip{--tip-fg:#14181f;--tip-bg:#ffffff;border:1px solid #c9d1db;box-shadow:0 6px 20px rgba(20,24,31,.16)}
@media (prefers-reduced-motion: reduce){.cc-tip{transition:none}}`;
  doc.head.appendChild(style);
  doc.body.appendChild(box);

  let timer = null, cur = null;
  const hide = () => {
    clearTimeout(timer); timer = null;
    if (cur) { if (cur.getAttribute("aria-describedby") === "cc-tip") cur.removeAttribute("aria-describedby"); cur = null; }
    box.classList.remove("on"); box.hidden = true;
  };
  const place = (el) => {
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const vw = win.innerWidth, vh = win.innerHeight;
    let top = r.bottom + 8;
    if (top + b.height > vh - 8) top = Math.max(8, r.top - b.height - 8); // no room below: above it
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(8, Math.min(left, vw - b.width - 8));
    box.style.top = `${Math.round(top)}px`; box.style.left = `${Math.round(left)}px`;
  };
  const show = (el) => {
    if (!el.isConnected) return; // the bar redrew under the pointer; the next move finds the new button
    // the browser's own tooltip would show the same words a second later: keep the words, drop the title
    // (a title set again later, like the savings pill's, is newer than the copy, so it wins; screen readers keep the
    // words through aria-description)
    if (el.hasAttribute("title")) { const t = el.getAttribute("title"); if (t) { el.dataset.tip = t; el.setAttribute("aria-description", t); } el.removeAttribute("title"); }
    const words = tipFor(factsOf(el));
    if (!words) return;
    cur = el;
    box.textContent = words;
    box.hidden = false;
    place(el);
    box.classList.add("on");
    if (!el.hasAttribute("aria-describedby")) el.setAttribute("aria-describedby", "cc-tip");
  };
  const targetOf = (e) => {
    const el = e.target?.closest?.(TARGET);
    if (!el || el.closest(SKIP) || el.closest("[aria-hidden=true]")) return null;
    return el;
  };
  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return; // a tap is a press, not a hover
    const el = targetOf(e);
    if (el === cur) return;
    hide();
    if (!el) return;
    timer = setTimeout(() => show(el), SHOW_MS);
  });
  doc.addEventListener("pointerout", (e) => { if (cur || timer) { const to = e.relatedTarget; const el = targetOf(e); if (!to || !el || !el.contains(to)) hide(); } });
  doc.addEventListener("focusin", (e) => {
    const el = targetOf(e);
    hide();
    if (el && el.matches(":focus-visible")) show(el); // keyboard only; a click does not pop a tip
  });
  doc.addEventListener("focusout", hide);
  doc.addEventListener("pointerdown", hide, true);
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && cur) hide(); }, true);
  win.addEventListener("scroll", hide, true);
  win.addEventListener("resize", hide);
  return { hide, box };
}
