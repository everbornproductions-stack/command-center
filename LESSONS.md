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

## 2026-10-21: [skip ci] at the head of a PR or in a squash message skips everything (0.4.14)

- What happened: PR #117 started no check because its head commit said [skip ci]. After the squash-merge, main CI and the v0.4.14 tag push started nothing, because the squash message repeated the [skip ci] lines of the PR's commits. GitHub applies the marker to tag pushes too.
- Rule: mark only intermediate commits [skip ci]. The last commit on a PR must not have it. Squash-merge with an explicit message that has no [skip ci] (`gh pr merge N --squash --subject "..." --body "..."`).
- Fix if it happens: start "Windows release" and "Mac CI" by hand on the tag (`gh workflow run release-windows.yml --ref vX.Y.Z`, same for mac-ci.yml). That publishes exactly the same way, with no new commit and no tag move.
