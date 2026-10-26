// The send log (0.4.21): every message, invoice, workflow start and post that Meldmind sent for the person is
// written down with when, where, the words, which warnings showed and whether "Send anyway" was pressed.
// Numbers that look like a Social Security or card number are masked before they are kept. Nothing leaves the computer.
import { doc, putDoc } from "./store.js";
import { maskSensitive } from "./compliance-guard.js";

const KEY = "send.log";
const MAX = 500;
const clip = (s, n) => String(s ?? "").slice(0, n);

export function recordSend(e = {}) {
  try {
    const list = doc(KEY, () => []);
    const arr = Array.isArray(list) ? list : [];
    arr.unshift({
      id: "snd-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: Date.now(),
      channel: clip(e.channel, 30),
      kind: clip(e.kind, 40),
      to: clip(maskSensitive(e.to || ""), 120),
      title: clip(maskSensitive(e.title || ""), 120),
      text: clip(maskSensitive(e.text || ""), 600),
      rules: (Array.isArray(e.rules) ? e.rules : []).map((r) => clip(r, 40)).slice(0, 10),
      sendAnyway: e.sendAnyway === true,
      status: clip(e.status || "sent", 20),
      via: clip(e.via || "app", 20),
    });
    putDoc(KEY, arr.slice(0, MAX));
  } catch { /* the log must never stop a send that already happened */ }
}

export function sendLog(limit = 100) {
  const list = doc(KEY, () => []);
  return (Array.isArray(list) ? list : []).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}
