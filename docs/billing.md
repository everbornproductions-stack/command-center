# Billing (Square)

Set up 2026-10-18 in Chris's Square account. Updated 2026-10-21 for the new prices. The app does not call Square and does not charge a card.

| | |
|---|---|
| Existing plan | **Everborn Command Pro** (Square Subscriptions, Plans), status Active. Leave this plan at $15.99. People who already subscribed keep that price. Plan id in the app: `pro-monthly-1599`. |
| Existing pay link | **https://square.link/u/dbU38mQC** |
| Existing item | "Everborn Command Pro", $15.99, item type Other. Do not edit this price. A new Pro monthly plan is required for $18.99. |
| Buy button | The app does not point the $18.99 button at the old link. That link still charges $15.99. |
| Location on the link | "MGM Grand Las Vegas" (the only location on the account; rename it in Square, Account and Settings, Locations if it should read Everborn Productions) |

Square handles the card vault, retries, receipts, cancellations and the customer's subscription portal. Manage subscribers at Square Dashboard, Subscriptions.

Prices in the app come from `server/price-config.js`. Yearly and lifetime are not derived from monthly. Changing `PRICE_SET` from `current` to `next` is the planned monthly raise (Pro $24.99, Extreme $39.99) and does not change yearly or lifetime.

## Pro monthly (new)

| | |
|---|---|
| Plan id | `pro-monthly-1899` |
| Price | $18.99 a month |
| Checkout | Not published. The app shows "Go Pro, $18.99/month". Nothing is charged from the app. |

## Pro yearly

| | |
|---|---|
| Plan id | `pro-yearly-189` |
| Price | $189 a year (was $159; that checkout was never published) |
| Checkout | Not published. The app shows "Pro yearly, $189/year". Nothing is charged from the app. |

## Extreme monthly

| | |
|---|---|
| Plan id | `extreme-monthly-2999` |
| Price | $29.99 a month |
| Checkout | Not published. The app shows "Go Extreme, $29.99/month". Nothing is charged from the app. |

## Extreme yearly

| | |
|---|---|
| Plan id | `extreme-yearly-299` |
| Price | $299 a year |
| Checkout | Not published. The app shows "Extreme yearly, $299/year". Nothing is charged from the app. |

## Lifetime founder

Lifetime is Pro for life. It is not Extreme.

| | |
|---|---|
| Plan id | `founder-lifetime` |
| Early price | $299 for the first 100 |
| Later price | $499 for the next 400 |
| Cap | Closed after 500 total |
| Spots left | Hidden until 40 founders have bought (`FOUNDER_SPOTS_HIDDEN_UNTIL`, default 40). Before that the app says "Limited to the first 100 founders". After that it shows the spots left. |
| Checkout | Not published. Nothing is charged from the app. |

## Tiers

| Tier | Price | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), the learning router (picks stay on this computer), status strip with health lights, 3 projects, Credits ledger, 5 councils per month, 1 connected service, 1 email account per provider. No missions, no scheduler, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $18.99 / month, or $189 / year, or lifetime founder ($299 for the first 100, then $499, closed after 500). Existing subscribers stay at $15.99 / month. | Everything in Free plus: every connected service, up to 8 email accounts per provider, Mission mode (plan, assign, QA, assemble), unlimited Council (4 AIs per council, 3 runs at once), the off-peak scheduler and discount rules, balance-aware routing, unlimited projects and link hubs, Subscriptions tracker with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support, 1 industry pack, Deep Research 8 times a month, 3 desktop control apps, 5 recipes. |
| Extreme | $29.99 / month, or $299 / year | Everything in Pro plus: 8 AIs per council, 8 runs at once, unlimited Deep Research, all industry packs, a compliance audit log, team spaces with 3 seats, unlimited desktop control apps and recipes, hosted background runs and hosted schedules (gated, not a screen yet), and a monthly budget cap. |
| Studio (later) | $49 to $79 / month | Shared projects, team view, client workspaces. The Studio workspace screen is unchanged. |

The free tier is deliberately the "feel the routing" tier; the Credits tab shows what the councils and missions would have saved, which is the upsell. The learning router stays on Free. Shared learning and the scores dashboard are Pro.

## Owner and friends: no charge

The app checks a licence key. With no active key the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Square call). The owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items, Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do (Chris, in Square, not in this repo)

- Create the plan ids above. Do not change the live $15.99 plan or its pay link.
- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook, generate key, email), and the check in the app. Store `plan` on the licence when the key is issued (`pro-monthly-1599` for the old price, `founder-lifetime` for lifetime, `pro-monthly-1899` or `extreme-monthly-2999` for the new plans).
- Run `supabase/migrations/20261021_extreme_tier.sql` in the SQL editor before issuing an Extreme key. The app does not run it.
- Rename the Square location if desired; add a receipt message and refund policy text in Square, Subscriptions settings.

When the monthly raise ships, set `PRICE_SET` to `next` and create `pro-monthly-2499` ($24.99) and `extreme-monthly-3999` ($39.99). Yearly and lifetime stay as they are.
