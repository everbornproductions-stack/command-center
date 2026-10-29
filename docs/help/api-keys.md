---
id: api-keys
title: Adding API keys
summary: Paste a key. Gemini AQ. and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq.
lastUpdatedVersion: 0.4.25
---

# Adding API keys

Open Settings and paste a key. You can also use the guided setup from Settings.

Pasting a key recognizes Gemini auth keys (AQ.) and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq. Gemini is checked on Google's own models list. New keys from Google AI Studio start with AQ. Older standard keys start with AIza. The check uses Google's native route and sends the key in a header, not in the page address.

If Meldmind cannot tell which provider a key is for, it says so and shows a provider picker. Pick the provider, then Save and test. The key is never written to the log.

A green light means the key was accepted. "Key rejected (401)" means the provider refused it. "Could not reach" means a network problem, not a bad key. A rejected key is not treated as connected.

Out of credits is no longer shown as Key rejected. A spending limit, a quota, or an empty balance says to top up, and the key stays saved. Payment required and rate limited keep the key too, because the key itself is valid. For Grok, top up at https://console.x.ai.

Tap to talk in the desktop app uses one of those keys to transcribe: OpenAI, Groq, ElevenLabs, or Gemini. It names the key to add when none is saved.

The chips under the chat box list only AIs you have connected. Demo stays there only until a real AI is connected.

Each provider shows how it connects: No key, Not connected, Handoff, or Local app. No key is only for a real API key. Not connected, with a Connect button, is for sign-in or MCP. Handoff is for a site you open yourself. Local app is for an app on this PC, such as Cursor.

CapCut connects with its MCP sign-in, not an API key. The strip says Not connected until you Connect, then Connected. CapCut lists that MCP as available outside the US, with US access coming soon. If it cannot connect, the card says that instead of an error.

Set a provider to Free, Paid, or Unknown. Simple mode can prefer free AIs when quality is similar. You can turn that off under Free AIs and upgrade tips.

## Voice keys and paid voice (0.4.25)

Voice typing asks for a free Groq or Gemini key first. Spoken replies and Instant voice only use a paid voice key (OpenAI or ElevenLabs) when you turn on paid voice in Settings. With paid voice off, the built-in voice speaks the answer. If the Mic or a Generate button needs a key, a short line under it says which key to add.
