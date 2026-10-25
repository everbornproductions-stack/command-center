// Free first (0.4.18): "Save money with free AIs" in Settings, on the welcome screen, and today's counter on
// Credits. Every install asks for an OK first (confirm box) and the server refuses without consent: true.
import { panelHtml, consentText, needsInstall, fixFor } from "../free-panel.js";
const { S, api, toast, esc } = window.CC;

const css = `.cc-ff-hi { font-weight: 600; } .cc-ff-route b { font-weight: 600; }`;
const style = document.createElement("style"); style.id = "cc-free-first-style"; style.textContent = css; document.head.appendChild(style);

let view = null;
const dev = () => (S.uiMode === "expert" ? "?dev=1" : "");
async function load(refresh = false) {
  try { view = await api(`/freefirst${dev()}${refresh ? `${dev() ? "&" : "?"}refresh=1` : ""}`); } catch {}
  return view;
}

async function openPage(url) {
  if (!url) return;
  const desk = window.ccDesktop;
  if (desk && typeof desk.openExternal === "function") { await desk.openExternal(url); return; }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.opener = null;
}

async function install(what, model = "") {
  if (what === "openrouter-key") return openPage(view?.links?.openrouterKeys);
  if (!["antigravity"].includes(what) && !confirm(consentText(what, model))) return null;
  toast(what === "ollama-model" ? `Downloading ${model}...` : "Working on it...");
  const r = await api("/freefirst/install", { method: "POST", body: { what, model, consent: true } });
  if (r.view) view = r.view;
  if (r.link) await openPage(r.link).catch(() => {});
  toast(r.message || (r.ok ? "Done." : "That did not work."), !r.ok && r.code !== "link");
  return r;
}

async function render(el, { setup = false } = {}) {
  if (!el) return;
  if (!view) await load(true);
  el.innerHTML = panelHtml(view || {}, { esc, mode: S.uiMode, setup });
  const again = () => render(el, { setup });
  const post = async (body) => { view = await api(`/freefirst/settings${dev()}`, { method: "POST", body }); again(); };
  el.querySelector("#cc-ff-on")?.addEventListener("change", (e) => post({ on: e.target.checked }).catch((x) => toast(x.message, true)));
  el.querySelector("#cc-ff-quality")?.addEventListener("change", (e) => post({ qualityToo: e.target.checked }).catch((x) => toast(x.message, true)));
  el.querySelectorAll("[data-ff-on]").forEach((b) => b.addEventListener("change", () => post({ routes: { [b.dataset.ffOn]: b.checked } }).catch((x) => toast(x.message, true))));
  el.querySelectorAll("[data-ff-fix]").forEach((b) => b.addEventListener("click", () => install(b.dataset.ffFix).then(again).catch((x) => toast(x.message, true))));
  el.querySelectorAll("[data-ff-pull]").forEach((b) => b.addEventListener("click", () => install("ollama-model", b.dataset.ffPull).then(again).catch((x) => toast(x.message, true))));
  el.querySelector("#cc-ff-check")?.addEventListener("click", () => load(true).then(again));
  // One button: install the Gemini app if it is missing, then open its sign-in. Each step asks first.
  el.querySelector("#cc-ff-setup")?.addEventListener("click", async () => {
    try {
      for (const r of needsInstall(view)) {
        const fix = fixFor(r);
        const res = await install(fix.what);
        if (!res?.ok) break;
        if (fix.what === "gemini-cli") await install("gemini-signin");
      }
    } catch (x) { toast(x.message, true); }
    again();
  });
}

CC.register({
  id: "free-first",
  settings: { order: 9, render: (el) => render(el) },
  welcome: { order: 20, render: (el) => { el.classList.add("welcome-block"); el.id = "su-free-first"; render(el, { setup: true }); } },
  credits: { order: 8, async render(el) { await load(); el.innerHTML = view?.today ? `<div class="panel small" id="cc-ff-credits">${esc(view.today.line)}.</div>` : ""; } },
});
