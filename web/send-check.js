// 0.4.21: say "out of credits" BEFORE the person sends, not in a small note afterwards.
// The server's /send-check names the AIs that are known to be out and the one-click fix.
// This file holds the banner words and the wiring. It never sends anything itself.

export function bannerHtml(check, esc = (s) => String(s)) {
  const b = check?.banner;
  if (!b) return "";
  const fix = b.fix || {};
  const sw = fix.switchTo;
  const buttons = [
    `<button class="btn sm" type="button" data-sc="free">Get free AIs</button>`,
    sw ? `<button class="btn sm primary" type="button" data-sc="switch">Use ${esc(sw.name)} for this</button>` : "",
    fix.addCredits ? `<button class="btn sm" type="button" data-sc="credits">Add credits</button>` : "",
    `<button class="btn sm" type="button" data-sc="settings">Open Settings</button>`,
  ].join("");
  return `<div class="route cc-send-banner" id="cc-send-banner" role="alert" data-kind="${esc(b.kind)}" style="margin:0 0 10px;border-left:4px solid #c0392b">${b.summary ? `<div class="small" id="cc-send-summary" style="margin-bottom:4px"><b>${esc(b.summary)}</b></div>` : ""}<b>${esc(b.title)}</b><div class="small" style="margin-top:4px">${esc(b.text)}</div><div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">${buttons}</div></div>`;
}

export function clearBanner(doc = document) { doc.getElementById("cc-send-banner")?.remove(); }

// Paint the banner right above the prompt box. Returns the element, or null when there is nothing to say.
export function showBanner(check, { doc = document, esc, onSwitch, onSettings, onCredits, onFreeAis } = {}) {
  clearBanner(doc);
  const html = bannerHtml(check, esc);
  const box = doc.getElementById("orders");
  if (!html || !box) return null;
  box.insertAdjacentHTML("beforebegin", html);
  const el = doc.getElementById("cc-send-banner");
  el.querySelector('[data-sc="switch"]')?.addEventListener("click", () => { onSwitch?.(check.banner.fix.switchTo); el.remove(); });
  el.querySelector('[data-sc="credits"]')?.addEventListener("click", () => onCredits?.(check.banner.fix.addCredits));
  el.querySelector('[data-sc="free"]')?.addEventListener("click", () => onFreeAis?.());
  el.querySelector('[data-sc="settings"]')?.addEventListener("click", () => onSettings?.());
  return el;
}

// Ask the server. A failed check never blocks a send.
export async function runCheck(api, { prompt, explicit = false, mode } = {}) {
  try { return await api("/send-check", { method: "POST", body: { prompt, explicit, mode } }); }
  catch { return null; }
}

// Auto splits a coding job across several AIs; a person who chose Single keeps Single.
export const splitNote = (check) => (check?.autoMode === "mission" ? `This looks like a coding job, so Meldmind is splitting it across ${check.working.length} AIs: plan, build, review. Choose Single to keep it on one AI.` : "");
