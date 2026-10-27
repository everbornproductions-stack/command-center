# MAC-NEEDS-flow

1. `.gitignore` line 1 is `data/`, which also ignores `web/mac/data/`. Every part's pure-logic file lives there (the contract says so).
   Add this line right after `data/` in `.gitignore`:

       !web/mac/data/

   Until then, files in `web/mac/data/` need `git add -f <named file>` (done for `web/mac/data/flow.js`).
