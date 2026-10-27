// Photo adjustments (flag_photoeditor, 0.4.19). Pure pixel math shared by the browser editor and the tests.
// It never changes the size of the picture and never moves anything, so faces keep their shape.
// The original photo is not touched: this works on a copy of the pixels.

export const SLIDERS = [
  { id: "light", plain: "Light", expert: "Brightness", hint: "Make the whole photo lighter or darker.", min: -100, max: 100 },
  { id: "exposure", plain: "Exposure", expert: "Exposure", hint: "Like opening or closing the camera lens.", min: -100, max: 100 },
  { id: "contrast", plain: "Contrast", expert: "Contrast", hint: "More or less difference between light and dark.", min: -100, max: 100 },
  { id: "highlights", plain: "Bright parts", expert: "Highlights", hint: "Pull down washed out bright areas, or lift them.", min: -100, max: 100 },
  { id: "shadows", plain: "Dark parts", expert: "Shadows", hint: "Bring back detail in dark areas.", min: -100, max: 100 },
  { id: "ambient", plain: "Room glow", expert: "Ambient light", hint: "Warm glow or cool shade over the scene.", min: -100, max: 100 },
  { id: "warmth", plain: "Warm or cool", expert: "Color grade: temperature", hint: "Shift the colors toward gold or toward blue.", min: -100, max: 100 },
  { id: "tint", plain: "Green or pink", expert: "Color grade: tint", hint: "Shift the colors toward green or toward pink.", min: -100, max: 100 },
  { id: "skin", plain: "Skin tone", expert: "Skin tone", hint: "Warm or cool skin only. Other colors stay as they are.", min: -100, max: 100 },
  { id: "clarity", plain: "Sharp detail", expert: "Clarity", hint: "Crisper texture. Skin is kept soft.", min: -100, max: 100 },
];

export const SLIDER_IDS = SLIDERS.map((s) => s.id);

// Quick moods. Each one is just slider settings, so it can be tuned or undone.
export const PRESETS = [
  { id: "warm-evening", name: "Warm evening", values: { exposure: -8, ambient: 45, warmth: 30, shadows: 15, contrast: 8 } },
  { id: "cool-morning", name: "Cool morning", values: { exposure: 6, ambient: -35, warmth: -28, highlights: -10 } },
  { id: "soft-portrait", name: "Soft portrait", values: { light: 10, contrast: -12, highlights: -15, shadows: 12, skin: 12, clarity: -10 } },
  { id: "crisp-day", name: "Crisp daylight", values: { exposure: 8, contrast: 18, clarity: 28, highlights: -12, shadows: 14 } },
  { id: "moody", name: "Moody", values: { exposure: -18, contrast: 28, shadows: -20, ambient: -12, clarity: 12 } },
  { id: "bright-airy", name: "Bright and airy", values: { light: 22, exposure: 10, contrast: -10, shadows: 28, highlights: -8 } },
  { id: "film-fade", name: "Film fade", values: { contrast: -14, shadows: 22, warmth: 12, tint: -6, ambient: 10 } },
];

export const blankRecipe = () => Object.fromEntries(SLIDER_IDS.map((id) => [id, 0]));

// Keeps only known sliders, as whole numbers inside their range. Anything else is dropped.
export function normalizeRecipe(input) {
  const out = blankRecipe();
  const src = input && typeof input === "object" ? input : {};
  for (const s of SLIDERS) {
    const n = Number(src[s.id]);
    if (Number.isFinite(n)) out[s.id] = Math.max(s.min, Math.min(s.max, Math.round(n)));
  }
  return out;
}

export const isBlank = (recipe) => SLIDER_IDS.every((id) => !normalizeRecipe(recipe)[id]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// How much a pixel looks like skin, 0 to 1. Warm hues, medium color, not too dark.
function skinAmount(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < 0.18 || d < 0.04) return 0;
  const sat = d / max;
  let h;
  if (max === r) h = ((g - b) / d) * 60; else if (max === g) h = (2 + (b - r) / d) * 60; else h = (4 + (r - g) / d) * 60;
  if (h < 0) h += 360;
  const hueW = h >= 350 ? 1 : 1 - smooth(38, 52, h);
  const satW = smooth(0.12, 0.25, sat) * (1 - smooth(0.6, 0.8, sat));
  return hueW * satW * smooth(0.18, 0.35, max);
}

function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
}

// data: RGBA bytes (Uint8ClampedArray or a plain array of numbers). Returns a new Uint8ClampedArray.
export function applyRecipe(data, width, height, recipeIn) {
  const r = normalizeRecipe(recipeIn);
  const out = new Uint8ClampedArray(data.length);
  out.set(data);
  if (isBlank(r)) return out;
  const n = width * height;
  const expo = Math.pow(2, r.exposure / 50);
  const gamma = Math.pow(2, -r.light / 100);
  const contrast = 1 + r.contrast / 100;
  const amb = r.ambient / 100, warm = r.warmth / 100, tint = r.tint / 100, skinS = r.skin / 100;
  const needLuma = r.clarity !== 0;
  const luma = needLuma ? new Float32Array(n) : null;
  const skinMask = needLuma ? new Float32Array(n) : null;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let R = data[p] / 255, G = data[p + 1] / 255, B = data[p + 2] / 255;
    const skin = (skinS !== 0 || needLuma) ? skinAmount(R, G, B) : 0;
    R *= expo; G *= expo; B *= expo;
    if (r.light) { R = Math.pow(clamp01(R), gamma); G = Math.pow(clamp01(G), gamma); B = Math.pow(clamp01(B), gamma); }
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    if (r.highlights) { const k = (r.highlights / 100) * 0.3 * smooth(0.5, 1, L); R += k; G += k; B += k; }
    if (r.shadows) { const k = (r.shadows / 100) * 0.3 * (1 - smooth(0, 0.5, L)); R += k; G += k; B += k; }
    if (r.contrast) { R = (R - 0.5) * contrast + 0.5; G = (G - 0.5) * contrast + 0.5; B = (B - 0.5) * contrast + 0.5; }
    if (amb) { const mid = 0.4 + 0.6 * (1 - Math.abs(L - 0.5) * 2); R += amb * 0.07 * mid; G += amb * 0.02 * mid; B -= amb * 0.07 * mid; R += amb * 0.02; G += amb * 0.02; B += amb * 0.02; }
    if (warm) { R *= 1 + warm * 0.15; B *= 1 - warm * 0.15; }
    if (tint) { G *= 1 - tint * 0.12; R *= 1 + tint * 0.03; B *= 1 + tint * 0.03; }
    if (skinS && skin) { R += skinS * 0.05 * skin; B -= skinS * 0.04 * skin; }
    out[p] = clamp01(R) * 255; out[p + 1] = clamp01(G) * 255; out[p + 2] = clamp01(B) * 255;
    if (needLuma) { luma[i] = 0.2126 * clamp01(R) + 0.7152 * clamp01(G) + 0.0722 * clamp01(B); skinMask[i] = skin; }
  }
  if (needLuma) {
    const radius = Math.max(2, Math.round(Math.min(width, height) / 120));
    const blur = boxBlur(boxBlur(luma, width, height, radius), width, height, radius);
    const gain = r.clarity / 100 * 0.9;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const mid = 1 - Math.abs(luma[i] - 0.5) * 1.6;
      const k = gain * (luma[i] - blur[i]) * Math.max(0.1, mid) * (1 - 0.75 * skinMask[i]);
      const d = k * 255;
      out[p] = out[p] + d; out[p + 1] = out[p + 1] + d; out[p + 2] = out[p + 2] + d;
    }
  }
  return out;
}
