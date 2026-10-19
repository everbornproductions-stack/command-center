// MCP (Model Context Protocol) client transports (Phase 16).
// Speaks the protocol directly: JSON-RPC 2.0 over three transports.
//   stdio            a local command; newline-delimited JSON on stdin / stdout (2025-06-18 and earlier)
//   http             Streamable HTTP: POST each message to one endpoint, read JSON or an SSE stream back,
//                    keep the Mcp-Session-Id the server hands out (2025-03-26 and later)
//   sse              the older HTTP+SSE pairing: GET an event stream, learn the POST endpoint from the
//                    first "endpoint" event, POST messages there, read answers off the stream (2024-11-05)
// The interface is the one the official @modelcontextprotocol/sdk exposes for a client (connect, listTools,
// callTool, close), so the transport layer can be swapped for the SDK without touching server/mcp.js.
// Nothing here logs a header, token or environment value.
import { spawn } from "node:child_process";
import { networkCause } from "./health.js";

export const PROTOCOL_VERSION = "2025-06-18";
const OLDER_VERSIONS = ["2025-03-26", "2024-11-05"];
export const CLIENT_INFO = { name: "Meldmind", version: "0.3.2" };

export class McpError extends Error {
  constructor(message, { status = 0, code = null, network = false, unauthorized = false, data = null } = {}) {
    super(message); this.status = status; this.code = code; this.network = network; this.unauthorized = unauthorized; this.data = data;
  }
}

// ---------- JSON-RPC plumbing shared by every transport ----------
class Rpc {
  constructor() { this.nextId = 1; this.pending = new Map(); this.onNotification = null; }
  // Resolve or reject a waiting request from an incoming message. Returns true when it was an answer.
  accept(msg) {
    if (!msg || typeof msg !== "object") return false;
    if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return true;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new McpError(`${msg.error.message || "server error"}`, { code: msg.error.code ?? null, data: msg.error.data ?? null }));
      else p.resolve(msg.result);
      return true;
    }
    if (msg.method && msg.id === undefined) { try { this.onNotification?.(msg); } catch {} return true; }
    // a request from the server (sampling, roots, elicitation): we support none of them
    return false;
  }
  wait(id, timeoutMs, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new McpError(`${what} timed out after ${Math.round(timeoutMs / 1000)} s`, { code: "timeout" })); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  failAll(err) { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(err); this.pending.delete(id); } }
}

// Parse a text/event-stream body into messages. Calls onEvent({ event, data, id }) per event.
async function readSse(body, onEvent, { signal } = {}) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", event = "message", data = [], lastId = null;
  const flush = () => { if (data.length) onEvent({ event, data: data.join("\n"), id: lastId }); event = "message"; data = []; };
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") { flush(); continue; }
        if (line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        const val = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = val; else if (field === "data") data.push(val); else if (field === "id") lastId = val;
      }
    }
    flush();
  } finally { try { reader.releaseLock(); } catch {} }
}

// Windows cannot spawn .cmd / .bat shims (npx, uvx installed through npm) without a shell. Wrap those.
export function spawnSpec(command, args = []) {
  const cmd = String(command || "").trim();
  if (process.platform !== "win32") return { file: cmd, args, shell: false };
  const bare = !/[\\/]/.test(cmd), ext = (cmd.match(/\.(exe|cmd|bat|com)$/i) || [])[1]?.toLowerCase();
  const needsShell = ext === "cmd" || ext === "bat" || (bare && !ext && /^(npx|npm|pnpm|yarn|uvx|uv|bunx|deno)$/i.test(cmd));
  if (!needsShell) return { file: cmd, args, shell: false };
  const q = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[cmd, ...args].map(q).join(" ")}"`], shell: false, windowsVerbatimArguments: true };
}

// ---------- stdio ----------
class StdioTransport {
  constructor({ command, args = [], cwd, env = {} }) { this.command = command; this.args = args; this.cwd = cwd || undefined; this.env = env; this.rpc = new Rpc(); this.child = null; this.stderr = ""; this.closed = false; }
  async start() {
    const spec = spawnSpec(this.command, this.args);
    await new Promise((resolve, reject) => {
      let child;
      try { child = spawn(spec.file, spec.args, { cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, windowsVerbatimArguments: spec.windowsVerbatimArguments }); }
      catch (e) { return reject(new McpError(`Could not start "${this.command}": ${e.message}`, { network: true })); }
      this.child = child;
      let buf = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg; try { msg = JSON.parse(line); } catch { continue; } // servers sometimes print banners on stdout; ignore non-JSON lines
          if (Array.isArray(msg)) msg.forEach((m) => this.rpc.accept(m)); else this.rpc.accept(msg);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => { this.stderr = (this.stderr + c).slice(-4000); });
      child.once("error", (e) => { const err = new McpError(`Could not start "${this.command}": ${e.code === "ENOENT" ? "command not found" : e.message}`, { network: true }); this.closed = true; this.rpc.failAll(err); reject(err); });
      child.once("spawn", () => resolve());
      child.once("exit", (code, sig) => { this.closed = true; this.rpc.failAll(new McpError(`"${this.command}" exited (${sig || code})${this.stderr.trim() ? `: ${this.stderr.trim().split("\n").at(-1).slice(0, 200)}` : ""}`, { network: true })); });
    });
  }
  async send(msg, { timeoutMs = 30000, what = "request" } = {}) {
    if (this.closed || !this.child?.stdin.writable) throw new McpError(`"${this.command}" is not running`, { network: true });
    const isReq = msg.id !== undefined;
    const p = isReq ? this.rpc.wait(msg.id, timeoutMs, what) : Promise.resolve(null);
    this.child.stdin.write(JSON.stringify(msg) + "\n");
    return p;
  }
  async close() {
    this.closed = true;
    const c = this.child; if (!c) return;
    try { c.stdin.end(); } catch {}
    await new Promise((r) => { const t = setTimeout(() => { try { c.kill(); } catch {} r(); }, 1500); t.unref?.(); c.once("exit", () => { clearTimeout(t); r(); }); if (c.exitCode !== null) { clearTimeout(t); r(); } });
  }
}

// ---------- Streamable HTTP ----------
class HttpTransport {
  constructor({ url, headers = {}, getAuth = null, fetchImpl = fetch }) { this.url = url; this.headers = headers; this.getAuth = getAuth; this.fetch = fetchImpl; this.rpc = new Rpc(); this.sessionId = null; this.protocolVersion = null; this.closed = false; }
  async start() {}
  async headersFor(json = true) {
    const h = { ...this.headers, accept: "application/json, text/event-stream" };
    if (json) h["content-type"] = "application/json";
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    if (this.protocolVersion) h["mcp-protocol-version"] = this.protocolVersion;
    const auth = this.getAuth ? await this.getAuth() : null;
    if (auth) h.authorization = auth;
    return h;
  }
  async send(msg, { timeoutMs = 30000, what = "request" } = {}) {
    if (this.closed) throw new McpError("connection closed", { network: true });
    const isReq = msg.id !== undefined;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs); t.unref?.();
    let res;
    try { res = await this.fetch(this.url, { method: "POST", headers: await this.headersFor(), body: JSON.stringify(msg), signal: ctl.signal }); }
    catch (e) { clearTimeout(t); throw new McpError(`Could not reach the server: ${networkCause(e)}`, { network: true }); }
    const sid = res.headers.get("mcp-session-id"); if (sid) this.sessionId = sid;
    if (res.status === 401 || res.status === 403) { clearTimeout(t); const www = res.headers.get("www-authenticate") || ""; throw new McpError(`Not authorized (${res.status})`, { status: res.status, unauthorized: true, data: { wwwAuthenticate: www } }); }
    if (res.status === 404 && this.sessionId && isReq) { clearTimeout(t); this.sessionId = null; throw new McpError("The server forgot this session (404). Refresh to reconnect.", { status: 404, code: "session" }); }
    if (!res.ok && res.status !== 202) { const txt = await res.text().catch(() => ""); clearTimeout(t); throw new McpError(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`, { status: res.status }); }
    if (!isReq) { clearTimeout(t); try { await res.body?.cancel(); } catch {} return null; }
    const ctype = String(res.headers.get("content-type") || "");
    const waiting = this.rpc.wait(msg.id, timeoutMs, what);
    try {
      if (ctype.includes("text/event-stream")) {
        await readSse(res.body, ({ data }) => { let j; try { j = JSON.parse(data); } catch { return; } if (Array.isArray(j)) j.forEach((m) => this.rpc.accept(m)); else this.rpc.accept(j); }, { signal: ctl.signal });
      } else {
        const txt = await res.text();
        let j; try { j = JSON.parse(txt); } catch { throw new McpError(`The server did not answer with JSON (${ctype || "no content type"})`, { status: res.status }); }
        if (Array.isArray(j)) j.forEach((m) => this.rpc.accept(m)); else this.rpc.accept(j);
      }
    } catch (e) { if (!(e instanceof McpError)) { this.rpc.failAll(new McpError(`Connection dropped: ${networkCause(e)}`, { network: true })); } else throw e; }
    finally { clearTimeout(t); }
    return waiting;
  }
  async close() {
    this.closed = true;
    if (!this.sessionId) return;
    try { await this.fetch(this.url, { method: "DELETE", headers: await this.headersFor(false), signal: AbortSignal.timeout(3000) }); } catch {}
  }
}

// ---------- legacy HTTP + SSE ----------
class SseTransport {
  constructor({ url, headers = {}, getAuth = null, fetchImpl = fetch }) { this.url = url; this.headers = headers; this.getAuth = getAuth; this.fetch = fetchImpl; this.rpc = new Rpc(); this.endpoint = null; this.ctl = new AbortController(); this.closed = false; }
  async authHeaders() { const h = { ...this.headers }; const a = this.getAuth ? await this.getAuth() : null; if (a) h.authorization = a; return h; }
  async start() {
    let res;
    try { res = await this.fetch(this.url, { headers: { ...(await this.authHeaders()), accept: "text/event-stream" }, signal: this.ctl.signal }); }
    catch (e) { throw new McpError(`Could not reach the server: ${networkCause(e)}`, { network: true }); }
    if (res.status === 401 || res.status === 403) throw new McpError(`Not authorized (${res.status})`, { status: res.status, unauthorized: true, data: { wwwAuthenticate: res.headers.get("www-authenticate") || "" } });
    if (!res.ok) throw new McpError(`HTTP ${res.status} from the SSE endpoint`, { status: res.status });
    const gotEndpoint = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new McpError("The server never sent its endpoint event", { code: "timeout" })), 15000); t.unref?.();
      this._resolveEndpoint = (v) => { clearTimeout(t); resolve(v); };
      this._rejectEndpoint = (e) => { clearTimeout(t); reject(e); };
    });
    readSse(res.body, ({ event, data }) => {
      if (event === "endpoint") { try { this.endpoint = new URL(data, this.url).toString(); } catch { this.endpoint = data; } this._resolveEndpoint(this.endpoint); return; }
      let j; try { j = JSON.parse(data); } catch { return; }
      if (Array.isArray(j)) j.forEach((m) => this.rpc.accept(m)); else this.rpc.accept(j);
    }, { signal: this.ctl.signal }).then(() => { if (!this.closed) { this.closed = true; this.rpc.failAll(new McpError("The event stream ended", { network: true })); this._rejectEndpoint?.(new McpError("The event stream ended before the endpoint event", { network: true })); } })
      .catch((e) => { this.closed = true; const err = new McpError(`Event stream failed: ${networkCause(e)}`, { network: true }); this.rpc.failAll(err); this._rejectEndpoint?.(err); });
    await gotEndpoint;
  }
  async send(msg, { timeoutMs = 30000, what = "request" } = {}) {
    if (this.closed || !this.endpoint) throw new McpError("connection closed", { network: true });
    const isReq = msg.id !== undefined;
    const waiting = isReq ? this.rpc.wait(msg.id, timeoutMs, what) : Promise.resolve(null);
    let res;
    try { res = await this.fetch(this.endpoint, { method: "POST", headers: { ...(await this.authHeaders()), "content-type": "application/json" }, body: JSON.stringify(msg), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new McpError(`Could not reach the server: ${networkCause(e)}`, { network: true }); }
    if (res.status === 401 || res.status === 403) throw new McpError(`Not authorized (${res.status})`, { status: res.status, unauthorized: true });
    if (!res.ok) { const txt = await res.text().catch(() => ""); throw new McpError(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`, { status: res.status }); }
    try { await res.body?.cancel(); } catch {}
    return waiting;
  }
  async close() { this.closed = true; this.ctl.abort(); }
}

// ---------- the client ----------
export class McpClient {
  constructor(transport) { this.t = transport; this.serverInfo = null; this.capabilities = null; this.protocolVersion = null; this.instructions = null; }
  static for(server, { env = {}, headers = {}, getAuth = null, fetchImpl } = {}) {
    if (server.transport === "stdio") return new McpClient(new StdioTransport({ command: server.command, args: server.args || [], cwd: server.cwd, env }));
    if (server.transport === "sse") return new McpClient(new SseTransport({ url: server.url, headers, getAuth, fetchImpl }));
    return new McpClient(new HttpTransport({ url: server.url, headers, getAuth, fetchImpl }));
  }
  async request(method, params, opts = {}) {
    const id = this.t.rpc.nextId++;
    return this.t.send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }, { what: method, ...opts });
  }
  notify(method, params) { return this.t.send({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }); }
  async connect({ timeoutMs = 30000 } = {}) {
    await this.t.start();
    const r = await this.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, { timeoutMs, what: "initialize" });
    const v = String(r?.protocolVersion || "");
    if (v && v !== PROTOCOL_VERSION && !OLDER_VERSIONS.includes(v)) throw new McpError(`The server speaks MCP ${v}, which this app does not know (it knows ${PROTOCOL_VERSION} and older).`, { code: "protocol" });
    this.protocolVersion = v || PROTOCOL_VERSION;
    if (this.t instanceof HttpTransport) this.t.protocolVersion = this.protocolVersion;
    this.serverInfo = r?.serverInfo || null; this.capabilities = r?.capabilities || {}; this.instructions = r?.instructions || null;
    await this.notify("notifications/initialized");
    return r;
  }
  async listTools({ timeoutMs = 30000 } = {}) {
    const out = []; let cursor;
    for (let page = 0; page < 20; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : {}, { timeoutMs, what: "tools/list" });
      for (const t of r?.tools || []) if (t?.name) out.push({ name: String(t.name), title: t.title || null, description: String(t.description || ""), inputSchema: t.inputSchema || { type: "object", properties: {} }, annotations: t.annotations || null });
      cursor = r?.nextCursor; if (!cursor) break;
    }
    return out;
  }
  async callTool(name, args = {}, { timeoutMs = 120000 } = {}) {
    const r = await this.request("tools/call", { name, arguments: args && typeof args === "object" ? args : {} }, { timeoutMs, what: `tools/call ${name}` });
    return normalizeResult(r);
  }
  async close() { try { await this.t.close(); } catch {} }
  get alive() { return !this.t.closed; }
}

// tools/call result → { text, isError, structured, parts }
export function normalizeResult(r) {
  const parts = Array.isArray(r?.content) ? r.content : [];
  const texts = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "text") texts.push(String(p.text ?? ""));
    else if (p.type === "image") texts.push(`[image ${p.mimeType || ""}, ${Math.round(String(p.data || "").length * 0.75 / 1024)} KB, not shown]`);
    else if (p.type === "audio") texts.push(`[audio ${p.mimeType || ""}, not shown]`);
    else if (p.type === "resource_link") texts.push(`[resource ${p.uri}${p.name ? ` ${p.name}` : ""}]`);
    else if (p.type === "resource") texts.push(typeof p.resource?.text === "string" ? p.resource.text : `[resource ${p.resource?.uri || ""}]`);
  }
  let text = texts.join("\n");
  if (!text && r?.structuredContent !== undefined) text = JSON.stringify(r.structuredContent);
  return { text, isError: !!r?.isError, structured: r?.structuredContent ?? null, parts: parts.length };
}
