// 0.4.34 (0.4.31 panel item 10): under an answer about credit repair, real estate, loans or insurance, the same rules as
// the Send check flag risky lines (a promised result, fair housing words, loan terms without the required details, an
// SSN). Nothing is changed: it says what to fix before the words go to a real person.
const { api, esc } = window.CC;

function textOf(run) { return String(run?.deliverable || run?.verdict?.text || "").trim(); }

window.CC.register({
  id: "answer-check",
  deliverable: { order: 4, async render(el, run) {
    const text = textOf(run);
    el.innerHTML = "";
    if (!text) return;
    let r;
    try { r = await api("/answer-check", { method: "POST", body: { text } }); } catch { return; }
    const list = (r?.warnings || []);
    if (!list.length || !el.isConnected) return;
    el.innerHTML = `<div class="route small cc-answer-check" role="note" style="margin-top:8px;border-left:3px solid #b45309;padding:8px 10px">
      <b>Before you send this to anyone</b>
      <ul style="margin:6px 0 0;padding-left:18px">${list.map((w) => `<li><b>${esc(w.plain || "")}</b>${w.why ? ` <span class="dim">${esc(w.why)}</span>` : ""}</li>`).join("")}</ul>
      <div class="dim" style="margin-top:4px">The same rules as the Send check. Nothing in the answer was changed.</div>
    </div>`;
  } },
});
