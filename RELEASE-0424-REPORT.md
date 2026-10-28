# Meldmind 0.4.24 release report (2026-10-27, about 11:10 to 11:20 PM)

Release: https://github.com/everbornproductions-stack/command-center-releases/releases/tag/v0.4.24

Releases are published in `command-center-releases`, not in `command-center` (the first `gh release view` against `command-center` says "release not found").

## Publish check: PASS
- v0.4.24 was already public (isDraft false). Nothing to publish; no re-tag, no new build.
- Assets: `Meldmind-Setup-0.4.24.exe` (114,682,282 bytes), `Meldmind-Setup-0.4.24.exe.blockmap`, `latest.yml`.
- Downloaded installer SHA-256 `c976736a...f46b00` matched the release's own digest. The installer is not code-signed (Authenticode: NotSigned), same as before.

## Install: PASS
- Meldmind was not running. The temp sidebar watcher (powershell PID 21604) was stopped first.
- Silent install (`/S`, exit code 0) over 0.4.23. Uninstall entry changed from "Meldmind 0.4.23" to "Meldmind 0.4.24". `Meldmind.exe` file version 0.4.24.0.

## Checks
| Check | Result | Evidence |
|---|---|---|
| Version 0.4.24 | PASS | `/api/health` returned `version: 0.4.24`; `/api/state` `version=0.4.24`; What's new popup said "Version 0.4.24" |
| New look by default, dark mode | PASS | First launch after install, no flags or stored choice changes: Mac-style window (traffic lights, dock, "Meldmind Command"), dark. Popup text: "The new Mac-style look is now on by default." `settings.uiStyle=mac`. Screenshots in `meldmind-dogfood\shots\` (full3.png) |
| Sidebar text readable, no watcher | PASS | Watcher process stopped and confirmed gone before install. After dismissing the What's new popup (its dim layer had hidden the true colour), the brightest pixel in the sidebar labels "Start a project", "Projects", "Missions", "Compare" measured RGB 255,255,255 on a 26,25,28 background |
| Engine answers | PASS | `GET /api/health` on 127.0.0.1:4747 returned ok (app command-ai, mode local, version 0.4.24); `/api/state` returned data. One slow start: right after a relaunch the window showed "engine is not responding (timed out)" for about 30 s while the engine warmed up, then recovered on its own (see notes) |
| Setting kept after quit and relaunch | PASS (with a caveat) | Set Simple mode in the UI, then `uiMode=simple` read back from the server. Ended all Meldmind processes, relaunched, `uiMode=simple`, `uiModeChosen=true` still stored. Restored to `expert` afterwards through the same settings API |
| Voice free by default | PASS | `GET /api/voice/speech-paid` returned `{"paidSpeech":false}`. Source (server/speech.js on main): chain is Groq, Gemini, ElevenLabs; OpenAI only when "Use my OpenAI credits for voice" is on. I did not record or send any audio |

## Cleanup: done (sidebar check passed)
Deleted `%LOCALAPPDATA%\meldmind-sidebar-fix.ps1`, `%LOCALAPPDATA%\meldmind-sidebar-fix.mjs`, and the Startup file `meldmind-sidebar-fix.cmd`. Confirmed none remain.

## Notes and things to look at
1. **Tray quit could not be driven.** Closing the window leaves Meldmind in the tray (by design), and I could not reliably click the tray's Quit through screen automation (Phone Link and a Grok Bot window kept taking focus on this PC). So "quit" was ending the Meldmind processes, not a tray Quit. A normal quit should behave the same, but it has not been tested with the tray.
2. **First persistence attempt looked like a fail, then passed.** I clicked Simple, ended the app, relaunched, and the window was back on Expert. The server settings were read directly on the second try and kept `uiMode=simple`, but the page still painted Expert for the active project ("Everborn Monday ideas weekly helper"). The page decides the mode per project (`resolveProjectMode`), so a project's own mode can override the saved global one. Worth a look: Chris may expect Simple to stick everywhere.
3. **Engine warm-up banner after relaunch.** About 30 s of "engine is not responding (timed out)" with Restart engine / Check for updates buttons, then it connected by itself. This is the slow-start the 0.4.24 engine fix targets; it is better than before but still visible on a cold start with many missions.
4. **"Couldn't check for updates"** bar showed on each launch of 0.4.24. Not investigated.
5. On the first launch the engine was on port 4748 (4747 was held by a leftover), later launches used 4747.
6. Screen automation on this PC is unreliable while Phone Link / Grok Bot windows are open; one stray click landed in Phone Link's blank area and I looked at nothing in it.

## Where things were saved
- This report: `Desktop\Everborn\meldmind-dogfood\RELEASE-0424-REPORT.md` and in the repo (see below).
- Lessons: appended to `LESSONS.md` in everbornproductions-stack/command-center.
- Screenshots and probe script are scratch in `Desktop\Everborn\meldmind-dogfood\shots` and `\tools` (screenshots contain Chris's other windows, so they are not committed).
