// Which Stripe price is which plan. This is the one file to fill in from the Stripe dashboard.
//
// TODO (Chris, or Claude while Chris is signed in to Stripe): paste the seven Stripe price ids
// (Product catalog, each price, "price_..."). Until then the amount plus interval fallback below
// maps the same seven prices, so the webhook works without any hand-entered id.
//   [ ] Meldmind Pro       $18.99 / month  -> "pro-monthly"
//   [ ] Meldmind Pro       $189   / year   -> "pro-yearly"
//   [ ] Meldmind Extreme   $29.99 / month  -> "extreme-monthly"
//   [ ] Meldmind Extreme   $299   / year   -> "extreme-yearly"
//   [ ] Meldmind Developer $34.99 / month  -> "developer-monthly"
//   [ ] Meldmind Developer $349   / year   -> "developer-yearly"
//   [ ] Founder lifetime   $349 once       -> "lifetime-349"
// A price id is not a secret. Never put a Stripe key or the webhook secret in this file.

// price id -> plan id. Example: "price_1AbCdEf": "pro-monthly",
export const PRICE_TIERS = {
};

// Plan id -> the licence tier it unlocks in the app. Developer carries the Extreme limits.
// Founder lifetime is Pro for life (server/price-config.js LIFETIME_TIER); the app reads the
// lifetime plan and keeps it Pro even when a row says otherwise.
export const PLANS = {
  "pro-monthly": { tier: "pro", interval: "month" },
  "pro-yearly": { tier: "pro", interval: "year" },
  "extreme-monthly": { tier: "extreme", interval: "month" },
  "extreme-yearly": { tier: "extreme", interval: "year" },
  "developer-monthly": { tier: "extreme", interval: "month" },
  "developer-yearly": { tier: "extreme", interval: "year" },
  "lifetime-349": { tier: "pro", interval: "once", lifetime: true },
  "lifetime-499": { tier: "pro", interval: "once", lifetime: true },
};

// Fallback when the price id is not in PRICE_TIERS: unit amount in cents plus interval.
// "once" is a one-time payment. Founder $349 once and Developer $349 a year differ by interval.
export const AMOUNT_PLANS = {
  "1899:month": "pro-monthly",
  "18900:year": "pro-yearly",
  "2999:month": "extreme-monthly",
  "29900:year": "extreme-yearly",
  "3499:month": "developer-monthly",
  "34900:year": "developer-yearly",
  "34900:once": "lifetime-349",
  "49900:once": "lifetime-499",
};
