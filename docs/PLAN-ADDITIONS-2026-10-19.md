# Plan additions (approved by Chris, 2026-10-19)

These items add to `docs/BUILD-PLAN.md` and `docs/roadmap.md`. They are kept in a separate file so this change does not collide with sessions that are editing those files. Fold them in when those sessions finish.

## 1. Yearly and lifetime price options next to Pro

- Keep Pro at $15.99/mo. Add a yearly option and/or a lifetime option on the same pricing screen.
- Suggested starting points (placeholders until Chris sets final numbers): yearly at about two months free (around $159/yr); lifetime as a capped founder offer (for example the first 500 buyers) at roughly 2.5 to 3 years of Pro.
- Billing: yearly is a second recurring price on the same Pro product; lifetime is a one-time payment that grants the Pro entitlement with no expiry. Both map to the same `pro` tier in the app, so feature gates do not change.
- Lifetime covers the app itself, not model usage. Users still bring their own keys or credits; say this plainly at checkout.
- Done looks like: pricing page shows monthly, yearly and lifetime; checkout works for each in test mode; the account page shows plan, renewal date (or "lifetime"), and a cancel or manage link; refunds and upgrades from monthly to yearly or lifetime are prorated or credited.

## 2. MCP by URL and webhooks move earlier

- Raise "MCP by URL" (remote Streamable HTTP / SSE servers added by pasting a URL, with OAuth or custom headers) and webhooks (outgoing on job events, incoming per-trigger secret URLs) ahead of the remaining competitor-review backlog.
- New order: right after the current high-priority core work (Smart fallback, Learning router, Live project view), and before Phases 17 to 24.
- Scope pulled forward: from Phase 16, the remote MCP by URL path (local stdio can follow); from Phase 22, the webhook trigger and the outgoing event webhook (cron and watched folders can follow).
- Rules unchanged: secrets in the vault, never logged, nothing posts or sends without an explicit click or an approved trigger, tests use local mock servers only.

## 3. Money saved tracker

- An always-visible "Money saved" figure in the app: what the council and router actually spent compared with sending the same work to a single top model.
- Per run: actual cost, the baseline cost (same input and output tokens priced at the chosen reference model), and the difference. Totals by day, month and all time, per project and per provider.
- The reference model is a setting (default: the most expensive flagship the user has a key for), and the price table is dated so old totals stay correct after price changes.
- Builds on the Savings receipt (roadmap item 7) and the Credits tab; one-click PNG export for sharing.
- Show the method next to the number ("estimated, based on token counts and list prices") so it is never presented as an exact invoice figure.
- Done looks like: every completed run stores actual and baseline cost; the header shows the running total; the Credits tab shows the breakdown; a test with fixed token counts produces the expected savings.

## 4. Relay mode is on hold

- "Relay mode" (when API credits run out, hand the conversation to the user's own signed-in ChatGPT, Claude, Gemini or Grok web chat) is ON HOLD pending a terms review. Do not build automated driving or reading of those web chats.
- See `docs/relay-terms-review-2026-10-19.md` for the findings and the compliant design that is allowed to go ahead once Chris approves it.
