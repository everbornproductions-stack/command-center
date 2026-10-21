// Budgets for the Stay light workstream. The numbers are the baseline
// measured on main (v0.4.8) and written up in docs/PERFORMANCE.md.
// The installer may grow 15% from that file. Idle RAM may not pass the cap.

export const BASELINE = {
  measuredAt: "2026-10-21",
  version: "0.4.8",
  installerName: "Meldmind-Setup-0.4.8.exe",
  installerBytes: 112077608,
  // Unpacked Linux app from electron-builder --linux dir. The Windows
  // installer is the compressed file above. This agent did not build the
  // Windows unpack.
  installBytes: 305198150,
  // Electron on Linux under Xvfb: six processes, RSS summed, GPU on.
  idleRamBytes: 743976 * 1024,
  // node server/index.js only, after a short idle.
  engineRamBytes: 100112 * 1024,
  coldStartMs: 470,
  windowMs: 753,
  engineColdStartMs: 224,
};

export const INSTALLER_GROWTH = 0.15;
// Headroom over the measured 727 MiB so a noisy sample does not fail,
// and a heavy tool pulled into startup still does.
export const IDLE_RAM_BUDGET = 900 * 1024 * 1024;
// The engine process alone. Measured near 98 MiB.
export const ENGINE_RAM_BUDGET = 300 * 1024 * 1024;

export function installerCap(baseline = BASELINE.installerBytes) {
  return Math.floor(Number(baseline) * (1 + INSTALLER_GROWTH));
}

export function installerWithinBudget(bytes, baseline = BASELINE.installerBytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return false;
  return n <= installerCap(baseline);
}

export function idleRamOk(bytes, budget = IDLE_RAM_BUDGET) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return false;
  return n <= budget;
}
