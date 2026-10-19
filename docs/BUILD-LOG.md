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
