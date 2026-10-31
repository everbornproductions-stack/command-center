// 0.4.29: Ask about Meldmind (read-only). A box, Ask, a short answer, and the facts it used underneath
// ("From: last mission m-..., ledger 3 calls, worker pool"). It sits in Help (both modes) and opens from the
// "Ask about Meldmind" button in the Live feed header (Expert). The server side is server/self-talk.js.
// Nothing here changes a setting: a suggested setting is a button that only opens the right Settings section.
const { api, toast, esc } = window.CC;

const STYLE_ID = "cc-self-ask-style";
function addStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  // Scoped to the part's own roots (LESSONS 2026-10-30).
  st.textContent = `
.cc-self-ask .cc-self-answer{margin-top:10px;display:grid;gap:6px}
.cc-self-ask .cc-self-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
.cc-self-ask .cc-self-from{font-size:12px;opacity:.9;overflow-wrap:anywhere}
.cc-self-ask .cc-self-facts{margin:0;padding-left:18px;font-size:12px;display:grid;gap:3px;overflow-wrap:anywhere}
.cc-self-ask .cc-self-try{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
#cc-self-pop{position:fixed;z-index:9000;right:16px;top:72px;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 110px);overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.45)}
#cc-self-pop .cc-self-pop-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#cc-self-pop .cc-self-pop-head h3{margin:0;flex:1}`;
  document.head.appendChild(st);
}

const EXAMPLES = ["Why did my last job cost what it did?", "Which AI did the planning?", "Why is a helper resting?", "What changed in this version?", "How do I make a spreadsheet?"];

function answerHtml(r) {
  const facts = Array.isArray(r.facts) ? r.facts : [];
  const who = r.source === "ai" && r.provider
    ? `Answered by ${window.CC.pname ? window.CC.pname(r.provider) : r.provider}${r.free ? " (free)" : ""}, using only the facts below.`
    : "No AI was used. This answer is made straight from the facts below.";
  const buttons = (r.suggest || []).map((s, i) => `<button type="button" class="btn sm" data-self-suggest="${i}">${esc(s.label)}</button>`).join("");
  return `<div class="cc-self-text" data-self-text>${esc(r.answer || "")}</div>
    <div class="cc-self-from dim" data-self-from>${esc(r.from || "")}</div>
    ${facts.length ? `<details class="small"><summary>The facts it used (${facts.length})</summary><ul class="cc-self-facts" data-self-facts>${facts.map((f) => `<li data-source="${esc(f.source)}">${esc(f.text)}</li>`).join("")}</ul></details>` : ""}
    ${buttons ? `<div class="cc-self-try">${buttons}</div>` : ""}
    <div class="dim small">${esc(who)} Meldmind only reads here; it never changes a setting for you.</div>`;
}

function follow(s) {
  if (!s) return;
  document.getElementById("cc-self-pop")?.remove();
  if (s.article && window.CC.openHelp) return window.CC.openHelp(s.article);
  if (s.focus && window.CC.openSettings) return window.CC.openSettings(s.focus);
  window.CC.go?.("settings");
}

/** Draw the Ask about Meldmind box into `box`. opts.compact draws it without the outer panel. */
export function renderSelfAsk(box, opts = {}) {
  if (!box) return;
  addStyle();
  const pre = opts.compact ? "pop" : "help";
  box.innerHTML = `<div class="${opts.compact ? "" : "panel "}cc-self-ask" id="self-ask-${pre}" data-self-ask>
    ${opts.compact ? "" : `<h3>Ask about Meldmind</h3>`}
    <p class="dim small" style="margin:0 0 8px">Ask about your jobs, costs, AI helpers, settings or this version. Meldmind answers from its own records on this computer and shows the facts it used. It never changes anything.</p>
    <label class="lbl" for="self-q-${pre}">Your question</label>
    <textarea id="self-q-${pre}" data-self-q rows="2" maxlength="600" placeholder="Try: why did my last job cost 3 cents?"></textarea>
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn sm primary" data-self-go id="self-ask-btn-${pre}">Ask</button>
      ${EXAMPLES.slice(0, opts.compact ? 3 : 5).map((x) => `<button type="button" class="btn sm" data-self-example="${esc(x)}">${esc(x)}</button>`).join("")}
    </div>
    <div class="cc-self-answer" data-self-answer aria-live="polite"></div>
  </div>`;
  const q = box.querySelector("[data-self-q]");
  const out = box.querySelector("[data-self-answer]");
  const btn = box.querySelector("[data-self-go]");
  let last = null;
  async function ask() {
    const question = q.value.trim();
    if (!question) { toast("Type a question first", true); q.focus(); return; }
    btn.disabled = true;
    out.innerHTML = `<div class="dim small">Looking through Meldmind's records...</div>`;
    try {
      last = await api("/self/ask", { method: "POST", body: { question } });
      out.innerHTML = answerHtml(last);
    } catch (e) {
      out.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    } finally { btn.disabled = false; }
  }
  btn.addEventListener("click", ask);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); ask(); } });
  box.addEventListener("click", (e) => {
    const ex = e.target.closest("[data-self-example]");
    if (ex) { q.value = ex.dataset.selfExample; ask(); return; }
    const sg = e.target.closest("[data-self-suggest]");
    if (sg && last) follow((last.suggest || [])[Number(sg.dataset.selfSuggest)]);
  });
}

/** The small window opened from the Live feed header. */
export function openSelfAsk() {
  addStyle();
  let pop = document.getElementById("cc-self-pop");
  if (pop) { pop.querySelector("[data-self-q]")?.focus(); return pop; }
  pop = document.createElement("div");
  pop.id = "cc-self-pop";
  pop.className = "panel";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Ask about Meldmind");
  pop.innerHTML = `<div class="cc-self-pop-head"><h3>Ask about Meldmind</h3><button type="button" class="ghost" id="cc-self-close" aria-label="Close">Close</button></div><div id="cc-self-pop-body"></div>`;
  document.body.appendChild(pop);
  renderSelfAsk(pop.querySelector("#cc-self-pop-body"), { compact: true });
  pop.querySelector("#cc-self-close").addEventListener("click", () => pop.remove());
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.remove(); });
  setTimeout(() => pop.querySelector("[data-self-q]")?.focus(), 30);
  return pop;
}

window.CC.selfAsk = { render: renderSelfAsk, open: openSelfAsk };
// The Live feed header button (web/index.html #feed-ask). One handler on the document, so a redrawn header still works.
if (!window.CC.selfAskBound) {
  window.CC.selfAskBound = true;
  document.addEventListener("click", (e) => { if (e.target.closest?.("#feed-ask")) openSelfAsk(); });
}
window.CC.register({ id: "self-talk" });
