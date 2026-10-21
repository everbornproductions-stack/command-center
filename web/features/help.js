// Help tab: searchable guides from /api/help, plus Ask Meldmind.
// Ask sends only when the button is clicked. With no connected AI the server returns search hits.
// What can Meldmind do? is the same guide as the tour. A row hides when its page is missing.
import { liveProbe, matchesQuery, rememberWalks, visibleGuide } from "./guide.js";

const { api, toast, esc, md, go } = window.CC;

const css = `
.can-do-row { display: grid; gap: 4px; text-align: left; background: #0a0f18; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.can-do-row h4 { margin: 0; font-size: 15px; }
.can-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
`;
if (!document.getElementById("cc-can-do-style")) {
  const style = document.createElement("style");
  style.id = "cc-can-do-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function follow(open) {
  if (!open) return;
  if (open.article) {
    window.CC.openHelp?.(open.article);
    return;
  }
  if (open.view) go(open.view);
  if (open.focus) setTimeout(() => document.querySelector(open.focus)?.scrollIntoView({ block: "center" }), 60);
}

function renderTab(view) {
  view.innerHTML = `<div class="help-page">
    <div class="panel" id="can-do">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <h3 style="margin:0">What can Meldmind do?</h3>
        <a class="btn sm" href="/what-meldmind-can-do.pdf" download="What Meldmind can do.pdf" style="margin-left:auto;text-decoration:none">Download the guide (PDF)</a>
      </div>
      <p class="dim" style="margin:10px 0">A short list of what is in this app. Each row is Free, Pro, or Extreme. Pro is $18.99 a month. Extreme is $29.99 a month. These are the plan prices. Adding a licence happens on the Subscriptions page, and this list does not charge you. A row stays hidden when that page is not here, so nothing points at a missing feature. The guide is the same list, saved as a PDF.</p>
      <label class="lbl" for="can-do-search">Search what Meldmind can do</label>
      <input id="can-do-search" type="search" placeholder="Try councils, remix, or phone" autocomplete="off">
      <div id="can-do-list" class="help-list"></div>
    </div>
    <div class="panel">
      <h3>Help</h3>
      <p class="dim" style="margin:0 0 10px">Search the guides, or ask a connected AI. Ask Meldmind answers only from these articles. With no connected AI, you get the search.</p>
      <p class="hint" role="note">You can type in any language.</p>
      <p class="hint"><button type="button" class="btn sm" id="help-pdf">Security summary (PDF)</button></p>
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
        <button class="btn sm" type="button" id="help-news">What's new</button>
        <a class="btn sm" href="/what-meldmind-can-do.pdf" download="What Meldmind can do.pdf" style="text-decoration:none">Download the guide (PDF)</a>
        <button class="btn sm" type="button" id="help-examples">Watch example projects</button>
        <button class="btn sm" type="button" id="help-upd">Check for updates</button>
        <button class="btn sm" type="button" id="help-setup">Run setup again</button>
        <p class="dim small" style="margin:8px 0 0">Take the tour again any time. Watch example projects replays a labeled sample. No AI is called for an example.</p>
      </div>
      <div id="help-answer" class="help-answer"></div>
    </div>
  </div>`;

  let articles = [];
  let guideRows = [];
  const list = view.querySelector("#help-list");
  const article = view.querySelector("#help-article");
  const canList = view.querySelector("#can-do-list");

  function distinctParts(row) {
    const seen = new Set();
    const links = [];
    for (const part of row.parts || []) {
      const key = `${part.open.view}|${part.open.focus || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(part);
    }
    return links;
  }
  function showCanDo(q) {
    const rows = guideRows.filter((row) => matchesQuery(row, q));
    canList.innerHTML = rows.map((row) => {
      const price = row.tier === "free" ? "Free" : `${row.tierLabel}, ${row.price}`;
      const parts = distinctParts(row);
      const links = parts.map((part) => {
        const label = parts.length === 1 ? "Open" : `Open ${part.name}`;
        return `<button type="button" class="btn sm" data-guide-part="${esc(row.id)}:${esc(part.id)}">${esc(label)}</button>`;
      }).join("");
      return `<div class="can-do-row">
        <div class="row" style="gap:8px"><h4>${esc(row.title)}</h4><span class="chip">${esc(price)}</span></div>
        <div>${esc(row.body)}</div>
        ${row.priceNote ? `<div class="dim small">${esc(row.priceNote)}</div>` : ""}
        <div class="can-actions">${links}<button type="button" class="btn sm" data-guide-article="${esc(row.helpId)}">Guide</button></div>
      </div>`;
    }).join("") || `<div class="dim small">No matching part. Try a shorter word.</div>`;
  }

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
    const partBtn = e.target.closest("[data-guide-part]");
    if (partBtn) {
      const [rowId, partId] = partBtn.dataset.guidePart.split(":");
      const row = guideRows.find((r) => r.id === rowId);
      const part = row?.parts?.find((p) => p.id === partId);
      if (part) follow(part.open);
      return;
    }
    const guideBtn = e.target.closest("[data-guide-article]");
    if (guideBtn) {
      const id = guideBtn.dataset.guideArticle;
      if (articles.some((a) => a.id === id)) openArticle(id);
      else window.CC.S.helpArticle = id;
      return;
    }
    const b = e.target.closest("[data-id]");
    if (b) openArticle(b.dataset.id);
  });
  view.querySelector("#help-search").addEventListener("input", (e) => showList(e.target.value));
  view.querySelector("#can-do-search").addEventListener("input", (e) => showCanDo(e.target.value));
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
  view.querySelector("#help-news").addEventListener("click", () => { window.CC.tour?.openNews?.(); });
  view.querySelector("#help-examples").addEventListener("click", () => { (window.CC.startProject?.examples || window.CC.startProject?.open || window.CC.go)?.(); });
  view.querySelector("#help-setup").addEventListener("click", () => { window.CC.connectSetup?.open?.(); });
  view.querySelector("#help-pdf").addEventListener("click", async () => {
    try {
      const url = await window.CC.apiBlobUrl("/help/security.pdf");
      window.CC.downloadBlob(url, "meldmind-security.pdf");
    } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#help-upd").addEventListener("click", async () => {
    try {
      const S = window.CC.S;
      S.update = await api("/update/check", { method: "POST" });
      const failed = !!S.update?.error;
      toast(S.update?.available ? `Update ready, restart: v${S.update.latest}` : failed ? "Couldn't check for updates" : "You are on the latest version", failed);
      window.CC.render?.();
    } catch (e) { toast(e.message, true); }
  });

  list.innerHTML = `<div class="dim small">Loading...</div>`;
  canList.innerHTML = `<div class="dim small">Loading...</div>`;
  rememberWalks(api).then(() => {
    guideRows = visibleGuide(liveProbe());
    showCanDo(view.querySelector("#can-do-search")?.value || "");
  });
  api("/help").then((d) => {
    articles = d.articles || [];
    showList(view.querySelector("#help-search")?.value || "");
    const focus = window.CC.S?.helpArticle;
    if (focus && articles.some((a) => a.id === focus)) {
      openArticle(focus);
      window.CC.S.helpArticle = null;
    }
  }).catch((e) => {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  });
}

window.CC.openHelp = (id) => {
  window.CC.S.helpArticle = id;
  window.CC.go("help");
};

CC.register({ id: "help", tab: { label: "Help", short: "Help", icon: "?", order: 4, render: renderTab } });
