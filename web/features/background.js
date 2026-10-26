// Background runs (Pro). The box is on the order panel in Simple and Expert.
// A done alert stays in the app. Nothing is emailed from here.
const { api, toast, esc } = window.CC;

function showBanner(ev) {
  let box = document.getElementById("cc-bg-alert");
  if (!box) {
    box = document.createElement("div");
    box.id = "cc-bg-alert";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:80;background:var(--card-bg, #111827);color:var(--text, #e5e7eb);border:1px solid #334155;border-radius:10px;padding:12px 14px;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,.35)";
    document.body.appendChild(box);
  }
  const headline = ev.headline || "Run done";
  const title = ev.title || "";
  box.innerHTML = `<div style="font-weight:600">${esc(headline)}</div>
    <div class="small" style="margin:6px 0 10px">${esc(title)}</div>
    <div class="row" style="gap:8px">
      <button class="btn sm primary" id="cc-bg-open" type="button">Open</button>
      <button class="ghost small" id="cc-bg-dismiss" type="button">Dismiss</button>
    </div>`;
  const close = () => {
    box.remove();
    api("/background/seen", { method: "POST", body: { id: ev.id } }).catch(() => {});
  };
  box.querySelector("#cc-bg-open").addEventListener("click", () => {
    if (window.CC.openRun) window.CC.openRun(ev.id);
    close();
  });
  box.querySelector("#cc-bg-dismiss").addEventListener("click", close);
}

function render(el) {
  el.innerHTML = `<label class="row small" style="gap:8px;margin-top:8px"><input type="checkbox" id="bg-run"> Run in background</label>
    <div class="dim small">Pro. Leave this screen. You get an alert when it is done.</div>`;
}

window.CC.register({
  id: "background",
  command: { order: 15, render },
  onEvent(ev) {
    if (ev.type !== "background.done") return;
    toast(`${ev.headline || "Run done"}${ev.title ? `. ${ev.title}` : ""}`);
    showBanner(ev);
  },
});
