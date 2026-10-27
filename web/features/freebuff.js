// Free coder (Freebuff), a card in Settings (0.4.22). Freebuff is free and shows a sponsored line now and then.
// Meldmind runs it in its own built-in window and types the request for the person. The server side is
// server/freebuff-agent.js and server/plugins/freebuff.js. Nothing about the sign-in is kept in this page.
const { api, toast, esc } = window.CC;

const AD_LABEL = "Sponsored (Freebuff)";
const NOTE = "Freebuff is a free coder that shows a sponsored line now and then. It uses a model that does not keep your prompts. Passwords and keys are never sent to it.";

async function openLink(url) {
  if (!/^https:\/\//i.test(url || "")) return;
  const desk = window.ccDesktop;
  if (desk && typeof desk.openExternal === "function") { await desk.openExternal(url); return; }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.opener = null;
}

function stateChip(s) {
  if (!s.installed) return `<span class="chip amber">Not installed</span>`;
  if (s.phase === "ready") return `<span class="chip green">Ready</span>`;
  if (s.phase === "signin") return `<span class="chip amber">Needs sign in</span>`;
  if (s.phase === "limit") return `<span class="chip amber">Out for now</span>`;
  if (s.phase === "unavailable") return `<span class="chip amber">Not available here</span>`;
  if (s.running) return `<span class="chip">Starting</span>`;
  return `<span class="chip">${s.signedIn ? "Signed in, not running" : "Not set up"}</span>`;
}

export function renderSettings(box) {
  box.innerHTML = `<div class="card cc-freebuff" style="padding:14px">
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><b>Free coder (Freebuff)</b><span id="cc-fb-chip"></span><span class="chip green">Free</span></div>
    <div class="dim small" style="margin-top:4px">${esc(NOTE)}</div>
    <div id="cc-fb-line" class="small" style="margin-top:8px"></div>
    <div id="cc-fb-signin" style="margin-top:8px"></div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn sm" id="cc-fb-start">Set up (one-time sign in)</button><button type="button" class="btn sm" id="cc-fb-stop">Stop</button></div>
    <div class="dim small" style="margin-top:10px">Built-in window (read only)</div>
    <pre id="cc-fb-screen" tabindex="0" aria-label="Freebuff window, read only" style="margin:4px 0 0;max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;padding:8px;border:1px solid var(--border,#444);border-radius:6px">Not running.</pre>
    <div id="cc-fb-ad" class="dim small" style="margin-top:6px"></div>
    <label class="small" for="cc-fb-text" style="display:block;margin-top:12px"><b>Ask the free coder</b></label>
    <textarea id="cc-fb-text" rows="3" style="width:100%;margin-top:4px" placeholder="For example: add a function that adds two numbers"></textarea>
    <div class="row" style="gap:8px;margin-top:6px;align-items:center"><button type="button" class="btn sm" id="cc-fb-ask">Ask</button><span id="cc-fb-busy" class="dim small"></span></div>
    <div id="cc-fb-answer" style="margin-top:8px"></div>
  </div>`;
  const $ = (id) => box.querySelector(id);
  let timer = null;

  function show(s) {
    $("#cc-fb-chip").innerHTML = stateChip(s);
    const bits = [];
    if (s.message) bits.push(s.message);
    if (s.model) bits.push(`Model: ${s.model}`);
    if (s.hoursLeft) bits.push(`${s.hoursLeft.left} of ${s.hoursLeft.total} free hours left today`);
    if (s.minutesLeft != null) bits.push(`${s.minutesLeft} min left in this session`);
    $("#cc-fb-line").textContent = bits.join(". ") || (s.installed ? "" : "Install it once with: npm install -g freebuff");
    const si = $("#cc-fb-signin");
    si.innerHTML = s.signin?.url ? `<button type="button" class="btn" id="cc-fb-open">${esc(s.signin.label)}</button>` : "";
    si.querySelector("#cc-fb-open")?.addEventListener("click", () => openLink(s.signin.url));
    $("#cc-fb-screen").textContent = s.transcript || (s.running ? "Waiting for Freebuff..." : "Not running.");
    $("#cc-fb-ad").textContent = s.ad ? `${AD_LABEL}: ${s.ad.text}` : "";
    $("#cc-fb-busy").textContent = s.busy ? "Working..." : "";
    $("#cc-fb-ask").disabled = !!s.busy;
  }
  async function refresh() {
    if (!box.isConnected) { clearTimeout(timer); return; }
    try { show(await api("/freebuff/status")); } catch (e) { $("#cc-fb-line").textContent = e.message; }
    timer = setTimeout(refresh, 2500);
  }

  $("#cc-fb-start").addEventListener("click", async () => {
    $("#cc-fb-line").textContent = "Starting Freebuff...";
    try { show(await api("/freebuff/start", { method: "POST", body: {} })); } catch (e) { toast(e.message, true); }
  });
  $("#cc-fb-stop").addEventListener("click", async () => {
    try { show(await api("/freebuff/stop", { method: "POST", body: {} })); } catch (e) { toast(e.message, true); }
  });
  $("#cc-fb-ask").addEventListener("click", async () => {
    const text = $("#cc-fb-text").value.trim();
    if (!text) { toast("Type what you want the free coder to do.", true); return; }
    $("#cc-fb-ask").disabled = true; $("#cc-fb-busy").textContent = "Working...";
    try {
      const r = await api("/freebuff/ask", { method: "POST", body: { text } });
      const ans = $("#cc-fb-answer");
      ans.innerHTML = `<div class="row" style="gap:6px;align-items:center"><span class="chip green">Free</span><span class="dim small">Done by Freebuff</span></div><pre class="cc-fb-out" style="white-space:pre-wrap;margin:6px 0 0"></pre>`;
      ans.querySelector(".cc-fb-out").textContent = r.text || "(nothing came back)";
      if (r.status) show(r.status);
    } catch (e) { toast(e.message, true); }
    finally { $("#cc-fb-ask").disabled = false; $("#cc-fb-busy").textContent = ""; }
  });
  refresh();
}

window.CC.register({ id: "freebuff", settings: { order: 4, render: renderSettings } });
