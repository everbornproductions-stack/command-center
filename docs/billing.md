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

The live $15.99 checkout above is unchanged. The app does not call Square and does not charge a card.

Prices in the app come from `server/price-config.js`. Yearly and lifetime are not derived from monthly. Changing `PRICE_SET` from `current` to `next` is the planned monthly raise (Pro $24.99, Extreme $39.99) and does not change yearly or lifetime.

## Pro monthly (new)

| | |
|---|---|
| Plan id | `pro-monthly-1899` |
| Price | $18.99 a month |
| Checkout | https://square.link/u/UrcjlAqi . A click opens that Square pay page. This app does not call Square. |

## Pro yearly

| | |
|---|---|
| Plan id | `pro-yearly-189` |
| Price | $189 a year (the unpublished $159 figure is retired) |
| Checkout | https://square.link/u/8JlyJzxb . A click opens that Square pay page. This app does not call Square. |

## Extreme monthly

| | |
|---|---|
| Plan id | `extreme-monthly-2999` |
| Price | $29.99 a month |
| Checkout | https://square.link/u/u5FdCONv . A click opens that Square pay page. This app does not call Square. |

## Extreme yearly

| | |
|---|---|
| Plan id | `extreme-yearly-299` |
| Price | $299 a year |
| Checkout | https://square.link/u/LxwtyrCy . A click opens that Square pay page. Extreme yearly stays $299. This app does not call Square. |

## Lifetime founder

Lifetime is Pro for life. It is not Extreme.

| | |
|---|---|
| Plan id | `founder-lifetime` |
| Early price | $349 for the first 100 |
| Later price | $499 for the next 400 |
| Cap | Closed after 500 total |
| Spots left | Hidden until 40 founders have bought (`FOUNDER_SPOTS_HIDDEN_UNTIL`, default 40). Before that the app says "Limited to the first 100 founders". After that it shows the spots left. |
| Checkout | https://square.link/u/nKrsGaj2 for the $349 price. A click opens that Square pay page. This app does not call Square. The later $499 price does not use this link, so that button stays on the page. |

Three public tiers. Nothing below is charged from the app.

| Tier | Price | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), the learning router (picks stay on this computer), status strip with health lights, 3 projects, Credits ledger, 5 councils per month, 1 connected service, 1 email account per provider. No missions, no scheduler, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $18.99 / month, or $189 / year, or lifetime founder ($349 for the first 100, then $499, closed after 500). Existing subscribers stay at $15.99 / month. About 6 months later, monthly rises to $24.99. Yearly stays $189 until Chris sets a yearly change. | Everything in Free plus: every connected service, up to 8 email accounts per provider, Mission mode (plan, assign, QA, assemble), unlimited Council (4 AIs per council, 3 runs at once), the off-peak scheduler and discount rules, balance-aware routing, unlimited projects and link hubs, Subscriptions tracker with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support, 1 industry pack, Deep Research 8 times a month, 3 desktop control apps, 5 recipes. A Studio licence is treated as Pro. There is no separate Studio price. |
| Extreme | $29.99 / month, or $299 / year. About 6 months later, monthly rises to $39.99. Yearly stays $299 until Chris sets a yearly change. | Everything in Pro plus: 8 AIs per council, 8 runs at once, unlimited Deep Research, all industry packs, a compliance audit log, early access (new features reach Extreme first, behind a flag), Max quality (the best model each connected AI offers, with more reasoning and a longer context, inside the budget cap), team spaces for 5 people total, counting the owner (the owner plus 4 invited), unlimited desktop control apps and recipes, hosted background runs and hosted schedules (gated, not a screen yet), and a monthly budget cap. |
| Owner | No charge. Issued by hand. | The same limits as Extreme. |

There is no fourth public price. The Studio flag for workspaces stays in the app (Phase 8). This plan does not rebuild teams and does not assign workspaces to Extreme until Chris says so.

## Tiers (limits that already ship)

The limits below are in the app today. Prices come from server/price-config.js. The live $15.99 Square plan is the grandfather price, not the new Pro button.

| Tier | Price the app shows today | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Try it now (demo mode). Simple mode (best AI for the job). The learning router (picks stay on this computer). Status strip with health lights. Safety checks (risky-word warnings, masking preview, and the security page, when those screens land). Backup and restore, and Double-check this, when they land. 3 projects. Credits ledger. 5 councils a month. 1 connected service. 1 email account per provider. No missions. No schedules and no Do this again repeats. No desktop control or program scan. No industry packs. No public share links. No PDF or Word export. No background runs and no pause missions. No shared learning. No scores dashboard. No phone pairing. No full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $18.99 / month, or $189 / year, or lifetime founder ($349 for the first 100, then $499, closed after 500). People already paying stay at $15.99 / month on https://square.link/u/dbU38mQC. A Studio licence is treated as Pro. There is no separate Studio price. | Everything in Free plus: desktop control and program scan, Mission mode (plan, assign, QA, assemble), unlimited Council, schedules and Do this again repeats, 1 industry pack, public share links, PDF and Word export, background runs and pause missions (a row marked "when they land" in the app table is not a separate checkout; it unlocks with Pro when that screen ships), every connected service, up to 8 email accounts per provider, the off-peak scheduler and discount rules, balance-aware routing, unlimited projects and link hubs, Subscriptions tracker with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support, Deep Research 8 times a month, 3 desktop control apps, 5 recipes. |
| Extreme | $29.99 / month or $299 / year. | Everything in Pro, plus 8 AIs per council, 8 runs at once, unlimited Deep Research, all industry packs, a compliance audit log, early access, Max quality, team spaces for 5 people total, counting the owner, unlimited desktop control apps and recipes, hosted background runs and hosted schedules (gated), and a monthly budget cap. |
| Owner | No charge. Issued by hand. | The same limits as Extreme. |

The free tier is deliberately the "feel the routing" tier. The Credits tab shows what the councils and missions would have saved, which is the upsell. The learning router stays on Free. Shared learning and the scores dashboard are Pro. The same split is in the app as a Free vs Pro table, and a free person who opens a Pro feature sees that table. The list lives in server/feature-gate.js. A later feature registers there and calls guard with its id. Some rows (desktop control, program scan, industry packs, PDF and Word export, background runs, pause missions, safety screens, backup and restore, Double-check this, Do this again) are approved and gated now, and the screen itself lands in a later change. Teams and workspaces stay as they shipped (Phase 8). A Studio flag is not a fourth public price.

## Owner and friends: no charge

The app checks a licence key. With no active key the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Square call). The owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items, Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do (Chris, in Square, not in this repo)

- Leave the live $15.99 plan and https://square.link/u/dbU38mQC alone. The $349 lifetime page is https://square.link/u/nKrsGaj2. Do not point founder lifetime at any older link.
- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook, generate key, email), and the check in the app. Store `plan` on the licence when the key is issued (`pro-monthly-1599` for the old price, `founder-lifetime` for lifetime, `pro-monthly-1899` or `extreme-monthly-2999` for the new plans).
- Run `supabase/migrations/20261021_extreme_tier.sql` in the SQL editor before issuing an Extreme key. The app does not run it.
- Rename the Square location if desired; add a receipt message and refund policy text in Square, Subscriptions settings.

When the monthly raise ships, set `PRICE_SET` to `next` and create `pro-monthly-2499` ($24.99) and `extreme-monthly-3999` ($39.99). Yearly and lifetime stay as they are.
