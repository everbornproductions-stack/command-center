# Release 0.4.24 report (job meldmind-release-0424)

Status: **PARTIAL.** Steps 1-4 done and verified. Steps 5-6 NOT done (see below).

Release: https://github.com/everbornproductions-stack/command-center-releases/releases/tag/v0.4.24

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | PR 133 and PR 132 merged into hotfix/0.4.23.1 | PASS | Both MERGED (gh pr list); hotfix history has "Merge PR 133" and "Merge PR 132". The red Windows CI on 132 was not re-diagnosed in this run; Windows CI on the combined hotfix head was green (see 3). |
| 2a | package.json version 0.4.24 | PASS | On origin/main and hotfix: "version": "0.4.24" |
| 2b | docs/WHATS-NEW.json has a 0.4.24 entry | PASS | key "0.4.24" present |
| 2c | New look (cc.mac) on by default, dark theme | PASS (code read, plus CI tests) | web/mac/index.js macOn(): on unless ?mac=0, cc.mac="0" or uiStyle="classic". shell.js applyTheme falls back to dark. |
| 2d | uiStyle/theme/mode saved in settings.json | PASS (code read) | commit 46ab306; POST /settings merges any key into saved settings. Not yet confirmed across a real restart (step 5). |
| 2e | Voice free by default | PASS (code read only) | server/plugins/voice.js: "Paid speech (OpenAI) is off unless the person turned it on". Not exercised live. |
| 3 | PR 130 green on Windows CI, merged to main | PASS | Run 40633150677 success on head 46ab306; PR 130 merged (0e4bb67). |
| 4 | Tag v0.4.24, release workflow, assets | PASS | Tag pushed once (no manual dispatch). Run 40636559442 success. Release is not draft, assets: Meldmind-Setup-0.4.24.exe, .blockmap, latest.yml. |
| 5 | Install on this PC and verify | **NOT DONE** | Installed Meldmind is still 0.4.23.0. See blockers. |
| 6 | Delete sidebar-fix files and stop watcher | **NOT DONE (deliberately)** | Gated on step 5 being verified. Files and watcher (powershell PID 28584) are untouched. |
| - | Command Center job handoff ping | **NOT SENT** | Could not find how earlier jobs sent it; did not guess an endpoint. |

## Blockers on step 5
- Another process on this PC (parent: a Claude Code shell, not this session) keeps launching `Temp\meldmind-0424-dl\Meldmind-Setup-0.4.24.exe /S` (seen 22:44 and 22:48). Those runs finished without updating the install (version still 0.4.23.0), probably because the running app blocks the silent install. I did not start a competing installer.
- The old Meldmind.exe (PID 25472, started 6:22 PM) cannot be closed: CloseMainWindow did nothing, Stop-Process -Force reported success but the process stays listed, taskkill says it cannot be terminated. My own attempt to start the installer from dl-0424 got "Access is denied".
- Needed from Chris: make sure only one session is installing, quit Meldmind (or reboot), then run Meldmind-Setup-0.4.24.exe (downloaded copy: Desktop\Everborn\dl-0424). Then verify version, dark new look, readable sidebar, engine port, and a setting kept after restart, and only then delete meldmind-sidebar-fix.ps1/.mjs, the Startup meldmind-sidebar-fix.cmd, and stop the watcher.

## Notes
- The main checkout (Desktop\Everborn\everborn-hq\command-center) is on main, 8 behind, with uncommitted edits to server/index.js and untracked files. I did not touch it; all work was done in the hotfix-wt worktree.
