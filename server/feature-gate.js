// Feature gates that sit beside the Phase 36 limits.
// Remix is a Pro mission. Extreme and Owner have no monthly cap.
// The Pro cap is a placeholder set in this phase. It is not a price.

import { licenseState, TIERS, monthStartUtc } from "./license.js";

// Placeholder monthly cap for Pro and Studio. Chris can change this number. Not a price.
export const REMIX_PRO_CAP = 8;

const UNLIMITED = new Set(["extreme", "owner"]);
const CAPPED = new Set(["pro", "studio"]);

export function countRemixMonth(items, now = Date.now()) {
  const since = monthStartUtc(now);
  return (items || []).filter((r) => Number(r?.ts) >= since).length;
}

export function remixPolicy(tier) {
  const t = String(tier || "free").toLowerCase();
  if (UNLIMITED.has(t)) {
    return { tier: t, allowed: true, unlimited: true, cap: null, label: TIERS[t]?.label || (t === "extreme" ? "Extreme" : "Owner") };
  }
  if (CAPPED.has(t)) {
    return { tier: t, allowed: true, unlimited: false, cap: REMIX_PRO_CAP, label: TIERS[t]?.label || "Pro" };
  }
  return { tier: "free", allowed: false, unlimited: false, cap: 0, label: TIERS.free.label };
}

export function remixGate({ tier = "free", used = 0 } = {}) {
  const policy = remixPolicy(tier);
  const n = Math.max(0, Number(used) || 0);
  if (!policy.allowed) {
    return {
      ...policy, used: n, remaining: 0, ok: false, status: 402, code: "pro_required",
      message: "Remix is a Pro mission. Extreme has no monthly cap.",
    };
  }
  if (!policy.unlimited && n >= policy.cap) {
    return {
      ...policy, used: n, remaining: 0, ok: false, status: 402, code: "remix_cap",
      message: `You have used ${n} of ${policy.cap} Remix missions this month on ${policy.label}. Extreme has no monthly cap.`,
    };
  }
  const remaining = policy.unlimited ? null : policy.cap - n;
  return {
    ...policy, used: n, remaining, ok: true, status: 200, code: null,
    message: policy.unlimited
      ? "Remix has no monthly cap on this plan."
      : `${remaining} Remix mission${remaining === 1 ? "" : "s"} left this month.`,
  };
}

// The tier always comes from the licence check. Callers pass the used count for this UTC month.
export function assertRemix({ tier, used } = {}) {
  const g = remixGate({ tier: tier ?? licenseState().tier, used });
  if (!g.ok) throw Object.assign(new Error(g.message), { status: g.status, code: g.code });
  return g;
}

// Remix 2 choices. Pro includes Studio. Extreme includes Owner. Free includes none.
// Publish to a website is Pro. A phone build is Extreme. A two-idea blend is Extreme.
export const REMIX_PART_TIER = {
  "screenshot-ui": "pro",
  "recording-prototype": "extreme",
  "penpot-design": "pro",
  "godot-kenney": "pro",
  "phaser-create": "pro",
  "bevy-starter": "extreme",
  "cc0-art": "pro",
  "level-maker": "extreme",
  "voices": "extreme",
  "smoke-test": "pro",
  "access-report": "pro",
  "publish-web": "pro",
  "publish-phone": "extreme",
  installer: "extreme",
  multiplayer: "extreme",
  "style-only": "pro",
  blend: "extreme",
  forks: "pro",
};

const PART_RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 2 };

export function remixAbilityAllowed(tier, ability) {
  const need = REMIX_PART_TIER[ability];
  if (!need) return false;
  const have = PART_RANK[String(tier || "free").toLowerCase()] ?? 0;
  const want = need === "extreme" ? 2 : 1;
  return have >= want;
}

export function remixAbilityGate({ tier = "free", ability } = {}) {
  const id = String(ability || "");
  const need = REMIX_PART_TIER[id];
  if (!need) return { ok: false, status: 400, code: "ability", ability: id, message: "That choice is not available." };
  if (!remixAbilityAllowed(tier, id)) {
    return {
      ok: false, status: 402, code: "ability_tier", ability: id, need, tier: String(tier || "free").toLowerCase(),
      message: need === "extreme" ? "That choice is on Extreme." : "That choice is on Pro.",
    };
  }
  return { ok: true, status: 200, code: null, ability: id, need, message: "" };
}
