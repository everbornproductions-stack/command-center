# Meldmind 0.4.36: persona ideas committed to this round

Source: the Nov 1, 2026 persona ideas session on 0.4.35 (file `Meldmind-Persona-Ideas-2026-11-01.md`, kept in Chris's persona-ideas folder, not in this repo). Every persona reaction in it is simulated.

Chris's rule (Nov 1, 2026): persona ideas always go into the NEXT build round. They are never parked as "Proposed". Status of every item below: **Next round (0.4.36)**.

This file lists only the persona ideas. Other 0.4.36 work (start-a-project kinds, templates, dock and full-window fixes) is tracked in the integration/0.4.36 branch and `tools/notes-0.4.36.json`.

Rules for every item: nothing is sent, posted, signed or bought without a click and a preview. A free path comes first. The user's original files are never changed. Client data follows CLAUDE.md (no SSNs, dates of birth or passwords in files).

How to read "Done when": each check is something a person can see on the screen, in plain words. Each item also needs a test that runs on Windows and Mac CI (real waits, helper processes one at a time).

## 1. Change my file (effort M)
Who asked: Dana, Nadia, Elena, Carla.
What: drop your own Excel, Word or PowerPoint file, say what to change ("raise every price 5%", "add our new address", "swap the logo"), and get a new copy.
Done when:
- After the change, the new file opens in Excel, Word or PowerPoint with the same fonts, colours, column widths and layout as the original.
- A short "What changed" list shows each change (for example "Sheet Prices, 14 cells: raised 5%"), and the person can check it before saving.
- The original file has the same size and date as before, and the new copy has a different name.
- If Meldmind is not sure which cells or words to change, it asks instead of guessing.

## 2. Paper to spreadsheet (effort S)
Who asked: Nadia, Dana, Derek, Walt.
What: a photo of a handwritten log, whiteboard or paper sign-up sheet becomes a real Excel file with columns.
Done when:
- One photo in gives one .xlsx file that opens in Excel with a header row and one row per line on the paper.
- Any cell Meldmind could not read is coloured yellow, and a count says "6 cells to check".
- Nothing is guessed silently: a blurry cell stays empty or shows the best guess marked yellow.
- It works with a free photo-reading key first. A photo of a receipt still goes to Receipt Snap.

## 3. Same job for every client (effort M)
Who asked: Jordan, Elena, Tasha.
What: set a task once (this month's four posts, a monthly update), tick which client projects get it, and each runs with that project's own brand kit and memory.
Done when:
- The person writes the task once and ticks 2 or more projects from a list.
- Each project's result uses that project's own brand kit (name, colours, voice), not another client's.
- Each result has its own review screen, and the person approves or discards each one separately.
- Nothing is posted or sent by this feature. Results are saved as drafts only.
- It is separate from "Do this for every row", which works over a spreadsheet; this works across projects.

## 4. Try a script safely first (effort S to M)
Who asked: Priya, Max, Nadia.
What: before a PowerShell or Python script touches real files, run it on a copy of the folder and report what it would do.
Done when:
- Meldmind copies the folder to a scratch place, runs the script there, and shows "would change 12 files, delete 0" (the real numbers) plus the file names.
- The real folder has not changed at all after the dry run (same files, same dates).
- Two buttons follow: "Run for real" and "Cancel". Nothing runs for real without a click.
- The scratch copy is removed afterward, and a folder too big to copy says so instead of starting.
- It builds on the 0.4.32 practice database for SQLite and the script checks.

## 5. Fill my form (effort S to M)
Who asked: Marcus, Carla, Ray, Tasha.
What: drop a PDF form (W-9, vendor sign-up, rental or carrier application) and fill it from the Business Profile.
Done when:
- Fields Meldmind can match (name, address, phone, business type) are filled from the Business Profile, and the rest stay empty.
- One screen lists every field with its value, and the person checks or edits each one before saving.
- The filled copy is saved under a new name and the blank original is untouched.
- Signature and date-of-signing fields are never filled. The screen says "You sign this part yourself".
- A Social Security number or tax ID is never taken from saved files; the person types it in, and it is not stored.

## 6. Check my spreadsheet (effort M)
Who asked: Carla, Dana, Leo, Marcus.
What: drop any sheet and get plain words on what it does, plus totals that do not add up and broken formulas, with a one-click fix saved as a copy.
Done when:
- The person sees a short plain-words summary of what the sheet does.
- Totals that do not add up and formulas that show an error are listed with their cell names.
- A "Fix" button saves a corrected copy; the original is untouched and each fix is listed.
- Good for sheets a bookkeeper or an old employee left behind.

## 7. Clip finder (effort M to L)
Who asked: Kai, Jaylen, Ray.
What: drop a long video and get the 3 to 5 best short moments as vertical clips with captions, each with a preview.
Done when:
- The person drops one long video and gets 3 to 5 vertical clips, each with captions, and plays each one before saving.
- The person can drop a clip they do not want; only kept clips are saved.
- The free path comes first: a free speech key for the words and the PC's own video tools for the cuts. No paid service is needed.
- The original video is untouched. Nothing is posted.

## 8. Client hand-off folder (effort S)
Who asked: Elena, Jordan, Sofia.
What: one button packs a project's finished files (picked from the History groups) into a zip with a cover page.
Done when:
- The person picks a project and sees its finished files with a tick box on each.
- "Make folder" saves a zip with the ticked files and a cover page listing each file and what it is for.
- Unticked files are not in the zip. The original files are not moved or deleted.
- Nothing is sent. The person sends the zip themselves.

## Not verified yet
Effort sizes are the session's guesses. Nothing here was built or run; the Nov 1 session worked from release notes only.
