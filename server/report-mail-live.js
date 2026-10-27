// The real senders behind server/report-mail.js: the saved Resend key, Gmail and Outlook (all the person's own).
import * as google from "./google.js";
import * as microsoft from "./microsoft.js";
import { getSecret } from "./vault.js";
import { sendMail, setupLine, options } from "./report-mail.js";

const resendKey = () => { try { return getSecret("resend")?.key || ""; } catch { return ""; } };
export function liveDeps(overrides = {}) {
  const avail = {
    resendKey: !!resendKey(),
    gmail: (() => { try { return !!google.canSend(); } catch { return false; } })(),
    outlook: (() => { try { return !!microsoft.canSend(); } catch { return false; } })(),
  };
  return { avail, getKey: resendKey, fetchImpl: (...a) => fetch(...a), gmailSend: (m) => google.gmailSend(m), outlookSend: (m) => microsoft.outlookSend(m), ...overrides };
}
export const mailView = (prefs, deps = liveDeps()) => ({ options: options(deps.avail), setup: setupLine(prefs, deps.avail), from: prefs.from || "", via: prefs.via || "auto" });
export const send = (mail, prefs, deps = liveDeps()) => sendMail(mail, prefs, deps);
