// How big each AI bubble should be. Share of jobs in the last 30 days, from the ledger.
// The busiest grows to 1.6x. An unused one, once anything has run, shrinks to 0.6x.
// With no jobs in the window every bubble stays at 1x.

export const USAGE_MIN = 0.6;
export const USAGE_MAX = 1.6;
export const WORKING_BOOST = 0.15;
export const TINY_BELOW = 0.85;
export const SIZE_MS = 560;
export const WINDOW_DAYS = 30;

const JOB_KINDS = new Set(["call", "image", "search", "credits"]);

export function isUsageJob(entry) {
  return !!entry && JOB_KINDS.has(entry.kind) && !!entry.provider;
}

// Midnight at the start of a 30-day window ending today. Matches the ledger's 30-day series.
export function windowStart(now = Date.now(), days = WINDOW_DAYS) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

export function jobCounts(entries, now = Date.now()) {
  const start = windowStart(now);
  const counts = {};
  for (const e of entries || []) {
    if (!isUsageJob(e) || (Number(e.ts) || 0) < start) continue;
    counts[e.provider] = (counts[e.provider] || 0) + 1;
  }
  return counts;
}

export function usageFromSummary(ledger) {
  const counts = {};
  for (const [id, b] of Object.entries(ledger?.byProvider || {})) counts[id] = Number(b?.calls30) || 0;
  return counts;
}

export function peakCount(counts, ids) {
  let max = 0;
  const list = ids || Object.keys(counts || {});
  for (const id of list) max = Math.max(max, Number(counts?.[id]) || 0);
  return max;
}

export function usageScale(count, peak) {
  const n = Math.max(0, Number(count) || 0);
  const max = Math.max(0, Number(peak) || 0);
  if (max <= 0) return 1;
  return USAGE_MIN + (n / max) * (USAGE_MAX - USAGE_MIN);
}

export function isTiny(scale, peak) {
  if (!(Number(peak) > 0)) return false;
  return scale < TINY_BELOW;
}

export function displayScale(usage, working) {
  return (Number(usage) || 0) + (working ? WORKING_BOOST : 0);
}

export function easeOutCubic(t) {
  const u = Math.min(1, Math.max(0, Number(t) || 0));
  return 1 - (1 - u) ** 3;
}

// t is 0..1 across the transition. Reduced motion jumps to the end.
export function eased(from, to, t, reduced = false) {
  if (reduced) return to;
  const k = easeOutCubic(t);
  return from + (to - from) * k;
}

export function ringPositions(items, { hx, hy, rx, ry, start, end }) {
  return items.map((item, i) => {
    const a = items.length <= 1 ? (start + end) / 2 : start + ((end - start) * i) / (items.length - 1);
    return { ...item, x: hx + rx * Math.cos(a), y: hy + ry * Math.sin(a) };
  });
}

function gapOf(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

export function circlesOverlap(nodes, pad = 8) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const need = (nodes[i].r || 0) + (nodes[j].r || 0) + pad;
      if (gapOf(nodes[i], nodes[j]) + 1e-4 < need) return true;
    }
  }
  return false;
}

function inside(n, width, height, margin) {
  const tail = n.pin ? 0 : (n.tail || 0);
  return n.x - n.r >= margin - 0.2
    && n.x + n.r <= width - margin + 0.2
    && n.y - n.r >= margin - 0.2
    && n.y + n.r + tail <= height - margin + 0.2;
}

// Push circles apart, keep pinned nodes (the hub) put, and shrink everyone together if the
// view is too crowded. Relative sizes stay. Returns copies.
export function layoutBubbles(nodes, { width = 800, height = 340, pad = 8, margin = 8 } = {}) {
  const base = nodes.map((n) => ({ ...n }));
  let fit = 1;
  let placed = base;
  for (let shrink = 0; shrink < 28; shrink++) {
    placed = base.map((n) => ({ ...n, r: n.pin ? n.r : n.r * fit }));
    for (let iter = 0; iter < 48; iter++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i], b = placed[j];
          const need = a.r + b.r + pad;
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d >= need - 1e-4) continue;
          if (d < 1e-4) { dx = (i - j) || 1; dy = 0.25; d = Math.hypot(dx, dy); }
          const ux = dx / d, uy = dy / d;
          const push = (need - d);
          if (a.pin && b.pin) continue;
          if (!a.pin && !b.pin) {
            a.x -= ux * push / 2; a.y -= uy * push / 2;
            b.x += ux * push / 2; b.y += uy * push / 2;
          } else if (a.pin) {
            b.x += ux * push; b.y += uy * push;
          } else {
            a.x -= ux * push; a.y -= uy * push;
          }
          moved = true;
        }
      }
      for (const n of placed) {
        if (n.pin) continue;
        const tail = n.tail || 0;
        const minX = margin + n.r, maxX = width - margin - n.r;
        const minY = margin + n.r, maxY = height - margin - tail - n.r;
        const cx = Math.min(Math.max(minX, maxX), Math.max(Math.min(minX, maxX), n.x));
        const cy = Math.min(Math.max(minY, maxY), Math.max(Math.min(minY, maxY), n.y));
        // If the box is smaller than the circle, pin to the centre of the allowed range.
        const nx = minX > maxX ? (margin + width - margin) / 2 : cx;
        const ny = minY > maxY ? (margin + height - margin) / 2 : cy;
        if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; moved = true; }
      }
      if (!moved) break;
    }
    const ok = !circlesOverlap(placed, pad) && placed.every((n) => n.pin || inside(n, width, height, margin));
    if (ok) return placed.map((n) => ({ ...n, fit }));
    fit *= 0.92;
  }
  return placed.map((n) => ({ ...n, fit }));
}
