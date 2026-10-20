#!/usr/bin/env node
// A tiny MCP server over stdio (Phase 16), used by demo mode and by the tests. No network, no keys.
// Tools: clock (read-only), word_count (read-only), save_note (writes to a notes list kept in memory
// for the life of the process; marked destructive: false but it is still a write and needs approval).
// Run: node server/mcp-demo-server.js   (talks newline-delimited JSON-RPC on stdin / stdout)
import fs from "node:fs";

const notes = [];
const TOOLS = [
  { name: "clock", title: "Clock", description: "The current date and time on this computer, with the time zone.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { title: "Clock", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "word_count", title: "Word count", description: "Counts the words, sentences and characters in a text.", inputSchema: { type: "object", properties: { text: { type: "string", description: "The text to count" } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "save_note", title: "Save a note", description: "Saves a short note under a title. Notes live only while this demo server runs.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "list_notes", description: "Lists the notes saved so far (title and first line).", inputSchema: { type: "object", properties: {} } }, // no annotations on purpose: the app must treat it as a write until the person marks it read-only
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

function call(name, args = {}) {
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
  return null;
}

// Own the bytes. readline on a Windows pipe can drop the line that arrives while
// writeSync is still flushing the previous reply, so the second tool call in a
// turn (save_note, after clock) never runs and the chat waits until it times out.
let buf = "";
const queue = [];
let busy = false;
function handle(line) {
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled): nothing to do
  if (method === "initialize") return write({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion === "2024-11-05" ? "2024-11-05" : "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Meldmind demo tools", version: "1.0.0" }, instructions: "Demo tools for Meldmind. Nothing leaves this computer." } });
  if (method === "ping") return write({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const r = call(params?.name, params?.arguments || {});
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
  try { handle(line); } finally { busy = false; }
  if (queue.length) pump();
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
