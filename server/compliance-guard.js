// Compliance guard for anything that goes out to real people (texts, emails, HighLevel messages).
// It reads rules from server/compliance-rules/*.json, so a new pack is just another file.
// It never sends and never changes the text. It returns what a person should see before the click.
//   checkOutgoing({ text, channel, consent, sendTime, creditRepair }) =>
//     { ok, blocked: [..], warnings: [{ rule, level, plain, why, canSendAnyway }], needsAck }
// ok is false only when a rule at level "block" matched. Warnings need the person's explicit
// "Send anyway" click (sendAnyway: true on the confirm), except blocks, which cannot be sent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "compliance-rules");
const CREDIT = /\b(credit repair|credit score|credit report|croa|furnisher|collection account|dispute|tradeline)\b/i;

let cache = null;
export function loadRules(dir = DIR) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return out; }
  for (const f of files) {
    let pack;
    try { pack = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const r of Array.isArray(pack?.rules) ? pack.rules : []) {
      if (!r?.id || !r.pattern) continue;
      try { out.push({ ...r, pack: pack.pack || f, re: new RegExp(r.pattern, "i") }); } catch { /* skip a bad pattern */ }
    }
  }
  return out;
}
const rules = () => (cache ||= loadRules());
export const resetRules = () => { cache = null; };

export function checkOutgoing({ text = "", channel = "", consent, sendTime, creditRepair } = {}, { rulesList } = {}) {
  const body = String(text || "");
  const credit = creditRepair === true || CREDIT.test(body);
  const warnings = [];
  for (const r of rulesList || rules()) {
    if (r.creditOnly && !credit) continue;
    if (!r.re.test(body)) continue;
    const block = r.level === "block";
    warnings.push({ rule: r.id, level: block ? "block" : "warn", plain: r.plain, why: r.why, canSendAnyway: !block });
  }
  const isSend = channel === "sms" || channel === "email" || channel === "SMS" || channel === "Email";
  if (isSend && consent !== true) {
    warnings.push({ rule: "missing_consent", level: "warn", canSendAnyway: true, plain: "Nothing here says these people agreed to hear from you.", why: "Texts and marketing emails need permission first (TCPA and CAN-SPAM). Tick the permission box, or only message people who asked to hear from you." });
  }
  if (sendTime !== undefined && sendTime !== null && sendTime !== "") {
    warnings.push({ rule: "send_time_label", level: "info", canSendAnyway: true, plain: "Meldmind sends when you click Publish, not at the time you picked.", why: "The time is only used to check quiet hours (8 am to 9 pm). Click Publish at the time you want it to go out." });
  }
  const blocked = warnings.filter((w) => w.level === "block");
  return { ok: blocked.length === 0, blocked, warnings, needsAck: warnings.some((w) => w.level === "warn") };
}

// One plain sentence for places that show a single line.
export function summaryLine(result) {
  if (!result || !result.warnings?.length) return "";
  const first = result.blocked?.[0] || result.warnings[0];
  return `${first.plain} ${first.why}`;
}
