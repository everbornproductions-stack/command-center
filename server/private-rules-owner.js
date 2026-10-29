// Owner-only extra phrases for the private-rules cleaner (0.4.25, audit A7).
// The shared cleaner (server/private-rules.js) only knows general routine wording such as "commit and push" or
// "cloud-first". Names of one person's own folders or drives (a cloud folder name, a drive letter path) are not product
// code. The owner saves them once as a plain list on the settings document:
//   POST /api/settings { "privateRulePhrases": ["My Cloud Folder", "X:\\Shared Drive"] }
// and they are used only while this install runs on the owner licence. Every other plan keeps them out of the way.
import { doc } from "./store.js";
import { currentTier } from "./feature-gate.js";
import { phraseMatchers } from "./private-rules.js";

const tierNow = () => { try { return String(currentTier() || "free").toLowerCase(); } catch { return "free"; } };
const settingsNow = () => { try { return doc("settings", () => ({})) || {}; } catch { return {}; } };

/** The owner's own phrases, or [] for anyone who is not on the owner license. */
export function ownerPhrases({ tier, settings } = {}) {
  if ((tier === undefined ? tierNow() : String(tier || "").toLowerCase()) !== "owner") return [];
  const s = settings === undefined ? settingsNow() : settings || {};
  return Array.isArray(s.privateRulePhrases) ? s.privateRulePhrases.filter((p) => typeof p === "string") : [];
}

/** Options for stripPrivateRules / cleanPlan: { matchers } built from the owner's phrases (empty for everyone else). */
export function ownerRuleOpts(o = {}) {
  return { matchers: phraseMatchers(ownerPhrases(o)) };
}
