# Stay light

Baseline measured on main at v0.4.8 on 2026-10-21, before the lazy loader, shared scheduler, and add-on manager in this workstream. The version was not changed. `data/` was not read. Nothing was published.

These numbers are the budget in `server/perf/budget.js`. Windows CI fails the package job when the installer grows past 15% of the installer baseline, and `scripts/perf-budget.mjs` fails when main-process startup names a heavy module.

## Baseline

| What | Number | How it was measured |
| --- | --- | --- |
| Installer | 112,077,608 bytes (about 112 MB) | GitHub release v0.4.8 asset `Meldmind-Setup-0.4.8.exe`. `latest.yml` is 345 bytes. The blockmap is 118,329 bytes. v0.4.2 was 112,678,771 bytes. This agent did not build a Windows installer. |
| Install size | 305,198,150 bytes | `electron-builder --linux dir` unpacked app (`dist/linux-unpacked`). The Windows unpack was not built. The app source that ships is about 2.7 MB (259 files). `app.asar` in that Linux dir was about 7.8 MB. The rest is Electron. |
| Cold start (desktop) | 470 ms to `/api/health`, 753 ms to the first window load | Electron on Linux under Xvfb, sandbox off, a temp home and a temp data dir. |
| Cold start (engine only) | 224 ms to `/api/health` | `node server/index.js`, temp data dir, `CC_LIVE_PRICING=off`. One process. |
| Idle RAM (all Electron processes) | 743,976 KB (about 727 MiB) | Six processes, RSS summed, about 12 seconds after launch, GPU on: main 210,960 KB, gpu-process 186,832 KB, renderer 148,116 KB, utility 86,076 KB, zygote 56,012 KB, zygote 55,980 KB. A sample at about 5 seconds was still warming (about 750 MB and about 107% CPU). With `--disable-gpu`, the same box settled near 656,188 KB. |
| Idle RAM (engine only) | 100,112 KB (about 98 MiB) | The node server after a short idle. CPU 0%. |
| Idle CPU | Main process 0%. Renderer about 8%. | The gpu-process sat near 98% under Xvfb. That is this VM (no real GPU), not an ordinary PC, so it is not the idle CPU budget. |
| Installer cap | 128,889,249 bytes | `floor(112077608 * 1.15)`. |
| Idle RAM budget | 900 MiB | Headroom over the measured 727 MiB. |
| Engine RSS budget | 300 MiB | Headroom over the measured 98 MiB. `npm test` samples the node engine on Linux. |

## Background timers before this change

Each of these called `setInterval` (or a repeating timeout) on its own:

| Job | Interval |
| --- | --- |
| Schedules | 15 seconds (`CC_SCHEDULE_TICK_MS`) |
| Reports | 10 minutes, plus a 60 second one-shot after start |
| Service detection (balances) | 45 seconds, then hourly |
| Licence | immediate, then 12 hours |
| Model watch (live prices) | 3 seconds, then hourly, unless `CC_LIVE_PRICING=off` |
| Credit health | immediate, then 60 seconds |
| Renewal alerts | 20 seconds, then 12 hours |
| UI refresh | 15 seconds |
| Update check (server) | immediate, then 1 hour with the desktop bridge, else 6 hours |
| Hosted idle eviction | 60 seconds (hosted only) |
| History sync | 10 minutes (`CC_SYNC_EVERY_MS`, minimum 1 second) |
| Desktop updater | 1 hour, in the Electron main process |
| Watchdog | 3 seconds, in the Electron main process |
| Health loop in `server/health.js` | 5 minutes, defined but not started |

## What shares one scheduler now

`server/perf/scheduler.js` keeps one timer. A job registers with `everyMs`, optional `lightEveryMs`, optional `firstMs`, and `pause`.

`pause: true` skips the job while the app is idle or on battery. `pause: "idle"` skips only while idle, so an open window still refreshes on battery. Idle means no sockets and no HTTP activity for 120 seconds, or the window has been hidden or minimized for 60 seconds. Battery comes from Electron `powerMonitor` (`globalThis.__ccPerf.battery`) or `CC_ON_BATTERY=1` / `0` in tests. The app does not read `/sys`.

Light mode uses `lightEveryMs` when set, otherwise four times `everyMs`.

| Job id | Usual wait | Light mode | Pause |
| --- | --- | --- | --- |
| schedules | 15 seconds | at least 60 seconds | idle or battery |
| detection | 1 hour (first run after 45 seconds) | 6 hours | idle or battery |
| reports | 10 minutes | 1 hour | idle or battery |
| renewals | 12 hours (first run after 20 seconds) | 24 hours | idle or battery |
| history-sync | 10 minutes | at least 1 hour | idle or battery |
| model-watch | 1 hour (first look after 3 seconds) | 6 hours | idle or battery |
| credits | 60 seconds (also once at start) | 5 minutes | idle or battery |
| updates | 1 hour with the desktop bridge, else 6 hours (also once at start) | at least 6 hours | idle or battery |
| licence | 12 hours (also once at start) | 24 hours | idle or battery |
| ui-refresh | 15 seconds | 60 seconds | idle only |
| hosted-idle | 60 seconds, hosted only | same | does not pause |

Left on their own timers on purpose:

- The desktop updater still checks once an hour in the Electron main process, and the watchdog still runs every 3 seconds. Decision 4: the updater has to work even if the engine is down.
- The weekly report still does one 60 second catch-up after start.
- The health loop in `server/health.js` is still not started.

## Lazy load

`web/perf/registry.js` is the list. The browser and the server both import that file. It has no DOM code.

Shell modules (themes, brand, tour, help, key setup, connect setup, updates, hotkey, access) load with the window. They are small and the shell needs them.

Every other feature module loads with `import()` the first time its page is open. Command still loads the home, deliverable, and listen modules after settings arrive, so approval toasts, mail sign-in, and the home widgets keep working. Light mode does not load those until you open their own page. Settings, Setup, and Credits still load their panels when those pages open. A module loaded in this visit stays in memory until you quit.

Server plugins that already exist stay eager. Custom providers register at boot, and tests depend on that. Only rows in `SERVER_DEMAND` wait. Today that is `perf.js` (Settings, Performance). The first `/api/perf` request loads it, and so does `POST /api/perf/open` when Settings opens. `/api/state` does not list `perf` until that happens.

Menus come from the nav order, so a page can be clicked before its module has loaded.

## Add-ons

OCR, Whisper, WhisperX, Piper, Godot templates, Bevy templates, Lighthouse, Playwright browsers, Postiz, Chatwoot, and DocuSeal are not in the installer. `electron-builder.yml` excludes `addons/**` and those package folders. `package.json` does not depend on them.

Settings, then Performance, lists each one with a size. Install runs only after the click (`approve: true`). The button says the size, for example `Install, about 150 MB`. Remove deletes the copy from this PC.

Files live under the app data folder (`CC_DATA_DIR/addons`), not in the repo `data/` directory. The client cannot pick the download URL. Tests may set `CC_ADDON_URLS` unless `CC_PACKAGED=1`. With no URL, the click is recorded and the cloud route stays in use. Nothing posts or sends on its own.

`chooseRoute` returns `local` only when that copy is on disk. Otherwise it returns `cloud` and the sentence on the add-on row (a connected model, inbox, or signing service). Prefer that route until the person installs the tool.

## Light mode

Settings, then Performance. The checkbox is "Light mode for an older PC".

It slows the shared jobs, adds `light-mode` on the page so motion matches reduced-motion, and skips the extra Command and deliverable panels. Chats, keys, and projects stay. A scheduled result still waits until you click Approve. Help: "How this stays fast" opens the article Stay fast on an older PC (`docs/help/stay-light.md`).

## CI budget

`scripts/perf-budget.mjs` checks:

1. `electron/main.cjs` and `server/index.js` do not `require` or `import` a heavy package, at the top level or inside a function. Relative files and `node:` imports are fine. The registry may name a tool. It must not import it.
2. `package.json` dependencies are not those heavy packages.
3. If `dist/Meldmind-Setup-<version>.exe` exists, its size is at most the installer cap. Windows CI sets `CC_REQUIRE_INSTALLER=1` after packaging, so a missing installer fails the job.
4. If `CC_IDLE_RAM_BYTES` is set, that sum of every Electron process must be at most 900 MiB.

Windows CI does not launch Electron to sample RAM. A live sample on a shared runner is too noisy for one gate. The unit test records the measured idle RAM under the 900 MiB budget, and on Linux it checks the running engine RSS against the 300 MiB engine budget.

## How an open pull request adopts this

Add a page or builder to `FEATURES` in `web/perf/registry.js`:

```js
{ id: "remix", views: ["remix"], kind: "builder" }
```

`id` is the file under `web/features`, without `.js`. Do not set `home`, `deliverable`, or `listen` unless the module must load with Command. Light mode skips those. Do not add a static import in `web/features/index.js`.

Add a heavy server module to `SERVER_DEMAND`:

```js
{ id: "remix", file: "remix.js", views: ["remix"] }
```

Do not import it from `server/index.js`. The first `/api/<id>` request loads it, and so does `POST /api/perf/open` with that view.

Add a background check with the shared scheduler. Do not call `setInterval`:

```js
scheduler.register({
  id: "remix-watch",
  everyMs: 60 * 1000,
  lightEveryMs: 5 * 60 * 1000,
  pause: true,
  run: () => {},
});
```

Add a heavy tool to `ADDONS` with `bytes` (decimal) and a `cloud` sentence. Do not add an npm dependency and do not `require()` it from `electron/main.cjs` or `server/index.js`. Call `chooseRoute`. Use the cloud route until `installed` is true. Download only when `approve` is true, and show `bytes` before that click.
