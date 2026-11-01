// 0.4.28 (dogfood, Oct 30 2026): "Update and restart" installed 0.4.27 but nothing started again. The installer ran
// with --force-run, the old copy took 36 s to quit, and no new copy was ever launched (nothing in the log).
// So before quitting for an update the app (1) gives up its one-copy lock at once, so a copy the installer starts is
// never turned away by the copy that is still closing, and (2) leaves a small hidden helper that waits for the
// installer to finish and starts Meldmind only if it is not already running. Windows only; packaged builds only.
const { spawn } = require("node:child_process");

// The PowerShell the helper runs. Pure, so a test can read it.
function relaunchScript(exePath, oldPid) {
  const exe = String(exePath).replace(/'/g, "''");
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$old=${Number(oldPid) || 0}`,
    // wait for this copy to exit (up to 3 minutes)
    "for($i=0;$i -lt 180 -and (Get-Process -Id $old);$i++){Start-Sleep -Seconds 1}",
    // then for the installer to finish (up to 10 minutes)
    "for($i=0;$i -lt 600 -and (Get-Process | Where-Object { $_.ProcessName -like 'Meldmind-Setup*' });$i++){Start-Sleep -Seconds 1}",
    "Start-Sleep -Seconds 4",
    // start it only if no copy is running (the installer's own restart may have worked)
    `if(-not (Get-Process -Name 'Meldmind')){Start-Process -FilePath '${exe}'}`,
  ].join("; ");
}

function startRelaunchHelper({ exePath = process.execPath, pid = process.pid, platform = process.platform, packaged = true, spawnFn = spawn, log = () => {} } = {}) {
  if (platform !== "win32" || !packaged) return false;
  try {
    const child = spawnFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", relaunchScript(exePath, pid)], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref && child.unref();
    log("update: restart helper waiting for the installer");
    return true;
  } catch (e) { log("update: restart helper could not start:", e && e.message); return false; }
}

module.exports = { relaunchScript, startRelaunchHelper };
