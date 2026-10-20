// Prefer free AIs, and one upgrade tip after a finished run.
const { S, api, esc } = window.CC;

const CAPCUT_NOTE = "CapCut lists the MCP as available outside the US, with US access coming soon.";

function preferChecked() {
  if (S.settings?.preferFree === true || S.settings?.preferFree === false) return S.settings.preferFree;
  return (S.uiMode || S.settings?.uiMode) === "simple";
}

window.CC.register({
  id: "access",
  settings: {
    order: 15,
    render(el) {
      el.innerHTML = `<div class="panel"><h3>Free AIs and upgrade tips</h3>
        <label class="row small" style="gap:8px"><input type="checkbox" id="cc-prefer-free" ${preferChecked() ? "checked" : ""}> Prefer free AIs when quality is similar</label>
        <label class="row small" style="gap:8px;margin-top:8px"><input type="checkbox" id="cc-upgrade-tips" ${S.settings?.showUpgradeTips === false ? "" : "checked"}> Show upgrade tips</label>
        <div class="dim small" style="margin-top:6px">A tip shows after a run, once per AI per task type each week. Nothing is sent.</div>
      </div>`;
      el.querySelector("#cc-prefer-free")?.addEventListener("change", async (ev) => {
        try { S.settings = await api("/settings", { method: "POST", body: { preferFree: ev.target.checked } }); } catch (e) { window.CC.toast(e.message, true); }
      });
      el.querySelector("#cc-upgrade-tips")?.addEventListener("change", async (ev) => {
        try { S.settings = await api("/settings", { method: "POST", body: { showUpgradeTips: ev.target.checked } }); } catch (e) { window.CC.toast(e.message, true); }
      });
    },
  },
  deliverable: {
    order: 40,
    render(el, run) {
      const live = S.live || {};
      const status = live.status || run?.status;
      if (status !== "done" && status !== "done-with-errors") { el.innerHTML = ""; return; }
      const notice = live.mission?.notice || live.council?.notice || run?.notice;
      const tip = live.tip || null;
      if (!notice && !tip) { el.innerHTML = ""; return; }
      const bits = [];
      if (notice?.text) bits.push(`<div class="small" style="margin-top:8px">${esc(notice.text)}${notice.billing ? ` <a href="${esc(notice.billing)}" target="_blank" rel="noopener">Billing</a>` : ""}</div>`);
      if (tip?.text) bits.push(`<div class="small" style="margin-top:8px">${esc(tip.text)}${tip.href ? ` <a href="${esc(tip.href)}" target="_blank" rel="noopener">Open</a>` : ""}</div>`);
      el.innerHTML = bits.join("");
    },
  },
  onEvent(ev) {
    if (ev.type !== "tip" || !ev.tip) return;
    if (S.live?.id && ev.missionId && ev.missionId !== S.live.id) return;
    if (S.live && S.live.status !== "done" && S.live.status !== "done-with-errors") return;
    S.live.tip = ev.tip;
    if (S.view === "command") window.CC.renderOutput?.();
  },
});

export { CAPCUT_NOTE };
