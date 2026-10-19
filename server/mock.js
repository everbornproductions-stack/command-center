// Demo mode: three pretend AIs served by a local OpenAI-compatible endpoint, so the whole
// console (council, missions, QA, routing, ledger, graph) can be exercised and demoed with no
// API keys and no spend. Toggle from Settings. Nothing here touches a real provider.
import http from "node:http";
import { PROVIDERS, TEXT_PROVIDERS } from "./registry.js";
import { setSecret, hasSecret } from "./vault.js";
import { HOSTED } from "./store.js";

// Loopback port for the pretend providers: main port + 52 (4799 when the app runs on 4747).
const PORT = Number(process.env.CC_DEMO_PORT || Number(process.env.PORT || process.env.CC_PORT || 4747) + 52);
let server = null;

const DEMO = [
  { id: "demo-nova", name: "Nova (demo)", vendor: "Demo", color: "#F472B6", models: [["nova-ultra", "Nova Ultra", "flagship", 3, 12], ["nova-lite", "Nova Lite", "economy", 0.1, 0.4]] },
  { id: "demo-atlas", name: "Atlas (demo)", vendor: "Demo", color: "#60A5FA", models: [["atlas-pro", "Atlas Pro", "balanced", 1, 5]] },
  { id: "demo-sage", name: "Sage (demo)", vendor: "Demo", color: "#FBBF24", models: [["sage-mini", "Sage Mini", "economy", 0.2, 0.6]] },
];

function caps(seed) {
  const c = {};
  for (const k of ["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast"]) c[k] = 60 + ((seed * 7 + k.length * 13) % 35);
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr, i) => arr[i % arr.length];

function answerFor(model, system, user) {
  const sys = system || "", u = user || "";
  if (/Reply with JSON only: \{"capability"/.test(sys)) return JSON.stringify({ capability: /video|song|reel|caption|post/i.test(u) ? "creative" : /code|script/i.test(u) ? "code" : /research|latest|compare/i.test(u) ? "research" : "writing", difficulty: u.length > 200 ? 3 : 2, needWeb: /latest|today|news/i.test(u), summary: "demo classification" });
  if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Demo plan: " + u.replace(/^GOAL:\s*/i, "").slice(0, 30), tasks: [
    { id: "t1", title: "Research the audience and angle", capability: "research", difficulty: 2, needWeb: false, deps: [], instructions: "List who this is for and the three angles that would land.", deliverable: "Audience notes and 3 angles" },
    { id: "t2", title: "Draft the core content", capability: "writing", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Write the main copy using the strongest angle.", deliverable: "Draft copy" },
    { id: "t3", title: "Creative hooks and visuals", capability: "creative", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Propose 5 hooks and a visual direction.", deliverable: "Hooks and visual notes" },
    { id: "t4", title: "Schedule and checklist", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t2", "t3"], instructions: "Turn the pieces into a dated schedule with a go-live checklist.", deliverable: "Schedule table" },
  ], assembly: "One document: audience, hooks, copy, schedule." });
  if (/strict judge/.test(sys)) { const letters = [...u.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); const scores = {}; letters.forEach((l, i) => { scores[l] = 6 + ((l.charCodeAt(0) + model.length + i) % 4); }); const best = letters.sort((a, b) => scores[b] - scores[a])[0]; return JSON.stringify({ scores, best, notes: Object.fromEntries(letters.map((l) => [l, "demo note"])), disagreement: "Answers differ on how aggressive the hook should be." }); }
  if (/You QA another AI/.test(sys)) return JSON.stringify({ pass: model !== "sage-mini", score: 8, issues: model === "sage-mini" ? ["missing a call to action"] : [], fix: model === "sage-mini" ? "Add a one-line call to action at the end." : null });
  const topic = u.replace(/^(QUESTION|TASK|GOAL):\s*/i, "").split("\n")[0].slice(0, 70);
  const paras = [
    `## ${topic}\n\nHere is how **${model}** would approach this. The demo AIs produce placeholder content so you can watch the console work without spending credits.`,
    `- First, the goal is restated so nothing is lost.\n- Then the strongest angle is chosen (${pick(["clarity", "speed", "emotion", "proof"], model.length)}).\n- Finally, the deliverable is written in a form you can paste straight into the project.`,
    `### Draft\n\n${pick(["Short hook. Clear promise. One call to action.", "Lead with the result, then the method, then the invitation.", "Open on a question the audience already asks itself."], model.length + 1)}\n\n| Step | Owner | When |\n|---|---|---|\n| Draft | ${model} | today |\n| Review | another AI | +1h |\n| Publish | you | tomorrow |`,
    `*Demo mode: swap in real keys in Settings to get real answers.*`,
  ];
  return paras.join("\n\n");
}

// Demo is per user: the pretend providers are registered once for the process, and a user "has"
// them when a demo key sits in their vault (so one hosted user's demo never shows up for another).
export function demoActive() { return !!server && hasSecret(DEMO[0].id); }

export async function startDemo() {
  // Register the pretend providers before their keys are saved. vault.js keeps a demo key in
  // memory (and does not touch the vault) only once the provider is marked demo. On macOS and
  // Linux plain Node there is no OS vault, so saving the key first would refuse to start demo.
  if (!server) {
    for (const d of DEMO) {
      if (PROVIDERS[d.id]) continue;
      PROVIDERS[d.id] = { id: d.id, name: d.name, vendor: d.vendor, color: d.color, kind: "text", api: "openai", demo: true, baseUrl: `http://127.0.0.1:${PORT}/v1`, keyEnv: "CC_DEMO_KEY", keyHint: "demo", links: { app: "http://localhost:4747", console: null, billing: null, status: null }, statusApi: null,
        models: d.models.map(([id, name, tier, inp, out], i) => ({ id, name, tier, in: inp, out, caps: caps(id.length + i), default: i === 0 })) };
      TEXT_PROVIDERS.push(PROVIDERS[d.id]);
    }
  }
  for (const d of DEMO) if (!hasSecret(d.id)) await setSecret(d.id, "demo-key");
  if (server) return;
  server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: DEMO.flatMap((d) => d.models.map((m) => ({ id: m[0] }))) })); }
    let body = ""; for await (const c of req) body += c;
    let j; try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
    const system = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const text = answerFor(j.model, system, user);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const words = text.split(/(?<=\s)/);
    const slow = !/JSON only/.test(system);
    for (let i = 0; i < words.length; i++) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i] }, finish_reason: null }] })}\n\n`);
      if (slow) await sleep(18 + (j.model.length % 3) * 10);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(text.length / 4) } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  const srv = server;
  await new Promise((resolve, reject) => {
    srv.once("error", (e) => { server = null; reject(new Error(e.code === "EADDRINUSE" ? `demo port ${PORT} in use (another Command Center running?)` : `demo server: ${e.message}`)); });
    srv.listen(PORT, "127.0.0.1", resolve);
  });
}

export async function stopDemo() {
  for (const d of DEMO) if (hasSecret(d.id)) await setSecret(d.id, null);
  if (!server || HOSTED) return; // hosted: other users may still be in demo; the loopback server stays up
  await new Promise((r) => server.close(r));
  server = null;
  for (const d of DEMO) {
    delete PROVIDERS[d.id];
    const i = TEXT_PROVIDERS.findIndex((p) => p.id === d.id);
    if (i >= 0) TEXT_PROVIDERS.splice(i, 1);
  }
}
