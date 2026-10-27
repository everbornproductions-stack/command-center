// What OpenRouter's two answers really mean (0.4.21). /key says how the KEY is limited ("limit_remaining" can be
// $50 because someone set a $50 key limit) and /credits says what the ACCOUNT bought and used. An account that
// never bought credits has nothing left, whatever the key limit says, so "$50 left" must never show for it.
// Pure: no fetch, no imports. Used by the health light and the Subscriptions balance.
const r2 = (n) => +Number(n || 0).toFixed(2);

// key: the /key "data" object. credits: the /credits "data" object, or null when it could not be read.
export function interpretOpenRouter(key = {}, credits = null) {
  const free = !!key.is_free_tier;
  const out = { unit: "USD", free, left: null, total: null, scope: null, noCredits: false, keyLimitLeft: null };
  if (key.limit_remaining != null) out.keyLimitLeft = r2(key.limit_remaining);
  else if (key.limit != null) out.keyLimitLeft = r2(Number(key.limit) - Number(key.usage || 0));
  if (credits && credits.total_credits != null) {
    out.total = r2(credits.total_credits);
    out.left = Math.max(0, r2(Number(credits.total_credits) - Number(credits.total_usage || 0)));
    out.scope = "account";
    if (out.keyLimitLeft != null && out.keyLimitLeft < out.left) { out.left = Math.max(0, out.keyLimitLeft); out.scope = "key limit"; }
    out.noCredits = Number(credits.total_credits) <= 0;
  } else if (free) {
    // credits could not be read, but OpenRouter itself says this account never bought any
    out.left = 0; out.total = 0; out.scope = "account"; out.noCredits = true;
  } else if (out.keyLimitLeft != null) {
    // only the key's own limit is known: say so, it is not the account balance
    out.left = Math.max(0, out.keyLimitLeft); out.scope = "key limit";
  }
  return out;
}

// One plain line for the health light.
export function openRouterLine(b) {
  if (!b) return "";
  if (b.noCredits) return "no credits bought (free models only)";
  if (b.left == null) return "";
  if (b.left <= 0) return "out of credits";
  return b.scope === "key limit" ? `$${b.left} left on this key's limit` : `$${b.left} left`;
}
