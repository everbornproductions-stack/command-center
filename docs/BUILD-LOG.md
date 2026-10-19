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
  - Every column streams at the same time. Each one shows its answer, cost (✓ when the provider reported the exact bill), time to first words, total time and tokens.
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
