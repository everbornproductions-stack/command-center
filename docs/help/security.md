---
id: security
title: Security and your data
summary: Keys stay on this PC, the server only answers this computer, and a share link made here only works on this PC.
lastUpdatedVersion: 0.4.9
---

# Security and your data

Your API keys never leave this PC. Windows seals them with DPAPI. On macOS and Linux the desktop app uses the OS keychain. Keys are not logged and are not shown again after you save them. Zero markup: you pay the AI companies directly.

The local server only answers its own window. It binds 127.0.0.1, pins the Host and Origin headers to the loopback address, requires application/json on every write, and issues a fresh session token on each launch. The page sends that token with every API call and as the first WebSocket message. A web page you visit cannot read your console or start work on your keys.

Before sending, SSNs and account numbers are masked. Dates of birth that are labeled as such are masked too. The line under the box names what will be masked.

Nothing is posted, sent, or charged without a click from you. A failed run that cost $0 says Nothing was charged.

A share link made on this PC only works on this PC. The app says so, and offers Copy the text or Export a file if someone else needs it. Costs stay hidden unless you tick the box. Keys are never shown on a share page.

You can type in any language. Meldmind does not train on your prompts.

Help includes this page, Security and your data, plus a one-page security summary PDF. Use the Security summary (PDF) button on the Help page. It downloads meldmind-security.pdf. The file is one page and nothing in it is sent for you.
