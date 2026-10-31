# Weekly prompt packs

Since 0.4.28 the Prompts page shows a **What's new** category first. It holds one week's pack, by ISO week:

- This week's pack when there is one (rows whose `added_week` is this week).
- Otherwise the newest earlier pack, and the category says which week it is from. It is never empty while any pack exists.
- A pack dated for a later week stays hidden (What's new, the categories, the suggestions and the dropdown) until the Monday of its week. So next week's pack can ship early and it rolls over by itself.

Every pack prompt is also filed into its normal category (Sales and Follow-up, Marketing and Content, Creative, and so on) and stays there after its week ends, so the categories keep growing. The pack `category` decides the shelf (`PACK_SHELF` in `server/prompts/whatsnew.js`). A prompt that repeats one already in that category (same id or a near-duplicate title) is filed once.

## Where packs come from

1. Bundled JSON in `server/prompts/packs/` (`week-YYYY-wNN.json` plus the Builders, video and photo effects packs). These ship with each release.
2. Rows in the Supabase `prompt_packs` table, read by `server/prompts/cloud.js` when the hub answers. Same columns as the JSON. A cloud row can add a prompt between releases.

## Adding next week's pack

1. Write 10 to 15 prompts in a text file, one per line: `Title | category | text`. Leave the category empty (`Title | | text`) and it is worked out from the words. A JSON list of `{ "title", "text", "category", "note", "source_name", "source_url" }` works too.
2. Run `node tools/new-week-pack.mjs --next --in prompts.txt` (the week after the newest `week-*.json`), or pass `--week 2026-W46`. Add `--check` to validate without writing.
3. Run `node --test test/prompts-whatsnew-0428.test.js test/prompt-votes.test.js`, commit the new `server/prompts/packs/week-YYYY-wNN.json`, and ship it with the next release. Adding it a week or two early is fine.

The tool refuses a pack when a category is not one of the pack categories, a prompt has no `[blank]`, a title repeats, a line has a long dash, a line promises a result (guaranteed, overnight, go viral and so on), a source link is not https, or the file already exists (pass `--force` to replace it).

Style: plain words, short, one task per prompt, a `[blank]` for every fact the person supplies, "Draft only" on anything that could be sent or posted, and no brand names unless the prompt needs them.
