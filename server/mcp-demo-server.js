#!/usr/bin/env node
// A tiny MCP server over stdio (Phase 16), used by demo mode and by the tests. No network, no keys.
// Tools: clock (read-only), word_count (read-only), save_note (writes to a notes list kept in memory
// for the life of the process; marked destructive: false but it is still a write and needs approval).
// Run: node server/mcp-demo-server.js   (talks newline-delimited JSON-RPC on stdin / stdout)
import fs from "node:fs";
import http from "node:http";

const notes = [];
const TOOLS = [
  { name: "clock", title: "Clock", description: "The current date and time on this computer, with the time zone.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { title: "Clock", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "word_count", title: "Word count", description: "Counts the words, sentences and characters in a text.", inputSchema: { type: "object", properties: { text: { type: "string", description: "The text to count" } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "save_note", title: "Save a note", description: "Saves a short note under a title. Notes live only while this demo server runs.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "list_notes", description: "Lists the notes saved so far (title and first line).", inputSchema: { type: "object", properties: {} } }, // no annotations on purpose: the app must treat it as a write until the person marks it read-only
  { name: "list_agents", title: "List Meldmind agents", description: "Lists the agents Meldmind can hand work to. Names only. No chats and no keys.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { title: "List Meldmind agents", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "get_result", title: "Get a Meldmind result", description: "Reads one Meldmind job by id. The text is the reply already stored. Nothing new is sent.", inputSchema: { type: "object", properties: { job_id: { type: "string", description: "The job id from submit_job" } }, required: ["job_id"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "report_usage", title: "Report AI credits used", description: "Tells Meldmind how many AI credits you spent outside Meldmind, so its running balance stays right. Call it after paid AI work. Report only real numbers you can see.", inputSchema: { type: "object", properties: { provider: { type: "string", description: "The AI provider, such as anthropic, openai, xai, google, or openrouter" }, credits_spent: { type: "number", description: "What the work cost, in US dollars" }, note: { type: "string", description: "A few words about the work" }, report_id: { type: "string", description: "Optional id so a retried report is counted once" } }, required: ["provider", "credits_spent"], additionalProperties: false }, annotations: { title: "Report AI credits used", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "submit_job", title: "Submit a Meldmind job", description: "Asks Meldmind to queue a task for one agent. Does not send email, buy, or delete.", inputSchema: { type: "object", properties: { task: { type: "string" }, agent: { type: "string", description: "Optional agent id, such as antigravity" } }, required: ["task"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
];

// writeSync so a Windows pipe does not hold the JSON line in a block buffer.
// A buffered reply leaves the client waiting, and the chat never finishes.
const trace = (s) => { if (process.env.CC_MCP_TRACE === "1") { try { fs.writeSync(2, `MCPTRACE demo ${s}\n`); } catch {} } };
const write = (msg) => {
  const line = JSON.stringify(msg) + "\n";
  trace(`stdout id=${msg.id} bytes=${Buffer.byteLength(line)} cr=${line.includes("\r")} ${line.trim().slice(0, 180)}`);
  fs.writeSync(1, line);
};
const text = (t, extra = {}) => ({ content: [{ type: "text", text: t }], ...extra });

// The agent that connected (from initialize), so a usage report says who spent the credits.
const CLIENT_NAMES = { "claude-code": "Claude Code", "claude-ai": "Claude", antigravity: "Antigravity", cursor: "Cursor", "grok-bot": "Grok Bot" };
let clientName = "An agent via MCP";

const LOCAL_AGENTS = [
  { id: "grokbot", name: "Grok Bot" },
  { id: "browser-helper", name: "Browser helper" },
  { id: "antigravity", name: "Google Antigravity" },
];

function bridgeConfigured() {
  const port = Number(process.env.MELDMIND_PORT || 0);
  const tokenFile = String(process.env.MELDMIND_TOKEN_FILE || "");
  if (!port || port < 1 || port > 65535 || !tokenFile) return null;
  let token = "";
  try { token = fs.readFileSync(tokenFile, "utf8").trim(); } catch { return null; }
  if (!token || token.length > 200) return null;
  return { port, token };
}

function bridgeCall(method, pathname, payload) {
  const cfg = bridgeConfigured();
  if (!cfg) return Promise.resolve(null);
  const body = payload ? JSON.stringify(payload) : "";
  return new Promise((resolve) => {
    const req = http.request({
      host: "127.0.0.1",
      port: cfg.port,
      path: pathname,
      method,
      headers: { "content-type": "application/json", "x-meldmind-bridge": cfg.token, connection: "close", ...(body ? { "content-length": Buffer.byteLength(body) } : {}) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode || 0, json: null }); }
      });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
    if (body) req.write(body);
    req.end();
  });
}

async function call(name, args = {}) {
  if (name === "clock") { const d = new Date(); return text(`${d.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}, ${d.toLocaleString()})`, { structuredContent: { iso: d.toISOString(), epochMs: d.getTime() } }); }
  if (name === "word_count") {
    const s = String(args.text ?? "");
    if (!s.trim()) return text("The text is empty.", { isError: true });
    const words = (s.match(/\S+/g) || []).length, sentences = (s.match(/[.!?]+(\s|$)/g) || []).length || 1;
    return text(`${words} words, ${sentences} sentence${sentences === 1 ? "" : "s"}, ${s.length} characters.`, { structuredContent: { words, sentences, characters: s.length } });
  }
  if (name === "save_note") {
    if (!args.title || !args.body) return text("title and body are required", { isError: true });
    notes.push({ title: String(args.title).slice(0, 80), body: String(args.body).slice(0, 2000), at: Date.now() });
    return text(`Saved note "${args.title}" (${notes.length} note${notes.length === 1 ? "" : "s"} in this session).`);
  }
  if (name === "list_notes") return text(notes.length ? notes.map((n, i) => `${i + 1}. ${n.title}: ${n.body.split("\n")[0].slice(0, 80)}`).join("\n") : "No notes yet.");
  if (name === "list_agents") {
    const live = await bridgeCall("GET", "/api/bridge/agents");
    const rows = Array.isArray(live?.json?.agents) && live.json.agents.length ? live.json.agents : LOCAL_AGENTS;
    const safe = rows.map((a) => ({ id: String(a.id || ""), name: String(a.name || a.id || "") })).filter((a) => a.id);
    return text(safe.map((a) => `${a.name} (${a.id})`).join("\n"), { structuredContent: { agents: safe } });
  }
  if (name === "get_result") {
    const id = String(args.job_id || "").trim();
    if (!id) return text("job_id is required", { isError: true });
    const live = await bridgeCall("GET", "/api/bridge/jobs/" + encodeURIComponent(id));
    if (!live) return text("Meldmind is not running on this computer, so there is no result to read.", { isError: true });
    if (!live.json?.job) return text(live.json?.error || "No such job.", { isError: true });
    return text(String(live.json.job.text || live.json.job.status || "No reply yet."), { structuredContent: { job: live.json.job } });
  }
  if (name === "report_usage") {
    const provider = String(args.provider || "").trim().slice(0, 40);
    const spent = Number(args.credits_spent);
    if (!provider) return text("provider is required", { isError: true });
    if (!Number.isFinite(spent) || spent < 0) return text("credits_spent must be a number of US dollars, 0 or more", { isError: true });
    const live = await bridgeCall("POST", "/api/bridge/usage", { provider, credits_spent: spent, note: String(args.note || "").slice(0, 140), report_id: String(args.report_id || "").slice(0, 80), by: clientName });
    if (!live) return text("Meldmind is not running on this computer, so the usage was not recorded. Report it again when Meldmind is open.", { isError: true });
    if ((live.status || 500) >= 400) return text(live.json?.error || "Meldmind did not take the report.", { isError: true });
    return text(live.json?.duplicate ? "Already recorded in Meldmind." : `Recorded in Meldmind: $${spent.toFixed(2)} on ${live.json?.provider || provider}.`, { structuredContent: { ok: true, provider: live.json?.provider || provider, duplicate: !!live.json?.duplicate } });
  }
  if (name === "submit_job") {
    const task = String(args.task || "").trim();
    if (!task) return text("task is required", { isError: true });
    const live = await bridgeCall("POST", "/api/bridge/jobs", { task: task.slice(0, 8000), agent: String(args.agent || "").slice(0, 40) });
    if (!live) return text("Meldmind is not running on this computer. Start Meldmind, then try again. Nothing was sent.", { isError: true });
    if ((live.status || 500) >= 400) return text(live.json?.error || "Meldmind did not take the job.", { isError: true });
    return text(`Queued in Meldmind. Job id: ${live.json.job?.id || "unknown"}.`, { structuredContent: { job: live.json.job || null } });
  }
  return null;
}

// Own the bytes. readline on a Windows pipe can drop the line that arrives while
// writeSync is still flushing the previous reply, so the second tool call in a
// turn (save_note, after clock) never runs and the chat waits until it times out.
let buf = "";
const queue = [];
let busy = false;
async function handle(line) {
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled): nothing to do
  if (method === "initialize") {
    const raw = String(params?.clientInfo?.name || "").trim().toLowerCase();
    if (raw) clientName = CLIENT_NAMES[raw] || String(params.clientInfo.name).replace(/[^\w .-]/g, "").slice(0, 40) || clientName;
  }
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion === "2024-11-05" ? "2024-11-05" : "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Meldmind demo tools", version: "1.0.0" }, instructions: "Demo tools for Meldmind. Nothing leaves this computer. submit_job queues work in the local app. It does not send mail or spend money on its own. Standing instruction: after paid AI work outside Meldmind, call report_usage with the provider and the US dollars spent, so Meldmind's credit balance stays right." } });
  if (method === "ping") return write({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const r = await call(params?.name, params?.arguments || {});
    if (!r) return write({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    return write({ jsonrpc: "2.0", id, result: r });
  }
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}
function pump() {
  if (busy) return;
  const line = queue.shift();
  if (line === undefined) return;
  busy = true;
  Promise.resolve(handle(line)).finally(() => { busy = false; if (queue.length) pump(); });
}
process.stdin.setEncoding("utf8");
trace(`stdin encoding=utf8 platform=${process.platform}`);
process.stdin.on("data", (chunk) => {
  trace(`stdin chunk bytes=${Buffer.byteLength(chunk)} cr=${String(chunk).includes("\r")}`);
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) { queue.push(buf.slice(0, idx)); buf = buf.slice(idx + 1); }
  pump();
});
process.stdin.on("end", () => process.exit(0));
