---
id: handoff
title: Two-click handoff
summary: Prepare, then approve. When another AI finishes, the summary shows in the job. When API credits run out, Meldmind answers through your own plan for that AI.
lastUpdatedVersion: 0.4.16
---

# Two-click handoff

A handoff that would post, send, or change something outside Meldmind takes two clicks.

1. The first click prepares it. Publishing shows a preview. A scheduled result that would be sent waits. Send to Grok Bot, or send to the browser helper, starts the job and stops when it needs your OK.
2. The second click approves it. Confirm on the publish preview. Approve and send on a scheduled result. OK, do it when the browser helper asks. A Grok Bot job that needs your approval does not finish the outside action until you approve it.

Nothing posts or sends without that second click. If you are not ready, choose Don't send, No, or leave the preview closed.

The same rule covers an app on this PC. Allow that app first. A send, a buy, or a delete still waits for the second click. While Meldmind is using the app, the banner has Stop. Passwords are not stored. Google Antigravity can take a coding task from Settings, or you can use the manual handoff and paste the reply back yourself.
Putting a prompt in marching orders is not a send. Use this on a weekly prompt fills the box, or opens a builder when that builder is installed. A thumbs up or a thumbs down only records your vote. Nothing posts or sends until you click Send, or approve a later step.

## When you hand a job to another AI

Continue in copies a prompt and opens that AI's own page. Meldmind does not type into the page or read it. The prompt asks that AI to tell Meldmind when it is finished.

You get a notice, and the summary shows in the job. If that AI cannot call back, use Paste result and paste what it wrote. A line that starts with DONE: is enough. It is saved only when you click Save.

If this computer is not connected to the hosted hub, Paste result is the way the summary gets back in. The hub, when it is used, gives the result only to the person who handed off the job, then deletes it.

Get it done can let that job run its ordinary steps without asking. The prompt tells the other AI the permission level. Spending money and a permanent delete still need one tap. Sending a message stays off unless you turn that on. Stop and the activity log stay on. The permission ends when the job ends.

## When an AI runs out of API credits

If an AI runs out of API credits, Meldmind can keep answering through your own plan for that AI. This is on unless you turn it off in Settings: Backup when API credits run out, "When API credits run out, use my subscriptions". When it is off, a chat that runs out of credits stops as before.

Meldmind first tries the usual backups: the same AI through OpenRouter, then the next best AI with credits. A side-by-side column keeps its own AI, so it goes straight to the backup below. When no API is left for that answer, the box does not fail. It says "Out of API credits. Answering through your Claude subscription." (or ChatGPT, Gemini, Grok), shows how long it has been waiting, and tries these in order:

1. Official apps on this PC. If Claude Code, Codex (for ChatGPT), Gemini CLI, or Antigravity is installed and signed in with your own plan, Meldmind asks it the question and the answer fills the box on its own, tagged, for example, "via Claude Code (subscription)". It is asked to answer only, not to change files or run commands. Meldmind never signs in for you and never sees a password. Grok has no official app for this.
2. Website, only if you turned it on. Meldmind opens that AI's website in its own window (you sign in there yourself), types the question after you say OK, and reads the reply. If it cannot, it moves on to step 3.
3. You copy it over. Continue in copies the question and opens that AI's page. Paste it there and send it. The question asks the AI to send its answer back to Meldmind: through the hosted hub when this computer uses one, through the Meldmind tool submit_answer when the AI has tools (Claude Code, Antigravity, or another MCP client connected to Meldmind), and always with a block at the end that starts with MELDMIND ANSWER and the job id.

Meldmind keeps checking until the answer arrives or you click Stop waiting. In the desktop app, when you copy the AI's reply and come back to Meldmind, it reads the clipboard once and uses only the text inside that MELDMIND ANSWER block. Anything else on the clipboard is ignored and not kept. You can also click Paste reply and paste it yourself. Waiting answers survive a restart.

In a council, the answer joins the others when it comes back: it is scored, and the verdict is written again with every answer. If no AI with credits is left to write the verdict, Meldmind shows the answers and says that no AI was available to write the verdict. In side by side, the column fills. In a chat, the answer fills.

You can see each official app's status, turn each one on or off, and open its setup page from Settings, or from the Backup step in first-run setup. Check again looks again after you install or sign in.
