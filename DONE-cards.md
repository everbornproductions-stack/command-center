# DONE: cards part (0.4.23 Mac-style GUI)

## What was built:
1. **web/mac/data/cards.js**: Pure data and logic for 5 paths (`website`, `image`, `video`, `campaign`, `remix`). Each path includes 6 to 8 presets with unique gradient art, prompt templates, description hints, finish button labels, and exactly one popular style marked (`popular: true`). The name holds only the style name (no `Most popular: ` prefix glued on front). Exports pure helpers: `pageOf`, `nextIndex`, `dotsFor`.
2. **web/mac/css/cards.css**: Glassmorphic card carousel styling, track sliding animation, card states (`.sel`), gradient styles (`g1` to `g8`), and dot pagination indicators scoped under `body[data-style="mac"]`, plus the `.badge` pill that sits on the art of the popular card.
3. **web/mac/parts/cards.js**: Part implementation and `mountCards(container, { path, onPick, mode })` helper supporting pointer drag/swipe, horizontal trackpad wheel, left/right arrow keys, dot navigation, click selection, pre-selected popular style, a separate `<span class="badge">Most popular</span>` inside the card whose style has `popular: true`, Enter confirmation, and registration on `CC.mac.cards`.
4. **test/mac-cards-0423.test.js**: Comprehensive test suite covering data structure validation, pure logic functions (`pageOf`, `nextIndex`, `dotsFor`), and real-browser interactions (popular check via `styles[popularIdx].popular === true`, `.badge` text `Most popular`, ArrowRight navigation, Enter picking the style at index 3 after `picked` is reset, and the dot count compared with `dotsFor(cardCount, perPage)` for the `perPage` the part uses, which is 1).

## Test Command & Results:
`node --test test/mac-cards-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js`
- Pass: 8 suites/tests (mac-cards 3, mac-foundation 3, user-facing-words 2)
- Fail: 0
- Cards files carry no en or em dashes; full suite failures seen here (libraries, models, project files) reproduce with these files reverted and are not from this part.
