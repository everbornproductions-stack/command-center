// 0.4.21: Grok Bot as a last-resort text route, so a job that every API AI refused can still be handed to it.
// Grok Bot answers by webhook and can take minutes, so this route is never ranked in normal picks.
// The fallback wrapper (server/free-first.js lastResortChoices) offers it only after the faster AIs failed.
// Nothing here stores a key; the webhook and its sender key stay in the vault (server/grokbot.js).
import { registerLocalRoute } from "./local-routes.js";
import * as GB from "./grokbot.js";

export const GROKBOT_TEXT = "grokbot-text";

async function* grokbotText(opts = {}) {
  const text = (opts.messages || []).map((m) => (typeof m?.content === "string" ? m.content : "")).filter(Boolean).join("\n\n");
  const system = typeof opts.system === "string" && opts.system.trim() ? `${opts.system.trim()}\n\n` : "";
  const job = await GB.dispatch({ task: `${system}${text}`.slice(0, 20000), source: { kind: "click" } });
  const done = await GB.awaitJob(job.id, { timeoutMs: Math.max(5000, GB.waitMs("council")), signal: opts.signal });
  if (!done || done.status !== "done" || !String(done.text || "").trim()) {
    const err = new Error(done?.error || "Grok Bot did not send an answer in time.");
    err.status = done ? 502 : 504;
    throw err;
  }
  yield { type: "delta", text: done.text };
  yield { type: "done", usage: { input: 0, output: 0, cost: 0 }, stop: "end" };
}

let registered = false;
export function registerGrokbotText() {
  if (registered) return;
  registered = true;
  registerLocalRoute(GROKBOT_TEXT, grokbotText, "Grok Bot");
}
registerGrokbotText();
export const grokbotReady = () => { try { return GB.readiness().ready; } catch { return false; } };
