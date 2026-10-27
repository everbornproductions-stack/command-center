# DONE 0422A auditfiles

## C2 Save as files and linked media folder
- New `safeMediaDir(projectId)` in server/project-media.js. It refuses (400, plain message) when media, the project folder or `projects` is a link, or the folder resolves outside the data folder. Nothing is created or written first.
- /mindmedia/code-files (server/plugins/mindmedia.js), server/named-file.js and server/local-draw.js now call it before any mkdir or write. Named-file and local-draw turn the refusal into their usual "Not saved / not made" line.
- Test: test/mindmedia-0421.test.js (media symlinked to an outside folder: 400 and the outside folder is still empty; a normal project still saves). Fails on the old code.

## C8 Voice "publish it"
- web/features/voice-talk.js saves with status Review. web/features/voice-actions.js asks "Save ... to MindMedia?" and says "Saved to MindMedia." (no word published). Action id stays publish_mindmedia.
- Test: test/voice-talk.test.js. Pin updated: test/voice-talk-browser.test.js now expects the strip "Saved to MindMedia" and status Review (the rule changed).

## C10 Body limit message
- New server/body-limit.js holds the limit and the message. Files travel as base64 (a third bigger), so the message says the biggest file is about 13 MB. server/index.js readBody uses both.
- Test: test/hub-small-0421.test.js (constant, message, and a real 413).

## Skipped
- Nothing in the brief. Left alone: the hint line "or publish it to MindMedia" in voice-talk.js (it is what the person can say).
