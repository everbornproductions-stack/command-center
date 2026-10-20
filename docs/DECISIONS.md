# Locked decisions: do not undo

Chris approved items 1 to 20 on 2026-10-18. They are shipped and in use, and they must not be reverted, renamed, reworked or "cleaned up" by any build phase, refactor or agent.

Items dated 2026-10-19 that say "not built yet" are locked specs. Do not build them until Chris adds them to the run order, and do not rewrite the spec. Do not change the meaning of items 1 to 20.

If a phase in docs/BUILD-PLAN.md seems to need a change to one of these items, do not make the change. Write `PHASE N BLOCKED: <reason, naming the decision>` in docs/BUILD-LOG.md and stop, so Chris can decide.

Tests guard most items (see `test/decisions.test.js` and the files named below). A change that breaks one of those tests is a change to a locked decision.

## Product and installer
1. **Name and tagline.**
   - The user-facing product name is **Meldmind**, with the tagline **"an Everborn product"** (by Everborn Productions) everywhere a user looks: window title, installer, tray, header and docs. Where a subtitle fits, also show **"Take command of all your AIs."**
   - The name is provisional, pending attorney trademark review before public launch (Cisco MINDMELD risk). The previous display name was Command AI.
   - The internal and repo names stay "Everborn Command Center" / `command-center`. The appId, the user-data folder, and the updater feed stay as in items 2 and 3, so existing installs keep their keys, settings and history and still auto-update.
   - No em-dashes in any user-facing text.
   - Tests: `test/update.test.js` (branding), `test/desktop-update.test.js`.
2. **appId and data folder never change.**
   - `appId: com.everborn.command` in electron-builder.yml.
   - `app.setName("Everborn Command")` in electron/main.cjs, so settings, keys and history stay in `%APPDATA%\Everborn Command\data` across updates and reinstalls.
   - NSIS `perMachine: false` and `deleteAppDataOnUninstall: false`.
3. **Updates.**
   - electron-updater uses the GitHub provider and reads the PUBLIC repo `everbornproductions-stack/command-center-releases`.
   - The source repo stays private, and no token is ever embedded in the app.
   - Artifact names use dashes, no spaces: `Meldmind-Setup-${version}.${ext}`. The feed file stays `latest.yml` in `everbornproductions-stack/command-center-releases`.
   - Releases follow docs/RELEASING.md: draft, upload, verify size, publish, then check that `latest.yml` shows the new version.
4. **Launch update prompt and main-process updater.**
   - The updater lives in the Electron main process (electron/updater.cjs). It never depends on the local server or the web UI.
   - On launch it checks for updates and shows "Meldmind vX.Y.Z is ready" with **Install now** (progress bar, then restart) and **Later**.
   - Nothing downloads before that click.
   - The tray has Check for updates, Install update and Restart app.
   - The engine watchdog (electron/watchdog.cjs) offers Restart app / Install update after about 15 s without an answer.
   - The local electron/offline.html page shows when the engine does not start.
   - So a broken build can always update itself.
5. **Single instance.**
   - `app.requestSingleInstanceLock()` is used, and a second launch focuses the open window.
   - Several "Meldmind.exe" processes for one copy (main, GPU, network, window) are normal. The Windows process name follows productName. The user-data folder name does not.
6. **The app always runs its own server.**
   - It starts its own local engine on the first free port from 4747 up.
   - It trusts only a server that echoes this launch's random instance id (`CC_INSTANCE`, `/api/health` → `instance`).
   - It never attaches to a foreign server on 4747, such as a developer copy from the repo. That was the v0.3.0 "fetch failed" bug.
   - Tests: `test/providers.test.js` (ports), `test/desktop-update.test.js`.
7. **Reload-loop guard.**
   - Every automatic reload in web/app.js goes through `safeReload` (at most once per reason per session, logged to the main log).
   - The desktop app does not use a service worker: it unregisters old ones, and electron/main.cjs clears old service workers and caches when the version changes.
   - In the browser a new worker waits for the person to click Refresh (no skipWaiting at install), and the HTML is never cached.
   - Main-process loop breaker: more than 6 window loads in 60 s shows the engine page instead.

## Providers and keys
8. **Google Gemini is first-class.**
   - It has a "Google Gemini" card with "Get a Google Gemini API key" (https://aistudio.google.com/apikey).
   - It calls the native endpoint `https://generativelanguage.googleapis.com/v1beta` (models list, generateContent, streamGenerateContent, batchEmbedContents) with the `x-goog-api-key` header. The OpenAI-compatible `/v1beta/openai` Bearer route is not used: it rejects new AQ. auth keys.
   - Current Pro and Flash defaults and pricing stay.
   - The key check sends the key in a header, not in the URL.
9. **Custom providers.**
   - "Add custom provider" accepts any OpenAI-compatible (default) or Anthropic-compatible API: name, base URL, key, models or /models discovery, and optional extra headers.
   - Keys and header values are stored in the vault.
   - Custom providers can be edited and deleted.
   - Presets: OpenRouter, Groq, Together, Fireworks, DeepSeek, Mistral, Perplexity, Ollama (http://localhost:11434/v1, no key) and LM Studio.
   - Implemented in server/plugins/providers.js.
10. **Key auto-detect.**
    - Pasting a key suggests its provider (AQ. and AIza = Google Gemini, sk-ant- = Anthropic, sk- and sk-proj- = OpenAI, xai- = xAI, sk-or- = OpenRouter, gsk_ = Groq, and so on).
    - If nothing matches, the paste box says so and offers a provider picker. The key is never logged.
    - A key pasted into the wrong card asks first.
11. **Demo AIs leave on their own.**
    - Nova, Atlas and Sage (demo) are removed from every list after the first real key is saved and validated, including a custom provider's key.
    - A one-time toast explains this.
    - Past demo chats and ledger lines are kept and tagged demo.
    - Demo mode can be turned back on in Settings, and it then stays on (`demoKeep`).
12. **Clear key-check wording.**
    - "Key rejected (401)" when the provider refuses the key.
    - "Could not reach <provider>: <reason>" for network problems.
    - Never a bare "fetch failed".

## Features and plan
13. **Teams / workspaces (Phase 8) is DONE.**
    - Built by Grok Bot: server/plugins/workspaces.js, web/features/workspaces.js, supabase/workspaces.sql (migration file only, never run on the live DB).
    - Do not rebuild it.
14. **Run order:**
    - 1, 15, 16, 26, 28, 29, 25, 12, 27, 13, 17 to 24, 14, then 2 to 11.
    - Phases already marked `PHASE N DONE` are skipped.
    - Phase 14 (Mac build) cannot be verified without a Mac: if a step needs one, write `PHASE 14 BLOCKED` with the reason.
15. **Grok Bot agent (Phase 12) spec stays as written in BUILD-PLAN:**
    - capability tags
    - Settings > Integrations with the webhook URL and sender key stored as secrets
    - a configurable header (default `Authorization: Bearer`)
    - JSON body `{job_id, task, context, workspace, callback_url}`
    - a callback endpoint with a per-job token
    - statuses queued / working / needs_approval / done
    - a mock in tests
    - no tunnel or deploy.
    - agent cards on the hub: Grok Bot and the built-in browser helper (Phase 27) appear next to Claude / ChatGPT / Grok / Gemini with live status, an activity feed, and their results in the council.

16. **Smart fallback (Phase 26) is core and applies to every customer:** out-of-credits, rate-limited or key-rejected providers are skipped automatically, work goes to the next-best model by speed / quality / cost, the same model is retried through OpenRouter first when an OpenRouter key exists, small jobs use free tiers (such as the Gemini free allowance), and providers switch back when credits return. Every call is in the ledger and within spend caps.
17. **Built-in browser helper (Phase 27)** for customers without Grok Bot: an in-app browser window driven by the cheapest capable AI, plus Gmail / Drive through the person's own Google sign-in. An explicit OK is required before any send, post, delete or purchase.


18. **Learning router (Phase 28) is the app's own brain:** it saves council scores, thumbs up / down, cost, latency and task type per model per user (no prompt content beyond the task type, never secrets or personal data), picks the best model per task for the price from that track record, and shows a per-user "Who's best at what" view. Training a small model of our own later uses only aggregated, opt-in data.

19. **Live project view (Phase 29):** every project and mission shows live which AI or agent is working, the current step, and credits / cost so far, with "Open in <service>" links where the provider has a page for the job (Kling task page, OpenAI / Anthropic / xAI usage dashboards). API chats do not appear in claude.ai, grok.com or ChatGPT history, so the app is the place to watch work. An animated live flow map, approved by Chris on 2026-10-18, shows each AI, provider or agent as a node and moves tasks and messages between them in real time (from the router or council to the AI doing the work, and back with the result). The active node is highlighted. A tooltip shows the current step and the credits or cost used so far. It uses the same job events as the rest of the view, stays lightweight (SVG and CSS, no new dependencies) and respects prefers-reduced-motion. On 2026-10-19 Chris approved the look and the outside agents: the map stays in motion while something is in use (neon pulse on the active node, light streaming along the edges, idle nodes and edges fading to dim and ghosted rather than disappearing) with a calmer prefers-reduced-motion fallback. The same view shows outside agents the app hands work to (Grok Bot via the webhook handoff, the built-in browser helper, Cursor cloud builders, and later agents added through one adapter). Each has its own node with status sent, working, or reported back, the job it was given, when it was sent, the result when it reports back, and an Open link only where that agent has an https page. The page is never fetched.

20. **Onboarding runs once; daily background check only.**
    - First-run setup (browser history, key import, bookmark organizing) is shown only when this install has no history yet.
    - History means any of: a key already in the vault, saved settings, past chats or jobs, or bookmarks the app already has. If any of that is present, setup is not shown.
    - Completion is a flag with a version, stored in the user data folder (`onboarding.json`). That folder survives restarts and updates. The flag is not kept in localStorage or in the caches v0.3.2 clears after an update.
    - Later launches open the hub. Bookmark organizing does not run on launch.
    - At most once every 24 hours, in the background, the app compares providers, models and vault keys with the saved history and integrates only what is new. A small notice says "New: X added". It does not open setup.
    - Settings keeps a manual "Run setup again".

21. **API key or MCP, for services that offer both.** Approved by Chris on 2026-10-19. Shipped.
    - Kling, ElevenLabs, Sync.so, fal.ai and Replicate can be connected with an API key or with an MCP server.
    - Each of those Settings cards has **Connect with API key**, **Connect with MCP**, which one is active, and **Test connection**. The same choice is in the guided key setup. The person can switch any time. Both can stay saved.
    - A job uses the active connection. If both are set up and the active one fails, the other runs the job.
    - Claude, ChatGPT, Grok and Gemini need an API key, or an OpenRouter key, to take part in the council. An MCP server does not take their place there. Tools such as Kling can use an API key or an MCP server.
    - This reuses the Phase 1 vault and guided key setup, and the Phase 16 MCP client. It does not add a second vault or a second MCP client. Phase 13 is bookmarks.
    - Onboarding still runs once. Saving a key or an MCP server does not open setup again.

22. **Welcome email.** Approved by Chris on 2026-10-19. Not built yet.
    - On sign-up or license redeem, send a plain welcome email.
    - The email explains their account, that chats and settings back up to the cloud automatically (hosted on Everborn's Supabase, each user sees only their own data via RLS), and how to add AI keys or connect via MCP.
    - No income or results claims.
    - Do not build this until Chris adds it to the run order. Do not rewrite this spec.

23. **Use your own Supabase.** Approved by Chris on 2026-10-19. Not built yet.
    - An optional advanced setting for power users and companies: a bring-your-own project URL and publishable key.
    - Off by default. Never part of normal onboarding.
    - Customers never need to create a Supabase account by default. The normal app uses Everborn's Supabase.
    - This is separate from the licence server connection in Settings. It must not touch Square or billing.
    - Do not build this until Chris adds it to the run order. Do not rewrite this spec.

## Rules (always)
- Never deploy the hub or anything else. Never touch Square or billing, never charge money.
- Never use real API keys. Tests use mocks on local ports and never call a real URL.
- Never read or commit anything in `data\` (including data\supabase-db-password.txt).
- Never put passwords, SSNs or client data into git.
- Nothing posts, sends or publishes without an explicit click by the person.

## Plan notes (not locked, not a change to the decisions above)

The lock at the top of this file does not cover this section. These notes are the plan. They do not override decision 16 or any other locked item. Leaving a "planned" item unbuilt is not a regression.

24. **Pro prompts (Phase 30) and intent auto-detect (Phase 31).** The pack is ROLE / CONTEXT / COMMAND / FORMAT, filled from the Business Profile, and it halts when a required fact is missing. Safety marks unverified numbers [VERIFY], keeps outbound text as drafts, and strips SSNs, dates of birth, and account numbers. SCF mode adds CROA and RESPA. Intent match is a keyword heuristic plus one cheap router call when the heuristic is unsure. The learning router stores the template id and a count only. The top navigation is grouped menus. "Open live view" is at the bottom-right of the Live Ops panel, and Live stays in the Work menu.
25. **Model-version alerts (Phase 32) are planned and not built.** Watch providers for a new model version (for example Kling 4.0), notify the person, and offer a one-click switch.
26. **Bring your own apps (Phase 33) is planned and not built.** (1) API / OAuth connectors under Connect, HighLevel first (contacts, invoices, workflows as council tools). (2) Any user MCP server by URL (Zapier, Make, and similar). (3) Custom webhook / API tools (URL, auth header, input schema). Send, charge, and modify actions need a confirmation click. Keys stay in the vault and are never logged.
27. **Phase 26 extension is planned and not built.** Decision 16 is unchanged: skip a provider that is out of credits, rate limited, or refusing the key; send the work to the next-best model; retry the same model through OpenRouter when a key exists; prefer known free tiers for small jobs; switch back when credits return; ledger and spend caps on every call. A later pass adds this order on top: (1) an alternate API route (OpenRouter, including a free tier the app already knows about); (2) MCP where the provider's own app offers it; (3) an opt-in relay mode that copies the full context into the person's already signed-in ChatGPT or Claude web page through the extension or the browser helper and reads the reply back into the council. Relay is slower, carries a terms-of-service caution, is off by default, and shows a relay tag on the live map when it is on.
28. **Hide hosted plumbing (Phase 34) is planned and not built.** Customers never see Supabase or callback / webhook plumbing. Decision 15 is unchanged: the handoff is still a webhook, a sender key stored as a secret, a configurable header, and a per-job callback. The hosted Supabase URL and the publishable key ship built in. Once our hosted server exists, the results callback URL auto-fills from that server. Grok Bot and other agent handoff fields are prefilled where the app already knows the value. Those fields stay hidden unless the optional "Use your own Supabase" switch is on (off by default) or an Advanced toggle is on. Nothing in this note deploys a hub or sends a job without a click.
