// Kling Open Platform adapter. Auth: JWT (HS256) signed with the secret key, issuer = access key.
// Endpoints per Kling docs (2025–2026): POST /v1/videos/text2video | image2video, GET /v1/videos/<kind>/{task_id}.
import crypto from "node:crypto";

export const id = "kling";
export const name = "Kling AI";
export const kinds = ["video"];
// approximate direct-API pricing in USD per second of output (resource packs; see docs/provider-api-research)
export const price = { "kling-v2-5-turbo": 0.07, "kling-v3": 0.112, "kling-v3-audio": 0.168, default: 0.112 };
export const defaults = { model: "kling-v2-5-turbo", duration: 5, aspect: "9:16", mode: "std" };

const BASE = process.env.KLING_API_BASE || "https://api-singapore.klingai.com";

const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function token(secret) {
  const ak = secret.key, sk = secret.secret;
  if (!ak || !sk) throw new Error("Kling needs both an access key and a secret key");
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }));
  const sig = b64u(crypto.createHmac("sha256", sk).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function estimate(params) {
  const d = Number(params.duration) || defaults.duration;
  const rate = price[params.model || defaults.model] || price.default; // priced as the model start() will run
  return { seconds: d, usd: +(d * rate).toFixed(3), credits: Math.round(d * 10), note: `${d}s × $${rate}/s (direct-API resource-pack rate; consumer plan credits ≈ ${Math.round(d * 10)})` };
}

export async function start(secret, params) {
  const image = params.imageUrl;
  const path = image ? "/v1/videos/image2video" : "/v1/videos/text2video";
  const body = { model_name: params.model || defaults.model, prompt: params.prompt, negative_prompt: params.negative || undefined, duration: String(params.duration || defaults.duration), aspect_ratio: params.aspect || defaults.aspect, mode: params.mode || defaults.mode, ...(image ? { image } : {}) };
  const r = await fetch(BASE + path, { method: "POST", headers: { authorization: `Bearer ${token(secret)}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== 0) throw new Error(`Kling ${r.status}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return { taskId: j.data.task_id, pollPath: `${path}/${j.data.task_id}` };
}

export async function poll(secret, job) {
  const r = await fetch(BASE + job.pollPath, { headers: { authorization: `Bearer ${token(secret)}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Kling poll ${r.status}`);
  const st = j.data?.task_status; // submitted | processing | succeed | failed
  if (st === "succeed") return { done: true, urls: (j.data.task_result?.videos || []).map((v) => v.url), raw: j.data };
  if (st === "failed") return { done: true, error: j.data.task_status_msg || "Kling task failed" };
  return { done: false, status: st };
}
