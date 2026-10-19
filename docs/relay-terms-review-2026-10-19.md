# Relay mode: provider terms review (2026-10-19)

Question: when a user's API credits run out, may Meldmind pass the conversation to the user's own signed-in consumer chat (ChatGPT, Claude.ai, Gemini, Grok) and bring the reply back? Not legal advice; re-check before shipping.

## Summary

| Approach | OpenAI | Anthropic | Google | xAI |
|---|---|---|---|---|
| App drives or scrapes the web chat (headless browser, injected scripts, reading session cookies) | Prohibited | Prohibited | Prohibited / high risk | Prohibited |
| Manual handoff: app copies a prompt to the clipboard and opens the chat page; the user pastes, reads, and pastes the reply back | Allowed (user is using the service normally) | Allowed | Allowed | Allowed |
| Official subscription-linked access | Sign in with ChatGPT plan usage (approved apps only) | Not available to third-party apps | No consumer-plan route; use Gemini API free tier | No consumer-plan route; use the API |

## Key clauses

OpenAI Terms of Use (https://openai.com/policies/row-terms-of-use/): you may not "Automatically or programmatically extract data or Output", or "circumvent any rate limits or restrictions or bypass any protective measures". You "may not share your account credentials or make your account available to anyone else."

OpenAI Sign in with ChatGPT Terms (https://openai.com/policies/sign-in-with-chatgpt-terms/): the official route. Tokens only "through OpenAI's supported sign-in flow"; "Do not ask users for their ChatGPT passwords or session cookies"; token storage "must be local and under the user's control"; "Use the user's plan only for the application they connected"; and "No charge. Users must be able to use their ChatGPT plan through SIWC without paying you or upgrading to a paid version of your application." Commercial apps are a limited trial (https://developers.openai.com/siwc/quickstart.md); help article: https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites

Anthropic Consumer Terms, section 3 (https://www.anthropic.com/legal/consumer-terms): no use "To crawl, scrape, or otherwise harvest data or information from our Services", and "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."

Claude Code legal page (https://code.claude.com/docs/en/legal-and-compliance): "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens." A user may still run the unmodified Claude Code binary with their own subscription.

Google Terms of Service (https://policies.google.com/terms): must not use "automated means to access content from any of our services in violation of the machine-readable instructions on our web pages", nor bypass "our systems or protective measures"; accounts can be suspended for "scraping content that doesn't belong to you". Generative AI Prohibited Use Policy: https://policies.google.com/terms/generative-ai/use-policy

Gemini API free tier (https://ai.google.dev/gemini-api/terms): an official free fallback, but on unpaid quota Google "uses the content you submit ... to provide, improve, and develop Google products" and "human reviewers may read" it. Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits

xAI Acceptable Use Policy (https://x.ai/legal/acceptable-use-policy): prohibits "using bots to access", "Scraping, harvesting or reselling any Input or Output", "circumventing any rate limits", and "Accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise." Consumer terms: https://x.ai/legal/terms-of-service

OpenRouter free models (https://openrouter.ai/docs/api_reference/limits): `:free` variants are 20 requests/minute and 50/day (1,000/day after $10 of credits purchased).

## Clearly allowed
- Manual, user-driven handoff where the user does the typing, pasting and sending in the official page or app.
- Official APIs with the user's own keys, Gemini API free tier, OpenRouter free models.
- Sign in with ChatGPT plan usage, only after OpenAI approves the app, and only under the no-charge rule.

## Gray
- Opening the chat page with the prompt prefilled in the URL. Fine as a convenience link if the user still presses send, but undocumented; prefer the clipboard.
- Reading the reply back automatically from the clipboard. Acceptable only when the user explicitly copies and confirms, never by watching the page.
- Sign in with ChatGPT inside a paid Meldmind tier: the no-charge rule means plan usage cannot sit behind Pro.

## Prohibited
- Any automation of the consumer web UIs (browser automation, DOM reading, injected scripts, background tabs).
- Collecting, storing or reusing consumer session cookies or tokens, or any OAuth token from Claude Free/Pro/Max.
- Offering "use your Claude subscription in Meldmind".

## Recommended compliant design ("Hand off" mode)

Status: APPROVED by Chris on 2026-10-19 as part of Phase 26. The build spec is section 4 of `docs/PLAN-ADDITIONS-2026-10-19.md`; Sign in with ChatGPT is not pursued now.

1. When credits run out, first offer official fallbacks: a cheaper model on the user's other keys, Gemini API free tier (with the data-use notice), OpenRouter free models, and later Sign in with ChatGPT if approved.
2. Otherwise offer "Continue in ChatGPT / Claude / Gemini / Grok": Meldmind builds a compact handoff prompt (summary plus the last turns, with a size meter), copies it to the clipboard, and opens the provider's normal chat page in the user's default browser.
3. The user pastes, sends and reads in the official page, then copies the reply with the site's copy button. A "Grab reply" button reads the clipboard only on that click; the reply is saved to the thread tagged "via ChatGPT web (manual)".
4. No browser control, no page reading, no cookie access, no hidden windows. Label the feature as a manual handoff, and never imply provider affiliation.
5. Counts for the Money saved tracker as $0 API cost, marked "manual".
