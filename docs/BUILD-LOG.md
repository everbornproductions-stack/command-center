# Command Center build log

Each phase appends its results here and ends with a line `PHASE N DONE` or `PHASE N BLOCKED: reason`.
The chain script (C:\Users\chris\terminals\cc-build-chain.ps1) skips every phase that already has a `PHASE N DONE` line.

## 2026-10-18 evening: state before Claude's 8:10 PM reset (written by Grok Bot)

Phase 1 is NOT finished. Done and committed: color themes (fda7415), brand kit (42e1a86), onboarding tour (f39f4c4, written by Claude, committed by Grok Bot after npm test 40/40 and smoke 16/16). Left for Phase 1: guided API-key setup, then the Phase 1 log entry and `PHASE 1 DONE`.

Also committed by Grok Bot from the desktop sessions' uncommitted work (verified there in demo mode, tests passed here): spend caps and alerts (74d9cca), weekly report (b16554a), live-share links (6b7088c), media actions (3696358), publish (772eaea), phone More sheet and project memory in orders (1c2a148). Phases 2, 4, 6 and 7 overlap these; check what exists before rebuilding anything.

In-app updates (Chris's priority, not a numbered phase), built by Grok Bot: 60fe505. electron-updater with the public releases repo everbornproductions-stack/command-center-releases, Settings > Check for updates, banner with Update and restart, PWA refresh prompt, version 0.2.0. See docs/RELEASING.md.

## 2026-10-18 19:15 PT: Phase 8 (Teams), built by Grok Bot

- Teams and shared workspaces: roles owner, admin, member, viewer with one permission table; invite by email creates an invite link shown once (only a SHA-256 hash is stored, 14-day expiry, nothing emailed); owners/admins change roles and remove people (admins only manage members and viewers); share chosen projects; usage per member for calls made while a workspace is active; header workspace switcher; Studio tier gate on every write; local-first (works offline on the desktop), cloud through the existing Supabase layer.
- Supabase: supabase/workspaces.sql updated as a migration file only (roles, invite hash, expiry, ws_role, ws_can_manage, ws_accept_invite, ws_join_by_email, role-aware RLS). NOT run against the live database.
- Commits: d040f0b (migration), 112ed58 (server plugin; PATCH bodies are now read), 46c395b (Workspaces tab and switcher), b6f889a (tests and docs).
- Tests: npm test 52/52 pass, npm run smoke 16/16 pass (demo mode, temp data dir).
- Not verified: hosted mode against the real tables (needs workspaces.sql applied and a second signed-in email); the UI was syntax-checked and covered by API tests, not clicked through in a browser.

PHASE 8 DONE (built by Grok Bot)

2026-10-18 20:05 PT (Grok Bot): v0.3.1 hotfix shipped outside the phase chain: installed app no longer attaches to a foreign server on port 4747 (root cause of 'fetch failed' key checks), Google Gemini card, custom providers with presets, paste-any-key detection, demo AIs retire after the first real key, clear network vs key errors. Added Phase 25 (Subscriptions and services page) to BUILD-PLAN, run order after 16.

2026-10-18 20:35 PT (Grok Bot): v0.3.2 shipped outside the phase chain: updater in the Electron main process (electron/updater.cjs) with a launch prompt that works without the engine or UI, engine watchdog (electron/watchdog.cjs) with native Restart / Install update dialog, tray Check for updates, local engine-down page (electron/offline.html), Restart engine panel in the web UI after 15 s of reconnecting, second launch focuses the open window.

2026-10-18 20:45 PT (Grok Bot): v0.3.2 also fixes the reload loop (safeReload, no service worker in the desktop app, caches cleared on version change, loop breaker), trims keys, keeps provider error wording (credits / workspace / key rejected) and adds the optional Anthropic workspace ID. Locked decisions are in docs/DECISIONS.md (read first). Plan: Phases 26 (Smart fallback), 28 (Learning router), 27 (Built-in browser helper) added, Phase 12 expanded with agent cards; run order 1, 15, 16, 26, 28, 25, 12, 27, 13, 17-24, 14, 2-11.

## 2026-10-19 03:55 PT: Phase 1 (First impression), finished by Claude

Already committed before this session: colour themes (fda7415), brand kit (42e1a86), onboarding tour (f39f4c4). This session added the last piece.

- Guided API-key setup: `server/plugins/keysetup.js` (GET /api/keysetup, POST start / skip / complete / reset / save), `web/features/keysetup.js` (step-by-step overlay, Settings panel, `window.CC.keysetup.open()` which the tour's last stop already calls), one-line mount in `web/features/index.js`, README row.
- Per provider: why you would want it, the numbered steps on the provider's site, "Open the key page" link, what the key looks like, paste, Test and save. The server runs the existing health check as the test call and only then keeps the key: green and amber (real key, no credits, with the billing link) are sealed in the vault; "Key rejected" and "Could not reach" keep nothing and put the previous key back untouched (workspace ID and custom headers included). A key pasted into the wrong step is pointed at the right one (paste detection, decision 10). Demo AIs retire after the first real key as before (decision 11).
- Keys are never logged, never echoed, never written outside the vault; only the masked form is shown. Kling takes access and secret keys; Anthropic keeps the optional workspace ID.
- Commits: fbb75e1 (feature and tests), plus this log entry.
- Tests: npm test 80/80 pass (test/keysetup.test.js adds 4: guides and order, verdict, and a server run against local mock providers for rejected / working / out-of-credits / unreachable keys, progress file, key never in a response or the log); npm run smoke 16/16 pass. Both run in a temp data dir with mocks; no real URL or key.
- Not verified: the overlay and Settings panel were syntax-checked (node --check) and exercised through the API tests, not clicked through in a browser; no real provider was called. `.claude/launch.json` has an uncommitted change from another session and was left alone.

PHASE 1 DONE

## 2026-10-19 04:15 PT: Phase 15 (Live web search with cited sources), built by Claude

- Core: `server/search.js`. Engines Tavily, Brave Search and Serper with the person's own key (vault id `search-<engine>`, env fallback TAVILY_API_KEY / BRAVE_SEARCH_API_KEY / SERPER_API_KEY), or the model's own search (Perplexity Sonar; xAI Live Search via `search_parameters`, citations captured in `server/providers.js`). Engine choice: auto (first keyed engine, else the model's own, else the demo engine), a named engine, or "model". Results per search 1 to 10 (default 5).
- Toggles: "Search the web" per Single, Council and Mission in Command, all off by default, saved server-side (`search.settings`); a request may also pass `search: true|false`. Single: one search, block appended to the prompt. Council: one search shared by every member and the chair (the chair is told to keep the [n] numbering); a member with its own search adds its pages after the shared ones. Mission: one search on the goal rides along as context for the planner and every task; a task marked needWeb gets its own search, numbered after the mission's; the assembler gets the full list. With an engine on, needWeb tasks may go to any model (before, they were limited to Perplexity and failed without it).
- Citations: `WEB SEARCH RESULTS` block with `[n] title (host)`, url and snippet; the UI (`web/features/search.js`) shows source chips under the deliverable and turns `[n]` in the answer and in council answers into links. Sources are persisted on the run (`sources`, `searchEngine`).
- Ledger and caps: every search is a `kind: "search"` ledger line (provider `search-<engine>`, the text provider for built-in search, `demo-search` for demo) with its cost, no query text; `ledger.recordSearch`, totals `searches` / `searchMonth`. Prices are editable per engine (list prices 2026-10-18: Tavily $0.008, Brave $0.005, Serper $0.001 per search; Perplexity $0.005 per request; xAI $0.025 per source). Monthly caps per engine in Settings > Web search are merged into the alerts plugin (amber at 80%, stop at 100%, notifications as for AIs); at the cap a search is refused and the run goes on without the web, with a log line.
- Keys: Settings > Web search, paste, one test search, then the vault; a rejected or unreachable key is never kept and the previous key is put back; masked only, never logged. "Search now" in Settings runs one search by hand (costs one search, says so).
- Demo mode with no key: a pretend engine (example.com pages, no network, no cost).
- Commits: e1b0dc4 (feature and tests), plus this log entry.
- Tests: npm test 85/85 pass (test/search.test.js adds 5: engines and defaults, parsing and the prompt block, query shaping, citation dedupe, and a server run against local mock Tavily / Brave / Serper, a mock OpenAI-compatible model that lets the test read the injected prompt, and a mock xAI returning citations: refused key never kept, toggles, [n] block, ledger lines, caps, built-in search, council, mission, demo engine, key never in a response or the log); npm run smoke 16/16 pass. No real search API, model or key was called.
- Not verified: the UI (toggles, source chips, Settings panel) was syntax-checked and its API covered by tests, not clicked through in a browser; the real Tavily / Brave / Serper request and response shapes and xAI's `search_parameters` field were written from their published docs and only exercised against mocks; a first real search will confirm them. `.claude/launch.json` and `cc-names.tmp.mjs` are uncommitted work from another session and were left alone.

PHASE 15 DONE

## 2026-10-19 04:45 PT: Phase 16 (MCP tool support), built by Claude

- Core: `server/mcp.js` (servers, per-workspace enablement, the approval gate, OAuth, the chat-with-tools loop), `server/mcp-client.js` (the Model Context Protocol client over three transports), `server/plugins/mcp.js` (the routes, mounted at `/api/tools`), `web/features/mcp.js` (Settings > Tools, the approval prompts, the deliverable chips), `server/mcp-demo-server.js` (a local stdio tools server for demo mode and the tests).
- Add servers in Settings > Tools: a local command (stdio), a remote Streamable HTTP server, or an older HTTP+SSE server. Secrets (headers typed as `Name: value`, environment values as `NAME=value`, and OAuth tokens) go to the vault under `mcp-<id>` and never return to the browser; views carry only the names and a signed-in flag. The client speaks MCP `2025-06-18` and accepts `2025-03-26` and `2024-11-05`: JSON-RPC over stdio (newline framed), Streamable HTTP (one endpoint, `Mcp-Session-Id`, JSON or SSE answers), and legacy HTTP+SSE (endpoint event then POSTs). Windows wraps `npx` / `uvx` / `.cmd` shims through the command shell so they start.
- Enable tools per workspace (Phase 8 workspaces; "Personal" when none): each server keeps its enabled set per workspace key, so switching the header workspace changes which tools a run gets. The app lists each server's tools with their descriptions and schemas.
- Tool calling: `chatWithTools` wraps `streamChat` and is used by single chat, council member answers and mission task work (not by the planner, QA, classifier or assembler, which stay tool-free). Any tool-calling provider can use enabled tools; Perplexity (no function calling) is skipped, and a provider that rejects tools once falls back to answering without them for that run. Tool definitions go out as OpenAI `tools` or Anthropic `tools`; tool calls are assembled from the stream, run through the local server, and fed back as `tool` / `tool_result` turns for the next round (capped at a configurable number of rounds, default 8). Usage is summed across rounds into one ledger line.
- Approvals: a tool that writes, sends or deletes asks for an explicit OK every time (an in-app prompt with the server, tool and arguments; Allow once / Deny; it times out as a deny after 10 minutes). Read-only tools can run without a prompt only when the person turns that on for the server; the read-only decision comes from the server's `readOnlyHint`, overridable per tool. A denied tool returns a message to the model and the run continues. Calls are logged (what ran, whether it worked, how long) with no arguments or results stored.
- OAuth for remote servers (MCP authorization): protected-resource and authorization-server metadata discovery, dynamic client registration when offered, PKCE (S256), the `resource` parameter, and automatic refresh before expiry. The browser returns to the app with the code and the Tools panel finishes the exchange; tokens live in the vault. A custom `Authorization` header is also supported for servers that just want a static token.
- Demo mode: "Add demo tools" mounts `server/mcp-demo-server.js` (a clock and word counter, read-only and running without a prompt; a notepad that asks first) and the pretend AIs call a tool when the orders mention one, so the whole flow works with no key and no network.
- Route note: the plugin is served at `/api/tools` (its `export const id` is `tools`), which also matches the "Tools" UI. This avoids a sandbox HTTP proxy in the build environment that re-frames any loopback response whose request path ends in `/mcp` or is `/sse` as malformed chunked transfer (a plain Node server reproduces it; it is not in this code and does not happen on a normal machine). External MCP server URLs ending in `/mcp` or `/sse` are reached through the client's `fetch` and are unaffected.
- Commits: 29773ab (feature and tests), plus this log entry.
- Tests: npm test 93/93 pass (test/mcp.test.js adds 8: validation, read-only / approval policy, result shapes and the Windows spawn wrapper, the stdio client against the demo server, the Streamable HTTP and SSE clients against in-test mock servers with a 401-to-metadata hint, then the running server with a mock tool-calling model for per-workspace enablement, allow / deny, read-only policy and overrides, tool calls recorded on single / council / mission, a manual call, the master switch and per-request flag, remote servers with headers in the vault, full OAuth sign-in with dynamic registration + PKCE + refresh, and demo mode; every test asserts no secret appears in a response or the log). npm run smoke 16/16 pass. No real MCP server, model or key was contacted.
- DEVIATION from the phase spec: the spec says "Use the official `@modelcontextprotocol/sdk`." That dependency could not be installed in this autonomous run (`npm install` needs network/permission this run did not have), so a small, spec-compliant client was written in `server/mcp-client.js` instead. Its `McpClient` interface (`connect`, `listTools`, `callTool`, `close`) mirrors the SDK's client so `server/mcp.js` can be pointed at the SDK later with no other change. `package.json` was left unchanged (no uninstalled dependency added), so the app and tests run as-is. Follow-up for Chris: run `npm install @modelcontextprotocol/sdk` on the PC, then this client can be swapped for the SDK's `Client` and transports.
- Not verified: the Settings > Tools UI and the approval prompts were syntax-checked and their API covered by tests, not clicked through in a browser; real third-party MCP servers (filesystem, GitHub, Notion) and a real OAuth provider were written to the published MCP spec and only exercised against mocks; a first real connection will confirm the transport and auth shapes. `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone.

PHASE 16 DONE

## 2026-10-19 09:20 PT: Phase 26 (Smart fallback), built by Claude

- Core: `server/fallback.js`. A trouble table per user (document `fallback.state`) remembers which provider is skipped for new work, why (out of credits or spending limit, rate limited, key rejected, unreachable, provider error, monthly cap) and until when (cooldowns: rate 90 s, unreachable and provider error 3 min, credits 15 min, key 30 min; the cap comes live from the alerts plugin). It is filled by failed calls and by the health lights (`provider.status` events: red or amber with a known cause marks it, green clears it), so a provider switches back on the next successful health check or call with no manual reset. `router.rank` leaves troubled providers out while another is available, so councils, missions and auto-routed chats never pick one.
- `fallbackChat` wraps `chatWithTools` (Phase 16 tools still ride along) and is now behind every call: single answer, council members / reviewers / chair, mission planner / specialists / QA / revision / assembler, and the classifier. When a call fails for one of those reasons (status 402 / 429 / 401 / 403 / 5xx / network, or credit and quota wording in the provider's message such as xAI's 403 "used all available credits", OpenAI's 429 "insufficient_quota" and Anthropic's 400 "credit balance is too low"), the provider is marked, the same model is retried through OpenRouter first (mapped id: `anthropic/`, `openai/`, `x-ai/`, `google/`, `deepseek/`, `mistralai/`, `perplexity/`; open models keep their id) when an OpenRouter key exists and OpenRouter itself is not skipped or capped, then the next-best model by the person's priority (quality / balanced / economy) from `rank` (registry speed, quality and cost plus learned skills), never a provider already tried, troubled or at 100% of its cap, and never another council member's model. Up to `maxHops` stand-ins per call (default 3). A provider known to be in trouble is skipped before the first call. Abort signals are never retried.
- Saying so: every hop is a `{ type: "fallback" }` event; callers reset streamed text, emit `agent.error` for the old agent, `agent.msg` (stand in via OpenRouter: reason) and `agent.start` for the stand-in with a "standing in for X (reason)" label, plus a log line "X could not take this job (reason). Y is standing in." Runs keep `fallbacks[]` (single, council, mission) and the stand-in sits on the member, chair, planner, task (`standIn`, plus the existing "re-assigned" chip) and assembler; `web/features/fallback.js` shows "Stood in" chips under the deliverable and "Standing aside" chips in Command.
- Free tiers for small jobs: `FREE_TIERS` (Google AI Studio: Gemini 3.8 Flash and 3.5 Flash-Lite, 250/day and 10/min; OpenRouter free route 50/day and 20/min; Groq 1000/day and 30/min; conservative list values from 2026-10-18, editable per provider in Settings; Google and OpenRouter on by default, Groq off). `rank({ small: true })` gives an eligible free model a 40-point bonus; `cheapest()` (classify) and the mission QA reviewer pick that way, and any stand-in for a small job (maxTokens up to 700) prefers it. Eligibility counts every call on the tier's models today and in the last minute from the ledger, so the allowance the app knows about is never exceeded; a call within it is recorded at $0 with `free: true`.
- Ledger: `recordCall` takes `usage.free`, `usage.priceModel` (a model reached through OpenRouter without an exact bill is priced as the model it stands in for; OpenRouter's exact `usage.cost` wins when present) and `usage.fallback` (`{ from, fromModel, kind, via, hops }`) on every stand-in line, so spend caps (alerts plugin) count them against the provider that actually answered. The route preview shows `free` and `skipped` per model.
- Settings > Smart fallback (`server/plugins/fallback.js`, GET `/api/fallback`, POST `/settings` and `/clear`): on/off (default on), OpenRouter-first, stand-ins per call, who is standing aside with the reason and time left and a "try again now" (a cap cannot be cleared there), free tiers with use today, stand-ins and free calls this month, recent stand-ins. README row added.
- Commits: efc3153 (feature and tests), plus this log entry.
- Tests: npm test 97/97 pass (test/fallback.test.js adds 4: error classification, the OpenRouter model map, defaults / cooldowns / health mapping, then the running server against one local mock with a path per provider whose behaviour the test flips: a pinned chat stands in on 402 with the ledger line, feed lines and skip table checked; pre-emptive skip with no call made and the auto router leaving it out; recovery after a green health check with the next chat reaching it; 403-credits, 429, 401, 500 and a cut connection each giving the right kind; OpenRouter retry with the mapped id, the key in the header and the exact cost in the ledger; two hops when OpenRouter is out of credits too, and no OpenRouter attempt while it is skipped; the master switch off makes the run fail honestly; Gemini free tier taking the classify call at $0 and stopping at the daily allowance; a capped provider never standing in; council member replaced with the stand-in recorded and two answers kept; mission finishing with a rate-limited specialist handed off; keys never in a response or the log). npm run smoke 16/16 pass. No real provider, URL or key was contacted.
- Not verified: the Settings panel and the chips were syntax-checked and their API covered by tests, not clicked through in a browser; the free-tier limits are conservative list values, not confirmed against each provider's current published numbers; the OpenRouter model ids follow the public namespace convention and a first real retry will confirm them; real provider error wording beyond the cases above (Gemini's RESOURCE_EXHAUSTED counts as rate limited, OpenAI's quota 429 as credits). The first run of the new test once stalled for 60 s on a chat to a port that had been freed earlier (Windows can hand such a port back out); that scenario now cuts the socket instead and the test passed 14 times in a row afterwards, sequential and parallel. `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 26 DONE

## 2026-10-19 09:35 PT: Phase 28 (Learning router, the app's own brain), built by Claude

Nothing for this phase was committed before this session; all of it was built here. Checked against docs/DECISIONS.md: it carries out decision 18 and works with decision 16 (smart fallback). No locked item was changed.

- Core: `server/brain.js`. This is the person's own document `brain` (local: `data/brain.json`; hosted: their own `user_docs` row). It holds counts per model per task type (capability and difficulty from the classifier): jobs, successes and failures, council peer scores, rounds and wins, mission QA scores, thumbs up / down, cost per job and latency. Only cleaned model and provider ids, a known capability, difficulty 1 to 3 and numbers are kept. There is no prompt or answer text, no rating note, no key and no personal data. Run ids are kept for the last 600 runs so that a thumb given later lands on the task type the model actually did in that run. A second thumb on the same run replaces the first.
- Recording: single chats (a pinned chat gets its task type from the keyword classifier, which costs no call), every council member (peer score and whether it won) and the chair (as a difficulty-3 job), every mission task (QA score, and the cost and time of the work call) and the assembler (as writing, difficulty 3). Thumbs go through the existing ratings plugin, which still updates the older skills table too. Planner, QA, classifier and reviewer calls are housekeeping and are not recorded. A failure caused by the account (out of credits, rate limited, key rejected, unreachable, cap) is smart fallback's business and does not count against the model; the stand-in gets the job. A model that errors on the job itself gets a failure. Free-tier calls do not count toward cost per job.
- Router: `rank()` asks `adjust()` for each model. Quality = the registry base score blended with the track record. The record's weight is signals / (signals + 4): council scores count 1 each, QA scores 0.5, win rate 0.5 per round, thumbs 2 each. Other difficulties of the same capability count half. A failure rate pulls quality down. Cost blends the estimate with the observed cost per job (weight jobs / (jobs + 3)). Speed is compared with the model's registry speed: slower loses points, faster gains them, and the weight depends on priority (quality 0.3, balanced 0.8, economy 0.6). With no record, or learning off, the ranking is exactly the registry's, so every existing pick is unchanged for a new user. When a model has a record it replaces the older skills shift, so nothing is counted twice. Smart fallback picks its stand-ins through `rank()`, so it uses the record too. Each ranked model now carries `learned` (jobs, quality, base, confidence, cost per job, seconds, fail rate, speed penalty).
- "Who's best at what": a new "Who's best" tab (`web/features/brain.js`, `server/plugins/brain.js` at `/api/brain`). For each task type it shows the top models by score for the chosen priority, with win rate (wins / rounds), average peer score (or QA score), thumbs, success rate, cost per job, speed, how many jobs the ranking rests on, and an "early" chip while the built-in score still counts for most of it. It also has: Learn from every job on/off; Export (a JSON file of the record, without run ids); Reset (asks for confirmation, and the API requires `confirm: true`; clears the record and the older skills table, and keeps the settings). `GET /api/brain/pick` shows who the router would pick now for one task type.
- Sharing (later stage): an "I am willing to share anonymous track records" opt-in, off by default, plus a "Show what would be shared" preview (per model and capability: counts and averages only, with no run ids, dates or account details). This build sends nothing, even when opted in. The preview always says `sent: false`.
- Export and delete: the record is a normal user document, so it moves and is removed with the rest of the user's data. It also has its own Export and Reset.
- README row added.
- Commits: 1c45a36 (feature and tests), plus this log entry.
- Tests: npm test 105/105 pass. `test/brain.test.js` adds 8 tests:
  - no record means no change;
  - a simulated council history lifts one model and drops another, the record grows into the score, other difficulties count half, and the view ranks them;
  - thumbs weigh double, a re-thumb replaces the first, and the thumb lands on the run's task type;
  - cost and latency in the score, economy weighting price most, free calls not counting as cheap;
  - failures pull a model down;
  - reset clears the record and the skills table, and learning off records nothing and uses nothing;
  - only task types and numbers are stored (extra fields, prompt text, keys, an email, markup in ids are all dropped; the share preview has a fixed set of fields);
  - the running server against local mock providers. A pinned chat, a three-member council (scores, winner, chair), a mission (QA scores, assembler) and thumbs are all recorded. A 402 is not held against the model, but a 400 on the job is. The view and the pick carry the record. No prompt words or keys are in the stored record or the log. It also covers export with an attachment header, the share preview and opt-in (still nothing sent), and learning off. A second server is seeded with a simulated history: it moves the baseline #3 model to the top and the baseline favourite out of the top two. Reset needs a confirmation and then gives back exactly the registry order.
- npm run smoke: 16/16 pass. Both suites ran in temp data dirs with mocks; no real URL or key was used.
- Not verified: the Who's best tab was syntax-checked (node --check) and its API covered by tests. It was not clicked through in a browser. The weights (4, 3, 2x thumbs, 35-point failure penalty, latency weights) are first choices tuned only against simulated histories. Real use may call for adjusting them. The hosted path stores the record as a user_docs row like every other plugin document, but it was not run against Supabase.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 28 DONE

## 2026-10-19 09:55 PT: Phase 25 (Subscriptions and services page), built by Claude

Nothing for this phase was committed before this session; all of it was built here. Checked against docs/DECISIONS.md: no locked item was changed (the Pro gate, Square links, billing and the updater are untouched). Run order note: Phase 29, which comes before 25, is marked PHASE 29 DONE on the unmerged branch `origin/cursor/live-project-view-8199` (commits 0db9a75 and e8efeb1, by the Cursor cloud agent), not on main. This session did not merge it (not this phase's work); Phase 25 does not depend on it. Chris may want to merge or rebase that branch.

- Page: the Subscriptions tab is now the subscriptions and services page (`web/features/services.js`, registered as the `subscriptions` tab so it replaces the old table; Free users still see the existing Pro lock screen, now reached through `CC.renderSubscriptionsCore`). Routes: `server/plugins/services.js` at `/api/services`. Core: `server/services.js`. Receipt parser: `server/receipts.js`. README rows updated.
- (a) AI providers: one row per AI with a key or spend this month. Credits left and month-to-date are live where an API exists: OpenRouter `/key` (usage this month, key limit) and `/credits` (account credits), DeepSeek `/user/balance`, and, through an OPTIONAL admin key (vault ids `admin-openai` and `admin-anthropic`; env fallback OPENAI_ADMIN_KEY / ANTHROPIC_ADMIN_KEY), the OpenAI organization costs and completions usage APIs and the Anthropic cost report (cents to dollars) and messages usage report, with pagination. A regular API key pasted as an admin key is refused with advice. An admin key is kept only after one test call works; a refused or unreachable one is never kept and the previous one is put back. xAI and Gemini: no endpoint is used, month-to-date comes from the ledger, and the page says so. Amber / red per row comes from: the spend cap (amber at 80%, red at 100%, as the router enforces it from the ledger); the cap counted against the API's own month-to-date when that is higher (spend outside the app); a USD balance under $2 (amber) or at $0 (red); and a red health light. Low and empty balances go out once per level per month through the alerts plugin's channels. Live checks run on Refresh, when the page opens and the last check is older than 15 minutes, 45 s after start, then hourly (local mode). A failed check keeps the last good numbers, marked as such.
- (b) Subscriptions without an API: optional, read-only Gmail (`gmail.readonly`) or Outlook (`Mail.Read` + `offline_access`) OAuth with PKCE S256. The person supplies their own OAuth client ID (Gmail Desktop app clients also have a client secret, kept in the vault; env fallback CC_GMAIL_CLIENT_ID / CC_OUTLOOK_CLIENT_ID). Tokens live in the vault under `mail-<source>` and are refreshed before expiry. A grant with wider mail scopes is refused and nothing is saved. The scan only uses GET: the Gmail messages search (subject terms, last 400 days, up to 50) and each message, or Graph `/me/messages` with `$search`. `parseReceipt` extracts service, plan, price and currency, billing cycle and next renewal (a renewal sentence, else a billing period, else the receipt date plus one cycle, marked estimated), with a confidence per field and overall; under 60% is flagged "check this one". Known services: Google AI Pro / Ultra (with Flow), ChatGPT, Claude, Kling, Suno, Midjourney, ElevenLabs, Grok, Cursor, Perplexity, Runway; Google needs the product name as well as the domain. An unknown sender with a receipt subject and a price becomes a low-confidence suggestion; anything else is a parse failure, listed with its reason and email link. Suggestions match an existing row by vendor. The person confirms (optionally editing any field, and choosing update or new row) or dismisses. Edited fields are labelled "you entered", the rest "auto-detected: email NN%". Only the extracted fields and the message id are stored (plus a Gmail link or the Outlook webLink), never the body or the subject. Confirmed and dismissed message ids are never suggested again. "Sign in again" answers 409, not 401, so a hosted hub does not sign the person out. Manual add and edit always work, with or without the scan. Demo mode: "Try with sample emails" parses three built-in fake receipts.
- (c) Reminders: each row has `remindDays` (0 to 60, default 3). The alerts plugin's renewal sweep now uses it and sends exactly one reminder per renewal date (`alerts.reminded`) through the existing in-app / push / email channels. It also emits `services.reminder`, which the page shows as a desktop notification once the person allows it. A past renewal date rolls forward by its cycle. The sweep runs 20 s after start, then every 12 h, and on POST `/api/services/sweep` or `/api/alerts/sweep`. Totals: subscriptions per month (price per cycle normalized to a month; list-price estimates shown separately), AI APIs and other metered spend so far (the API figure where present, else the ledger), this month so far, and a month-end estimate at the current pace. Hints: two or more paid plans from one vendor ("possible duplicate"); a paid row with a known provider, older than 30 days, with no ledger entry, no credit-balance change and no manual credits update in 30 days ("possibly unused").
- (d) Labels: every value on the page says where it came from: auto-detected (API, ledger, or email with its confidence), estimate (list price), you entered, or not set. The tracker (`server/subscriptions.js`) now keeps `price`, `cycle`, `remindDays`, and `origin` and `confidence` per field (set by the server only, never from the request body), plus `addedAt` and `creditsUpdatedAt`. It validates numbers and dates (400 on bad values) and stays compatible with the old `monthly`-only rows and routes.
- Other small changes in web/app.js: the 15 s tick no longer re-renders a tab owned by a feature (it would wipe edits in progress), and a feature tab already in the phone bottom bar is not added to the More sheet again.
- Commits: d31f550 (feature and tests), plus this log entry.
- Tests: npm test 111/111 pass. `test/services.test.js` adds 6:
  - the parser against fake receipt fixtures in `test/fixtures/receipts/`: Google AI Pro with Flow, Google AI Ultra, Kling, Suno, ChatGPT Plus, Claude Max, Midjourney, ElevenLabs, a low-confidence unknown sender, and two parse failures (not a receipt; a known sender with no price);
  - dates, cycles and monthly figures;
  - the duplicate / unused hints;
  - read-only scopes and no em-dashes;
  - the running server against one local mock playing OpenRouter, DeepSeek, the OpenAI and Anthropic cost APIs, Google and Microsoft sign-in, Gmail and Graph. It covers live credits and month-to-date, cap levels, admin keys (regular key refused, bad key not kept, good key kept, two pages of buckets, cents), totals, hints, rolled renewals, reminders (lead time per row, once per renewal), manual add with validation, Gmail connect with PKCE and scan (9 suggestions, 2 failures), confirm with an edit (labels and confidences checked), confirm as a new row, dismiss, a rescan with no repeats, token refresh, a refused token, Outlook connect and scan, disconnect, and the demo samples. It also checks that the mail APIs were hit with GET only, that no body, subject or secret is on disk, and that no key or token is in any response or the log;
  - the Free tier lock (402).
- npm run smoke: 16/16 pass. Both suites ran in temp data dirs with mocks; no real inbox, URL or key was used.
- Not verified: the page was syntax-checked (node --check) and its API covered by the tests. It was not clicked through in a browser or the desktop app. The real OpenRouter, DeepSeek, OpenAI and Anthropic response shapes were written from their published docs and only exercised against mocks (in particular whether OpenRouter's `/credits` accepts a normal key, and that Anthropic cost amounts are in cents); a first real refresh will confirm them. Real Google and Microsoft sign-in were not run: they need an OAuth client that the person registers (a Google Desktop app with the Gmail API enabled; a Microsoft app with a Mobile and desktop redirect of http://localhost). Whether Google accepts the loopback redirect with a trailing slash path and whether Microsoft accepts http://127.0.0.1 is unconfirmed. Parsing was tuned on fake fixtures written for this phase, not on real receipts; real senders and layouts will vary, which is why every row waits for a confirm. Desktop notifications rely on the HTML5 Notification API in the Electron window and were not seen on screen. The hosted path stores everything as user_docs rows like other plugin documents, but it was not run against Supabase.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 25 DONE

## 2026-10-19 10:20 PT: Phase 12 (Grok Bot agent inside the Command Center), built by Claude

Nothing for this phase was committed before this session; all of it was built here. Checked against docs/DECISIONS.md: it carries out decision 15 as written (capability tags, Settings > Integrations with the URL and key as secrets, configurable header defaulting to `Authorization: Bearer`, the JSON body, a per-job callback token, the statuses, a mock in tests, no tunnel or deploy, agent cards on the hub). No locked item was changed. Run order note: Phase 29 is still only on the unmerged branch `origin/cursor/live-project-view-8199`. This phase emits the `external.handoff` event that branch's live view listens for, and uses the same agent ids (`grokbot`, `browser-helper`), so the two should fit when Chris merges it.

- Core: `server/grokbot.js`. Routes: `server/plugins/grokbot.js` at `/api/grokbot`. Hub cards: `server/agents.js`. UI: `web/features/grokbot.js`. Contract for Grok Bot's side: `docs/grokbot.md`. README row added.
- Capability tags: `signed-in-browsing`, `gmail`, `drive`, `calendar`, `teammate-bots`, detected from the wording (sending or reading email, the inbox, Drive / Docs / Sheets, booking or the calendar, logging in, portals, forms, downloads from an account, teammate bots). Drafting an email, a posting schedule and other text work never match. `/api/route` now carries an `agent` hint, and the route preview says when Grok Bot fits. Grok Bot is never in the text ranking.
- Settings > Integrations > Grok Bot: webhook URL and sender key in the vault (vault id `agent-grokbot`), never logged, never sent back to the browser (only "saved"). Optional header name (default `Authorization`, sent as `Bearer <key>`; any other header carries the key as is; Host, Content-Type and similar are refused). `https://` only, or `http://` to this computer; credentials in the URL are refused. Also: where results come back (optional public address), hand over automatically (on), the built-in mock, council wait (90 s), mission wait (15 min), Send a test job, Remove.
- Dispatch: `POST <webhook>` with the key header and `{job_id, task, context, workspace, callback_url}`. It only happens from a council or mission the person started, or a click (Send to Grok Bot in Command, Send a test job in Settings). Command has Grok Bot: when needed / Always / Never for the next council or mission. In demo mode it is refused (409) unless the built-in mock is selected. The mock is an in-process pretend Grok Bot (queued, working, done) and never leaves the computer. A refused hand-off says "Grok Bot refused the sender key (401)." or "Grok Bot refused the job (500).". An unreachable one says "Could not reach Grok Bot: <reason>", without the address.
- Callback: `POST /api/grokbot/callback/<job_id>?t=<token>`, answered before the session-token gate (and before the Host pin, so a tunnel or hosted hub can forward its own host). The token is 24 random bytes per job, stored only as a SHA-256 hash, compared with timingSafeEqual, and burned by `done` or `failed`. Refusals: 405 for other methods, 415 for non-JSON, 400 for a bad body or status, 401 for an unknown job or a wrong or used token. A path that only starts the same way (`/api/grokbot/callback` with no id, or `..` paths) is not exempt. Payload `{status, text, artifacts}`. Statuses are queued, working, needs_approval, done and failed. Only http(s) artifact links are kept.
- Council: when the job needs a tag (or the person picked Always, or named Grok Bot), Grok Bot gets the question as a job and has its own seat next to the AIs, marked "results are async and can take minutes". Back within the council wait: its answer is peer-reviewed, scored, can win, and reaches the chair like the others. Grok Bot does not review. It is credited in the learning router's record and is not in the older skills table. Back later: the council goes on. The answer is then added to that council and scored by one judge call, which is in the ledger.
- Mission: when Grok Bot is ready, the planner may mark a step `capability: "agent"` with `needs`. A step whose wording needs a tag also goes to Grok Bot. Those steps are never switched by the economy re-plan. Later steps get its result as input. If it is not back within the mission wait, the step shows "still out", dependents go on, and the deliverable lists what is still pending. When the result arrives it is put on the step and added to the deliverable under the step's title. An aborted mission cancels its job.
- Async and by hand: every job can be cancelled. A result can be pasted in by hand under the deliverable or in Settings. A paste counts like a callback and burns the token. Until a hosted hub or a tunnel exists, the callback address is this computer, and the Settings panel says so.
- Hub: the provider list now ends with agent cards (`kind: "agent"`, not in PROVIDERS, so key cards, health checks and the router leave them alone). Grok Bot shows grey (not set up), green (ready / jobs in progress), amber (needs approval, or demo mode without the mock) or red (the last hand-off was refused or unreachable). The Browser helper card is grey, "arrives in a later update", until Phase 27. Both are on the strip next to the AIs and in the live graph. The Agents panel in Command shows what each one is doing now and an activity feed. Feed lines, `agent.*` events, `grokbot.job` and `external.handoff` events go out on every status change.
- Small changes in web/app.js: agent tiles sit after the AIs on the strip and in the graph, and they are kept out of the media list in Settings and in Credits. Council columns include agents, with their pending status. Mission tasks show the Grok Bot job status. Send orders passes the Grok Bot choice. `CC.graph` and `CC.renderOps` are exposed for features. In server/mission.js the assembler moved into a local function (same code) so a mission with only pending Grok Bot steps can finish without it.
- Commits: ef77962 (feature and tests), plus this log entry.
- Tests: npm test 114/114 pass. `test/grokbot.test.js` adds 3:
  - the tag detector (and that plain text work never matches);
  - URL rules, and no em-dashes in user-facing words;
  - the running server against one local mock on a random port, playing xAI for the text work and Grok Bot's webhook. It covers: not-set-up and 409; settings validation; URL and key never in any response, state, log or data file (the vault file is sealed); the exact hand-off body and both header styles; every callback refusal; the tunnel Host on the callback while other routes keep the Host pin; queued, working, needs_approval and done with artifacts, then the token refused; `external.handoff` and feed events; the card's light and activity; the router hint; a council where Grok Bot answers in time, is peer-scored, wins and reaches the chair; a plain-text council and a "Never" council with no hand-off; a late council answer with its judge score in the ledger; a mission whose Gmail step goes to Grok Bot and whose next step uses its result; a late mission result added to the deliverable; paste and cancel burning the token; refused (401, 500) and dropped webhooks with plain reasons and a red light; demo mode refusing the webhook, the built-in mock for a click job and for a council; Remove; only token hashes on disk.
- npm run smoke: 16/16 pass. Both suites ran in temp data dirs with mocks; no real URL or key was used.
- Not verified: the Settings panel, the Agents panel, the council columns and the deliverable section were syntax-checked (node --check) and their API covered by the tests. They were not clicked through in a browser or the desktop app. No real Grok Bot was called. The contract in docs/grokbot.md is what Grok Bot's side must implement, and a real hand-off will confirm it. Callbacks to this computer only work once Grok Bot can reach it (hosted hub or a tunnel; neither exists, and none was built). On a hosted hub, callbacks find their user through an in-memory index, so a hub restart loses pending callbacks (paste by hand); this was not run against Supabase. The tag detector is keyword-based and will miss or over-match some phrasings. Always / Never in Command overrides it per run.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 12 DONE

## 2026-10-19 03:38 PT: Phase 27 (Built-in browser helper), built by Claude

Nothing for this phase was committed before this session; all of it was built here. Checked against docs/DECISIONS.md: it carries out decision 17 (an in-app browser window driven by the cheapest capable AI, Gmail / Drive through the person's own Google sign-in, an explicit OK before any send, post, delete or purchase) and the hub-card part of decision 15 (the Browser helper card is now real: live light, activity feed, results in the council). No locked item was changed: the updater, single instance, own server, reload guard, appId and data folder are untouched; electron/main.cjs only gained one line that registers the helper window. Phase 12's behaviour is kept: when Grok Bot is set up it still takes these jobs, and its tests pass unchanged.

- Core: `server/browser.js`. Text reader: `server/browser-reader.js`. Google: `server/google.js`. Routes: `server/plugins/browser.js` at `/api/browser`. Desktop window: `electron/browser-helper.cjs`, `electron/browser-bar.html`, `electron/browser-bar-preload.cjs`. UI: `web/features/browser.js`. Demo page: `web/browser-demo.html`. Docs: `docs/browser-helper.md`. README row added.
- Driving: the cheapest capable AI (`cheapest()`), or a model picked in Settings, reads the page as text plus numbered links, buttons, fields and forms (DOM reading, no screenshots).
  - It answers with one JSON action per step: open, click, type, submit, back, scroll, ask, gmail_search / read / send, drive_search / read, done, fail.
  - Every call goes through smart fallback, is in the ledger (role `browse`, booked to the job, council or mission) and is inside the spend caps.
  - Limits per job: steps (12) and spend ($0.25). One job runs at a time.
  - The prompt says page text is data, not instructions.
- The window (desktop app):
  - A separate window with its own session (`persist:cc-browser-helper`), never the person's main browser profile. All permission requests are refused, downloads are blocked, and pop-ups open in the same view.
  - The page is read and driven from an isolated world, so the site's scripts cannot see or move the element references. Clicks are real mouse events at the element.
  - A bar on top shows the task, steps and cost, the action log, the OK / No question and Stop. Only the bar's own webContents can answer. Closing the window stops the job.
- The text reader is used without the desktop app (and in the tests): fetch with a cookie jar per job, links, forms (GET / POST), no JavaScript. Neither driver is available on the hosted hub.
- Explicit OK (`assess()`), always showing exactly what will happen:
  - Any form submit: the page, the button, method and address, and every field with its value; hidden fields are shown, passwords never.
  - Clicks or addresses that read as send / post / delete / purchase.
  - Every email: To, Subject, the full body.
  - `ask` for things only the person can do, such as signing in or a captcha.
  - A No goes back to the AI. No answer within 10 minutes stops the job with nothing done.
- Refused outright:
  - Typing into password fields. The typed text is never repeated in the log or to the AI.
  - Card and bank fields.
  - Square hosts, and billing / payment-method pages.
  - Command AI's own address (except the demo page).
  - Anything that is not http(s).
  - Sending mail without the send permission.
- Google:
  - OAuth with PKCE S256, with the person's own client ID and secret.
  - Scopes: `gmail.readonly` and `drive.readonly` by default; `gmail.send` only when ticked. A grant wider than requested is refused and nothing is kept.
  - The client secret and tokens are in the vault (`google-helper`). Tokens are refreshed; "sign in again" answers 409.
  - Reads are GET only. Gmail search / read and Drive search / read (Docs, Sheets and Slides exported as text). Send builds a plain-text MIME message, only after the OK.
  - The return from Google is `?code&state=bh-...` on the app page.
- Councils and missions: `server/agents.js` now picks at most one outside agent per job.
  - Grok Bot when it is set up and fits. Otherwise the helper takes the parts that need a website, Gmail or Drive, never plain text work.
  - Once Grok Bot is set up (connection saved or mock on), the helper joins only when asked: "Browser helper: Always" in Command, or naming it.
  - council.js and mission.js were made agent-agnostic. The same seat, scoring, chair packet, learning-router credit and late-result handling now serve both agents. Grok Bot-only wording (paste by hand) stays Grok Bot's.
  - `/council` and `/mission` take `browser: true / false`, and `/route` returns `browserHelper` advice.
- Hub card:
  - Light: grey (off / no AI / hosted), green (ready, working), amber (waiting for an OK), red (the last job failed; a job you stopped does not count).
  - Also shows what it is doing now and an activity feed of its action log.
  - Events: `browser.job`, `browser.step`, `external.handoff` (agent `browser-helper`, for the Phase 29 live view) and `provider.status`.
- UI:
  - Command has "Browser helper: when needed / Always / Never", Send to Browser helper (a click), and each open job with its live log, the OK / No box and Stop.
  - A floating OK box appears on every view while the helper waits.
  - The deliverable shows this run's helper jobs.
  - Settings > Integrations > Browser helper: on, automatic hand-off, the window or the text reader, limits, waits, the model, and Google (client, the three scopes, Connect / Disconnect). "Try it on the demo page" is there too.
  - web/app.js passes the choice with councils and missions.
- Demo mode: the pretend AI (server/mock.js) opens the address in the task, fills in a contact form, clicks its button (which asks for the OK) and reports. It works with no keys on the built-in demo page.
- Commits: e18b00b (feature and tests), plus this log entry.
- Tests: npm test 119/119 pass. `test/browser.test.js` adds 5:
  - the page reader: title, text, links, buttons, fields, forms, hidden fields, labels, selects, and password / card flags; scripts and comments are ignored;
  - `assess()`: every refusal, and every kind of OK with its exact lines;
  - read-only scopes, the window's isolation settings in the source, and no em-dashes;
  - the running server against one local mock playing xAI (a scripted AI), a small website and Google. It covers:
    - before any AI (grey, 409) and readiness with the text reader and the cheapest AI;
    - settings validation;
    - a click job that browses, fills in a form, waits for the OK with the exact fields and address, sends nothing before it, then sends once exactly as shown, with a cookie jar;
    - a wrong or second answer refused (409);
    - the action log, history, steps and cost; 6 ledger entries for 6 steps; external.handoff and browser.step events; the card light (amber while waiting, green, red after a failure);
    - No (nothing sent, the AI told);
    - refusals: password and card fields, Square, billing and this app. The password page is the only one fetched, and the typed password appears nowhere;
    - ask, then Stop; the step limit;
    - Google: client ID first; scopes and PKCE in the sign-in address; a forged state; a wider grant refused with nothing kept; connect; Gmail search / read and Drive search / read with GET only and the person's token; send refused while read-only; connect with send; the email OK lines; one send with the exact MIME;
    - a council where the helper takes a seat, is peer-scored, reaches the chair, is credited in brain.json, and has its calls booked to the council; a council with browser: false;
    - a mission whose browsing step goes to the helper while the next step uses its result;
    - Grok Bot set up (mock) taking the Gmail council instead; switched off (409, grey); disconnect;
    - no client secret, token or key in the log, any API reply, any data file or the sealed vault;
  - demo mode with no keys: the demo page is served, and the demo job asks for the OK with the filled-in fields, then finishes after it.
- npm run smoke: 16/16 pass. Both suites ran in temp data dirs with mocks; no real account, URL or key was used.
- Not verified:
  - The desktop window, its bar, the isolated-world page script (snapshot, real mouse clicks, insertText, select, requestSubmit), the Settings and Command panels and the floating OK box were syntax-checked (node --check). Only the window's isolation settings were checked by test, in the source. None of it was opened in Electron or a browser. Electron 44's BaseWindow / WebContentsView, `executeJavaScriptInIsolatedWorld` and `navigationHistory` were used from their documented APIs. A first run in the desktop app will confirm them.
  - Real Google sign-in was not run: it needs an OAuth client the person registers (Desktop app, Gmail API and Drive API enabled). The loopback redirect to the app page is the same one Phase 25 uses, and it is equally unconfirmed.
  - Real websites were not driven. How well the cheapest model drives real pages is unknown, and the risk words are keyword-based. Every form submit still asks no matter what, so a missed word can only cost an extra OK question, never a silent send.
  - A page that lies about a button's label can mislead the OK summary. It cannot act without the click.
  - The hosted hub refuses the helper by design.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 27 DONE

## 2026-10-19: Phase 13, organize my existing browser bookmarks

- Checked first: docs/DECISIONS.md has nothing this phase conflicts with. No earlier Phase 13 work was committed, so the whole phase was built here.
- Where: the first-run Setup page shows "Organize the bookmarks you already have?" next to the AI bookmark folder (a new `setup` kind for feature plugins, two lines in web/app.js), and Settings > Organize my bookmarks. Server: server/bookmarks.js, server/plugins/bookmarks.js (`/api/bookmarks`). UI: web/features/bookmarks.js.
- Reading:
  - Chrome, Edge and Brave `Bookmarks` JSON per profile (Windows, macOS and Linux paths). Firefox `places.sqlite` from a temporary read-only copy (node:sqlite); tag entries are skipped.
  - The list shows profile names only. Nothing inside a bookmarks file is read until the person picks the profile and ticks "Allow Command AI to read this browser's bookmarks" (400 without it).
  - The read bookmarks stay in memory only. The app's own files keep counts and backup paths, never titles or addresses.
- Sorting:
  - Only AIs with a saved key are listed, each with a cost estimate. The cheapest capable one is suggested. The person clicks "Sort into folders", with an optional business name.
  - The prompt asks for 4 to 12 short folder names, for example the business name, Insurance, Banking, Tools or Social. It works in batches of 120 and reuses earlier folder names.
  - Privacy: titles and addresses go only to the AI the person picked. Smart fallback is deliberately not used here, so the list never reaches another provider. Only the scheme, host and path are sent: query strings, fragments, user:password and bookmarklet code never leave. The UI says this.
  - Every call is in the ledger (role `bookmarks`, no content). An AI at its spend cap is refused. Invented ids are ignored, and anything the AI leaves out goes to "Other".
  - The app's favicon helper is not used in this panel, because it would send every bookmark's domain to Google.
- Preview: rename folders, move a bookmark with its menu, untick it (it stays where it is), add folders. Exact duplicates (same address) are listed and merged only when ticked. Options: put the folders on the bookmarks bar or under Other bookmarks, and remove the folders this move leaves empty (on by default; folders that were already empty are never touched).
- Apply (Chrome, Edge, Brave):
  - Refused while the browser is running (tasklist on Windows, pgrep elsewhere; when the check is not possible, the apply is also refused).
  - Refused when the file changed since it was read.
  - A synced profile needs "Apply anyway", because sync may bring back the old layout. sync_metadata is left alone.
  - Backups go next to the file (`Bookmarks.command-ai-backup-<time>`) and to the app data folder (`bookmarks-backups/`). Both are checked byte for byte before writing.
  - Moved bookmarks keep their own id, guid, dates and meta info. An existing folder with the same name is reused, and new ids are unique. `checksum` is removed. The bookmark count is checked before the write (before minus ticked duplicates, else nothing is written). The write goes to a temp file and is then renamed. Chrome's own Bookmarks.bak is not touched.
- Undo puts the backup back, also only with the browser closed. If the bookmarks changed after organizing, it asks first and keeps a `command-ai-before-undo` copy. A second undo is refused.
- Firefox: writing places.sqlite is not safe, so Firefox gets an import file with the organized folders, plus the steps to import it. The Download import file button is available for every browser.
- Demo mode: "Sample bookmarks" (server/bookmarks-demo.json, fake data, 30 bookmarks with duplicates, nested folders and a bookmarklet). The pretend AI (server/mock.js) sorts them by keywords and names a folder after the business. Apply and Undo work on a sandbox copy in the app data folder.
- Hosted hub: the routes answer "works in the desktop app"; nothing is read.
- Commits: 995c76f (feature and tests), plus this log entry.
- Tests: npm test 124/124 pass. `test/bookmarks.test.js` adds 5:
  - reading: folder paths, duplicates, address clean-up, the line format and profiles.ini;
  - the apply plan: counts, a ticked duplicate merged, unticked bookmarks left in place, records kept, an existing folder reused, emptied folders removed or kept, Other bookmarks, the checksum dropped, the input unchanged; the import file escaped and de-duplicated;
  - no em-dashes in the new files;
  - the running server against a fake home folder (CC_BROWSER_HOME: Chrome with two profiles, one synced, Edge and Firefox, and a fake process list) and a mock xAI. It covers:
    - the session token; allow first; profile checks; models only with a key, and the estimate;
    - a key-less AI refused; exactly what is sent; ledger entries without content;
    - refusal while Chrome runs, with nothing touched and no backup;
    - apply with both backups equal to the original, then the result checked;
    - a draft applies once; undo while running refused; undo restores the original bytes; a second undo refused;
    - changed-since-read refused; undo after a later change asks, then keeps a copy;
    - synced needs "apply anyway", and the sync data is kept;
    - Firefox: read from a copy, tags skipped, export only, the database never written;
  - demo mode with no keys: sample bookmarks sorted into the business, Banking & Money, Insurance, Social and AI folders, applied to the sandbox and undone, with the (fake) browser profile untouched.
- npm run smoke: all checks pass. Both suites ran in temp data dirs with mocks. No real browser profile, account, URL or key was used.
- Not verified:
  - The Setup and Settings panels were syntax-checked (node --check) but not opened in a browser or the desktop app. That includes the folder editor (details, rename inside the summary, the move menus) and the file download.
  - The spend-cap refusal for sorting is in the code but not covered by a test.
  - The running-browser check was tested only with the fake process list. Real tasklist / pgrep, and real Chrome accepting the edited file without a checksum, were not run. The existing AI-folder apply already relies on the same checksum removal.
  - Firefox reading was tested on a small synthetic places.sqlite. A real Firefox that is running may lock the file; the app then asks the person to close Firefox.
  - How well a real AI names folders for a large real bookmark set is unknown. Every folder is shown for review before anything changes.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 13 DONE

## 2026-10-19: Phase 17, side-by-side comparison

- Checked first: docs/DECISIONS.md has nothing this phase conflicts with. No earlier Phase 17 work was committed, so the whole phase was built here.
- Where: the Compare tab (web/features/compare.js). Server: server/compare.js, server/plugins/compare.js (`/api/compare`).
- Running a comparison:
  - One prompt goes to 2 to 6 models the person picks (the same model twice counts once). The tab shows an estimate per model and a total before the Compare click.
  - Every column streams at the same time. Each one shows its answer, cost (âœ“ when the provider reported the exact bill), time to first words, total time and tokens.
  - Each column uses exactly the model that was picked. Smart fallback is deliberately not used here, because a stand-in would spoil the comparison. A failed provider shows its error in its column, and smart fallback's trouble table still hears about it for other jobs.
  - A provider at 100% of its monthly spend cap (alerts plugin) is skipped with a note and never called. A provider without a saved key is skipped the same way.
  - Every call is in the ledger (role `compare`, the run id as missionId) and in the health lights. Each column counts as one job of the prompt's task type for the learning router. The task type comes from the keyword classifier, so classifying costs no extra call, and no prompt text is kept in the router's record.
- Pick winner: a thumbs-up for that model, written through the ratings plugin. `saveRating` was split out of the ratings route so both share it; the route behaves as before. The router (router.js recordOutcome and the Phase 28 learning router) reads it like any other rating. A comparison gets one winner; a second pick is refused (409). Only a column that answered can win.
- Presets: named model sets, saved per user (a `compare.presets` document), loaded with one click, updated when saved again under the same name, deleted with a confirm.
- History: the last 30 comparisons are kept per user (answers capped at 20,000 characters each) and listed in the tab.
- Live updates use their own events (`compare.update`, `compare.delta`), so a comparison never takes over the Command view's live run or graph.
- Not tier-gated: the plan does not say whether Free should be limited here. Chris decides.
- Commits: 0f4cff1 (feature, tests, smoke check, README row), plus this log entry.
- Tests: npm test 127/127 pass. `test/compare.test.js` adds 3:
  - the running server with the demo AIs only:
    - model list with estimates; the session token is required;
    - input checks (one model, duplicates, unknown AI or model, empty prompt);
    - 3 demo models answer in parallel (every column started before the first finished), and each column reports cost, first-words time, total time and tokens;
    - 3 ledger entries with matching costs;
    - picking a winner writes a rating, the learning router shows the thumb on that task type, and its pick reads the record; a second pick is refused; the router export has no prompt text;
    - a preset saves, updates by name and reloads;
    - a provider over its cap is skipped with a note, has no ledger entry and cannot win;
    - columns without a key are skipped once demo mode is off;
  - a fresh start of the app on a saved preset file reloads it, and delete works;
  - no em-dashes in the new files.
- npm run smoke: all checks pass (19, including a new side-by-side check with the 3 demo AIs). Both suites ran in temp data folders with the local mock providers. No real key, account or URL was used.
- Not verified:
  - The Compare tab was syntax-checked (node --check) but not opened in a browser or the desktop app. That includes the live column streaming, the model pickers, the preset buttons and the history list.
  - Real providers streaming side by side were not run. Time to first words is measured on the server, so it includes the provider's queueing but not the trip to the window.
- `.claude/launch.json` and `cc-names.tmp.mjs` are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 17 DONE

## 2026-10-19: Phase 18, knowledge libraries (RAG)

- Checked first: docs/DECISIONS.md has nothing this phase conflicts with. No earlier Phase 18 work was committed, so the whole phase was built here.
- Where: the Libraries tab, a chip row in Command ("Libraries for this chat") and Settings > Library sources (web/features/libraries.js). Server: server/libraries.js (index, search, embeddings, the prompt block), server/library-extract.js (text out of files, folder walk), server/library-sources.js (Google Drive and Notion), server/plugins/libraries.js (`/api/libraries`).
- Sources:
  - Uploaded files and uploaded folders (the browser reads them; Word and PDF go up as bytes), and a folder on this PC by path (hidden folders, links, node_modules and similar are skipped).
  - Text, Markdown, CSV, JSON, code, HTML, Word .docx (unzipped, no dependency) and PDFs with real text (a best-effort reader; scanned PDFs or unusual font encodings are skipped with a note).
  - Google Drive: the person's own OAuth client (the browser helper's client is reused when this one has none), PKCE S256, scope drive.readonly only. A grant wider than that is refused and nothing is kept. Its own tokens in the vault ("library-google"), separate from the browser helper's sign-in. Only GET requests to Drive. A picked folder brings its files (up to 3 levels down). Google Docs, Sheets and Slides are exported as text.
  - Notion: a public integration's OAuth (owner=user). Notion has no scopes in the sign-in link, so the UI asks for "Read content" only when the integration is created, and the adapter can only call POST /v1/search and GET pages and block children; anything else is refused before a request. Secret and token in the vault.
- Indexing:
  - Two steps: "Read" stages the files (text, passages of about 1,100 characters with overlap, and an estimate of tokens, calls and cost; free), then the Index click spends. Unchanged files are skipped; a changed file replaces its older copy.
  - Embeddings with the model picked when the library is made, with the person's own key: OpenAI text-embedding-3-small / 3-large, Gemini embedding 001, Mistral Embed (list prices as of 2026-10-19), a custom OpenAI-compatible provider such as Ollama (model and price typed in), or the demo embedder in demo mode.
  - Every embedding call is a ledger line (kind call, role `embed` for indexing and `embed-query` for questions, tokens and cost kept to 9 decimals, never text). A provider at its monthly spend cap is refused before any call (402); indexing that hits the cap mid-way stops and keeps what was done.
  - Storage: one SQLite file per library in the app data folder (`libraries/<id>.sqlite`, node:sqlite): documents, passages with float32 vectors, and an FTS5 keyword index. No native vector extension is shipped: vector search is an exact cosine scan in memory, fine up to roughly 100,000 passages per library.
- Search: hybrid (keyword bm25 and vector cosine merged by reciprocal rank fusion), or keyword only (free) or meaning only. When the embedder is capped, keyless or down, a question falls back to keyword search and says so.
- Use: a library is attached to a chat (the Command orders of one project, or no project), a workspace (while it is active) or an agent (stored now, for the custom agents of Phase 19). A request may also name libraries (`libraries: [...]` on /chat, /council, /mission). Single, Council (every member and the chair) and Mission (as context, kept by the assembler) add the best 6 passages as [L1], [L2] ...; the deliverable shows chips that open the passage (and the Drive or Notion page), and [L1] in the text becomes a link. Runs keep a 600-character snippet per source, not the whole passage.
- Delete: removes the library's index file, its entry and every attachment; the original files are never touched. Single documents can be removed too.
- Demo mode: the demo AI server answers `/v1/embeddings` for "Nova Embed (demo)" (hashed words, a few synonyms folded together so meaning search can find "automobile" for "car"), and the pretend AI quotes the best excerpt with its [L1] tag.
- Hosted hub: the routes answer "desktop only for now" (501), because the index is a local file.
- Commits: 4c82b57 (feature, tests, smoke checks, README row), plus this log entry.
- Tests: npm test 136/136 pass (the count includes test/publish.test.js, another session's uncommitted work). `test/libraries.test.js` adds 5:
  - pure: chunking, .docx and PDF extraction (built in the test), HTML, unsupported and text-less files, the folder walk (the hidden folder is never read), query terms;
  - the Notion allow-list (read endpoints only) and the Drive scope;
  - the running server with the demo embedder:
    - a fixture folder (Markdown, HTML in a subfolder, CSV, Word, PDF, a scanned PDF and a PNG) staged with an estimate and no spend, then indexed; every embedding call in the ledger with matching cost and no text; re-reading skips unchanged files;
    - keyword-only finds "ZX-4471" in parts.csv; vector-only finds the fleet rules for "car upkeep" while keywords alone cannot; hybrid finds the Word file;
    - a chat attached to the library answers with [L1] citing the handbook passage, and the question's embedding is in the ledger under the run; a council gets the same sources;
    - at the spend cap indexing is refused (402) with no call, a question falls back to keyword search, and vector-only is refused;
    - removing a document; deleting the library removes its index file and attachments;
  - Google Drive and Notion on a local mock:
    - no client means no start; the Drive sign-in link asks for drive.readonly only with S256; a wider grant is refused and nothing is kept; the state is single use;
    - files listed; a picked folder brings its file; every Drive request is a GET with the token;
    - the Notion link has no scope and owner=user; the token exchange uses Basic auth; every Notion request is on the read allow-list;
    - Drive and Notion items indexed and found, with the Drive link; no client secret or token reaches the browser; disconnect removes the token;
  - no em-dashes in the new files.
- npm run smoke: all checks pass, including new ones: a library made with the demo embedder, two uploaded files staged and indexed, a chat naming the library cites [L1] from the right file, a mission naming it carries the library sources, and the library deletes. Both suites ran in temp data folders with local mocks. No real key, account or URL was used.
- Not verified:
  - The Libraries tab, the Command chip row, the deliverable chips and Settings > Library sources were syntax-checked (node --check) but not opened in a browser or the desktop app. That includes the file and folder upload buttons, the Drive folder browser and the Notion picker.
  - Real Google and Notion sign-ins were not run. Whether Notion accepts a http://localhost or 127.0.0.1 redirect URI for a public integration is unknown; Google Desktop-app clients accept loopback addresses.
  - Real embedding APIs (OpenAI, Gemini's OpenAI-compatible /embeddings, Mistral, Ollama) were not called. The request follows the OpenAI embeddings shape and was tested only against the demo server.
  - The PDF reader handles simple text PDFs only; how much text real-world PDFs yield is unknown (scanned ones are skipped with a note).
  - Search speed on large libraries (tens of thousands of passages) was not measured.
  - Not tier-gated: the plan does not say whether Free should be limited here. Chris decides.
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 18 DONE

## Phase 19: Custom agents and a prompt library (2026-10-19, about 11:40 local)
Nothing for this phase was committed before this session; all of it was built here. No locked decision in docs/DECISIONS.md was touched.
- Agents (Agents tab): name, description, model (any keyed model, or Auto so the router picks per job), instructions, tools, knowledge libraries and up to 8 starter prompts. Create, edit (version counter), run, delete.
  - A run is one single chat through the existing runChat: the instructions become the system prompt, and the run is tagged with the agent. Ledger, spend caps, smart fallback, the learning router and library citations work as for any chat. runChat gained optional system / agent / agentId / toolAllow / runId inputs; a plain chat is unchanged.
  - Tools (Phase 16): off, every tool switched on in Settings > Tools, or a chosen few. The few are an allow-list applied on top of the person's own on/off switches, and write tools still ask for an OK. Small additive change: chatWithTools takes `run.allow` and fallbackChat passes it through.
  - Libraries (Phase 18): stored in the libraries' existing "agent" attachments, so the Libraries tab shows them and a run gets the agent's libraries plus the chat's and the workspace's. Deleting an agent detaches them; its prompts then run on their own.
- Prompt library: saved prompts with {{variables}}. A small form asks for every value. Every variable is required: the server refuses fill and run with a value missing (400, with the missing names). Substitution is one pass, so a value is never expanded again. A prompt can be tied to an agent, and the agent can be changed per run. "Put in orders box" hands the filled text to the Command view for a council or a mission. The Command view has a row of saved prompts and agents.
- Export / import: one JSON file (`command-ai/agents`, version 1) with agents and prompts and no keys. Import checks every item before adding any and gives new ids. A prompt's link to its agent is remapped. Names stay unique. A model, library or tool server this copy does not have is dropped with a note.
- Sharing to a workspace (Studio, like the workspaces): a snapshot of the agent or prompt.
  - Owner, admin and member may run it or copy it into their own list, and may update or remove what they shared. Owner and admin may manage anything. A viewer can only look: run, copy and remove are refused with 403.
  - Local mode keeps the owner's side in a document. Hosted mode uses the table `workspace_agents` with RLS through `ws_role()`, in `supabase/agents.sql`. That is a migration file only and was NOT run against the live database. docs/hosted-hub.md has a short section on it.
- Marketplace (Phase 10 is not built): "List" saves a listing draft with a category, a one-line promise and the bundle (no library links). There is no price and nothing is published. Following marketplace.md's trust rules, instructions that ask for keys or passwords to be revealed or sent, override instructions, or switch off checks are refused.
- Demo mode: the pretend AI starts its answer with "Speaking as your custom agent **name**", so you can see the instructions arriving without a key.
- Commits: e69f781 (feature, tests, smoke checks, README row, hosted-hub note), plus this log entry.
- Tests: npm test 141/141 pass. The count includes test/publish.test.js, which is another session's uncommitted work. `test/agents.test.js` adds 5 tests:
  - pure checks: {{variables}} (order, required, blank counts as missing, one pass); the share permission table; the listing scan.
  - running server with the demo AIs:
    - validation;
    - create, edit, run on demo-nova (the instructions reach the model, one ledger line per run with matching cost);
    - an Auto agent;
    - tools off, a chosen one (only word_count offered, never the clock) and all (clock called), using the demo MCP server;
    - library attachment and detachment;
    - prompts with missing and filled variables, run with and without the agent;
    - export, delete everything, import: agents and prompts equal, new ids, the prompt-to-agent link remapped, the library link restored, and a second export equal to the first;
    - a foreign file with an unknown model, library and tool, dropped with 3 notes;
    - share to a local workspace, run and copy the shared items, unshare;
    - listing draft (no price, nothing published) and a risky agent refused;
    - delete.
  - hosted hub against a local stand-in for Supabase Auth and PostgREST that plays out the RLS of agents.sql:
    - the owner shares an agent and a prompt;
    - the member sees them (use yes, edit and remove no), copies the agent into their own list, and cannot remove the owner's item; their own share is refused on Free (402);
    - the viewer sees them read-only: run, prompt run, copy and remove are all 403, and nothing was copied;
    - an outsider sees nothing (copy is 404);
    - the owner's update reaches the member, and the owner's removal hides it.
  - No em-dashes in the new files.
- npm run smoke: all checks pass, including these new ones:
  - an agent created and run, with its instructions in the answer;
  - a prompt with a missing variable refused, and its variables substituted when filled;
  - export, delete, then import back.
- Both suites ran in temp data folders with local mocks. No real key, account or URL was used.
- Not verified:
  - The Agents tab, its dialogs (run, fill, share, listing), the editors, export download and import picker, and the Command row were syntax-checked (node --check). They were not opened in a browser or the desktop app.
  - Hosted sharing against the real Supabase tables: agents.sql has not been applied.
  - Running a shared agent on a hosted hub with real keys. A shared agent's libraries are dropped for other people, because the index is a local file.
  - Real (non-demo) models following agent instructions.
  - Not tier-gated beyond sharing: the plan does not say whether Free should be limited in how many agents or prompts it has. Chris decides.
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 19 DONE

## Phase 20: Artifacts side panel (2026-10-19, about 12:00 local)
Nothing for this phase was committed before this session; all of it was built here. No locked decision in docs/DECISIONS.md was touched, and no shared file changed beyond one name in web/features/index.js.
- Artifacts: HTML pages and mini apps, SVG, charts, Markdown, JavaScript and Python.
  - "Open in artifacts" under a deliverable saves its runnable code blocks (html, svg, chart or a chart-shaped json, markdown, js, python; bash and other blocks are ignored). The same answer is not saved twice.
  - The Artifacts tab lists everything and has "New artifact" for pasted code.
  - Charts are a small JSON spec (bar, line or pie; labels and series, or a data list), drawn as SVG on the server with no library.
  - Stored per user in the document "artifacts" (local: data folder; hosted: the user's own rows). Limits: 400 KB per version, 50 versions (version 1 and the newest are kept), 300 artifacts.
- Side panel: a version picker, Re-run, Edit (a text editor with Preview of the unsaved text and "Save as version N"), Export file, Allow internet, Delete. Saving always adds a version; earlier versions are never changed.
- Sandbox:
  - The frame is `<iframe sandbox="allow-scripts" srcdoc>` without allow-same-origin, so it has an opaque origin. It cannot read the app page, so it cannot read the session token.
  - Anything it sends to the local server carries `Origin: null`. The existing local gate refuses that (403), with or without a token, and the page with the token too.
  - Its own Content-Security-Policy comes first in its head: connect-src 'none', form-action 'none', base-uri 'none', and no outside scripts.
  - "Allow internet" per artifact (a setting, not a new version) opens https: only, for CDN scripts and images. It never opens http:, so the loopback API stays closed.
  - The frame talks to the panel only by postMessage (size and errors). The panel accepts messages only from its own frame.
- Export: the chosen version as a file (.html, .svg, .md, .js, .py; a chart as its .svg drawing). The raw route sends it as an attachment with `Content-Security-Policy: sandbox` and nosniff; the panel uses the JSON form so it also works on the hosted hub.
- Python: Pyodide (v0.26.4 from cdn.jsdelivr.net by default; Settings > Artifacts: Python takes another https:// address) runs in a Web Worker started inside the sandboxed frame.
  - It is loaded only when the person clicks Run Python. No other frame and nothing in the panel references it.
  - stdout, stderr, the last value and errors are shown. The runner is one function (PY_RUNNER) that the frame embeds and the tests call.
- Commits: eecdfe5 (feature, tests, smoke checks, README row), plus this log entry.
- Tests: npm test 144 pass, 0 fail, 2 skipped (146 in total; the count includes test/publish.test.js, another session's uncommitted work). `test/artifacts.test.js` adds 5 tests:
  - pure checks:
    - the code-block finder;
    - the CSP is first in the head and blocks all network, and Allow internet is https only;
    - only a Python frame mentions Pyodide, and the panel code never loads it, never uses allow-same-origin and never touches the token;
    - a closing script tag cannot break out of the JS runner;
    - charts (bar, pie with percentages, line, unsupported type refused);
    - Markdown is escaped;
    - export file names.
  - The Python runner with a fake Pyodide: output, last value and errors.
  - Real Pyodide: SKIPPED. Pyodide is not installed locally, and the tests never download it. `npm i -D pyodide` would turn it on; the npm lookup needed approval in this session.
  - The running server:
    - token required, and Origin: null refused (403) on /api and on the page;
    - validation;
    - create, then the frame (sandbox allow-scripts, no token in it, connect-src 'none');
    - an edit with no change is refused;
    - an edit makes version 2 with version 1 unchanged, and both versions still run;
    - preview;
    - export (attachment, file name, body of the chosen version, JSON form);
    - extract (html, chart and python, not twice);
    - chart export as SVG;
    - filters by run and project;
    - Allow internet;
    - delete.
  - Real browser: SKIPPED here. The test opens the app page in a hidden Electron window, opens an artifact through the panel code and checks from inside the frame that the token, the parent page, /api/state, the page and /api/health are all out of reach, with Allow internet off and on. Electron's GUI process did not start in this session (it exited at once with no output, and a trivial Electron app also hung, even outside the tool sandbox), so the test skipped itself. It runs on a normal desktop session.
  - No em-dashes in the new files.
- npm run smoke: all checks pass, including these new ones:
  - artifacts found in an answer;
  - the frame is sandboxed with no network and no token;
  - an edit is version 2 with version 1 kept;
  - export as a file.
- Both suites ran in temp data folders with local mocks. No real key, account or URL was used.
- Not verified:
  - The sandbox in a real browser: the Electron probe above did not run here. What was verified is the iframe attributes in the panel code, the frame's CSP and the server's refusal of Origin: null.
  - Pyodide end to end: the real CDN load and a script in the frame were not run (no network in tests). The v0.26.4 address was not checked against the CDN.
  - The Artifacts tab, side panel, editor, export download, deliverable button and Settings panel were syntax-checked (node --check) but not opened in a browser or the desktop app.
  - Whether common AI-made pages that load CDN libraries work with Allow internet on.
  - "Edit" is manual. Asking an AI to change an artifact is not built; the plan did not ask for it.
  - Not tier-gated: the plan does not say whether Free should be limited here. Chris decides.
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 20 DONE

## Phase 21: Image generation in chat (2026-10-19)
- Started from the end of this log: nothing for Phase 21 was committed yet. No conflict with docs/DECISIONS.md: Gemini keeps its key in a header (decision 8), every image is in the ledger and inside the spend caps (decision 16), nothing spends without a click.
- Features done:
  - server/images.js and server/plugins/images.js (`/api/images`): generate, edit and variation through the person's own keys.
    - OpenAI GPT-Image (gpt-image-1, gpt-image-1-mini): /images/generations, and /images/edits as multipart with the source picture for edits and variations.
    - Google Gemini (gemini-2.5-flash-image) through the native generateContent endpoint, with the source as inline data. The key goes in the x-goog-api-key header, never the URL.
    - xAI (grok-2-image): new images only. Edit and variation are refused with a message that names the providers that can do them.
    - Flux through Replicate (flux-schnell, dev, 1.1 pro; edits and variations through flux-kontext-pro, polled until done) or fal (flux schnell, dev, 1.1 pro; edits through flux-pro/kontext).
    - A variation is the source image plus a "fresh take" prompt, so every provider handles it the same way.
  - The cost estimate comes first. `/api/images/estimate` gives the per-image price, the total, whether a key is saved, and the cap state. A generate call must send the estimate it showed; a missing or lower one gets 409 with the current figure, and no call is made.
  - Spend caps (alerts plugin) are checked before any call. A provider at its cap is refused (402), and so is a batch that would take it over the cap. The alerts plugin now recomputes on image ledger lines too.
  - One ledger line per image (kind "image", provider, model, op, per-image price, no prompt text).
  - The media gallery: files go to the project's media folder, and each batch is a row in `media.jobs` with its prompt, so the Media tab lists them too. You can list (by project), view the file (served with the token only, nosniff, CSP sandbox) and delete (row and files).
  - No key: a clear message ("No OpenAI key saved. Add your OpenAI key in Settings > AI keys ..."), and no call is made.
  - Demo mode: a "Demo images" provider draws a free local SVG sketch (the prompt is escaped). Demo sketches cannot be used as edit sources.
  - Replicate and fal were added to the registry as media providers, so their keys are sealed in the vault through /api/keys and the caps apply. The fal key is the same one the Media tab already uses.
  - UI (web/features/images.js):
    - an Images tab: a form with New image / Edit / Variation, provider, model, shape, quality, count, project and upload. Generate stays off until the estimate for the current choices is on screen.
    - a gallery grid with Edit, Variation, Save and Delete.
    - an "Image from these orders" row under the Command orders box.
    - "Make an image from this" under the deliverable.
    - Replicate and fal key fields in Settings.
  - `apiBlobUrl` is now exposed on window.CC so the gallery can show the token-protected files.
  - Hosted hub: refused with a clear message for now, because the gallery lives in the local data folder.
- Commits:
  - e7d2654 Phase 21: image generation in chat (...)
- Tests:
  - npm test: 149 tests, 147 pass, 0 fail, 2 skipped (the same two real-browser and Pyodide skips as Phase 20).
  - New test/images.test.js:
    - pure: estimate maths, model choice, refusals, the escaped demo sketch;
    - server against one local mock for all five providers:
      - token required;
      - estimate first (409, nothing called);
      - each provider's image saved to the gallery with its prompt;
      - one ledger line per image with no prompt text;
      - listed on the Media tab;
      - an OpenAI edit carries the gallery image in the multipart body;
      - a Gemini variation carries the upload as inline data, with the key in a header only;
      - a Replicate edit goes through Kontext with input_image;
      - a fal variation sends image_url;
      - xAI edit refused;
      - at-cap and would-cross-cap both refused with no provider call;
      - 401 reads "Key rejected (401)" and 429 reads "rate limited";
      - failed calls save nothing;
      - delete removes the row and files;
    - no keys: every provider gives the add-a-key message and makes no call; a vault-saved Replicate key turns it on; demo sketches are free, escaped and served sandboxed; non-image uploads and demo sketches are refused as sources.
  - npm run smoke: all checks pass, including these new ones:
    - refused before the price;
    - demo images in the gallery with the prompt;
    - one ledger line per image;
    - the OpenAI add-a-key message.
  - Both suites ran in temp data folders with local mocks. No real key, account or URL was used.
- Not verified:
  - No real provider was called. The request shapes follow each provider's published API, but these were not checked here:
    - the model ids (gpt-image-1, gemini-2.5-flash-image, grok-2-image, the Flux ids);
    - Gemini's imageConfig aspect ratio;
    - Replicate's input_image on Kontext;
    - fal's num_images and image_url.
  - Prices are per-image estimates (October 2026 list prices), not checked against live price pages. OpenAI edits also bill the source image as input tokens, and the estimate only says so; it does not add a figure.
  - The Images tab, gallery, Command row, deliverable button and Settings panel were syntax-checked (node --check) but not opened in a browser or the desktop app.
  - Not tier-gated: the plan does not say whether Free should be limited here. Chris decides.
  - Images do not yet go into the chat answer itself or the council. They show under the orders box and in the gallery.
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 21 DONE

## Phase 22: Scheduled and triggered agents (2026-10-19, about 06:55 local)
- Checked first: nothing for Phase 22 was committed yet, so the whole phase was built in this session. No conflict with docs/DECISIONS.md. The webhook exemption follows the existing Grok Bot callback pattern, and no locked item was touched.
- Done:
  - A schedule runs a custom agent (Phase 19), a plain chat or a mission, for a project if picked. It runs through the same runners as a click (h.runChat / h.runMission), so the ledger, the per-AI spend caps, smart fallback, tool approvals and tier gates all apply. Core logic is in server/schedules.js, routes and the runner in server/plugins/schedules.js.
  - Triggers:
    - Cron: five fields in local time, with lists, ranges, steps, weekday 7 = Sunday, and @hourly / @daily / @weekly / @monthly.
      - Each slot fires at most once (the slot is stored before the run).
      - A late tick still fires a slot from the last five minutes.
      - Slots missed while the app was closed, or while the schedule was paused, are not replayed.
      - Shows the next run time.
    - Webhook: `POST /api/schedules/hook/<id>`.
      - Each trigger has its own random token, shown once and stored only as a SHA-256 hash. It is compared with timingSafeEqual. It is accepted from X-CC-Trigger-Token, Authorization: Bearer or ?t=. "New token" retires the old one.
      - The route is exempt from the session token and the Host pin, like the Grok Bot callback. An unknown trigger and a wrong token both get 401, and the session token alone does not open it.
      - JSON or empty body only (415), 64 KB (413), 30 calls a minute (429), at most five runs waiting.
      - The body is handed to the run as data, not as instructions.
    - Watched folder: polled, with an optional pattern (`*.txt, *.csv`).
      - Files already there are the baseline.
      - A new file runs once its size holds still for one scan. Partial downloads and temp files are ignored.
      - Text files up to 50 KB are handed to the run as data.
      - The path must be an absolute, existing folder, and the app's data folder is refused.
  - Run history: source, file, status, cost, error, mission/chat id, and where a result was sent.
  - Spend cap per schedule (monthly, default $1). When the month's runs reach it:
    - the schedule pauses (reason "cap");
    - an alert goes out through the alerts plugin (in-app log, push and email per the prefs, deduped per month);
    - the next trigger is refused (409) and a manual run is recorded as "stopped";
    - Resume is refused until the cap is raised.
    - A mission gets the cap that is left as its budget.
  - Approval step: "After the run: send it to a web address".
    - The result is held in "needs_approval" with the full text and the address shown. Nothing is sent before Approve.
    - Approve sends one JSON POST (15 s timeout, no redirects, clear "Could not reach" / "refused (status)" errors). Don't send drops it.
    - Tools that write or send during a run still ask through the Phase 16 approval prompt.
  - Tier: a mission schedule (create, edit, Run now) goes through guard("missions"), so Free gets 402. Agent and chat schedules are not gated (see below).
  - Desktop only: a hosted hub refuses the routes and the webhook with the message "Schedules run on the desktop app for now. Always-on schedules need the hosted hub later."
  - UI (web/features/schedules.js), the Schedules tab:
    - the note "Desktop schedules only run while the app is running (the tray counts). Always-on schedules need the hosted hub later.";
    - the webhook token panel, shown once;
    - a "Needs your approval" panel with Approve and send / Don't send;
    - the schedule list with spend against the cap, Run now, Pause/Resume, Edit, New token and Delete;
    - the run history;
    - the create/edit form with cron presets;
    - live refresh on schedules.* events (it never re-renders while you type in the form), and a toast when a result waits for approval.
  - Docs: docs/schedules.md (with the same note) and a README row.
- Commits:
  - ebc5e30 Phase 22: scheduled and triggered agents (...)
- Tests:
  - npm test: 156 tests, 154 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips as before; the count includes another session's uncommitted test/publish.test.js, which passes).
  - New test/schedules.test.js, 7 tests:
    - cron parsing and refusals;
    - a fake clock: 30 minutes in 20 s steps with double ticks fires */5 exactly six times, once per slot; a late tick fires once; a long gap does not replay;
    - pause and resume do not replay;
    - a cap that stops, alerts once (level stop), refuses the webhook and a manual run with no runner call, and resumes only after the cap is raised;
    - needs_approval: nothing sent before Approve, one send after it, 409 on a second approve, Don't send sends nothing, a failed run skips approval, file:// refused;
    - a new fixture file in a watched folder runs once with its contents; the baseline, non-matching and partial files do not; the data folder and relative or missing paths are refused;
    - against the real server in demo mode (fast tick) with a local mock receiver:
      - wrong, missing and session-only tokens give 401 with nothing queued;
      - text/plain gives 415, GET gives 405;
      - the right token gives 202 and an agent run that waits in needs_approval;
      - the mock gets nothing until Approve, then exactly one POST with the text;
      - ?t= and Bearer both work, and a rotated token retires the old one;
      - a new file in a watched folder runs;
      - a tiny cap pauses the schedule, puts the alert in the feed, and the next hook gets 409;
      - the run's call is in the ledger;
      - Free gets 402 for a mission schedule;
      - a deleted schedule's hook gets 401.
  - npm run smoke: all checks pass, including these new ones:
    - schedule webhook wrong token 401;
    - right token queued;
    - the result waits for approval;
    - Don't send drops it;
    - mission schedule gated on Free.
  - Both suites ran in temp data folders with local mocks. No real key, account or URL was used.
- Not verified:
  - The Schedules tab was syntax-checked (node --check) but not opened in a browser or the desktop app.
  - The real 15 s timer in the app was exercised only with a fast tick in tests. Cron timing on the wall clock was checked through the fake clock, not by waiting for real slots.
  - Folder watching polls (no fs.watch). Network drives and cloud-synced folders (Drive, OneDrive) were not tried.
  - A webhook from outside this PC needs the hosted hub or a tunnel Chris sets up; neither exists, so only local callers were tested.
  - Chris decides:
    - whether agent and chat schedules should be Pro-only (the existing "scheduler" tier flag covers the off-peak scheduler; this phase gates only mission schedules, through the missions gate);
    - the default per-schedule cap ($1).
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 22 DONE

## Phase 23: ChatGPT and Claude history import, optional encrypted sync (2026-10-19, about 14:10 local)
- Checked first: nothing for Phase 23 was committed yet, so the whole phase was built in this session. There is no conflict with docs/DECISIONS.md and no locked item was touched.
- Shared files got small changes only:
  - server/index.js: one exempt path. A raw zip body is allowed on POST /api/history/preview only. application/zip is not a CORS-safelisted type, so it is still preflighted, and the session token is still required. Every other route still returns 415 for a non-JSON body (tested).
  - web/app.js: api() can send a File as the body.
  - web/features/index.js: adds "history" to the feature list.
- Features:
  - History import (History tab, desktop only):
    - Reads the ChatGPT or Claude export zip on this PC, picked in the file picker or typed as its location. Nothing is uploaded. The app's data folder and relative paths are refused.
    - Own zip reader with no dependency: stored and deflate, zip64, one folder level, __MACOSX ignored.
    - ChatGPT: keeps the visible thread from current_node. Edited branches, hidden system turns and tool turns are dropped. Images show as [image], code is fenced and the model slug is kept.
    - Claude: reads content blocks, attachments and tool use. A conversation linked in projects.json goes into a project of that name.
    - A preview comes first (counts, date range, newest titles). Then the person files the chats under a new project per source, an existing project or none. When the tier allows no more projects, the chats are filed without a project and a note says so.
    - Each chat is saved as a run of kind "imported" with its title, dates and every message, plus a Markdown transcript, so the normal run view opens it.
    - Ids come from the source's own ids: importing the same export again adds nothing, and a newer export updates only the chats that changed.
    - Bad files get clear messages: not a zip, empty, cut off, damaged, password protected, no conversations.json, invalid JSON, not the ChatGPT or Claude format.
  - Optional encrypted sync (off by default):
    - Key: PBKDF2-SHA256 (600k rounds) from a passphrase of at least 10 characters, with a random salt per sync space.
    - Each chat is sealed with AES-256-GCM, with the AAD bound to an HMAC item id, so chat ids are not visible either.
    - Push, pull and delete need a token. The server keeps only its SHA-256.
    - web/sync-crypto.js is shared, so the phone (hosted hub) unlocks chats in its browser and the hub server never sees them.
    - The desktop pushes single-AI and imported chats and pulls other devices' chats every 10 minutes or on Sync now. Pulled chats are never echoed back. Chats made on this PC always win.
    - The key (not the passphrase) is kept in the vault, or in memory if "remember" is off. Turn off forgets it and can also empty the cloud copy.
    - supabase/sync.sql is a migration file only and was NOT run: RLS on with no policies, plus four security-definer functions.
  - docs/history.md.
- Commits:
  - 3f2f689 Phase 23: ChatGPT and Claude history import, optional encrypted sync (...)
- Tests:
  - npm test: 161 tests, 159 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips as before). The count includes another session's uncommitted test/publish.test.js, which passes.
  - New test/history.test.js, 5 tests, with fixture exports in test/fixtures/history/ zipped at test time by test/history-helpers.js:
    - ChatGPT zip: titles, ms dates from fractional seconds, message order and text, model, dropped branch, system and tool turns. Re-import is unchanged; a newer chat updates only that chat.
    - Claude zip (stored and deflated entries, folder prefix, __MACOSX junk): ISO dates, content blocks, attachments, Unicode, project names, an empty chat skipped, and the tier-limit note.
    - Nine bad files, each refused with a 400, its own code and a plain message.
    - Sync against an in-process stand-in for the four Supabase functions:
      - Nothing the server holds contains the passphrase, titles, text, chat ids or model names, in the clear or base64-decoded. Item ids are 40-hex HMACs. Only a token hash is stored.
      - A second client with the same code and passphrase pulls every chat with its text intact. A chat made there comes back. Nothing echoes.
      - A wrong passphrase is refused (401). A wrong-passphrase key cannot open a blob and its token is refused. A blob moved to another row does not open. An unknown code is refused. Turn off with delete empties the space.
    - The real server in demo mode with a local Supabase stand-in:
      - Raw zip upload, preview and import into a project.
      - No token gives 401. A bad zip gives 400. text/plain or zip bodies on other routes still give 415. The data folder and relative paths are refused. A preview is used once (410).
      - Free tier "new project" import gives the note.
      - Sync is off by default. Between two app copies, a wrong passphrase gives 401, and the right one pulls the chats.
  - npm run smoke: all checks pass, including 4 new ones: a ChatGPT zip is previewed, the imported chats are in the run history, a bad file is refused clearly, and sync is off by default and needs a cloud project.
  - Both suites ran in temp data folders with local mocks. No real key, account, Supabase project or URL was used.
- Not verified:
  - The History tab and the phone unlock page were syntax-checked (node --check) but not opened in a browser, the desktop app or on a phone. The browser side uses the same web/sync-crypto.js as the tested Node side, but WebCrypto in a mobile browser was not tried.
  - Real export zips were not tried; the fixtures follow the current documented shapes. ChatGPT and Claude change their export formats now and then.
  - supabase/sync.sql has not been run on any database, so the SQL itself is untested. Only its behaviour was mirrored by the stand-in.
  - Very large exports (hundreds of MB) were not tried. The whole zip is read into memory (limits: 512 MB upload, 1 GB by path).
- Chris decides:
  - whether and when to run supabase/sync.sql on a Supabase project;
  - whether sync should be a paid-tier feature (it is ungated now);
  - the 600k PBKDF2 rounds.
- `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js) are other sessions' uncommitted work and were left alone. Nothing was pushed (Chris pushes).

PHASE 23 DONE

## Phase 24: Smaller extras (2026-10-19, about 07:40 local / 14:40 UTC)
- Checked first:
  - Nothing for Phase 24 was committed yet, so all four items were built in this session.
  - No conflict with docs/DECISIONS.md. Two locked areas got additions only, nothing reverted or reworked:
    - electron/main.cjs: the quick-launcher window, a tray item and `will-quit` cleanup. appId, setName, single instance, own server, updater and reload guard are untouched; test/decisions.test.js and test/desktop-update.test.js pass.
    - server/plugins/workspaces.js (Phase 8): a sign-in-rule check on switching and a "locked" view. Roles, invites, sharing and usage are unchanged; test/workspaces.test.js passes.
- Shared files got small changes only:
  - server/index.js: price source per model, quick.html token injection, the extension hook (exempt from the session token only, Host pin kept), /api/sso/start, `sso` in /api/config, workspace keys loaded per hub user, and Settings keys editing your own key only (`getOwnSecret`).
  - server/registry.js: `modelPrice()` reads your own price, then live, then built-in; plus `clearPricing` and `priceSource`.
  - server/vault.js: a scoped resolver asked first (workspace keys), plus `getOwnSecret`.
  - server/hosted.js and server/auth.js: how the session signed in (`amr`) and the account's identities.
  - server/plugins/receipt.js: the flagship is picked at the price in use.
  - web/app.js: the "Continue with Google / Microsoft" buttons on the hub sign-in page.
  - web/features/index.js: five feature ids added.
  - electron/desk-preload.cjs: quickDone and quickHide.
  - electron-builder.yml: `extension/**` in files and asarUnpack.
  - test/helpers.js: the live-price feed points at the local stub.
  - test/smoke.mjs: 6 new checks.
- Features:
  - **Global hotkey quick launcher** (desktop):
    - Default Alt+Space, changed in Settings > Quick launcher by pressing the keys. A small always-on-top box sends one order to this app's own server as a Chat or Council, then brings the main window forward.
    - electron/hotkey.cjs never takes a shortcut Windows or another app already holds: `register()` false means it is left alone with a note.
    - It refuses OS combinations (Alt+Tab, Ctrl+Alt+Delete, Cmd+Space and others) without trying, and requires a modifier.
    - It releases only its own shortcut, on change, on off and on quit.
  - **Chrome / Edge extension** (extension/, Manifest V3, load unpacked):
    - Right-click page, selection or link, or the popup with a note.
    - Host permissions are 127.0.0.1 and localhost only.
    - Paired with a code shown once; only its SHA-256 is kept. Unpair works.
    - /api/ext/* accepts only the pairing code. It refuses web origins, keeps the Host pin, takes JSON only, and limits wrong codes to 20 and sends to 30 a minute.
    - The default is "Put it in Marching orders" (nothing runs until Send). "Ask now" and "Council" run with the ledger, caps and tier limits.
  - **Live model pricing:**
    - List prices from the OpenRouter models API, once a day (an hour after a failure), with the last good table kept on the PC.
    - Matched by vendor prefix (dots and dashes alike, -latest). Groq, custom, demo and variable routes are left alone.
    - Feeds the router, ledger estimates and savings receipts through `modelPrice()`. Your own price always wins.
    - Settings > Model prices: built-in, live, yours and in use; Refresh now; on/off.
  - **Team SSO for the hosted hub:**
    - "Continue with Google / Microsoft" through Supabase Auth's Google and Azure providers, turned on with CC_SSO_PROVIDERS. /api/sso/start redirects only back to the hub.
    - Per-workspace rule (owner or admin, Studio): providers and email domains. A session that does not meet it sees the workspace locked, cannot switch to it and gets none of its keys. The owner is never locked out.
  - **Per-workspace API keys:**
    - Owner or admin, Studio. Used only for calls made while that workspace is active.
    - Desktop: in the DPAPI vault. Hub: workspace_secrets, AES-256-GCM bound to `ws:<id>:<provider>`. Owner, admin and member can use them; viewers use their own keys.
    - The sign-in rule is re-checked on every call. Keys are shown masked only.
  - docs/extras.md (with Chris's setup steps for SSO), README rows, hub env vars in docs/hosted-hub.md.
- Commits:
  - d4e19ab Phase 24: live model pricing from the OpenRouter models API (...)
  - 1c305fd Phase 24: global hotkey quick launcher (...). In this commit, two lines of server/index.js were joined (still valid JavaScript); 9cce51f restored them.
  - 9cce51f Phase 24: Chrome / Edge extension (...)
  - 4ddbb4e Phase 24: Team SSO (Google and Microsoft) for the hosted hub and per-workspace API keys (...)
  - fda464c Phase 24 docs: docs/extras.md, README feature rows, hub env vars
- Tests:
  - npm test: 178 tests, 176 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips as before). The count includes another session's uncommitted test/publish.test.js, which passes.
    - One earlier full run had a single failure: the grokbot test's 60-second wait for a plain council, which timed out under load. That test passed alone (3/3), and the next full run passed.
  - New tests:
    - test/pricing.test.js (3): fixture matching; a fixture list served by a local mock updates the router's cost, the ledger estimate and the receipt; your price wins and survives a refresh; off means built-in; a failed refresh says "Could not reach OpenRouter" and keeps the last table; nothing secret on disk.
    - test/hotkey.test.js (6): registration against a stand-in for globalShortcut (default, taken shortcut left alone, OS combinations, change, off, unregister on quit); main-process wiring; route without a desktop; quick.html gets the token and calls no outside URL.
    - test/extension.test.js (4): manifest only on loopback; the code shown once with only its hash stored; no code, wrong code, unpaired code or the session token alone gives 401; web origin 403, wrong host 421, non-JSON 415; draft starts nothing; chat and council run on the demo AIs and are in the ledger; 429 after too many wrong codes.
    - test/teams.test.js (4):
      - Local: the mock provider sees the workspace key only while that workspace is active; Personal and other workspaces get your own key; removed or deleted workspace means your own key again; Studio gate.
      - Hosted, with a Supabase and identity-provider stand-in: the mocked OIDC round trip (authorize, IdP, callback, back to the hub with a session); no open redirect; rule setting by role; ciphertext-only rows; magic-link and wrong-domain sessions refused; the owner never locked; a Google session of the member uses the team key; the same member's emailed-link session never does; viewers do not.
  - npm run smoke: all checks pass, including 6 new ones: live prices on, quick launcher default, extension accepted only with its code, workspace key masked, and workspace keys gated for Free.
  - Both suites ran in temp data folders with local mocks. No real key, account, Supabase project, OpenRouter call or other outside URL was used.
- Not verified:
  - The desktop quick launcher was not opened: the Electron GUI cannot start in an agent run. main.cjs was syntax-checked and its wiring checked by tests. The real `globalShortcut` behaviour on Windows (including whether Alt+Space is free on Chris's PC) is untried.
  - The extension was not loaded into a real Chrome or Edge, and has no icon (copying the app icon was not permitted in this run, so Chrome shows its default). The popup and worker were syntax-checked only.
  - The live OpenRouter feed was never called. Its real model ids for the 2026 model names in the registry are a guess, so some models may show "not listed" until the registry's ids match OpenRouter's.
  - SSO against real Google, Microsoft and Supabase Auth was not tried. The amr and identities handling follows Supabase's documented token shape.
  - supabase/workspace-keys.sql and supabase/team-sso.sql were not run on any database, so the SQL itself is untested; only its rules were mirrored by the stand-in.
  - The Settings panels (pricing, hotkey, extension, workspace keys, team sign-in) and the hub sign-in buttons were syntax-checked but not opened in a browser.
- Chris decides:
  - Whether to set up Google and Microsoft OAuth clients and turn on CC_SSO_PROVIDERS.
  - Whether and when to run the two migration files.
  - Whether to publish the extension to the Chrome Web Store (it is load-unpacked only now).
  - Whether workspace keys and SSO rules stay Studio-only (they are now).
- Other sessions' uncommitted work was left alone: `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js). Nothing was pushed (Chris pushes).

PHASE 24 DONE

## Phase 14: Mac build (2026-10-19, about 14:50 local)
- Started from scratch: no Phase 14 work was committed before this run. The Keychain vault (Electron safeStorage), the Mac targets in electron-builder.yml and docs/ci/mac-build.yml already existed from earlier phases.
- Features:
  - **macOS app menu** (electron/main.cjs): Command AI (About, Check for updates, Hide, Quit with Cmd+Q), Edit, View (full screen, zoom) and Window. Without it, Cmd+C, Cmd+V, Cmd+A and Cmd+Z do nothing in text boxes on a Mac and Cmd+Q does not quit. It has no reload item, so reloads still go through safeReload (decision 7). Windows still has no menu bar.
  - **Tray:** an 18 pt icon in the Mac menu bar; Windows keeps 16 px.
  - **Engine start:** the server is imported with `pathToFileURL`. The old Windows-only path rewrite would have produced a plain path for "/Applications/Command AI.app/...". Windows gives the same file:///C:/... URL as before.
  - **Updates on unsigned Mac builds:** `MAC_SELF_UPDATE = false` turns on `manualInstall` in electron/updater.cjs on Mac only.
    - The launch prompt, tray and Settings still say "vX.Y.Z is ready". Install now opens the release page for that version (https://github.com/everbornproductions-stack/command-center-releases/releases/tag/vX.Y.Z) and says why.
    - It never downloads and never quits, because Apple lets only signed apps replace themselves.
    - Windows is unchanged (manualInstall is off by default).
    - Set the flag to true once Developer ID signing and notarization are on.
  - **Mac workflow** (docs/ci/mac-build.yml):
    - A missing release is now created as a **draft** and nothing is published. Before this, a tag push that ran ahead of the Windows release would have published a Mac-only release with no latest.yml, and every Windows copy would have reported an update error (decision 3).
    - It now runs `npm run smoke` as well as `npm test`, and builds with the new `npm run dist:mac` (unsigned dmg and zip, x64 and arm64).
    - It stays parked in docs/ci/ because moving it to .github/workflows/ needs `gh auth refresh -s workflow` and a push, which are Chris's steps.
  - **Data folder:** unchanged. `app.setName("Everborn Command")` puts Mac data in `~/Library/Application Support/Everborn Command`. This is checked by test only.
  - docs/RELEASING.md Mac section updated.
- Commits:
  - e79c7a1 Phase 14: Mac build readiness (macOS app menu, menu-bar tray size, pathToFileURL engine import, unsigned-Mac manual install, draft-only Mac workflow, dist:mac, tests)
  - 212c2fb Phase 14 docs: RELEASING.md Mac section
- Tests:
  - npm test: 183 tests, 181 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips). The count includes another session's uncommitted test/publish.test.js.
  - npm run smoke: all checks pass.
  - New test/mac.test.js (5 tests):
    - The workflow: unsigned, both architectures, RELEASES_TOKEN is the only secret, draft only, never publishes.
    - The builder config: Mac names, same appId, Windows installer name unchanged.
    - The main-process Mac wiring.
    - The manual-install updater: opens the page, no download, no quit, Settings path rejected with a clear note.
    - The Keychain vault: server/vault.js runs in a child Node that reports "darwin" (test/fixtures/as-darwin.cjs) with a stand-in for safeStorage. Saving writes an `ss1:` blob with no plain or base64 key, and it reads back. Plain Node on a Mac refuses to save and does not overwrite the vault.
  - Extra check, not committed: the full suite also passed with every test process reporting "darwin" (176 pass, 2 skipped). The server child processes the tests start still ran as Windows, so this is only a partial emulation.
- Not verified (each needs a real Mac or the Mac runner):
  - `electron-builder --mac` was never run. It only runs on macOS, so the dmg and zip, their names and latest-mac.yml are unbuilt.
  - The app was never started on a Mac: server start, Keychain prompt and real safeStorage, the tray in the menu bar, the window, the Dock click reopening it, the app menu and the data folder location.
  - The quick-launcher hotkey and the built-in browser helper on macOS. The Alt+Space default maps to Option+Space there.
  - The workflow has never run on GitHub (it is parked in docs/ci/).
  - Gatekeeper first-open behaviour and the release page opened by Install now.
- Chris decides:
  - Turning the workflow on: `gh auth refresh -s workflow`, `git mv docs/ci/mac-build.yml .github/workflows/mac-build.yml`, push, and add the RELEASES_TOKEN secret.
  - Whether to buy the Apple Developer account ($99/year) for signing, notarization and Mac self-updates.
- Other sessions' uncommitted work was left alone: `cc-names.tmp.mjs` and the publish files (server/plugins/publish.js, web/features/publish.js, test/publish.test.js). My scratch file `cc-mac-sim.tmp.cjs` was deleted. Nothing was pushed (Chris pushes).

PHASE 14 BLOCKED: everything that can be done on Windows is finished and committed (Mac menu, tray, engine import, unsigned-Mac updates, draft-only workflow, tests), but the plan's step "check that the app runs on a Mac" (server start, Keychain vault, tray, window, data folder) and the Mac build itself need a real Mac or the macOS runner, which this PC does not have; signing and notarization also need the Apple Developer account Chris has not decided on.

## 2026-10-19 09:58 PT: chain paused by Grok Bot (health check)
- CC-Build-Chain task disabled while Grok Bot merges Cursor PRs #3 (onboarding once), #4 (Phase 29 live project view) and #5 (voice tap-to-talk) and publishes a release. The chain had already stopped at 07:48 on the Phase 14 BLOCKED line (needs a real Mac). Other sessions' uncommitted publish files and cc-names.tmp.mjs are left alone.

## 2026-10-19: FIX onboarding-repeat (built by Cursor cloud agent)

- First-run setup ("Let's connect the AIs you already use") opens only when this install has no history. History is any of: a real key in the vault, saved settings (anything beyond the factory defaults), past chats or jobs (ledger lines or mission files), or bookmarks the app already has (a project link with a url, or a bookmarks backup file). A completed flag with a version in `onboarding.json` also keeps setup closed. If any history exists and the flag was missing, the app writes the flag and does not show setup.
- The flag lives in the user data folder, next to settings and the vault. It is not in localStorage. The v0.3.2 cache clear (service workers and HTTP/script caches) does not touch it.
- Later launches open the hub. Bookmark organizing does not run on launch.
- At most once every 24 hours, after plugins load and the first health check finishes, the app compares providers, models and vault key ids with the remembered history. The first check only records what is already there. Later checks name only what is new ("New: X added") and do not open setup, import env keys, call providers, or reorganize bookmarks.
- Settings keeps a manual "Run setup again".
- Rebased onto origin/main through Phase 14. Claude's phases were kept. npm test 186 pass, 0 fail, 1 skipped (Pyodide is not installed here); npm run smoke all pass. test/onboarding.test.js covers a completed flag, an existing vault key, saved settings, jobs, bookmarks, and a daily check that baselines once then waits 24h. Temp data dir and a test-only vault preload. No real key.
- Not verified: a packaged Electron build, a real Windows DPAPI vault, or a real browser profile. The fresh setup screen, the hub after history exists, and Settings were checked in the browser against the local server.

FIX onboarding-repeat DONE (built by Cursor cloud agent)

## 2026-10-19: Phase 29 (Live project view), built by Cursor cloud agent

- Live tab, the Command status line, and the project page show who is working, the current step, and credits or cost from the existing ledger, updating over the existing WebSocket. Open in links: Kling task page, and the OpenAI, Anthropic, and xAI usage dashboards. The UI says API chats do not appear in claude.ai, grok.com or ChatGPT history. Links are only opened by a click. Nothing is fetched.
- Flow map (SVG and CSS, no new dependencies): each AI or agent is a node. Active nodes glow. Busy edges carry a light stream. Idle nodes and edges fade to dim and stay on the map. A tooltip shows the step and the cost. prefers-reduced-motion keeps the highlight and turns the moving light off.
- Outside agents use one adapter: Grok Bot (webhook handoff), the built-in browser helper, Cursor cloud builders, and any later agent added with registerExternalAgent. Each handoff shows sent, working, or reported back, the job, when it was sent, the result, and an Open link only for an https page (Cursor uses https://cursor.com/agents/<id>). Phase 12 and Phase 27 already emit external.handoff from their own dispatch. This phase only watches that event.
- Demo pretend providers are registered before their keys are saved, so on macOS and Linux without the desktop keychain those keys stay in memory, which vault.js already allowed. Tests seal other keys with a process-local stand-in for the desktop keychain. The app itself still refuses plain Node saves.
- Rebased onto origin/main after Phases 12, 16, 26, 27, 28, 25, 13, and 17 through 24 and 14. Claude's log, decisions, and plan text were kept.
- Tests: npm test 186 pass / 1 skipped (test/liveview.test.js adds 8: links, mission events, flow-map state, Kling credits, external handoffs, the Phase 12 and Phase 27 handoff payloads, source checks, and a demo chat over the WebSocket). npm run smoke all checks pass. No real provider URL or key. Node 22.14.0 here has no FTS5 in node:sqlite, so the library tests need 22.23.3 (which has it); that is the runtime, not a Phase 29 change.
- Browser (before the rebase): Live tab, a demo Single chat, Nova on the map with the tooltip "Nova (demo) answering" and $0.0001, and the map on the project page. Not verified: the OS reduced-motion setting in a browser, opening a real Kling or usage page, and a real Grok Bot, browser helper, or Cursor cloud handoff (handoffs were tested with mocked events shaped like the Phase 12 and Phase 27 payloads).

PHASE 29 DONE (built by Cursor cloud agent)

## 2026-10-19: Voice orders, hold stays down and tap to talk (Cursor cloud agent)

- The Hold to talk button stopped on `mouseleave` (and on mouseup / touchend only), so a press ended as soon as the pointer slid off the button, and a re-render or a lost pointer dropped the release. The speech recognizer also ends itself on a pause or its own timeout. A hold now captures the pointer, ignores leave / cancel / blur / lost capture, and restarts the recognizer until the button or key is actually released.
- Tap to talk is the default: tap once to start, tap again to stop, with a Recording indicator and timer. Stop on silence is optional and never cuts a hold short. Settings > Voice orders switches back to hold to talk. The choice is stored on the settings document (`settings.voice`).
- The desktop shell grants the local window microphone access so speech recognition is not cut off by a missing media permission.
- Demo mode on macOS and Linux registers the pretend AIs before saving their in-memory demo keys, so demo can start without an OS keychain. Tests outside Windows load a test-only keychain stand-in (`test/vault-preload.cjs`); the app itself still refuses to save real keys in plain Node.
- Tests: test/voice.test.js. npm test 191 pass, 1 skipped (Pyodide is not installed here; the real-browser artifacts test ran), npm run smoke all checks pass. No real key, no network provider, temp data dir only.

FIX voice-toggle DONE (built by Cursor cloud agent)

## 2026-10-19 10:30 PT: chain resumed by Grok Bot
- Merged Cursor PRs #3 (onboarding runs once), #4 (Phase 29 live project view and flow map) and #5 (hold-to-talk fix, tap-to-talk) into main. Conflicts in BUILD-LOG.md kept both sides; server/mock.js and test/helpers.js kept the PR #4 version (same demo-provider order fix and an identical test keychain stand-in as PR #5). npm test 212 tests, 210 pass, 0 fail, 2 skipped; npm run smoke all pass.
- Released v0.4.0 on command-center-releases (built from main at 99158ad, which includes the publish change another session committed at 10:11). Installer, blockmap and latest.yml uploaded; latest.yml says 0.4.0 and the release is marked latest.
- PR #2 (older Phase 17 draft, conflicting) left open: Phase 17 was already built by Claude.
- CC-Build-Chain task re-enabled. The chain still stops at the Phase 14 BLOCKED line (needs a real Mac) until Chris decides how to handle Phase 14; phases 2-7 and 9-11 come after it in the run order.

## 2026-10-19 20:50 PT: Phase 2 (Proof of value)
- Started on Chris's direct order for Phase 2. Phase 14 is BLOCKED only on steps that need a Mac, which decision 14 expects. No conflict with docs/DECISIONS.md.
- Already in the code before this session, and kept as it was: the pipelines plugin with Instagram week, Music video and Client site launch; per-run savings receipts with a PNG export under each deliverable and a totals line in Command; spend caps with amber at 80%, a stop at 100% in the router, and in-app, push and email alerts (74d9cca). This phase added only what was missing.
- Starter pipelines (R1):
  - Added the "Client proposal" starter: problem and goals, plan, timeline, pricing options, and the proposal letter. Every amount comes from the inputs or is marked [ASK]. It is a draft and is never sent from the app.
  - "Off-peak" on a pipeline run used to be ignored: the run started at once. It now queues for the next discount window, the same way a Command mission does, and runs at once only when no window is configured. The scheduler tier gate applies.
  - Results are filed under the project: the mission carries projectId, and the project page lists it.
- Savings receipt (R7):
  - The Credits tab has a new "Savings receipts" panel: saved this month and all time against the flagship-only cost, the number of runs, and the newest runs, each with its own "save as image" PNG.
  - New route GET /api/receipt/recent.
  - The Credits tab has a feature hook (`credits` kind, `#credits-extras`). The tab redraws on every tick, so the panel fetches at most every 30 s.
- Spend caps and alerts (R10):
  - Gap fixed: the router stopped sending work to a capped AI only while another AI was free, and a chat pinned to a capped AI still called it. Now streamChat refuses any call to a provider at 100% of its cap, with a clear "reached its monthly spend cap" note and code `cap`.
  - Smart fallback treats that refusal as a reason to hand the job to a stand-in. It does not mark the provider as in trouble or log a failure against it, and the chat runner does not count it as the provider's failure either.
  - Saving a cap that is already at 80% or 100% now raises the alert right away.
  - The amber text no longer says the router "leans away" (it never did). It now says the AI keeps working until 100%.
- Commits:
  - d7e6514 Phase 2: starter pipelines add Client proposal, off-peak pipeline runs queue for the discount window, tests
  - 23fe8b0 Phase 2: savings receipts on the Credits tab (totals, recent runs, PNG per run), tests
  - 783556f Phase 2: spend caps hard stop at 100% even with no stand-in, alert on cap save, honest amber text, tests
- Tests:
  - New: test/pipelines.test.js (3), test/receipt.test.js (2), test/caps.test.js (1). Temp data dir, demo AIs only, no real key or URL.
  - npm test: 218 tests, 216 pass, 0 fail, 2 skipped.
  - npm run smoke: all checks pass.
- Not verified:
  - The Credits tab panel and the PNG export were not opened in a real browser. They are covered by source checks only.
  - An off-peak pipeline that is actually queued: the test data dir may have no discount rule, and in that case the test only checks that the run starts.
  - Push and email delivery of cap alerts (no real Resend key or push device). The test checks the alert record, not delivery.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 2 DONE

## 2026-10-19 13:57 PT: Phase 3 (Quality loop)
- Started after PHASE 2 DONE. No conflict with docs/DECISIONS.md: the learning router (decision 18) still gets every thumb, and council scoring is unchanged.
- Already in the code before this session, and kept: the thumbs under every deliverable (web/features/ratings.js), the ratings log and summary routes, the thumb reaching the learning router (Phase 28), the project memory editor in Settings and the "project memory in use" badge in Command. Neither plugin had tests. This phase added only what was missing.
- Rate the result (R4):
  - Gap fixed: a thumb was stored in the skills table as a fake council round (a win or a loss), so the skills matrix could not tell your ratings from council votes, and changing a thumb counted twice there.
  - Thumbs now have their own up / down counts per model and task type. Council wins and rounds only change in a council. A changed thumb replaces the earlier one, also when the task type differs.
  - Each source moves the score on its own after 2 signals: council by its win rate as before, your thumbs by up to 12 points either way. The router uses both, and the learning router still weighs thumbs double.
  - The skills matrix on the Credits tab shows, under each score, "council +n" and "you +n" on separate lines, with the baseline in the tooltip. /api/ratings/summary returns council and human counts and deltas apart. Unknown task types are filed as writing.
  - The unrated chip showed an em-dash. It now says "not rated".
- Project memory and brand voice (R5):
  - Gap fixed: memory only reached prompts typed in Command, because the page pasted it in. Pipelines, schedules, queued off-peak missions and comparisons ran without it, and the QA reviewer, the mission assembler and the council reviewers and chair never saw the never-say list.
  - The server now adds it (server/project-memory.js) to single chats, every council member plus the reviewers and the chair, every mission step plus QA and the assembler, pipelines, schedules, off-peak runs and side-by-side comparisons, and to the context given to an outside agent. A prompt that already carries it is not given a second copy. The page now sends the raw prompt, so the stored prompt is what the person typed. Runs record `memory: true`.
  - HQ importer: sorts a client brief into Brand voice, Offers, Never say, Past winners and Facts by its headings. It fills empty sections and sections still exactly as the last import left them, and keeps anything the person edited. The toast says what it filled and what it kept. It uses the HQ folder from CC_HQ_DIR (the old code guessed a folder two levels above the data folder, which is wrong in a packaged build) and only accepts a plain slug as the file name.
  - "Keep as a past winner for this project" under a rated result adds one dated line to the project's past winners (newest first, no repeats, within the 4000 character limit).
  - Demo mode: the pretend AI says "Following the project memory for <project>" when memory arrived, so the injection can be seen without keys.
- Commits:
  - 7dc4469 Phase 3: rate the result (R4): thumbs stored apart from council votes, a changed thumb replaces the old one, skills matrix shows council and your ratings separately, tests
  - ee3f1b8 Phase 3: project memory and brand voice (R5): the server adds it to chats, councils (members, reviewers, chair), missions (steps, QA, assembler), pipelines, schedules and comparisons; HQ importer sorts a client brief into voice / offers / never-say / winners / facts and keeps your edits; keep a thumbs-up result as a past winner; tests
- Tests:
  - New: test/ratings.test.js (4), test/memory.test.js (6). Temp data dir, temp HQ folder with a made-up bakery brief, demo AIs only, no real key or URL.
  - npm test: 228 tests, 226 pass, 0 fail, 2 skipped. npm run smoke: all checks pass.
  - Both runs were on the final tree. The first commit was staged without the memory changes in the three shared files (server/index.js, web/app.js, web/features/ratings.js). The sandbox would not let me export that snapshot to run the suite on it alone, so I only checked by reading the staged diff that it does not reference any memory code.
- Not verified:
  - The skills matrix lines, the import toast and the "Keep as a past winner" button were not opened in a real browser. Only source checks and the API behind them are tested.
  - The importer has not been run against the real company/clients files (this session had no read access to them). Its heading rules were tested on a made-up brief only.
  - Real models following the memory. Only the demo AI's acknowledgement was checked.
  - A queued off-peak mission picking up memory when its window opens. It goes through the same runMission path that the tests cover, but no test actually waits for a window.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 3 DONE

## 2026-10-19 14:05 PT: Phase 4 (Client-facing)
- Started after PHASE 3 DONE. No conflict with docs/DECISIONS.md.
- Already in the code before this session, and kept: the share plugin (expiring read-only token page, mirroring one run's tasks, council answers, deliverable and live feed, "show costs" toggle) and the reports plugin (weekly report with spend by AI this week vs last, low credits, renewals, caps, keep / downgrade / cancel suggestions, Reports tab). Neither had tests. This phase added only what was missing.
- Live-share links (R8):
  - Brand kit applied: the public view now carries the owner's name, tagline, colours and logo (read in the owner's context), and the share page uses them for its accents and header. Without a kit it shows the Command AI header as before.
  - Links survived only in memory, so every link died on a restart. In local mode the stored copy now brings a link back; an expired one answers 410.
  - Feed lines are free text: dollar amounts are now hidden unless costs are shown, and anything shaped like an API key or bearer token is always hidden.
  - Under the deliverable, the links made for this run are listed with their expiry and a Revoke button. The list is owner only and drops links that expired more than a day ago.
  - The share page sends no Referer (so the token does not leak to the font host) and asks search engines not to index it.
- Weekly report (R6):
  - Gap fixed: with "Email me the report" on and a Resend key in the vault, the report emailed itself every Monday. The phase says nothing is sent automatically, so the plugin no longer sends anything. The Reports tab has Email draft (opens your own mail app with the report filled in; long reports point to the export), Export .md and Copy. The address is kept only to fill in the draft.
  - The Monday report was only made if the app happened to be running on a Monday after 07:00. It is now made the next time the app runs after Monday 07:00 (checked a minute after start and every 10 minutes), once per week. Run now counts for the week.
  - "What shipped" listed only a count. It now lists the finished runs of the week by title (up to 15, demo runs tagged).
  - The title used an en dash; it now says "to".
- Commits:
  - 14f54df Phase 4: live-share links (R8): brand kit on the share page, links survive a restart, costs and key-shaped text scrubbed from the feed unless costs are shown, list and revoke under the deliverable, no-referrer page, tests
  - 29e1afb Phase 4: weekly report (R6): never emails on its own (email draft opens your mail app, export .md, copy), Monday 07:00 report caught up when the app was closed, what shipped lists the finished runs, cancel suggestions, tests
- Tests:
  - New: test/share.test.js (4), test/reports.test.js (4). Temp data dirs, demo AIs only, no real key or URL. The share test restarts the server on the same data folder and seeds an expired link.
  - npm test: 236 tests, 234 pass, 0 fail, 2 skipped. npm run smoke: all checks pass. Both runs were on the final tree, before the two commits.
- Not verified:
  - The share page, the brand header on it, the Revoke list and the Reports tab buttons were not opened in a real browser. Source checks and the API behind them are tested.
  - Email draft in the desktop app: the button navigates to a mailto: link, which electron/main.cjs hands to the system mail app through its will-navigate handler. Not tried on a real install.
  - The Monday catch-up timer itself: the due rule is tested as a pure function, but no test waits for the timer to fire.
  - Share links in hosted mode after a hub restart: only local mode restores them from the stored copy.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 4 DONE

## 2026-10-19 21:17 PT: Phase 5 (Hands-free and mobile)
- Started after PHASE 4 DONE. No conflict with docs/DECISIONS.md: the shell service worker, the Refresh-only update and the desktop app's "no service worker" rule (decision 7) are unchanged, and tap / hold to talk (FIX voice-toggle) is kept as it was.
- Already in the code before this session, and kept: the mic button with tap to talk and hold to talk (push-to-talk), stop on silence, the Recording timer, the desktop mic grant; the manifest, icons, Install app button and offline shell worker; VAPID keys, encrypted Web Push and the push worker for spend-cap, red-light and renewal alerts. This phase added only what was missing.
- Voice commands (R9):
  - Gap fixed: the auto-send checkbox was never saved, so it was off again after every redraw or restart, and Settings had no switch for it.
  - Auto-send is now part of the voice settings (`settings.voice.autoSend`, off by default) and is kept when the mode or stop on silence changes. Command has the checkbox, Settings > Voice orders has the switch, and both save.
  - It sends only when words were heard and the mic was not blocked or cut off. Off: the words wait in the box for a click on Send orders.
- PWA and push notifications:
  - Job done: new opt-in "Also push when a chat, council or mission finishes" (off by default). One push per run, only for runs the app saw start (a late result or a restored run does not push), push only (no email; the feed already logs every finish). A failed run says so.
  - "Turn off push here" drops the browser subscription and removes the device from the list (new POST /api/alerts/unsubscribe).
  - Subscriptions are refused unless the endpoint is https (plain http only on this computer, for a local test service), has no user:password, and carries both device keys. Pushes do not follow redirects.
  - The desktop app removes every service worker at start (decision 7), so "Enable push here" there now explains that push belongs on the phone or browser instead of registering a worker it would delete. Settings says push is opt-in and that iPhone needs Add to Home Screen first.
  - A notification click opens or focuses the app's own page only, never a URL from the message. Each finished run has its own notification tag.
- Commits:
  - dee4538 Phase 5: voice commands (R9): auto-send is saved with the voice settings (Command checkbox and Settings switch), fires only when words were heard and the mic was not blocked, tests
  - 469b3cf Phase 5: PWA and web push: opt-in job-done push (chats, councils, missions; off by default, one per run), Turn off push here, push subscriptions limited to https push services, desktop app points push to the phone, a click opens only the app, tests with a local mock push service that decrypts and checks VAPID
- Tests:
  - New: test/push.test.js (2): a local mock push service on a random port; each message is decrypted the way a browser would (RFC 8291), the VAPID signature and audience are checked (RFC 8292), another device cannot read it, job done is silent while off and sends exactly one push when on, push off sends nothing, a 410 removes the device, unsubscribe, bad endpoints refused, no device secret or private key in the state or log; manifest, icons, served worker files and the decision 7 rules. test/voice.test.js: auto-send rules and the saved setting (1 new test, 2 extended).
  - npm test: 239 tests, 237 pass, 0 fail, 2 skipped. npm run smoke: all checks pass. Both runs were on the tree of each commit. Node 24.21.0. Temp data dirs, demo AIs only, no real key or URL.
- Not verified:
  - Real push delivery through Chrome, Edge, Firefox or Safari push services and a real phone: only the local mock service received messages. The browser side (subscribe, unsubscribe, notification click) was not run in a real browser.
  - Speech recognition and auto-send with a real microphone: the rules and the saved setting are tested, the button only by source checks.
  - Installing the PWA from a phone over the network: the app serves on this computer, and a phone needs the hosted hub or a tunnel to reach it.
  - Job-done pushes in hosted mode across several users: only local mode was tested.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 5 DONE

## 2026-10-19 14:45 PT: Phase 6 (Work with files and media)
- Started after PHASE 5 DONE. No Phase 6 commits existed yet. No conflict with docs/DECISIONS.md: the live view (decision 19) only gained two status words, and the knowledge libraries (Phase 18) are reused, not changed.
- Already in the code before this session, and kept: the Media tab with Kling, ElevenLabs, Runway and fal.ai adapters, an estimate button and dry runs without a key; knowledge libraries (Phase 18) with chunking, embedding, hybrid search and [L1] citations. Neither covered this phase, so this phase added only what was missing.
- Media actions (R2):
  - Gap fixed: missions had no media step. The planner can now mark a step `media` with a kind (video, image or voice) and a prompt. It goes to the best media provider for that kind (one with a key and under its cap first). A voice step speaks the text of the step before it.
  - Estimate first: the plan's feed line shows each media step's cost. A paid step waits as "waiting for your OK"; Approve (Media tab, or "Media from this mission" under the deliverable) must repeat the estimate, and No thanks spends nothing. When the file is made it lands on the task and in the mission's deliverable, and its cost is added to the mission. Generate on the Media tab now also has to send the estimate it showed (it was never checked before), and editing the form turns Generate off until a new estimate.
  - Spend caps were not checked for media at all. A provider at its cap, or a job that would push it over, is now refused before any call.
  - Ledger: one line per paid job (kind credits, the approved estimate, the project), no prompt text. Dry runs write no line, since nothing is spent.
  - Outputs are saved to the project's media folder as before. A dry run (no key, and demo mode) now also saves a placeholder (an SVG frame for video and image, one second of silence for voice) so the whole flow can be seen.
  - Files are served with the session token only (nosniff, sandboxed). "Show in folder" now takes a job and file number instead of a path typed by the page, and runs without a shell. Before, it ran a shell command built from that path.
  - The Kling estimate used the v3 price for a job that runs the cheaper turbo model by default. It now prices the model that will run.
  - The job engine moved from the plugin into server/media-jobs.js so missions can use it.
- Chat with files:
  - "Files in this project" in Command: drop or pick PDFs, Word files, text, code or images. The box shows what will be read, what is skipped and why, and the cost. Add to project must repeat that estimate.
  - Each project gets its own library ("Project files: <name>"), created on the first drop and attached to that project's chats. The passages are stored per project in that library's index, and single chats, councils and missions in the project cite them as [L1], [L2]. Other projects do not see them. Removing a file removes its passages, and for an image the file too.
  - Images are saved to the project's files folder and described once by the cheapest AI with a key that can see images (OpenAI, Anthropic or Gemini; the demo AI in demo mode). The description is what is indexed, so any model can answer about the picture later. The description call is in the ledger (role describe-image). For this, a chat message can now carry an image, sent in each API's own format (OpenAI-compatible and Anthropic).
  - Without an embedding key and with demo mode off, the box says which key is needed and reads nothing. Desktop only for now (hosted answers 501, like libraries).
- Commits:
  - 24f9bbe Phase 6: media actions (R2): mission media steps (video, image, voice) with the estimate first, a paid step waits for Approve and its file lands on the mission, Generate needs the current estimate, spend caps checked before any call, one ledger line per paid job, outputs saved to the project, demo and no-key dry runs save a placeholder, Kling estimate priced as the model that runs, tests with a local mock Kling
  - b3bc67c Phase 6: chat with files: drop PDFs, Word, text or images into a project (Files in this project, in Command), read and estimate first, Add repeats the estimate; each project gets its own library attached to its chats, councils and missions, cited as [L1], [L2]; images saved to the project and described once by an AI that can see them (image parts for OpenAI-compatible and Anthropic APIs, the demo AI in demo mode); remove a file and its passages; README lines for media and files; tests
- Tests:
  - New: test/media.test.js (2): a demo mission's media step is a dry run with a placeholder in the project folder and no ledger line; with a local mock Kling on a random port and a made-up key: Generate without, or with an older, estimate is refused, the spend cap refuses, Kling is never called before the click, the JWT is checked against the secret, the job is polled and the file saved to the project, one ledger line; a mission's paid step waits, Approve makes it and updates the mission, No thanks spends nothing. test/projectfiles.test.js (2): image parts in OpenAI and Anthropic shapes; drop a text file, a text PDF and a PNG, estimate then Add, the project's library is attached to its chats only, the demo AI receives the picture, a chat in the project cites the right file, a chat in another project sees nothing, the ledger has no file text, remove, and the no-embedder message.
  - npm test: 243 tests, 241 pass, 0 fail, 2 skipped. npm run smoke: all checks pass. Run on the final tree before the second commit; the first commit was also run on its own tree (241 tests, 239 pass, 0 fail, 2 skipped; smoke pass). Node 24.21.0. Temp data dirs, demo AIs only, no real key or URL.
- Not verified:
  - Real Kling, fal.ai, Runway or ElevenLabs jobs: only the mock Kling was called. The fal, Runway and ElevenLabs adapters were not changed, and their real responses were not tried.
  - Real image descriptions by OpenAI, Anthropic or Gemini: only the demo AI got an image. The Anthropic image format is checked by a unit test, not against the real API.
  - Which real model describes images is the cheapest available one from those three providers. A model from them that cannot read images would fail the description; that image is then reported as not added.
  - The drop box, the Approve buttons, file thumbnails and "Media from this mission" were not opened in a real browser. The routes behind them are tested; the page code only by reading it.
  - A real planner choosing a media step: the demo planner adds one when the goal says "make a video" (or image, voice-over) and the real planner gets the instruction, but no real model was asked.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 6 DONE

## 2026-10-19 15:00 PT: chain paused for release v0.4.1, then resumed (Grok Bot)
- CC-Build-Chain disabled at 14:10. Phase 5 had already started (14:05) and Phase 6 started straight after it, so the chain script was stopped while Phase 6's claude kept running; it finished at 14:42 and its commits were pushed by hand (d961479..2390f60). No claude run was interrupted.
- PR #7 (connect with API key or MCP) was NOT merged: it conflicts with Phase 6's media rework (server/plugins/media.js, web/features/media.js; the job engine moved to server/media-jobs.js). It needs a rebase onto main.
- server/cloud-defaults.json now ships the publishable licence key (never the service key), so fresh installs can check licences.
- npm test 243 tests, 241 pass, 0 fail, 2 skipped (one earlier run had 1 flaky failure that did not repeat); npm run smoke all pass.
- Released v0.4.1 (Phases 2-6 + licence key) on command-center-releases with installer, blockmap and latest.yml.
- Chain re-enabled and started; it resumes at Phase 7 (Phases up to 6 are DONE in this log).

## 2026-10-19 22:10 PT: Phase 7 (Integrations: OAuth, post only on click)
- Started after PHASE 6 DONE and the v0.4.1 release note. No Phase 7 commits existed yet. No conflict with docs/DECISIONS.md.
- Already in the code before this session, and kept: the publish plugin (Post to Instagram, Schedule in GHL, a Drive-synced folder) with preview, confirm, one preview per post, dry run without credentials, history and a ledger note per post. It had no Slack, no OAuth and no Drive API, and its adapters called fixed real addresses, so it could not be tested against a mock. This phase added only that.
- OAuth connectors (server/publish/oauth.js), Settings > Publishing:
  - Google Drive, Instagram (Meta), HighLevel and Slack. The person pastes their own app's client ID and secret and clicks Connect; the page comes back with ?code=&state=pub-<connector>-... and the server swaps the code.
  - Least scopes: Drive `drive.file` only (the app sees only files it made), Meta instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, HighLevel socialplanner/post.write and socialplanner/account.readonly, Slack chat:write and channels:read. Google uses PKCE (S256). A grant wider than asked for is refused and nothing is kept. A state is single use, expires after 10 minutes and, in hosted mode, belongs to one user.
  - Instagram: the user token is swapped for a long-lived one, then the Page token of the first Page with a linked Instagram professional account is kept, with the IG user id. HighLevel keeps the location id from the token answer. Google and HighLevel tokens are refreshed before a post when they are about to expire; a refused refresh shows "sign in again".
  - Tokens go to the vault under the same ids a pasted token uses (meta, ghl, plus slack and drive-publish); client secrets have their own vault entries. Neither is ever sent back to the page. The Google client of the browser helper is reused when no own client is set. Disconnect removes the token. Pasting a token still works (Slack bot token added).
  - Connecting posts nothing.
- Channels:
  - Send to Slack (new, server/publish/slack.js): pick a channel from the workspace's public channels, the message is the title plus the text (and an https media link if any), and the permalink is kept.
  - Save to Drive: uploads the deliverable as Markdown, plus the attached media job's files (resumable upload, only to Google's own upload address), into one "Command AI" folder the app makes once and reuses. Without a Drive connection it writes to the Drive-synced folder as before.
  - Under each deliverable: Post to Instagram, Schedule in HighLevel, Send to Slack, Save to Drive. Each still needs a preview and then the confirm click, and posts exactly what was previewed.
  - The Meta, HighLevel, Slack and Drive API addresses can be pointed at a local mock with env vars (CC_META_GRAPH_URL, CC_GHL_API_URL, CC_SLACK_API_URL, CC_DRIVE_API_URL, CC_DRIVE_UPLOAD_URL and the matching *_AUTH_URL). Requests no longer follow redirects and have timeouts.
- Commits:
  - f6a9741 Phase 7: integrations (R3): connect Google Drive, Instagram (Meta), HighLevel and Slack with the person's own OAuth app (least scopes, PKCE for Google, a wider grant or stale state saves nothing, tokens and client secrets in the vault, expiring tokens refreshed, Disconnect); Send to Slack channel; Save to Drive uploads to a "Command AI" folder through the Drive API (drive.file) when connected, else the Drive-synced folder; Post to Instagram, Schedule in HighLevel, Send to Slack and Save to Drive each need a preview and a click; API addresses overridable for tests; tests with one local mock of all four services
- Tests:
  - New: test/integrations.test.js (4), one local mock on a random port plays Google, Meta, HighLevel and Slack: client ID required first; sign-in links ask only for the listed scopes with PKCE for Google; a forged or reused state and a wider Google grant save nothing; all four connect and nothing is posted by connecting; no token or client secret in any reply to the page; a preview calls no service; each channel posts only after confirm and with the previewed text; the HighLevel token is refreshed first; Drive uploads into one reused folder and only the media job's own file; history and ledger lines; Disconnect makes Slack a dry run that sends nothing; no token or client secret in any data file or the server log. test/publish.test.js: the Drive ledger label is now "Google Drive".
  - npm test: 247 tests, 245 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips). npm run smoke: all checks pass. Run on the committed tree. Node 24.21.0. Temp data dirs, mocks only, no real key or URL.
- Not verified:
  - No real Google, Meta, HighLevel or Slack sign-in or API call was made. Request and answer shapes follow the published docs and were only run against the mock. A first real connection will confirm them, in particular: Meta's Page and Instagram lookup, HighLevel's token answer (locationId, user_type=Location) and its scope names, and Drive's resumable upload.
  - Redirect addresses: the app uses its own address (http://127.0.0.1:<port>/) as the redirect. Google allows this for a Desktop client. Meta and Slack may require an https redirect, and HighLevel requires the address to be registered in the Marketplace app; whether they accept http://127.0.0.1 is unconfirmed. If not, connecting those needs the hosted hub or a tunnel (not built, not deployed), and pasting a token still works.
  - The Settings rows, the Slack channel picker and the return from sign-in were syntax-checked and their routes tested, not clicked through in a browser or the desktop app.
  - Meta's long-lived Page token and Slack bot tokens do not expire on a timer, so they are not refreshed; if one is revoked the post fails with a clear message.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 7 DONE

## 2026-10-19: Marketplace phase built by Cursor cloud agent in PR (pending merge)

Marketplace phase built by Cursor cloud agent in PR (pending merge). Phase 10: local and demo catalog, signed pipeline export and import, share link, install on click, moderation queue, placeholder revenue share. Paid checkout is stubbed off (`CC_MARKET_PAID`). Nothing is charged. No payment service.

## 2026-10-19 15:30 PT: chain paused to merge PR #8 (marketplace), then resumed (Grok Bot)
- CC-Build-Chain disabled during Phase 7; the chain script was stopped after Phase 7's result and push, before Phase 8 started.
- PR #8 merged into main (conflicts in docs/BUILD-LOG.md and web/features/index.js resolved keeping both sides). npm test 252 tests, 250 pass, 0 fail, 2 skipped; npm run smoke all pass.
- Chain re-enabled and started; it resumes at Phase 8 and skips Phase 10.

PHASE 10 DONE (built by Cursor cloud agent, PR #8)

## 2026-10-19 22:30 PT: Phase 9 (Growth: feature-flagged, placeholder pricing)
- Started after PHASE 8 DONE (Grok Bot) and PHASE 10 DONE (PR #8). No Phase 9 commits existed and no trial, managed-plan or referral code was in the tree. No conflict with docs/DECISIONS.md: decision 11 (demo AIs leave on the first real key) now ignores managed pool keys, so it still needs the person's own key; nothing locked was changed.
- All three parts are OFF unless the host sets a flag (CC_TRIAL=1, CC_MANAGED=1, CC_REFERRALS=1). With every flag off the routes answer 404 flag_off, the panel shows nothing, and tiers, keys and routing work exactly as before. Every amount is a PLACEHOLDER in one object (server/growth.js PLACEHOLDER): trial 14 days and $5 credits, referral $5 for the friend and $5 for the referrer, managed usage at cost + 10%, managed limit $25 per person per month. No charge, no Square, no payment service, nothing sent.
- Free trial with credits (CC_TRIAL):
  - "Start free trial" (Settings > Plan, trial and credits) once per install, only on the Free tier. It gives the Pro limits (missions, scheduler, unlimited councils and projects) through a hook in licenseState (reason "trial", never owner) plus $5 of credits in the credit ledger.
  - Counter: a "Free trial: N days left" chip in Command and the licence message "Free trial: Pro for N more days. Nothing is charged."
  - Gating: when the days run out the copy is back on Free and every existing 402 gate applies again; a second trial is refused (409).
  - Upgrade prompt: 3 days before the end, after the end, and when credits run out with the managed plan on. "Upgrade to Pro" only opens the licence key field in Settings.
- "No keys needed" managed plan (CC_MANAGED):
  - The key pool exists only in the host's environment: CC_MANAGED_POOL lists providers and an env var name each (CC_POOL_OPENAI=key1,key2). Only built-in text providers count. A pool key is never in a file, the vault, git, a reply to the page (shown as "managed by Everborn"), a log line or a health check.
  - A new last step in vault.getSecret: workspace key, then your own key, then the environment, then the pool. The pool is used only when the person turned the plan on, has no key of their own for that provider, is under the monthly limit, and has credits or a paid licence (not a trial).
  - Metering only: every ledger line made with the pool is tagged managed. The plugin meters calls, tokens and cost per person per month, takes the cost from the credits first (one credit line per day), and counts the rest as "would be billed" at the placeholder markup. A call that finishes after the credits run out is still metered.
  - The key-save restore (Settings key setup) never copies a pool key into the vault.
- Referral rewards (CC_REFERRALS):
  - Each install gets a code (REF-XXXXXXXX) and a link (https://everbornproductions.com/command-center/?ref=CODE). Copy link sends nothing.
  - Use a friend's code: own code, a malformed code and a second code are refused. The licence server confirms it (rpc redeem_referral) before the welcome credit is added. Without a licence server, or if it cannot be reached, the code stays pending and nothing is added.
  - "Check now" asks the licence server (rpc referral_stats) how many friends were confirmed. One reward credit is added per confirmed friend, never twice.
  - Credit ledger: every trial, referral and managed-usage line with the balance, in the same panel.
- Commits:
  - 5c3a765 Phase 9: growth, feature-flagged with placeholder amounts, nothing charged: free trial, "No keys needed" managed plan, referral rewards; Settings panel and Command counter; tests with a local mock API and licence stub
  - One commit, not one per feature: the three parts share one module (server/growth.js), one credit ledger and one panel, so they could not be committed apart without untested in-between states.
- Tests:
  - New: test/growth.test.js (7). Flags off: routes refused, the pool is not used even when it is configured, tier unchanged. Trial: start once, Pro limits, counter and message, missions open, no second trial, an ended trial is back on Free with 402 and the prompt, the "ends in 2 days" prompt, no trial over a paid licence (licence stub). Managed: a local mock OpenAI-compatible API and a made-up pool key; not used before opt-in or with no allowance; after the trial, calls carry the pool key, the provider shows "managed by Everborn", the health check does not call the API, ledger lines are tagged, usage is metered and paid from credits; a large job drains the credits to 0, the overflow is metered, the pool stops and the next chat does not call it; your own key then comes first and is not metered; the pool key is in no reply, data file or server log; no pool means the plan cannot be turned on. Referrals: code and link, own, malformed and rejected codes add nothing, a confirmed code adds the welcome credit with the expected rpc body, a second code is refused, rewards are added once; without a licence server the code stays pending. Page code: registered, hidden with every flag off, no payment link, no em-dashes.
  - npm test: 259 tests, 257 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips). npm run smoke: all checks pass. Run on the committed tree, apart from the one README line added just before the commit. Node 24.21.0. Temp data dirs, mocks only, no real key or URL.
- Not verified:
  - The live licence server has no redeem_referral or referral_stats function yet. They were only run against the test stub, and no Supabase migration was written or run. Until Chris adds them, codes stay pending and no referral credit is ever added.
  - Trial and credit state lives in the user's own data (data folder locally, the user's documents on the hub). Someone who edits or deletes that folder can reset their trial. Real enforcement needs the licence server to record trials per device and email. Not built.
  - The managed plan suits the hosted hub, where the pool lives in the host's secret store. A desktop install would need an Everborn gateway in front of the pool so no key reaches a PC. Not built, not deployed.
  - One pool key per person (picked by a hash of the user id). A rate-limited pool key is handled by the existing smart fallback, not by switching to another pool key. One call can take the credits slightly below what it actually cost; the overflow is metered as "would be billed".
  - The panel, the Command chip and the upgrade button were syntax-checked and their routes tested, not clicked through in a browser or the desktop app.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes).

PHASE 9 DONE

## 2026-10-19 15:45 PT: Phase 11 (Hardening and polish)
- Started after PHASE 10 DONE and PHASE 9 DONE. No Phase 11 commits existed. No conflict with docs/DECISIONS.md: HTML stays no-store (decision 7), the reduced-motion rule covers only the shell's own animations so the live flow map keeps its approved fallback (decision 19), the updater, ports and instance-id rules (decisions 4 and 6) are unchanged, and the user guide describes them as locked.
- Full regression pass: the suite was run 5 times in full. Run 2 (before any fix) had 5 failures, all `ECONNRESET` / `socket hang up` in tests that start a server (MCP demo, media, project memory, pipelines, push).
  - Cause: test/helpers.js picked a free port, closed it, then started the server. With test files running side by side, another test's server or mock could take that port first. The child then crashed on EADDRINUSE (no handler), and the plain /api/health check got a 200 from the OTHER test's server, so the test ran against it until its owner shut it down.
  - Fix: each test child gets its own CC_INSTANCE and only a health answer echoing it counts (the same rule the desktop app uses, decision 6); a lost port race is detected from the log and retried on new ports (up to 4 tries). After the fix: 3 full runs with 0 failures.
  - One other failure was seen once, in a full run after the fix: test/fallback.test.js step 2 (a pinned chat to a provider already known to be out of credits ended "failed" instead of "done"). It passed 3 of 3 times run alone and in the next full run. Cause not found; the assertion now prints the run's error, the fallback chain and the server log tail so a repeat says why. Possibly timing under load; not fixed.
- Server hardening:
  - A taken main port is now "Command AI could not start: port N in use (EADDRINUSE)..." and exit code 1, not a stack trace (the ws server's copy of the error is handled too).
  - Demo mode: when its usual loopback port is taken, the demo server listens on any free port and the pretend providers are pointed there, instead of failing.
  - Static files: scripts, styles and images get a weak ETag (size and mtime) with `no-cache`, so the browser revalidates and gets 304 with no body while a file is unchanged; HTML (index, quick, share) gets no ETag and index/quick stay no-store. `content-length` is sent and a read error closes the response. The web/ check now requires the path separator, so a sibling folder starting with "web" can never be served.
  - The clock only touches the page when the minute changes.
- Accessibility (web/index.html, web/app.js, web/styles.css):
  - Skip to content link; main region focusable; both navs labelled "Main"; the open tab gets aria-current="page" (also for feature tabs and the phone More sheet).
  - Toasts in a polite live region, error toasts role="alert"; the connection pill is a status; the live feed is a log (not read out on every line); decorative icons aria-hidden.
  - Run mode, Priority and When are labelled groups with aria-pressed; the orders box and the project picker have labels.
  - Status-strip tiles, project cards and recent-run rows are role="button", focusable, and open with Enter or Space; each tile's label says the AI, its light in words, its line and what clicking does (colour is no longer the only signal).
  - Subscriptions inputs and the remove button are labelled per service; the hosted sign-in email field and message are labelled.
  - A visible :focus-visible ring on buttons, links and focusable rows; prefers-reduced-motion stops the shell's blink, pulse, ring and fade animations.
- Error states:
  - Every API call and download goes through one fetch wrapper: a network failure is "Could not reach Command AI's engine. Check that the app is still running, then try again." (or the hub's address), never "Failed to fetch"; an error answer without a message is "Request failed (HTTP N ...)" or "Not found (404)", never empty.
  - Click handlers that never caught their errors (deleting a project, adding links, saving a subscription, logging credits and others in app.js and the feature modules) now show the error: one unhandled-rejection handler shows it as an error toast, the same message at most once every 10 s, and logs it to the console.
  - A feature tab that throws while rendering says which tab could not open and offers Try again.
  - Copy under the deliverable says "Nothing to copy yet" or "Could not copy" instead of always "Copied". The hosted sign-in says the sign-in service cannot be reached instead of "Failed to fetch".
- Empty states: Projects (no projects yet, how to start), Subscriptions (nothing tracked, + Add or Setup), the live feed (quiet for now, what will show up). The others (deliverable, runs, HQ panels, skills matrix, recent calls) already had one.
- Docs: docs/USER-GUIDE.md (new: install, demo, keys, orders, projects, money, tabs, sending only on click, updates, troubleshooting table, keyboard and accessibility, privacy); docs/RELEASE-NOTES.md (new: the next release after v0.4.1 with Phases 7, 9, 10 and 11, then v0.4.1 and v0.4.0; no version number chosen, Chris cuts releases); README links both, the Updates section now describes the desktop updater from decision 4, a new Accessibility and error states section, and the stale "Not yet built" list (media, Electron, licensing, sync were all built) replaced with what really is not built.
- Commits:
  - 9866c0c Phase 11: hardening and polish (regression fixes, server hardening, accessibility, error and empty states, docs)
  - One commit, not one per feature as rule 2 asks: the three per-feature commits were attempted, the first two failed on PowerShell quoting of their messages after their files were staged, so the third commit took all 13 files. git reset needed an approval this run could not get, so the commit message was amended to describe everything in it. All files in it are Phase 11's own.
- Tests:
  - New: test/hardening.test.js (3: ETag and 304 for scripts and styles, no ETag and no-store for HTML, nothing outside web/; a taken port gives the message and exit 1 with no stack trace; a taken demo port still gives working demo AIs), test/a11y.test.js (1, static checks of the shell: landmarks, live regions, aria-current, aria-pressed, keyboard roles, error wording, empty states, focus ring, reduced motion scoped to the shell, no em-dashes), test/docs.test.js (1: guide and notes exist, linked from the README, describe the locked behaviour, no em-dashes). Changed: test/helpers.js (instance id and retry), test/fallback.test.js (diagnostic message only).
  - npm test: 264 tests, 262 pass, 0 fail, 2 skipped (the same real-browser and Pyodide skips). npm run smoke: all checks pass. Run on the committed tree. Node 24.21.0. Temp data dirs, mocks only, no real key or URL.
- Not verified:
  - Nothing was clicked through in a browser, the desktop app or a screen reader (the Electron window does not start in agent runs). The accessibility work was checked by reading the code and by static tests; tab order, the focus ring's look, screen-reader wording and colour contrast still need a person to try them. Colour contrast was not measured.
  - The feature tabs (web/features/*) were not audited one by one for labels and keyboard use; only the shell and the core tabs (Command, Projects, Credits, Subscriptions, Settings, sign-in) were changed. Their unhandled errors now surface through the shared handler.
  - The 304 path was tested against the local server only, not through the hosted hub or a service worker.
  - The fallback step-2 failure above is not explained yet.
- Left alone: `cc-names.tmp.mjs` (another session's file). Nothing pushed (Chris pushes). Nothing deployed, no Square, billing, real keys or data/ touched.

PHASE 11 DONE
## 2026-10-19: Pro prompts, grouped nav, and the Meldmind name (Cursor cloud agent)

- Phase 30: Pro prompts pack. Each template is ROLE / CONTEXT / COMMAND / FORMAT, filled from the Business Profile, and it halts when a required fact is missing. Safety marks unverified numbers [VERIFY], keeps outbound text as drafts, and strips SSNs, dates of birth, and account numbers. SCF mode adds CROA and RESPA. "Save this as a reusable prompt" stores a custom prompt and does not send it. Friday Coach, Monday Chief of Staff, Friday team check-in, and Daily sundown install as paused chat schedules. Desktop schedules only run while the app is open.
- Phase 31: intent auto-detect is a keyword heuristic plus one cheap router call when the heuristic is unsure. A chip can be removed. The learning router stores the template id and a count only.
- The top bar is grouped menus (Work, Create, Business, Connect, Settings). Every existing destination stays reachable. "Open live view" is at the bottom-right of the Live Ops panel. Live stays in the Work menu.
- User-facing product name is Meldmind. Tagline stays "an Everborn product". Where a subtitle fits, the line is "Take command of all your AIs." The name is provisional, pending attorney trademark review before public launch (Cisco MINDMELD risk). appId `com.everborn.command`, `app.setName("Everborn Command")`, and the updater feed (`command-center-releases`, `latest.yml`) are unchanged, so existing installs keep keys, settings, and history and still auto-update. Installer names are `Meldmind-Setup-<version>.exe` and the matching Mac and portable artifacts.
- Planned and not built: Phase 32 model-version alerts, Phase 33 bring your own apps, the Phase 26 relay extension (decision 16 unchanged), and Phase 34 hide hosted plumbing (decision 15 unchanged). Phase 34 would ship the hosted Supabase URL and publishable key built in, auto-fill the results callback from our hosted server once it exists, prefill Grok Bot and agent handoff fields where possible, and hide those fields unless "Use your own Supabase" (off by default) or an Advanced toggle is on.
- Tests after rebase onto main (through Phase 5): npm test 250 tests, 248 pass, 0 fail, 2 skipped. npm run smoke all checks passed. No real key. Temp data dir only. Smoke does not assert the product name. The served page title is Meldmind and the tagline is in the header HTML. Project memory stays on the server, and the weekly report still does not email itself.
- Not verified here: a packaged installer, a real auto-update against command-center-releases, Alt+Space (that hotkey is the desktop shell; the nav test ignores Alt), and a full click-through of every menu. Phase 14 stays BLOCKED (needs a Mac).

PHASE 30 DONE (built by Cursor cloud agent)
PHASE 31 DONE (built by Cursor cloud agent)

## 2026-10-19: Onboarding tour and What's new (Cursor cloud agent)

- The tour now walks the current app: Meldmind, the dropdown menus, Council, Pro prompts and auto-detect, Open live view at the bottom-right of Live Ops, API keys and MCP, pipelines, scheduled agents, and the publishing preview. The sample run on the demo AIs is unchanged.
- What's new reads `docs/WHATS-NEW.json` and shows once per `package.json` version. The seen version is stored in the data folder (`whatsnew.state.json`), so it survives the desktop cache clear. It waits until first-run setup is finished, then the tour invite. Settings menu: Take the tour again. Resetting the tour does not show the note again.
- Releasing and the build-plan rules now require a What's new entry for the new version and a tour update for any new user-facing feature. A test fails when the package version has no entry. The installer keeps `docs/WHATS-NEW.json`.
- A stylesheet string in the nav module was shadowing `CSS.escape`, so adding a menu item after startup threw and a render could fail. Menu items now call `globalThis.CSS.escape`.
- Rebased onto main at v0.4.1 (through Phase 6). `package.json` stays 0.4.1. The What's new entry for 0.4.1 covers the name, menus, Pro prompts, live view, project files, and paid media steps that wait for Approve. The tour has a Files in this project step. The Phase 6 error that said "Update Command AI" now says Meldmind.
- Tests after that rebase: npm test 257 tests, 255 pass, 0 fail, 2 skipped. npm run smoke all checks passed. No real key. Temp data dir only.
- Checked in a browser: first-run setup is not covered by What's new. After Skip, the note shows 8 bullets and the tour invite stays hidden until Got it. All 14 tour steps appear. After a reload the note and the invite stay gone. Settings, Take the tour again, opens the welcome step.
- Not verified: a packaged installer reading `docs/WHATS-NEW.json` from inside the app archive, and a real auto-update. Phase 14 stays BLOCKED (needs a Mac). Phase 34 stays planned, not built.
## 2026-10-19: API key or MCP (built by Cursor cloud agent)

- Services that offer both an API and an MCP server (Kling, ElevenLabs, Sync.so, fal.ai, Replicate) connect either way. Each Settings card, and the same step in guided key setup, has Connect with API key, Connect with MCP, which one is active, and Test connection. The person can switch any time. Both can stay saved.
- A job uses the active connection. If both are set up and the active one fails, the other runs it. Claude, ChatGPT, Grok and Gemini still need an API key, or an OpenRouter key, to take part in the council. An MCP server does not take their place there. This reuses the Phase 1 vault and guided key setup and the Phase 16 MCP client. Phase 13 is bookmarks. Onboarding still runs once: finishing setup, or already having history, keeps the first-run screen closed.
- Planned only, not built: a welcome email on sign-up or license redeem (decision 22), and an optional Use your own Supabase advanced setting (decision 23). Both are locked in docs/DECISIONS.md and listed in docs/BUILD-PLAN.md under "Planned, not in the run order". They are not in the run order, so the chain will not build them. They do not touch Square or billing.
- Rebased onto origin/main through Phase 6 and v0.4.1. Claude's media job engine in server/media-jobs.js was kept: estimate first, approve before a paid job, spend caps, one ledger line, placeholders for a dry run. The API-key-or-MCP choice now runs inside that engine. A service with an MCP server and no API key is a real job, not a dry run, and still waits for the estimate.
- Tests: npm test 246 tests, 245 pass, 0 fail, 1 skipped (Pyodide is not installed here). npm run smoke all checks pass. Run after the rebase onto Phase 6. test/connect.test.js uses a local Kling mock and a local Streamable HTTP MCP server. No real key, no real provider URL, temp data dir only. Node 22.23.3.
- Browser (before this rebase): first-run setup, Settings cards, and guided setup were checked on desktop and at 390px. Not re-checked after Phase 6's Media tab. Not verified: a packaged Electron build, a real provider, or a real MCP server.

FEATURE connect-key-or-mcp DONE (built by Cursor cloud agent)

## 2026-10-19 15:45 PT: chain paused to merge PRs #6 and #7 and release v0.4.2, then resumed (Grok Bot)
- The chain had finished Phase 11 at 15:41 and stopped on the existing PHASE 14 BLOCKED line (needs a real Mac). Every other phase (1-13, 15-29) is DONE. CC-Build-Chain task disabled at 15:45 while Grok Bot worked; no Claude phase was running.
- Merged PR #6 (Pro prompts, grouped nav, Meldmind rename, What's new and tour) as 678b8ec. Conflicts with Phases 7-11 resolved keeping both sides: top-bar active state from markNav plus aria-current from markTabs, readable HTTP errors plus error codes, the features list keeps marketplace, growth and prompts, publish settings from Phase 7 plus the tour anchor, Meldmind text with the Phase 11 accessibility attributes.
- Merged PR #7 (connect services with an API key or MCP) as 5cae163. Kept both plan sections and both DECISIONS test lists. Plan notes renumbered 24-28 so they no longer share numbers with locked decisions 21-23.
- PR #9 (docs: plan additions, relay terms review) left open: its description says not to merge until Chris reviews.
- Release v0.4.2 (ebcba79): version bump, What's new 0.4.2, tour steps for Marketplace and publishing connections. npm test 279 pass, 0 fail, 2 skipped (two earlier runs had one timeout each in search and brain waitRun; each test passed when run again, and the full suite passed); npm run smoke passed. Published on command-center-releases as "Meldmind v0.4.2" with Meldmind-Setup-0.4.2.exe (112678771 bytes), blockmap and latest.yml; latest.yml says 0.4.2 and the release is marked Latest.
- Licence publishable key: already shipped in server/cloud-defaults.json since v0.4.1 (4695f49); v0.4.2 carries it too. No secret or service key is in the repo.
- CC-Build-Chain task re-enabled. Not restarted: the only phase left is Phase 14 (Mac), which stays BLOCKED until a Mac or the macOS runner is available.

## 2026-10-19: Simple and Expert, Gemini AQ. keys, and Help (Cursor cloud agent)

- Simple is the default for a new install. The first screen asks "Keep it simple or show me everything?" The Simple / Expert switch is in the top bar on every screen. One click keeps chats, projects, and keys. Simple shows Chat, Projects, Create, Help, and Settings. Expert keeps the debate, scores, spend caps, live map, marketplace, MCP, webhooks, and every menu. The choice is not setup history.
- The chips under the chat box list only AIs with a saved key the provider accepted, or an MCP server. Demo fills that row only while no real AI is connected.
- Pasting a key recognizes Gemini auth keys (AQ.) and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq. Gemini chat, the models check, images, and embeddings use generativelanguage.googleapis.com with x-goog-api-key. If the prefix does not match, the paste box offers a provider picker. The key is never logged.
- Help is a tab in Simple and in Expert. Guides live in docs/help and ship with the app. Ask Meldmind answers from those articles with a connected AI. With no connected AI, or if that AI cannot be reached, the reply is a search of the same articles. Take the tour again and Check for updates are on the Help page.
- Releasing: docs/help/catalog.json lastUpdatedVersion must match package.json, and each What's new bullet for that version must match an article stamped with it. npm test fails otherwise. The installer keeps docs/help as well as docs/WHATS-NEW.json. Version is 0.4.3.
- Tests: npm test 294 tests, 293 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dir, local mocks, no real key.
- Browser: first-run question, skip setup, What's new, tour invite, Simple bar including Help, search for SmartScreen and AQ., Ask Meldmind with no key (search only), Check for updates, Take the tour again, text kept across Simple and Expert, Help inside the Expert Settings menu, and the same Help search at 390px. All of those worked. Not verified: a packaged installer, a real Gemini key, or a connected AI answering Help (covered by the local mock in test/help.test.js).

## 2026-10-20: Phase 26 extension, manual handoff (Cursor cloud agent)

- Decision 16 is unchanged. Smart fallback still skips a provider that is out of credits, rate limited, or refusing its key, retries the same model through OpenRouter when a key exists, and sends the work to the next model. This pass adds a manual handoff on top of that. It does not replace the ledger or the spend caps.
- The automated relay in decision 27 (copying a thread into a signed-in ChatGPT or Claude page through the extension or the browser helper, then reading the reply back) was not built. There is no DOM control, no hidden window, no browser extension, no cookie or session use, and no consumer OAuth. Antigravity and Gemini CLI tokens are never read. Sign in with ChatGPT was not built.
- Registry (`server/handoff.js`, routes in `server/plugins/handoff.js` at `/api/handoff`, stored with `store.js`): each target is a name, an http(s) address, and an optional note. ChatGPT, Claude, Gemini, Grok, and Google Antigravity ship with their own pages. Users add, edit, and remove targets in Settings. `javascript:`, `file:`, and `data:` are refused, and so is an address that carries a username, password, or key.
- Continue in <name> (`web/features/handoff.js`): the first click builds a compact prompt (a summary plus recent turns, with a size meter), copies it, and opens the page in the default browser (`shell.openExternal` on the desktop, `window.open` with `noopener` on the web). The page tells you to paste, send, then copy the reply.
- Grab reply reads the clipboard only on that click, shows a preview, and saves on confirm. The reply is tagged manual, for example "via ChatGPT web, manual". The ledger line is $0 with `usage.manual = true` and the target name.
- Continue in appears on its own when a provider has no key, no MCP, and no official sign-in, or when smart fallback has stood that provider aside. The only edit in `web/features/fallback.js` is the Gemini free-tier data-use notice under Free tiers.
- The notice says Google may use unpaid Gemini API and AI Studio prompts and replies to improve Google products, and that human reviewers may read them. It is labelled a manual handoff. No endorsement claim.
- Tests: `test/handoff.test.js`. npm test 292 tests, 291 pass, 0 fail, 1 skipped. npm run smoke all checks passed. Node 22.23.3, after rebase onto origin/main. Temp data dir, a local mock only when a key is saved, no real provider URL. Checked in headless Chrome: Continue in is on the marching-orders page with no keys, the first click copies and opens without reading the clipboard, Grab reply reads once and previews, confirm saves the tagged reply and the $0 line, Settings lists the targets and the Gemini notice, and a `javascript:` address is refused.
- Not verified: a packaged desktop build calling `shell.openExternal`, and a real provider page (the app must not open one on its own beyond the user's browser). Phase 14 stays BLOCKED (needs a Mac).

PHASE 26 EXTENSION DONE (manual handoff, built by Cursor cloud agent)

## 2026-10-20: hosted hub readiness (Cursor cloud agent)

Code and config only. Nothing was deployed, bought, or signed up for. appId `com.everborn.command`, the updater feed (`everbornproductions-stack/command-center-releases`, `latest.yml`), the installer names (`Meldmind-Setup-${version}.${ext}`), and `CC_OWNER_EMAILS` (`everbornproductions@gmail.com`) are unchanged.

- Hub address is `hub.meldmind.ai`. The Cloudflare Worker name is `meldmind-hub`. `CC_HUB_URL` is `https://hub.meldmind.ai` in `wrangler.jsonc` and `fly.toml`. The Fly app name stays `everborn-command`. Supabase Site URL and redirect URLs in docs/hosted-hub.md are `https://hub.meldmind.ai` and `https://hub.meldmind.ai/**` (plus localhost:3000 for local hosted testing). Downloads stay at downloads.everbornproductions.com.
- Hosted mode drops a user's in-memory context after `CC_IDLE_EVICT_MIN` minutes idle (default 30). It flushes waiting writes first, and it does not drop a user who has a running mission, council, chat or media job, an open WebSocket, a queued off-peak mission, or a write that has not finished. The next request loads them again from Supabase. Local mode is unchanged.
- Publishing OAuth redirects on the hub are built from `CC_HUB_URL` and must be https (`https://hub.meldmind.ai/`). A non-https hub address is refused. Desktop stays `http://127.0.0.1:<port>/`. Settings text shows that exact redirect URL for Meta, Slack, HighLevel and Google.
- A Cloudflare cron (`*/5 * * * *`) calls `scheduled()` in `worker/index.js`, which wakes the container and POSTs `/api/internal/schedules/tick` with the header `x-cc-tick-secret`. The value is `CC_TICK_SECRET`, a wrangler secret, never written into `wrangler.jsonc` or git. Each tick runs `schedules.tick()` for every user with a due cron schedule. A slot is claimed before the run, so it does not run twice. Caps and the Approve click are unchanged. A watched folder stays on the desktop. Desktop still ticks only while the app is open. Because the cron is more often than the 15-minute container sleep, the hub stays warm (the always-on cost in docs/hosted-hub.md, about $1.75 extra).
- Rebased onto origin/main at 4c27e28 (manual handoff) before the pull request. The four commits on this branch, oldest first: Move the hosted hub to hub.meldmind.ai; Evict idle hosted users from memory; Use https OAuth redirects on the hosted hub; Run hosted schedules from a Cloudflare cron (this log entry is in that commit).
- Tests after that rebase: npm test 306 tests, 305 pass, 0 fail, 1 skipped. npm run smoke: all smoke checks passed. Node 22.23.3. Mocks only (local HTTP stubs, no real Supabase, no real provider). New tests: test/hub-domain.test.js, test/idle.test.js (fake clock), test/oauth-redirect.test.js, test/schedule-tick.test.js (401 on a bad secret, each due slot once for two users, no secrets in wrangler.jsonc).
- Not verified: no deploy, no real Supabase project, no real Meta, Slack, HighLevel or Google sign-in, and the container wake time was not measured. Phase 14 stays BLOCKED (needs a Mac).

## 2026-10-20: Phone pairing on this PC's Wi-Fi address (Cursor cloud agent)

- Phone pairing stays off until it is turned on in Settings, under Phone and other devices. The desktop engine keeps listening on 127.0.0.1. Turning it on adds a second listener on this PC's private IPv4 (a 192.168 address, then 10, then 172.16-31) at the same port. The QR code and the address under it use that Wi-Fi address and a pairing code. Copy sits under the address. Turning it off closes that listener and drops a phone that was already connected. Saving settings cannot open the port. The pairing code is not written to the log.
- A phone that does not present the code gets a plain refusal and not the app. With the code, the phone loads Meldmind. If that phone later cannot reach the PC, the page says so. The Windows installer, and the first time pairing is turned on in a packaged app, add an inbound firewall rule for Meldmind.exe on private networks only.
- Help article docs/help/phone.md, a What's new bullet, a tour step, and a short note in the user guide.
- Tests after rebase onto origin/main (through the manual handoff): npm test 308 tests, 307 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dir, no real key.
- Browser: with pairing off there is no localhost QR. Turning it on shows the QR, the Wi-Fi address under it, and Copy (toast: Link copied). That address opens the app. An incognito window without the code sees the invalid-link sentence. Turning pairing off hides the address, the open phone tab says the phone cannot reach the PC, and a reload is connection refused. The panel stays readable at 390px. Not verified: a packaged Windows installer actually adding the firewall rule, or a physical phone (this machine is not Windows).

## 2026-10-20: Publishable licence key injected at release build (Cursor cloud agent)

- `server/cloud-defaults.json` keeps the Supabase project URL and an empty `anonKey` in git. `npm run dist` and `npm run dist:mac` read `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`, write that publishable key into the file for the installer, then clear it. A service key is refused. If neither variable is set, the release build stops and names both variables, because an empty key leaves every copy on the Free tier and EVERBORN-OWNER cannot redeem. Dev runs and `npm test` do not require it.
- The value was not available in this environment, so it is not filled in. Add one of those names as a repo secret, or set it in the shell, before the next release build.
- Tests after rebase onto origin/main (hosted hub readiness): npm test 329 tests, 328 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. The missing-key check prints no key value.

## 2026-10-20 01:40 UTC: Money saved tracker (Cursor cloud agent)

Extension of the Phase 2 savings receipt. Phase 2 stays DONE. This does not change a locked decision. The manual handoff from the Phase 26 extension is unchanged: a ledger row with `usage.manual = true` stays a $0 line and keeps its target name.

- Each call stores its savings on the ledger line before the line is written (`server/receipt-math.js`, additive wrap in `server/ledger.js`): actual cost, baseline (the same tokens at the reference model, list price, no time-of-day discount), the difference, and the price-table date. A later price change does not move old totals. A row written before snapshots existed is frozen once, on first read.
- Reference model (`receipt.settings`): the default is the most expensive flagship the user has a key for. With no key, it is the most expensive flagship in the registry, so a receipt still has a baseline. Demo mode (no real keys) uses the demo flagship. The user can pick another model. New runs use the new reference. Earlier runs keep the baseline they stored.
- Totals: today, this month, and all time, plus per project and per provider. Manual rows are $0 and marked manual (they do not add savings). Free rows cost $0 and keep the reference-model baseline, so the free allowance counts as money saved.
- The top bar shows Money saved, mounted at runtime from `web/features/receipt.js` with its own stylesheet. `web/app.js`, `web/index.html`, `web/nav.js`, and `web/styles.css` are unchanged. The Credits tab has the breakdown, the reference picker, and a PNG of the summary. The per-run PNG stays. The label is always "Estimated, based on token counts and list prices."
- Rebased onto origin/main at c9c1d61 (Simple and Expert modes, phone pairing, publishable licence key) before the pull request. Version stays 0.4.2.
- Tests: `test/receipt.test.js` (fixed token counts, a changed reference model, a later price change leaving old totals, per-project and per-provider sums, manual and free rows, demo with no keys). After the rebase onto c9c1d61: npm test 330 tests, 329 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs only. No real key.
- Checked in the browser on the local app: the top bar shows the all-time total (a small demo amount uses four decimals, so it is not stuck at $0.00) and the estimate sentence, beside the Simple / Expert switch with no overlap. On a phone-width window the bottom nav stays, and the estimate sentence stays on its own row. Credits shows today, month, and all time, by provider, by project, and save summary as image, which downloads `money-saved.png`.
- Not verified: a packaged Electron build, a real provider price list, and a long-lived session after a live OpenRouter price refresh. Phase 14 stays BLOCKED (needs a Mac).

MONEY SAVED TRACKER DONE (built by Cursor cloud agent)

## 2026-10-20: Nine more Pro prompts (Cursor cloud agent)

- Added nine templates beside the existing pack: Coaching conversation (SBI), Delegation hand-off plan, Contrarian hooks (four outlines; the original 12-hook template stays), DM sequence to booked call, Weekly time audit, Pre-launch risk audit, Thought leadership article outline, Win back a lost lead, and Hand off 'only I can do it' tasks.
- Rows live in `server/prompts/pack-more.js` and join `server/prompts/catalog.js` with one import and one push, so the pack file stays a small edit. Each row is still ROLE / CONTEXT / COMMAND / FORMAT and halts when a required fact is missing.
- Sales and marketing templates carry the line "no fabricated results, testimonials or income claims." Time templates say "hourly value of my time" and do not use a named coach's terms. Outbound messages stay drafts.
- Test: `test/prompts-pack-more.test.js`.

PROMPTS PACK ADDITIONS DONE (built by Cursor cloud agent)

## 2026-10-20: Pro prompts categories (Cursor cloud agent)

- The Prompts tab groups every template into one shelf: Sales and Follow-up, Marketing and Content, Leadership and Team, Productivity and Delegation, Planning and Operations, Build and Spec, Creative, Custom/My prompts, and Marketplace. Spec it out, Build it right, and the agent team builder are under Build and Spec. Reel scripts are under Creative. Marketplace listings whose kind is prompt show under Marketplace, not mixed into the pack.
- Categories collapse. Open or closed is remembered in the browser. Search covers every category. Your own prompts can move between categories. Built-in templates stay put. Simple mode is the categories plus search. Expert mode adds sort and filter. The board lives in `web/features/prompt-board.js` and mounts from the Prompts tab.
- Test: `test/prompt-shelves.test.js`.

PROMPTS CATEGORIES DONE (built by Cursor cloud agent)

## 2026-10-19: Windows update prompt never appeared (Cursor cloud agent)

- Installed 0.4.0 and 0.4.1 never offered 0.4.1 or 0.4.2. The public feed was already right: v0.4.2 is the latest release, not a draft, and latest.yml points at Meldmind-Setup-0.4.2.exe. v0.4.1's installer is still named Command-AI-Setup-0.4.1.exe.
- The app only checked every 4 hours, and a failed check stored the error then threw it away: the launch window opens only when a version is found, the server bridge returned the current version with the error cleared, and the periodic timer swallowed rejections. The top bar had no update button, and Help had no Check for updates.
- Fix: public GitHub feed pinned at runtime (`private: false`, channel `latest`, no token). One retry reads the same public latest.yml URL if the GitHub provider errors. Differential download is off, because swapping the version inside Meldmind-Setup-0.4.2.exe looks for a Meldmind blockmap that 0.4.0 and 0.4.1 never published. Checks run on startup and every 30 minutes. Errors are logged (query strings and token-shaped text stripped). Top bar shows Update available, then Restart to update. Help has Check for updates. Nothing downloads before that click. The launch window (Install now / Later) and the tray items stay.
- Not a release. People already on 0.4.0 or 0.4.1 need this build installed once before the new check runs.

## 2026-10-20: Pause unpaid AIs, auth labels, Free/Paid, upgrade tips (Cursor cloud agent)

- A provider whose health is amber or red for out of credits, a spending limit, payment required, or a rate limit is left out of auto-picks while another model can take the job. The strip and the provider list show `Paused: no credits` once, with a billing link. A pinned chat that is already in that state stands in without calling it again, and is not opened as working. If nothing else can stand in, the run says `Claude is paused: no credits. Add credits to use it.` and includes the billing link. Health rechecks for a paused provider wait 15 minutes. Saving the key, or Check, runs immediately. Healthy providers stay on the 5 minute cadence. `server/health.js` is unchanged.
- Every registry provider has an auth type: key, mcp, handoff, or local. `No key` is only for a real API key. CapCut is MCP OAuth at `https://www.capcut.com/api/external_mcp` and shows Not connected plus Connect. A failed sign-in shows the US coming-soon note. Suno and Google Flow are Handoff. Cursor is Local app. Hedra is an API key with no live adapter (`api` stays null). Dual key-or-MCP providers stay key, and show Connected when only the MCP side is linked.
- Each provider can be Free, Paid, or Unknown. Google and Groq are guessed free until you set one. Simple mode prefers a free AI only when quality is within 8 points and the score is within 4 of the leader.
- After a finished run, at most one upgrade tip per provider per task type per 7 days. The local log is provider id, task type, and why. No prompt text and no keys.
- Tests: `test/access.test.js`. After rebase onto origin/main (Windows update checks): npm test 346 tests, 345 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3.
- Deferred: the mission runner still emits the first `agent.start` before a known pause (the strip and Live Ops hide a provider that is already paused). A council or mission deliverable does not yet repeat the pause sentence; single chat does. The Connect button and the paused chip were not clicked in a browser.

PAUSE UNPAID AND AUTH LABELS DONE (built by Cursor cloud agent)

## 2026-10-19 7:45 PM PT: Honest key errors and desktop tap to talk (Cursor cloud agent)

v0.4.3 hotfix, outside the phase chain. No locked decision was changed. Rebased onto origin/main at 556568d (pause unpaid AIs, auth labels, Free/Paid). Feature commit 0821d8a. Pause still reads the health light: amber or red for credits, a spending limit, payment required, or a rate limit stays out of auto-picks. Walkthrough, `web/features/prompts.js`, `web/graph.js`, and `web/features/liveview.js` were left alone.

- A real chat failure now keeps the provider's error body. `noteCall` classifies it with `explainProviderError` instead of turning every 401 or 403 into "Key rejected". A 402 or 403 whose body mentions credits, a spending limit, billing, quota, or balance is amber: "Out of credits or spending limit reached. Top up at <provider billing URL>" (xAI is https://console.x.ai). "Key rejected" is only a 401, a 400 with an invalid-key message, or a 403 with no words. Any other 403 says "Access denied (403)" plus the provider's detail. The key check writes that result once, so the light does not flash red before the body is read. A later success clears a stale network flag.
- The key-setup wizard keeps a key that is out of credits, needs payment, or is rate limited, and it names those cases. It still drops a refused key and a provider it could not reach. xAI's base URL stays https://api.x.ai/v1.
- Tap to talk in the desktop app (and when browser speech fails with a network error) records with MediaRecorder and POSTs the clip to `/api/voice/transcribe`. The server uses the first speech key already saved, in this order: OpenAI (`gpt-4o-mini-transcribe`, then `whisper-1` if that model is missing), Groq (`whisper-large-v3-turbo`), ElevenLabs Scribe (`scribe_v1`), Google Gemini (`gemini-3.8-flash`). If none of those four keys is saved, the reply is 409 and names which key to add. The orders box shows "Transcribing..." while that runs, then the text, and the existing auto-send still applies. "No speech heard" shows when a session ends empty. Audio-capture and language-not-supported stop the session with a toast. Chrome and Safari on the phone keep Web Speech. Nothing is sent until the person stops the recording.
- What's new for 0.4.3 and the Help articles `docs/help/troubleshooting.md` and `docs/help/api-keys.md` say the same two things.
- Tests after the rebase onto 556568d: npm test 351 tests, 350 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key was printed or stored. Pause, Free/Paid, and auth-label tests still pass with the honest credit wording.
- Not verified: a packaged Electron window, a real microphone, and a live OpenAI, Groq, ElevenLabs, or Gemini transcription. The health light and the transcribe route were exercised against local stubs.

HONEST KEY ERRORS AND DESKTOP TAP TO TALK DONE (built by Cursor cloud agent)

## 2026-10-20: Get everything connected (Cursor cloud agent)

- After the existing first-run AI setup (history, keys already on this PC, bookmarks), a fresh install shows Get everything connected. That checklist is the provider registry plus the integration plugins: Gmail, Google Drive, Google Calendar, HighLevel, CapCut, Kling, ElevenLabs, Suno, Google Flow, Cursor, and the other connectors. Council AI key detection is not repeated.
- Each row is Connected, Not connected, or Handoff. Connect reuses the guided key setup, MCP sign-in, Google and publishing OAuth, or the handoff open. Skip marks the row. Finish later closes it. Run setup again is in Settings, the Help menu, and the Help page. Simple hides the extra how-to line. Expert shows it. Keys stay on the existing vault routes and are not stored in the checklist.
- An install that already finished setup is not prompted. The Mac Help menu has the same Run setup again item. Windows keeps no menu bar.
- Command layout: the orders panel was sticky inside the scrolling page and had no overflow of its own, so the wheel moved Live Ops and the left panel could not scroll. On a wide window the orders panel, Live Ops, the deliverable, and the live feed each scroll. At 1250px and on the phone the columns stack and the page scrolls. The panel height follows the view, so a taller top bar does not push the bottom of the form off screen.
- Gmail and Outlook on Get everything connected list accounts from /api/mail-accounts. Add another posts a label there, then uses the existing Google or Outlook sign-in with that account id. No second account store.
- The AI keys step leads with a recommended OpenRouter card. One key reaches Claude, GPT, Gemini, Grok, DeepSeek, Llama and more, and free models are available. The link is openrouter.ai/keys. Add OpenRouter key opens the existing OpenRouter key step. Other keys stay optional below it.
- First-run setup asks the existing share choice first: I am willing to share anonymous track records. It uses the same shareOptIn setting, off until the person turns it on. The wording matches Who's best, Help, and the shared-learning note. It also says Meldmind learns from every job you run, and that an opt-in lets the anonymous scores (task type, cost, speed) help pick the best AI for everyone. Prompts, files, and keys are never used. It can be turned off any time in Settings.
- The tour's second stop, in Simple and in Expert, is one card: Single, Council, Mission, Pipelines. It uses the sentences the tour already had. Help replays them in docs/help/pipelines.md and in What a mission is in docs/help/missions-media.md.
- Completed jobs already wrote a local score for single chat, council, mission, and compare. Walkthrough builds were guessing the task type from the step text, so they now pass the capability the router assigned. A saved manual handoff, and a Grok Bot or browser helper job started from a click, now write the same record. A council or mission still records those agent jobs itself, including a late failure. The record keeps the model, task type, ok or fail, cost, and speed. It does not keep the prompt, the reply, or a key.
- Rebased onto origin/main at 35604ce (wider top menus, Live Ops bubble sizes, multiple mail accounts, project picker). Tests: npm test 377 tests, 376 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs, no real key. data/ was not touched.

## 2026-10-20: Start a project walkthroughs (Cursor cloud agent)

- Guided Start a project for six types: Website, Music video, Marketing campaign, App/software, Business plan, Social media reels. Stages: idea, clarifying questions, a council plan, steps routed with the existing router, review and revise, then export and next steps. Each click is explicit. Nothing is posted.
- Watch an example plays the fictional samples in walkthroughs/examples/. They are labeled Example data, read-only, and they do not call an AI. Playback uses the same live-view events so the flow map moves. Those events are marked as an example, so Command does not toast them as a finished mission.
- Simple and Expert follow the mode switch. Simple hides model picks. Expert shows the route and can edit the plan. This change does not add a second switch.
- Entry points: a Start a project card on Command (Chat in Simple mode), a Start a project item in the Settings menu, and a Start a project button on the Help tab. Help and the top-bar Help menu also have Replay the tour and Watch example projects, so the console tour and any sample or saved walk can be opened again. Per-type guides already live in Help. How this works reads those guides when they are present. If walkthroughs/examples/ is missing, each type still plays a labeled Example data placeholder and no AI is called.
- Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac).
- Rebased onto origin/main at aede1b3 (honest key errors, pause unpaid AIs, Pro prompt categories, savings tracker, Windows update checks). Help keeps Replay the tour and Watch example projects, and Check for updates stays. Tests after that rebase: npm test 358 tests, 356 pass, 0 fail, 2 skipped. npm run smoke: all checks passed. Node 22.23.3. Temp data dirs, demo AIs only, no real key or URL. data/ was not touched. Example JSON and the per-type help articles are owned by the other builders. This change only loads them, and a missing examples folder becomes a labeled placeholder.

FEATURE start-a-project DONE (built by Cursor cloud agent)

## 2026-10-20 02:30 UTC: Live Ops bubbles sized by the run, then by recent use (Cursor cloud agent)

- During a run the Live Ops bubbles follow that run. AIs working or already used in it grow, the busiest to 1.6x and every other one in the run still large (from 1.3x up). AIs not in the run shrink to 0.6x. The change eases out over about half a second. prefers-reduced-motion resizes with no animation.
- When nothing is running, size follows each AI's share of jobs in the last 30 days (ledger calls, images, searches, and credit lines). The busiest reaches 1.6x. Once anything has run, an unused AI shrinks to 0.6x. With no jobs in the window every bubble stays at 1x.
- Names stay at a readable size. On the smallest bubbles the name is hidden and comes back on hover or focus. Circles are laid out at the large size, and shrunk together if the ring is crowded, so a bubble can grow without covering a neighbour. The hub stays put.
- The live view flow map uses the same rule. Sizes update when an AI starts, when a job is logged, when an AI finishes, and when the run ends. `web/app.js` passes the 30-day counts and the current run into the graph. The ledger summary gains `calls30` and does not change older totals.
- Rebased onto origin/main at 2cff914. Paused providers still stay out of Live Ops (they are not opened as working). Tests: `test/graph-usage.test.js`. npm test 366 tests, 365 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs only. No real key.
- Checked in the browser on the local app, Expert, demo mode. At rest Atlas (8 jobs) drew at 1.6x (radius 35.2), Sage (1 job) in between (15.95), and Nova (none) at 0.6x (13.2) with its name hidden. During a single answer Nova grew to 35.2 and Atlas and Sage shrank to 13.2, then eased back to the 30-day sizes. Nova's resting size rose a little, because that answer is now in the tally.
- Not verified: a packaged Electron build. Phase 14 stays BLOCKED (needs a Mac).

LIVE OPS BUBBLE SIZE DONE (built by Cursor cloud agent)

## 2026-10-20: Multiple mail accounts (Cursor cloud agent)

Gmail, the browser helper Google sign-in, and Outlook were each one account. This adds more than one, without moving the original token. Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). The setup wizard UI was not built.

- `server/mail-accounts.js` is the small API: `listAccounts`, `addAccount`, `removeAccount`, `setDefaultAccount`, `setAccountLabel`. HTTP lives at `/api/mail-accounts` (`server/plugins/mail-accounts.js`). `docs/mail-accounts.md` is the contract a later setup-wizard change can call. It should not add a second copy of these routes.
- The original account keeps its vault id (`google-helper`, `mail-gmail`, `mail-outlook`). Each added account stores its token under `mail-acct-<id>`. Labels and which account is the default live in the `mail.accounts` doc. Tokens, refresh tokens, authorization codes, and client secrets are not written to that doc, to API replies, or to the log. Removing the original account keeps the OAuth client secret.
- Settings shows Add another account, a label, and a default choice on the browser helper Google card and on the Gmail and Outlook subscription cards. A browser helper job and a receipt scan can name `accountId`. A council or mission omits it and uses the default. Seen keys for an added mailbox are `src:accountId:messageId`, so two mailboxes do not share a seen list. The original seen keys stay `src:messageId`.
- Rebased onto origin/main at c391ac2 (Live Ops bubbles sized by the run, wider top menus). Tests: `test/mail-accounts.test.js` plus the existing browser and services suites. npm test 367 tests, 366 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. `data/` was not read or committed.
- Checked in the browser on the local app against a local OAuth stand-in: empty Add another account asks for a label, a Google account labeled Work shows as default and not connected, Command has an Account picker, and the Outlook card shows Work mail with a default choice and a scan Account picker.
- Not verified: a real Google or Microsoft sign-in, and a packaged Electron window.

MULTI-ACCOUNT MAIL DONE (built by Cursor cloud agent)

## 2026-10-20: Shared learning starts on for a new setup (Cursor cloud agent)

Owner request for 0.4.3. Not a numbered phase. No locked decision text was rewritten. Phase 14 stays BLOCKED (needs a Mac).

- A new brain starts with shareOptIn on. A setup that already saved the box off stays off. First-run setup and Who's best both show the box checked until the person clears it.
- Clearing it shows: Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share.
- What we share opens Help, Getting started. That note, the privacy note, and the shared-learning note say we share only anonymous track records: the task type, which AI, and the score. We never share prompts, content, or keys. The person can change it any time in Settings.
- This build still sends nothing. Show what would be shared stays on this computer.
- Tests: npm test 377 tests, 376 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. data/ was not read or committed.

SHARED LEARNING DEFAULT ON DONE (built by Cursor cloud agent)

## 2026-10-20: Single runs follow the Command bar priority (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac).

- A Single run was using the saved Default priority even after a click on Quality, Balanced, or Economy. The Command bar choice is now sent with that run. If nothing was clicked, or the value is not one of those three, the saved Default priority is used. Simple mode has no priority bar, so it still uses Default. A chat that already names a provider and model is unchanged.
- The stand-in path uses the same priority.
- Tests: `test/chat-priority.test.js`. npm test 379 tests, 378 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. A local OpenAI mock only. No real key. data/ was not read or committed.

SINGLE RUN PRIORITY DONE (built by Cursor cloud agent)

## 2026-10-20: Four run priorities (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). The registry still uses "economy" as a cheap model tier. That word is not a priority.

- Command, Settings, schedules, pipelines, and the scores view offer Quality, Balanced, Max savings, and Speed. Max savings is the old Economy choice. A saved default of economy still means Max savings.
- The same choice is sent with Single, Council, and Mission. Council uses three members for Max savings (and for the old lite flag when no priority is sent) and four for the others. An explicit priority wins over lite.
- Speed changes the ranking: with no track record it adds a bonus from the model's registry speed. Quality, Balanced, and Max savings keep their previous cost weights, so a Quality Single run still prefers GPT-6.1 Sol over GPT-6 Luna when only ChatGPT is keyed.
- Tests: `test/modes.test.js`. npm test 383 tests, 382 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. data/ was not read or committed.

FOUR RUN PRIORITIES DONE (built by Cursor cloud agent)

## 2026-10-20: Custom background colour (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Accent colours were already there. This adds the page background.

- Settings, Appearance, has a background colour next to the accent colour: ink, midnight, slate, pine, paper, sand, or any colour from the picker. Built-in restores the original background. Reset clears both.
- A light background uses dark text. A dark background uses light text. A web address is refused, so a background cannot be a remote image.
- The choice is saved with the other theme settings on this PC.
- Tests: `test/themes.test.js`. npm test 381 tests, 380 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.
- Checked in the browser on the local app, Expert: choosing paper turned the page background paper and kept the text readable, and Built-in cleared it.

CUSTOM BACKGROUND DONE (built by Cursor cloud agent)

## 2026-10-20: Free local models first, and legitimate savings (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). The presets from decision 9 stay. Aider and OpenCode were added as local OpenAI-compatible presets. Freebuff is not a provider.

- A connected free model on this PC (Ollama, LM Studio, Aider, OpenCode, or a custom OpenAI-compatible endpoint on localhost or with no key) is tried first on Max savings. Balanced still prefers it when the quality gap is within 15 points. Quality keeps the stronger paid model when the gap is more than 6. Speed tries it when the gap is within 12. A remote custom provider with a key is not treated as local just because its listed price is zero.
- The same model from two sellers keeps the cheaper one. On a tie, a direct provider beats OpenRouter.
- DeepSeek off-peak stays in the existing estimate. It is not applied a second time.
- When a provider reports prompt-cache reads, the ledger prices those tokens at the cache rate (Anthropic one tenth, OpenAI half). Anthropic system text of 4000 characters or more is sent with a cache breakpoint. A live run is not discounted for a cache the provider did not report.
- Batch is advice on the route preview only: about half the live price when the work can wait. A run sent now pays the live price.
- Freebuff is refused by name or address and left out of ranking. Nothing is shelled out to Aider or OpenCode. OpenCode's preset is only for an OpenAI-compatible /v1. The default port is 4096, and the address can be changed.
- Tests: `test/savings.test.js`. npm test 386 tests, 385 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.

FREE LOCAL MODELS FIRST DONE (built by Cursor cloud agent)

## 2026-10-20: Community track records teach every priority (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Decision 18 still holds: nothing in this build is sent. The share preview stays `sent: false`.

- Who's best can take a file of anonymous totals from people who opted in (task type, which model, score, and the other counts already in the share preview). Quality, Balanced, Max savings, and Speed all use those totals when learning is on. Turning the share box off does not hide totals already on this computer. Learning off ignores them, the same as a personal record.
- A row with any other field, including a prompt or a key, is refused. The file stays on this computer. Nothing is uploaded.
- Reset what the router learned also clears those community totals, so picks start again from the built-in scores.
- Tests: `test/community.test.js`. npm test 383 tests, 382 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.

COMMUNITY LEARNING DONE (built by Cursor cloud agent)

## 2026-10-20: v0.4.4 release tree (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Square and billing code were not touched. Nothing is uploaded. The share preview stays sent false.

- This tree keeps the Windows fallback hang fix, Free and Pro limits, Quality / Balanced / Max savings / Speed, free local models first, community track records for every priority, and the custom background colour.
- Version is 0.4.4. What's new and Help (getting started, licence, phone) say the same things.
- Tests: npm test 396 tests, 395 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.

V0.4.4 RELEASE TREE READY (built by Cursor cloud agent)

## 2026-10-20: Appearance pictures, gradients, and more presets (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). The background colour from the 0.4.4 release stays. Square and billing were not touched.

- Settings, Appearance, adds theme presets Harbor, Ember, Paper, and Aurora. Accent colours add teal, indigo, gold, and magenta. Background colours add charcoal, navy, wine, and fog.
- Gradients are Aurora, Dusk, Tide, Ember, and Frost. Built-in pictures are Horizon, Orbit, Lattice, and Bloom. Your photo is chosen from a PNG, JPEG, or WebP file on this computer. A web address is refused.
- A dim, blurred layer sits over a picture or photo so text stays readable. Built-in restores the original background. No picture removes only the gradient, picture, or photo.
- Tests: `test/themes.test.js`. npm test 396 tests, 395 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.
- Checked in the browser: paper set a light page with dark text, Aurora and Horizon painted behind the app, a local PNG became the photo, and Built-in cleared the picture. The Appearance panel has a file picker and no web-address field.

APPEARANCE BACKGROUNDS DONE (built by Cursor cloud agent)

## 2026-10-20: User-added apps and AIs learn what they are good at (Cursor cloud agent)

Not Phase 33. Phase 33 stays planned. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Decision 9 stays: a custom provider is still a name, address, key, models, and headers. Decision 18 stays: scores are task type and numbers, never the prompt.

- A user-added app or AI learns task types from its name and model ids (Aider, OpenCode, and a model id that says coder start at code). Tick Good at to name the task types yourself. Leave them blank and a plain gateway stays even.
- Matching tasks go to it. A code model is tried for code. A writing task stays with the stronger writing model while the code model has no writing record.
- Scores from jobs raise a task type that the starting guess had low. The settings card names the task types scores have raised.
- Tests: `test/added-caps.test.js`. npm test 400 tests, 399 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed. Phase 33 was not built. Merged with main after appearance pictures landed.

USER-ADDED APPS AND AIS DONE (built by Cursor cloud agent)

## 2026-10-20: You saved counter in the top bar (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Square and billing were not touched. Router savings already on main (local models first, cheapest seller, prompt-cache reads, batch as route advice only) were not rewritten.

- The top bar, mounted from `web/features/receipt.js`, now reads You saved with this month and all time. The word Estimate is on the counter. The existing sentence "Estimated, based on token counts and list prices." stays. Hover or focus opens a tooltip: reference-model list price for the same tokens, minus actual cost. Free and local $0 runs, a reported prompt-cache read, a cheaper seller, and a batch price only when that call was billed as a batch all lower the actual cost. A run sent now pays the live price. Settings still says Money saved. This counter does not edit `web/app.js`, `web/index.html`, `web/nav.js`, or `web/styles.css`.
- Tests: `test/receipt.test.js`. npm test 398 tests, 397 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read or committed.
- Checked in the browser on the local app: the top bar showed You saved $0.0019 this month and All time $0.0039, with Estimate and the list-price sentence. Hover showed the tooltip (reference model, free or local, prompt-cache, cheaper seller, batch only when billed that way, live price for a run sent now). The counter stayed visible in Simple and Expert, and at about 700px wide. Settings still says Money saved.
- Merged with main at cfd6205 (user-added AI routing). Both the routing and this counter stay.

YOU SAVED COUNTER DONE (built by Cursor cloud agent)

## 2026-10-20: Windows release key check and pull-request package (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Nothing was published. data/ was not read.

- The v0.4.4 Windows release (run 39426698708) passed tests and smoke, then stopped because SUPABASE_PUBLISHABLE_KEY was empty. The job never passed CC_SUPABASE_ANON_KEY, which is the name the build reads first, and it did not look at a repository variable of either name.
- The release workflow now passes both names, from the secret or from a repository variable when that secret is empty, and uses the same check as npm run dist. It still stops when neither is set. It still does not print the key.
- `.github/workflows/windows-ci.yml` runs npm ci, npm test, npm run smoke, and npm run dist on windows-latest for every pull request and every push to main. It does not publish and does not read a signing certificate or the releases token. CC_PACK_UNPUBLISHED lets that package build with no publishable key. That installer is not a release.
- electron-builder uses the winCodeSign 1.1.0 zip toolset. The legacy 7z bundle contains macOS symlinks that a Windows runner cannot unpack.
- Tests on d3a8b1f: npm test 404 tests, 403 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key.

WINDOWS PR CHECK READY (built by Cursor cloud agent)

## 2026-10-20: v0.4.5 version bump (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Nothing was tagged or published. data/ was not read.

- Version is 0.4.5. What's new, release notes, and Help (getting started) say the same things: Appearance pictures and a photo from this computer, You saved this month and all time, and Good at on a custom provider.
- The v0.4.2 installer did not read a GitHub secret. The publishable key was already in server/cloud-defaults.json (commit 4695f49) and was still there at the v0.4.2 release commit. scripts/inject-cloud-key.mjs did not exist yet. Commit c9c1d61 cleared that field. This token cannot list Actions secret or variable names.
- Tests: npm test 404 tests, 403 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read.

V0.4.5 VERSION BUMP READY (built by Cursor cloud agent)

## 2026-10-20: Windows release test hang on clock and save_note (Cursor cloud agent)

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). The v0.4.5 tag was not moved. Nothing was published. data/ was not read.

- Windows release run 39445588419 failed in Test, not on the publishable key. `test/mcp.test.js` timed out waiting for "clock + note" (the single that calls clock and save_note).
- The demo tool server now writes each JSON line with writeSync, so a Windows pipe cannot hold the reply. The stdio client writes the request the same way when the pipe has a file descriptor. The test's mock model closes the socket after each reply.
- The tag v0.4.5 still points at 30ce770. This fix is a pull request. The release was not retried.
- Tests: npm test 404 tests, 403 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read.

WINDOWS MCP STDIO HANG FIX (built by Cursor cloud agent)

## 2026-10-20: Windows CI on PR 45, three test failures

Not a numbered phase. No locked decision was changed. The v0.4.5 tag was not moved. Nothing was published. data/ was not read.

- Grok Bot's late mission: a wait of 0 minutes was a 1 ms timer, which Windows can swallow, so the mission never moved on. A 0 minute wait now returns immediately. The test mock also closes each socket, because Windows was reusing a keep-alive connection and the next model call never started.
- Image gallery: the "no provider call before the price" check counted background /models health checks. On Windows two of those land after the baseline (6 instead of 4). Health checks are not image calls, so they are no longer counted.
- clock + note: the model stream now stops at [DONE] and loopback calls ask the socket to close, so a quiet Windows pipe cannot hold the next round. The demo tool server queues stdin lines instead of readline, and Windows spawns that process with overlapped pipes, so the second tool call is not dropped while the first reply is flushing.
- Tests here (Linux): npm test 404 tests, 403 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read. Windows is the PR check.

WINDOWS CI THREE FAILURES (built by Cursor cloud agent)

## 2026-10-20: clock + note still times out on Windows

Tests 109 and 147 passed on run 39453428907. Test 207 still times out with no server log. CC_MCP_TRACE=1 now writes each JSON-RPC line, the demo server's stderr, and the spawn mode. The failing wait prints those lines. No locked decision changed. Tag v0.4.5 was not moved.

On the next Windows run (39456271825) clock + note passed. Two other waits timed out instead: brain "single with learning off" and Grok Bot "late mission". Both are a model call that never returns. Windows reuses a keep-alive socket after a finished mock reply, and the next request sits with no headers. Loopback fetches now use a private agent that sends Connection: close and does not keep the socket. Mock replies close too, and a 1 ms server keep-alive timer (it was racing the client) is gone. CC_NET_TRACE=1 writes each loopback fetch to stderr so a later timeout shows the last start, headers, or body line. Tests here: npm test 404 tests, 403 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read.

## 2026-10-20: Windows release flakes on three waits, and one test retry

Not a numbered phase. No locked decision was changed. Phase 14 stays BLOCKED (needs a Mac). Tag v0.4.5 was not moved. Nothing was published. data/ was not read.

- Release run 39467780863 failed in Test on the merged tree. Three waits expired at about 60 seconds: brain "single with learning off", MCP "tools off for one request", and MCP "demo single without tools". The same three had passed on the pull request check. The model calls that did run finished. The chat the test was waiting on never became a saved mission, while other test files were still starting servers on the same runner.
- A wait is now a real budget. On Windows that budget is twice the Linux one, and a single poll that does not answer is retried until the budget ends. A finished chat still returns on the next poll.
- Between tests the child server is reaped (on Windows, the process tree, so the demo stdio server goes with it), its pipes are closed, and every mock server drops its open sockets. Test requests use one socket and give up after 20 seconds so a wait loop can poll again.
- `npm test` runs test/mcp.test.js alone first (the stdio client, the stdio server, and demo mode), then the other files. On Windows those other files run two at a time.
- The release workflow still runs `npm test`. If that run fails, it runs `npm test` once more, then stops. The pull request check does not retry. One flake can no longer block publishing by itself.
- Tests here (Linux): npm test 405 tests, 404 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read.
- First Windows pull request check on this branch passed: run 39472467688, test-and-package, 13m47s. Test, smoke, package, and the installer check all succeeded.

WINDOWS FLAKE AND RELEASE RETRY (built by Cursor cloud agent)

## 2026-10-20: Live Ops reply, Reply to all, and Grok Bot results

Not a numbered phase. No locked decision was changed. Version stays 0.4.5 (this ships as v0.4.6). Phase 14 stays BLOCKED (needs a Mac). data/ was not read.

- Live Ops had no way to answer an AI. A reply under each answer, and one for the whole job, stay on that same run.
- The whole-job box is labeled Reply to all. It sends the message to every AI on that job. A council continues with each member and a new verdict. A mission continues with each specialist and the assembler, using the earlier task outputs and the deliverable.
- A Grok Bot result already comes back on POST /api/grokbot/callback/<job_id> (or the built-in mock). applyStatus announces it, then settle wakes a waiting council or mission, or, if that run already moved on, the finish listener writes the text onto the council answer or the mission task and emits grokbot.late. Live Ops now shows "waiting on Grok Bot" in that answer row until the text arrives, then shows the result next to the other answers.
- Reply to all includes Grok Bot only when that job already has a Grok Bot seat. It uses the same dispatch and callback. The row stays on "waiting on Grok Bot" until that handoff is stored on the same run.
- Opening a finished mission threw `(run.tasks || []).filter is not a function` under the deliverable. Live Ops stores tasks as an id map, and the media section treated that map as a list. It now accepts either shape. The task rows and their reply boxes were already on the page.
- Tests: npm test 407 tests, 406 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Local mocks only. No real key. data/ was not read.

LIVE OPS REPLY DONE (built by Cursor cloud agent)

## 2026-10-20: Windows CI on the Live Ops reply branch

Not a numbered phase. No locked decision was changed. Version stays 0.4.5. Nothing was merged. data/ was not read.

- Pull request check 39485495744 failed in Test. The demo chat "Write a two-line welcome." had already finished its model call. The wait still expired. It was looking for a single newer than the test's own clock, and a Windows runner can step that clock. The saved run then never counts as the one just started. A locked mission file can also vanish from the list for that poll.
- A chat now returns its run id, and that demo wait follows the id. Saving and reading a mission retries a short Windows lock (EPERM, EBUSY). The demo server closes its socket when the reply is done.
- Tests here (Linux): npm test 408 tests, 407 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. No real key. data/ was not read. Windows is the pull request check.

WINDOWS DEMO WAIT (built by Cursor cloud agent)

## 2026-10-20: Phase 35 yearly and lifetime plans, Phase 55 update prompts

No locked decision was changed. Version stays 0.4.5. Phase 14 stays BLOCKED (needs a Mac). Nothing was published. data/ was not read. Square was not called and nothing was charged.

- Phase 35: Pro yearly is $159 a year, and the lifetime founder deal is $299 for the first 100, then $499, capped at 500. The monthly checkout stays the existing Square link https://square.link/u/dbU38mQC at $15.99 a month. Yearly and lifetime show in the Subscriptions lock and in Settings. Their Square links are not published, so those buttons do not open a checkout and do not charge. A seat count in this install's founder-seats.json picks $299 or $499. Tests use a mock checkout. docs/billing.md matches.
- Phase 55: the startup prompt stays Install now / Later and still does not download until Install now. The background check is hourly. While the app is running the prompt says Restart and update / Later. Later on that prompt downloads after the click and installs when you quit. An unsigned Mac build still does not download on Later.
- The plan's run-order tests now follow the order Chris merged on 2026-10-20. Decision 14's original order stays in docs/DECISIONS.md.
- Commit e6cd060: Add yearly and lifetime Pro plans, and hourly update prompts.
- Tests here (Linux): npm test 414 tests, 413 pass, 0 fail, 1 skipped (Pyodide is not installed). npm run smoke: all checks passed. Node 22.23.3. Local mocks only. No real key. data/ was not read. Windows is the pull request check.
- Checked in a browser on this machine: the Subscriptions lock shows Go Pro, $15.99/month on the existing link, Pro yearly, $159/year, and Lifetime founder. Clicking yearly and lifetime says nothing was charged. Settings shows the same choices.

PHASE 35 DONE
PHASE 55 DONE

## 2026-10-20: Everyday actions, What's new and suggestions (Cursor cloud agent)

Not Phase 56 done. Item 2 stays with Phases 53 and 54. Phases 35 and 55 were not reworked. No locked decision text was rewritten. package.json was not bumped. It was already 0.4.6. The help catalog now matches that version. data/ was not read.

- What's new is a card of new connections and actions. Try it is a sample and does not send. Skip never returns. Remind me later waits 3 days, then 7 days, then the item moves to Settings and stops asking. Skip all clears the card.
- Google Calendar on that card does not start sign-in. The checklist row still does.
- Suggest a connection or idea sits in Settings, on the card, and on the connections page when nothing is connected. The page shows the exact note. Send is a separate click. A loopback stub can take it. Otherwise it stays on this computer. The confirmation is: Thanks, Chris reads these.
- Each has a try saying line, a How to section, and a Help article. The version note for 0.4.6 was missing, so those two behaviors are listed there too. The updater prompt was not changed.
- Tests: `test/everyday-news.test.js`. npm test 417 tests, 416 pass, 0 fail, 1 skipped (Pyodide is not installed), including the serial MCP file (8 pass) and the main batch (409 tests, 408 pass, 1 skipped). npm run smoke: all smoke checks passed. Node 22.23.3. Temp data dirs and local mocks only. No real key. data/ was not read.

EVERYDAY WHATS NEW (built by Cursor cloud agent)
