// Chat history and reuse (0.4.21): quick picks under the start box (recent tasks and saved prompts), and
// "Do this again" / "Change and redo" under a finished answer. Picking a quick pick only fills the box;
// nothing is sent until the person clicks Send. Redo starts the same kind of run again, free for everyone.
const { S, api, toast, esc } = window.CC;

const css = `
#hh-picks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
#hh-picks .hh-l { font-size: .6875rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted, #8b95a7); }
#hh-picks button.hh-pick { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--bg-2, #0d1420); color: var(--text, #e5e7eb); border: 1px solid var(--line-2, #243044); border-radius: 999px; padding: 4px 10px; font-size: .8125rem; cursor: pointer; }
#hh-picks button.hh-pick:hover { border-color: var(--accent, #22d3ee); }
#hh-picks button.hh-pick:focus-visible { outline: 2px solid var(--focus-ring, #22d3ee); outline-offset: 2px; }
.hh-redo { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.hh-redo textarea { flex: 1 1 280px; min-height: 52px; }
`;
if (!document.getElementById("hh-css")) { const el = document.createElement("style"); el.id = "hh-css"; el.textContent = css; document.head.appendChild(el); }

const state = { at: 0, picks: null };

async function loadPicks(force) {
  if (!force && state.picks && Date.now() - state.at < 10000) return state.picks;
  try { state.picks = await api("/chathist/picks"); state.at = Date.now(); } catch { state.picks = state.picks || { recent: [], saved: [] }; }
  return state.picks;
}

function fillBox(text) {
  const box = document.querySelector("#orders");
  if (!box) return;
  box.value = text;
  S.lastOrders = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
}

function paintPicks(el, picks) {
  const items = [...picks.saved.slice(0, 4).map((p) => ({ ...p, saved: true })), ...picks.recent.slice(0, 5)];
  if (!items.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<span class="hh-l">Quick picks</span>${items.map((p, i) => `<button type="button" class="hh-pick" data-hh="${i}" title="${esc(p.text.slice(0, 300))}">${p.saved ? "&#9733; " : ""}${esc(p.label)}</button>`).join("")}`;
  el.querySelectorAll("[data-hh]").forEach((b) => b.addEventListener("click", () => fillBox(items[Number(b.dataset.hh)].text)));
}

async function renderCommand(el) {
  document.getElementById("hh-picks")?.remove();
  el.id = "hh-picks";
  const orders = document.querySelector("#orders");
  if (orders) (document.getElementById("ob-row") || orders).insertAdjacentElement("afterend", el);
  paintPicks(el, await loadPicks());
}

async function redo(id, change) {
  try {
    const r = await api("/chathist/redo", { method: "POST", body: { id, change } });
    state.at = 0;
    toast(r.changed ? "Running it again with your change." : "Running that again.");
  } catch (e) { toast(e.message, true); }
}

function renderDeliverable(container, live) {
  container.innerHTML = "";
  if (!live?.id) return;
  const id = live.id;
  container.innerHTML = `<div class="hh-redo"><button type="button" class="btn sm" id="hh-again">Do this again</button><button type="button" class="btn sm" id="hh-change">Change and redo</button></div><div class="hh-redo" id="hh-form" hidden><textarea id="hh-text" rows="2" placeholder="What should be different this time?" aria-label="What should be different this time"></textarea><button type="button" class="btn sm primary" id="hh-go">Redo with this change</button></div>`;
  container.querySelector("#hh-again").addEventListener("click", () => redo(id));
  container.querySelector("#hh-change").addEventListener("click", () => { const f = container.querySelector("#hh-form"); f.hidden = !f.hidden; if (!f.hidden) container.querySelector("#hh-text").focus(); });
  container.querySelector("#hh-go").addEventListener("click", () => {
    const text = container.querySelector("#hh-text").value.trim();
    if (!text) return toast("Type what should be different, then redo.", true);
    redo(id, text);
  });
}

window.CC.register({
  id: "chat-history",
  command: { order: 6, render: renderCommand },
  deliverable: { order: 14, render: renderDeliverable },
});
