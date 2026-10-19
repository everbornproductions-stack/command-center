# Meldmind (repo: command-center)

**Read docs/DECISIONS.md first.** It lists locked decisions that Chris approved and that are already shipped. Never revert or rework them. If a phase conflicts with one, write `PHASE N BLOCKED: <reason>` in docs/BUILD-LOG.md instead of changing it.

- Build plan: docs/BUILD-PLAN.md. Progress: docs/BUILD-LOG.md. Releases: docs/RELEASING.md.
- Tests: `npm test` (node --test) and `npm run smoke`. Both must pass before any commit.
- Rules: no deploy, never touch Square or billing, no real API keys, never read or commit `data\`, nothing posts or sends without a click, no em-dashes in user-facing text.
