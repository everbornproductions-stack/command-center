# Grok Bot agent (Phase 12)

Meldmind hands Grok Bot the parts of a job that need its own computer: **signed-in browsing**, **Gmail**, **Google Drive**, **Google Calendar** and its **teammate bots**. Plain text work (writing, research, analysis) always stays with the text AIs.

## Set up (Settings > Integrations > Grok Bot)
- **Webhook URL**: where Meldmind posts jobs. `https://` anywhere; `http://` only for this computer (127.0.0.1 / localhost).
- **Sender key**: the key Grok Bot checks on every job.
- **Header name** (optional): default `Authorization`, sent as `Authorization: Bearer <key>`. Any other name (for example `X-Api-Key`) carries the key as is.
- **Where results come back** (optional): the public address of the hosted hub or a tunnel. Empty means `http://127.0.0.1:<port>`.
- The URL and key are stored in the vault (DPAPI / OS keychain / hosted AES-GCM), never in git, never logged, and never sent to the browser after saving.
- Options: hand jobs over on its own when they need it (on by default), the built-in mock, how long a council (90 s) and a mission (15 min) wait before going on without it.

## When a job is handed over
- Only from a council or mission the person started, or a click (**Send to Grok Bot**, **Send a test job**). In Command, *Grok Bot: when needed / Always / Never* applies to the next council or mission.
- Council: Grok Bot gets the question as a job and sits next to the other answers. If it answers within the council wait, its answer is peer-reviewed, scored and can win like any other. If it answers later, it is added to that council and scored by one judge call (in the ledger). Grok Bot does not review the others.
- Mission: the planner may mark a step `capability: "agent"` with `needs`; a step whose wording needs Gmail, Drive, Calendar, signed-in browsing or teammate bots also goes to Grok Bot. Later steps get its result as input. If it is not back within the mission wait, the mission goes on, the step shows *still out*, and the result is added to the mission (and its deliverable) when it arrives.
- Never in demo mode, unless the built-in mock is selected. The mock is a pretend Grok Bot inside the app: nothing leaves the computer.

## The hand-off (what Grok Bot receives)
```
POST <webhook URL>
Authorization: Bearer <sender key>          (or <header name>: <sender key>)
Content-Type: application/json

{ "job_id": "gb-...", "task": "...", "context": "...", "workspace": "personal", "callback_url": "https://.../api/grokbot/callback/gb-...?t=<token>" }
```
Answer 2xx to accept. An optional JSON reply `{ "status": "working" }` (or `queued`, `needs_approval`) sets the first status. 401 / 403 shows "Grok Bot refused the sender key", other errors "Grok Bot refused the job (code)", no answer "Could not reach Grok Bot: <reason>".

The `task` string also ends with a report-back block when `CC_WORKER_URL` and `CC_WORKER_TOKEN` are set, so the same job can be posted to `POST /api/handoff/<job_id>/done` on that hub. `callback_url` is unchanged. The block is not stored on the job. With no hub, the block only says to reply with `DONE: <summary>` so the person can use Paste result. The local callback in decision 15 is still the one in `callback_url`. The same outbound task includes a permission line (ask, or Get it done for this job). That line is not stored on the job.

## Results (what Grok Bot sends back)
```
POST <callback_url>
Content-Type: application/json

{ "status": "queued" | "working" | "needs_approval" | "done" | "failed", "text": "...", "artifacts": [{ "name": "...", "url": "https://...", "type": "..." }] }
```
- Send as many updates as you like; `done` or `failed` ends the job. The token in `callback_url` is random per job, stored only as a SHA-256 hash, compared in constant time, and works once for `done` / `failed`. After that every call answers 401.
- The callback route needs no session token and accepts any Host header (a tunnel or the hosted hub forwards its own), but refuses everything else: wrong method (405), wrong content type (415), a bad body or status (400), an unknown job or a wrong token (401).
- `text` is Markdown, up to 200,000 characters. Only `http(s)` artifact links are kept; up to 20.
- `needs_approval`: the job card turns amber with "needs your approval"; the approval itself happens in Grok Bot.

## Until Grok Bot can reach the app
`callback_url` points at this computer until the hosted hub exists or Chris sets up a tunnel and enters its address under *Where results come back*. No tunnel is built and nothing is deployed by the app. Until then a job stays queued / working, and the person can **paste the result in by hand** under the deliverable or in Settings; a pasted result counts like a callback and burns the token. A job can also be cancelled here (Grok Bot is not told; its late callback is refused).

## Hosted hub note
On a hosted hub, callbacks find their user through an in-memory job index, so a job handed over before a hub restart cannot be called back afterwards; paste its result by hand.

## Where it shows
- Hub: a Grok Bot card next to Claude, ChatGPT, Grok and Gemini (light: grey not set up, green ready, amber needs approval or demo mode, red the last hand-off was refused or unreachable), plus a Browser helper card (Phase 27). The Agents panel in Command shows what each is doing now and an activity feed.
- The live graph, the feed (`agent.*` events and log lines), and `external.handoff` events for the Phase 29 live view.
