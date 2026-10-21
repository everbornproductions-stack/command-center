// One scheduler for background work: model watch, schedules, detection,
// and the other slow checks. Jobs do not each call setInterval.
// pause: true skips the job while the app is idle or on battery.
// pause: "idle" skips only while idle (the on-screen refresh).
// Light mode uses lightEveryMs when that is set, otherwise four times everyMs.

import { perfState } from "./power.js";

export function jobSkipped(job, state) {
  if (!job || !state) return false;
  if (job.pause === true && (state.idle || state.battery)) return true;
  if (job.pause === "idle" && state.idle) return true;
  return false;
}

export function effectiveEvery(job, state) {
  let ms = Math.max(50, Number(job.everyMs) || 15000);
  if (state?.light) {
    const slow = Number(job.lightEveryMs) || ms * 4;
    ms = Math.max(ms, slow);
  }
  return ms;
}

export function createScheduler(opts = {}) {
  const jobs = new Map();
  let timer = null;
  const now = () => (opts.now ? opts.now() : Date.now());
  const state = () => (opts.state ? opts.state() : perfState(now()));
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;

  function arm() {
    if (timer) {
      try { clearTimer(timer); } catch { /* a fake clock has nothing to clear */ }
      timer = null;
    }
    if (!jobs.size) return;
    const t = now();
    const st = state();
    let wait = 30000;
    let runnable = false;
    for (const job of jobs.values()) {
      if (jobSkipped(job, st)) continue;
      runnable = true;
      wait = Math.min(wait, Math.max(0, job.next - t));
    }
    if (!runnable) wait = 5000;
    const handle = setTimer(() => {
      timer = null;
      tick();
    }, wait);
    try { handle?.unref?.(); } catch { /* browser timers have no unref */ }
    timer = handle;
  }

  function tick() {
    const t = now();
    const st = state();
    for (const job of jobs.values()) {
      if (job.next > t) continue;
      if (jobSkipped(job, st)) {
        job.next = t + Math.min(effectiveEvery(job, st), 5000);
        continue;
      }
      job.next = t + effectiveEvery(job, st);
      try {
        const result = job.run();
        if (result && typeof result.then === "function") {
          result.catch((e) => {
            try { console.error(`[scheduler] ${job.id}`, e?.message || e); } catch { /* tests may stub console */ }
          });
        }
      } catch (e) {
        try { console.error(`[scheduler] ${job.id}`, e?.message || e); } catch { /* same */ }
      }
    }
    arm();
  }

  return {
    register(job) {
      if (!job?.id || typeof job.run !== "function") throw new Error("A scheduler job needs an id and a run function.");
      const every = Math.max(50, Number(job.everyMs) || 15000);
      const first = job.firstMs == null ? every : Math.max(0, Number(job.firstMs));
      jobs.set(job.id, { ...job, everyMs: every, next: now() + first });
      arm();
      return () => {
        jobs.delete(job.id);
        arm();
      };
    },
    list() {
      const st = state();
      return [...jobs.values()].map((job) => ({
        id: job.id,
        everyMs: job.everyMs,
        lightEveryMs: job.lightEveryMs || null,
        effectiveMs: effectiveEvery(job, st),
        pause: job.pause === true || job.pause === "idle" ? job.pause : false,
        skipped: jobSkipped(job, st),
      }));
    },
    tick,
    stop() {
      if (timer) {
        try { clearTimer(timer); } catch { /* fake clock */ }
      }
      timer = null;
      jobs.clear();
    },
  };
}

export const scheduler = createScheduler();
