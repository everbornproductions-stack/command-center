# Security Review 0.4.22

| Group | File:line | What the code does | Real or noise | Why | Fix or none |
|---|---|---|---|---|---|
| 1. File inclusion | server/worker-service.js:164 | Reads static files from WEB_DIR using request pathname | Noise | Path is normalized against WEB_DIR and guarded against directory traversal. | None |
| 1. File inclusion | server/walkthrough-examples.js:94 | Reads walkthrough example JSON files from fixed ROOT/walkthroughs/examples | Noise | Files are loaded from a hardcoded directory relative to ROOT with fixed filenames. | None |
| 2. SSRF | web/sw.js:21 | Service worker fetches same-origin requests | Noise | Restricted to `url.origin === self.location.origin`. | None |
| 2. SSRF | server/mcp-demo-server.js:48 | Reads local token file for MCP bridge | Noise | Reads a local config file path from env var, not user input. | None |
| 3. location.href XSS | web/features/reports.js:27 | Sets location.href to backend draft mailto URL (`dr.mailto`) | Noise | Value comes from trusted server API (`/reports/draft`) returning standard mailto: link. | None |
| 3. location.href XSS | web/app.js:3276 | Sets location.href to Supabase auth authorize URL or SSO start endpoint | Noise | URL is constructed from trusted config (`CONFIG.supabase.url`) and provider identifier. | None |
| 2. SSRF | server/page-reader.js:38 (defaultFetcher) | Opens each search source URL (chosen by a search engine or an AI answer) | Real (medium; high in hosted mode, cloud metadata at 169.254.169.254) | Any address was fetched, including private ranges, link-local and nip.io style names | New server/safe-url.js `isPublicHttpUrl` (reuses app-drivers `isRefusedDoorHost`); loopback stays allowed on the desktop only. Test: test/safe-url-0422.test.js |
| 2. SSRF | server/browser-reader.js:172 (load) | The browser helper's text reader opens a page the person or a job asks for | By design for now | It must open the person's own local site previews; http(s) only is already enforced | Fix later: refuse private ranges in hosted mode |
| 3. location.href XSS | web/** window.open(...) (about 30 sites) | Opens sign-in, publish, preview and help links in a new tab with noopener | Noise | Values come from the app's own server routes or blob: previews; Electron's window-open handler sends http(s) to the system browser | None |
| 3. location.href XSS | electron/main.cjs:281 (will-navigate) | Any navigation away from the app went to shell.openExternal, whatever the scheme | Real (hardening) | A file: or custom-scheme link could start a program | Only http, https and mailto links are handed to the system |

Review note (integration, 0.4.22): the first pass (Gemini) left page-reader, browser-reader and the window.open sites unreviewed and shipped tests that only tested helpers defined inside the test files. Those two fake tests (safe-path, safe-href) were removed (no real file inclusion or href hit means no helper, as the brief says) and safe-url now tests the real server/safe-url.js.
