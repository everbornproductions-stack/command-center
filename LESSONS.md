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
