# Meldmind 0.4.37: persona ideas committed to this round

Sources: the Nov 1, 2026 persona ideas session (8 items, carried over from `docs/plan-0.4.36.md`) and four of the 42 past persona ideas from the Oct 21, Oct 25 and Oct 27, 2026 sessions (files `Meldmind-Persona-Ideas-2026-10-21.md`, `-10-25.md`, `-10-27.md`, kept in Chris's persona-ideas folder, not in this repo). Every persona reaction in them is simulated.

Chris's rule (Nov 1, 2026): persona ideas always go into the NEXT build round. They are never parked as "Proposed". Status of every item below: **Next round (0.4.37)**.

Why this file exists: v0.4.36 shipped on Nov 1, 2026 (tag v0.4.36) without the 8 Nov 1 ideas, so they moved from the 0.4.36 plan to this round. The rest of the past ideas are spread over 0.4.38, 0.4.39 and 0.4.40 (`docs/plan-0.4.38.md` and the two after it) so no round holds more than about 12 to 13 new items.

Rules for every item: nothing is sent, posted, signed or bought without a click and a preview. A free path comes first. Anything that spends the person's own AI credit shows the price first. The user's original files are never changed. Client data follows CLAUDE.md (no SSNs, dates of birth, account numbers or passwords in files, git, Drive or Supabase).

How to read "Done when": each check is something a person can see on the screen, in plain words. Each item also needs a test that runs on Windows and Mac CI (real waits, helper processes one at a time).

## Carried over from the Nov 1 session (12 items in this round: 8 below plus 4 new)

The full "Done when" checks for these eight stay in `docs/plan-0.4.36.md` (items 1 to 8), unchanged, so there is one copy to edit. Their status is now **Next round (0.4.37)**.

| # | Idea | Effort | Checks in |
|---|---|---|---|
| 1 | Change my file | M | plan-0.4.36.md item 1 |
| 2 | Paper to spreadsheet | S | plan-0.4.36.md item 2 |
| 3 | Same job for every client | M | plan-0.4.36.md item 3 |
| 4 | Try a script safely first | S to M | plan-0.4.36.md item 4 |
| 5 | Fill my form | S to M | plan-0.4.36.md item 5 |
| 6 | Check my spreadsheet | M | plan-0.4.36.md item 6 |
| 7 | Clip finder | M to L | plan-0.4.36.md item 7 |
| 8 | Client hand-off folder | S | plan-0.4.36.md item 8 |

## New in this round: from past sessions

Chosen first because they are small, help the least technical people most, and need no new paid service.

## 9. "What does this letter mean?" (effort S to M)
From: Oct 21 session, rank 1. Who asked: Dorothy, Walt, Carla, Tasha, Helen.
What: snap or drop a bill, notice or letter and get a plain-words explanation, the due date and amount, a reminder, and a draft reply.
Done when:
- One photo or file in gives three plain answers: what it says, what is due and when (with the amount), and what to do next.
- "Remind me" saves a local reminder for the due date; nothing is added to Google Calendar without a click.
- "Draft a reply" shows the reply for approval. Nothing is sent.
- Every answer ends with "This is not legal or tax advice. Ask a professional." If the due date is unclear, it says so instead of guessing.

## 10. Undo after sending (effort S)
From: Oct 21 session, rank 2. Who asked: Marcus, Dana, Carla, Helen.
What: a 10-second Undo bar after any email, post or message Meldmind sends, like Gmail's undo send.
Done when:
- After a send or post, a bar shows "Sent. Undo" with a countdown of 10 seconds.
- Pressing Undo inside the 10 seconds means the message or post is not sent (or is taken down), and the screen says so.
- After 10 seconds the bar goes away and the send goes through. A send that cannot be taken back says "Cannot be undone" before the click, not after.
- It needs no setting to turn on.

## 11. "Is this a scam?" check (effort S)
From: Oct 25 session, rank 3. Who asked: Walt, Carla, Helen, Dorothy.
What: paste, forward or snap a photo of a text, email, voicemail or website and get a plain verdict.
Done when:
- One box or one photo gives one big answer: Looks OK, Be careful, or Likely a scam.
- The warning signs are listed in plain words, followed by what to do next.
- It never opens a link, calls a number or replies. The screen says so.
- It is separate from the letter explainer (item 9): this one checks whether the message is real.

## 12. Walk me through it (effort S)
From: Oct 27 session, rank 4. Who asked: Walt, Dorothy, Carla.
What: any how-to answer shown one step per screen, with big text and read-aloud.
Done when:
- A how-to answer (a recipe, a printer setup, a garden job) has a "Walk me through it" button that shows step 1 alone, in big text.
- A big Next button, or saying "next", moves on; "Go back" works at any step.
- Each step can be read aloud, and the last step says "All done".
- The full answer is still there when the button is not used.

## Not verified yet
Effort sizes are the sessions' guesses. Nothing here was built or run. A check against the release notes up to v0.4.36 found none of items 9 to 12 already shipped.
