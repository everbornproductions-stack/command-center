# DONE-Q: image jobs with no image key (dogfood 13, part of 14)

## What changed
1. **Local drawing route** (`server/local-draw.js`, new). With no image AI connected, a flat graphic (quote card, banner, simple poster) is built as an SVG from the task's quoted headline, small caps line, colors (words or hex) and size (default 1080x1080). The desktop app turns it into a PNG (`electron/svg-render.cjs`, hidden window + `capturePage`, wired in `electron/main.cjs` as `globalThis.__ccSvgRenderer`). Without the app the SVG is saved and the step says "Not made: quote-card.png. Saved as SVG, PNG needs the desktop app." and fails honestly. Every file is checked with stat (`diskLine`, "exists, N bytes" / "missing") before any line says saved.
   - `server/media-preflight.js`: `mediaStatus(kind, goal)` returns the local route for flat graphics, or "I can't make this image: ... Add your fal.ai key ..." for anything else. `neededMedia` now sees "quote card" and "PNG" asks.
   - `server/mission.js`: at planning time a "render with Pillow" step becomes one local drawing step and a verify-only step is dropped; the plan note and log carry the honest line; `mediaPlan` and `mediaTask` handle the local route; a kept SVG is handed over instead of "Nothing came back".
2. **No search for drawing and page builds** (`server/step-guard.js` `isDrawingOrPageJob`, `wantsSearch`; `server/index.js` single chat). They search only when the person says so ("search the web", "look up", ...).
3. **Removed APIs**: `NO_REMOVED_APIS_LINE` added to the code-step instructions in `server/mission.js`; `removedApiNotes` flags `.textsize(` and fails QA with a plain note.
4. **Save lines**: `stripSaveClaims` now also removes "File saved:", "File has been saved", "I saved the file to ...", "Saved at ..." (and runs for image jobs). Code steps that name a file get `diskCheck` lines ("name: exists, N bytes" / "name: missing"), shown to the AI reviewer, and a missing file fails QA deterministically. `savedFile` is re-checked on disk before "Saved as" can show.

## Tests (Node 22, `/tmp/mmtools/clean.sh`)
- test/image-route-0421-q.test.js: 15 pass, 0 fail (new)
- media-switch-0421 10/0, dogfood-0421 6/0, dogfood-ui-0421 10/0, step-guard-0421 11/0, codewrite-0421 14/0, mission-guard-0421 6/0, plan-0421-p 5/0, user-facing-words 2/0, plus media*, search, send* files all pass.
- Not run: the Electron renderer itself (needs the desktop app); it is a hook the tests replace.
