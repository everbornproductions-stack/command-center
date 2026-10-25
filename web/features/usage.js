// Settings switch for the daily anonymous usage ping. Off on a new install until the person turns it on.
const { api, toast } = window.CC;
const LABEL = "Share anonymous usage counts to help improve Meldmind";
const DETAIL = "Once a day, if this is on, Meldmind sends counts only: a random install id, the app version, the operating system, your plan, how many times each feature was used, and anonymous quality signals (provider, task type, thumbs up/down or retry/accept, cost and latency bucket). No prompts, answers, chats, file names, emails, keys, or identifying ids. You can turn this off here.";

async function renderSettings(el) {
  let view = { share: false, label: LABEL, detail: DETAIL };
  try { view = await api("/usage"); } catch (e) {
    el.innerHTML = `<div class="panel" id="usage-share-panel"><h3>Privacy</h3><div class="dim small">${e.message}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="panel" id="usage-share-panel"><h3>Privacy</h3>
    <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start">
      <input type="checkbox" id="usage-share" ${view.share ? "checked" : ""}>
      <span>${LABEL}</span>
    </label>
    <div class="dim small" style="margin-top:6px">${DETAIL}</div>
  </div>`;
  el.querySelector("#usage-share").addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      const next = await api("/usage", { method: "POST", body: { share: on } });
      e.target.checked = !!next.share;
      toast(next.share ? "Anonymous usage counts on" : "Anonymous usage counts off");
    } catch (err) {
      e.target.checked = !on;
      toast(err.message, true);
    }
  });
}

window.CC.register({
  id: "usage",
  settings: { order: 1, render: renderSettings },
});
