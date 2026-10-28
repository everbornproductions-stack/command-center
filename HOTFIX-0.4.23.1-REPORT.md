# Hotfix 0.4.23.1 report

## Default-on + version

- Mac-style GUI is on by default (Chris, Oct 27: "it should come out switched on"). `macOn()` in web/mac/index.js: on unless `?mac=0`, localStorage `cc.mac = "0"` or setting `uiStyle = "classic"`. `?mac=1`, `cc.mac = "1"` and `uiStyle = "mac"` still turn it on.
- Tests: mac-foundation-0423 now checks default-on, and a new test checks all three ways to turn it off. `bootPage` pins `cc.mac = "0"` for classic-layout tests unless a choice is stored; `mac: "default"` boots like a new user. Locally, 218 of 218 browser tests pass.
- Version is 0.4.24 (package.json, package-lock.json, help catalog and article, version-pin tests, bundled guide PDF rebuilt). What's new and release notes have a 0.4.24 entry. The ships-as-0.4.24 patch is not tagged or merged.
- Windows CI on the PR: run 40616292785 failed (version pins and What's new), run 40619491651 failed (What's new entry missing), run 40621869398 green. This report and the lessons entry went in the next push.
- Not done: no merge, no tag, no Mac build. The data folder was not read.
