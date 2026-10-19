# Plugin API (for feature sessions)

Features are added as new files only. Two halves per feature, both optional.

## Server: `server/plugins/<id>.js`

```js
export const id = "receipt";                       // routes mount at /api/receipt/...
export async function init(h) { /* once at startup; h = helpers */ }
export async function routes(req, res, url, body, h) {
  // url.pathname is the full path, e.g. /api/receipt/summary ; body is parsed JSON for POST/PUT (else {})
  if (req.method === "GET" && url.pathname === "/api/receipt/summary") return h.json(res, 200, { ... });
  return false;                                    // not handled → 404 from index.js
}
export function onEvent(ev, h) { /* every bus event: mission.update, council.update, ledger.entry, agent.*, provider.status, log */ }
```

Helpers `h` (all already bound to the current user's context in hosted mode):

| helper | what |
|---|---|
| `json(res, status, obj)` | send JSON |
| `emit(type, data)` / `bus` | event bus; emit `log` with `{ text, level? }` to show in the live feed |
| `settings()` | current settings object (read); use `doc`/`putDoc` to persist your own data |
| `doc(kind, initFn)` / `putDoc(kind, value)` | per-user JSON documents (local: files in data/; hosted: Supabase user_docs). Use a kind prefixed with your id, e.g. `"pipelines.saved"` |
| `ctx()` | the current user context (`ctx().userId` in hosted mode) ; `runAs(userId, fn)` for background work |
| `PROVIDERS` | the provider registry (ids: anthropic, openai, xai, google, perplexity, openrouter, deepseek, groq, mistral, kling, suno, flow, syncso, hedra, elevenlabs, cursor, capcut) |
| `getSecret(providerId, envName?)` / `setSecret(providerId, value)` / `hasSecret` | the key vault; secrets never go to the browser |
| `streamChat({ provider, model, system, messages, maxTokens })` async generator of `{type:"delta",text}` / `{type:"done",usage}` ; `complete(opts, onDelta?)` → `{ text, usage }` | call any text AI |
| `rank({capability, difficulty, mode})` / `classify(prompt)` | the router |
| `runMission({ goal, mode, projectId, qa, budgetUsd, context })` / `runCouncil({ prompt, members, projectId })` | start runs (they emit events and persist themselves) |
| `recordCall({ provider, model, usage, missionId, role, ms })` / `recordCredits({ provider, units, note, project, cost })` / `ledgerSummary()` | the ledger |
| `listProjects()` / `saveProject(p)` | projects hub |
| `subscriptionView()` / `saveSubscription(s)` | subscriptions |
| `licenseState()` / `requireFeature("missions" \| "scheduler")` | tier gating (throws a 402-style error) |
| `HOSTED`, `DATA_DIR`, `VERSION`, `readBody(req)` | misc |

Rules: never read or write `data/` directly (use `doc`/`putDoc`); never return secrets; anything that posts, sends or spends needs an explicit user click and a dry-run estimate first.

## Web: `web/features/<id>.js`

Loaded by `web/features/index.js` (add your id to its `FEATURES` list only if it is not already there; the current list already includes search, mcp, pipelines, ratings, memory, receipt, media, publish, reports, alerts, share, voice, workspaces). The module calls `CC.register({...})` at import time:

Note: a feature's `web/features/<file>.js` name, its `CC.register({ id })` and its server plugin's `export const id` are independent. The Tools feature (MCP) is `web/features/mcp.js` with register id `mcp`, but its server plugin mounts at `/api/tools` (`export const id = "tools"` in `server/plugins/mcp.js`). Keep the server id out of any path whose last segment is `mcp` or `sse`.


```js
const { S, api, toast, md, esc, money, fmtN, ago, favicon, P, pname, pcolor, $, $$, render, refresh, go } = window.CC;
CC.register({
  id: "receipt",
  tab:         { label: "Receipts", short: "Receipts", icon: "⌁", order: 30, render(view) { view.innerHTML = ...; } },  // optional top-level tab
  command:     { order: 10, render(el) {} },               // widget under the orders panel in Command
  deliverable: { order: 10, render(el, run) {} },          // under the deliverable; run = finished live run or null while running
  settings:    { order: 10, render(el) {} },               // panel in Settings
  onEvent(ev) {},                                           // every WebSocket event
  onState(S) {},                                            // after each state load / tick
});
```

`api(path, { method, body })` calls `/api` + path and throws on error. `S` is the live client state (providers, projects, missions, ledger, settings, license, plugins). Styles: reuse the classes in `styles.css` (`panel`, `btn`, `btn primary`, `btn sm`, `chip`, `route`, `kpi`, `tbl`, `empty`, `dim`, `small`). Do not edit `app.js`, `styles.css` or `index.html`; if a style is missing, inject a `<style>` block from your module.

## Mission step types

Pipelines call missions with `steps`. A step without `type` is an LLM task. Other types are provided by plugins through `h.registerStep?.(type, handler)` once `server/steps.js` lands (main session); until then, media and publish plugins expose their actions as plain routes and the deliverable buttons.
