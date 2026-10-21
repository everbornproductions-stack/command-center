// Original level maker for Remix.
// The idea is the one called wave function collapse. Maxim Gumin's project is MIT
// (checked 2026-10-21). This file does not copy that project, and it does not use its pictures.

export const WFC_LICENSE = "MIT";
export const WFC_NOTE = "New levels use original code in this app. The idea is wave function collapse (Maxim Gumin, MIT). That project's pictures are not used.";

const TILES = [
  { id: "sky", edges: ["air", "air", "air", "air"] },
  { id: "grass", edges: ["air", "grass", "earth", "grass"] },
  { id: "dirt", edges: ["earth", "earth", "earth", "earth"] },
  { id: "water", edges: ["grass", "water", "water", "water"] },
];

const OPP = [2, 3, 0, 1];
const STEP = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function fits(a, dir, b) {
  return a.edges[dir] === b.edges[OPP[dir]];
}

function once(width, height, rng) {
  const opts = Array.from({ length: height }, () => Array.from({ length: width }, () => TILES.map((_, i) => i)));
  const stack = [];
  const ban = (x, y, index) => {
    const list = opts[y][x];
    const at = list.indexOf(index);
    if (at < 0) return;
    list.splice(at, 1);
    stack.push([x, y]);
  };
  const propagate = () => {
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!opts[y][x].length) return false;
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + STEP[dir][0];
        const ny = y + STEP[dir][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        for (const ni of [...opts[ny][nx]]) {
          const ok = opts[y][x].some((i) => fits(TILES[i], dir, TILES[ni]));
          if (!ok) ban(nx, ny, ni);
        }
      }
    }
    return true;
  };
  while (true) {
    let best = null;
    let bestN = Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const n = opts[y][x].length;
        if (n === 0) return null;
        if (n > 1 && n < bestN) { bestN = n; best = [x, y]; }
      }
    }
    if (!best) break;
    const [x, y] = best;
    const choices = opts[y][x];
    const pick = choices[rng() % choices.length];
    for (const i of [...choices]) if (i !== pick) ban(x, y, i);
    if (!propagate()) return null;
  }
  return opts.map((row) => row.map((cell) => TILES[cell[0]].id));
}

export function makeLevel({ width = 8, height = 8, seed = 1 } = {}) {
  const w = Math.max(4, Math.min(16, Number(width) || 8));
  const h = Math.max(4, Math.min(16, Number(height) || 8));
  const base = (Number(seed) >>> 0) || 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rows = once(w, h, mulberry32(base + attempt));
    if (!rows) continue;
    return { ok: true, width: w, height: h, seed: base, rows, note: WFC_NOTE, license: WFC_LICENSE };
  }
  return { ok: false, error: "Could not make a level. Try again.", note: WFC_NOTE, license: WFC_LICENSE };
}
