// Checkout choices. This module never calls Stripe, never opens a network connection, and never charges.
// Prices come from server/price-config.js. Yearly and lifetime are not derived from monthly.
import { publicCompare } from "./feature-gate.js";
import {
  EXTREME_MONTHLY, EXTREME_MONTHLY_PAY_LINK, EXTREME_MONTHLY_PLAN_ID, EXTREME_YEARLY, EXTREME_YEARLY_PAY_LINK, EXTREME_YEARLY_PLAN_ID,
  extremeMonthlyLabel, extremeYearlyLabel,
  FOUNDER_LIMITED_LINE, FOUNDER_SPOTS_HIDDEN_UNTIL,
  DEVELOPER_MONTHLY, DEVELOPER_MONTHLY_PAY_LINK, DEVELOPER_MONTHLY_PLAN_ID, DEVELOPER_YEARLY, DEVELOPER_YEARLY_PAY_LINK, DEVELOPER_YEARLY_PLAN_ID,
  developerMonthlyLabel, developerYearlyLabel, payLinkWithEmail,
  LIFETIME_CAP, LIFETIME_EARLY_PRICE, LIFETIME_EARLY_SEATS, LIFETIME_LATER_PRICE, LIFETIME_PAY_LINK, LIFETIME_PLAN_ID, LIFETIME_RULE, LIFETIME_TIER,
  PRICE_SET, PRO_MONTHLY, PRO_MONTHLY_PAY_LINK, PRO_MONTHLY_PLAN_ID, PRO_YEARLY, PRO_YEARLY_PAY_LINK, PRO_YEARLY_PLAN_ID,
  proMonthlyLabel, proYearlyLabel, spotsLeftPhrase,
} from "./price-config.js";

// Pro monthly.
export const MONTHLY_LINK = PRO_MONTHLY_PAY_LINK;
export const MONTHLY_AMOUNT = PRO_MONTHLY;
export const YEARLY_AMOUNT = PRO_YEARLY;
export const FOUNDER_EARLY_PRICE = LIFETIME_EARLY_PRICE;
export const FOUNDER_LATER_PRICE = LIFETIME_LATER_PRICE;
export const FOUNDER_EARLY_SEATS = LIFETIME_EARLY_SEATS;
export const FOUNDER_CAP = LIFETIME_CAP;

function publishedPlan({ id, name, amount, cadence, label, button, tier, payLink }) {
  const link = typeof payLink === "string" && payLink.startsWith("https://") ? payLink : null;
  return { id, name, tier, amount, cadence, label, button, payLink: link, pendingLink: !link };
}

export const MONTHLY_PLAN = publishedPlan({
  id: PRO_MONTHLY_PLAN_ID, name: "Pro", tier: "pro", amount: PRO_MONTHLY, cadence: "month",
  label: proMonthlyLabel, button: `Go Pro, ${proMonthlyLabel}`, payLink: PRO_MONTHLY_PAY_LINK,
});

export const YEARLY_PLAN = publishedPlan({
  id: PRO_YEARLY_PLAN_ID, name: "Pro yearly", tier: "pro", amount: PRO_YEARLY, cadence: "year",
  label: proYearlyLabel, button: `Pro yearly, ${proYearlyLabel}`, payLink: PRO_YEARLY_PAY_LINK,
});

export const EXTREME_MONTHLY_PLAN = publishedPlan({
  id: EXTREME_MONTHLY_PLAN_ID, name: "Extreme", tier: "extreme", amount: EXTREME_MONTHLY, cadence: "month",
  label: extremeMonthlyLabel, button: `Go Extreme, ${extremeMonthlyLabel}`, payLink: EXTREME_MONTHLY_PAY_LINK,
});

export const EXTREME_YEARLY_PLAN = publishedPlan({
  id: EXTREME_YEARLY_PLAN_ID, name: "Extreme yearly", tier: "extreme", amount: EXTREME_YEARLY, cadence: "year",
  label: extremeYearlyLabel, button: `Extreme yearly, ${extremeYearlyLabel}`, payLink: EXTREME_YEARLY_PAY_LINK,
});

// Developer carries the Extreme limits in this app. Its price is its own.
export const DEVELOPER_MONTHLY_PLAN = publishedPlan({
  id: DEVELOPER_MONTHLY_PLAN_ID, name: "Developer", tier: "extreme", amount: DEVELOPER_MONTHLY, cadence: "month",
  label: developerMonthlyLabel, button: `Go Developer, ${developerMonthlyLabel}`, payLink: DEVELOPER_MONTHLY_PAY_LINK,
});

export const DEVELOPER_YEARLY_PLAN = publishedPlan({
  id: DEVELOPER_YEARLY_PLAN_ID, name: "Developer yearly", tier: "extreme", amount: DEVELOPER_YEARLY, cadence: "year",
  label: developerYearlyLabel, button: `Developer yearly, ${developerYearlyLabel}`, payLink: DEVELOPER_YEARLY_PAY_LINK,
});

// sold null means this install has no seat count, so no number is shown.
export function founderQuote(sold, opts = {}) {
  const hiddenUntil = Number.isFinite(opts.spotsHiddenUntil) ? opts.spotsHiddenUntil : FOUNDER_SPOTS_HIDDEN_UNTIL;
  const base = {
    earlyPrice: LIFETIME_EARLY_PRICE,
    laterPrice: LIFETIME_LATER_PRICE,
    earlySeats: LIFETIME_EARLY_SEATS,
    cap: LIFETIME_CAP,
    tier: LIFETIME_TIER,
    spotsHiddenUntil: hiddenUntil,
    rule: LIFETIME_RULE,
  };
  const missing = sold == null || sold === "";
  const raw = missing ? NaN : Number(sold);
  if (missing || !Number.isFinite(raw) || raw < 0) {
    return {
      ...base,
      sold: null, open: true, price: null, stage: "unknown",
      remaining: null, earlyRemaining: null, spotsLeft: null, showSpots: false,
      label: `$${LIFETIME_EARLY_PRICE} for the first ${LIFETIME_EARLY_SEATS}, then $${LIFETIME_LATER_PRICE}`,
      spotsLine: FOUNDER_LIMITED_LINE,
    };
  }
  const n = Math.floor(raw);
  if (n >= LIFETIME_CAP) {
    return {
      ...base,
      sold: n, open: false, price: null, stage: "closed",
      remaining: 0, earlyRemaining: 0, spotsLeft: 0, showSpots: false,
      label: "Sold out", spotsLine: "Sold out",
    };
  }
  if (n < LIFETIME_EARLY_SEATS) {
    const earlyRemaining = LIFETIME_EARLY_SEATS - n;
    const showSpots = n >= hiddenUntil;
    return {
      ...base,
      sold: n, open: true, price: LIFETIME_EARLY_PRICE, stage: "early",
      remaining: LIFETIME_CAP - n, earlyRemaining,
      spotsLeft: showSpots ? earlyRemaining : null,
      showSpots,
      label: `$${LIFETIME_EARLY_PRICE}`,
      spotsLine: showSpots ? spotsLeftPhrase(earlyRemaining, { ofFounders: true }) : FOUNDER_LIMITED_LINE,
    };
  }
  const remaining = LIFETIME_CAP - n;
  return {
    ...base,
    sold: n, open: true, price: LIFETIME_LATER_PRICE, stage: "standard",
    remaining, earlyRemaining: 0, spotsLeft: remaining, showSpots: true,
    label: `$${LIFETIME_LATER_PRICE}`,
    spotsLine: spotsLeftPhrase(remaining),
  };
}

function lifetimeButton(life) {
  if (life.open === false) return "Lifetime founder is sold out";
  if (life.price) return `Lifetime founder, $${life.price}`;
  return `Lifetime founder, $${LIFETIME_EARLY_PRICE} then $${LIFETIME_LATER_PRICE}`;
}

function lifetimePayLink(life) {
  if (life.open === false || life.stage === "standard") return null;
  return LIFETIME_PAY_LINK;
}

// email is the signed-in address, when there is one. Every pay link then carries ?prefilled_email=
// so the buyer lands on the email the app unlocks by. The email is only put in the link.
export function proPlanCatalog(sold = null, { email = null } = {}) {
  const life = founderQuote(sold);
  const lifeLink = lifetimePayLink(life);
  const withMail = (plan) => ({ ...plan, payLink: plan.payLink ? payLinkWithEmail(plan.payLink, email) : plan.payLink });
  return {
    monthly: withMail(MONTHLY_PLAN),
    yearly: withMail(YEARLY_PLAN),
    extremeMonthly: withMail(EXTREME_MONTHLY_PLAN),
    extremeYearly: withMail(EXTREME_YEARLY_PLAN),
    developerMonthly: withMail(DEVELOPER_MONTHLY_PLAN),
    developerYearly: withMail(DEVELOPER_YEARLY_PLAN),
    lifetime: {
      id: LIFETIME_PLAN_ID,
      name: "Lifetime founder",
      kind: "one_time",
      button: lifetimeButton(life),
      ...life,
      payLink: lifeLink ? payLinkWithEmail(lifeLink, email) : lifeLink,
      pendingLink: !lifeLink && life.open !== false,
    },
    compare: publicCompare(),
    priceSet: PRICE_SET,
    charged: false,
  };
}

function planKey(planId) {
  if (planId === "monthly" || planId === "pro-monthly" || planId === PRO_MONTHLY_PLAN_ID) return "monthly";
  if (planId === "yearly" || planId === "pro-yearly" || planId === PRO_YEARLY_PLAN_ID) return "yearly";
  if (planId === "extreme" || planId === "extreme-monthly" || planId === EXTREME_MONTHLY_PLAN_ID) return "extremeMonthly";
  if (planId === "extreme-yearly" || planId === EXTREME_YEARLY_PLAN_ID) return "extremeYearly";
  if (planId === "developer" || planId === "developer-monthly" || planId === DEVELOPER_MONTHLY_PLAN_ID) return "developerMonthly";
  if (planId === "developer-yearly" || planId === DEVELOPER_YEARLY_PLAN_ID) return "developerYearly";
  if (planId === "lifetime" || planId === LIFETIME_PLAN_ID) return "lifetime";
  return null;
}

// Test stand-in for a Stripe checkout. It records the plan and returns it.
// It does not charge and it does not use the network. client.checkout is optional.
export function mockStripeCheckout(planId, { sold = null, client, email = null } = {}) {
  const plans = proPlanCatalog(sold, { email });
  const key = planKey(planId);
  if (!key) {
    const e = new Error("Unknown plan.");
    e.status = 400;
    throw e;
  }
  const plan = plans[key];
  const record = {
    planId: plan.id,
    amount: plan.amount ?? plan.price ?? null,
    url: plan.payLink || null,
    charged: false,
    mocked: true,
    open: plan.open !== false,
  };
  if (client && typeof client.checkout === "function") client.checkout(record);
  return record;
}
