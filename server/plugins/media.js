// Media actions: generate video, image and voice through the providers' APIs from inside the console,
// estimate first, log the credits, save outputs into the project folder. Without a key for a provider,
// jobs run as dry runs (estimate + placeholder) so the flow can be tried and demoed.
import fs from "node:fs";
import path from "node:path";
import * as kling from "../media/kling.js";
import * as elevenlabs from "../media/elevenlabs.js";
import * as runway from "../media/runway.js";
import * as fal from "../media/fal.js";

export const id = "media";
const ADAPTERS = { kling, elevenlabs, runway, fal };
const JOBS = "media.jobs";
let H = null;
export async function init(h) { H = h; }

function keyFor(h, pid) { return h.getSecret(pid, pid === "kling" ? "KLING_ACCESS_KEY" : pid === "elevenlabs" ? "ELEVENLABS_API_KEY" : pid === "runway" ? "RUNWAY_API_KEY" : "FAL_KEY"); }

function outDir(h, projectId) {
  const d = path.join(h.DATA_DIR, "projects", (projectId || "unfiled").replace(/[^a-z0-9-_]/gi, "_"), "media");
  fs.mkdirSync(d, { recursive: true }); return d;
}

async function saveOutput(h, job, out) {
  if (h.HOSTED) { job.outputs = out.urls || []; return; } // hosted: keep provider URLs (object storage comes with the hub's R2 step)
  const dir = outDir(h, job.projectId);
  const outputs = [];
  if (out.bytes) { const f = path.join(dir, `${job.id}.${out.ext || "bin"}`); fs.writeFileSync(f, out.bytes); outputs.push(f); }
  for (const [i, u] of (out.urls || []).entries()) {
    try { const r = await fetch(u); const ext = (u.split("?")[0].match(/\.(mp4|mov|webm|png|jpg|jpeg|webp|mp3|wav)$/i) || [, job.kind === "video" ? "mp4" : job.kind === "image" ? "png" : "mp3"])[1]; const f = path.join(dir, `${job.id}${i ? "-" + i : ""}.${ext}`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); outputs.push(f); }
    catch { outputs.push(u); }
  }
  job.outputs = outputs;
}

async function runJob(h, job) {
  const a = ADAPTERS[job.provider]; const secret = keyFor(h, job.provider);
  const agent = `media:${job.id}`;
  h.emit("agent.start", { agent, provider: job.provider, model: job.params.model || a.defaults?.model || job.provider, role: "media", missionId: job.missionId || null, label: `${a.name} generating ${job.kind}` });
  const t0 = Date.now();
  const update = () => { const d = h.doc(JOBS, () => ({ items: [] })); const i = d.items.findIndex((x) => x.id === job.id); if (i >= 0) d.items[i] = job; h.putDoc(JOBS, d); };
  try {
    if (!secret) {
      await new Promise((r) => setTimeout(r, 1500));
      job.status = "dry-run"; job.note = `No ${a.name} key saved: this is what would have run. Add the key in Settings → Media to generate for real.`; job.finishedAt = Date.now();
      h.emit("agent.done", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId || null, ms: Date.now() - t0 });
      update(); return;
    }
    const started = await a.start(secret, { ...job.params, kind: job.kind });
    if (started.done) { await saveOutput(h, job, started); }
    else {
      job.taskId = started.taskId; job.pollPath = started.pollPath; job.status = "processing"; update();
      for (let i = 0; i < 240; i++) { // up to ~20 minutes
        await new Promise((r) => setTimeout(r, 5000));
        const p = await a.poll(secret, job);
        if (p.done) { if (p.error) throw new Error(p.error); await saveOutput(h, job, p); break; }
        job.progress = p.progress || p.status || null; update();
      }
    }
    job.status = job.outputs?.length ? "done" : "failed"; job.finishedAt = Date.now();
    h.recordCredits({ provider: job.provider, units: job.estimate.credits || job.estimate.characters || job.estimate.seconds || 1, cost: job.estimate.usd, note: `${job.kind}: ${String(job.params.prompt || job.params.text || "").slice(0, 60)}`, project: job.projectId });
    h.emit("agent.done", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId || null, ms: Date.now() - t0, cost: job.estimate.usd });
    h.emit("log", { text: `${a.name} ${job.kind} ready (${job.outputs.length} file${job.outputs.length === 1 ? "" : "s"}) · about $${job.estimate.usd}`, missionId: job.missionId || null });
  } catch (e) {
    job.status = "failed"; job.error = e.message; job.finishedAt = Date.now();
    h.emit("agent.error", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId || null, error: e.message });
  }
  update();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/media/, "");
  if (req.method === "GET" && p === "/providers") return h.json(res, 200, Object.values(ADAPTERS).map((a) => ({ id: a.id, name: a.name, kinds: a.kinds, defaults: a.defaults, price: a.price, keyed: !!keyFor(h, a.id) })));
  if (req.method === "POST" && p === "/estimate") {
    const a = ADAPTERS[body.provider]; if (!a) return h.json(res, 400, { error: "unknown media provider" });
    return h.json(res, 200, { provider: a.id, kind: body.kind, estimate: a.estimate({ ...(body.params || {}), kind: body.kind }), keyed: !!keyFor(h, a.id) });
  }
  if (req.method === "POST" && p === "/generate") {
    const a = ADAPTERS[body.provider]; if (!a) return h.json(res, 400, { error: "unknown media provider" });
    if (!a.kinds.includes(body.kind)) return h.json(res, 400, { error: `${a.name} does not make ${body.kind}` });
    const params = body.params || {}; if (!(params.prompt || params.text)) return h.json(res, 400, { error: "prompt required" });
    const job = { id: "mj-" + Date.now().toString(36), provider: a.id, kind: body.kind, params, projectId: body.projectId || null, missionId: body.missionId || null, estimate: a.estimate({ ...params, kind: body.kind }), status: "queued", createdAt: Date.now(), outputs: [] };
    const d = h.doc(JOBS, () => ({ items: [] })); d.items.unshift(job); d.items = d.items.slice(0, 500); h.putDoc(JOBS, d);
    const ctxRef = h.ctx();
    h.runAs(ctxRef, () => runJob(h, job)).catch?.(() => {});
    return h.json(res, 202, job);
  }
  if (req.method === "GET" && p === "/jobs") return h.json(res, 200, h.doc(JOBS, () => ({ items: [] })).items.slice(0, 100));
  if (req.method === "POST" && p === "/keys") {
    const pid = body.provider; if (!ADAPTERS[pid]) return h.json(res, 400, { error: "unknown media provider" });
    await h.setSecret(pid, pid === "kling" ? { key: body.key, secret: body.secret } : body.key);
    let bal = null; try { bal = await ADAPTERS[pid].balance?.(keyFor(h, pid)); } catch {}
    return h.json(res, 200, { ok: true, balance: bal });
  }
  if (req.method === "GET" && p === "/voices") { const s = keyFor(h, "elevenlabs"); if (!s) return h.json(res, 200, []); try { return h.json(res, 200, await elevenlabs.voices(s)); } catch (e) { return h.json(res, 500, { error: e.message }); } }
  if (req.method === "POST" && p === "/open") { if (h.HOSTED) return h.json(res, 400, { error: "local only" }); const { exec } = await import("node:child_process"); const t = String(body.path || ""); if (!t.startsWith(h.DATA_DIR)) return h.json(res, 400, { error: "outside data folder" }); exec(process.platform === "win32" ? `explorer /select,"${t}"` : `open "${t}"`); return h.json(res, 200, { ok: true }); }
  return false;
}
