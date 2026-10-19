// Runway API (api.dev.runwayml.com). Bearer key + X-Runway-Version header. 1 credit = $0.01.
export const id = "runway";
export const name = "Runway";
export const kinds = ["video", "image"];
export const price = { "gen4_turbo": 0.05, "gen4.5": 0.12, "veo3.1": 0.40, "gen4_image_turbo": 0.02, default: 0.05 }; // USD per second (video) or per image
export const defaults = { model: "gen4_turbo", duration: 5, ratio: "720:1280" };
const BASE = "https://api.dev.runwayml.com/v1";
const H = (key) => ({ authorization: `Bearer ${key}`, "content-type": "application/json", "X-Runway-Version": "2024-11-06" });

export function estimate(params) {
  const model = params.model || defaults.model;
  if (params.kind === "image" || model.includes("image")) return { usd: price[model] || 0.02, credits: Math.round((price[model] || 0.02) * 100), note: `1 image · ${model}` };
  const d = Number(params.duration) || defaults.duration; const rate = price[model] || price.default;
  return { seconds: d, usd: +(d * rate).toFixed(3), credits: Math.round(d * rate * 100), note: `${d}s × $${rate}/s (${model}; ${Math.round(rate * 100)} credits/s)` };
}

export async function start(secret, params) {
  const model = params.model || defaults.model;
  if (params.kind === "image" || model.includes("image")) {
    const r = await fetch(`${BASE}/text_to_image`, { method: "POST", headers: H(secret.key), body: JSON.stringify({ model: "gen4_image_turbo", promptText: params.prompt, ratio: params.ratio || "1080:1920", ...(params.imageUrl ? { referenceImages: [{ uri: params.imageUrl }] } : {}) }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Runway ${r.status}: ${j.error || JSON.stringify(j).slice(0, 200)}`);
    return { taskId: j.id, pollPath: `/tasks/${j.id}` };
  }
  if (!params.imageUrl) throw new Error("Runway video needs a first-frame image URL (imageUrl)");
  const r = await fetch(`${BASE}/image_to_video`, { method: "POST", headers: H(secret.key), body: JSON.stringify({ model, promptImage: params.imageUrl, promptText: params.prompt, duration: Number(params.duration) || defaults.duration, ratio: params.ratio || defaults.ratio }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Runway ${r.status}: ${j.error || JSON.stringify(j).slice(0, 200)}`);
  return { taskId: j.id, pollPath: `/tasks/${j.id}` };
}

export async function poll(secret, job) {
  const r = await fetch(BASE + job.pollPath, { headers: H(secret.key) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Runway poll ${r.status}`);
  if (j.status === "SUCCEEDED") return { done: true, urls: j.output || [] };
  if (j.status === "FAILED") return { done: true, error: j.failure || "Runway task failed" };
  return { done: false, status: j.status, progress: j.progress };
}

export async function balance(secret) {
  const r = await fetch(`${BASE}/organization`, { headers: H(secret.key) });
  const j = await r.json().catch(() => ({})); return r.ok ? { credits: j.creditBalance, usd: j.creditBalance != null ? j.creditBalance / 100 : null } : null;
}
