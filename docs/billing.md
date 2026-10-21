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
| Free | $0 | Bring your own keys. Try it now (demo mode). Simple mode. The learning router (picks stay on this computer). Safety checks (risky-word warnings, masking preview, and the security page, when those screens land). Backup and restore, and Double-check this, when they land. 3 projects. 5 councils a month. 1 connected service. 1 email account per provider. No missions. No schedules and no Do this again repeats. No desktop control or program scan. No industry packs. No public share links. No PDF or Word export. No background runs and no pause missions. No shared learning. No scores dashboard. No phone pairing. No full history search. A 14-day Pro trial can be started in the app. The trial is not started for you, and nothing is charged. |
| Pro | $15.99 / month, or $159 / year, or lifetime founder ($299 for the first 100, then $499, capped at 500) | Everything in Free plus: desktop control and program scan, missions, unlimited councils, schedules and Do this again repeats, industry packs, public share links, PDF and Word export, background runs and pause missions (a row marked "when they land" in the app table is not a separate checkout; it unlocks with Pro when that screen ships), every connected service, up to 8 email accounts per provider, the off-peak scheduler, unlimited projects, the Subscriptions tracker, shared learning, the scores dashboard, phone pairing, and full history search. The monthly Square checkout is the live pay link above. Yearly and lifetime are the same Pro once a licence is active. |
| Studio (later) | $49–79 / month | Shared projects, team view, client workspaces. |

The free tier is deliberately the "feel the routing" tier. The learning router stays on Free. Shared learning and the scores dashboard are Pro. The same split is in the app as a Free vs Pro table, and a free person who opens a Pro feature sees that table. The list lives in server/feature-gate.js. A later feature registers there and calls guard with its id. Some rows (desktop control, program scan, industry packs, PDF and Word export, background runs, pause missions, safety screens, backup and restore, Double-check this, Do this again) are approved and gated now, and the screen itself lands in a later change.

## Owner and friends: no charge

The app checks a licence key. With no active key the copy stays on Free. A 14-day Pro trial can be started from the app (placeholder trial credits, nothing charged, no Square call). The owner key is issued by hand. Two ways to give free access in Square if you want them to go through the same door: create a 100% discount in Square (Items → Discounts) and attach it to a second plan frequency, or use "Create subscription" on the plan and set the price override to $0 for that customer. Either way the app's licence check is what actually unlocks Pro, not Square.

## Still to do

- A landing page with the pay link and the download (everbornproductions.com/command-center).
- Licence key issue on successful Square payment (Square webhook → generate key → email), and the check in the app.
- Rename the Square location if desired; add a receipt message and refund policy text in Square → Subscriptions settings.
- Chris creates the yearly plan ($159 a year) and the lifetime founder item in Square when those checkouts should go live. The app does not create them and does not call Square. Until the public pay links are added, those buttons do not charge.
