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

## Tiers

| Tier | Price | Included |
|---|---|---|
| Free | $0 | Bring your own keys. Single mode (best AI for the job), status strip with health lights, 1 project, Credits ledger, 3 councils per month. No missions, no scheduler. |
| Pro | $15.99 / month | Everything in Free plus: **Mission mode** (plan → assign → QA → assemble), unlimited **Council**, the **off-peak scheduler** and discount rules, balance-aware routing, unlimited projects and link hubs, **Subscriptions tracker** with burn rate and runway, learned "who's best at what" router, update channel, priority support. |
| Studio (later) | $49–79 / month | Shared projects, team view, client workspaces. |

The free tier is deliberately the "feel the routing" tier; the Credits tab shows what the councils and missions would have saved, which is the upsell.

## Owner and friends: no charge

The app does not check licences yet; a copy you run from this folder is simply yours. When licensing ships (product-brief step 8) it will be a licence key checked against a small list on the website, and the owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items → Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do

- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook → generate key → email), and the check in the app.
- Rename the Square location if desired; add a receipt message and refund policy text in Square → Subscriptions settings.
