# DONE: panel part (0.4.23 Mac-style GUI)
Builder: Freebuff (MiMo v2.6 Flash Fast), 21:09 to 21:45 PT Oct 26; finished and committed by the lead (watch 0423) Oct 26 11:5x PM PT.
- web/mac/data/panel.js: SECTIONS for Connections, Cost and speed, Safety and approvals, Voice, Memories, Project memory, Look, Alerts, Account. Every row opens a real view, settings focus, feature widget or link.
- web/mac/parts/panel.js: right drawer in #mac-panel, opens on bus "open" {panel:"settings"}, search filter, Escape closes, Simple shows "Settings basics" only, Expert shows all sections.
- web/mac/css/panel.css: 380px glass drawer; colours take the shell tokens (--mac-glass2, --mac-line, --mac-tx, --mac-dim, --mac-acc) with the app colours as fallback (lead edit).
- Test: `node --test test/mac-panel-0423.test.js test/mac-foundation-0423.test.js test/user-facing-words.test.js` 11 pass 0 fail.
