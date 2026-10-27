// 0.4.20: say the true reason a run stopped, and give a way to keep going when it was a spending limit.
// Pure text helpers (no DOM) plus one wiring function used by the chat failure card.

// kind: budget | rate | credit | key | other
export function failureKind(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return "other";
  if (/^nothing came back/.test(t)) return "empty";
  if (/spending limit|spend cap|monthly (spend )?cap|budget is used up|reached its \$|run reached|raise the cap|raise the limit/.test(t) && !/provider|team has either/.test(t)) return "budget";
  if (/\b429\b|rate.?limit|too many requests|busy right now|overloaded/.test(t)) return "rate";
  if (/\b402\b|out of credits|used all available credits|insufficient|credit balance|billing|payment required|quota/.test(t)) return "credit";
  if (/\b401\b|\b403\b|invalid.{0,12}key|incorrect api key|unauthori[sz]ed|bad key|key was rejected/.test(t)) return "key";
  return "other";
}

const TITLES = {
  budget: "Your spending limit was reached. Nothing more was spent.",
  rate: "That AI is busy and asked us to slow down. Nothing was charged.",
  credit: "That AI is out of credit. Nothing was charged.",
  key: "That AI did not accept the key. Nothing was charged.",
  other: "That AI did not finish. Nothing was charged.",
  empty: "Nothing came back. Nothing was charged.",
};
const HINTS = {
  budget: "You can keep going on a free AI, or add $1 to your limit here and run it again.",
  rate: "Wait a minute and try again, or send it to another AI.",
  credit: "Add credit on that AI's website, or send this to another AI.",
  key: "Open Settings and paste the key again, or send this to another AI.",
  other: "Try again, or send it to another AI.",
  empty: "Press Try again, or send it to another AI.",
};

// A short label so the cause is clear at a glance (0.4.21): whose limit or key it is.
export const CHIPS = { budget: "Your limit", rate: "Busy: their limit", credit: "Their credit", key: "Your key", other: "Something else" };

export function failureCopy(text) {
  const kind = failureKind(text);
  // the server already wrote the plain reason after "Nothing came back." (which AI, and what to do): show it
  const hint = kind === "empty" ? (String(text).replace(/^\s*nothing came back\.\s*/i, "").trim() || HINTS.empty) : HINTS[kind];
  return { kind, title: TITLES[kind], hint, chip: CHIPS[kind] };
}

// oneAI (0.4.21, dogfood 15): a failed Mission also offers "Get a one-AI answer" (one AI answers the same request).
export const ONE_AI_LABEL = "Get a one-AI answer";
export function failureHtml({ text = "", esc = (s) => String(s), retry = "Try again", other = "Try another AI", oneAI = false } = {}) {
  const c = failureCopy(text);
  const buttons = c.kind === "budget"
    ? `<button class="btn sm primary" type="button" id="cc-limit-free">Continue free</button><button class="btn sm" type="button" id="cc-limit-plus">Add $1 and continue</button>`
    : `<button class="btn sm primary" type="button" id="cc-fail-retry">${esc(retry)}</button><button class="btn sm" type="button" id="cc-fail-other">${esc(other)}</button>${oneAI ? `<button class="btn sm" type="button" id="cc-fail-oneai">${esc(ONE_AI_LABEL)}</button>` : ""}`;
  return `<div class="route" id="cc-fail" data-cause="${c.kind}" style="margin-top:10px"><span class="chip ${c.kind === "budget" ? "amber" : ""}" data-cause-chip>${esc(c.chip)}</span> <b>${esc(c.title)}</b><div class="small dim" style="margin-top:4px">${esc(c.hint)}</div>${c.kind === "budget" ? `<div class="small" id="cc-still-works" style="margin-top:6px"><b>Still works when the budget is used up:</b> practice AIs, AIs running on this computer, your saved projects, files and notes, and everything you already made. Paid AI answers wait until next month or until you add to the limit.</div>` : ""}<div class="row" style="margin-top:8px;gap:8px">${buttons}</div></div>`;
}

// Continue free: re-send to a free or practice AI. Add $1: raise the local limit by a dollar, then re-send.
// Both only change this app's own settings. No payment happens.
export function wireLimitButtons(root, { api, toast, rerun, setFree }) {
  root.querySelector("#cc-limit-free")?.addEventListener("click", async () => {
    try {
      const r = await api("/cost-guard/choices");
      const pick = (r.free || [])[0];
      if (!pick) return toast("No free AI is set up yet. Add a local model or turn on the practice AIs in Settings, or add $1 to the limit.", true);
      setFree({ provider: pick.provider, model: pick.model, name: pick.name, practice: !!pick.practice });
      toast(`Running it again on ${pick.name}. It is free${pick.practice ? ", and a practice AI gives sample answers" : ", and a smaller AI may write shorter answers"}.`);
      rerun();
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#cc-limit-plus")?.addEventListener("click", async () => {
    try {
      const r = await api("/cost-guard/continue", { method: "POST", body: { amount: 1 } });
      toast(`Your monthly limit is now $${Number(r.cap).toFixed(2)}. Running it again.`);
      rerun();
    } catch (e) { toast(e.message, true); }
  });
}
