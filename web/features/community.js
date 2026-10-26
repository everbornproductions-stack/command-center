// Community chat and the weekly AI News feed. One area, next to each other.
// Nothing is posted until Send or Share in chat is clicked. Email is a copy only.
const { api, toast, esc, go } = window.CC;

const SHORT = "Be kind. Stay on the channel topic. No keys, private files, or spam. Use Report if a post breaks this. Nothing is posted until you click Send.";

let room = null;
let channel = "general";
let unread = false;
let primed = false;
let shareOverride = "";
let busy = false;
let liveTimer = null;
const LIVE_MS = 5000;

const css = `
#cc-community { max-width: 1100px; margin: 0 auto; }
.cc-layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 14px; align-items: start; }
.cc-channels { display: flex; flex-direction: column; gap: 4px; }
.cc-channels button { text-align: left; }
.cc-channels button.active { background: var(--card-hover, #1a2436); color: var(--text, #fff); }
.cc-msg { padding: 8px 0; border-bottom: 1px solid var(--line); }
.cc-msg .who { font-weight: 650; }
.cc-item { padding: 10px 0; border-bottom: 1px solid var(--line); }
.cc-new { margin-left: 6px; }
.cc-report[hidden] { display: none; }
@media (max-width: 760px) { .cc-layout { grid-template-columns: 1fr; } }
`;
if (!document.getElementById("cc-community-style")) {
  const style = document.createElement("style");
  style.id = "cc-community-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function paintNavBadge(on) {
  document.querySelectorAll('button[data-view="community"]').forEach((btn) => {
    let mark = btn.querySelector(".cc-new");
    if (!on) { mark?.remove(); return; }
    if (mark) return;
    mark = document.createElement("span");
    mark.className = "chip cc-new";
    mark.textContent = "New";
    btn.appendChild(mark);
  });
}

async function shareInChat(input = {}) {
  const body = {
    kind: input.kind,
    id: input.id,
    title: input.title,
    text: input.text || "",
    sourceUrl: input.sourceUrl || "",
  };
  if (input.channel) body.channel = input.channel;
  else if (shareOverride) body.channel = shareOverride;
  try {
    const state = await api("/community");
    if (!state.joined) {
      toast("Pick a username on Community first. Nothing was posted.");
      go("community");
      return { posted: false };
    }
    await api("/community/share", { method: "POST", body });
    toast("Shared in chat.");
    if (window.CC.S.view === "community") {
      channel = body.channel || channel;
      const view = document.getElementById("view");
      if (view) render(view);
    }
    return { posted: true };
  } catch (e) {
    toast(e.message, true);
    return { posted: false };
  }
}
window.CC.shareInChat = shareInChat;

function kindLabel(kind) {
  if (kind === "price") return "Price change";
  if (kind === "model") return "Model release";
  if (kind === "feature") return "New feature";
  return "";
}

function mailBox(checked) {
  return `<label class="row" style="gap:10px;align-items:flex-start;margin-top:10px">
    <input type="checkbox" id="cc-mail" ${checked ? "checked" : ""}>
    <span><b>Email me the weekly AI News note</b>
      <div class="dim small">Off until you tick this. The app writes a copy and does not send email. You can leave the list any time.</div>
    </span>
  </label><div class="dim small" id="cc-mail-note"></div>`;
}

function wireMail(root, row) {
  const box = root.querySelector("#cc-mail");
  const note = root.querySelector("#cc-mail-note");
  if (!box) return;
  if (note) note.textContent = row?.note || (row?.optedIn ? "You are on the list. Nothing is sent from this app." : "You are off the list.");
  box.addEventListener("change", async () => {
    try {
      const next = await api("/community/newsletter", { method: "POST", body: { optedIn: box.checked } });
      if (note) note.textContent = next.note || "";
      toast(next.note || (box.checked ? "You are on the list. Nothing is sent." : "You are off the list."));
    } catch (e) {
      box.checked = !box.checked;
      toast(e.message, true);
    }
  });
}

function messageHtml(m, owner) {
  const share = m.share ? `<div class="dim small">${esc(m.kind)} · ${esc(m.share.title || "")}</div>` : "";
  const names = (m.voters || []).slice(0, 8).join(", ");
  const votes = m.kind === "prompt" ? `<span class="dim small">${m.up || 0} up, ${m.down || 0} down${names ? ` · ${esc(names)}` : ""}</span>
    <button class="btn sm" type="button" data-vote="up" data-id="${esc(m.id)}">Thumbs up</button>
    <button class="btn sm" type="button" data-vote="down" data-id="${esc(m.id)}">Thumbs down</button>` : "";
  const mine = m.mine || owner ? `<button class="btn sm" type="button" data-del="${esc(m.id)}">Delete</button>` : "";
  const unsent = m.unsent ? `<div class="small cc-unsent" style="color:var(--warn,#f59e0b)">Not shared yet. ${esc(m.unsent.reason || "Only you can see this.")}</div>` : "";
  return `<div class="cc-msg" data-mid="${esc(m.id)}">
    <div><span class="who">${esc(m.username || m.displayName || "Member")}</span> <span class="dim small">${esc(m.kind || "text")}</span></div>
    ${unsent}
    ${share}
    <div style="white-space:pre-wrap">${esc(m.body || "")}</div>
    <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
      ${votes}
      <button class="btn sm" type="button" data-report="${esc(m.id)}">Report</button>
      ${mine}
    </div>
    <div class="row cc-report" hidden style="gap:6px;margin-top:6px">
      <input type="text" maxlength="300" placeholder="Why are you reporting it?" aria-label="Report note" style="flex:1">
      <button class="btn sm" type="button" data-report-go="${esc(m.id)}">Send report</button>
    </div>
  </div>`;
}

function itemHtml(item, section) {
  const link = item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${esc(item.sourceName || "Source")}</a>` : "";
  const kind = kindLabel(item.kind);
  const extra = section === "prompts" ? `<div class="dim small">${item.up || 0} up, ${item.down || 0} down</div>` : "";
  const blurb = item.summary || item.excerpt || "";
  const up = (item.upNames || []).slice(0, 8).join(", ");
  const down = (item.downNames || []).slice(0, 8).join(", ");
  const comments = (item.comments || []).map((c) => `<div class="small" style="margin-top:4px"><b>${esc(c.username || "Member")}</b> ${esc(c.body || "")}</div>`).join("");
  return `<div class="cc-item">
    <div><b>${esc(item.title || "Item")}</b> ${kind ? `<span class="chip">${esc(kind)}</span>` : ""}</div>
    <div class="small" style="margin-top:4px">${esc(blurb)}</div>
    ${extra}
    <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
      ${link}
      <button class="btn sm" type="button" data-react="up" data-item="${esc(item.id)}">Up</button>
      <button class="btn sm" type="button" data-react="down" data-item="${esc(item.id)}">Down</button>
      <span class="dim small">${item.up || 0} up, ${item.down || 0} down${up ? ` · ${esc(up)}` : ""}${down ? ` · down ${esc(down)}` : ""}</span>
      <button class="btn sm" type="button" data-share-item="${esc(item.id)}">Share in chat</button>
    </div>
    ${comments}
    <form class="row" data-comment="${esc(item.id)}" style="gap:6px;margin-top:6px">
      <input type="text" maxlength="300" placeholder="Add a comment" aria-label="Comment" style="flex:1">
      <button class="btn sm" type="submit">Comment</button>
    </form>
  </div>`;
}

function sectionHtml(title, items, key) {
  const rows = items || [];
  if (!rows.length) return "";
  return `<h3 style="margin:14px 0 4px">${esc(title)}</h3>${rows.map((item) => itemHtml(item, key)).join("")}`;
}

function newsHtml(news) {
  const issue = news?.issue;
  if (!issue) return `<div class="empty">No issue yet. A new one is published each week. No app update is needed.</div>`;
  return `<h2 style="margin:0 0 6px">${esc(issue.title || "AI News")}</h2>
    <div class="dim small">This week in the app. Open a source link to read it on the provider's site.</div>
    ${sectionHtml("Newest in AI", issue.sections?.ai, "ai")}
    ${sectionHtml("New in Meldmind", issue.sections?.meldmind, "meldmind")}
    ${sectionHtml("Top voted prompts", issue.sections?.prompts, "prompts")}
    ${sectionHtml("Community highlights", issue.sections?.highlights, "highlights")}`;
}

function moreHtml() {
  const owner = !!room?.owner;
  return `<details style="margin-top:14px"><summary>More options</summary>
    <div class="grid" style="gap:10px;margin-top:8px">
      <div>
        <div class="lbl">Code of conduct</div>
        <ul>${(room?.conduct || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      </div>
      <label>When I share, use this channel
        <select id="cc-share-channel" aria-label="Share channel">
          <option value="">The usual channel</option>
          <option value="general">General</option>
          <option value="prompts">Prompts</option>
          <option value="builders">Builders</option>
          <option value="help">Help</option>
          <option value="show">Show and tell</option>
        </select>
      </label>
      <div>
        <button class="btn sm" type="button" id="cc-preview">Write the email copy</button>
        <div class="dim small">A preview only. Nothing is sent.</div>
        <pre id="cc-preview-out" class="small" style="white-space:pre-wrap"></pre>
      </div>
      ${owner ? `<div>
        <label class="lbl">Mute someone</label>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <input id="cc-mute-name" maxlength="20" placeholder="username" aria-label="Username to mute" autocomplete="off">
          <input id="cc-mute-min" type="number" min="1" max="43200" value="60" aria-label="Minutes" style="width:90px">
          <button class="btn sm" type="button" id="cc-mute-go">Mute</button>
        </div>
      </div>
      <div>
        <label class="lbl">Build a weekly draft</label>
        <textarea id="cc-sources" rows="5" placeholder="Paste source JSON from provider changelogs. The draft is not published until you click Publish."></textarea>
        <div class="row" style="gap:6px;margin-top:6px">
          <button class="btn sm" type="button" id="cc-draft">Build draft</button>
          <button class="btn sm primary" type="button" id="cc-publish" ${room?.news?.draft ? "" : "disabled"}>Publish</button>
        </div>
        <div class="dim small" id="cc-draft-note">${room?.news?.draft ? `Draft ${esc(room.news.draft.id)} is waiting for you.` : "No draft yet."}</div>
      </div>` : ""}
    </div>
  </details>`;
}

// Live refresh: while the Community page is open and the window is visible, check for new messages
// every few seconds and redraw only the message list. A half-typed message and the scroll spot stay.
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
function startLive(view) {
  stopLive();
  if (channel === "news" || !room?.joined) return;
  liveTimer = setInterval(async () => {
    const feed = view.querySelector("#cc-feed");
    if (!feed || !view.isConnected || document.hidden || channel === "news") { if (!feed || !view.isConnected) stopLive(); return; }
    try {
      const next = await api(`/community?channel=${encodeURIComponent(channel)}`);
      if (next.channel !== channel) return;
      const html = (next.messages || []).map((m) => messageHtml(m, next.owner)).join("") || `<div class="empty">No messages in this channel yet.</div>`;
      if (html === feed.dataset.html) return;
      const atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
      const open = new Set([...feed.querySelectorAll(".cc-report:not([hidden])")].map((el) => el.closest(".cc-msg")?.dataset.mid));
      feed.innerHTML = html;
      feed.dataset.html = html;
      feed.querySelectorAll(".cc-msg").forEach((el) => { if (open.has(el.dataset.mid)) el.querySelector(".cc-report")?.removeAttribute("hidden"); });
      if (atEnd) feed.scrollTop = feed.scrollHeight;
      room = next;
      wireFeed(view, feed);
    } catch {}
  }, LIVE_MS);
}

function wireFeed(view, scope) {
  scope.querySelectorAll("[data-report]").forEach((btn) => btn.addEventListener("click", () => {
    btn.closest(".cc-msg")?.querySelector(".cc-report")?.removeAttribute("hidden");
  }));
  scope.querySelectorAll("[data-report-go]").forEach((btn) => btn.addEventListener("click", async () => {
    const reason = btn.parentElement.querySelector("input")?.value || "";
    try {
      await api(`/community/messages/${encodeURIComponent(btn.dataset.reportGo)}/report`, { method: "POST", body: { reason } });
      toast("Report sent.");
    } catch (e) { toast(e.message, true); }
  }));
  scope.querySelectorAll("[data-vote]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const voted = await api(`/community/messages/${encodeURIComponent(btn.dataset.id)}/vote`, { method: "POST", body: { vote: btn.dataset.vote } });
      toast(voted.scoreLabel || "Vote saved.");
      render(view);
    } catch (e) { toast(e.message, true); }
  }));
  scope.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api(`/community/messages/${encodeURIComponent(btn.dataset.del)}`, { method: "DELETE" });
      toast("Removed.");
      render(view);
    } catch (e) { toast(e.message, true); }
  }));
}

async function render(view) {
  stopLive();
  view.innerHTML = `<div id="cc-community"><div class="empty">Loading community...</div></div>`;
  const root = view.querySelector("#cc-community");
  try { room = await api(`/community?channel=${encodeURIComponent(channel)}`); }
  catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  unread = !!room.news?.unread;
  paintNavBadge(unread);
  const channels = room.channels || [];
  const onNews = channel === "news";
  const joined = !!room.joined;
  root.innerHTML = `<div class="cc-layout">
    <div class="panel cc-channels" role="tablist" aria-label="Community channels">
      ${channels.map((c) => `<button class="btn sm ${c.id === channel ? "active" : ""}" type="button" data-channel="${esc(c.id)}">${esc(c.label)}${c.id === "news" && unread ? ` <span class="chip cc-new">New</span>` : ""}</button>`).join("")}
    </div>
    <div>
      <div class="panel">
        ${room.needsLicence ? `<div class="small">Sign in first. Community chat uses the email you signed in with (Google or Microsoft, under Connect) or the email on your licence.${room.username ? ` Your public username is ${esc(room.username)}.` : ""}</div>` : (joined ? `<div class="small">You are posting as <b>${esc(room.profile?.username || room.username || "")}</b>. This name is on your account. Change it in Settings.</div>` : `<form id="cc-join" class="grid" style="gap:8px;margin-bottom:12px" autocomplete="off">
          <div class="small">Pick a public username for your account. A friendly one is suggested. Your email is not shown.</div>
          <label>Username <input id="cc-name" name="cc-name" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="off" value="${esc(room.suggestion || "")}" aria-label="Username"></label>
          <div class="dim small">3 to 20 characters. Letters, numbers, and underscore. It has to be unique. The same name is used in chat, on shared prompts, in the Builders gallery, and on AI News.</div>
          <div><button class="btn sm primary" type="submit">Save username</button></div>
        </form>`)}
        <div class="dim small">${esc(SHORT)}</div>
        ${onNews ? newsHtml(room.news) : `
          <div id="cc-feed" style="max-height:60vh;overflow-y:auto">${joined ? (room.messages || []).map((m) => messageHtml(m, room.owner)).join("") || `<div class="empty">No messages in this channel yet.</div>` : `<div class="empty">Pick a username to read and post.</div>`}</div>
          ${joined ? `<form id="cc-send" class="grid" style="gap:8px;margin-top:10px">
            <textarea id="cc-body" rows="3" maxlength="2000" placeholder="Write a message. Nothing is posted until you click Send." aria-label="Message"></textarea>
            <div><button class="btn sm primary" type="submit" id="cc-send-go">Send</button></div>
          </form>` : ""}`}
        ${mailBox(!!room.newsletter?.optedIn)}
      </div>
      ${moreHtml()}
    </div>
  </div>`;

  root.querySelectorAll("[data-channel]").forEach((btn) => btn.addEventListener("click", async () => {
    channel = btn.dataset.channel;
    if (channel === "news" && room?.news?.issue?.id && room.news.unread) {
      try { await api("/community/news/seen", { method: "POST", body: { id: room.news.issue.id } }); unread = false; paintNavBadge(false); }
      catch (e) { toast(e.message, true); }
    }
    render(view);
  }));

  root.querySelector("#cc-join")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("/account/username", { method: "POST", body: { username: root.querySelector("#cc-name").value } });
      toast("Username saved.");
      render(view);
    } catch (e) { toast(e.message, true); }
  });

  root.querySelector("#cc-send")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const body = root.querySelector("#cc-body").value;
    const button = root.querySelector("#cc-send-go");
    busy = true;
    if (button) button.disabled = true;
    try {
      const sent = await api("/community/messages", { method: "POST", body: { channel, body } });
      if (sent && sent.delivered === true) toast("Posted.");
      else toast(sent?.note || "Saved on this computer only. It was not shared.", true);
      render(view);
    } catch (e) {
      busy = false;
      if (button) button.disabled = false;
      toast(e.message, true);
    } finally { busy = false; }
  });

  wireFeed(view, root);
  root.querySelectorAll("[data-react]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api("/community/news/react", { method: "POST", body: { issueId: room.news.issue.id, itemId: btn.dataset.item, reaction: btn.dataset.react } });
      toast("Reaction saved.");
      render(view);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll("[data-comment]").forEach((form) => form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = form.querySelector("input");
    try {
      await api("/community/news/comment", { method: "POST", body: { issueId: room.news.issue.id, itemId: form.dataset.comment, body: input?.value || "" } });
      toast("Comment posted.");
      render(view);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll("[data-share-item]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await api("/community/news/share", { method: "POST", body: { issueId: room.news.issue.id, itemId: btn.dataset.shareItem, channel: shareOverride || "general" } });
      toast("Shared in chat.");
      channel = shareOverride || "general";
      render(view);
    } catch (e) { toast(e.message, true); }
  }));

  const select = root.querySelector("#cc-share-channel");
  if (select) {
    select.value = shareOverride;
    select.addEventListener("change", () => { shareOverride = select.value; });
  }
  root.querySelector("#cc-preview")?.addEventListener("click", async () => {
    const out = root.querySelector("#cc-preview-out");
    try {
      const copy = await api("/community/newsletter/preview", { method: "POST", body: {} });
      if (out) out.textContent = copy.text || "";
      toast(copy.sent ? "Sent." : "Email copy written. Nothing was sent.");
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#cc-mute-go")?.addEventListener("click", async () => {
    try {
      await api("/community/mute", { method: "POST", body: { username: root.querySelector("#cc-mute-name").value, minutes: Number(root.querySelector("#cc-mute-min").value) } });
      toast("Muted.");
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#cc-draft")?.addEventListener("click", async () => {
    let sources = [];
    const raw = root.querySelector("#cc-sources")?.value?.trim();
    if (raw) {
      try { sources = JSON.parse(raw); }
      catch { toast("That source text is not JSON.", true); return; }
    }
    try {
      const built = await api("/community/news/draft", { method: "POST", body: { sources } });
      toast(`Draft ${built.draft?.id || ""} saved. Not published.`);
      render(view);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#cc-publish")?.addEventListener("click", async () => {
    try {
      await api("/community/news/publish", { method: "POST", body: { id: room.news?.draft?.id } });
      toast("Published. No email was sent.");
      channel = "news";
      render(view);
    } catch (e) { toast(e.message, true); }
  });
  wireMail(root, room.newsletter);
  const feedEl = root.querySelector("#cc-feed");
  if (feedEl) { feedEl.dataset.html = feedEl.innerHTML; feedEl.scrollTop = feedEl.scrollHeight; }
  startLive(view);
}

function renderSettings(el) {
  el.innerHTML = `<div class="panel" id="cc-settings-name">
    <h3>Public username</h3>
    <p class="small">One name for your account. People see it in community chat, on shared and voted prompts, in the Builders gallery, and on AI News. Your email is not shown.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <input id="cc-settings-username" maxlength="20" aria-label="Username" autocomplete="off">
      <button class="btn sm" type="button" id="cc-settings-username-go">Save username</button>
    </div>
    <div class="dim small" id="cc-settings-username-note">You can change this name. After a change, wait 1 hour before the next one.</div>
  </div>
  <div class="panel" id="cc-settings-mail"><h3>Weekly AI News email</h3>${mailBox(false)}</div>`;
  const note = el.querySelector("#cc-settings-username-note");
  const input = el.querySelector("#cc-settings-username");
  api("/account").then((state) => {
    if (input) input.value = state.username || state.suggestion || "";
    if (note && state.username && state.cooldownUntil > Date.now()) {
      note.textContent = `You can change this name after ${new Date(state.cooldownUntil).toLocaleString()}.`;
    }
  }).catch(() => {});
  el.querySelector("#cc-settings-username-go")?.addEventListener("click", async () => {
    try {
      const saved = await api("/account/username", { method: "POST", body: { username: input?.value || "" } });
      toast("Username saved.");
      if (note) {
        note.textContent = saved.cooldownUntil
          ? `You can change this name after ${new Date(saved.cooldownUntil).toLocaleString()}.`
          : "You can change this name. After a change, wait 1 hour before the next one.";
      }
    } catch (e) { toast(e.message, true); }
  });
  api("/community/newsletter").then((row) => {
    const box = el.querySelector("#cc-mail");
    if (box) box.checked = row.optedIn === true;
    wireMail(el, row);
  }).catch(() => {});
}

window.CC.register({
  id: "community",
  tab: { label: "Community", order: 46, render },
  settings: { order: 46, render: renderSettings },
  deliverable: { order: 4, render(el, run) {
    if (!run || run.kind !== "mission") { el.innerHTML = ""; return; }
    const title = run.mission?.title || "Mission";
    el.innerHTML = `<div class="row small" style="margin-top:8px"><button class="btn sm" type="button" id="cc-share-mission">Share in chat</button><span class="dim">One click posts a short note. Keys and files stay here.</span></div>`;
    el.querySelector("#cc-share-mission").addEventListener("click", () => {
      shareInChat({
        kind: "mission",
        id: run.id,
        title,
        text: String(run.deliverable || "").replace(/\s+/g, " ").slice(0, 280),
      });
    });
  } },
  onState() {
    paintNavBadge(unread);
    if (primed) return;
    primed = true;
    api("/community/news").then((news) => { unread = !!news.unread; paintNavBadge(unread); }).catch(() => {});
  },
});
