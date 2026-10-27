// 0.4.23 Mac-style GUI: runbar part.
// Expert run bar above the chat box (FEATURE-MAP.md section 2).
// The Expert Command view owns the real controls (#run-mode, #cost-mode, #when-mode,
// Free only). This bar only clicks them, it never writes CC.S itself, and it repaints
// only on the bus or when something it shows has actually changed.
import { setFreeOnly } from "/features/free-ais.js";
import { RUN_MODES, PRIORITIES, costLine } from "../data/runbar.js";

let timer = null;
let offs = [];

// Same mapping as priorityNow() in web/app.js.
function priorityNow(CC) {
  const raw = CC.S?.costMode || CC.S?.settings?.defaultMode || "balanced";
  return raw === "economy" ? "savings" : raw;
}

export default {
  id: "runbar",
  mount(ctx) {
    const { CC, bus } = ctx;
    let lastBar = null;
    let lastSig = "";

    // Expert only, Command view only.
    function showBar() {
      return (CC.uiMode?.() || "expert") === "expert" && (CC.S?.view || "command") === "command";
    }

    // What the bar shows. The 1 second check below repaints only when this string changes,
    // so a view or mode switch (which removes the bar) and every control it draws is covered.
    function sig() {
      return [
        CC.S?.view || "command",
        CC.uiMode?.() || "expert",
        CC.S?.cmdMode || "auto",
        priorityNow(CC),
        CC.S?.whenMode || "now",
        CC.S?.freeOnly?.on ? "on" : "off",
        costLine(CC.S?.estimateCost || 0)
      ].join("|");
    }

    // The Command view rebuilds #view, which drops the bar, so it is placed again when missing.
    function place() {
      const orders = document.getElementById("orders");
      const box = orders?.parentElement;
      if (!box?.parentNode) return null;
      let bar = document.getElementById("mac-runbar");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "mac-runbar";
        box.parentNode.insertBefore(bar, box);
      }
      return bar;
    }

    function paint(force) {
      if (!showBar()) {
        document.getElementById("mac-runbar")?.remove();
        lastBar = null;
        lastSig = "";
        return;
      }
      const bar = place();
      if (!bar) {
        lastBar = null;
        lastSig = "";
        return;
      }
      const s = sig();
      // Nothing changed: keep the DOM as it is, never rewrite innerHTML for nothing.
      if (!force && bar === lastBar && s === lastSig) return;

      const curMode = CC.S?.cmdMode || "auto";
      const curPriority = priorityNow(CC);
      const curWhen = CC.S?.whenMode || "now";
      const freeOn = !!CC.S?.freeOnly?.on;
      const activeHelp = RUN_MODES.find((m) => m.id === curMode)?.help || RUN_MODES[0].help;

      bar.style.display = "flex";
      bar.innerHTML = `
        <div class="mac-runbar-row">
          <div class="mac-runbar-seg" id="mac-rb-modes" role="group" aria-label="How to run it">
            ${RUN_MODES.map((m) => `<button type="button" data-m="${m.id}" class="${curMode === m.id ? "on" : ""}" title="${m.help}">${m.label}</button>`).join("")}
          </div>
          <select class="mac-runbar-select" id="mac-rb-priority" aria-label="Priority">
            ${PRIORITIES.map((p) => `<option value="${p.id}" ${curPriority === p.id ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
          <div class="mac-runbar-seg" id="mac-rb-when" role="group" aria-label="When">
            <button type="button" data-m="now" class="${curWhen === "now" ? "on" : ""}">Now</button>
            <button type="button" data-m="offpeak" class="${curWhen === "offpeak" ? "on" : ""}" title="Queue the mission for the next discount window">Off-peak</button>
          </div>
          <label class="mac-runbar-toggle">
            <input type="checkbox" id="mac-rb-free" ${freeOn ? "checked" : ""}> Free only
          </label>
          <div class="mac-runbar-cost" id="mac-rb-cost">${costLine(CC.S?.estimateCost || 0)}</div>
        </div>
        <div class="mac-runbar-help" id="mac-rb-help">${activeHelp}</div>
      `;

      // Click the original control: its own handler sets CC.S and paints the Command view.
      const clickOriginal = (sel) => {
        const orig = document.querySelector(sel);
        if (orig) orig.click();
      };
      // One tick later, so the bar is redrawn from the state the click just set.
      const again = () => setTimeout(() => paint(true), 0);

      bar.querySelector("#mac-rb-modes")?.addEventListener("click", (e) => {
        const m = e.target.closest("button")?.dataset.m;
        if (!m) return;
        clickOriginal(`#run-mode button[data-m="${m}"]`);
        again();
      });

      bar.querySelector("#mac-rb-modes")?.addEventListener("mouseover", (e) => {
        const item = RUN_MODES.find((x) => x.id === e.target.closest("button")?.dataset.m);
        const help = bar.querySelector("#mac-rb-help");
        if (item && help) help.textContent = item.help;
      });

      bar.querySelector("#mac-rb-modes")?.addEventListener("mouseout", () => {
        const help = bar.querySelector("#mac-rb-help");
        if (help) help.textContent = activeHelp;
      });

      bar.querySelector("#mac-rb-priority")?.addEventListener("change", (e) => {
        clickOriginal(`#cost-mode button[data-m="${e.target.value}"]`);
        again();
      });

      bar.querySelector("#mac-rb-when")?.addEventListener("click", (e) => {
        const m = e.target.closest("button")?.dataset.m;
        if (!m) return;
        clickOriginal(`#when-mode button[data-m="${m}"]`);
        again();
      });

      bar.querySelector("#mac-rb-free")?.addEventListener("change", async (e) => {
        try {
          await setFreeOnly(e.target.checked);
        } catch { /* the bar is painted from CC.S.freeOnly below, so it goes back */ }
        paint(true);
      });

      lastBar = bar;
      lastSig = s;
    }

    offs = [bus.on("mode", () => paint(false)), bus.on("view", () => paint(false))];
    paint(false);
    timer = setInterval(() => paint(false), 1000);
  },
  unmount() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const off of offs) { try { off?.(); } catch { /* ignore */ } }
    offs = [];
    document.getElementById("mac-runbar")?.remove();
  }
};
