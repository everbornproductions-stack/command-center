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

// Which tool (if any) the pretend AI calls for these orders. Only when the caller offered tools and the
// orders (or the mission goal in the system prompt) mention time, counting, notes or "tool".
function demoToolTurn(j, system, user) {
  if (!Array.isArray(j.tools) || !j.tools.length) return null;
  if (j.messages.some((m) => m.role === "tool")) return null; // already answered by a tool: now write the answer
  // only the person's words count (and a mission's goal, which rides in the system prompt), never the app's own tool instructions
  const goal = (system.match(/toward this goal:\n([^\n]+)/) || [])[1] || "";
  const hay = `${goal}\n${user}`.toLowerCase();
  const names = j.tools.map((t) => t.function?.name || "").filter(Boolean);
  const find = (re) => names.find((n) => re.test(n));
  let name = null, args = {};
  if (/\b(time|clock|date|today)\b/.test(hay)) name = find(/clock$/);
  if (!name && /\b(count|words?)\b/.test(hay)) { name = find(/word_count$/); args = { text: user.split("\n")[0].slice(0, 500) }; }
  if (!name && /\bnotes?\b/.test(hay)) { name = find(/save_note$/); args = { title: user.split("\n")[0].slice(0, 60) || "Demo note", body: user.slice(0, 500) }; }
  if (!name && /\btools?\b/.test(hay)) name = names[0];
  if (!name) return null;
  return { id: "call_demo_" + Date.now().toString(36), name, args };
}

// The browser helper (Phase 27) in demo mode: the pretend AI reads the page it is shown and takes simple
// steps (open the address in the task, fill in a contact form, click its button, which asks for your OK),
// then reports what it saw. It never invents a password and never sends anything on its own.
function demoBrowse(u) {
  const part = (from, to) => { const i = u.indexOf(from); if (i < 0) return ""; const rest = u.slice(i + from.length); const j = to ? rest.indexOf(to) : -1; return j >= 0 ? rest.slice(0, j) : rest; };
  const task = (u.match(/^TASK: (.*)$/m) || [])[1] || "";
  const page = (u.match(/^PAGE: (.*)$/m) || [])[1] || "about:blank";
  const title = (u.match(/^TITLE: (.*)$/m) || [])[1] || "";
  const steps = part("STEPS SO FAR:\n", "\nPAGE: ");
  const text = part("PAGE TEXT:\n", "\nELEMENTS:");
  const els = part("ELEMENTS:\n", "\nGOOGLE:").split("\n");
  const done = (answer) => JSON.stringify({ action: "done", answer, why: "demo" });
  const addr = (task.match(/https?:\/\/[^\s)"]+/) || [])[0]?.replace(/[.,;]+$/, "");
  if (page === "about:blank") return addr ? JSON.stringify({ action: "open", url: addr, why: "the task names this page" }) : done("**Demo result**: the task names no web address, so the pretend AI did not open anything. With a real key, the helper finds its own way.");
  const summary = `**${title || page}** (${page})\n\n${text.replace(/\s+/g, " ").trim().slice(0, 400)}`;
  if (/SAID NO/.test(steps)) return done(`You said no, so nothing was sent. What the page says:\n\n${summary}\n\n*Demo mode: a pretend AI drove the helper.*`);
  if (/\b(form|contact|fill|message)\b/i.test(task)) {
    const sub = els.find((l) => /\(submits form f\d+\)/.test(l));
    const subRef = sub && sub.match(/^\[(e\d+)\]/)[1];
    if (subRef && new RegExp(`\\. click ${subRef}\\b[^\\n]*-> (?!REFUSED|FAILED)`).test(steps)) return done(`The contact form was sent after your OK.\n\n${summary}\n\n*Demo mode: a pretend AI drove the helper; the demo form goes nowhere.*`);
    for (const l of els) {
      const m = l.match(/^\[(e\d+)\] (text|email|textarea) field "([^"]*)"/);
      if (!m || new RegExp(`type into ${m[1]}\\b`).test(steps)) continue;
      const value = m[2] === "email" || /e-?mail/i.test(m[3]) ? "hello@example.com" : /name/i.test(m[3]) ? "Demo Helper" : "Hello from the Meldmind browser helper (demo).";
      return JSON.stringify({ action: "type", ref: m[1], text: value, why: "fill in the form" });
    }
    if (subRef) return JSON.stringify({ action: "click", ref: subRef, why: "send the form (asks you first)" });
  }
  return done(`What the page says:\n\n${summary}\n\n*Demo mode: a pretend AI drove the helper.*`);
}

// Organize my bookmarks (Phase 13) in demo mode: the pretend AI sorts by keywords in the address and title,
// and names a folder after the business (the name given, else the brand that shows up most).
const BM_TOPICS = [
  ["Banking & Money", /chase|wellsfargo|bankofamerica|capitalone|paypal|venmo|quickbooks|intuit|amex|\bbank/],
  ["Insurance", /insurance|progressive|statefarm|geico|allstate|libertymutual/],
  ["Social", /instagram|facebook|linkedin|tiktok|twitter|\bx\.com|youtube|pinterest/],
  ["AI", /chatgpt|openai|claude|gemini|perplexity|grok|midjourney/],
  ["Email & Docs", /mail\.google|docs\.google|drive\.google|outlook|business\.google/],
  ["Tools", /github|canva|notion|zapier|bookmarklet/],
  ["Shopping", /amazon|ebay|etsy|walmart/],
  ["News & Reading", /news|weather|recipe|bbc|cnn|nytimes|wikipedia/],
];
function demoBookmarks(u) {
  const rows = [...u.matchAll(/^(\S+) \| (.*) \| (.*)$/gm)].map((m) => ({ id: m[1], title: m[2], url: m[3] }));
  const host = (r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const brand = (h) => h.split(".").slice(-2)[0] || "";
  let biz = (u.match(/^BUSINESS: (.*)$/m) || [])[1] || "";
  const counts = {};
  for (const r of rows) { const h = host(r); if (h && !BM_TOPICS.some(([, re]) => re.test(`${h} ${r.title.toLowerCase()}`))) counts[brand(h)] = (counts[brand(h)] || 0) + 1; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const bizKey = biz ? biz.toLowerCase().split(/\s+/)[0] : top && top[1] >= 2 ? top[0] : "";
  if (!biz && bizKey) { const r = rows.find((x) => brand(host(x)) === bizKey); biz = r ? r.title.split(/\s+/).slice(0, 2).join(" ") : bizKey; }
  const folders = {};
  for (const r of rows) {
    const hay = `${host(r)} ${r.url} ${r.title}`.toLowerCase();
    const name = bizKey && hay.replace(/\s+/g, "").includes(bizKey) ? biz : (BM_TOPICS.find(([, re]) => re.test(hay)) || ["Everything else"])[0];
    (folders[name] ||= []).push(r.id);
  }
  return JSON.stringify({ folders: Object.entries(folders).map(([name, items]) => ({ name, items })) });
}

// Knowledge libraries (Phase 18) in demo mode: "nova-embed" hashes words into 1024 numbers, with a few
// synonyms folded together so a question can find a passage that uses other words (car / automobile).
// Deterministic, local, no network.
const DEMO_SYNONYMS = { car: "vehicle", cars: "vehicle", automobile: "vehicle", auto: "vehicle", truck: "vehicle", price: "cost", pricing: "cost", fee: "cost", fees: "cost", charge: "cost", refund: "return", refunds: "return", returns: "return", employee: "staff", employees: "staff", worker: "staff", workers: "staff", holiday: "vacation", holidays: "vacation", leave: "vacation" };
export function demoEmbedding(text, dims = 1024) {
  const v = new Array(dims).fill(0);
  const words = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w0 of words) {
    if (w0.length < 2) continue;
    let w = DEMO_SYNONYMS[w0] || w0;
    if (!DEMO_SYNONYMS[w0] && w.length > 4) w = w.replace(/(ing|ed|es|s)$/, "");
    let h = 2166136261; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    v[h % dims] += (h >>> 16) & 1 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => +(x / n).toFixed(6));
}
// The pretend AI answers from the first library excerpt and cites it, so citations can be tried without a key.
function demoLibraryAnswer(model, u) {
  const i = u.indexOf("LIBRARY EXCERPTS");
  const m = u.slice(i).match(/\n\[(L\d+)\] ([^\n]*)\n([\s\S]*?)(?=\n\n\[L\d+\] |$)/);
  if (!m) return null;
  const flat = m[3].replace(/^#+\s*[^\n]*\n/gm, "").replace(/\s+/g, " ").trim() || m[3].replace(/\s+/g, " ").trim();
  const first = flat.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] || m[3].replace(/\s+/g, " ").trim().slice(0, 200);
  const topic = u.replace(/^(QUESTION|TASK|GOAL):\s*/i, "").split("\n")[0].slice(0, 70);
  return `## ${topic}\n\nFrom your library: ${first} [${m[1]}]\n\nThat passage comes from **${m[2].replace(/ \(library: .*\)$/, "")}**. Click the [${m[1]}] chip to see the excerpt.\n\n*Demo mode: **${model}** is a pretend AI that quotes the best excerpt; real AIs read every excerpt and cite each fact.*`;
}

// Media steps (Phase 6): when the goal asks for the file itself ("make a video ...", "generate an image ...",
// "produce a voice-over ..."), the demo plan adds one media step so the estimate and dry run can be watched.
function demoMediaTask(u) {
  const goal = u.replace(/^GOAL:\s*/i, "").split("\n")[0];
  const m = goal.match(/\b(?:generate|render|make|create|produce)\s+(?:a|an|the|one)?\s*(?:short\s+)?(video|clip|image|picture|photo|voice-?over|narration)\b/i);
  if (!m) return [];
  const w = m[1].toLowerCase();
  const kind = /video|clip/.test(w) ? "video" : /voice|narration/.test(w) ? "voice" : "image";
  return [{ id: "t5", title: `Make the ${kind === "voice" ? "voice-over" : kind}`, capability: "media", difficulty: 1, needWeb: false, deps: [kind === "voice" ? "t2" : "t3"], instructions: `Generate the ${kind} for: ${goal.slice(0, 160)}`, deliverable: `The ${kind} file`, media: { kind, prompt: `${goal.slice(0, 200)} (demo prompt)` } }];
}

// Chat with files (Phase 6): the pretend AI "describes" a dropped image. It says which file it was given and
// how big the picture that arrived was, so the image can be seen reaching the model without a key.
function demoDescribe(u, messages) {
  const name = u.match(/File name: ([^\n]{1,200})/)?.[1] || "the image";
  const img = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c) => c?.type === "image_url");
  const url = img?.image_url?.url || "";
  const mime = url.match(/^data:([^;]+);base64,/)?.[1] || "none";
  const kb = Math.round((url.length - url.indexOf(",") - 1) * 0.75 / 1024 * 10) / 10;
  return `Demo description of ${name}: a picture received as ${mime}, about ${kb} KB. In demo mode no real AI looks at it; with a key for OpenAI, Anthropic or Google Gemini this would list what the image shows, any text in it, colours and layout.`;
}

function answerFor(model, system, user, messages = []) {
  const sys = system || "", u = user || "";
  if (/^You drive a web browser/.test(sys)) return demoBrowse(u);
  if (/^You sort browser bookmarks/.test(sys)) return demoBookmarks(u);
  if (/^You describe an image/.test(sys)) return demoDescribe(u, messages);
  const toolResults = messages.filter((m) => m.role === "tool").map((m) => String(m.content || "").slice(0, 400));
  if (toolResults.length) return `## Done, with a little help from a tool\n\n**${model}** called a tool and got back:\n\n> ${toolResults.join("\n> ")}\n\nUsing that: ${u.split("\n")[0].slice(0, 120)}\n\n*Demo mode: the tool really ran on this computer; the pretend AI only narrates.*`;
  if (/Reply with JSON only: \{"capability"/.test(sys)) return JSON.stringify({ capability: /video|song|reel|caption|post/i.test(u) ? "creative" : /code|script/i.test(u) ? "code" : /research|latest|compare/i.test(u) ? "research" : "writing", difficulty: u.length > 200 ? 3 : 2, needWeb: /latest|today|news/i.test(u), summary: "demo classification" });
  if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Demo plan: " + u.replace(/^GOAL:\s*/i, "").slice(0, 30), tasks: [
    { id: "t1", title: "Research the audience and angle", capability: "research", difficulty: 2, needWeb: false, deps: [], instructions: "List who this is for and the three angles that would land.", deliverable: "Audience notes and 3 angles" },
    { id: "t2", title: "Draft the core content", capability: "writing", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Write the main copy using the strongest angle.", deliverable: "Draft copy" },
    { id: "t3", title: "Creative hooks and visuals", capability: "creative", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Propose 5 hooks and a visual direction.", deliverable: "Hooks and visual notes" },
    { id: "t4", title: "Schedule and checklist", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t2", "t3"], instructions: "Turn the pieces into a dated schedule with a go-live checklist.", deliverable: "Schedule table" },
    ...demoMediaTask(u),
  ], assembly: "One document: audience, hooks, copy, schedule." });
  if (/strict judge/.test(sys)) { const letters = [...u.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); const scores = {}; letters.forEach((l, i) => { scores[l] = 6 + ((l.charCodeAt(0) + model.length + i) % 4); }); const best = letters.sort((a, b) => scores[b] - scores[a])[0]; return JSON.stringify({ scores, best, notes: Object.fromEntries(letters.map((l) => [l, "demo note"])), disagreement: "Answers differ on how aggressive the hook should be." }); }
  if (/You QA another AI/.test(sys)) return JSON.stringify({ pass: model !== "sage-mini", score: 8, issues: model === "sage-mini" ? ["missing a call to action"] : [], fix: model === "sage-mini" ? "Add a one-line call to action at the end." : null });
  if (u.includes("LIBRARY EXCERPTS")) { const lib = demoLibraryAnswer(model, u); if (lib) return lib; }
  const topic = u.replace(/^(QUESTION|TASK|GOAL):\s*/i, "").split("\n")[0].slice(0, 70);
  // custom agents (Phase 19): the pretend AI says which agent it is playing, so instructions can be seen arriving
  const custom = sys.match(/^You are the custom agent "([^"\n]{1,80})"/)?.[1];
  // project memory (Phase 3): the pretend AI says so when the project's voice and never-say list arrived
  const memory = u.match(/PROJECT MEMORY for ([^\n]{1,80}?) \(follow this/)?.[1];
  const paras = [
    ...(custom ? [`*Speaking as your custom agent **${custom}**.*`] : []),
    ...(memory ? [`*Following the project memory for **${memory}**.*`] : []),
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
  // Register the pretend providers before saving their keys. On macOS and Linux without the
  // desktop keychain, vault.js keeps a demo key in memory and refuses every other save.
  for (const d of DEMO) {
    if (PROVIDERS[d.id]) continue;
    PROVIDERS[d.id] = { id: d.id, name: d.name, vendor: d.vendor, color: d.color, kind: "text", api: "openai", demo: true, baseUrl: `http://127.0.0.1:${PORT}/v1`, keyEnv: "CC_DEMO_KEY", keyHint: "demo", links: { app: "http://localhost:4747", console: null, billing: null, status: null }, statusApi: null,
      models: d.models.map(([id, name, tier, inp, out], i) => ({ id, name, tier, in: inp, out, caps: caps(id.length + i), default: i === 0 })) };
    TEXT_PROVIDERS.push(PROVIDERS[d.id]);
  }
  for (const d of DEMO) if (!hasSecret(d.id)) await setSecret(d.id, "demo-key");
  if (server) return;
  server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: DEMO.flatMap((d) => d.models.map((m) => ({ id: m[0] }))) })); }
    let body = ""; for await (const c of req) body += c;
    let j; try { j = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
    if (req.url.endsWith("/embeddings")) {
      const input = Array.isArray(j.input) ? j.input : [j.input];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", model: j.model, data: input.map((t, index) => ({ object: "embedding", index, embedding: demoEmbedding(t) })), usage: { prompt_tokens: input.reduce((a, t) => a + Math.ceil(String(t || "").length / 4), 0), total_tokens: input.reduce((a, t) => a + Math.ceil(String(t || "").length / 4), 0) } }));
    }
    if (!Array.isArray(j.messages)) { res.writeHead(400); return res.end(); }
    const system = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : "")).join("\n");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    // MCP tools (Phase 16): when tools are offered and the orders mention one, the pretend AI calls it
    // once, then answers with the result. Lets Settings > Tools be tried end to end without a key.
    const toolTurn = demoToolTurn(j, system, user);
    if (toolTurn) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: toolTurn.id, type: "function", function: { name: toolTurn.name, arguments: JSON.stringify(toolTurn.args) } }] }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: 12 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    const text = answerFor(j.model, system, user, j.messages);
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
