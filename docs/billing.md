# Billing (Square)

Set up 2026-10-18 in Chris's Square account.

| | |
|---|---|
| Plan | **Everborn Command Pro** (Square Subscriptions → Plans), status Active |
| Frequency | Monthly, billed from the subscription start date, never ends, no discount |
| Item | "Everborn Command Pro", $15.99, item type Other (catalog item the plan prices from) |
| Pay link (recurring, automatic card billing) | **https://square.link/u/dbU38mQC** |
| Buy button embed | `https://square.link/u/dbU38mQC?src=embed` |
| Location on the link | "MGM Grand Las Vegas" (the only location on the account; rename it in Square → Account & Settings → Locations if it should read Everborn Productions) |

Square handles the card vault, retries, receipts, cancellations and the customer's subscription portal. Manage subscribers at Square Dashboard → Subscriptions.

The monthly checkout above is unchanged. The app does not call Square and does not charge a card. Two more Pro choices were added on 2026-10-20 (Phase 35). Their Square links are not published yet, so the app shows the price and the button does not open a checkout.

## What the app shows today (Phase 35, shipped)

| | |
|---|---|
| Pro yearly in the app | $159 a year. The button does not open a checkout. |
| Lifetime in the app | $299 for the first 100, then $499, capped at 500. The button does not open a checkout. |
| Monthly | $15.99 on https://square.link/u/dbU38mQC |

Phase 91 replaces these display prices. Until that phase is built, the app keeps the figures in this section. Do not change the live Square link until Chris publishes new plans in Square.

## Plan prices (Chris, 2026-10-21, Phase 91, not in the app yet)

Three public tiers. Nothing below is charged from the app.

| Tier | Price now | About 6 months later |
|---|---|---|
| Free | $0 | $0 |
| Pro | $18.99 a month, or $189 a year | Monthly rises to $24.99. Yearly stays $189 until Chris sets a yearly change. |
| Extreme | $29.99 a month, or $299 a year | Monthly rises to $39.99. Yearly stays $299 until Chris sets a yearly change. |

There is no fourth public price. The Studio flag for workspaces stays in the app (Phase 8). This plan does not rebuild teams and does not assign workspaces to Extreme until Chris says so.

### Lifetime founder

| | |
|---|---|
| Deal | One payment, for the life of the product |
| First 100 buyers | $299 for the first 100 |
| Next 400 buyers | $499 (buyers 101 through 500) |
| Close | Closed at 500. The offer does not reopen. |
| Counter | Hidden while fewer than 40 people have bought. From 40 buyers on, the page may show how many seats are left. |
| Checkout | Not published. Nothing is charged from the app. |

## Tiers (limits that already ship)

The limits below are in the app today. Phase 91 changes the prices, not these Free and Pro limits, until Chris says a limit moves.

| Tier | Price the app shows today | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), the learning router (picks stay on this computer), status strip with health lights, 3 projects, Credits ledger, 5 councils per month, 1 connected service, 1 email account per provider. No missions, no scheduler, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $15.99 / month, or $159 / year, or lifetime founder ($299 for the first 100, then $499, capped at 500). The plan price, not yet shown in the app, is $18.99 / month or $189 / year. | Everything in Free plus: every connected service, up to 8 email accounts per provider, **Mission mode** (plan, assign, QA, assemble), unlimited **Council**, the **off-peak scheduler** and discount rules, balance-aware routing, unlimited projects and link hubs, **Subscriptions tracker** with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support. The monthly Square checkout is the live pay link above. Yearly and lifetime are the same Pro once a licence is active. |
| Extreme | Plan price $29.99 / month or $299 / year. Not in the app yet. | The tier above Pro. What it adds beyond Pro is set when Phase 91 is built. |

The free tier is deliberately the "feel the routing" tier. The Credits tab shows what the councils and missions would have saved, which is the upsell. The learning router stays on Free. Shared learning and the scores dashboard are Pro.

## Owner and friends: no charge

The app checks a licence key. With no active key the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Square call). The owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items → Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do

- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook → generate key → email), and the check in the app.
- Rename the Square location if desired; add a receipt message and refund policy text in Square → Subscriptions settings.
- Chris creates Square plans when a checkout should go live. The app does not create them and does not call Square. Until a public pay link is added, that button does not charge.
- When Chris is ready for the plan prices: Pro yearly at $189 a year, Extreme at $29.99 a month or $299 a year, and the lifetime founder item ($299 for the first 100, then $499, closed at 500, counter hidden under 40 buyers). The monthly Pro plan in Square is $15.99 today. The plan price is $18.99 a month. Chris changes Square. The app does not.
- About 6 months after those prices go live, Pro monthly becomes $24.99 and Extreme monthly becomes $39.99. Yearly stays $189 and $299 until Chris sets a yearly change.
