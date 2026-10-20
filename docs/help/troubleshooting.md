---
id: troubleshooting
title: Antivirus and SmartScreen
summary: Unsigned installer warning. SmartScreen: More info, then Run anyway.
lastUpdatedVersion: 0.4.3
---

# Antivirus and SmartScreen

The Windows installer is unsigned. SmartScreen may warn the first time you open it. Choose More info, then Run anyway.

Some antivirus tools show the same kind of warning for an unsigned installer. If the setup file is blocked, allow Meldmind in that tool and run the installer again. After the first install, updates do not show the SmartScreen prompt again.

Other messages:

- "Key rejected (401)": the provider refused the key. Make a new one and paste it again.
- Out of credits is no longer shown as Key rejected. A spending limit or an empty balance says to top up, and the key stays saved. For Grok, top up at https://console.x.ai.
- Tap to talk works in the desktop app. It transcribes with an OpenAI, Groq, ElevenLabs, or Gemini key, and it names the key to add when none is saved. While that runs the status says Transcribing. If a take ends with no words, it says No speech heard.
- "Could not reach": a network problem. Check the connection, then try the same action again.
- "This phone cannot reach the PC": use the same Wi-Fi, turn on phone pairing in Settings, under Phone and other devices, and allow Meldmind on private networks in Windows Firewall.
- The engine panel after a long wait: Restart engine, Check for updates, or Keep waiting. Your keys and history stay on this computer.
- Out of credits, a spending limit, or a rate limit pauses that AI. The strip says Paused: no credits, with a billing link. Auto-picks skip it until a health check clears it or you save the key again. A pinned chat says the AI is paused and names the billing page.
- After a run, one upgrade tip can name an AI that usually does that task better, with a link to add credits or a key. Tips stay off during a run. At most one tip per AI per task type each week. Nothing is sent.
