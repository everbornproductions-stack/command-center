# Smaller extras (Phase 24)

Four small features. Each works in demo mode, and none of them sends or spends anything without a click.

## Quick launcher (desktop app)

- A global shortcut opens a small box over any app. Type a question or orders, then press Enter. It goes to this app as a **Chat** (the best AI for the job) or a **Council**, and the main window comes forward with the answer.
- **Default: Alt+Space.** Change it in Settings > Quick launcher: click the box and press the keys. A modifier (Alt, Ctrl, Shift, Super or Command) is required, so normal typing is never captured.
- **The app never steals a shortcut.** If Windows or another app already holds it (PowerToys Run uses Alt+Space, for example), Electron's `register()` says no. The launcher then stays off with a plain note, and nothing is unregistered for anyone else.
- Combinations the OS always keeps (Alt+Tab, Alt+F4, Ctrl+Alt+Delete, Win+L, Cmd+Space for Spotlight, Cmd+Tab) are refused without even trying.
- The shortcut is released when it changes, when it is turned off and when the app quits (`will-quit`). The tray also has "Quick launcher".
- On Windows, Alt+Space also opens a window's own system menu. While the launcher holds the shortcut, that menu is still under a right-click on the title bar.
- Files: `electron/hotkey.cjs` (registration and checks), `electron/main.cjs` (the window), `web/quick.html` (the box; it gets the per-launch session token like `index.html` and calls only `/api`), `server/plugins/hotkey.js` (the saved choice), `web/features/hotkey.js`.

## Chrome / Edge extension

- **Install:** open `chrome://extensions` (or `edge://extensions`), switch on Developer mode, click "Load unpacked" and pick the `extension` folder. Settings > Browser extension shows its exact path. In the installed app the folder sits next to `app.asar` (`app.asar.unpacked\extension`).
- **Pair:** Settings > Browser extension > Pair a browser shows a code once (`cce.<port>.<secret>`). Paste it into the extension's popup. The app keeps only the SHA-256 of the secret. Unpair revokes the code at once (up to ten browsers).
- **Use it:** right-click "Send page / selection / link to Command AI", or open the popup to add a note ("turn this into three captions"). The popup sets what a send does:
  - **Put it in Marching orders** (the default): the text waits in Command (a chip under the orders box, or the box itself when it is empty). Nothing runs until you press Send.
  - **Ask now** or **Council**: the run starts at once, because you clicked Send in the extension. The ledger, spend caps and tier limits apply as usual.
- **Safety:**
  - The extension's host permissions are `127.0.0.1` and `localhost` only. It finds the app on port 4747 and up and talks to nothing else.
  - No content script runs until you click.
  - The app's `/api/ext/ping` and `/api/ext/send` routes are exempt from the session token only. The Host pin stays. Any web page's Origin is refused (only `chrome-extension://` and `moz-extension://`). Bodies must be JSON, at most 300 KB (the page text is cut at 50,000 characters).
  - The pairing secret is compared with `timingSafeEqual`. Limits: 20 wrong codes a minute, and 30 sends a minute per browser.
- The extension is not in the Chrome Web Store. Publishing it there is Chris's call.

## Live model prices

- Public list prices come from the OpenRouter models API (`GET https://openrouter.ai/api/v1/models`). No key is used and nothing about you is sent.
- They are fetched once a day (an hour after a failure) and kept on this PC, so an offline start still has the last good table.
- **Matching:** OpenRouter ids are `<vendor>/<model>` (`anthropic/`, `openai/`, `x-ai/`, `google/`, `deepseek/`, `mistralai/`, `perplexity/`). Dots and dashes count the same, and a `-latest` model matches its plain name. OpenRouter's own models match by id.
- Groq, custom providers, the demo AIs and the variable routes (`openrouter/auto`, `openrouter/free`) keep their own prices, because OpenRouter's list price is not what you pay there.
- **Which price is used:** your own price (the boxes next to each model in Settings) always wins, then the live price, then the built-in one. The router, the ledger's cost estimates and the savings receipts all read that one price (`registry.modelPrice()`). An exact bill from OpenRouter still wins in the ledger.
- Settings > Model prices shows built-in, live, yours and in use for each model, with Refresh now, an on/off switch and "use live" to drop your own price. A failure says "Could not reach OpenRouter: <reason>", and the last good prices stay in use.
- On the hub, `CC_LIVE_PRICING=off` switches it off.

## Team SSO (hosted hub) and per-workspace API keys

**Sign in with Google or Microsoft.**
- The hub's sign-in page shows "Continue with Google" and "Continue with Microsoft" when `CC_SSO_PROVIDERS=google,azure` is set.
- The OpenID Connect flow runs through Supabase Auth's Google and Azure providers, the same Auth that sends the magic links, so the hub keeps one kind of session.
- The hub's public `/api/sso/start` only sends the browser back to this hub (no open redirect).

**Setup (Chris, once, not done by any agent):**
1. In Google Cloud and in Microsoft Entra, create an OAuth client with the Supabase callback address (`https://<project>.supabase.co/auth/v1/callback`).
2. In Supabase > Authentication > Providers, turn on Google and Azure with those client ids and secrets. The secrets live in Supabase, never in this app.
3. Add the hub address to Supabase's redirect allow list.
4. Set `CC_SSO_PROVIDERS=google,azure` on the hub.
5. Run `supabase/team-sso.sql` for workspace rules.

**Workspace rule** (owners and admins, Studio): "members sign in with Google and/or Microsoft, with an address on these domains".
- A member or viewer whose current session did not come from an allowed provider with an allowed address sees the workspace locked (no shared projects or members). They cannot switch to it and do not get its keys.
- The owner is never locked out.
- How a session signed in comes from Supabase's `amr` claim (`oauth` versus the emailed link). Allowed providers and addresses come from the account's linked identities.
- A hub without `team-sso.sql` simply has no rules.

**Per-workspace API keys** (owners and admins, Studio): Settings > Workspace API keys.
- A key saved for a workspace is used **only** for calls made while that workspace is the active one in the header switcher. Personal and every other workspace keep using each person's own key. A provider without a workspace key also uses your own key.
- Desktop: the key is in this PC's vault (DPAPI), next to your own keys.
- Hub: one row per workspace and provider in `workspace_secrets` (`supabase/workspace-keys.sql`).
  - Each row is AES-256-GCM under the hub's master key and bound to `ws:<workspace>:<provider>`, so a moved row does not open.
  - Owners, admins and members can use the keys; viewers use their own.
  - The workspace's sign-in rule is checked on every call, so the same person on an emailed-link session (a phone, say) does not get the key.
- Keys are shown masked (first and last four characters) and never go to a browser.
- Settings > keys always edits your own key, never a workspace's. Settings > Workspace API keys lists which providers the active workspace's keys serve right now; the state marks them too (`keyScope: "workspace"`).

**Migrations:** `supabase/workspace-keys.sql` and `supabase/team-sso.sql` are migration files only. Both turn on row-level security. Neither has been run on any database.
