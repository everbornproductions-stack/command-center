// 0.4.23 Mac-style GUI entry. Nothing here runs unless the Mac style is on, so the 0.4.21 look is untouched.
// On: ?mac=1 in the address, localStorage cc.mac = "1", or the saved setting uiStyle = "mac".
// Off: ?mac=0, localStorage cc.mac = "0", or no setting. (The lead flips the default at the end of the build.)
// See docs/mac-style-0423.md for the part contract.
import { PARTS } from "/mac/parts.js";

export function macOn(CC = window.CC) {
  try {
    const q = new URLSearchParams(location.search).get("mac");
    if (q === "1") return true;
    if (q === "0") return false;
    const ls = localStorage.getItem("cc.mac");
    if (ls === "1") return true;
    if (ls === "0") return false;
  } catch { /* storage blocked: fall through to the setting */ }
  return (CC?.S?.settings?.uiStyle ?? "") === "mac";
}

function link(part) {
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = `/mac/css/${part}.css`;
  el.dataset.macCss = part;
  document.head.appendChild(el);
}

// A tiny event bus so parts do not import each other. Events used: "mode" (simple|expert), "theme" (light|dark),
// "view" (view id), "flow" ({path, step}), "open" ({panel: "history"|"launchpad"|"settings"|"live"}).
function makeBus() {
  const h = new Map();
  return {
    on(name, fn) { (h.get(name) || h.set(name, []).get(name)).push(fn); return () => h.set(name, (h.get(name) || []).filter((f) => f !== fn)); },
    emit(name, data) { for (const fn of h.get(name) || []) { try { fn(data); } catch (e) { console.warn(`[mac] ${name}:`, e); } } },
  };
}

export async function startMac(CC = window.CC) {
  if (!macOn(CC) || document.body.dataset.style === "mac") return null;
  document.body.dataset.style = "mac";
  const mac = { parts: {}, bus: makeBus(), PARTS, on: true };
  CC.mac = mac;
  for (const p of PARTS) link(p);
  const ctx = { CC, bus: mac.bus, root: null, slot: (id) => document.getElementById(id) };
  for (const p of PARTS) {
    try {
      const mod = await import(`/mac/parts/${p}.js`);
      const part = mod.default;
      mac.parts[p] = part;
      await part?.mount?.(ctx);
    } catch (e) { console.warn(`[mac] part ${p} failed:`, e); }
  }
  mac.bus.emit("mode", CC.uiMode?.() || "simple");
  return mac;
}

export function stopMac(CC = window.CC) {
  const mac = CC.mac;
  if (!mac) return;
  for (const p of [...PARTS].reverse()) { try { mac.parts[p]?.unmount?.({ CC, bus: mac.bus }); } catch { /* ignore */ } }
  document.querySelectorAll("link[data-mac-css]").forEach((l) => l.remove());
  document.getElementById("mac-root")?.remove();
  delete document.body.dataset.style;
  delete CC.mac;
}
