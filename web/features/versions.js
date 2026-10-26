// 0.4.21 (Melius ideas), three small things around a result:
//  1. "Try again" and "Change this part" under a finished result. Older results are kept as
//     Version 1, 2, 3 and can be switched back to. Nothing is overwritten.
//  2. A short line under the prompt box before a run: "Free: Groq" or "About $0.02 on Claude".
//  3. "Show steps", hidden until asked, listing what each step did.
// Both buttons only fill the box and press Send, the same as the person doing it. No new send path.
import { stepRows, versionTabs, costLineHtml } from "./versions-core.js";

const CC = window.CC;
const { api, esc, toast } = CC;

const chain = new Map(); // run id -> chain key
let pending = null;      // { key, how } set by a button, picked up by the next finished run
let shown = null;        // { key, n } an older version is on screen
const KEY_STEPS = "cc_show_steps";
const stepsOn = () => { try { return localStorage.getItem(KEY_STEPS) === "1"; } catch { return false; } };

function promptOf(run) {
  return run?.mission?.prompt || run?.council?.prompt || run?.prompt || CC.S?.lastOrders || document.getElementById("orders")?.value || "";
}

function sendNow(text, how, key) {
  const box = document.getElementById("orders");
  const go = document.getElementById("go");
  if (!box || !go || go.disabled) { toast("Wait for the current job to finish, then try again.", true); return; }
  pending = { key, how };
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  go.click();
}

async function record(run) {
  const text = run.deliverable;
  const fresh = !chain.has(run.id);
  const key = chain.get(run.id) || pending?.key || run.id;
  const how = fresh ? pending?.how || "first" : "first";
  chain.set(run.id, key);
  if (fresh) pending = null; // only a new run takes the button's chain
  try { await api("/versions", { method: "POST", body: { key, runId: run.id, prompt: promptOf(run), text, how } }); } catch { /* the result still shows */ }
  try { return await api(`/versions?key=${encodeURIComponent(key)}`); } catch { return { key, versions: [] }; }
}

function paintShown(list, n) {
  const out = document.getElementById("out-md");
  const v = list.versions.find((x) => x.n === n);
  if (!out || !v) return;
  out.innerHTML = CC.md(v.text);
}

function render(el, run) {
  el.innerHTML = "";
  if (!run?.id || !run.deliverable) { shown = null; return; }
  record(run).then((list) => {
    if (!el.isConnected) return;
    const latest = list.versions.length ? list.versions[list.versions.length - 1].n : 1;
    const showing = shown && shown.key === list.key ? shown.n : latest;
    if (showing !== latest) paintShown(list, showing);
    const tabs = versionTabs(list.versions, showing);
    const rows = stepRows(run);
    el.innerHTML = `<div class="cc-versions small" style="margin:8px 0">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn sm" id="cc-v-again">Try again</button>
        <button type="button" class="btn sm" id="cc-v-change">Change this part</button>
        ${rows.length ? `<button type="button" class="btn sm" id="cc-v-steps" aria-expanded="${stepsOn()}">${stepsOn() ? "Hide steps" : "Show steps"}</button>` : ""}
      </div>
      ${tabs.length > 1 ? `<div class="row" id="cc-v-tabs" role="group" aria-label="Versions of this result" style="gap:6px;flex-wrap:wrap;margin-top:6px">${tabs.map((t) => `<button type="button" class="btn sm${t.on ? " primary" : ""}" data-n="${t.n}" aria-pressed="${t.on}">${esc(t.label)}</button>`).join("")}</div>${showing !== latest ? `<div class="dim" style="margin-top:4px">You are looking at an older version. <button type="button" class="btn sm" id="cc-v-copy">Copy this version</button></div>` : ""}` : ""}
      <div id="cc-v-change-box" hidden style="margin-top:6px"><label class="dim" for="cc-v-change-text">What should change?</label><textarea id="cc-v-change-text" rows="2" style="width:100%" placeholder="For example: make the second paragraph shorter"></textarea><div class="row" style="gap:8px;margin-top:4px"><button type="button" class="btn sm primary" id="cc-v-change-go">Make the change</button></div></div>
      <div id="cc-v-steps-box" ${stepsOn() && rows.length ? "" : "hidden"} style="margin-top:6px">${rows.map((r) => `<div>${esc(r.line)}</div>`).join("")}</div>
    </div>`;
    const prompt = promptOf(run);
    el.querySelector("#cc-v-again").addEventListener("click", () => sendNow(prompt, "again", list.key));
    el.querySelector("#cc-v-change").addEventListener("click", () => { const b = el.querySelector("#cc-v-change-box"); b.hidden = !b.hidden; if (!b.hidden) el.querySelector("#cc-v-change-text").focus(); });
    el.querySelector("#cc-v-change-go").addEventListener("click", async () => {
      const change = el.querySelector("#cc-v-change-text").value.trim();
      if (!change) { toast("Say what should change first.", true); return; }
      try {
        const cur = list.versions.find((x) => x.n === showing)?.text || run.deliverable;
        const r = await api("/versions/change-prompt", { method: "POST", body: { prompt, text: cur, change } });
        sendNow(r.prompt, "change", list.key);
      } catch (e) { toast(e.message || "Could not start the change.", true); }
    });
    el.querySelector("#cc-v-steps")?.addEventListener("click", (e) => {
      const on = !stepsOn();
      try { localStorage.setItem(KEY_STEPS, on ? "1" : "0"); } catch { /* not saved */ }
      el.querySelector("#cc-v-steps-box").hidden = !on;
      e.currentTarget.textContent = on ? "Hide steps" : "Show steps";
      e.currentTarget.setAttribute("aria-expanded", String(on));
    });
    el.querySelectorAll("#cc-v-tabs [data-n]").forEach((b) => b.addEventListener("click", () => {
      const n = Number(b.dataset.n);
      shown = n === latest ? null : { key: list.key, n };
      render(el, run);
    }));
    el.querySelector("#cc-v-copy")?.addEventListener("click", () => {
      const v = list.versions.find((x) => x.n === showing);
      navigator.clipboard?.writeText(v?.text || "").then(() => toast("Copied."), () => toast("Could not copy.", true));
    });
  });
}

// The line before a run. One quiet request after the person stops typing.
let timer = null, seq = 0;
function paintCost(html) {
  let line = document.getElementById("cc-precost");
  const box = document.getElementById("orders");
  if (!box) return;
  if (!html) { line?.remove(); return; }
  if (!line) { line = document.createElement("div"); line.id = "cc-precost"; line.className = "small dim"; line.setAttribute("aria-live", "polite"); line.style.margin = "4px 0"; box.insertAdjacentElement("afterend", line); }
  line.innerHTML = html;
}
function onOrders(box) {
  clearTimeout(timer);
  const text = box.value;
  if (text.trim().length < 3) { paintCost(""); return; }
  timer = setTimeout(async () => {
    const mine = ++seq;
    try {
      const r = await api("/precost", { method: "POST", body: { prompt: text, mode: CC.S?.costMode || CC.S?.settings?.defaultMode } });
      if (mine === seq) paintCost(costLineHtml(r, esc));
    } catch { if (mine === seq) paintCost(""); }
  }, 450);
}
document.addEventListener("input", (e) => { if (e.target?.id === "orders") onOrders(e.target); });
// text typed before this file loaded still gets its line
const early = document.getElementById("orders");
if (early?.value) onOrders(early);

CC.register({ id: "versions", deliverable: { order: 9, render } });
