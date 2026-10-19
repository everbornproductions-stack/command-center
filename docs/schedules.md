# Schedules: scheduled and triggered agents

The Schedules tab runs a custom agent, a plain chat or a mission without you typing it each time.

**Desktop schedules only run while the app is running (the tray counts). Always-on schedules need the hosted hub later.** Slots missed while the app was closed are not replayed; the next slot runs as normal. A hosted hub refuses schedules with a clear message for now.

## Triggers

- **Schedule (cron).** Five fields in local time: minute, hour, day of month, month, weekday (0 or 7 is Sunday). Lists, ranges and steps work (`0 9 * * 1-5`, `*/15 * * * *`, `15,45 8-17 * * *`), and so do `@hourly`, `@daily`, `@weekly` and `@monthly`. Each slot runs at most once, even if the clock ticks several times inside it. A tick that comes late (sleep, a busy PC) still runs a slot from the last five minutes.
- **Webhook.** `POST /api/schedules/hook/<schedule id>` with the trigger's own secret token in `X-CC-Trigger-Token`, `Authorization: Bearer <token>`, or `?t=<token>`.
  - The token is random per trigger, shown once when you save, stored only as a SHA-256 hash and compared in constant time. "New token" retires the old one at once.
  - A wrong or missing token gets 401, and so does an unknown schedule. The app's own session token does not open it.
  - The body is optional. If present it must be a JSON object (`content-type: application/json`, up to 64 KB). It is handed to the run as data, never as instructions.
  - At most 30 calls a minute per trigger (429 after that), and at most five runs waiting per schedule.
  - The address only works for callers that can reach this PC. Until the hosted hub exists, that means programs on this PC, or a tunnel you set up yourself. The app does not set up a tunnel.
- **Watched folder.** A folder on this PC, with an optional file pattern (`*.txt, *.csv`).
  - Files already in the folder when watching starts do not run.
  - A new file runs once, after its size has held still for one scan. Temporary download files (`.part`, `.crdownload`, `.tmp`, `~$...`) are ignored.
  - Text files up to 50 KB are handed to the run as data. Other files are named but not read.
  - The app's own data folder cannot be watched.

## Money and approval

- Every run uses your own keys. Every call goes in the ledger and counts toward the per-AI spend caps, as for any chat or mission.
- Each schedule also has its own **monthly spend cap**. When the month's runs reach it, the schedule pauses. An alert goes out through the usual channels (in-app, push and email, per Settings > Spend caps & alerts), and the next trigger is refused with 409. Resume works only after the cap is raised, or in the next month. A mission run gets at most the cap that is left as its budget.
- **After the run** can send the result to a web address (one JSON POST: schedule, run_id, trigger, file, text, finished_at). Such a result waits in **Needs your approval** with the full text and the address shown. Nothing is sent until you click **Approve and send**; **Don't send** drops it. Tools that write, send or delete during a run still ask for your OK each time (Phase 16). Unanswered tool requests are declined after ten minutes.
- Missions are a Pro feature, so a mission schedule is refused on Free. Agent and chat schedules are not tier-gated (Chris decides).

## API (session token required, except the webhook)

```
GET    /api/schedules                      schedules, recent runs, agents, the desktop note
POST   /api/schedules                      create { name, target: { kind: agent|chat|mission, agentId, text, projectId, mode },
                                                    trigger: { type: cron|webhook|folder, cron, folder, pattern },
                                                    capUsd, after: { action: none|webhook, url } }
POST   /api/schedules/<id>                 edit
DELETE /api/schedules/<id>                 delete (the run history stays)
POST   /api/schedules/<id>/run             run now
POST   /api/schedules/<id>/pause|resume
POST   /api/schedules/<id>/token           new webhook token
GET    /api/schedules/runs?schedule=<id>
POST   /api/schedules/runs/<run id>/approve|reject
POST   /api/schedules/hook/<id>            the webhook (its own token)
```

Code: `server/schedules.js` (clock, triggers, caps, approval), `server/plugins/schedules.js` (routes and the runner), `web/features/schedules.js` (the tab). Tests: `test/schedules.test.js`.
