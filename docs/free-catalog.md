# Free AI catalog

Meldmind ships `server/free-catalog.json` and can refresh it once per day from the latest command-center-releases release. The document has `version: 1`, an `updated` date in `YYYY-MM-DD` form, and an `entries` array. Each entry has an id, kind (`app`, `key`, or `local`), label, status (`active` or `retired`), and a short `good` description. Optional fields include an HTTPS `page`, provider and free tier details, or retirement note and replacement id. App installation fields are part of the app release.

Catalog text and ids are bounded and checked before a downloaded copy is saved. Remote entries can add key pages, update a key page or its description, and retire known entries. They cannot add or change executable commands, or install packages. The npm allow-list in `server/free-catalog.js` is limited to `@openai/codex`, `opencode-ai`, `freebuff`, and `@anthropic-ai/claude-code`; changing that allow-list requires an app release. A configured Ed25519 public key requires a valid catalog signature. Without a configured key, a valid catalog is accepted and reported as unsigned.

## Weekly scout publishing

The weekly scout prepares a reviewed JSON catalog using the format above, then uploads it as a release asset named `free-catalog.json` on the latest `command-center-releases` release. The asset URL is `https://github.com/everbornproductions-stack/command-center-releases/releases/latest/download/free-catalog.json`. Keep app install commands and packages in an app release. If signing is enabled, sign the canonical JSON body containing `version`, `updated`, and `entries` with the release signing key and include its base64 Ed25519 signature in `signature`.
