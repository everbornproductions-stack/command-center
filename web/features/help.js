// Help tab: searchable guides from /api/help, plus Ask Meldmind.
// Ask sends only when the button is clicked. With no connected AI the server returns search hits.
const { api, toast, esc, md } = window.CC;

function renderTab(view) {
  view.innerHTML = `<div class="help-page">
    <div class="panel">
      <h3>Help</h3>
      <p class="dim" style="margin:0 0 10px">Search the guides, or ask a connected AI. Ask Meldmind answers only from these articles. With no connected AI, you get the search.</p>
      <label class="lbl" for="help-search">Search</label>
      <input id="help-search" type="search" placeholder="Search help" autocomplete="off">
      <div id="help-list" class="help-list"></div>
    </div>
    <div class="panel" id="help-article" hidden></div>
    <div class="panel">
      <h3>Ask Meldmind</h3>
      <label class="lbl" for="help-q">Question</label>
      <textarea id="help-q" rows="3" placeholder="Ask about keys, Simple mode, or approvals"></textarea>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
        <button class="btn sm primary" type="button" id="help-ask">Ask Meldmind</button>
        <button class="btn sm" type="button" id="help-start">Start a project</button>
        <button class="btn sm" type="button" id="help-replay">Replay the tour</button>
        <button class="btn sm" type="button" id="help-examples">Watch example projects</button>
        <button class="btn sm" type="button" id="help-upd">Check for updates</button>
        <p class="dim small" style="margin:8px 0 0">Take the tour again any time. Watch example projects replays a labeled sample. No AI is called for an example.</p>
      </div>
      <div id="help-answer" class="help-answer"></div>
    </div>
  </div>`;

  let articles = [];
  const list = view.querySelector("#help-list");
  const article = view.querySelector("#help-article");

  function showList(q) {
    const query = String(q || "").trim().toLowerCase();
    const rows = articles.filter((a) => !query || `${a.title} ${a.summary} ${a.body}`.toLowerCase().includes(query));
    list.innerHTML = rows.map((a) => `<button type="button" class="help-item" data-id="${esc(a.id)}"><b>${esc(a.title)}</b><span class="dim small">${esc(a.summary)}</span></button>`).join("")
      || `<div class="dim small">No matching article.</div>`;
  }
  function openArticle(id) {
    const a = articles.find((x) => x.id === id);
    if (!a) return;
    article.hidden = false;
    article.innerHTML = `<h3>${esc(a.title)}</h3><div class="md">${md(a.body)}</div>`;
  }

  view.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) openArticle(b.dataset.id);
  });
  view.querySelector("#help-search").addEventListener("input", (e) => showList(e.target.value));
  view.querySelector("#help-ask").addEventListener("click", async () => {
    const question = view.querySelector("#help-q").value.trim();
    if (!question) return toast("Type a question first", true);
    const box = view.querySelector("#help-answer");
    box.innerHTML = `<div class="dim small">Looking through the guides...</div>`;
    try {
      const r = await api("/help/ask", { method: "POST", body: { question } });
      const label = r.source === "ai"
        ? "Answer from your connected AI, using the help articles."
        : "No connected AI answered, so this is a search of the help articles.";
      const hits = (r.hits || []).map((h) => `<button type="button" class="help-item" data-id="${esc(h.id)}"><b>${esc(h.title)}</b><span class="dim small">${esc(h.excerpt || h.summary || "")}</span></button>`).join("");
      box.innerHTML = `<div class="small dim" style="margin-top:10px">${esc(label)}</div><div class="md" style="margin-top:8px">${md(r.answer || "")}</div>${hits ? `<div class="help-list">${hits}</div>` : ""}`;
    } catch (e) {
      box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      toast(e.message, true);
    }
  });
  view.querySelector("#help-start").addEventListener("click", () => { (window.CC.startProject?.open || window.CC.go)?.("start"); });
  view.querySelector("#help-replay").addEventListener("click", () => { window.CC.tour?.start?.(); });
  view.querySelector("#help-examples").addEventListener("click", () => { (window.CC.startProject?.examples || window.CC.startProject?.open || window.CC.go)?.(); });
  view.querySelector("#help-upd").addEventListener("click", async () => {
    try {
      const S = window.CC.S;
      S.update = await api("/update/check", { method: "POST" });
      const failed = !!S.update?.error;
      toast(S.update?.available ? `v${S.update.latest} is available` : failed ? `Check failed: ${S.update.error}` : "You are on the latest version", failed);
      window.CC.render?.();
    } catch (e) { toast(e.message, true); }
  });

  list.innerHTML = `<div class="dim small">Loading...</div>`;
  api("/help").then((d) => { articles = d.articles || []; showList(view.querySelector("#help-search")?.value || ""); }).catch((e) => {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  });
}

CC.register({ id: "help", tab: { label: "Help", short: "Help", icon: "?", order: 4, render: renderTab } });
