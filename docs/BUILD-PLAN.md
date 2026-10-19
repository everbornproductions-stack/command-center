# Command Center build plan (Chris, 2026-10-18: "a full working product that nobody else has")

Each phase is sized for one Claude Code session (about 1–2 hours). Run order: 1, 15, 16, 26, 28, 29, 25, 12, 27, 13, 17, 18, 19, 20, 21, 22, 23, 24, 14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 (12, 13, 15, 16, 25, 26, 28 and 29 were added on 2026-10-18 as high priority, 28 right after 26, 29 right after 28, 27 after 12; 17 to 24 are the competitor-review backlog; 14 is the Mac build: write PHASE 14 BLOCKED for any step that needs a real Mac). Read docs/DECISIONS.md first: locked decisions are never reverted or reworked. A phase starts only after the phase before it in that order shows PHASE N DONE in BUILD-LOG.md; phases already marked DONE (e.g. Phase 8, built early by Grok Bot) are skipped.
This plan includes the twelve items in `docs/roadmap.md` (marked R1–R12) and follows its plugin rules (`web/features/*`, `server/plugins/*`, data through `ctx()` from `server/store.js`).

## Rules for every phase (non-negotiable)
1. Read `README.md`, `docs/roadmap.md`, this file and the end of `docs/BUILD-LOG.md` first.
2. One commit per feature (`git add <your files>` only, never `git add -A`). Do NOT commit files you did not write in this phase. Other sessions may have uncommitted work here (e.g. workspaces files); leave it alone.
3. Write tests for every feature in `test/*.test.js` (node --test). Before each commit, run `npm test` and `npm run smoke`; both must pass.
4. Everything must keep working in demo mode (no keys). Use a throwaway data dir (`CC_DATA_DIR` set to a temp folder) for tests.
5. Never deploy, never push (Chris pushes), never touch Square, real API keys, `data/`, `.env`, password files, or billing. Nothing posts, sends, emails or spends without an explicit user click; outbound integrations need user OAuth.
6. Paid things (managed plan, trial credits, marketplace pricing) go behind a feature flag with PLACEHOLDER prices. Chris decides real pricing.
7. At the end, append to `docs/BUILD-LOG.md`: date/time, features done, commits (hash + message), test counts (npm test pass/fail, smoke pass/fail), what is not verified, and a final line exactly `PHASE N DONE` or `PHASE N BLOCKED: <reason>`.

## Phases

### Phase 1: First impression
- Color themes: light, dark, and accent colors, saved per user, applied across the app.
- Brand kit: upload a logo and pick brand colors; applied to the app header and to client share pages.
- Onboarding tour: first-run walkthrough that runs a demo sample mission (demo mode, no keys).
- Guided API-key setup: step-by-step per provider (where to get the key, paste, test call, store in the vault). Keys never logged or shown again.

### Phase 2: Proof of value
- Starter pipelines (R1): Instagram week, client proposal, music video plan; one click runs a mission, results filed under the project.
- Savings receipt per job (R7): "flagship-only would have cost X, this cost Y", Credits tab total, PNG export.
- Spend caps and alerts (R10): per-AI monthly cap, amber at 80%, router excludes at 100%, in-app alert.

### Phase 3: Quality loop
- Rate the result (R4): thumbs up/down feeding the router; the skills matrix shows human ratings separately.
- Project memory and brand voice (R5): voice, offers, never-say list, past winners injected per project; HQ client-file importer.

### Phase 4: Client-facing
- Live-share links (R8): read-only, expiring token URL mirroring one mission in real time, with the brand kit applied. No keys or costs shown unless toggled.
- Weekly report (R6): generated in-app every Monday (spend, low credits, renewals, what shipped, cancel suggestions); an email draft/export button only, nothing sent automatically.

### Phase 5: Hands-free and mobile
- Voice commands (R9): mic button using the Web Speech API, push-to-talk and an auto-send option.
- PWA and push notifications: installable app, service worker, web push (VAPID) for alerts and job done, opt-in only.

### Phase 6: Work with files and media
- Chat with files: drop PDFs, docs or images into a project and ask questions; chunks stored per project; works in demo mode with the mock provider.
- Media actions (R2): mission steps for video, image and voice through provider adapters, credit estimate first, ledger logging, outputs saved to the project. Stubbed in demo mode.

### Phase 7: Integrations (OAuth, post only on click)
- Connectors for Google Drive, Instagram (Meta Graph), HighLevel and Slack (R3): user OAuth flow scaffolding, tokens kept in the vault, "Save to Drive", "Post to Instagram", "Schedule in HighLevel" and "Send to Slack" buttons, each needing an explicit click. Mock adapters for tests; no real calls in tests.

### Phase 8: Teams
- Team seats and roles (R11): owner, admin, member and viewer; invite by email (invite link generated, not sent); per-role permissions; usage per member; Studio tier gate.

### Phase 9: Growth (feature-flagged, placeholder pricing)
- Free trial with credits: trial counter, gating and an upgrade prompt.
- "No keys needed" managed plan: the app routes through an Everborn-managed key pool when the flag is on; usage metering only; no billing integration.
- Referral rewards: referral codes and links, a credit ledger, and a rewards view.
- No real charges, no Square changes, all prices are placeholders.

### Phase 10: Marketplace
- Template sharing (R12): export or import a pipeline or template as a signed JSON file; a share link.
- Marketplace: listing page, install flow, moderation queue and revenue-share fields (placeholder); local and demo catalog only.

### Phase 11: Hardening and polish
- Full regression pass, accessibility, performance, error states, empty states, README and user guide, release notes. Fix anything flaky found in phases 1–10.

### Phase 12 (HIGH PRIORITY, added 2026-10-18): Grok Bot agent inside the Command Center
Chris wants the app to be the hub where all his AIs talk and decide who does what best; when Grok Bot (his assistant with its own computer, signed-in browser, Gmail, Drive, Calendar) is the best fit, the app hands it the job.
- Grok Bot appears as an agent/provider in council, router and mission modes, with capability tags: `signed-in-browsing`, `gmail`, `drive`, `calendar`, `teammate-bots`. The router prefers it for tasks that need those; it is never picked for plain text work another AI does as well.
- Settings > Integrations > Grok Bot: two fields, webhook URL and sender key, stored in the vault like other secrets (never in git, never logged, never sent to the browser after saving). A third optional field: header name, default `Authorization` with value `Bearer <key>`.
- Dispatch: POST to the webhook URL with the sender key header and JSON body `{job_id, task, context, workspace, callback_url}`. Only on an explicit mission/council step or user click; never in demo mode unless the mock is selected.
- Results come back to `POST /api/grokbot/callback/<job_id>?t=<per-job random token>` on the local server (the token is generated per job, stored hashed, compared with timingSafeEqual, single use for `done`). Payload `{status, text, artifacts}`; status is one of `queued`, `working`, `needs_approval`, `done` (plus `failed`). The result lands in that job's thread and graph node; the node shows the status. The UI says results are async and can take minutes.
- The callback endpoint must be exempt from the local session token (it uses the per-job token instead) and must reject everything else.
- Tests: a local mock webhook server only (random port); never hit a real URL in tests.
- Do not build a tunnel and do not deploy anything. Document that `callback_url` only works once Grok Bot can reach it: after the hosted hub exists or a tunnel is set up by Chris. Until then the job stays `queued`/`working` and the user can paste the result in by hand.
- Agents on the hub (expanded 2026-10-18): Grok Bot and the built-in browser helper (Phase 27) appear on the hub as their own cards next to Claude, ChatGPT, Grok and Gemini, with a live status light, an activity feed of what they are doing right now, and their results shown in the council next to the other answers (scored and credited the same way).

### Phase 27 (added 2026-10-18 by Chris): Built-in browser helper (effort: L, about 2 sessions)
For customers who do not have Grok Bot: a browser window inside the desktop app that an AI can drive for browsing tasks.
- A separate Electron browser window (its own session, never the person's main browser profile) driven step by step by the cheapest capable model (vision or DOM-reading), with a visible action log and a Stop button.
- Gmail and Google Drive through the person's own Google sign-in (OAuth, least-privilege scopes, tokens in the vault); read by default.
- Explicit OK required before any send, post, delete, purchase or form submit; the prompt shows exactly what will happen. Never stores passwords; never handles Square or billing.
- Appears on the hub as its own agent card (see Phase 12). Tests: a local mock site and mocked Google APIs; no real accounts or URLs.

### Phase 13 (added 2026-10-18): Organize my existing browser bookmarks
The first-run step that makes AI bookmarks also offers to organize the user's EXISTING bookmarks into smart, auto-named folders by topic (e.g. their business name, insurance, banking, tools, social), using the user's own API key to categorize.
- Read bookmarks from Chrome, Edge and Brave `Bookmarks` JSON files (per profile) and Firefox `places.sqlite` if practical (read-only copy). Only after the user picks the browser and clicks allow.
- Show a preview of the proposed folders; the user can rename folders, move items between folders, and uncheck items before applying.
- Back up the original bookmarks file first (timestamped copy next to it and in the app data folder) and offer one-click undo that restores the backup.
- Never delete bookmarks; only reorganize. Exact duplicates (same URL) are merged only after the user confirms the list.
- Before applying: warn the user to close the browser (Chrome/Edge/Brave overwrite the file while running); detect a running browser process and refuse to apply until it is closed. Remove the `checksum` field so Chromium accepts the edited file.
- Privacy: bookmark titles and URLs go only to the AI provider the user picked for categorizing, nowhere else; say so in the UI. Demo mode categorizes with the mock provider and a fixture file.
- Tests with fixture bookmark files in a temp folder; never touch a real browser profile in tests.

### Phase 15 (HIGH PRIORITY, added 2026-10-18 from a competitor review): Live web search with cited sources
- Pluggable search provider using the user's own key: Tavily, Brave Search, Serper, or the model's built-in search where supported (Perplexity, xAI). Keys in the vault like other secrets; never logged.
- A "Search the web" toggle per chat, council and mission (off by default).
- Results are injected into the prompt with numbered citations; answers show them as clickable source chips ([1], [2], ...) that open the source.
- Search calls respect spend caps (alerts plugin) and are logged in the ledger with their cost.
- Works in demo mode with a mock search provider; tests use a local mock only, never a real search API.

### Phase 16 (HIGH PRIORITY, added 2026-10-18 from a competitor review): MCP tool support
- Users add MCP (Model Context Protocol) servers in Settings > Tools: local stdio commands, and remote Streamable HTTP / SSE servers with OAuth or custom headers. Secrets (headers, tokens, env) go to the vault and are never logged or sent to the browser.
- The app lists each server's tools and lets the user enable them per workspace (Phase 8 workspaces; "Personal" when none).
- Any provider that supports tool calling can call enabled tools; calls are routed through the local server, never directly from the browser.
- Tools that write, send or delete need a per-call approval prompt in the UI (consistent with "nothing posts without a click"); read-only tools can run without one when the user allows it.
- Use the official `@modelcontextprotocol/sdk`. Tests with a mock MCP server (stdio and HTTP) on a temp dir / random port.

### Phase 26 (HIGH PRIORITY, core, added 2026-10-18 by Chris): Smart fallback (effort: M, about 1 session)
For every customer: a job never fails just because one provider is out of credits, rate limited or refusing the key.
- The router reads each provider's health (out of credits / spending limit, rate limited, key rejected, unreachable, spend cap reached) and auto-skips that provider for new work.
- It routes to the next-best model for the job by the person's priority (quality / balanced / economy), using speed, quality and cost from the registry and learned skills. The deliverable and the feed say which model stood in and why.
- If an OpenRouter key exists, it first retries the same model through OpenRouter (mapped model id) before switching models.
- Small jobs (short classify / summarize / title tasks) prefer free tiers where the user has them (for example the Gemini free allowance), never exceeding a free limit the app knows about.
- A provider switches back automatically when its credits or limit return (next successful health check or call); no manual reset needed.
- Every fallback call goes to the ledger and respects spend caps. Tests: mocked providers returning 402 / 403-credits / 429 / 401 / network errors, OpenRouter retry, free-tier pick, and recovery; no real URLs or keys.

### Phase 28 (HIGH PRIORITY, core, added 2026-10-18 by Chris): Learning router, the app's own brain (effort: L, about 2 sessions)
The router learns from every job which model is best at what, for the price, per user.
- Save per model per user: council scores, the person's thumbs up / down, cost, latency, success or failure, and the task type (capability and difficulty from the classifier). No prompt or answer content beyond the task type; never secrets, keys or personal data.
- The router uses this track record (with the registry's base scores as the starting point) to pick the best model per task for the person's priority (quality / balanced / economy), improving with each job; works together with Phase 26 smart fallback.
- A per-user "Who's best at what" view: per task type, the top models with win rate, average score, cost per job and speed, and how many jobs the ranking is based on. The person can reset it.
- Local first: stored in the user's data (hosted: their own rows). Export and delete with the rest of their data.
- Later stage (separate, opt-in only): aggregate anonymous, opt-in track records across users to train a small routing model of our own. Nothing is shared without an explicit opt-in.
- Tests: simulated job histories that change the ranking, thumbs and council scores weighting, cost and latency in the score, the reset, and a check that no prompt text or secrets are stored.

### Phase 29 (HIGH PRIORITY, added 2026-10-18 by Chris): Live project view (effort: M, about 1 session)
Every project and mission shows, in real time, who is working on it and what it costs.
- Per project / mission: which AI or agent is working right now (models, Grok Bot, the browser helper), the current step, and credits / cost used so far, updating live over the WebSocket.
- An "Open in <service>" link wherever the provider has a page for that job: for example the Kling task page for a video, and the usage dashboards of OpenAI, Anthropic and xAI for API spend. Links open in the person's browser; no scraping, no sign-in by the app.
- Note: chats made through the APIs do not appear in the claude.ai, grok.com or ChatGPT history, so the app itself is the place to watch the work. Say this in the UI where people would look for it.
- Tests: mocked mission events drive the live view (step, agent, running cost), and the link builder for each provider; no real URLs fetched.

### Phase 25 (HIGH PRIORITY, added 2026-10-18 by Chris): Subscriptions and services page (effort: L, about 2 sessions)
One page that shows every paid AI service, what is left, what it costs this month and when it renews. Builds on the existing subscriptions tracker (server/subscriptions.js) and the spend caps and alerts plugin.
- (a) API providers, live where an API exists: OpenRouter credits and key info (`/api/v1/credits`, `/api/v1/key`), DeepSeek `/user/balance`, OpenAI and Anthropic usage and cost APIs through an OPTIONAL admin key (stored in the vault like any key, never required), xAI and Gemini where an endpoint is available, otherwise month-to-date spend from the ledger. Per provider show credits left, month-to-date spend, and amber/red alerts tied to the existing spend caps.
- (b) Subscriptions without an API (Google AI Pro / Ultra with Flow, Kling, Suno, ChatGPT Plus, Claude Max, Midjourney, ElevenLabs and similar): an optional, read-only Gmail or Outlook OAuth connection (read-only scope only) scans receipt and renewal emails and extracts service, plan, price, billing cycle and next renewal date. Each extracted row shows a confidence and a link to its source email; the user confirms or edits before it is saved. Never store full email bodies, only the extracted fields plus the message id. Manual add and edit is always available, with or without the email scan.
- (c) Renewal reminders (desktop notification, or push through the alerts plugin) N days before each renewal (N set per row, default 3), a monthly total across APIs and subscriptions, and a "possible duplicate or unused" hint (for example two plans from one vendor, or a paid service with no ledger or credit activity in 30 days).
- (d) Label every field in the UI as auto-detected (API or email, with confidence) or entered by the user. Tests: mocked provider balance and usage APIs on a random local port, and sample receipt emails (fixtures with fake data only) for each listed service, including a low-confidence case and a parse failure; never a real inbox, key or URL. No em-dashes in user-facing text. Never touch Square or billing.
## Competitor-review backlog (added 2026-10-18, after Phases 15 and 16)
Every item below must respect: bring-your-own-key (the user's keys only), spend caps, a ledger entry for every paid call, nothing posts or sends without an explicit click, and no secrets in logs or git. Each works in demo mode with mocks; tests never call a real API.

### Phase 17: Side-by-side comparison (effort: M, about 1 session)
- One prompt goes to 2 to 6 chosen models; answers stream into parallel columns with cost and latency per column.
- "Pick winner" records a rating (Phase 3 ratings) and feeds the router; presets of model sets can be saved and reused.
- Acceptance tests: 3 demo models answer in parallel and each column reports cost and latency; picking a winner writes a rating the router reads; a preset saves and reloads; a column whose provider is at its spend cap is skipped with a note; every call has a ledger entry.

### Phase 18: Knowledge libraries (RAG) (effort: L, about 2 sessions)
- Libraries built from uploaded files and folders, plus Google Drive and Notion through OAuth (read-only scopes).
- Chunk, embed with the user's chosen embedding key, store locally (SQLite with a vector extension or LanceDB), hybrid search (keyword plus vector), cited answers with source chips. Attach a library per chat, workspace or agent.
- Acceptance tests: a fixture folder is indexed with a mock embedder; a question returns an answer citing the right chunk; keyword-only and vector-only queries both find their target; deleting a library removes its index; Drive/Notion adapters are mocked and request read-only scopes only; embedding calls are logged in the ledger and respect caps.

### Phase 19: Custom agents and a prompt library (effort: M)
- Named agents: model, instructions, tools (Phase 16), libraries (Phase 18) and starter prompts. Saved prompts with {{variables}} filled in a small form before sending.
- Agents and prompts export/import as JSON, are shareable to a workspace, and can be listed in the Marketplace (Phase 10).
- Acceptance tests: create, edit, run and delete an agent on demo models; {{variables}} are required and substituted; export then import round-trips; a shared agent is visible to a workspace member and read-only for a viewer.

### Phase 20: Artifacts side panel (effort: M)
- Generated HTML/JS, charts, markdown and mini apps render and run in a sandboxed iframe (sandbox="allow-scripts", no same-origin, no network to the local API), with versions, edit and re-run, and export (file download). Optional Python via Pyodide in a worker.
- Acceptance tests: an HTML artifact renders inside the sandbox and cannot read the session token or call /api; editing creates version 2 and the old version stays; export produces the file; Pyodide is lazy-loaded and a simple script returns output (skip in CI if offline).

### Phase 21: Image generation in chat (effort: M)
- Through the user's keys: OpenAI GPT-Image, Gemini, xAI, Flux via Replicate or fal. Generate, edit and variations; results saved to the media gallery (Phase 6 media).
- Cost estimate shown first; ledger entry per image; spend caps respected.
- Acceptance tests: mock adapters for each provider return an image saved to the gallery with its prompt; edit and variation requests carry the source image; a provider at its cap is refused; no key means a clear "add a key" message.

### Phase 22: Scheduled and triggered agents (effort: L)
- Run an agent or mission on a cron schedule, from a webhook (per-trigger secret token) or when a new file lands in a watched folder. Run history, a spend cap per schedule, and an approval step for anything that posts or sends.
- Note in the UI and docs: desktop schedules only run while the app is running (tray counts); always-on schedules need the hosted hub later.
- Acceptance tests: a fake clock fires a cron job once per slot; a webhook with a wrong token is refused (401) and a right one queues a run; a new fixture file triggers a run; a schedule over its cap stops and alerts; a posting step waits in "needs approval".

### Phase 23: ChatGPT and Claude history import, optional encrypted sync (effort: M)
- Import conversations from the ChatGPT and Claude export zips into projects and chats (no upload anywhere).
- Optional sync of chats between desktop and phone through Supabase, end-to-end encrypted with a key derived from a user passphrase (the server stores ciphertext only). Off by default.
- Acceptance tests: fixture export zips import with titles, dates and messages intact; a bad zip fails with a clear message; the sync payload stored in the (mocked) Supabase layer is ciphertext and decrypts on a second client with the same passphrase only.

### Phase 24: Smaller extras (effort: S each)
- Global hotkey quick-launcher on desktop (default Alt+Space, configurable; must not steal it if the OS or another app owns it).
- Chrome/Edge extension: send the page or a selection to a chat or council on the local app (paired with a token; nothing sent elsewhere).
- Live model pricing from the OpenRouter models API, feeding the router, ledger estimates and savings receipts (cached daily; manual overrides win).
- Team SSO (Google and Microsoft OIDC) for the hosted hub, and per-workspace API keys (stored in the vault, scoped to the workspace).
- Acceptance tests: hotkey registration is mocked and unregisters on quit; the extension's message is accepted only with the pairing token; a pricing fixture updates the router's costs and an override wins; OIDC flows are mocked; a workspace key is used only for that workspace's calls.

### Phase 14 (low priority, added 2026-10-18): Mac build
- `docs/ci/mac-build.yml` (added by Grok Bot; move it to `.github/workflows/` after `gh auth refresh -s workflow`) builds an unsigned `.dmg` and `.zip` (x64 and arm64) on macos-latest, on manual dispatch or a `v*` tag, and uploads them to the same public releases repo. It needs the repo secret `RELEASES_TOKEN` (fine-grained token, Contents read/write on command-center-releases only).
- Check that the app runs on a Mac: server start, Keychain vault (`safeStorage`), tray, window, data folder `~/Library/Application Support/Everborn Command`.
- TODO, needs an Apple Developer account ($99/year, Chris decides): Developer ID signing and notarization (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repo secrets, `notarize: true`). Until then Gatekeeper warns on first open and in-app updates do not work on Mac.
- Never block the Windows installer on this. In the chain after Phase 24; any step that needs a real Mac to verify is written as PHASE 14 BLOCKED with the reason.
