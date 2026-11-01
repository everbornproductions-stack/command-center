# Meldmind 0.4.38: persona ideas committed to this round

Source: past persona ideas sessions (Oct 21, Oct 25 and Oct 27, 2026; files `Meldmind-Persona-Ideas-2026-10-21.md`, `-10-25.md`, `-10-27.md`, kept in Chris's persona-ideas folder, not in this repo). Every persona reaction in them is simulated. This round holds 13 of the 42 past ideas. The first 4 went to `docs/plan-0.4.37.md`; the rest are in `plan-0.4.39.md` and `plan-0.4.40.md`.

Chris's rule (Nov 1, 2026): persona ideas always go into the next build round, never parked as "Proposed". Status of every item below: **Next round (0.4.38)**.

Rules for every item: nothing is sent, posted, signed or bought without a click and a preview. A free path comes first. Anything that spends the person's own AI credit shows the price first. The user's original files are never changed. Client data follows CLAUDE.md (no SSNs, dates of birth, account numbers or passwords in files, git, Drive or Supabase).

How to read "Done when": each check is something a person can see on the screen, in plain words. Each item also needs a test that runs on Windows and Mac CI (real waits, helper processes one at a time).

## 1. Blacked-out copy (effort S to M)
From: Oct 27 session, rank 5. Who asked: Helen, Marcus, Tasha.
What: make a shareable copy of a document with names, addresses, case numbers and account numbers covered by black boxes.
Done when:
- The person drops a document and sees every box Meldmind wants to cover, each with a tick box.
- Unticking a box leaves that text visible; ticking adds it. The person can also add a box by hand.
- The saved copy has the covered text removed from the file itself, not just painted over. Selecting and copying in the saved copy gives nothing under a box.
- The original is the same size and date as before.

## 2. Dates from a document into my calendar (effort S to M)
From: Oct 27 session. Who asked: Leo.
What: drop a syllabus, lease or schedule, see every date found, and add the ticked ones with reminders.
Done when:
- A list shows each date with its words (for example "Mar 3: Midterm"), all ticked.
- Unticking removes a date from the list; "Add to calendar" adds only the ticked ones, each with a reminder.
- Nothing is added until the person presses the button, and a date Meldmind was unsure about is marked "check this".
- It reuses the calendar step from "turn an email into a task", for many dates at once.

## 3. Snap a business card (effort S)
From: Oct 27 session. Who asked: Derek.
What: a photo of a business card becomes a contact and a follow-up email draft.
Done when:
- One photo gives a contact with name, company, phone and email, shown for a check before saving.
- A follow-up email draft and a reminder for tomorrow at 9 AM are offered.
- The email is not sent without a tap. A field it could not read is left empty and marked.

## 4. Find the manual (effort S)
From: Oct 27 session. Who asked: Nadia.
What: type or snap a unit's model plate and get the maker's manual link and the page for an error code.
Done when:
- A typed model number or a photo of the plate gives the maker's manual link and the model name it read.
- Entering an error code shows the page or section for it.
- The result can be saved to a project's notes. Only links are shown; nothing is downloaded from a site the person did not see.

## 5. Coverage in plain words (effort M)
From: Oct 27 session. Who asked: Marcus.
What: drop a policy PDF and get a one-page client handout of what is and is not covered.
Done when:
- The handout has covered, not covered and questions to ask, in plain words, on one page.
- It carries the person's license line from the Business Profile and the words "This is a summary, not your policy."
- It is saved as a PDF in the brand kit. It is separate from "What does this letter mean?", which explains a letter to the user.

## 6. Client approval links (effort M)
From: Oct 21 session, rank 3. Who asked: Jordan, Elena, Kai, Ray.
What: share a finished post, script, site or PDF as a link with Approve and Request changes.
Done when:
- The client opens a link with no account and sees the work plus two buttons: Approve and Request changes (with a notes box).
- The owner sees "Approved" or the client's notes in plain words in the project, and the notes become the next task.
- The link expires and shows nothing from other projects. It builds on the read-only live-share links.

## 7. Client fill-in link (effort M)
From: Oct 27 session, rank 3. Who asked: Jordan, Elena, Tasha.
What: send a client a short form (no account) asking for logo, colours, offers and words to avoid.
Done when:
- The client opens a link and fills a short form; the owner never retypes it.
- The answers land in that client's project memory and brand kit, and the owner sees them first with a "Use these" button.
- The form never asks for passwords, Social Security or card numbers, and says so. Different from approval links (item 6), which review finished work.

## 8. Do this for every row: the rest (effort M)
From: Oct 25 session, rank 1. Partly shipped: real spreadsheets arrived in 0.4.27 and 0.4.28. Who asked: Derek, Jordan, Tasha, Ray, Marco.
What: one plain instruction over a spreadsheet or Google Sheet, with a preview and price first.
Done when:
- The person drops a sheet (or picks a Google Sheet), types one instruction, and sees the first 3 rows done and a price before anything runs.
- After "Go", the whole sheet is filled and saved as a copy to download; the original sheet is unchanged.
- Nothing is sent. Any send stays a separate click that shows the count and a sample.
- A big sheet that would cost a lot says so and waits for a click. It spends the person's own credits only.

## 9. Slide deck maker: the rest (effort M)
From: Oct 25 session, rank 2. Partly shipped: real PowerPoint decks arrived in 0.4.28. Who asked: Nadia, Jordan, Marcus, Kai.
What: turn an answer or file into a deck, outline first, then slides in the brand kit.
Done when:
- "Make slides" on an answer shows an outline the person can edit before any slide is made.
- Slides use the project's brand kit, and each slide has a "Change this slide" box that changes only that slide.
- The deck exports to PowerPoint and PDF, and the PowerPoint opens with no repair message.

## 10. See it where it will live (effort S to M)
From: Oct 25 session, rank 5. Who asked: Kai, Dana, Derek, Elena, Sofia.
What: before posting or sending, show the real look at real size.
Done when:
- The preview can show an Instagram post and reel cover, a YouTube home tile (title cut where YouTube cuts it), a Gmail inbox line with subject and preview text, a phone lock screen for a text, and a Google result.
- Text that would be cut off is marked in the preview.
- It is the same preview step people already click through, with no new choices.

## 11. Use it before it resets (effort S to M)
From: Oct 27 session, rank 2. Who asked: Marco, Leo, Max (developer). Related, not the same as 0.4.30's retry at reset time.
What: when a paid plan's limit resets soon with a lot unused, offer saved or queued jobs to run on that plan for no extra cost.
Done when:
- A friendly line says which plan resets when, and how much is unused.
- A list of saved or queued jobs, each with a tick box, shows what would run on that plan.
- Only ticked jobs run, and the screen says "$0 extra". Nothing runs on a plan with no spare room.

## 12. Test it on pretend customers (effort M)
From: Oct 27 session, rank 1. Who asked: Rin, Dana, Ray, Kai, Elena.
What: drop a page, flyer, post or screen and get first-look notes from five simulated people matching the audience.
Done when:
- The person drops one item and sees a price first, then one card of notes from five people ("Where do I click?", "What is this for?").
- Every note is marked "simulated", and the card says it is not real customer feedback.
- The audience is picked from the Business Profile. The notes can be saved to the project.

## 13. Google Business Profile connection (effort M)
From: Oct 21 session, rank 4. Who asked: Dana, Carla, Ray, Nadia.
What: post weekly updates, reply to Google reviews and answer common questions, all with a preview first.
Done when:
- The person connects their Google Business Profile with a normal Google sign-in; the checklist shows Connected.
- A weekly update post, a review reply (pairing with Review Responder) and a question answer each show a preview before anything is posted.
- Nothing posts without a click, and a post that breaks the Business Profile's never-say list is blocked with a reason.

## Not verified yet
Effort sizes are the sessions' guesses. Nothing here was built or run. A check against the release notes up to v0.4.36 found none of these already shipped except the partly shipped parts noted in items 8 and 9.
