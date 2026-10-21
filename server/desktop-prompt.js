// One-time desktop card for people who update to 0.4.9.
// Not now shows it once more. Never and Done keep it closed.
// The card stays hidden until the installed version is 0.4.9 or newer.
// 0.4.8 is a hotfix and does not show this card.

export const DESKTOP_PROMPT_FROM = "0.4.9";

export function versionAtLeast(version, floor = DESKTOP_PROMPT_FROM) {
  const parse = (v) => String(v || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

export function shouldShowDesktopPrompt({ version, status, laterCount } = {}) {
  if (!versionAtLeast(version)) return false;
  if (status === "never" || status === "done") return false;
  return (Number(laterCount) || 0) < 2;
}

export function applyDesktopPrompt(state, action) {
  const cur = {
    status: state?.status === "never" || state?.status === "done" || state?.status === "later" ? state.status : "pending",
    laterCount: Number(state?.laterCount) || 0,
  };
  if (cur.status === "never" || cur.status === "done") return cur;
  if (action === "never") return { status: "never", laterCount: cur.laterCount };
  if (action === "done") return { status: "done", laterCount: cur.laterCount };
  if (action === "later") return { status: "later", laterCount: cur.laterCount + 1 };
  return cur;
}

export function desktopPromptCopy() {
  return {
    title: "New: let Meldmind use your desktop",
    body: "Meldmind can use apps on this computer that have no API. You allow each app. You confirm before a send, a buy, or a delete. A banner says Meldmind is using that app, and Stop ends it. Passwords are not stored. Google Antigravity is the first app. Install and connect runs Google's installer, then opens sign-in in your browser. You can change this later in Settings.",
    safety: [
      "You allow each app before Meldmind uses it.",
      "Send, buy, and delete wait for a second click.",
      "A banner names the app and has Stop.",
      "Passwords are not stored.",
    ],
  };
}
