# DONE - Item MAKEINTENT

## What Changed
- Updated `SCENE_DENY` in `web/make-intent.js` to include additional written artifact and content terms (`posts`, `sheet`, `cheatsheet`, `cheat sheet`, `guide`, `notes`, `flashcard`, `flashcards`, `quiz`, `outline`, `worksheet`, `study`, `week`, `month`, `calendar`, `series`, `plans`).
- Added comprehensive test cases in `test/make-it.test.js` validating that requests such as "A week of posts for my flower shop", "a one page cheat sheet for confidence intervals", "a study guide for the bar exam", "flashcards for Spanish verbs", and "an outline for my talk on gardens" return `null` (not image/video), while genuine image requests like "a woman on a beach", "draw a fox in the snow", and "a poster of a fox in the snow" continue to be correctly recognized as images.

## File Paths
- `web/make-intent.js`
- `test/make-it.test.js`

## Tests Run & Results
- `node --test test/make-it.test.js` -> 5 tests passed (0 failed).
- `node --test test/user-facing-words.test.js` -> 2 tests passed (0 failed).
