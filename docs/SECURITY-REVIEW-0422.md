# Security Review 0.4.22

| Group | File:line | What the code does | Real or noise | Why | Fix or none |
|---|---|---|---|---|---|
| 1. File inclusion | server/worker-service.js:164 | Reads static files from WEB_DIR using request pathname | Noise | Path is normalized against WEB_DIR and guarded against directory traversal. | None |
| 1. File inclusion | server/walkthrough-examples.js:94 | Reads walkthrough example JSON files from fixed ROOT/walkthroughs/examples | Noise | Files are loaded from a hardcoded directory relative to ROOT with fixed filenames. | None |
| 2. SSRF | web/sw.js:21 | Service worker fetches same-origin requests | Noise | Restricted to `url.origin === self.location.origin`. | None |
| 2. SSRF | server/mcp-demo-server.js:48 | Reads local token file for MCP bridge | Noise | Reads a local config file path from env var, not user input. | None |
| 3. location.href XSS | web/features/reports.js:27 | Sets location.href to backend draft mailto URL (`dr.mailto`) | Noise | Value comes from trusted server API (`/reports/draft`) returning standard mailto: link. | None |
| 3. location.href XSS | web/app.js:3276 | Sets location.href to Supabase auth authorize URL or SSO start endpoint | Noise | URL is constructed from trusted config (`CONFIG.supabase.url`) and provider identifier. | None |
