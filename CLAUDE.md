# Meldmind (repo: command-center)

**Read docs/DECISIONS.md first.** It lists locked decisions that Chris approved and that are already shipped. Never revert or rework them. If a phase conflicts with one, write `PHASE N BLOCKED: <reason>` in docs/BUILD-LOG.md instead of changing it.

- Build plan: docs/BUILD-PLAN.md. Progress: docs/BUILD-LOG.md. Releases: docs/RELEASING.md.
- Tests: `npm test` (node --test) and `npm run smoke`. Both must pass before any commit.
- Rules: no deploy, never touch Stripe or billing, no real API keys, never read or commit `data\`, nothing posts or sends without a click, no em-dashes in user-facing text.

## Close what you open (standing rule, Chris 2026-11-12)
Close every browser tab or window, terminal, dev/preview server, background process and app you open as soon as its step is done, not only at task end. Never leave one open for Chris; give him the URL or command instead. Keep one only for unsaved input, an upload/checkout in progress, or if Chris said to leave it. Before finishing, list what is still open, close what you started, and report it. Never close what Chris opened. Full rule: ~/.claude/CLAUDE.md.
