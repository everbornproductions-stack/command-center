# DONE: shell part (0.4.23 Mac-style GUI)
Builder: Freebuff (MiMo v2.6 Flash Fast), 20:45 to 21:25 PT Oct 26; work was left uncommitted, reviewed and committed by the lead (watch 0423) Oct 26 ~11:55 PM PT.
- web/mac/parts/shell.js: #mac-root with slots #mac-titlebar, #mac-side, #mac-main, #mac-flow, #mac-dock, #mac-launchpad, #mac-panel; title bar (traffic lights aria-hidden, sidebar button, title + crumb, ready pill, Simple/Expert switch that clicks #mode-simple/#mode-expert, mode banner, theme button stored in cc.mac.theme, Help). Watches body data-ui/data-view with MutationObservers (attribute filters only) plus a 1 s tick, emits bus "mode"/"view".
- web/mac/css/shell.css: tokens for light and dark, reframed #app window, glass with .mac-noblur fallback, old top bar hidden only in Mac style.
- web/mac/data/shell.js: readyLine, crumbFor, modeBanner.
- Test: `node --test test/mac-shell-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js` 13 pass 0 fail (includes ?mac=0 leaves nothing, real mode switch, theme, crumb "Projects", Escape closes side).
