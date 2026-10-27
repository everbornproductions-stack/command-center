// One-click Sign in with Google and Sign in with Microsoft (0.4.17).
//
// A small piece other screens reuse (the welcome screen, Get everything connected, Settings,
// Subscriptions):
//   window.CC.appSignIn.html(opts)  -> markup (sync; uses the last status it saw)
//   window.CC.appSignIn.wire(el)    -> loads the status and wires every widget inside el
//   window.CC.appSignIn.start(provider, step) -> starts a sign-in ("google" | "microsoft", "first" | "inbox")
// opts: { providers: ["google", "microsoft"], step: { microsoft: "inbox" }, title: true }
// The sign-in page opens in the person's normal browser. The tokens stay in the vault on this
// computer. When Everborn's sign-in app is not set up yet, the button says so and offers the
// person's own sign-in app under Advanced.
const { api, toast, esc } = window.CC;

const STYLE = `
.cc-signin { display: grid; gap: 10px; }
.cc-signin .si-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.cc-signin .si-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cc-signin .si-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
.cc-signin .si-note { margin-top: 8px; border-left: 3px solid var(--amber, #d97706); padding: 6px 10px; }
`;
if (!document.getElementById("cc-signin-style")) {
  const s = document.createElement("style");
  s.id = "cc-signin-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const NAMES = {
  google: { title: "Google: Gmail, Calendar, and Drive", button: "Sign in with Google", inbox: "Read my inbox", company: "Google", own: "Use my own Google client" },
  microsoft: { title: "Microsoft: Outlook", button: "Sign in with Microsoft", inbox: "Read my Outlook inbox", company: "Microsoft", own: "Use my own Microsoft client" },
};

let status = null;
let loading = null;
const notes = {}; // provider -> text shown after a click when sign-in is not set up yet

function load() {
  if (loading) return loading;
  loading = api("/signin").then((s) => { status = s; return s; }).catch(() => status).finally(() => { loading = null; });
  return loading;
}

function optsOf(node) {
  try { return JSON.parse(node.dataset.appSignin || "{}"); } catch { return {}; }
}

function rowHtml(provider, step) {
  const n = NAMES[provider];
  const st = status?.[provider] || null;
  const inboxOnly = step === "inbox";
  const scopes = (list) => (list || []).map((x) => esc(x.label)).join(", ");
  const chip = !st ? "" : st.connected ? `<span class="chip ${st.needsSignIn ? "amber" : "green"}">${st.needsSignIn ? "sign in again" : "signed in"}</span>` : "";
  const inboxChip = st?.inbox?.granted ? `<span class="chip green">inbox on</span>` : "";
  let actions = "";
  if (st?.waiting) {
    actions = `<span class="small">Waiting for you to finish in your browser...</span><button type="button" class="ghost small" data-si-cancel="${provider}">Cancel</button>`;
  } else if (inboxOnly) {
    actions = st?.inbox?.granted ? "" : `<button type="button" class="btn sm primary" data-si-start="${provider}" data-si-step="inbox" data-pw-login="1">${esc(n.inbox)}</button>`;
  } else if (!st?.connected || st?.needsSignIn) {
    actions = `<button type="button" class="btn sm primary" data-si-start="${provider}" data-si-step="first" data-pw-login="1">${esc(n.button)}</button>`;
  } else {
    actions = `${st.inbox?.granted ? "" : `<button type="button" class="btn sm" data-si-start="${provider}" data-si-step="inbox" data-pw-login="1">${esc(n.inbox)}</button>`}<button type="button" class="ghost small" data-si-start="${provider}" data-si-step="first">Sign in again</button>`;
  }
  const asks = inboxOnly
    ? `Reading mail is its own sign-in. Meldmind only reads; it cannot delete or change mail.`
    : st?.connected && !st.needsSignIn
      ? `Allowed: ${scopes(st.scopes) || "nothing yet"}.${st.inbox?.granted ? "" : ` ${esc(n.inbox)} is a separate sign-in, only if you want it.`}`
      : `Opens ${n.company} in your normal browser. Meldmind asks only for: ${scopes(st?.first) || "calendar events, files Meldmind makes, and sending email"}. Every email still waits for your OK. Your password never reaches Meldmind.`;
  const testingLine = st?.testing && st.testingNote && !st.connected ? `<div class="si-note small">${esc(st.testingNote)}</div>` : "";
  const note = testingLine + (notes[provider] ? `<div class="si-note small"><div>${esc(notes[provider])}</div><div class="si-actions"><button type="button" class="btn sm" data-si-own="${provider}">${esc(n.own)}</button><span class="dim">Under Advanced. For developers.</span></div></div>` : "");
  return `<div class="si-row" data-si-row="${provider}">
    <div class="si-head"><b>${esc(inboxOnly ? n.inbox : n.title)}</b>${chip}${inboxChip}</div>
    <div class="dim small" style="margin-top:4px">${asks}</div>
    <div class="si-actions">${actions}</div>
    ${note}
  </div>`;
}

function inner(opts) {
  const providers = Array.isArray(opts.providers) && opts.providers.length ? opts.providers.filter((p) => NAMES[p]) : ["google", "microsoft"];
  return providers.map((p) => rowHtml(p, opts.step?.[p] || "first")).join("");
}

export function html(opts = {}) {
  return `<div class="cc-signin" data-app-signin="${esc(JSON.stringify(opts))}">${inner(opts)}</div>`;
}

function paint(node) { node.innerHTML = inner(optsOf(node)); }
function paintAll() { document.querySelectorAll("[data-app-signin]").forEach(paint); }

function openOwn(provider) {
  if (provider === "microsoft") { window.CC.go?.("subscriptions"); return; }
  if (window.CC.openSettings) window.CC.openSettings("[data-feature='browser']");
  else window.CC.go?.("settings");
}

export async function start(provider, step = "first") {
  if (!NAMES[provider]) return;
  if (!status) await load();
  if (status && status[provider] && !status[provider].ready) {
    notes[provider] = status[provider].comingSoon;
    paintAll();
    return;
  }
  try {
    const r = await api(`/signin/${provider}`, { method: "POST", body: { step } });
    status = r.status || status;
    delete notes[provider];
    paintAll();
    if (!r.opened && r.url) window.open(r.url, "_blank", "noopener");
    toast(`${NAMES[provider].company} sign-in opened in your browser. Come back here when it says you are signed in.${r.note ? ` ${r.note}` : ""}`);
  } catch (e) {
    if (e?.code === "coming_soon" || /coming soon/i.test(e?.message || "")) { notes[provider] = e.message; paintAll(); return; }
    toast(e.message, true);
  }
}

export function wire(el) {
  const root = el || document;
  const nodes = root.matches?.("[data-app-signin]") ? [root] : [...root.querySelectorAll("[data-app-signin]")];
  for (const node of nodes) {
    if (node._siWired) continue;
    node._siWired = true;
    node.addEventListener("click", async (ev) => {
      const b = ev.target.closest("button");
      if (!b || !node.contains(b)) return;
      if (b.dataset.siStart) { ev.preventDefault(); await start(b.dataset.siStart, b.dataset.siStep || "first"); return; }
      if (b.dataset.siOwn) { ev.preventDefault(); openOwn(b.dataset.siOwn); return; }
      if (b.dataset.siCancel) {
        ev.preventDefault();
        try { status = await api(`/signin/${b.dataset.siCancel}/cancel`, { method: "POST" }); } catch (e) { toast(e.message, true); }
        paintAll();
      }
    });
  }
  load().then(() => nodes.forEach((n) => { if (n.isConnected) paint(n); }));
}

window.CC.appSignIn = { html, wire, start, status: () => status, refresh: () => load().then(paintAll) };

window.CC.register({
  id: "app-signin",
  onEvent(ev) {
    if (ev?.type !== "signin.done") return;
    const n = NAMES[ev.provider];
    if (n) toast(ev.ok ? `${n.company} is connected. The sign-in is saved on this computer.` : `${n.company} sign-in did not finish: ${ev.error || "try again"}`, !ev.ok);
    status = null;
    load().then(paintAll);
    window.CC.refresh?.();
  },
});
