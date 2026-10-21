// A small tip when a job, a browser step, or a connection hits a sign-in.
// The words and the two links are fixed. Nothing here stores a password.

export const TIP_TEXT = "Tip: keep your passwords in a password manager like 1Password (or Bitwarden, free). Meldmind never stores your passwords.";
export const ONE_PASSWORD_URL = "https://1password.com";
export const BITWARDEN_URL = "https://bitwarden.com";
export const DISMISS_KEY = "cc.pwtip";

const LOGIN_WORDS = /\b(sign[\s-]?in|log[\s-]?in|log[\s-]?on|password)\b/i;

export function looksLikeLogin(text) {
  return LOGIN_WORDS.test(String(text || ""));
}

export function isDismissed(storage) {
  try { return storage?.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export function dismiss(storage) {
  try { storage?.setItem(DISMISS_KEY, "1"); } catch { /* the tip can still be removed from the page */ }
}

export function tipHtml(storage) {
  if (isDismissed(storage)) return "";
  return `<div class="cc-pw-tip" data-pw-tip role="note"><span>Tip: keep your passwords in a password manager like <a href="${ONE_PASSWORD_URL}" target="_blank" rel="noopener">1Password</a> (or <a href="${BITWARDEN_URL}" target="_blank" rel="noopener">Bitwarden</a>, free). Meldmind never stores your passwords.</span><button type="button" class="ghost small" data-pw-dismiss>Dismiss</button></div>`;
}

// True for a control that opens a sign-in. API-key buttons are not a login.
export function isLoginControl(el) {
  if (!el) return false;
  const attrs = el.dataset || {};
  if (attrs.pwDismiss != null || el.hasAttribute?.("data-pw-dismiss")) return false;
  if (attrs.pwLogin != null && attrs.pwLogin !== "0") return true;
  if (attrs.signin || attrs.sso || attrs.mcpConnect) return true;
  const id = el.id || "";
  if (id === "bh-g-connect" || id === "bh-add-account") return true;
  if (attrs.a === "connect") return true;
  const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
  if (/^sign in\b/i.test(text)) return true;
  if (/^continue with\b/i.test(text)) return true;
  return false;
}

export function showPasswordTip(doc, storage) {
  if (!doc?.body || isDismissed(storage)) return;
  if (doc.querySelector("[data-pw-tip]")) return;
  const hold = doc.createElement("div");
  hold.innerHTML = tipHtml(storage);
  const node = hold.firstElementChild;
  if (!node) return;
  node.classList.add("cc-pw-float");
  doc.body.appendChild(node);
}

let installed = false;
export function installPasswordTip(doc, storage) {
  if (installed || !doc?.addEventListener || !doc.head) return;
  installed = true;
  if (!doc.getElementById("cc-pw-style")) {
    const style = doc.createElement("style");
    style.id = "cc-pw-style";
    style.textContent = `.cc-pw-tip{display:flex;gap:8px;align-items:flex-start;margin-top:8px;padding:8px 10px;border:1px solid var(--line,#334155);border-radius:8px;background:var(--bg2,#121826);font-size:12px;line-height:1.45}.cc-pw-tip a{white-space:nowrap}.cc-pw-tip button{margin-left:auto;flex:none}.cc-pw-float{position:fixed;left:16px;bottom:16px;z-index:70;width:min(420px,calc(100vw - 32px));margin:0;box-shadow:0 10px 30px rgba(0,0,0,.45)}`;
    doc.head.appendChild(style);
  }
  doc.addEventListener("click", (e) => {
    const raw = e.target;
    if (!raw?.closest) return;
    if (raw.closest("[data-pw-dismiss]")) {
      e.preventDefault();
      dismiss(storage);
      doc.querySelectorAll("[data-pw-tip]").forEach((n) => n.remove());
      return;
    }
    const btn = raw.closest("button, a");
    if (isLoginControl(btn)) showPasswordTip(doc, storage);
  }, true);
}
