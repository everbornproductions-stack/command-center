// Windows UI Automation and other assistive tools see nothing in an Electron window until accessibility is on
// (0.4.21, dogfood 02, 03, 04: the whole window was an empty box to UI Automation, and buttons ignored Invoke until a
// screen reader was switched on by hand). Meldmind turns it on itself:
//   early (before ready): the renderer-accessibility switch, so the first page already has its accessibility tree
//   after ready: app.setAccessibilitySupportEnabled(true), which Electron only accepts once the app is ready
// CC_NO_A11Y=1 turns it off again for anyone who finds the window slower.
function early(app, env = process.env) {
  if (env.CC_NO_A11Y === "1") return false;
  try { app.commandLine?.appendSwitch?.("force-renderer-accessibility"); } catch { /* an older Electron */ }
  return true;
}
function afterReady(app, env = process.env) {
  if (env.CC_NO_A11Y === "1") return false;
  try {
    if (typeof app.setAccessibilitySupportEnabled === "function") { app.setAccessibilitySupportEnabled(true); return true; }
  } catch { /* the switch above still applies */ }
  return false;
}
module.exports = { early, afterReady };
