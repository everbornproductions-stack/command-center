// Single-instance lock that survives a hung copy, orphan cleanup, and the window's wait-for-engine backoff (0.4.24).
// Why: a hung or half-dead Meldmind kept the port and sometimes the lock, so new launches either quit silently or
// ran beside a ghost ("port 4747 is busy"), and the window reloaded itself in a loop while the engine was stalled.
// Everything here takes its helpers as arguments so tests can drive it without Electron.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the record the running copy leaves behind: who holds the lock and where its engine listens ----
const recordPath = (userData) => path.join(userData, "instance.json");
function writeRecord(userData, rec) { try { fs.writeFileSync(recordPath(userData), JSON.stringify({ ...rec, at: Date.now() })); } catch {} }
function readRecord(userData) { try { const r = JSON.parse(fs.readFileSync(recordPath(userData), "utf8")); return r && Number.isInteger(r.pid) ? r : null; } catch { return null; } }
function clearRecord(userData, pid) { try { const r = readRecord(userData); if (r && r.pid === pid) fs.unlinkSync(recordPath(userData)); } catch {} }
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === "EPERM"); } }

// Take the lock. If another copy holds it: leave quietly when that copy answers, but take over from one that
// is dead or hung (its engine does not answer three probes in a row), so a ghost can never lock the person out.
async function resolveLock({ requestLock, readRec, alive = isAlive, probe, kill, sleep = sleepMs, log = () => {}, selfPid = process.pid, probes = 3, probeGap = 2500, retries = 6, retryGap = 500 }) {
  if (requestLock()) return true;
  const rec = readRec();
  const retryLock = async () => { for (let i = 0; i < retries; i++) { await sleep(retryGap); if (requestLock()) return true; } return false; };
  if (!rec || rec.pid === selfPid) return false; // an older build without a record: treat it as healthy, as before
  if (!alive(rec.pid)) { log(`lock holder ${rec.pid} is gone; taking over`); return retryLock(); }
  for (let i = 0; i < probes; i++) {
    let ok = false; try { ok = !!(await probe(rec)); } catch {}
    if (ok) return false; // a healthy copy is open: this launch only focuses it
    if (i < probes - 1) await sleep(probeGap);
  }
  log(`lock holder ${rec.pid} does not answer; ending it and taking over`);
  try { await kill([rec.pid]); } catch {}
  return retryLock();
}

// ---- orphans: Meldmind processes of this same install that no live copy owns ----
// procs: [{ pid, ppid, cmd, exe }]. Returns the pids to end. Never touches our own tree, other programs,
// or a copy at another path. A second "main" (no --type=) cannot be legitimate once we hold the lock.
function pickOrphans({ procs, selfPid, execPath }) {
  const norm = (s) => String(s || "").toLowerCase();
  const mine = norm(execPath);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const ours = new Set([selfPid]);
  let grew = true;
  while (grew) { grew = false; for (const p of procs) if (!ours.has(p.pid) && ours.has(p.ppid)) { ours.add(p.pid); grew = true; } }
  const out = [];
  for (const p of procs) {
    if (ours.has(p.pid) || norm(p.exe) !== mine) continue;
    const isMain = !/--type=/.test(p.cmd || "");
    const parentGone = !byPid.has(p.ppid);
    if (isMain || parentGone) out.push(p.pid);
  }
  return out;
}
function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Meldmind*' -or $_.Name -like 'Everborn*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      try { const j = JSON.parse(stdout || "[]"); resolve((Array.isArray(j) ? j : [j]).map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, exe: r.ExecutablePath, cmd: r.CommandLine }))); }
      catch { resolve([]); }
    });
  });
}
function killPids(pids) {
  return Promise.all(pids.map((pid) => new Promise((resolve) => {
    if (process.platform === "win32") execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 10000 }, () => resolve());
    else { try { process.kill(pid, "SIGKILL"); } catch {} resolve(); }
  })));
}
async function reapOrphans({ log = () => {}, list = listProcesses, kill = killPids, selfPid = process.pid, execPath = process.execPath } = {}) {
  let procs = []; try { procs = await list(); } catch {}
  const pids = pickOrphans({ procs, selfPid, execPath });
  if (pids.length) { log(`ending ${pids.length} leftover Meldmind process(es): ${pids.join(", ")}`); await kill(pids); }
  return pids;
}

// ---- the window waits for the engine instead of reloading ----
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000];
// Resolves true as soon as probe() says the engine answers, false after the schedule runs out. onWait(attempt, delay) lets the page say so.
async function waitForEngine({ probe, delays = BACKOFF_MS, sleep = sleepMs, onWait = () => {}, cancelled = () => false }) {
  for (let i = 0; i <= delays.length; i++) {
    if (cancelled()) return false;
    let ok = false; try { ok = !!(await probe()); } catch {}
    if (ok) return true;
    if (i === delays.length) break;
    try { onWait(i + 1, delays[i]); } catch {}
    await sleep(delays[i]);
  }
  return false;
}
// Counts real page loads only. An in-page move (#projects, #liveview) is the person clicking a tab, not a reload.
function createLoadCounter({ limit = 6, windowMs = 60000, now = () => Date.now() } = {}) {
  const loads = [];
  return {
    note({ isMainFrame = true, isSameDocument = false } = {}) {
      if (!isMainFrame || isSameDocument) return { count: loads.length, loop: false };
      const t = now(); loads.push(t); while (loads.length && t - loads[0] > windowMs) loads.shift();
      const loop = loads.length > limit; const count = loads.length;
      if (loop) loads.length = 0;
      return { count, loop };
    },
    reset() { loads.length = 0; },
  };
}

module.exports = { recordPath, writeRecord, readRecord, clearRecord, isAlive, resolveLock, pickOrphans, listProcesses, killPids, reapOrphans, waitForEngine, createLoadCounter, BACKOFF_MS };
