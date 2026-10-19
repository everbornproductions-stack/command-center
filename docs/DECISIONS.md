# Locked decisions: do not undo

Chris approved everything below on 2026-10-18. It is shipped and in use, and it must not be reverted, renamed, reworked or "cleaned up" by any build phase, refactor or agent.

If a phase in docs/BUILD-PLAN.md seems to need a change to one of these items, do not make the change. Write `PHASE N BLOCKED: <reason, naming the decision>` in docs/BUILD-LOG.md and stop, so Chris can decide.

Tests guard most items (see `test/decisions.test.js` and the files named below). A change that breaks one of those tests is a change to a locked decision.

## Product and installer
1. **Name and tagline.**
   - The product is **Command AI**, with the tagline **"an Everborn product"** (by Everborn Productions) everywhere a user looks: window title, installer, tray, header and docs.
   - The internal and repo names stay "Everborn Command Center" / `command-center`.
   - No em-dashes in any user-facing text.
   - Tests: `test/update.test.js` (branding), `test/desktop-update.test.js`.
2. **appId and data folder never change.**
   - `appId: com.everborn.command` in electron-builder.yml.
   - `app.setName("Everborn Command")` in electron/main.cjs, so settings, keys and history stay in `%APPDATA%\Everborn Command\data` across updates and reinstalls.
   - NSIS `perMachine: false` and `deleteAppDataOnUninstall: false`.
3. **Updates.**
   - electron-updater uses the GitHub provider and reads the PUBLIC repo `everbornproductions-stack/command-center-releases`.
   - The source repo stays private, and no token is ever embedded in the app.
   - Artifact names use dashes, no spaces: `Command-AI-Setup-${version}.${ext}`.
   - Releases follow docs/RELEASING.md: draft, upload, verify size, publish, then check that `latest.yml` shows the new version.
4. **Launch update prompt and main-process updater.**
   - The updater lives in the Electron main process (electron/updater.cjs). It never depends on the local server or the web UI.
   - On launch it checks for updates and shows "Command AI vX.Y.Z is ready" with **Install now** (progress bar, then restart) and **Later**.
   - Nothing downloads before that click.
   - The tray has Check for updates, Install update and Restart app.
   - The engine watchdog (electron/watchdog.cjs) offers Restart app / Install update after about 15 s without an answer.
   - The local electron/offline.html page shows when the engine does not start.
   - So a broken build can always update itself.
5. **Single instance.**
   - `app.requestSingleInstanceLock()` is used, and a second launch focuses the open window.
   - Several "Command AI.exe" processes for one copy (main, GPU, network, window) are normal.
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
   - It uses the OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`, with current Pro and Flash defaults and pricing.
   - The key check sends the key in a header, not in the URL.
9. **Custom providers.**
   - "Add custom provider" accepts any OpenAI-compatible (default) or Anthropic-compatible API: name, base URL, key, models or /models discovery, and optional extra headers.
   - Keys and header values are stored in the vault.
   - Custom providers can be edited and deleted.
   - Presets: OpenRouter, Groq, Together, Fireworks, DeepSeek, Mistral, Perplexity, Ollama (http://localhost:11434/v1, no key) and LM Studio.
   - Implemented in server/plugins/providers.js.
10. **Key auto-detect.**
    - Pasting a key suggests its provider (AIza = Google, sk-ant- = Anthropic, xai- = xAI, sk-or- = OpenRouter, gsk_ = Groq, and so on).
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
    - 1, 15, 16, 26, 25, 12, 27, 13, 17 to 24, 14, then 2 to 11.
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


## Rules (always)
- Never deploy the hub or anything else. Never touch Square or billing, never charge money.
- Never use real API keys. Tests use mocks on local ports and never call a real URL.
- Never read or commit anything in `data\` (including data\supabase-db-password.txt).
- Never put passwords, SSNs or client data into git.
- Nothing posts, sends or publishes without an explicit click by the person.
