// Learning router (Phase 28): the "Who's best at what" view, on/off, reset, export, and the preview of what
// an opt-in share would contain. The learning itself lives in server/brain.js and runs inside every single,
// council and mission job; router.js rank() uses it for every pick.
import { CAPABILITIES } from "../registry.js";
import { rank } from "../router.js";
import { bestAtWhat, saveBrainSettings, resetBrain, exportBrain, sharePreview, cleanCap, cleanDiff } from "../brain.js";
export const id = "brain";
const MODES = ["quality", "balanced", "economy"];

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/brain/, "");
  const modeOf = (v) => (MODES.includes(v) ? v : h.settings?.().defaultMode || "balanced");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, bestAtWhat({ mode: modeOf(url.searchParams.get("mode")) }));
  // who the router would pick right now for one task type, with what the record changed
  if (req.method === "GET" && p === "/pick") {
    const capability = cleanCap(url.searchParams.get("capability")), difficulty = cleanDiff(url.searchParams.get("difficulty")), mode = modeOf(url.searchParams.get("mode"));
    const ranked = rank({ capability, difficulty, mode }).slice(0, 6).map((m) => ({ provider: m.provider, providerName: m.providerName, color: m.color, model: m.model, name: m.name, score: m.score, quality: m.quality, estCost: m.estCost, learned: m.learned }));
    return h.json(res, 200, { capability, difficulty, mode, ranked });
  }
  if (req.method === "POST" && p === "/settings") {
    const s = saveBrainSettings(body || {});
    h.emit("log", { text: s.on ? "Learning router on: every job teaches it who is best at what." : "Learning router off: picks use the built-in scores only." });
    return h.json(res, 200, bestAtWhat({ mode: modeOf(body?.mode) }));
  }
  if (req.method === "POST" && p === "/reset") {
    if (body?.confirm !== true) return h.json(res, 400, { error: "Send confirm: true to reset what the router has learned." });
    resetBrain();
    h.emit("log", { text: "Learning router reset: picks start again from the built-in scores." });
    return h.json(res, 200, bestAtWhat({ mode: modeOf(body?.mode) }));
  }
  if (req.method === "GET" && p === "/export") {
    const b = JSON.stringify(exportBrain(), null, 2);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="command-ai-learning-router-${new Date().toISOString().slice(0, 10)}.json"`, "content-length": Buffer.byteLength(b) });
    res.end(b);
    return true;
  }
  if (req.method === "GET" && p === "/share-preview") return h.json(res, 200, sharePreview());
  if (req.method === "GET" && p === "/capabilities") return h.json(res, 200, CAPABILITIES);
  return false;
}
