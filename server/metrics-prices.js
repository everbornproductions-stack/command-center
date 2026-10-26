// List prices for the owner metrics report only.
// This file does not call Stripe, does not open a checkout, and does not change what the app charges.
// The live checkout stays in server/billing-plans.js.

export const METRICS_PRICES = {
  pro: { monthly: 18.99, yearly: 189 },
  extreme: { monthly: 29.99, yearly: 299 },
  developer: { monthly: 34.99, yearly: 349 },
  lifetime: { 349: 349, 499: 499 },
  legacyTier: { studio: "extreme" },
};

export function monthlyCents(product, cadence, prices = METRICS_PRICES) {
  const row = prices[product];
  if (!row) return 0;
  if (cadence === "yearly") return Math.round((Number(row.yearly) * 100) / 12);
  return Math.round(Number(row.monthly) * 100);
}

export function fromCents(cents) {
  return Number((Number(cents) / 100).toFixed(2));
}
