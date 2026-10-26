// Backup when API credits run out: the words and HTML shared by Settings, first-run Setup and the waiting box.
// Pure functions (no DOM), so tests can check them. The wiring is in web/features/answer-wait.js.
export const TITLE = "Backup when API credits run out";
export const INTRO = "If an AI runs out of API credits, Meldmind can keep answering through your own plan for that AI.";
export const SWITCH = "When API credits run out, use my subscriptions";
export const ORDER_LINE = "1. Official apps on this PC, 2. Website (if you turned it on), 3. You copy it over";
export const STEP_LABEL = { apps: "Official apps on this PC", website: "Website (if you turned it on)", copy: "You copy it over" };
export const PLAN_FIRST_LABEL = "Use my plan first";
export const PLAN_FIRST_NOTE = "Easy and everyday jobs go to an official app on this PC that is signed in with your own subscription (Claude Code, Codex, Gemini CLI) before any model that charges per call. If an app runs out of quota it sits out for an hour and the next best choice answers.";
export const WAIT_NOTE = "Meldmind checks for the answer on its own. Nothing is sent anywhere for you.";

const plainEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function elapsed(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

// The Settings and Setup panel. view is GET /api/answerwait.
export function panelHtml(view = {}, { esc = plainEsc, setup = false } = {}) {
  const rows = (view.routes || []).map((r) => {
    const tone = r.status === "ready" ? "green" : r.status === "signin" ? "amber" : "";
    return `<div class="row small cc-aw-route" data-aw-route="${esc(r.id)}" style="gap:8px;padding:6px 0;flex-wrap:wrap;align-items:center">
      <b style="min-width:120px">${esc(r.name)}</b><span class="dim">for ${esc(r.ai)}</span>
      <span class="chip ${tone}" data-aw-status="${esc(r.status)}">${esc(r.label)}</span>
      <label class="row" style="gap:4px;margin-left:auto"><input type="checkbox" data-aw-route-on="${esc(r.id)}" ${r.on ? "checked" : ""} ${r.status === "ready" ? "" : "disabled"}> Use it</label>
      ${r.status === "ready" ? "" : `<button type="button" class="btn sm" data-aw-setup="${esc(r.setupUrl || "")}">How to set it up</button>`}
    </div>`;
  }).join("");
  return `<div class="panel" id="cc-aw-settings"><h3>${esc(TITLE)}</h3>
    <div class="hint">${esc(INTRO)}</div>
    <label class="row small" style="gap:6px;margin-top:8px"><input type="checkbox" id="cc-aw-on" ${view.on !== false ? "checked" : ""}> ${esc(SWITCH)}</label>
    <div class="small" style="margin-top:8px">The order Meldmind tries: ${esc(view.chainLine || ORDER_LINE)}</div>
    <div class="cat-h" style="margin-top:12px">1. Official apps on this PC</div>
    <div class="small dim">${esc(view.appsNote || "Uses the official app for each AI, signed in with your own plan.")} Meldmind never signs in for you and never sees a password. Grok has no official app for this, so it uses step 3.</div>
    ${rows || `<div class="dim small">Checking this PC...</div>`}
    <div class="row" style="margin-top:6px"><button type="button" class="btn sm" id="cc-aw-check">Check again</button></div>
    <div class="cat-h" style="margin-top:12px">${esc(PLAN_FIRST_LABEL)}</div>
    <label class="row small" style="gap:6px"><input type="checkbox" id="cc-aw-planfirst" ${view.planMeter?.on ? "checked" : ""}> ${esc(PLAN_FIRST_LABEL)}</label>
    <div class="small dim">${esc(PLAN_FIRST_NOTE)}</div>
    ${(view.planMeter?.routes || []).filter((r) => r.ready).map((r) => `<div class="small" data-aw-meter="${esc(r.id)}">${esc(r.name)}: ${Number(r.answersToday) || 0} answer${r.answersToday === 1 ? "" : "s"} today${r.outOfQuota ? `, out of quota since ${esc(new Date(r.outAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}` : ""}</div>`).join("")}
    <div class="cat-h" style="margin-top:12px">2. Website</div>
    <label class="row small" style="gap:6px"><input type="checkbox" id="cc-aw-website" ${view.website ? "checked" : ""}> ${esc(view.websiteLabel || "Let Meldmind use the website for me (ChatGPT, Claude, Grok)")}</label>
    <div class="hint" role="note">${esc(view.websiteWarning || "")}</div>
    ${view.website ? `<div class="small">${esc(view.websiteNote || "Website mode is on. If the apps cannot answer, Meldmind tries the website in its own window and asks you before it sends.")}</div>` : ""}
    <div class="cat-h" style="margin-top:12px">3. You copy it over</div>
    <div class="small dim">Continue in copies the question and opens that AI's page. The question asks the AI to send its answer back, and Meldmind checks for it. Paste reply is always there too.</div>
    ${setup ? `<div class="small dim" style="margin-top:8px">You can change this later in Settings.</div>` : ""}
  </div>`;
}

// The waiting box inside a chat answer, a council seat, or a side-by-side column.
export function waitBoxHtml(w = {}, { esc = plainEsc, now = Date.now() } = {}) {
  if (!w?.jobId) return "";
  const steps = ["apps", "website", "copy"];
  const at = Math.max(0, steps.indexOf(w.step || "copy"));
  const list = steps.map((id, i) => `<li class="${i === at ? "on" : i < at ? "done" : ""}">${esc(STEP_LABEL[id])}${i === at ? " (now)" : ""}</li>`).join("");
  const head = w.headline || `Out of API credits. Answering through your ${w.ai || "AI"} subscription.`;
  return `<div class="cc-aw" data-aw="${esc(w.jobId)}" role="status">
    <div><b>${esc(head)}</b></div>
    <div class="small dim">Waiting <span data-aw-since="${Number(w.since) || now}">${esc(elapsed(now - (Number(w.since) || now)))}</span>. ${esc(WAIT_NOTE)}</div>
    <ol class="cc-aw-steps small">${list}</ol>
    ${w.website ? `<div class="small">Website mode is on: Meldmind tries the website in its own window and asks you before it sends.</div>` : ""}
    <div class="row cc-aw-btns" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      <button type="button" class="btn sm primary" data-aw-continue="${esc(w.jobId)}">Continue in ${esc(w.ai || "the AI")}</button>
      <button type="button" class="btn sm" data-aw-paste="${esc(w.jobId)}">Paste reply</button>
      <button type="button" class="btn sm" data-aw-stop="${esc(w.jobId)}">Stop waiting</button>
    </div>
    <div class="cc-aw-paste" data-aw-box="${esc(w.jobId)}" hidden>
      <label class="small" for="aw-paste-${esc(w.jobId)}">Paste the reply. If it has a MELDMIND ANSWER block, only the text inside it is kept.</label>
      <textarea id="aw-paste-${esc(w.jobId)}" rows="4" style="width:100%;margin-top:4px"></textarea>
      <button type="button" class="btn sm primary" data-aw-save="${esc(w.jobId)}" style="margin-top:4px">Save reply</button>
    </div>
  </div>`;
}

// Only a complete block for one of these job ids counts; the template line in our own prompt does not.
const BLOCK_RE = /^[ \t>*_`#]*MELDMIND ANSWER[ \t]+([A-Za-z0-9_-]{6,80})[ \t*_`]*\r?\n([\s\S]*?)\r?\n[ \t>*_`#]*END MELDMIND ANSWER[ \t*_`]*$/gm;
export function findBlock(text, ids) {
  const want = new Set(ids || []);
  BLOCK_RE.lastIndex = 0;
  let m, hit = null;
  while ((m = BLOCK_RE.exec(String(text || "")))) {
    const answer = m[2].trim();
    if (!answer || answer === "(your full answer here)" || !want.has(m[1])) continue;
    hit = { jobId: m[1], answer };
  }
  return hit;
}
