// Pro checkout choices. The monthly Square link is the one already live.
// This module never calls Square, never opens a network connection, and never charges.
// Yearly and lifetime prices are shown here. Their Square links are not published yet.

export const MONTHLY_LINK = "https://square.link/u/dbU38mQC";
export const MONTHLY_AMOUNT = 15.99;
export const YEARLY_AMOUNT = 159;
export const FOUNDER_EARLY_PRICE = 299;
export const FOUNDER_LATER_PRICE = 499;
export const FOUNDER_EARLY_SEATS = 100;
export const FOUNDER_CAP = 500;

export const MONTHLY_PLAN = {
  id: "pro-monthly",
  name: "Pro",
  amount: MONTHLY_AMOUNT,
  cadence: "month",
  label: "$15.99/month",
  button: "Go Pro, $15.99/month",
  payLink: MONTHLY_LINK,
};

export const YEARLY_PLAN = {
  id: "pro-yearly",
  name: "Pro yearly",
  amount: YEARLY_AMOUNT,
  cadence: "year",
  label: "$159/year",
  button: "Pro yearly, $159/year",
  payLink: null,
  pendingLink: true,
};

// sold null means this install has no seat count, so the price rule is shown and no price is picked.
export function founderQuote(sold) {
  const missing = sold == null || sold === "";
  const raw = missing ? NaN : Number(sold);
  if (missing || !Number.isFinite(raw) || raw < 0) {
    return {
      sold: null,
      open: true,
      price: null,
      stage: "unknown",
      remaining: null,
      earlyRemaining: null,
      label: "$299 for the first 100, then $499",
    };
  }
  const n = Math.floor(raw);
  if (n >= FOUNDER_CAP) {
    return { sold: n, open: false, price: null, stage: "closed", remaining: 0, earlyRemaining: 0, label: "Sold out" };
  }
  if (n < FOUNDER_EARLY_SEATS) {
    return {
      sold: n,
      open: true,
      price: FOUNDER_EARLY_PRICE,
      stage: "early",
      remaining: FOUNDER_CAP - n,
      earlyRemaining: FOUNDER_EARLY_SEATS - n,
      label: "$299",
    };
  }
  return {
    sold: n,
    open: true,
    price: FOUNDER_LATER_PRICE,
    stage: "standard",
    remaining: FOUNDER_CAP - n,
    earlyRemaining: 0,
    label: "$499",
  };
}

export function proPlanCatalog(sold = null) {
  const life = founderQuote(sold);
  return {
    monthly: { ...MONTHLY_PLAN },
    yearly: { ...YEARLY_PLAN },
    lifetime: {
      id: "founder-lifetime",
      name: "Lifetime founder",
      kind: "one_time",
      earlyPrice: FOUNDER_EARLY_PRICE,
      laterPrice: FOUNDER_LATER_PRICE,
      earlySeats: FOUNDER_EARLY_SEATS,
      cap: FOUNDER_CAP,
      payLink: null,
      pendingLink: life.open,
      ...life,
    },
    charged: false,
  };
}

// Test stand-in for a Square checkout call. It records the plan and returns it.
// It does not charge and it does not use the network. client.checkout is optional.
export function mockSquareCheckout(planId, { sold = null, client } = {}) {
  const plans = proPlanCatalog(sold);
  const key = planId === "monthly" || planId === "pro-monthly" ? "monthly"
    : planId === "yearly" || planId === "pro-yearly" ? "yearly"
    : planId === "lifetime" || planId === "founder-lifetime" ? "lifetime"
    : null;
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
