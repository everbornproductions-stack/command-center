// fal.ai queue API: one key for many models (Kling, Flux, Veo, Luma...). Authorization: Key <FAL_KEY>.
export const id = "fal";
export const name = "fal.ai";
export const kinds = ["video", "image"];
export const price = { "fal-ai/kling-video/v2.5-turbo/pro/image-to-video": 0.07, "fal-ai/kling-video/v3/pro/text-to-video": 0.112, "fal-ai/flux/dev": 0.025, "fal-ai/flux-pro/v1.1": 0.04, default: 0.1 }; // USD per second (video) or per image
export const defaults = { video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", image: "fal-ai/flux/dev", duration: 5 };

export function estimate(params) {
  const model = params.model || (params.kind === "image" ? defaults.image : defaults.video);
  if (params.kind === "image" || /flux|image/.test(model) && !/video/.test(model)) return { usd: price[model] || 0.04, note: `1 image · ${model}` };
  const d = Number(params.duration) || defaults.duration; const rate = price[model] || price.default;
  return { seconds: d, usd: +(d * rate).toFixed(3), note: `${d}s × $${rate}/s (${model})` };
}

export async function start(secret, params) {
  const model = params.model || (params.kind === "image" ? defaults.image : defaults.video);
  const input = params.kind === "image" ? { prompt: params.prompt, image_size: params.size || "portrait_16_9" } : { prompt: params.prompt, duration: String(params.duration || defaults.duration), aspect_ratio: params.aspect || "9:16", ...(params.imageUrl ? { image_url: params.imageUrl } : {}) };
  const r = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: { authorization: `Key ${secret.key}`, "content-type": "application/json" }, body: JSON.stringify(input) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`fal ${r.status}: ${j.detail || JSON.stringify(j).slice(0, 200)}`);
  return { taskId: j.request_id, pollPath: `https://queue.fal.run/${model}/requests/${j.request_id}` };
}

export async function poll(secret, job) {
  const s = await fetch(`${job.pollPath}/status`, { headers: { authorization: `Key ${secret.key}` } });
  const sj = await s.json().catch(() => ({}));
  if (sj.status === "COMPLETED") {
    const r = await fetch(job.pollPath, { headers: { authorization: `Key ${secret.key}` } }); const j = await r.json().catch(() => ({}));
    const urls = [j.video?.url, ...(j.images || []).map((i) => i.url)].filter(Boolean);
    return { done: true, urls };
  }
  if (sj.status === "FAILED") return { done: true, error: "fal request failed" };
  return { done: false, status: sj.status };
}

export async function balance(secret) {
  const r = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", { headers: { authorization: `Key ${secret.key}` } });
  const j = await r.json().catch(() => ({})); return r.ok ? { usd: j.credits?.current_balance ?? null } : null;
}
