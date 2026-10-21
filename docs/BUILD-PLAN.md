# Command Center build plan (Chris, 2026-10-18: "a full working product that nobody else has")

Each phase is sized for one Claude Code session (about 1 to 2 hours). Run order: 1, 15, 16, 26, 28, 29, 25, 12, 27, 13, 17, 18, 19, 20, 21, 22, 23, 24, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 30, 31, 32, 33, 34, 35, 55, 53, 54, 56, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, then Do last: 14, Windows code signing, App Store and Google Play listings, 52. That line is the historical order (decision 14, extended on 2026-10-20). On 2026-10-21 Chris regrouped everything that is not done. The current plan is the version list in the next section. Phases marked DONE are skipped. Phase 14 stays blocked for any step that needs a real Mac. Read docs/DECISIONS.md first: locked decisions are never reverted or reworked. A phase starts only after the phase before it in the current plan shows PHASE N DONE in BUILD-LOG.md.
This plan includes the twelve items in `docs/roadmap.md` (marked R1 to R12) and follows its plugin rules (`web/features/*`, `server/plugins/*`, data through `ctx()` from `server/store.js`).

## Current plan (Chris, 2026-10-21)

Shipped version on main is 0.4.8. Open pull requests are not done. Prices below are the plan. The live Square checkout is still the $15.99 monthly link. This document does not change Square.

### Already done

Marked DONE from `PHASE N DONE` in docs/BUILD-LOG.md, or from a merged pull request checked on 2026-10-21. Do not rebuild these.

| Phases | What shipped | Evidence |
|---|---|---|
| 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 35, 55 | The original chain through Pro prompts, plus yearly and lifetime prices in the app and the hourly update prompt | `PHASE N DONE` in docs/BUILD-LOG.md. Phase 35 and Phase 55: pull request 52. |
| 36 | Free and Pro limits (1 connected service and 1 email account on Free, all services and 8 email accounts on Pro, 3 projects, 5 councils a month, phone pairing and history search on Pro, 14-day trial) | Merged in the 0.4.4 notes (pull request 37) and `server/license.js` on main. |
| 37 | Backgrounds, gradients, built-in pictures, and a photo from this computer | Pull request 40, release 0.4.5. |
| 38 | Get everything connected checklist | Pull request 25, release 0.4.3. |
| 39 | Start a project walkthroughs, with a live-view link | Pull requests 13 and 18. |
| 41 | Phone pairing on the same Wi-Fi, off until it is turned on | Pull request 11. `server/pairing.js` on main. |
| 4, inside 0.4.10 | Share links | Phase 4 DONE. Do not rebuild. |
| 11, inside 0.4.10 | Accessibility pass (keyboard, screen reader, reduced motion) | Phase 11 DONE, release 0.4.2. Do not rebuild. |
| 23, inside 0.4.10 | Imported chats from ChatGPT and Claude export zips | Phase 23 DONE. Do not rebuild. |
| 25, related to AI credits | Credits left per provider on the subscriptions page | Phase 25 DONE. Phase 81 only adds a plain AI credits screen on top of those numbers. |

Phase 14 is BLOCKED in the log: the on-Mac check and Apple signing are not done. The unsigned build moves to version 0.4.10 below. Signing moves to Later.

### Version 0.4.9 (next)

Not done. In this order:

1. Phase 66. Onboarding with the mode choice and extra Expert setup.
2. Phase 67. The few-facts fix.
3. Phase 68. Safety, sharing, and plain words.
4. Phases 45 to 51. Desktop control, with Antigravity first.
5. Phase 69. The program scan.
6. Phases 53, 54, and 56. Everyday actions and Calendar.
7. Phase 70. Save in place.
8. Phase 71. The welcome email (decision 22, spec unchanged).
9. Phase 72. The graduate notice.

### Version 0.4.10

Not done, except the three rows already marked done above (share links, accessibility, imported chats).

1. Phase 14, unsigned Mac build only. Right-click the app and choose Open. Apple signing is Later.
2. Phase 73. Private mode.
3. Phase 74. See who reads the prompt.
4. Phase 75. Backup and restore.
5. Phase 76. Do this again.
6. Phase 77. Home screen.
7. Phase 78. Delete with receipt.
8. Phase 79. Double-check.
9. Phase 80. Tone buttons.
10. Phase 81. AI credits.
11. Phase 82. My chats.
12. Phase 83. Answers name their AI.
13. Phase 86. First council explained.
14. Phase 4. Share links (DONE).
15. Phase 85. PDF and DOCX export.
16. Phase 84. Industry packs.
17. Phase 11. Accessibility (DONE).
18. Phase 23. Imported chats (DONE).

### Version 0.4.11

1. Phase 87. Background runs.
2. Phase 40. Learned from ratings.
3. Phase 88. Mission pause.

### New phases after 0.4.11

1. Phase 89. Research: web search with citations (Phase 15 is already done), Pro Search, Deep Research with a second-AI check, and academic and news filters.
2. Phase 90. Zapier and Make connectors, both ways. MCP by URL and custom webhooks move here from Phase 33. This runs before Later.
3. Phase 96. Remix any app. A Pro mission, unlimited on Extreme. It runs right after Phase 90 and before Phase 91. Not done.
4. Phase 91. The three tiers. Free. Pro at $18.99 a month or $189 a year. Extreme at $29.99 a month or $299 a year. About 6 months after those prices go live, the monthly prices rise to $24.99 and $39.99. Lifetime founders: $299 for the first 100, then $499 for the next 400, closed at 500. The buyer counter stays hidden under 40 buyers. Details in docs/billing.md. The app still shows the Phase 35 prices until this phase is built. Do not change the live Square link until Chris publishes new Square plans.

### Later

Not in 0.4.9, 0.4.10, or 0.4.11. Nothing here is bought or put in a store without Chris's OK.

- Phase 44. AI group chat.
- Phase 92. User chat.
- Phase 43. Live builds.
- Phase 93. A newsletter and a monthly savings email.
- Phase 94. Spanish.
- Phase 95. Phone apps.
- Store listings (Apple App Store and Google Play).
- Signed apps: Windows code signing, and Apple signing and notarization for the Mac build.
- Phase 52. Hosted web version. Still needs Chris's OK before any hosting is paid for.

### Not in a version yet

Left on the list so they are not dropped. They are not next.

- Phase 32. Model-version alerts. Built in the Watch and talk workstream. The version stayed 0.4.8. Notes go to the Together news list when that code is present, and to a local list until then.
- Phase 33. HighLevel contacts, invoices, and workflows as council tools. MCP by URL and webhooks have moved to Phase 90. HighLevel posting already shipped in Phase 7.
- Phase 34. Hide hosted plumbing.
- Phase 42. Newsfeed and alerts.
- Phase 26 extension (decision 27). The manual handoff shipped in pull request 14. The automated relay is still not built. Decision 16 is unchanged.
- Use your own Supabase (decision 23). Still not in the run order.

## Rules for every phase (non-negotiable)
1. Read `README.md`, `docs/roadmap.md`, this file and the end of `docs/BUILD-LOG.md` first.
2. One commit per feature (`git add <your files>` only, never `git add -A`). Do NOT commit files you did not write in this phase. Other sessions may have uncommitted work here (e.g. workspaces files); leave it alone.
3. Write tests for every feature in `test/*.test.js` (node --test). Before each commit, run `npm test` and `npm run smoke`; both must pass.
4. Everything must keep working in demo mode (no keys). Use a throwaway data dir (`CC_DATA_DIR` set to a temp folder) for tests.
5. Never deploy, never push (Chris pushes), never touch Square, real API keys, `data/`, `.env`, password files, or billing. Nothing posts, sends, emails or spends without an explicit user click; outbound integrations need user OAuth.
6. Paid things (managed plan, trial credits, marketplace pricing) go behind a feature flag with PLACEHOLDER prices. Chris decides real pricing.
7. At the end, append to `docs/BUILD-LOG.md`: date/time, features done, commits (hash + message), test counts (npm test pass/fail, smoke pass/fail), what is not verified, and a final line exactly `PHASE N DONE` or `PHASE N BLOCKED: <reason>`.
8. Every release adds a `docs/WHATS-NEW.json` entry for the new `package.json` version, with plain-language bullets, and adds or updates onboarding tour steps for any new user-facing feature. A test fails when that version has no entry. The What's new screen shows once after each update.

## Phases

### Phase 1: First impression (DONE)
- Color themes: light, dark, and accent colors, saved per user, applied across the app.
- Brand kit: upload a logo and pick brand colors; applied to the app header and to client share pages.
- Onboarding tour: first-run walkthrough that runs a demo sample mission (demo mode, no keys).
- Guided API-key setup: step-by-step per provider (where to get the key, paste, test call, store in the vault). Keys never logged or shown again.

### Phase 2: Proof of value (DONE)
- Starter pipelines (R1): Instagram week, client proposal, music video plan; one click runs a mission, results filed under the project.
- Savings receipt per job (R7): "flagship-only would have cost X, this cost Y", Credits tab total, PNG export.
- Spend caps and alerts (R10): per-AI monthly cap, amber at 80%, router excludes at 100%, in-app alert.

### Phase 3: Quality loop (DONE)
- Rate the result (R4): thumbs up/down feeding the router; the skills matrix shows human ratings separately.
- Project memory and brand voice (R5): voice, offers, never-say list, past winners injected per project; HQ client-file importer.

### Phase 4: Client-facing (DONE)
- Live-share links (R8): read-only, expiring token URL mirroring one mission in real time, with the brand kit applied. No keys or costs shown unless toggled.
- Weekly report (R6): generated in-app every Monday (spend, low credits, renewals, what shipped, cancel suggestions); an email draft/export button only, nothing sent automatically.

### Phase 5: Hands-free and mobile (DONE)
- Voice commands (R9): mic button using the Web Speech API, push-to-talk and an auto-send option.
- PWA and push notifications: installable app, service worker, web push (VAPID) for alerts and job done, opt-in only.

### Phase 6: Work with files and media (DONE)
- Chat with files: drop PDFs, docs or images into a project and ask questions; chunks stored per project; works in demo mode with the mock provider.
- Media actions (R2): mission steps for video, image and voice through provider adapters, credit estimate first, ledger logging, outputs saved to the project. Stubbed in demo mode.

### Phase 7: Integrations (OAuth, post only on click) (DONE)
- Connectors for Google Drive, Instagram (Meta Graph), HighLevel and Slack (R3): user OAuth flow scaffolding, tokens kept in the vault, "Save to Drive", "Post to Instagram", "Schedule in HighLevel" and "Send to Slack" buttons, each needing an explicit click. Mock adapters for tests; no real calls in tests.

### Phase 8: Teams (DONE)
- Team seats and roles (R11): owner, admin, member and viewer; invite by email (invite link generated, not sent); per-role permissions; usage per member; Studio tier gate.

### Phase 9: Growth (feature-flagged, placeholder pricing) (DONE)
- Free trial with credits: trial counter, gating and an upgrade prompt.
- "No keys needed" managed plan: the app routes through an Everborn-managed key pool when the flag is on; usage metering only; no billing integration.
- Referral rewards: referral codes and links, a credit ledger, and a rewards view.
- No real charges, no Square changes, all prices are placeholders.

### Phase 10: Marketplace (DONE)
- Template sharing (R12): export or import a pipeline or template as a signed JSON file; a share link.
- Marketplace: listing page, install flow, moderation queue and revenue-share fields (placeholder); local and demo catalog only.

### Phase 11: Hardening and polish (DONE)
- Full regression pass, accessibility, performance, error states, empty states, README and user guide, release notes. Fix anything flaky found in phases 1 to 10.

### Phase 12 (HIGH PRIORITY, added 2026-10-18): Grok Bot agent inside the Command Center (DONE)
Chris wants the app to be the hub where all his AIs talk and decide who does what best; when Grok Bot (his assistant with its own computer, signed-in browser, Gmail, Drive, Calendar) is the best fit, the app hands it the job.
- Grok Bot appears as an agent/provider in council, router and mission modes, with capability tags: `signed-in-browsing`, `gmail`, `drive`, `calendar`, `teammate-bots`. The router prefers it for tasks that need those; it is never picked for plain text work another AI does as well.
- Settings > Integrations > Grok Bot: two fields, webhook URL and sender key, stored in the vault like other secrets (never in git, never logged, never sent to the browser after saving). A third optional field: header name, default `Authorization` with value `Bearer <key>`.
- Dispatch: POST to the webhook URL with the sender key header and JSON body `{job_id, task, context, workspace, callback_url}`. Only on an explicit mission/council step or user click; never in demo mode unless the mock is selected.
- Results come back to `POST /api/grokbot/callback/<job_id>?t=<per-job random token>` on the local server (the token is generated per job, stored hashed, compared with timingSafeEqual, single use for `done`). Payload `{status, text, artifacts}`; status is one of `queued`, `working`, `needs_approval`, `done` (plus `failed`). The result lands in that job's thread and graph node; the node shows the status. The UI says results are async and can take minutes.
- The callback endpoint must be exempt from the local session token (it uses the per-job token instead) and must reject everything else.
- Tests: a local mock webhook server only (random port); never hit a real URL in tests.
- Do not build a tunnel and do not deploy anything. Document that `callback_url` only works once Grok Bot can reach it: after the hosted hub exists or a tunnel is set up by Chris. Until then the job stays `queued`/`working` and the user can paste the result in by hand.
- Agents on the hub (expanded 2026-10-18): Grok Bot and the built-in browser helper (Phase 27) appear on the hub as their own cards next to Claude, ChatGPT, Grok and Gemini, with a live status light, an activity feed of what they are doing right now, and their results shown in the council next to the other answers (scored and credited the same way).

### Phase 27 (added 2026-10-18 by Chris): Built-in browser helper (effort: L, about 2 sessions) (DONE)
For customers who do not have Grok Bot: a browser window inside the desktop app that an AI can drive for browsing tasks.
- A separate Electron browser window (its own session, never the person's main browser profile) driven step by step by the cheapest capable model (vision or DOM-reading), with a visible action log and a Stop button.
- Gmail and Google Drive through the person's own Google sign-in (OAuth, least-privilege scopes, tokens in the vault); read by default.
- Explicit OK required before any send, post, delete, purchase or form submit; the prompt shows exactly what will happen. Never stores passwords; never handles Square or billing.
- Appears on the hub as its own agent card (see Phase 12). Tests: a local mock site and mocked Google APIs; no real accounts or URLs.

### Phase 13 (added 2026-10-18): Organize my existing browser bookmarks (DONE)
The first-run step that makes AI bookmarks also offers to organize the user's EXISTING bookmarks into smart, auto-named folders by topic (e.g. their business name, insurance, banking, tools, social), using the user's own API key to categorize.
- Read bookmarks from Chrome, Edge and Brave `Bookmarks` JSON files (per profile) and Firefox `places.sqlite` if practical (read-only copy). Only after the user picks the browser and clicks allow.
- Show a preview of the proposed folders; the user can rename folders, move items between folders, and uncheck items before applying.
- Back up the original bookmarks file first (timestamped copy next to it and in the app data folder) and offer one-click undo that restores the backup.
- Never delete bookmarks; only reorganize. Exact duplicates (same URL) are merged only after the user confirms the list.
- Before applying: warn the user to close the browser (Chrome/Edge/Brave overwrite the file while running); detect a running browser process and refuse to apply until it is closed. Remove the `checksum` field so Chromium accepts the edited file.
- Privacy: bookmark titles and URLs go only to the AI provider the user picked for categorizing, nowhere else; say so in the UI. Demo mode categorizes with the mock provider and a fixture file.
- Tests with fixture bookmark files in a temp folder; never touch a real browser profile in tests.

### Phase 15 (HIGH PRIORITY, added 2026-10-18 from a competitor review): Live web search with cited sources (DONE)
- Pluggable search provider using the user's own key: Tavily, Brave Search, Serper, or the model's built-in search where supported (Perplexity, xAI). Keys in the vault like other secrets; never logged.
- A "Search the web" toggle per chat, council and mission (off by default).
- Results are injected into the prompt with numbered citations; answers show them as clickable source chips ([1], [2], ...) that open the source.
- Search calls respect spend caps (alerts plugin) and are logged in the ledger with their cost.
- Works in demo mode with a mock search provider; tests use a local mock only, never a real search API.

### Phase 16 (HIGH PRIORITY, added 2026-10-18 from a competitor review): MCP tool support (DONE)
- Users add MCP (Model Context Protocol) servers in Settings > Tools: local stdio commands, and remote Streamable HTTP / SSE servers with OAuth or custom headers. Secrets (headers, tokens, env) go to the vault and are never logged or sent to the browser.
- The app lists each server's tools and lets the user enable them per workspace (Phase 8 workspaces; "Personal" when none).
- Any provider that supports tool calling can call enabled tools; calls are routed through the local server, never directly from the browser.
- Tools that write, send or delete need a per-call approval prompt in the UI (consistent with "nothing posts without a click"); read-only tools can run without one when the user allows it.
- Use the official `@modelcontextprotocol/sdk`. Tests with a mock MCP server (stdio and HTTP) on a temp dir / random port.

### Phase 26 (HIGH PRIORITY, core, added 2026-10-18 by Chris): Smart fallback (effort: M, about 1 session) (DONE)
For every customer: a job never fails just because one provider is out of credits, rate limited or refusing the key.
- The router reads each provider's health (out of credits / spending limit, rate limited, key rejected, unreachable, spend cap reached) and auto-skips that provider for new work.
- It routes to the next-best model for the job by the person's priority (quality / balanced / economy), using speed, quality and cost from the registry and learned skills. The deliverable and the feed say which model stood in and why.
- If an OpenRouter key exists, it first retries the same model through OpenRouter (mapped model id) before switching models.
- Small jobs (short classify / summarize / title tasks) prefer free tiers where the user has them (for example the Gemini free allowance), never exceeding a free limit the app knows about.
- A provider switches back automatically when its credits or limit return (next successful health check or call); no manual reset needed.
- Every fallback call goes to the ledger and respects spend caps. Tests: mocked providers returning 402 / 403-credits / 429 / 401 / network errors, OpenRouter retry, free-tier pick, and recovery; no real URLs or keys.
- Planned extension (not built; decision 16 stays as shipped). A later pass adds this order on top of the skip and next-best model above. It does not replace the ledger or the spend caps.
  1. Alternate API route: retry the job through OpenRouter, including a free tier the app already knows about.
  2. MCP, where that provider's own app offers a tool.
  3. Opt-in relay mode: copy the full context into the person's already signed-in ChatGPT or Claude web page through the extension or the browser helper, then read the reply back into the council. This path is slower. It carries a terms-of-service caution. It is off by default. When it is on, the live map shows a relay tag on that node.

### Phase 28 (HIGH PRIORITY, core, added 2026-10-18 by Chris): Learning router, the app's own brain (effort: L, about 2 sessions) (DONE)
The router learns from every job which model is best at what, for the price, per user.
- Save per model per user: council scores, the person's thumbs up / down, cost, latency, success or failure, and the task type (capability and difficulty from the classifier). No prompt or answer content beyond the task type; never secrets, keys or personal data.
- The router uses this track record (with the registry's base scores as the starting point) to pick the best model per task for the person's priority (quality / balanced / economy), improving with each job; works together with Phase 26 smart fallback.
- A per-user "Who's best at what" view: per task type, the top models with win rate, average score, cost per job and speed, and how many jobs the ranking is based on. The person can reset it.
- Local first: stored in the user's data (hosted: their own rows). Export and delete with the rest of their data.
- Later stage (separate, opt-in only): aggregate anonymous, opt-in track records across users to train a small routing model of our own. Nothing is shared without an explicit opt-in.
- Tests: simulated job histories that change the ranking, thumbs and council scores weighting, cost and latency in the score, the reset, and a check that no prompt text or secrets are stored.

### Phase 29 (HIGH PRIORITY, added 2026-10-18 by Chris): Live project view (effort: M, about 1 session) (DONE)
Every project and mission shows, in real time, who is working on it and what it costs.
- Per project / mission: which AI or agent is working right now (models, Grok Bot, the browser helper), the current step, and credits / cost used so far, updating live over the WebSocket.
- An "Open in <service>" link wherever the provider has a page for that job: for example the Kling task page for a video, and the usage dashboards of OpenAI, Anthropic and xAI for API spend. Links open in the person's browser; no scraping, no sign-in by the app.
- Note: chats made through the APIs do not appear in the claude.ai, grok.com or ChatGPT history, so the app itself is the place to watch the work. Say this in the UI where people would look for it.
- Animated live flow map (approved by Chris on 2026-10-18): each AI, provider or agent on the job (Claude, GPT, Grok, Gemini, Kling, Grok Bot, the browser helper, and anyone else the job uses) is a node. Tasks and messages move between them in real time, as dots along edges from the router or council to the AI doing the work and back when the result returns. The active node is highlighted. A tooltip shows the current step and the credits or cost used so far. The map is driven by the same job events as the rest of the live view. SVG and CSS only, no new dependencies. prefers-reduced-motion turns the motion off and keeps the highlights and tooltips.
- Flow map look (approved by Chris on 2026-10-19): edgy and high-end, and never static while something is in use. Active nodes glow and pulse with neon accents. Edges carry a flowing light stream and particles while work moves. Idle nodes and edges fade down to dim and ghosted, and fade back up when used again. They stay on the map. Dark, sleek, and consistent with the app theme (subtle glow, depth, smooth easing). SVG and CSS only, no new dependencies. prefers-reduced-motion keeps a calmer fallback: the active agent stays lit, idle ones stay dim, and the moving light is off.
- Outside agents (approved by Chris on 2026-10-19): the same view shows external agents the app hands work to, each as its own node. Built in: Grok Bot (webhook job handoff), the built-in browser helper, and Cursor cloud builders. A generic adapter (`registerExternalAgent`) adds later agents. Each handoff shows status (sent, working, reported back), the job it was given, when it was sent, and the result when it reports back. An Open link appears only where that agent has an https page (Cursor cloud builders use `https://cursor.com/agents/<id>`). The page is never fetched. Phase 12 and Phase 27 still own the actual dispatch. They emit `external.handoff` when they hand work off (Grok Bot and the browser helper). This phase only watches.
- Tests: mocked mission events drive the live view (step, agent, running cost), the link builder for each provider, the event-to-animation state (nodes, edges, pulses, active highlight, ghosted idle nodes, tooltip, reduced motion), and external handoffs (status, job, sent time, result, Open link, a registered adapter, no secrets, no fetched URL). No real URLs fetched.

### Phase 25 (HIGH PRIORITY, added 2026-10-18 by Chris): Subscriptions and services page (effort: L, about 2 sessions) (DONE)
One page that shows every paid AI service, what is left, what it costs this month and when it renews. Builds on the existing subscriptions tracker (server/subscriptions.js) and the spend caps and alerts plugin.
- (a) API providers, live where an API exists: OpenRouter credits and key info (`/api/v1/credits`, `/api/v1/key`), DeepSeek `/user/balance`, OpenAI and Anthropic usage and cost APIs through an OPTIONAL admin key (stored in the vault like any key, never required), xAI and Gemini where an endpoint is available, otherwise month-to-date spend from the ledger. Per provider show credits left, month-to-date spend, and amber/red alerts tied to the existing spend caps.
- (b) Subscriptions without an API (Google AI Pro / Ultra with Flow, Kling, Suno, ChatGPT Plus, Claude Max, Midjourney, ElevenLabs and similar): an optional, read-only Gmail or Outlook OAuth connection (read-only scope only) scans receipt and renewal emails and extracts service, plan, price, billing cycle and next renewal date. Each extracted row shows a confidence and a link to its source email; the user confirms or edits before it is saved. Never store full email bodies, only the extracted fields plus the message id. Manual add and edit is always available, with or without the email scan.
- (c) Renewal reminders (desktop notification, or push through the alerts plugin) N days before each renewal (N set per row, default 3), a monthly total across APIs and subscriptions, and a "possible duplicate or unused" hint (for example two plans from one vendor, or a paid service with no ledger or credit activity in 30 days).
- (d) Label every field in the UI as auto-detected (API or email, with confidence) or entered by the user. Tests: mocked provider balance and usage APIs on a random local port, and sample receipt emails (fixtures with fake data only) for each listed service, including a low-confidence case and a parse failure; never a real inbox, key or URL. No em-dashes in user-facing text. Never touch Square or billing.
## Competitor-review backlog (added 2026-10-18, after Phases 15 and 16)
Every item below must respect: bring-your-own-key (the user's keys only), spend caps, a ledger entry for every paid call, nothing posts or sends without an explicit click, and no secrets in logs or git. Each works in demo mode with mocks; tests never call a real API.

### Phase 17: Side-by-side comparison (effort: M, about 1 session) (DONE)
- One prompt goes to 2 to 6 chosen models; answers stream into parallel columns with cost and latency per column.
- "Pick winner" records a rating (Phase 3 ratings) and feeds the router; presets of model sets can be saved and reused.
- Acceptance tests: 3 demo models answer in parallel and each column reports cost and latency; picking a winner writes a rating the router reads; a preset saves and reloads; a column whose provider is at its spend cap is skipped with a note; every call has a ledger entry.

### Phase 18: Knowledge libraries (RAG) (effort: L, about 2 sessions) (DONE)
- Libraries built from uploaded files and folders, plus Google Drive and Notion through OAuth (read-only scopes).
- Chunk, embed with the user's chosen embedding key, store locally (SQLite with a vector extension or LanceDB), hybrid search (keyword plus vector), cited answers with source chips. Attach a library per chat, workspace or agent.
- Acceptance tests: a fixture folder is indexed with a mock embedder; a question returns an answer citing the right chunk; keyword-only and vector-only queries both find their target; deleting a library removes its index; Drive/Notion adapters are mocked and request read-only scopes only; embedding calls are logged in the ledger and respect caps.

### Phase 19: Custom agents and a prompt library (effort: M) (DONE)
- Named agents: model, instructions, tools (Phase 16), libraries (Phase 18) and starter prompts. Saved prompts with {{variables}} filled in a small form before sending.
- Agents and prompts export/import as JSON, are shareable to a workspace, and can be listed in the Marketplace (Phase 10).
- Acceptance tests: create, edit, run and delete an agent on demo models; {{variables}} are required and substituted; export then import round-trips; a shared agent is visible to a workspace member and read-only for a viewer.

### Phase 20: Artifacts side panel (effort: M) (DONE)
- Generated HTML/JS, charts, markdown and mini apps render and run in a sandboxed iframe (sandbox="allow-scripts", no same-origin, no network to the local API), with versions, edit and re-run, and export (file download). Optional Python via Pyodide in a worker.
- Acceptance tests: an HTML artifact renders inside the sandbox and cannot read the session token or call /api; editing creates version 2 and the old version stays; export produces the file; Pyodide is lazy-loaded and a simple script returns output (skip in CI if offline).

### Phase 21: Image generation in chat (effort: M) (DONE)
- Through the user's keys: OpenAI GPT-Image, Gemini, xAI, Flux via Replicate or fal. Generate, edit and variations; results saved to the media gallery (Phase 6 media).
- Cost estimate shown first; ledger entry per image; spend caps respected.
- Acceptance tests: mock adapters for each provider return an image saved to the gallery with its prompt; edit and variation requests carry the source image; a provider at its cap is refused; no key means a clear "add a key" message.

### Phase 22: Scheduled and triggered agents (effort: L) (DONE)
- Run an agent or mission on a cron schedule, from a webhook (per-trigger secret token) or when a new file lands in a watched folder. Run history, a spend cap per schedule, and an approval step for anything that posts or sends.
- Note in the UI and docs: desktop schedules only run while the app is running (tray counts); always-on schedules need the hosted hub later.
- Acceptance tests: a fake clock fires a cron job once per slot; a webhook with a wrong token is refused (401) and a right one queues a run; a new fixture file triggers a run; a schedule over its cap stops and alerts; a posting step waits in "needs approval".

### Phase 23: ChatGPT and Claude history import, optional encrypted sync (effort: M) (DONE)
- Import conversations from the ChatGPT and Claude export zips into projects and chats (no upload anywhere).
- Optional sync of chats between desktop and phone through Supabase, end-to-end encrypted with a key derived from a user passphrase (the server stores ciphertext only). Off by default.
- Acceptance tests: fixture export zips import with titles, dates and messages intact; a bad zip fails with a clear message; the sync payload stored in the (mocked) Supabase layer is ciphertext and decrypts on a second client with the same passphrase only.

### Phase 24: Smaller extras (effort: S each) (DONE)
- Global hotkey quick-launcher on desktop (default Alt+Space, configurable; must not steal it if the OS or another app owns it).
- Chrome/Edge extension: send the page or a selection to a chat or council on the local app (paired with a token; nothing sent elsewhere).
- Live model pricing from the OpenRouter models API, feeding the router, ledger estimates and savings receipts (cached daily; manual overrides win).
- Team SSO (Google and Microsoft OIDC) for the hosted hub, and per-workspace API keys (stored in the vault, scoped to the workspace).
- Acceptance tests: hotkey registration is mocked and unregisters on quit; the extension's message is accepted only with the pairing token; a pricing fixture updates the router's costs and an override wins; OIDC flows are mocked; a workspace key is used only for that workspace's calls.

### Phase 14 (low priority, added 2026-10-18): Mac build (BLOCKED for the on-Mac check; unsigned build is version 0.4.10)
- `docs/ci/mac-build.yml` (added by Grok Bot; move it to `.github/workflows/` after `gh auth refresh -s workflow`) builds an unsigned `.dmg` and `.zip` (x64 and arm64) on macos-latest, on manual dispatch or a `v*` tag, and uploads them to the same public releases repo. It needs the repo secret `RELEASES_TOKEN` (fine-grained token, Contents read/write on command-center-releases only).
- Check that the app runs on a Mac: server start, Keychain vault (`safeStorage`), tray, window, data folder `~/Library/Application Support/Everborn Command`.
- TODO, needs an Apple Developer account ($99/year, Chris decides): Developer ID signing and notarization (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repo secrets, `notarize: true`). Until then Gatekeeper warns on first open and in-app updates do not work on Mac.
- Never block the Windows installer on this. Any step that needs a real Mac to verify is written as PHASE 14 BLOCKED with the reason.
- Version 0.4.10 ships the unsigned build only. First open on a Mac is right-click the app and choose Open. Say that in the download note. Apple signing and notarization stay in Later (signed apps). In-app Mac updates wait for that signing. The Windows Install now / Later prompt is unchanged.

### Phase 30: Pro prompts pack (effort: L) (DONE)
A pre-loaded library of prompts the team wrote. Each template has an id, a name, a category, a description, the inputs it needs, a ROLE / CONTEXT / COMMAND / FORMAT brief, and an output format.
- Categories: Strategy/ops, Money, Sales/clients, Content, People/hiring, Personal/coaching.
- The page says exactly: "Pre-built pro prompts, written by our team, so you get expert-level results without being a prompt expert."
- Empty required facts halt and ask. The model does not invent them. Business Profile fields fill matching inputs.
- Global instructions from the Business Profile, "How to talk to me", and "My Voice" are injected into every template. A short interview sits on welcome setup and in Settings. Speech is offered when the voice module and the browser speech API are both present.
- "Save this as a reusable prompt" on a finished chat stores the text as a custom prompt. It does not send anything.
- Friday Coach, Monday Chief of Staff, Friday team check-in, and Daily sundown install as paused chat schedules through the existing scheduler. Desktop schedules only run while the app is open.
- Safety on every template: numbers, metrics, case studies, and testimonials that were not in the source are marked [VERIFY]. SCF / credit-repair mode adds CROA and RESPA (no promised results, no score-jump claims, referral rewards marked [RESPA REVIEW]). Outbound emails and messages are drafts only. Client SSNs, dates of birth, and account numbers are stripped before a prompt is built or stored.
- One click can create the three-agent team pipeline, the two leverage pipelines, or a pipeline from a brain dump. Reel scripts can open Media with the idea filled in. Nothing is generated until Generate.
- The top bar is grouped menus (Work, Create, Business, Connect, Settings) so every existing destination stays reachable. Live stays in the Work menu. "Open live view" sits at the bottom-right of the Live Ops panel.

### Phase 31: Intent auto-detect (effort: M) (DONE)
Before a council or a chat, match the orders to a Pro prompt.
- A keyword heuristic (no embeddings) auto-applies a strong match and only suggests a weaker one. A visible chip can be removed. A removed chip is not applied.
- If the heuristic is unsure, one cheap classify call through the existing router may pick a template id. An unknown id is ignored.
- The learning router records the template id and a count (suggested, applied, removed, halted). No prompt text, no inputs, no secrets.

### Phase 32: Model-version alerts (built, version unchanged)
Watch connected AI providers for a new model and for a price change. The check uses each provider's public model list with the key saved for that provider. It is read only and runs at most once a day. A plain note is posted to the news list when that list is installed (Together, pull request 86). Until then the note stays in Model watch. A suggested switch can be accepted or undone. Nothing is switched on its own. The version stayed 0.4.8. Providers with no public model list (for example Kling) are not called.

### Phase 33: Bring your own apps (MCP by URL and webhooks moved to Phase 90; HighLevel tools not in 0.4.9 to 0.4.11)
HighLevel contacts, invoices, and workflows as council tools stay here. They are not in 0.4.9 to 0.4.11. HighLevel posting already shipped in Phase 7.
1. API / OAuth connectors under the Connect menu. HighLevel first: contacts, invoices, and workflows as council tools.
2. MCP by URL moved to Phase 90 (version after 0.4.11). Do not build it here.
3. Custom webhook / API tools moved to Phase 90. Do not build them here.
Every action that sends, charges, or modifies something waits for the person to confirm it. Keys are stored with the vault and are never written to logs.

### Phase 34: Hide hosted plumbing (not in 0.4.9 to 0.4.11, not built)
Customers never see Supabase or callback / webhook plumbing. Docs only until a later phase. Decision 15 stays as shipped: a Grok Bot handoff is still a webhook, a sender key, and a per-job callback. This phase only changes what a customer is asked to type. Nothing here deploys a hub or sends a job without a click.
- The hosted Supabase URL and the publishable key ship built in. The app uses them. There is no setup form for those values.
- Once our hosted server exists, the results callback URL auto-fills from that server. Until then the app keeps the current local callback.
- Grok Bot and other agent handoff fields are prefilled where the app already knows the value.
- Those fields stay hidden. They show only when the optional "Use your own Supabase" switch is on (it is off by default) or when an Advanced toggle is on.

### Phase 35: Billing, yearly and lifetime founder plans (effort: M) (DONE)
Chris, 2026-10-20: do this first. The monthly Pro $15.99 Square checkout already exists; do not change it. This phase only adds two Square plans: Pro yearly at $159 a year, and a lifetime founder deal at $299 for the first 100 buyers, then $499, capped at 500 total. Update docs/billing.md to match. Done in the app. The monthly link is unchanged. Yearly and lifetime are shown and are not charged. Version stays 0.4.5.

### Phase 55: Update prompts (effort: S) (DONE)
Show an update pop-up at startup with "Update now", and check hourly while the app runs, offering "Restart and update" or "Later" (Later installs on quit). Already exists (checked 2026-10-20): `electron/main.cjs` and `electron/updater.cjs` show a launch prompt ("Install now" / "Later") and check every 30 minutes with a prompt; downloads and installs happen only on click (`autoInstallOnAppQuit` is false). Left to do: the hourly interval, the "Restart and update" / "Later" wording on the running prompt, and install on quit after Later. Done: the launch prompt stays Install now / Later, the background check is hourly, the running prompt says Restart and update / Later, and Later on that prompt installs on quit. Version stays 0.4.5.

### Phase 53: Google Calendar connection (effort: M) (version 0.4.9, not done)
OAuth connect to Google Calendar, create and update events, and show it in the setup checklist. Free and Pro limits follow the connected-service rules (Free 1 connected service, Pro all). Already exists (checked 2026-10-20): `server/connect-setup.js` lists Google Calendar in the checklist, but today Calendar work is handed to Grok Bot (`server/grokbot.js` calendar tag). There is no direct Calendar OAuth yet. Grok Bot's Calendar handoff stays as it is (decision 15).

### Phase 54: Plain-request actions (effort: M) (version 0.4.9, not done)
The person types a plain request, for example "email this client and put it on my calendar". The router uses a cheap fast AI to draft the email and the event details. Meldmind itself sends and schedules through the connected Gmail and Calendar, only after one approval click (integrations act only on click). No outside AI touches the accounts. The cost is shown (usually a fraction of a cent).

### Phase 56: Everyday actions (effort: L) (version 0.4.9, not done)
Plain-request everyday actions built on the Phase 53 and 54 connections. Full plan, evidence and catalog: [docs/plans/everyday-actions.md](plans/everyday-actions.md).
- Top 10 first: (1) multi-account inbox summary and "reply in my tone" drafts; (2) calendar agenda brief and create or move events from plain text; (3) morning briefing routine (one free, more on Pro); (4) plain-text reminders and tasks; (5) email to task or calendar hold; (6) "What's new" prompt and "Suggest a connection or idea" box; (7) find a time and propose slots; (8) Docs, Drive and Notion find, summarize, save as doc; (9) meeting prep brief and transcript summary with action items; (10) small-business lead follow-up (HighLevel, email and SMS drafts, Pro).
- Safety rules for every action: read and draft freely, but any send, post, buy, book, delete, pay, share or invite needs one approval click showing the exact content and recipient. No stored passwords (OAuth or the person's own keys in the vault). No money moved without confirming amount, payee and source; the AI never fills payment fields. Scheduled routines only read and prepare; outgoing actions wait in an Approval queue. Every action is logged in Live Ops with undo where the API allows. Bulk actions (more than 10 items) show a count and a sample first. Grok Bot handoffs and MCP tool calls follow the same rules.
- Onboarding, tour, how-to and help: each new action gets a line in the welcome tour, a short how-to with an example plain request, and a help entry. (The plan file does not have its own section for this yet; add the detail when the phase starts.)
- "What's new" prompt: on the first launch after an update that adds connections or actions, show a short card list with Connect or Try it, Skip, and Remind me later (snooze 3 days, then once at 7 days, then it moves to Settings, What's new). "Skip all" is offered. Nothing connects without a click, and skipped items never come back as prompts.
- "Suggest a connection or idea" box: in Settings, the What's new card, and the empty connections page. Suggestion text, optional category and email, and an "include app version and OS" checkbox (no personal data, no chat content). Shows exactly what will be sent and needs a Send click; queues offline.

### Phase 36: Free and Pro limits (effort: S) (DONE)
Free gets 1 connected service, Pro gets all. Free gets 1 email account per provider, Pro up to 8. The learning router stays free; shared learning and the scores dashboard are Pro. Free gets 3 projects and 5 councils a month. Phone pairing and full history search are Pro. A 14-day Pro trial. docs/billing.md matches.
- Already implemented (checked 2026-10-20), skip these: the tier table in `server/license.js` (`TIERS.free`: connectedServices 1, emailAccounts 1, projects 3, councilsPerMonth 5, phone, historySearch, sharedLearning and scores off); the guards in `server/service-limit.js`, `server/mail-accounts.js` (Pro cap 8), `server/index.js` (projects, council, historySearch, phone) and `server/plugins/brain.js` (scores, sharedLearning); the 14-day trial in `server/growth.js`; docs/billing.md already lists these limits.
- Shipped. The limits are on main (release 0.4.4, pull request 37). Upgrade tips shipped in pull request 20. Phase 91 changes the public prices. It does not rebuild these limits. No Square changes in this phase.

### Phase 37: Custom backgrounds and themes (effort: M) (DONE)
Shipped in pull request 40 (release 0.4.5): built-in background images, solid colors, gradients, and a photo from this computer. Do not rebuild.

### Phase 38: Guided setup checklist (effort: M) (DONE)
Shipped in pull request 25 (release 0.4.3): Get everything connected, each row skippable, Run setup again in Settings. Do not rebuild.

### Phase 39: Guided "Start a project" tutorials (effort: L) (DONE)
Shipped in pull requests 13 and 18: Start a project walkthroughs for a website, a music video, a marketing campaign, an app, and a business plan, with a link to the live view. Do not rebuild.

### Phase 40: Learned from ratings (effort: M) (version 0.4.11, not done)
Version 0.4.11. This is the learned-from-ratings work. The learning router keeps adjusting routing settings (quality, cost, speed) and defaults from the person's input (thumbs, picks, overrides). Changes are shown and can be undone. Still no prompts or secrets stored (decision 18). Phase 3 and Phase 28 already record the thumbs. Do not rebuild them.

### Phase 41: Phone pairing fix (effort: S) (DONE)
Shipped in pull request 11. Pairing uses this PC's Wi-Fi address and stays off until it is turned on in Settings. Do not rebuild.

### Phase 42: Newsfeed and alerts (effort: M) (not in 0.4.9 to 0.4.11, not built)
One area for news and alerts: finished jobs, model-version alerts (Phase 32), spend warnings, updates.

### Phase 43: Chat rooms with live builds (effort: L) (Later, not done)
Share a running mission into a room so others can watch it live, and let them copy it as a recipe. Sharing is opt-in per mission; no keys or secrets are shared.

### Phase 44: AI group chat with personas (effort: M) (Later, not done)
Toggle which AIs are in the chat (up to 4). Each gets a persona from a prompt library: fun, technical, coach, support. The support persona says it is not a licensed therapist and shows the 988 Suicide and Crisis Lifeline note. Each AI gives 2 to 3 short replies per message.

### Phases 45 to 51: No-API app control (version 0.4.9, Antigravity first, not done)
Version 0.4.9. Antigravity comes first: the local `agy` CLI, after Allow, and only then the doors below. Antigravity is not a stored password and not a read of its tokens. From docs/plans/app-control.md (PR #47, not merged). Three doors (MCP first, websites through Playwright driving system Edge, Windows desktop through UI Automation), with screenshot computer use as an opt-in fallback. Safety for every phase: per-app Allow, a second click for send, buy or delete, a "Meldmind is using X" banner with Stop, and no stored passwords. Each phase lands with fixture drivers only, `npm test` and `npm run smoke` green. Open pull requests 62 and 65 are not done.

### Phase 45: App cards (effort: M) (version 0.4.9, not done)
A settings list of apps: name, kind, task types, origin, exe or existing MCP server, spend cap. Draft until Allow. A hub card, `registerExternalAgent()`, and a mock dispatch. Revoke hides the app from the planner.

### Phase 46: Score and missions (effort: M) (version 0.4.9, not done)
Apps get starting scores from `added-caps.js` and record outcomes through the brain. Mission steps can name an approved app. Writing steps still go to text models; Grok Bot and the browser helper keep their tags.

### Phase 47: MCP as an app (effort: M) (version 0.4.9, not done)
An existing MCP server can be marked as an app with task types. Tool calls stay on the one MCP client and its approval gate.

### Phase 48: Websites (effort: L) (version 0.4.9, not done)
Playwright drives system Edge with a Meldmind-owned profile, reusing the helper's action list, confirm gate, step cap and spend cap. Password fields are refused. Banner and Stop.

### Phase 49: Signed-in profile (effort: M) (version 0.4.9, not done)
Opt-in use of the person's Edge or Chrome profile, off by default. Refuses to start while that browser is running, and warns about cookies and site terms.

### Phase 50: Windows desktop (effort: L) (version 0.4.9, not done)
UI Automation for one allowlisted exe. Same confirm gate and banner. Losing focus stops input. Password edits are refused.

### Phase 51: Screenshot fallback (effort: L) (version 0.4.9, not done)
Anthropic and OpenAI computer-use tools, per app, off by default. Downscaled pictures, old pictures dropped, a cost estimate first, and a $1.00 default cap. Square and billing screens are refused.

## Version 0.4.9 phases (not done)

### Phase 66: Onboarding with the mode choice and extra Expert setup (version 0.4.9, not done)
The first setup step asks which mode to start in, Simple or Expert, with one line each. It replaces a separate mode popup. The choice can be changed later from the top bar.
- Simple: one key, or Try it now (demo). Then the chat. No history scan, and Get everything connected does not open on its own. Starter buttons fill the box and do not send.
- Expert, the first time: a short extra setup the person can skip (more AIs, councils and missions, integrations). A history scan stays off until it is ticked.
- Decision 20 stays: setup runs once, the flag lives in the user data folder, and a later launch opens the hub. Saving a key does not open setup again.

### Phase 67: Few-facts fix (version 0.4.9, not done)
A guessed Pro prompt must not block Send. Chris hit "I need a few facts before I can run ..." on 0.4.8 and the typed orders never left.
- The typed orders go out. A guessed template stays a suggestion. Send without it drops that guess and sends the typed orders.
- A template the person chose, or a clear phrase that matches on purpose, can still ask for a missing fact. The model does not invent facts (Phase 30). This phase does not remove that halt for a chosen template.

### Phase 68: Safety, sharing, and plain words (version 0.4.9, not done)
- Safety stays Phase 30: unverified numbers marked [VERIFY], outbound text as drafts, SSNs, dates of birth, and account numbers stripped, SCF mode adding CROA and RESPA. New 0.4.9 screens use those rules. Do not rewrite them.
- Sharing stays the shipped words: task type, which AI, and the score. Never prompts, content, or keys. The person can change it in Settings.
- Plain words on the new onboarding, the graduate notice, and the welcome email. No em-dashes in user-facing text.

### Phase 69: Program scan (version 0.4.9, not done)
When desktop control is on, list installed programs and let the person allow each one. Allowed apps are scored like a tool they add, and the router can pick them.
- Opt in from Setup or Settings. Names only: Windows uninstall entries, Start menu shortcut names, and command-line tools on PATH. Do not read file contents.
- While a mission is planned, a card may suggest a program, with a short reason, Free or Paid, and the official link. Nothing is installed or bought. Suggestions can be turned off.
- The scan is a Pro feature. Free can see the lock and can turn a scan off.

### Phase 70: Save in place (version 0.4.9, not done)
An edit to a chat, a doc, or a connected file saves back onto that same item. One click. No second copy unless the person asks for one. Send, share, and delete still need their own click.

### Phase 71: Welcome email (version 0.4.9, not done)
Decision 22, spec unchanged. Chris added it to this run order on 2026-10-21. Do not rewrite the spec.
- On sign-up or license redeem, send a plain welcome email.
- Explain their account, that chats and settings back up to the cloud automatically (hosted on Everborn's Supabase, each user sees only their own data via RLS), and how to add AI keys or connect via MCP.
- No income or results claims.
- Do not touch Square or billing. Nothing sends until the mail provider is configured. Tests never send.

### Phase 72: Graduate notice (version 0.4.9, not done)
When a handoff-only AI gains its own API or MCP route, ask once: "X can now run directly. Add it to councils and missions?"
- Add it includes that AI in councils and missions. Not now dismisses the ask. The ask sits with the chat box, not in the answers.
- Grok Bot stays a webhook for signed-in tasks. An xAI key is Grok the model and does not raise this ask.
- Claude, ChatGPT, Grok, and Gemini are not graduate routes. Nothing is added without the click.

## Version 0.4.10 phases (not done, except where marked)

Phase 14 (unsigned Mac build, right-click Open) is specified above. Share links (Phase 4), accessibility (Phase 11), and imported chats (Phase 23) are DONE.

### Phase 73: Private mode (version 0.4.10, not done)
A switch on a chat. That chat is not added to history and is not included in the cloud backup. Off by default. Keys are never written into the chat.

### Phase 74: See who reads the prompt (version 0.4.10, not done)
Before Send, show which AIs, tools, and connected services will receive the prompt. The person can remove one. Nothing is sent until Send.

### Phase 75: Backup and restore (version 0.4.10, not done)
Download a backup of chats, projects, and settings. Restore from that file on a click. Keys stay in the vault and are not in the file.

### Phase 76: Do this again (version 0.4.10, not done)
On a finished job, Do this again runs the same orders again, and only after that click. It does not repeat a send, post, buy, or delete on its own.

### Phase 77: Home screen (version 0.4.10, not done)
The screen after setup: recent chats, a place to start, and what is still running. Decision 20 stays: a later launch does not open first-run setup.

### Phase 78: Delete with receipt (version 0.4.10, not done)
Delete asks first. After it, a receipt lists what was removed. The receipt can be saved. Nothing is deleted without the click.

### Phase 79: Double-check (version 0.4.10, not done)
A button on an answer asks a second AI to review it. The review is labeled as a check. It does not replace the answer until the person accepts it. This is not the Deep Research check in Phase 89.

### Phase 80: Tone buttons (version 0.4.10, not done)
Buttons on the chat box set the tone of the next answer (for example shorter, more direct, friendlier). They do not send by themselves.

### Phase 81: AI credits (version 0.4.10, not done)
A plain screen named AI credits that shows what is left for each AI, using the numbers Phase 25 already collects. Do not rebuild the subscriptions page or the receipt scanner.

### Phase 82: My chats (version 0.4.10, not done)
A list of the person's chats. Open one, or start a new one. Phase 23 import can land in this list. Do not rebuild the importer.

### Phase 83: Answers name their AI (version 0.4.10, not done)
Every answer shows the name of the AI that wrote it, including a single answer and each council seat. Phase 17 already names the model on a side-by-side column. Do not rebuild that view.

### Phase 86: First council explained (version 0.4.10, not done)
The first council includes a short plain explanation: several AIs answer, then one verdict. It shows once.

### Phase 85: PDF and DOCX export (version 0.4.10, not done)
Export an answer or a project deliverable as PDF or DOCX. The file downloads on a click. Nothing is sent.

### Phase 84: Industry packs (version 0.4.10, not done)
Prompt and starter packs grouped by industry. Picking one fills the orders and stays editable. Nothing runs until Send.

## Version 0.4.11 phases (not done)

Phase 40 (learned from ratings) is specified above.

### Phase 87: Background runs (version 0.4.11, not done)
Leaving the screen does not stop a council or mission. A quiet indicator shows that it is still running. Phase 22 schedules stay as they are: they run while the desktop app is open. This phase is not the hosted hub.

### Phase 88: Mission pause (version 0.4.11, not done)
Pause holds a mission where it is. Resume continues from that step. Pause does not send, post, or delete. Stop still exists.

## New phases after 0.4.11 (not done)

### Phase 89: Research (not done)
Phase 15 (DONE) is web search with citations and source chips. This phase adds the rest. It does not rebuild Phase 15.
- Pro Search: a deeper pass on the same kind of cited sources.
- Deep Research: a longer research run, then a second AI checks the result before it is shown.
- Filters for academic sources and for news.
- Search calls stay in the ledger and inside spend caps. Demo mode uses a mock. Tests never call a real search API.

### Phase 90: Zapier and Make, both ways (MCP by URL and webhooks moved here) (not done)
Runs after 0.4.11 and before Later. Moved earlier from Phase 33.
- Zapier, both ways: Meldmind can start a Zap, and a Zap can start a Meldmind action.
- Make, both ways: the same.
- MCP by URL: any user MCP server by URL, on the Phase 16 client. Do not add a second MCP client.
- Custom webhooks: a URL, an auth header, and an input schema.
- Anything that sends, charges, or modifies data waits for a confirm click. Keys stay in the vault and are never logged.

### Phase 96: Remix any app (after Phase 90, before Phase 91, not done)
A Pro mission. Extreme has no cap on Remix missions. The Pro cap is set when this phase is built. It does not change the live Square checkout, and it does not rebuild Phase 36 or Phase 91.
The person shows an app or a game they saw online or on their desktop: screenshots, a recording, or desktop control (Phases 45 to 51, and only after Allow). The AIs write down how it behaves, then rebuild it from scratch with the person's own characters, name, and look.
- Free open-source code, engines (Godot, Phaser), templates, and free art may be pulled from the internet. Each item keeps its license check and its credits. If the license is missing or is not free to use, it is not used.
- Official mods are supported for Minecraft, Roblox, Godot, and Unity, through those products' own mod tools.
- The person's own art can be turned into sprites, models, and voices.
- Before the result is saved, Meldmind warns when the name, look, layout, or characters are too close to the original. Saving still needs a click.
- It learns as it goes. The router records which AIs, which engines, and which kinds of open-source sources worked best for that app type. It learns from the person's ratings and from the fixes they ask for. It keeps a library on this computer of working patterns and components from their own remixes, so the next one starts further along.
- That learning uses the router and the shared-learning opt-in that already exist (decision 18, Phase 28). The record is the app type, the AI, the engine, the kind of source, the rating, and whether a fix was needed. It does not store the prompt, the screenshots, the original name, the characters, or any key. Nothing is shared unless the person has opted in. What would be shared is the same kind of anonymous totals as Who's best, and this phase does not send them on its own.
- Guardrails: never decompile, unpack, or reuse another app's code, assets, logos, or brand. The pattern library is the person's own remix, not files taken from the app they showed. Nothing is posted or sent without a click. Tests use fixtures only. No real download, no real game, and no real key.

### Phase 91: Three tiers and the lifetime founder counter (not done)
The plan prices are in docs/billing.md. The app still shows the Phase 35 prices ($15.99 a month, $159 a year, lifetime $299 then $499) until this phase. Do not change the live Square link until Chris publishes new Square plans. Do not call Square from the app.
- Free, Pro, and Extreme. Pro is $18.99 a month or $189 a year. Extreme is $29.99 a month or $299 a year.
- About 6 months after those prices go live, Pro monthly rises to $24.99 and Extreme monthly rises to $39.99. Yearly stays $189 and $299 until Chris sets a yearly change.
- Lifetime founders: $299 for the first 100 buyers, then $499 for the next 400, closed at 500. The buyer counter stays hidden while fewer than 40 people have bought.
- The Studio flag for workspaces (Phase 8, decision 13) stays. This phase does not add a fourth public price and does not rebuild teams.

## Later (Chris, 2026-10-21)

These wait until after Phase 91. Store listings, signed apps, and paid hosting need Chris's OK before any money is spent.

### Phase 92: User chat (Later, not done)
People chat with each other inside the app. This is not the AI group chat (Phase 44). Nothing is sent until the person clicks send. No keys are shared.

### Phase 93: Newsletter and monthly savings email (Later, not done)
An opt-in newsletter, and a monthly email of what was saved. Phase 4's weekly report stays in the app and is still a draft until a click. This email does not send until the person opts in. No income or results claims. Do not touch Square.

### Phase 94: Spanish (Later, not done)
The app's own words can be shown in Spanish. User content is not translated unless the person asks.

### Phase 95: Phone apps (Later, not done)
Native phone apps, as sketched in docs/mobile.md. The phone-sized web layout that already ships is not this phase. Store listings are separate and also Later.

### Store listings (Later, not done)
Publish the phone app on the Apple App Store and Google Play. Listings, screenshots, and privacy text. Nothing is submitted without Chris's OK.

### Signed apps (Later, not done)
Windows code signing so SmartScreen stops warning on first run. Apple Developer ID signing and notarization for the Mac build (the rest of Phase 14). Certificate secrets go in repo secrets only. The unsigned Mac build is version 0.4.10, not this item.

### Phase 52: Hosted online (web) version (effort: L) (Later, not done)
A hosted web version of the app, so it can be used in a browser without installing. Needs paid hosting. Going live needs Chris's OK before paying for anything.

## Planned, not in the run order (Chris, 2026-10-19)

Use your own Supabase (decision 23) stays here. Do not start them until Chris adds them to the run order above. The welcome email moved to Phase 71 on 2026-10-21. Its spec was not rewritten.

### Use your own Supabase
- Optional advanced setting named "Use your own Supabase", for power users and companies.
- Bring-your-own project URL and publishable key. Off by default. Never part of normal onboarding.
- Customers never need to create a Supabase account by default. The normal app uses Everborn's Supabase.
- Separate from the licence server connection already in Settings. Do not change that connection, and do not touch Square or billing.
