// Help tab: searchable guides from /api/help, plus Ask Meldmind, the tour and setup,
// the user guide, contact and feedback, and About (version and Check for updates).
// Ask sends only when the button is clicked. With no connected AI the server returns search hits.
// What can Meldmind do? is the same guide as the tour. A row hides when its page is missing.
import { liveProbe, matchesQuery, rememberWalks, visibleGuide } from "./guide.js";
import { helpOrder, searchArticles, tryThese, contextTipsForView, doThisNextForState, matchScreensForQuery, PERSONA_STARTER_PACKS, getPersonaStarterPack } from "../help-rank.js";

const { api, toast, esc, md, go } = window.CC;

const css = `
.can-do-row { display: grid; gap: 4px; text-align: left; background: var(--card-bg, #0a0f18); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.can-do-row h4 { margin: 0; font-size: 0.9375rem; }
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

// Contact for questions and feedback. The link opens the mail app; nothing is sent from here.
const CONTACT_EMAIL = "hello@everbornproductions.com";

function renderTab(view) {
  const S = window.CC.S || {};
  const desk = S.mode !== "hosted";
  const ctxInfo = contextTipsForView(S.lastView || S.view || "command", []);
  const nextCards = doThisNextForState(S);
  view.innerHTML = `<div class="help-page">
    <div class="panel" id="help-context">
      <h3>Tips for this screen: ${esc(ctxInfo.title)}</h3>
      <p class="dim small" style="margin:0 0 8px">${esc(ctxInfo.summary)}</p>
      <ul class="small" style="margin:0 0 8px;padding-left:18px">${ctxInfo.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-help-go="${esc(ctxInfo.view)}">Return to ${esc(ctxInfo.title)}</button></div>
    </div>
    <div class="panel" id="help-do-next">
      <h3>Do this next</h3>
      <div class="grid cols-2" style="gap:8px">${nextCards.map((c) => `<div class="route"><div style="font-weight:600">${esc(c.title)}</div><div class="dim small" style="margin-top:4px">${esc(c.summary)}</div><div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-help-go="${esc(c.view)}" data-help-focus="${esc(c.focus || "")}">${esc(c.actionLabel)}</button></div></div>`).join("")}</div>
    </div>
    <div class="panel" id="help-persona-packs">
      <h3>Persona starter packs</h3>
      <p class="dim small" style="margin:0 0 8px">Pick a starter pack to pre-select recommended tools and open a ready sample project.</p>
      <div class="grid cols-2" style="gap:8px">${PERSONA_STARTER_PACKS.map((p) => `<div class="route" data-pack-card="${esc(p.id)}"><b>${esc(p.label)}</b><div class="dim small" style="margin-top:4px">${esc(p.role)}</div><div class="dim small" style="margin-top:4px">Tools: ${esc(p.tools.join(", "))}</div><div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" data-persona-pack="${esc(p.id)}">Use ${esc(p.label)} pack</button></div></div>`).join("")}</div>
    </div>
    <div class="panel" id="help-article" hidden></div>
    <div class="panel" id="help-list-panel">
      <h3>Search help</h3>
      <p class="dim" style="margin:0 0 10px">Search the guides, or ask a connected AI. Ask Meldmind answers only from these articles. With no connected AI, you get the search.</p>
      <p class="hint" role="note">You can type in any language.</p>
      <label class="lbl" for="help-search">Search</label>
      <input id="help-search" type="search" placeholder="Try: how do I ask a question" autocomplete="off">
      <p class="hint"><button type="button" class="btn sm" id="help-pdf">Security summary (PDF)</button></p>
      <div id="help-screen-hits" class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>
      <div id="help-list" class="help-list"></div>
    </div>
    <div class="panel" id="help-ask-panel">
      <h3>Ask Meldmind</h3>
      <label class="lbl" for="help-q">Question</label>
      <textarea id="help-q" rows="3" placeholder="Ask about keys, Simple mode, or approvals"></textarea>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
        <button class="btn sm primary" type="button" id="help-ask">Ask Meldmind</button>
      </div>
      <div id="help-answer" class="help-answer"></div>
    </div>
    <div class="panel" id="help-again">
      <h3>Tour and setup</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn sm" type="button" id="help-replay">Take the tour</button>
        <button class="btn sm" type="button" id="help-more-tour">See what else it can do</button>
        ${desk ? `<button class="btn sm" type="button" id="help-setup">Get everything connected</button>` : ""}
        <button class="btn sm" type="button" id="help-news">What's new</button>
        <button class="btn sm" type="button" id="help-start">Start a project</button>
        <button class="btn sm" type="button" id="help-examples">Watch example projects</button>
      </div>
      <p class="dim small" style="margin:8px 0 0">Take the tour any time. See what else it can do opens the longer tour. Watch example projects replays a labeled sample. No AI is called for an example.</p>
    </div>
    <div class="panel" id="can-do">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <h3 style="margin:0">User guide: What can Meldmind do?</h3>
        <a class="btn sm" href="/what-meldmind-can-do.pdf" download="What Meldmind can do.pdf" style="margin-left:auto;text-decoration:none">Download the guide (PDF)</a>
      </div>
      <p class="dim" style="margin:10px 0">A short list of what is in this app. Each row is Free, Pro, or Extreme. Pro is $18.99 a month. Extreme is $29.99 a month. These are the plan prices. Adding a license happens on the Subscriptions page, and this list does not charge you. A row stays hidden when that page is not here, so nothing points at a missing feature. The guide is the same list, saved as a PDF.</p>
      <label class="lbl" for="can-do-search">Search what Meldmind can do</label>
      <input id="can-do-search" type="search" placeholder="Try councils, remix, or phone" autocomplete="off">
      <div id="can-do-list" class="help-list"></div>
    </div>
    <div class="panel" id="help-contact">
      <h3>Contact and feedback</h3>
      <p class="small" style="margin:0 0 10px">Questions or a problem: write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. The link opens your mail app. Nothing is sent until you click Send there.</p>
      <p class="small" style="margin:0 0 10px">Ideas for Meldmind go in the idea box. You review the note and click Send yourself.</p>
      <button class="btn sm" type="button" id="help-idea">Open the idea box</button>
    </div>
    <div class="panel" id="help-about">
      <h3>About Meldmind</h3>
      <p class="small" style="margin:0 0 6px"><b>Meldmind</b>, an Everborn product by Everborn Productions. Take command of all your AIs.</p>
      <div class="small" id="s-upd-box">${desk && window.CC.updateBoxHtml ? window.CC.updateBoxHtml() : `Version ${esc(S.version || "")}`}</div>
    </div>
  </div>`;
  if (desk) window.CC.renderUpdateBox?.();

  let articles = [];
  let guideRows = [];
  const list = view.querySelector("#help-list");
  const listPanel = view.querySelector("#help-list-panel");
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
    const screenHitsBox = view.querySelector("#help-screen-hits");
    if (screenHitsBox) {
      const screenHits = String(q || "").trim() ? matchScreensForQuery(String(q || "").trim(), 4) : [];
      screenHitsBox.innerHTML = screenHits.length
        ? `<span class="dim small">Jump to screen:</span>` + screenHits.map((t) => `<button type="button" class="btn sm" data-help-go="${esc(t.view)}" data-help-focus="${esc(t.focus || "")}" title="${esc(t.summary)}">Open ${esc(t.label)}</button>`).join("")
        : "";
    }
    const query = String(q || "").trim();
    const rows = query ? searchArticles(articles, query, 12) : helpOrder(articles);
    if (!rows.length) {
      const picks = tryThese(articles);
      list.innerHTML = `<div class="small">No article used those words. Try these:</div>`
        + picks.map((a) => `<button type="button" class="help-item" data-id="${esc(a.id)}"><b>${esc(a.title)}</b><span class="dim small">${esc(a.summary)}</span></button>`).join("")
        + `<p style="margin-top:8px"><button type="button" class="btn sm primary" id="help-empty-ask">Ask Meldmind</button></p>`;
      list.querySelector("#help-empty-ask")?.addEventListener("click", () => {
        const box = view.querySelector("#help-q");
        if (box) { box.value = query; box.focus(); }
        view.querySelector("#help-ask-panel")?.scrollIntoView({ block: "start" });
      });
      return;
    }
    list.innerHTML = rows.map((a) => `<button type="button" class="help-item" data-id="${esc(a.id)}"><b>${esc(a.title)}</b><span class="dim small">${esc(a.summary)}</span></button>`).join("");
  }
  function openArticle(id) {
    const a = articles.find((x) => x.id === id);
    if (!a) return;
    listPanel.hidden = true;
    article.hidden = false;
    article.innerHTML = `<p><button type="button" class="btn sm" id="help-back">Back to all help</button></p><h3 id="help-article-title">${esc(a.title)}</h3><div class="md">${md(a.body)}</div>`;
    article.querySelector("#help-back").addEventListener("click", () => {
      article.hidden = true;
      article.innerHTML = "";
      listPanel.hidden = false;
      const scroller = document.getElementById("view");
      if (scroller) scroller.scrollTop = 0;
    });
    const scroller = document.getElementById("view");
    if (scroller) scroller.scrollTop = 0;
    article.querySelector("#help-article-title")?.focus?.();
  }

  view.addEventListener("click", (e) => {
    const goBtn = e.target.closest("[data-help-go]");
    if (goBtn) {
      const targetView = goBtn.dataset.helpGo;
      const targetFocus = goBtn.dataset.helpFocus || "";
      if (targetView === "settings" && targetFocus) {
        if (window.CC.S) window.CC.S.settingsMore = true;
      }
      follow({ view: targetView, focus: targetFocus });
      return;
    }
    const packBtn = e.target.closest("[data-persona-pack]");
    if (packBtn) {
      const pack = getPersonaStarterPack(packBtn.dataset.personaPack);
      if (pack) {
        (async () => {
          try {
            const savedProj = await api("/projects", { method: "POST", body: pack.sampleProject });
            if (window.CC.S) {
              const idx = (window.CC.S.projects || []).findIndex((x) => x.id === savedProj.id);
              if (idx >= 0) window.CC.S.projects[idx] = savedProj;
              else (window.CC.S.projects = window.CC.S.projects || []).push(savedProj);
              window.CC.S.project = savedProj.id;
              window.CC.S.lastOrders = pack.sampleProject.starterPrompt || "";
              window.CC.S.selectedPackTools = pack.tools.slice();
            }
            toast(`${pack.label} starter project ready`);
            go("command");
          } catch (err) { toast(err.message, true); }
        })();
      }
      return;
    }
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
    if (b && view.contains(b)) openArticle(b.dataset.id);
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
  view.querySelector("#help-more-tour").addEventListener("click", () => { (window.CC.tour?.startFull || window.CC.tour?.start)?.(); });
  view.querySelector("#help-examples").addEventListener("click", () => { (window.CC.startProject?.examples || window.CC.startProject?.open || window.CC.go)?.(); });
  view.querySelector("#help-setup")?.addEventListener("click", () => { window.CC.connectSetup?.open?.(); });
  view.querySelector("#help-idea").addEventListener("click", () => {
    if (window.CC.openSettings) window.CC.openSettings("[data-feature='everyday-news']");
    else go("settings");
  });
  view.querySelector("#help-pdf").addEventListener("click", async () => {
    try {
      const url = await window.CC.apiBlobUrl("/help/security.pdf");
      window.CC.downloadBlob(url, "meldmind-security.pdf");
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
    const can = view.querySelector("#help-can-list");
    if (can) can.innerHTML = (d.canDo || []).map((line) => `<li>${esc(line)}</li>`).join("");
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
