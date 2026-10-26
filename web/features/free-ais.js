// Free AIs first (0.4.21). Two things live here:
//  - the "Free only (never spend money)" switch, next to Send and in Settings
//  - the "Get free AIs" card: one-click links to the free key pages (Groq, Gemini AI Studio, OpenRouter, GitHub Models,
//    Cloudflare, Mistral), Ollama and LM Studio found by themselves, Grok Bot setup, and a paste box that sends a key
//    straight to the vault (server POST /keys). A key is never kept in the page after it is saved.
const { S, api, toast, esc } = window.CC;

const FREE_ONLY_LABEL = "Free only (never spend money)";
let card = null;

export function freeOnlySwitchHtml(on) {
  return `<label class="row small cc-freeonly" id="cc-freeonly-wrap" style="gap:6px" title="On: only AIs on this PC and free allowances are used. Nothing is charged."><input type="checkbox" id="cc-freeonly" ${on ? "checked" : ""}> ${esc(FREE_ONLY_LABEL)}</label>`;
}
export async function setFreeOnly(on) {
  const r = await api("/fallback/settings", { method: "POST", body: { freeOnly: !!on } });
  S.freeOnly = r.freeOnly || { on: !!on };
  return S.freeOnly;
}
// One delegated listener keeps every Free only switch on the page (Send row, Settings, the card) on the same setting.
let delegated = false;
export function wireFreeOnly() {
  if (delegated) return;
  delegated = true;
  document.addEventListener("change", async (ev) => {
    const box = ev.target;
    if (!box?.matches?.("#cc-freeonly, .cc-freeonly-box")) return;
    try {
      const v = await setFreeOnly(box.checked);
      document.querySelectorAll("#cc-freeonly, .cc-freeonly-box").forEach((b) => { b.checked = !!v.on; });
      const line = document.getElementById("cc-freeonly-line"); if (line && v.line) line.textContent = v.line;
      toast(v.on ? "Free only is on. Nothing will be charged." : "Free only is off. Free AIs still go first.");
    } catch (e) { box.checked = !box.checked; toast(e.message, true); }
  });
}

function rowHtml(p) {
  const status = p.local ? "" : "";
  if (p.needs === "nothing") {
    const found = p.connected;
    return `<div class="row cc-fa-row" data-id="${esc(p.id)}" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><b style="min-width:190px">${esc(p.name)}</b><span class="chip ${found ? "green" : ""}">${found ? "Found on this PC" : "Not running"}</span><span class="dim small" style="flex:1">${esc(p.what)}</span><button type="button" class="btn sm" data-open="${esc(p.url)}">Get it</button></div>`;
  }
  const state = p.connected ? `<span class="chip ${p.working ? "green" : "amber"}">${p.working ? "Connected" : "Connected, out of credits"}</span>` : "";
  const paste = p.provider && !p.later
    ? `<span class="row" style="gap:6px"><input type="password" autocomplete="off" spellcheck="false" class="cc-fa-key" data-provider="${esc(p.provider)}" placeholder="Paste key" aria-label="Paste the ${esc(p.name)} key" style="width:170px"><button type="button" class="btn sm" data-save="${esc(p.provider)}">Save key</button></span>`
    : `<span class="dim small">${p.later ? "Open the page, then add the key under Keys and providers." : ""}</span>`;
  return `<div class="row cc-fa-row" data-id="${esc(p.id)}" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><b style="min-width:190px">${esc(p.name)}</b>${state}<span class="dim small" style="flex:1">${esc(p.what)}</span><button type="button" class="btn sm" data-open="${esc(p.url)}">Open key page</button>${paste}</div>`;
}

export async function open() {
  close();
  let d;
  try { d = await api("/free-ais?force=1"); } catch (e) { toast(e.message, true); return; }
  const wrap = document.createElement("div");
  wrap.id = "cc-free-ais";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-labelledby", "cc-free-ais-title");
  wrap.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
  const gb = d.grokbot || {};
  wrap.innerHTML = `<div class="card" style="max-width:640px;width:100%;max-height:90vh;overflow:auto;padding:16px">
    <h3 id="cc-free-ais-title" style="margin-top:0">Get free AIs</h3>
    <p class="small" style="margin:0 0 6px">Free AIs go first, so a job never stops just because one account ran out. Each key page opens in your browser. Paste the key here and it goes straight to your private vault. Nothing is charged.</p>
    <p class="small dim" id="cc-fa-summary" style="margin:0 0 6px">${esc(d.summary || "")}</p>
    ${freeOnlySwitchHtml(!!d.freeOnly?.on).replace('id="cc-freeonly"', 'class="cc-freeonly-box"')}
    <div id="cc-fa-list">${d.pages.map(rowHtml).join("")}</div>
    <div class="row cc-fa-row" id="cc-fa-grok" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px"><b style="min-width:190px">Grok Bot</b><span class="chip ${gb.ready ? "green" : ""}">${gb.ready ? "Ready" : "Not set up"}</span><span class="dim small" style="flex:1">Your own assistant. It takes any job it can do, and it is a last-resort helper when other AIs fail.</span><button type="button" class="btn sm" id="cc-fa-grokbtn">${gb.ready ? "Open Grok Bot settings" : "Set up Grok Bot"}</button></div>
    <p class="small dim" style="margin-top:10px">Free tiers can use your prompts to improve their products. Turn on Private mode to keep private files away from them.</p>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button type="button" class="btn sm" id="cc-fa-recheck">Look again for Ollama and LM Studio</button><button type="button" class="btn sm primary" id="cc-fa-close">Done</button></div>
  </div>`;
  document.body.appendChild(wrap);
  card = wrap;
  const back = document.activeElement;
  const end = () => { close(); try { back?.focus?.(); } catch {} };
  wrap.querySelector("#cc-fa-close").addEventListener("click", end);
  wrap.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); end(); } });
  wrap.addEventListener("click", (ev) => { if (ev.target === wrap) end(); });
  wrap.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { try { window.open(b.dataset.open, "_blank", "noopener"); } catch {} }));
  wrap.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const input = wrap.querySelector(`.cc-fa-key[data-provider="${b.dataset.save}"]`);
    const key = (input?.value || "").trim();
    if (!key) return toast("Paste the key first.", true);
    b.disabled = true;
    try {
      const r = await api("/keys", { method: "POST", body: { provider: b.dataset.save, key } });
      if (input) input.value = "";
      toast(r?.status?.status === "green" ? "Key saved and working." : "Key saved. Meldmind will check it.");
      await window.CC.refresh?.();
      await open();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  wrap.querySelector("#cc-fa-grokbtn").addEventListener("click", () => { end(); S.focusProvider = "grokbot"; window.CC.go("settings"); });
  wrap.querySelector("#cc-fa-recheck").addEventListener("click", async () => { await open(); });
  wrap.querySelector("#cc-fa-close").focus();
}
export function close() { document.getElementById("cc-free-ais")?.remove(); card = null; }

function renderSettings(el) {
  const f = S.freeOnly || {};
  el.innerHTML = `<div class="panel" id="cc-freeais-settings"><h3>Free AIs first</h3>
    <p class="small muted" style="margin:0 0 8px">Meldmind uses AIs on this PC and free allowances first, then your own plans, and a paid AI only when it is worth it. A job never ends empty while a free AI is available.</p>
    ${freeOnlySwitchHtml(!!f.on).replace('id="cc-freeonly"', 'class="cc-freeonly-box"')}
    <p class="small dim" id="cc-freeonly-line" style="margin:6px 0 0">${esc(f.line || "")}</p>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="cc-get-free-ais">Get free AIs</button></div></div>`;
  el.querySelector("#cc-get-free-ais").addEventListener("click", () => open());
}

wireFreeOnly();
window.CC.freeAis = { open, close, setFreeOnly, wireFreeOnly, freeOnlySwitchHtml };
window.CC.register({
  id: "free-ais",
  settings: { order: 2, render: renderSettings },
});
