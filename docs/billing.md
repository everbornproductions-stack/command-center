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

The monthly checkout above is unchanged. The app does not call Square and does not charge a card. Two more Pro choices were added on 2026-10-20. Their Square links are not published yet, so the app shows the price and the button does not open a checkout.

## Pro yearly

| | |
|---|---|
| Plan | Pro yearly |
| Price | $159 a year |
| Checkout | Not published. The app shows "Pro yearly, $159/year". Nothing is charged from the app. |

## Lifetime founder

| | |
|---|---|
| Deal | One payment, Pro for the life of the product |
| Early price | $299 for the first 100 buyers |
| Later price | $499 after those 100 |
| Cap | 500 total. After 500 the offer is closed |
| Checkout | Not published. The app shows the price rule, and the current price when this install has a seat count. Nothing is charged from the app. |

## Tiers

| Tier | Price | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), the learning router (picks stay on this computer), status strip with health lights, 3 projects, Credits ledger, 5 councils per month, 1 connected service, 1 email account per provider. No missions, no scheduler, no shared learning, no scores dashboard, no phone pairing, no full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $15.99 / month, or $159 / year, or lifetime founder ($299 for the first 100, then $499, capped at 500) | Everything in Free plus: every connected service, up to 8 email accounts per provider, **Mission mode** (plan → assign → QA → assemble), unlimited **Council**, the **off-peak scheduler** and discount rules, balance-aware routing, unlimited projects and link hubs, **Subscriptions tracker** with burn rate and runway, shared learning, the scores dashboard (Who's best at what), phone pairing, full history search, update channel, priority support. The monthly Square checkout is the live pay link above. Yearly and lifetime are the same Pro once a licence is active. |
| Studio (later) | $49–79 / month | Shared projects, team view, client workspaces. |

The free tier is deliberately the "feel the routing" tier; the Credits tab shows what the councils and missions would have saved, which is the upsell. The learning router stays on Free. Shared learning and the scores dashboard are Pro.

## Owner and friends: no charge

The app checks a licence key. With no active key the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Square call). The owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items → Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do

- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook → generate key → email), and the check in the app.
- Rename the Square location if desired; add a receipt message and refund policy text in Square → Subscriptions settings.
- Chris creates the yearly plan ($159 a year) and the lifetime founder item in Square when those checkouts should go live. The app does not create them and does not call Square. Until the public pay links are added, those buttons do not charge.
