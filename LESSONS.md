# Lessons

Short lessons from shipping Meldmind. Read this before a release. Add new lessons at the bottom with the date.

## 2026-10-21: Release tests that read a child's log must wait for the line (0.4.13)

- What happened: the v0.4.13 Windows release job failed test/reportback.test.js twice (first try and retry), so the release stayed a draft with only the Mac files. The same commit had passed Windows CI on the pull request and on main.
- Cause: the hub test server is a child process. It logs `report-back <id> expired` with console.log while it answers the HTTP request. On Windows a write to a pipe is asynchronous, so the HTTP reply can reach the test before the log line does. The test read the log once, right after the reply. Linux pipes are synchronous, so it never failed there.
- Fix: wait for an expected log line with a real deadline (waitForReport in reportback.test.js, 5s, doubled on Windows by waitBudget). Never assert on a child's stdout immediately after an HTTP reply.
- Rule: a test that passed Windows CI once can still fail on the release runner. A flaky test blocks a release, so treat any read of a child's log as racy.

## 2026-10-21: Check the release, not just the tag

- A pushed tag does not mean a published release. The Mac job creates a draft and only the Windows job makes it public. After tagging, check `gh release view vX.Y.Z --repo everbornproductions-stack/command-center-releases` shows isDraft false with Meldmind-Setup-X.Y.Z.exe, its .blockmap and latest.yml.

## 2026-10-21: Local Windows test noise on Chris's PC

- On Chris's PC, test/mcp.test.js (tests 6, 10, 11) and sometimes reportback test 3 fail with ECONNRESET or HPE_INVALID_CHUNK_SIZE. Clean main fails the same way there, and the same code passes on GitHub's Windows runners, so it is something on that PC (other local servers, security software). Compare against clean main before blaming a branch.

## 2026-10-21: GitHub billing blocks look like failures

- A Windows CI run with zero steps and "The job was not started because recent account payments have failed or your spending limit needs to be increased" is a billing block, not a code failure. Check the job annotations before reading it as a test result.

## 2026-10-21: The site pins version numbers

- www.everbornproductions.com/meldmind/ shows the version and links the Mac .dmg files by version-numbered name under releases/latest/download. Those links break when a newer release becomes Latest. Update the page with every release (or switch to version-free links). The page source was not found in git; it is deployed by zip upload to the Cloudflare Pages project everbornproductions.

## 2026-10-21: The site follows releases on its own (correction)

- The lesson above was read from the page source only. In a browser, the Meldmind page script calls the GitHub releases API on load and rewrites the version, the Windows and Mac download links, and (from 2026-10-21) the Just released list from the latest release notes. Load the page in a browser before calling the site stale.
- The site source is now in the private repo everbornproductions-stack/everborn-site (media in Drive, Everborn Cloud/everborn-site). It still deploys by zip upload to Cloudflare Pages; mirror live first.

## 2026-10-25: Stripe unlock matched money, and the plan lookup trusted a typed email (0.4.19)

- What failed (0.4.18 tester panel): a one-time Founder payment was matched by `amount_total`, so a promo code or sales tax made a paid charge with no unlock. Separately, `activate_license_by_email` was callable by anon with any email, so anyone could ask whether an address had a paid plan.
- What fixed it: the plan now comes from the Checkout Session (`meldmind_plan` metadata, Payment Link id, then price or product id from the line items, read by the webhook with an optional read-only `STRIPE_READ_KEY`). The amount charged is never used. The email lookup reads the confirmed email from a signed Supabase session (migration 20261026_stripe_unlock_proof.sql, app side server/licence-session.js); anon can no longer run it, and every miss gives the same reply.
- Rules: never decide what was bought from what was charged. Never let a client-supplied email stand in for proof of who it is. Tests that need a vault secret seal vault.bin the way the app does (DPAPI on Windows) instead of adding a test backdoor.
- Local noise: test/mcp.test.js (HPE_INVALID_CHUNK_SIZE) fails on Chris's PC with or without this change, and `npm test` stops at the first failing group, so run the other files directly to see the rest.

## 2026-10-27: Test measured the app's own element, not its own (0.4.23 release blocker)

- What failed (Windows release run 40576260314, 604/606): test/chat-start-toast.test.js "look offer does not cover the centre of the page" measured {l:244, r:1354}. It passed locally. The test injects its own `#cc-look-offer`, but on a slow runner the app's real offer (look.js, docked full width in the notices row by design since 0.4.21) appeared first. Same id, so `querySelector` returned the real one. The CSS was not broken.
- What fixed it: the test removes any app-made offer and measures only its own element (tagged `data-test-offer`).
- Rule: a test that injects an element must find it by something unique, never an id the app also uses. If a test passes on a fast PC and fails on CI, look for a timing race with the app's own element before touching the CSS.
## 2026-10-27: Saves and runs must never depend on a linked folder or an outside queue (0.4.23.1)

- What happened: dogfood retests 08 to 13 on 0.4.22 showed named files never saved and tests never run, "All N steps done" on failed missions, 12 to 15 minute hangs on a dead Grok Bot queue, and the owner's private cloud-first rules inside plans.
- Causes: files were written only for steps typed "code" and only when a project folder was linked (a full path in the task was ignored); a save step that mentioned Drive was routed to Grok Bot; Claude Code reads the owner's own CLAUDE.md; the finished line counted steps, not results; the Send button was rebuilt between press and release and Space had no handler.
- Fix: files go to the linked folder, else a folder named by full path in the task, else the project's own Meldmind folder, and the answer says where. Text steps that say "save as x.md" are saved. Saves never go to an agent, and a Grok Bot queue with jobs unclaimed for 10 minutes is not used. The Claude Code worker runs with CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 and plans are cleaned of the routine. Send is handled once on the document. Update failures on automatic checks only log.
- Rule: a live run on the real app (Electron, mock AIs, throwaway data folder) found a bug that unit tests missed ("Node.js" read as a file name). Always do one. Keep subscription CLIs out of live runs with CC_SUBCLI_HOME and the CC_*_BIN variables, or they answer instead of the mock.
- Rule: the old tests that said "nothing is written without a linked folder" locked in the bug. When a test asserts the broken behavior, change the test and say so in the PR.

- 0.4.23.1 CI note: a document-level capture handler for the Send click ran before a browser test's own listener on the button and broke `mac-flow-0423` and `make-chat-browser`. Keep the button's own click listener; use the document handler only for keys and repaint races.

## 2026-10-27: Turning a look on by default breaks every test that boots the app (0.4.24)

- What happened: flipping `macOn()` to default-on made 16 browser tests fail locally. They measure the classic layout, and the Mac overlay (`#mac-root`) sits on top of it and intercepts clicks. Separately, the version bump to 0.4.24 failed CI on five test files that pin `package.json` version and on the What's new test, because a new version needs a `docs/WHATS-NEW.json` entry.
- What fixed it: `bootPage` in test/pw-helpers.js stores `cc.mac = "0"` for tests of the classic layout unless a choice is already stored (so `bootMac` still wins), and `mac: "default"` boots like a new user. Version pins moved to 0.4.24, the guide PDF was rebuilt (`node scripts/build-guide.mjs`), and 0.4.24 got What's new and release-notes entries.
- Rules: when a default changes, run the whole browser suite locally first, not only the test files for that feature. When bumping the version, grep tests for the old number, rebuild the bundled guide PDF, and add the What's new entry in the same commit. A fresh worktree needs `npm ci` before the guide build.
