# Meldmind 0.4.39: persona ideas committed to this round

Source: past persona ideas sessions (Oct 21, Oct 25 and Oct 27, 2026; files `Meldmind-Persona-Ideas-2026-10-21.md`, `-10-25.md`, `-10-27.md`, kept in Chris's persona-ideas folder, not in this repo). Every persona reaction in them is simulated. This round holds 13 of the 42 past ideas. See also `docs/plan-0.4.37.md`, `plan-0.4.38.md` and `plan-0.4.40.md`.

Chris's rule (Nov 1, 2026): persona ideas always go into the next build round, never parked as "Proposed". Status of every item below: **Next round (0.4.39)**.

Rules for every item: nothing is sent, posted, signed or bought without a click and a preview. A free path comes first. Anything that spends the person's own AI credit shows the price first. The user's original files are never changed. Client data follows CLAUDE.md (no SSNs, dates of birth, account numbers or passwords in files, git, Drive or Supabase).

How to read "Done when": each check is something a person can see on the screen, in plain words. Each item also needs a test that runs on Windows and Mac CI (real waits, helper processes one at a time).

## 1. Email Meldmind (effort M)
From: Oct 21 session, rank 5. Who asked: Dorothy, Walt, Derek.
What: each person gets a private address; forward an email or attach a photo and the answer comes back as a reply.
Done when:
- Settings shows the person's private address and a Copy button.
- Forwarding an email or a photo to it gets a reply with the answer, only from addresses the person has allowed.
- A mail from an address not on the list is ignored. The reply never contains saved keys or passwords.
- Running costs of the mail service are listed for Chris before any paid service is turned on.

## 2. Trusted helper (effort M)
From: Oct 21 session. Who asked: Dorothy, Walt, Carla, Nadia.
What: invite a family member or office manager to set things up from their own device while the owner approves.
Done when:
- The owner invites a helper by a link; the helper never sees saved keys.
- The helper's changes (settings, connections) wait as a list of requests; the owner sees each in plain words and taps Approve or No.
- The owner can end the helper's access with one button.

## 3. Bring your GPTs, Gems and Skills (effort M)
From: Oct 25 session, rank 4. Who asked: Priya Natarajan, Max (developer), Marco, Jordan.
What: paste a GPT's or Gem's instructions, or drop a Claude Skill folder, and it becomes an AI employee.
Done when:
- One box says "Paste your GPT or drop a skill". After that, the new AI employee shows in the Agents page and can run on any connected AI.
- A screen lists what was brought in. Scripts inside a skill never run without a click that names the script.
- A skill folder with a key or password inside is refused, like template import.

## 4. Listen on the go (effort M)
From: Oct 25 session. Who asked: Derek, Walt, Leo, Kai.
What: a 2-minute spoken summary, or a short two-voice talk, of any long report or file, saved as an audio file.
Done when:
- "Listen" on a long answer or file makes a summary of about 2 minutes and saves an audio file the person can play on a phone.
- It uses the voices built into the PC first; a paid voice runs only if the person turns it on, and the price is shown first.
- It is separate from read-aloud, which reads the answer word for word.

## 5. Show me where to click (effort M)
From: Oct 25 session. Who asked: Dorothy, Walt, Carla.
What: one look-only picture of the window the person is stuck in, with a plain explanation and an arrow.
Done when:
- One button takes a single picture of the window and shows it with a plain explanation of what it is and where to click, with an arrow drawn on the picture.
- It never clicks, types or opens anything, and the screen says so.
- It stays under the existing $1 desktop-control cap and shows the price before the picture is read.

## 6. Quiz me (effort S to M)
From: Oct 25 session. Who asked: Leo, Marcus, Tasha, Nadia.
What: flashcards and a short quiz from any file, Help article or answer.
Done when:
- "Quiz me" on a file or answer makes flashcards and a short quiz.
- Each card has "Got it" and "Missed it", and the saved progress shows what to repeat next time.
- Every question can show the line of the source it came from.

## 7. Try another way (effort M)
From: Oct 25 session. Who asked: Max (developer), Priya, Jaylen, Elena.
What: from any answer, start a side path that keeps the original.
Done when:
- "Try another way" on an answer starts a second version and keeps the first.
- Arrows switch between versions, and the person can keep going on either.
- It is different from Try again (which replaces the answer) and from Compare.

## 8. Lock a chat (effort S to M)
From: Oct 25 session. Who asked: Helen, Marcus, Tasha.
What: hide chosen chats behind a 4-digit PIN (or Windows Hello where it works).
Done when:
- A locked chat disappears from My chats and search until the person unlocks it.
- Unlocking asks for the PIN (or Windows Hello); three wrong tries wait one minute.
- A forgotten PIN has a clear message about what can and cannot be recovered. It is different from Private mode.

## 9. Test a new model on my real jobs (effort M)
From: Oct 25 session. Who asked: Marco, Max (developer), Priya.
What: when a new model ships, rerun it on the last 10 real jobs and compare with what was used.
Done when:
- The model-watch notice offers "Test it on my last 10 jobs" with the price shown first.
- After the person's OK, a side-by-side shows each job's old and new answer, with cost and speed.
- Nothing switches on its own; "Use this model" is a separate click.

## 10. Use Meldmind from other apps (effort M)
From: Oct 21 session. Who asked: Priya, Leo.
What: a local OpenAI-compatible address so other tools use Meldmind's routing, free-first models and spend caps.
Done when:
- Under More options, an address and a key for this computer only are shown with a Copy button.
- A tool that speaks the OpenAI format can send a question to it and get an answer routed by Meldmind.
- The spend caps and free-first rules still apply, and the address does not answer anyone outside this computer.

## 11. Copy as code (effort S)
From: Oct 27 session. Who asked: Priya (developer), Max (developer). Pairs with item 10.
What: "Copy as code" gives a ready snippet that runs the same job through Meldmind.
Done when:
- On a chat, council or mission setup, under More options, "Copy as code" offers curl, JavaScript and Python snippets.
- A snippet never includes a saved key; it uses the local key from item 10.
- Running the curl snippet gives an answer for the same job.

## 12. Weekly remix challenge (effort M)
From: Oct 21 session. Who asked: Jaylen, Kai, Leo.
What: a themed challenge each week with a gallery and up and down votes.
Done when:
- The Remix area shows this week's theme and a Submit button for the person's own remix.
- A gallery shows the entries with up and down votes, reusing the prompt-library voting.
- Nothing is public until the person presses Submit, and the safety check passes first.

## 13. Memory book (effort M)
From: Oct 27 session. Who asked: Dorothy.
What: one life question a week, answered by voice, that becomes a printable book with photos.
Done when:
- Each week one question is shown in big text and read aloud; the person answers by talking, and the words are saved.
- At any time "Make my book" builds a printable PDF with the answers and chosen photos.
- Everything stays on this computer unless the person chooses to share it.

## Not verified yet
Effort sizes are the sessions' guesses. Nothing here was built or run. A check against the release notes up to v0.4.36 found none of these already shipped.
