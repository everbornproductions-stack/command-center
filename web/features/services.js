// Subscriptions and services page (Phase 25). Takes over the Subscriptions tab: every paid AI service on
// one page, what is left, what it costs this month and when it renews.
//  - AI providers: credits left and month-to-date, live from the provider's API where one exists, else
//    from this app's ledger; amber / red tied to the spend caps; optional OpenAI / Anthropic admin keys.
//  - Subscriptions: manual add and edit, price per cycle, renewal date, reminder lead time per row.
//  - Find subscriptions in your email: read-only Gmail or Outlook, suggestions with a confidence and a
//    link to the email, confirmed or edited before anything is saved. High-confidence receipts from known
//    AI services are added right away as "auto-detected" rows with Undo, Remove and Edit (a daily rescan
//    keeps them current). Sample emails for demo mode only ever make suggestions.
//  - Every value says where it came from: auto-detected (API, ledger or email, with confidence) or you entered.
const { api, toast, esc, money, ago, pcolor } = window.CC;
const S = () => window.CC.S;

const css = `
#cc-sv .sv-tag { display: inline-block; font-size: 10px; line-height: 1.5; padding: 0 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); white-space: nowrap; margin-top: 2px; }
#cc-sv .sv-tag.auto { color: #93c5fd; border-color: #1e3a5f; }
#cc-sv .sv-tag.low { color: var(--amber); border-color: #5a4616; }
#cc-sv .sv-tag.user { color: #c7d0dd; }
#cc-sv td { vertical-align: top; }
#cc-sv td input, #cc-sv td select { padding: 4px 6px; }
#cc-sv .sv-cell { display: flex; flex-direction: column; gap: 2px; }
#cc-sv .sv-lvl.ok { color: var(--green); } #cc-sv .sv-lvl.amber { color: var(--amber); } #cc-sv .sv-lvl.red { color: var(--red); }
#cc-sv .sv-cand { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
#cc-sv .sv-cand.low { border-color: #5a4616; }
#cc-sv .sv-cand .row { gap: 8px; flex-wrap: wrap; align-items: flex-end; }
#cc-sv .sv-cand label { display: flex; flex-direction: column; font-size: 11px; color: var(--muted); gap: 2px; }
#cc-sv .sv-mail { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
#cc-sv .sv-mail .card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
#cc-sv .sv-hint { padding: 4px 0; }
#cc-sv .sv-tag.est { color: var(--amber); border-color: #5a4616; }
#cc-sv .sv-budget summary { cursor: pointer; font-size: 11px; color: var(--muted); }
#cc-sv .sv-off { color: var(--amber); }
#cc-sv .sv-hist { margin: 4px 0 0; padding-left: 16px; }
#cc-sv .sv-agent textarea { width: 100%; min-height: 96px; font-size: 12px; }
#cc-sv .sv-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: sv-spin .8s linear infinite; vertical-align: -1px; margin-right: 4px; }
@keyframes sv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #cc-sv .sv-spin { animation-duration: 2.4s; } }
`;
const style = document.createElement("style"); style.id = "cc-services-style"; style.textContent = css; document.head.appendChild(style);

let V = null, busy = false, checking = false, lastAuto = 0;
const pct = (c) => `${Math.round(Number(c || 0) * 100)}%`;
const lowConf = () => V?.mail?.lowConfidence ?? 0.6;

// where a value came from
function tag(origin, conf, extra = "") {
  if (origin === "email") return `<span class="sv-tag ${conf != null && conf < lowConf() ? "low" : "auto"}" title="Found in a receipt email${extra ? `: ${esc(extra)}` : ""}">auto-detected: email${conf != null ? ` ${pct(conf)}` : ""}</span>`;
  if (origin === "api") return `<span class="sv-tag auto" title="${esc(extra || "From the provider's API")}">auto-detected: API</span>`;
  if (origin === "ledger") return `<span class="sv-tag auto" title="Counted from this app's own ledger">auto-detected: ledger</span>`;
  if (origin === "estimate") return `<span class="sv-tag" title="${esc(extra)}">estimate</span>`;
  if (origin === "estimated") return `<span class="sv-tag est" title="${esc(extra)}">estimated</span>`;
  if (origin === "none") return `<span class="sv-tag">not set</span>`;
  return `<span class="sv-tag user">you entered</span>`;
}
const fieldTag = (s, k) => (s[k] == null || s[k] === "" ? tag("none") : tag(s.origin?.[k] || "user", s.confidence?.[k]));

async function load(refresh = false) {
  V = refresh ? await api("/services/refresh", { method: "POST", body: {} }) : await api("/services");
  return V;
}

function kpis(v) {
  const t = v.totals;
  const soon = v.subscriptions.filter((s) => s.daysLeft != null && s.daysLeft >= 0 && s.daysLeft <= 7);
  return `<div class="kpi" style="margin-bottom:16px">
    <div class="k"><div class="l">This month so far</div><div class="v">${money(t.monthToDate, 0)}</div><div class="s">subscriptions + metered, about ${money(t.monthEstimate, 0)} by month end</div></div>
    <div class="k"><div class="l">Subscriptions</div><div class="v">${money(t.subscriptions, 0)}<span class="dim" style="font-size:13px"> + ~${money(t.subscriptionsEstimated, 0)} est.</span></div><div class="s">${t.count - t.unconfirmed} of ${t.count} priced, per month</div></div>
    <div class="k"><div class="l">AI APIs and metered</div><div class="v">${money(t.metered)}</div><div class="s">so far, about ${money(t.projectedMetered)} at this pace (day ${t.dayOfMonth} of ${t.daysInMonth})</div></div>
    <div class="k"><div class="l">Renewing in 7 days</div><div class="v">${soon.length}</div><div class="s">${soon.length ? esc(soon.map((s) => s.name).join(", ")) : "nothing due"}${v.hints.length ? ` · ${v.hints.length} hint${v.hints.length === 1 ? "" : "s"} below` : ""}</div></div>
  </div>`;
}

// Credits left: live from the provider's API, else an estimate labelled "estimated", else what to add.
const NO_INFO = "Set a monthly budget for this provider to see an estimate.";
function creditsCell(r) {
  const c = r.credits;
  const amount = (x, d) => (c.unit === "USD" ? money(x, d) : `${esc(String(x))} ${esc(c.unit)}`);
  let html = c
    ? `<span class="mono">${amount(c.value)}${c.total != null && c.source !== "tracked" ? ` <span class="dim">of ${amount(c.total, 0)}</span>` : ""}</span>${c.source === "tracked" ? `<span class="sv-tag est" style="align-self:flex-start" title="${esc(c.sourceNote || "")}">${esc(c.label)}</span><span class="dim small">${esc(c.sourceNote || "")}</span>` : c.source === "estimate" ? tag("estimated", null, c.label) : tag("api", null, c.label)}${c.stale ? `<span class="sv-tag low">last known value</span>` : ""}`
    : "";
  if (r.possiblyOff) html += `<span class="small sv-off">${esc(r.possiblyOff)}</span>`;
  if (r.creditsHint) html += `<span class="dim small">${esc(r.creditsHint)}</span>`;
  else if (!c) html += `<span class="dim small">${esc(NO_INFO)}</span>`;
  if (!c || c.source !== "api") html += balanceBox(r);
  if (!c || c.source === "estimate") {
    const b = r.budget;
    html += `<details class="sv-budget" data-budget="${esc(r.provider)}"><summary>${b ? `${b.kind === "credit" ? "credit bought" : "monthly budget"}: ${money(b.amount, 0)}, change` : "set a budget or credit amount"}</summary>
      <span class="row small" style="gap:4px;margin-top:4px"><input type="number" min="0" step="1" data-budget-amount value="${b?.amount ?? ""}" aria-label="${esc(r.name)} amount in dollars" placeholder="$" style="width:70px"><select data-budget-kind aria-label="What the amount is"><option value="monthly" ${b?.kind !== "credit" ? "selected" : ""}>monthly budget</option><option value="credit" ${b?.kind === "credit" ? "selected" : ""}>credit I bought</option></select><button class="ghost small" data-budget-save>save</button></span></details>`;
  }
  return html;
}

// Update balance: the credits you have now and the day you saw them. Meldmind subtracts every call after
// that, plus what agents report and what usage emails show. The latest change can be undone.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function balanceBox(r) {
  const c = r.credits, g = r.guide || {};
  const hist = c?.source === "tracked" && c.history?.length ? `<ul class="sv-hist dim small">${c.history.slice(0, 5).map((h) => `<li>${esc(h.text)}</li>`).join("")}</ul><button class="ghost small" data-balance-undo="${esc(r.provider)}" title="Put the balance back the way it was before the latest change">Undo latest change</button>` : "";
  return `<details class="sv-budget" data-balance="${esc(r.provider)}"><summary>Update balance</summary>
    <div class="small" style="margin-top:4px">Type the credits ${esc(r.name)} shows now. Meldmind subtracts each job after that.</div>
    <span class="row small" style="gap:4px;margin-top:4px;flex-wrap:wrap"><input type="number" min="0" step="0.01" data-balance-amount aria-label="${esc(r.name)} credits left in dollars" placeholder="$" style="width:80px"><input type="date" data-balance-date value="${today()}" max="${today()}" aria-label="Day you saw this balance"><button class="ghost small" data-balance-save>Save balance</button></span>
    <div class="dim small" style="margin-top:6px"><b>Used ${esc(r.name)} outside Meldmind?</b> ${esc(g.where || "")}${g.url ? ` <a href="${esc(g.url)}" target="_blank" rel="noopener">Open</a>` : ""}</div>
    ${g.email ? `<div class="dim small">${esc(g.email)}</div>` : ""}
    ${g.report ? `<div class="dim small">${esc(g.report)}</div>` : ""}
    ${hist}</details>`;
}

let agentSetup = null;
function agentPanel() {
  return `<div class="cat-h" style="margin-top:14px">Keep balances right when you use AIs outside Meldmind</div>
    <div class="dim small">Agents that can run tools, such as Claude Code, Antigravity and Grok Bot, can tell Meldmind what they spent. Give them this standing instruction once. Plain chat apps cannot report, so their receipt and usage emails keep the balance current when your mailbox is connected.</div>
    ${agentSetup ? `<div class="sv-agent" style="margin-top:6px"><textarea readonly aria-label="Standing instruction for your agents">${esc(agentSetup.instruction)}</textarea>
      <div class="row small" style="gap:8px;margin-top:4px"><button class="ghost small" data-copy="instruction">Copy instruction</button>${agentSetup.claudeCode ? `<button class="ghost small" data-copy="claudeCode">Copy Claude Code setup command</button>` : ""}</div>
      <div class="dim small" style="margin-top:4px">${esc(agentSetup.antigravity || "")} ${esc(agentSetup.webhook || "")}</div></div>`
      : `<button class="btn sm" id="sv-agent-setup" style="margin-top:6px">Show agent setup</button>`}`;
}

function refreshButton() {
  return checking
    ? `<button class="btn sm" id="sv-refresh" disabled aria-busy="true"><span class="sv-spin" aria-hidden="true"></span>Checking...</button>`
    : `<button class="btn sm" id="sv-refresh">Refresh</button>`;
}

function apisPanel(v) {
  const rows = v.apis;
  const admin = v.admin || {};
  return `<div class="panel"><h3>AI providers <span class="right small">${v.liveAt ? `live check ${ago(v.liveAt)} ago` : "no live check yet"} ${refreshButton()}</span></h3>
    ${rows.length ? `<table class="tbl"><thead><tr><th>Provider</th><th>Credits left</th><th>Month to date</th><th>Spend cap</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td><span class="dot" style="background:${r.color || pcolor(r.provider)}"></span> <b>${esc(r.name)}</b>${r.demo ? ` <span class="chip">demo</span>` : ""}<div class="dim small">${esc(r.live ? r.live.how : r.noLive || "")}</div>${r.note ? `<div class="dim small">${esc(r.note)}</div>` : ""}</td>
      <td><div class="sv-cell">${creditsCell(r)}</div></td>
      <td><div class="sv-cell"><span class="mono">${money(r.mtd.value)}</span>${tag(r.mtd.source === "api" ? "api" : "ledger", null, r.mtd.label)}${r.mtd.source === "api" && Math.abs(r.mtd.value - r.ledgerMtd) > 0.005 ? `<span class="dim small">${money(r.ledgerMtd)} through this app</span>` : ""}${r.inTok != null ? `<span class="dim small">${Number(r.inTok).toLocaleString()} in · ${Number(r.outTok || 0).toLocaleString()} out tokens</span>` : ""}</div></td>
      <td><div class="sv-cell">${r.cap ? `<span class="mono">${r.capPct}% of ${money(r.cap, 0)}</span>${tag("user")}` : `<span class="dim">no cap</span>`}</div></td>
      <td><span class="sv-lvl ${r.level}">${r.level === "ok" ? "ok" : r.level === "amber" ? "watch" : "attention"}</span>${r.why.length ? `<div class="dim small">${r.why.map(esc).join("<br>")}</div>` : ""}</td>
      <td class="right small">${r.links.billing ? `<a href="${esc(r.links.billing)}" target="_blank" rel="noopener">billing</a>` : ""}${r.links.usage && r.links.usage !== r.links.billing ? ` · <a href="${esc(r.links.usage)}" target="_blank" rel="noopener">usage</a>` : ""}</td>
    </tr>`).join("")}</tbody></table>` : `<div class="dim small">No AI keys yet. Add one in Settings and its credits and spend show here.</div>`}
    <div class="dim small" style="margin-top:8px">Credits are read live from OpenRouter and DeepSeek, and from xAI with a management key. OpenAI and Anthropic show live spend with an admin key. Everywhere else, type the balance once in Update balance: Meldmind then subtracts each job and shows "tracked since" that day. Without that, the number is estimated from your budget or credit amount minus this app's spend, and says so. Balances refresh when this page opens and every 15 minutes while the app is in use. Spend caps are set in Settings, Spend caps and alerts: amber at 80%, and at 100% the router sends that AI no new work. Chats made through the APIs do not appear in claude.ai, ChatGPT or grok.com history.</div>
    ${agentPanel()}
    <div class="cat-h" style="margin-top:14px">Optional: live numbers from OpenAI, Anthropic and xAI</div>
    <div class="dim small">OpenAI and Anthropic cost reports need an admin key (made by an organization owner). The xAI prepaid balance needs a management key and your team id. None of these is required; without them the numbers are estimated. The key goes to the vault after one test call and is never shown again.</div>
    ${Object.entries(admin).map(([pid, a]) => `<div class="row small" style="gap:8px;margin-top:6px;flex-wrap:wrap">
      <b style="width:90px">${esc(a.name || pid)}</b>
      ${a.keyed ? `<span class="chip green">${pid === "xai" ? "management" : "admin"} key saved ${esc(a.masked || "")}</span>${a.fromEnv ? `<span class="dim">from the environment</span>` : `<button class="ghost small" data-admin-del="${pid}" style="color:var(--red)">remove</button>`}`
        : `<input type="password" autocomplete="off" data-admin-key="${pid}" placeholder="${esc(a.hint)}" aria-label="${esc(a.name || pid)} ${pid === "xai" ? "management" : "admin"} key" style="width:240px;padding:4px 6px">${a.needsTeam ? `<input type="text" autocomplete="off" data-admin-team="${pid}" placeholder="team id" aria-label="${esc(a.name || pid)} team id" style="width:140px;padding:4px 6px">` : ""}<button class="btn sm" data-admin-save="${pid}">Test and save</button><a href="${esc(a.url)}" target="_blank" rel="noopener">get ${pid === "xai" ? "a management" : "an admin"} key</a>`}
    </div>`).join("")}
  </div>`;
}

// Auto-detected rows (added by the email scan with no confirm step): the scanned fields stay read-only
// until Edit is clicked, so a stray keystroke never turns a detected value into "you entered".
const lockAttr = (s, kind = "input") => (s.autoDetected ? (kind === "select" ? " disabled data-lock" : " readonly data-lock") : "");
function autoLabel(s) {
  if (!s.autoDetected) return "";
  const from = s.source?.link ? `<a href="${esc(s.source.link)}" target="_blank" rel="noopener">receipt email</a>` : "a receipt email";
  return `<span class="small"><span class="sv-tag auto" data-auto-label title="Added from a receipt email with high confidence. The daily rescan keeps plan, price and renewal current, except fields you edit.">auto-detected</span>${s.edited ? ` <span class="sv-tag user" title="Fields you changed are kept as you entered them">edited by you</span>` : ""} <span class="dim">from ${from}${s.source?.receivedAt ? ` of ${esc(s.source.receivedAt)}` : ""}</span></span>`;
}
function rowButtons(s) {
  if (!s.autoDetected) return `<button class="ghost small" data-save>save</button> <button class="ghost small" data-del style="color:var(--red)" title="Remove from the tracker">Remove</button>`;
  return `<button class="ghost small" data-edit title="Change the detected values">Edit</button> <button class="ghost small" data-save hidden>save</button> <button class="ghost small" data-undo title="Remove this auto-detected row. The next scan does not add it back.">Undo</button> <button class="ghost small" data-del style="color:var(--red)" title="Remove from the tracker. The next scan does not add it back.">Remove</button>`;
}

function subsPanel(v) {
  return `<div class="panel"><h3>Subscriptions <span class="right small dim">reminders go out N days before each renewal (desktop notification, push and email per your alert settings)</span></h3>
  <table class="tbl"><thead><tr><th>Service</th><th>Plan</th><th>Price</th><th>Renews</th><th>Remind</th><th>Credits left</th><th>Signal</th><th></th></tr></thead><tbody>
  ${v.subscriptions.map((s) => `<tr data-sub="${esc(s.id)}"${s.autoDetected ? " data-auto" : ""}>
    <td><div class="sv-cell"><span><span class="dot ${s.live?.status || ""}" style="${s.live ? "" : `background:${pcolor(s.provider)}`}"></span> ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</span>${s.autoDetected ? autoLabel(s) : s.source?.kind === "email" ? `<span class="small">${s.source.link ? `<a href="${esc(s.source.link)}" target="_blank" rel="noopener">source email</a>` : "sample email"} · ${pct(s.source.confidence)} sure</span>` : ""}${s.notes ? `<span class="dim small">${esc(s.notes)}</span>` : ""}</div></td>
    <td><div class="sv-cell"><input type="text" data-f="plan" value="${esc(s.plan && s.plan !== "UNKNOWN" ? s.plan : "")}" placeholder="${s.plan === "UNKNOWN" ? "unknown" : ""}" style="width:140px"${lockAttr(s)}>${s.plan && s.plan !== "UNKNOWN" ? fieldTag(s, "plan") : tag("none")}</div></td>
    <td><div class="sv-cell"><span class="row" style="gap:4px"><input type="number" min="0" step="0.01" data-f="price" value="${s.price ?? ""}" placeholder="${s.listPrice != null ? "~" + s.listPrice : "?"}" style="width:80px"${lockAttr(s)}><select data-f="cycle"${lockAttr(s, "select")}>${["monthly", "yearly", "weekly"].map((c) => `<option value="${c}" ${(s.cycle || "monthly") === c ? "selected" : ""}>${c === "monthly" ? "/ month" : c === "yearly" ? "/ year" : "/ week"}</option>`).join("")}</select></span>${s.price != null ? fieldTag(s, "price") : s.listPrice != null ? tag("estimate", null, "Public list price, used only for the estimate until you confirm") : tag("none")}${s.cycle && s.cycle !== "monthly" && s.monthly != null ? `<span class="dim small">${money(s.monthly)} a month</span>` : ""}</div></td>
    <td><div class="sv-cell"><input type="date" data-f="renews" value="${esc(s.renews || "")}" style="width:140px"${lockAttr(s)}>${s.renews ? fieldTag(s, "renews") : tag("none")}${s.renewsRolled ? `<span class="dim small">next: ${esc(s.nextRenewal)} (rolled forward by the cycle)</span>` : ""}${s.daysLeft != null && s.daysLeft >= 0 ? `<span class="dim small">in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}</span>` : ""}</div></td>
    <td><div class="sv-cell"><span class="row" style="gap:4px"><input type="number" min="0" max="60" step="1" data-f="remindDays" value="${s.remindDays}" style="width:56px"><span class="dim small">days</span></span>${s.origin?.remindDays ? tag("user") : `<span class="sv-tag">default</span>`}</div></td>
    <td><div class="sv-cell"><span class="row" style="gap:4px"><input type="number" min="0" data-f="credits" value="${s.credits ?? ""}" style="width:72px" ${s.creditsFrom === "api" ? "disabled" : ""}><span class="dim">/</span><input type="number" min="0" data-f="creditsTotal" value="${s.creditsTotal ?? ""}" style="width:72px" ${s.creditsFrom === "api" ? "disabled" : ""}></span>${s.credits == null ? tag("none") : s.creditsFrom === "api" ? tag("api") : s.creditsFrom === "ledger" ? tag("ledger") : fieldTag(s, "credits")}</div></td>
    <td><span class="sig ${esc(s.signal)}">${esc(s.signal)}</span><div class="dim small">${esc(s.why || "")}</div></td>
    <td class="right nowrap">${rowButtons(s)}</td>
  </tr>`).join("")}
  </tbody></table>
  <div class="row small" style="gap:8px;margin-top:10px;flex-wrap:wrap" id="sv-add">
    <b>Add by hand</b>
    <input type="text" data-a="name" placeholder="Service, e.g. Midjourney" style="width:180px;padding:4px 6px">
    <input type="text" data-a="plan" placeholder="Plan" style="width:120px;padding:4px 6px">
    <input type="number" min="0" step="0.01" data-a="price" placeholder="Price" style="width:80px;padding:4px 6px">
    <select data-a="cycle"><option value="monthly">/ month</option><option value="yearly">/ year</option><option value="weekly">/ week</option></select>
    <input type="date" data-a="renews" style="padding:4px 6px">
    <label class="row" style="gap:4px">remind <input type="number" min="0" max="60" data-a="remindDays" value="3" style="width:52px;padding:4px 6px"> days</label>
    <button class="btn sm" id="sv-add-go">Add</button>
  </div></div>`;
}

function hintsPanel(v) {
  if (!v.hints.length) return "";
  return `<div class="panel"><h3>Possible duplicates or unused</h3>
    ${v.hints.map((h) => `<div class="sv-hint small"><span class="chip amber">${h.kind === "duplicate" ? "duplicate?" : "unused?"}</span> ${esc(h.text)}</div>`).join("")}
    <div class="dim small" style="margin-top:6px">Hints only: nothing is cancelled or changed. "Unused" means no calls or credits logged in this app and no credit change for 30 days.</div></div>`;
}

function candidateHtml(c, subs) {
  const conf = (k) => c.fields?.[k]?.conf;
  const ftag = (k) => (c[k === "service" ? "service" : k] == null ? tag("none") : tag("email", conf(k), c.fields?.[k]?.estimated ? "estimated from the receipt date and cycle" : ""));
  return `<div class="sv-cand ${c.low ? "low" : ""}" data-cand="${esc(c.id)}">
    <div class="row small" style="gap:8px;align-items:center"><b>${esc(c.service)}</b> <span class="chip ${c.low ? "amber" : "green"}">${pct(c.confidence)} sure${c.low ? ", check this one" : ""}</span>
      <span class="dim">${c.source === "demo" ? "sample email" : c.source === "gmail" ? "Gmail" : "Outlook"}${c.accountLabel ? ` · ${esc(c.accountLabel)}` : ""}${c.receivedAt ? ` · ${esc(c.receivedAt)}` : ""}</span>
      ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">open the email</a>` : ""}
    </div>
    <div class="row" style="margin-top:6px">
      <label>Service<input type="text" data-e="name" value="${esc(c.service || "")}" style="width:150px">${ftag("service")}</label>
      <label>Plan<input type="text" data-e="plan" value="${esc(c.plan || "")}" style="width:130px">${ftag("plan")}</label>
      <label>Price${c.currency && c.currency !== "USD" ? ` (${esc(c.currency)})` : ""}<input type="number" min="0" step="0.01" data-e="price" value="${c.price ?? ""}" style="width:80px">${ftag("price")}</label>
      <label>Cycle<select data-e="cycle">${["", "monthly", "yearly", "weekly"].map((x) => `<option value="${x}" ${(c.cycle || "") === x ? "selected" : ""}>${x || "unknown"}</option>`).join("")}</select>${ftag("cycle")}</label>
      <label>Next renewal<input type="date" data-e="renews" value="${esc(c.renews || "")}">${ftag("renews")}</label>
      <label>Remind<input type="number" min="0" max="60" data-e="remindDays" value="3" style="width:52px"><span class="sv-tag">days</span></label>
      <label>Save as<select data-target>${c.matches ? `<option value="${esc(c.matches.id)}">update ${esc(c.matches.name)}</option>` : ""}<option value="new" ${c.matches ? "" : "selected"}>a new row</option>${subs.filter((s) => s.id !== c.matches?.id).map((s) => `<option value="${esc(s.id)}">update ${esc(s.name)}</option>`).join("")}</select></label>
      <button class="btn sm primary" data-confirm>Confirm</button><button class="ghost small" data-dismiss>Dismiss</button>
    </div></div>`;
}

function mailPanel(v) {
  const m = v.mail;
  const card = (src) => {
    const x = m[src];
    return `<div class="card" data-mail="${src}"><div class="row small" style="gap:8px"><b>${esc(x.name)}</b>${x.connected ? `<span class="chip ${x.needsSignIn ? "amber" : "green"}">${x.needsSignIn ? "sign in again" : "connected, read-only"}</span>` : `<span class="chip">not connected</span>`}</div>
      <div class="dim small" style="margin-top:4px">Asks only for: <span class="mono">${x.scopes.map(esc).join(", ")}</span>. Read-only: the app cannot send, delete or change mail.</div>
      ${x.connected && !x.needsSignIn ? `<div class="row small" style="gap:8px;margin-top:8px"><button class="btn sm primary" data-scan="${src}" ${busy ? "disabled" : ""}>Scan for receipts</button><button class="ghost small" data-disconnect="${src}">disconnect</button></div>${x.lastScan ? `<div class="dim small" style="margin-top:4px">Last scan ${ago(x.lastScan.at)} ago: ${x.lastScan.scanned} read, ${x.lastScan.found} new, ${x.lastScan.failed.length} not understood.</div>` : ""}`
        : `${src === "outlook" && window.CC.appSignIn ? `<div style="margin-top:8px">${window.CC.appSignIn.html({ providers: ["microsoft"], step: { microsoft: "inbox" } })}</div><details style="margin-top:6px"><summary class="small" style="cursor:pointer">Advanced: use my own Microsoft client (for developers)</summary>` : ""}<div class="small" style="margin-top:8px">${x.clientIdFromEnv ? `<span class="dim">Client ID from the environment.</span>` : `<input type="text" data-client="${src}" value="${esc(x.clientId || "")}" placeholder="OAuth client ID" style="width:100%;padding:4px 6px">${src === "gmail" ? `<input type="password" autocomplete="off" data-client-secret="${src}" placeholder="${x.hasClientSecret ? "client secret saved" : "client secret (Desktop app clients have one)"}" style="width:100%;padding:4px 6px;margin-top:4px">` : ""}`}
          <div class="row" style="gap:8px;margin-top:6px"><button class="btn sm primary" data-connect="${src}" data-pw-login="1">Connect ${esc(x.name)}</button>${x.connected ? `<button class="ghost small" data-disconnect="${src}">disconnect</button>` : ""}</div>
          <div class="dim small" style="margin-top:4px">${esc(x.setup)} <a href="${esc(x.consoleUrl)}" target="_blank" rel="noopener">open</a></div></div>${src === "outlook" && window.CC.appSignIn ? "</details>" : ""}`}
      ${x.lastScan?.failed?.length ? `<details class="small" style="margin-top:6px"><summary class="dim">${x.lastScan.failed.length} email${x.lastScan.failed.length === 1 ? "" : "s"} not understood</summary>${x.lastScan.failed.map((f) => `<div>${f.link ? `<a href="${esc(f.link)}" target="_blank" rel="noopener">open</a>` : ""} <span class="dim">${esc(f.reason)}</span></div>`).join("")}</details>` : ""}
      ${(x.accounts || []).map((a) => `<div class="row small" data-mail-acct="${esc(a.id)}" data-mail-src="${src}" style="gap:6px;flex-wrap:wrap;margin-top:6px">
        <input type="text" data-acct-label value="${esc(a.label)}" aria-label="Account label" style="width:140px;padding:4px 6px">
        <label class="row" style="gap:4px"><input type="radio" name="mail-default-${src}" data-acct-default ${a.isDefault ? "checked" : ""}> Default</label>
        <span class="chip ${a.connected ? (a.needsSignIn ? "amber" : "green") : ""}">${a.connected ? (a.needsSignIn ? "sign in again" : "connected") : "not connected"}</span>
        <button class="ghost small" data-acct-remove>Remove</button>
      </div>`).join("")}
      ${(x.accounts || []).length ? `<label class="row small" style="gap:6px;margin-top:6px">Account <select data-scan-account="${src}" title="Which mailbox this scan uses">${(x.accounts || []).map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? "selected" : ""}>${esc(a.label)}${a.isDefault ? " (default)" : ""}</option>`).join("")}</select></label>` : ""}
      ${(x.accounts || []).some((a) => a.connected && !a.needsSignIn) && !(x.connected && !x.needsSignIn) ? `<div class="row small" style="gap:8px;margin-top:8px"><button class="btn sm primary" data-scan="${src}" ${busy ? "disabled" : ""}>Scan for receipts</button></div>` : ""}
      <div class="row small" style="gap:6px;margin-top:8px"><input type="text" data-new-label="${src}" placeholder="Label, e.g. Work" aria-label="Label for another ${esc(x.name)} account" style="width:140px;padding:4px 6px"><button class="btn sm" data-add-account="${src}" data-pw-login="1">Add another account</button></div>
    </div>`;
  };
  return `<div class="panel" id="sv-mail-panel"><h3>Find subscriptions in your email <span class="right small"><button class="btn sm" data-scan="demo" ${busy ? "disabled" : ""}>Try with sample emails</button></span></h3>
    <div class="dim small" style="margin-bottom:8px">For services with no balance API (Google AI Pro or Ultra with Flow, Kling, Suno, ChatGPT Plus, Claude Max, Midjourney, ElevenLabs and others). The app reads receipt and renewal emails on this computer, pulls out the service, plan, price, billing cycle and next renewal. A receipt from a known AI service with a clear amount and a plan name or renewal date is added to the table right away, labelled auto-detected, with Undo and Edit; once a day the app rescans connected mailboxes to keep those rows current, and never changes a value you edited. Anything less certain shows below for you to confirm or edit. Only those fields and the message id are kept, never the email itself. Optional: adding rows by hand works the same.</div>
    <div class="sv-mail">${card("gmail")}${card("outlook")}</div>
    ${m.pending.length ? `<div class="cat-h" style="margin-top:14px">${m.pending.length} suggestion${m.pending.length === 1 ? "" : "s"} to confirm</div>${m.pending.map((c) => candidateHtml(c, v.subscriptions)).join("")}` : `<div class="dim small" style="margin-top:10px">No suggestions waiting.</div>`}
  </div>`;
}

function notifyRow() {
  if (typeof Notification === "undefined") return "";
  const p = Notification.permission;
  return `<div class="dim small" style="margin:-6px 0 12px">${p === "granted" ? "Desktop notifications are on for renewal reminders." : `Renewal reminders show in the feed. <button class="ghost small" id="sv-notify">Also show desktop notifications</button>`}</div>`;
}

async function render(el) {
  const s = S();
  if (s.subscriptionsLocked) { window.CC.renderSubscriptionsCore?.(el); return; }
  if (!V) el.innerHTML = `<div class="empty">Loading subscriptions and services…</div>`;
  try { await load(); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (V.locked) { window.CC.renderSubscriptionsCore?.(el); return; }
  draw(el);
  // balances are checked when the page opens (at most once a minute here; the server reuses a check under 30 s old)
  if (Date.now() - lastAuto > 60000) { lastAuto = Date.now(); refreshNow(el, true); }
}

// Ask every provider's balance API, then redraw. The button shows a spinner and "Checking..." meanwhile.
async function refreshNow(el, quiet = false) {
  if (checking) return;
  checking = true; draw(el);
  try {
    await api(`/providers/balances?refresh=1${quiet ? "" : "&force=1"}`);
    await load();
    if (!quiet) toast("Balances and spend refreshed");
  } catch (e) { if (!quiet) toast(e.message, true); }
  checking = false;
  if (window.CC.S.view === "subscriptions" && document.body.contains(el)) draw(el);
}

function draw(el) {
  const v = V;
  el.innerHTML = `<div id="cc-sv">${kpis(v)}${notifyRow()}${apisPanel(v)}${subsPanel(v)}${hintsPanel(v)}${mailPanel(v)}</div>`;
  const $ = (q) => el.querySelector(q), $$ = (q) => [...el.querySelectorAll(q)];
  const run = async (fn, ok) => { try { const r = await fn(); if (r?.apis || r?.view) V = r.view || r; if (ok) toast(typeof ok === "function" ? ok(r) : ok); } catch (e) { toast(e.message, true); } draw(el); };
  window.CC.appSignIn?.wire(el);

  $("#sv-refresh")?.addEventListener("click", () => refreshNow(el));
  $("#sv-notify")?.addEventListener("click", async () => { try { await Notification.requestPermission(); } catch {} draw(el); });

  // admin keys
  $$("[data-admin-save]").forEach((b) => b.addEventListener("click", () => { const pid = b.dataset.adminSave; const key = $(`[data-admin-key="${pid}"]`).value.trim(); if (!key) return toast("Paste the admin key first.", true); const teamId = $(`[data-admin-team="${pid}"]`)?.value.trim() || undefined; run(() => api("/services/admin-key", { method: "POST", body: { provider: pid, key, teamId } }), (r) => `${r.label}. ${r.detail}`); }));
  // budget or credit amount per provider, for the estimate
  $$("[data-budget]").forEach((d) => d.querySelector("[data-budget-save]").addEventListener("click", () => {
    const raw = d.querySelector("[data-budget-amount]").value;
    run(() => api("/services/budget", { method: "POST", body: { provider: d.dataset.budget, amount: raw === "" ? null : Number(raw), kind: d.querySelector("[data-budget-kind]").value } }), raw === "" ? "Budget removed" : "Saved. The estimate uses it now.");
  }));
  // Update balance, Undo, and the agent setup (shown after a click; nothing is sent anywhere)
  $$("[data-balance]").forEach((d) => d.querySelector("[data-balance-save]").addEventListener("click", () => {
    const amount = d.querySelector("[data-balance-amount]").value;
    if (amount === "") return toast("Type the credits left first.", true);
    run(() => api("/services/balance", { method: "POST", body: { provider: d.dataset.balance, amount, date: d.querySelector("[data-balance-date]").value || undefined } }), "Saved. Meldmind keeps this balance up to date from now on.");
  }));
  $$("[data-balance-undo]").forEach((b) => b.addEventListener("click", () => run(() => api("/services/balance/undo", { method: "POST", body: { provider: b.dataset.balanceUndo } }), (r) => `Undone: ${r.undone}`)));
  $("#sv-agent-setup")?.addEventListener("click", async () => { try { agentSetup = await api("/services/agent-setup", { method: "POST", body: {} }); } catch (e) { toast(e.message, true); } draw(el); });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(agentSetup?.[b.dataset.copy] || ""); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it.", true); } }));
  $$("[data-admin-del]").forEach((b) => b.addEventListener("click", async () => { if (!(await window.CC.confirm("Remove this admin key from the vault?", { danger: true, ok: "Remove" }))) return; run(() => api(`/services/admin-key/${b.dataset.adminDel}`, { method: "DELETE" }), "Admin key removed"); }));

  // subscriptions: edit, delete, add
  $$("tr[data-sub]").forEach((tr) => {
    const id = tr.dataset.sub;
    const collect = () => { const o = { id }; tr.querySelectorAll("[data-f]").forEach((i) => { if (i.disabled) return; o[i.dataset.f] = i.value === "" ? null : i.type === "number" ? Number(i.value) : i.value; }); return o; };
    tr.querySelector("[data-save]").addEventListener("click", () => run(() => api("/services/subscriptions", { method: "POST", body: collect() }), "Saved"));
    tr.querySelector("[data-del]").addEventListener("click", async () => { if (!(await window.CC.confirm("Remove this subscription from the tracker? Nothing is cancelled with the provider.", { danger: true, ok: "Remove" }))) return; run(() => api(`/services/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }), "Removed from the tracker"); });
    // auto-detected rows: Edit unlocks the detected fields; Undo removes the row and the next scan skips it
    tr.querySelector("[data-edit]")?.addEventListener("click", (e) => {
      tr.querySelectorAll("[data-lock]").forEach((i) => { i.readOnly = false; i.disabled = false; });
      tr.querySelector("[data-save]").hidden = false; e.currentTarget.hidden = true;
      tr.querySelector('[data-f="plan"]')?.focus();
    });
    tr.querySelector("[data-undo]")?.addEventListener("click", () => run(() => api(`/services/subscriptions/${encodeURIComponent(id)}/undo`, { method: "POST", body: {} }), "Undone. The next scan will not add it back."));
    tr.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") tr.querySelector("[data-save]").click(); }));
  });
  $("#sv-add-go")?.addEventListener("click", () => {
    const o = {}; $$("#sv-add [data-a]").forEach((i) => { o[i.dataset.a] = i.value === "" ? null : i.type === "number" ? Number(i.value) : i.value; });
    if (!o.name) return toast("Type the service name first.", true);
    run(() => api("/services/subscriptions", { method: "POST", body: o }), `${o.name} added`);
  });

  // mail: client id, connect, scan, disconnect
  $$("[data-connect]").forEach((b) => b.addEventListener("click", async () => {
    const src = b.dataset.connect;
    try {
      const idIn = $(`[data-client="${src}"]`), secIn = $(`[data-client-secret="${src}"]`);
      const body = { source: src };
      if (idIn) body.clientId = idIn.value.trim();
      if (secIn && secIn.value.trim()) body.clientSecret = secIn.value.trim();
      if (idIn || body.clientSecret) await api("/services/mail/client", { method: "POST", body });
      const r = await api("/services/mail/start", { method: "POST", body: { source: src, origin: location.origin } });
      localStorage.setItem("cc.mail.oauth", src);
      window.open(r.url, "_blank", "noopener");
      toast(`Sign in to ${src === "gmail" ? "Google" : "Microsoft"} and allow read-only mail access; this page finishes the link when you come back.`);
    } catch (e) { toast(e.message, true); }
  }));
  $$("[data-scan]").forEach((b) => b.addEventListener("click", async () => {
    const src = b.dataset.scan;
    const body = { source: src };
    const sel = src === "demo" ? null : el.querySelector(`[data-scan-account="${src}"]`);
    if (sel?.value) body.accountId = sel.value;
    busy = true; draw(el);
    try {
      const r = await api("/services/mail/scan", { method: "POST", body });
      const auto = (r.added?.length || 0) + (r.updated?.length || 0);
      V = r.view; toast(`${auto ? `${r.added.length} added and ${r.updated.length} updated automatically, ` : ""}${r.found} suggestion${r.found === 1 ? "" : "s"} to confirm${r.failed.length ? `, ${r.failed.length} email${r.failed.length === 1 ? "" : "s"} not understood` : ""}`);
    }
    catch (e) { toast(e.message, true); try { await load(); } catch {} }
    busy = false; draw(el);
  }));
  $$("[data-disconnect]").forEach((b) => b.addEventListener("click", async () => { if (!(await window.CC.confirm("Disconnect this mailbox? Its sign-in token is removed from the vault.", { danger: true, ok: "Disconnect" }))) return; run(async () => { await api(`/services/mail/${b.dataset.disconnect}`, { method: "DELETE" }); return api("/services"); }, "Disconnected"); }));
  $$("[data-add-account]").forEach((b) => b.addEventListener("click", async () => {
    const src = b.dataset.addAccount;
    const label = ($(`[data-new-label="${src}"]`)?.value || "").trim();
    if (!label) return toast("Give this account a label.", true);
    let created = null;
    try {
      const idIn = $(`[data-client="${src}"]`), secIn = $(`[data-client-secret="${src}"]`);
      const client = { source: src };
      if (idIn) client.clientId = idIn.value.trim();
      if (secIn && secIn.value.trim()) client.clientSecret = secIn.value.trim();
      if (idIn || client.clientSecret) await api("/services/mail/client", { method: "POST", body: client });
      created = await api("/mail-accounts", { method: "POST", body: { provider: src, label } });
      const r = await api("/services/mail/start", { method: "POST", body: { source: src, origin: location.origin, accountId: created.account.id } });
      localStorage.setItem("cc.mail.oauth", src);
      window.open(r.url, "_blank", "noopener");
      toast(`Sign in to ${src === "gmail" ? "Google" : "Microsoft"} for this account. This page finishes the link when you come back.`);
    } catch (e) { toast(e.message, true); }
    if (created) { try { await load(); } catch {} if (window.CC.S.view === "subscriptions" && document.body.contains(el)) draw(el); }
  }));
  $$("[data-mail-acct]").forEach((row) => {
    const id = row.dataset.mailAcct;
    row.querySelector("[data-acct-label]").addEventListener("change", () => run(() => api(`/mail-accounts/${encodeURIComponent(id)}/label`, { method: "POST", body: { label: row.querySelector("[data-acct-label]").value } }).then(() => api("/services")), "Account label saved"));
    row.querySelector("[data-acct-default]").addEventListener("change", () => run(() => api(`/mail-accounts/${encodeURIComponent(id)}/default`, { method: "POST", body: {} }).then(() => api("/services")), "Default account updated"));
    row.querySelector("[data-acct-remove]").addEventListener("click", async () => { if (!(await window.CC.confirm("Remove this account? Its token is removed from the vault.", { danger: true, ok: "Remove" }))) return; run(() => api(`/mail-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => api("/services")), "Account removed"); });
  });

  // suggestions: confirm (with edits) or dismiss
  $$("[data-cand]").forEach((box) => {
    const id = box.dataset.cand;
    box.querySelector("[data-confirm]").addEventListener("click", () => {
      const edits = {}; box.querySelectorAll("[data-e]").forEach((i) => { edits[i.dataset.e] = i.value === "" ? "" : i.type === "number" ? Number(i.value) : i.value; });
      if (edits.remindDays === "") delete edits.remindDays;
      run(() => api(`/services/pending/${encodeURIComponent(id)}/confirm`, { method: "POST", body: { edits, target: box.querySelector("[data-target]").value } }), (r) => `${r.saved.name} saved`);
    });
    box.querySelector("[data-dismiss]").addEventListener("click", () => run(() => api(`/services/pending/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: {} }), "Dismissed"));
  });
}

// ---------- OAuth: the browser came back with ?code=&state=mail-... ----------
async function finishMailIfBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state") || "";
  if (!code || !state.startsWith("mail-") || !localStorage.getItem("cc.mail.oauth")) return;
  const clean = () => { for (const k of ["code", "state", "scope", "authuser", "prompt", "session_state", "iss"]) q.delete(k); history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash); };
  try { await api("/services/mail/finish", { method: "POST", body: { code, state } }); toast("Mailbox connected read-only. Open Subscriptions and click Scan for receipts."); }
  catch (e) { toast(`Mail sign-in did not finish: ${e.message}`, true); }
  localStorage.removeItem("cc.mail.oauth"); clean();
  if (window.CC.S.view === "subscriptions") window.CC.render();
}

CC.register({
  id: "subscriptions",
  tab: { label: "Subscriptions", order: 40, icon: "◷", render },
  onEvent(ev) {
    if (ev.type === "hello") finishMailIfBack();
    else if (ev.type === "services.reminder") {
      try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(ev.title || "Renewal coming up", { body: ev.body || "", icon: "/icons/icon-192.png", tag: `cc-renew-${ev.id}` }); } catch {}
    }
  },
});
