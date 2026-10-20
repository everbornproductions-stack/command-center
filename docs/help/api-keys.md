---
id: api-keys
title: Adding API keys
summary: Paste a key. Gemini AQ. and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq.
lastUpdatedVersion: 0.4.3
---

# Adding API keys

Open Settings and paste a key. You can also use the guided setup from Settings.

Pasting a key recognizes Gemini auth keys (AQ.) and older AIza keys, plus Claude, ChatGPT, Grok, OpenRouter, and Groq. Gemini is checked on Google's own models list. New keys from Google AI Studio start with AQ. Older standard keys start with AIza. The check uses Google's native route and sends the key in a header, not in the page address.

If Meldmind cannot tell which provider a key is for, it says so and shows a provider picker. Pick the provider, then Save and test. The key is never written to the log.

A green light means the key was accepted. "Key rejected (401)" means the provider refused it. "Could not reach" means a network problem, not a bad key. A rejected key is not treated as connected.

The chips under the chat box list only AIs you have connected. Demo stays there only until a real AI is connected.
