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

## 4. Relay mode: APPROVED (part of Phase 26, Smart fallback)

Chris approved relay mode on 2026-10-19 as a compliant two-click manual handoff. Terms findings are in `docs/relay-terms-review-2026-10-19.md`.

Flow when API credits run out:
1. Official free fallbacks first: Gemini API free tier (show a data-use notice: on unpaid quota Google may use prompts and replies to improve its products, and human reviewers may read them), OpenRouter `:free` models, or a cheaper model on another key the user already has.
2. If the user still wants a specific assistant, show "Continue in ChatGPT / Claude / Gemini / Grok". Click 1 copies a compact handoff prompt (summary plus recent turns, with a size meter) to the clipboard and opens that provider's normal chat page in the user's default browser.
3. The user pastes and sends in the provider's page, then copies the reply with the site's own copy button.
4. Click 2, "Grab reply", reads the clipboard only at that moment, shows a preview, and saves the reply to the thread tagged "manual" (for example "via ChatGPT web, manual"). It counts as $0 API cost in the Money saved tracker, marked manual.

Hard rules:
- Never automate, inject into, read, or scrape the provider page. No browser control, no DOM access, no extensions for this.
- No cookies, session tokens, or consumer OAuth tokens are read, stored, or used.
- No hidden or background windows; the page opens in the user's normal default browser.
- The clipboard is read only on the "Grab reply" click, never polled or watched.
- No endorsement or affiliation claims; label the feature as a manual handoff.
- Sign in with ChatGPT plan usage is not pursued now.

Done looks like: with credits at zero, the fallback picker appears; free fallbacks work with the notice shown; "Continue in ..." copies the prompt and opens the right URL; "Grab reply" saves the clipboard text tagged manual; a test confirms the clipboard is untouched until the click.
