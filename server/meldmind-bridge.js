// The local bridge Antigravity's MCP server talks to, and the config file
// "Add to Antigravity" writes after a confirm click.
// The bridge token stays in the user data folder. It is never written into
// ~/.gemini/config/mcp_config.json and never placed on a command line.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./paths.js";
import { doc, putDoc } from "./store.js";
import { stripSecrets } from "./handoff.js";
import { listExternalAgents } from "./external-agents.js";
import { cardView, dispatchJob, findJob, publicJob } from "./antigravity-cli.js";
import { guard } from "./license.js";

const JOBS = "bridge.jobs";
const MAX = 80;
const clip = (s, n) => String(s ?? "").slice(0, n);

export function tokenPath() { return path.join(DATA_DIR, "bridge.token"); }

export function readBridgeToken() {
  try { return fs.readFileSync(tokenPath(), "utf8").trim(); } catch { return ""; }
}

export function ensureBridgeToken() {
  const cur = readBridgeToken();
  if (cur) return cur;
  const next = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(tokenPath(), next, { mode: 0o600 });
  return next;
}

export function bridgeAuthorized(header) {
  const token = readBridgeToken();
  const got = String(header || "");
  if (!token || got.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
}

export function mcpConfigPath(home = os.homedir()) {
  return path.join(home, ".gemini", "config", "mcp_config.json");
}

export function meldmindMcpEntry({ command, script, port, tokenFile }) {
  return {
    command: command || "node",
    args: [script],
    env: {
      MELDMIND_PORT: String(port),
      MELDMIND_TOKEN_FILE: tokenFile,
    },
  };
}

// Setup text for other AI tools (0.4.21). Nothing is written to any other tool's files: the person copies
// the lines. The bridge token stays in Meldmind's data folder and is only named by its file path.
export function clientSnippets({ command, script, port, tokenFile } = {}) {
  const entry = meldmindMcpEntry({ command, script, port, tokenFile });
  const q = (v) => JSON.stringify(String(v));
  const json = JSON.stringify({ mcpServers: { meldmind: entry } }, null, 2);
  return [
    {
      id: "claude-code", name: "Claude Code", where: "Paste this in a terminal.", lang: "shell",
      text: `claude mcp add meldmind --env MELDMIND_PORT=${port} --env MELDMIND_TOKEN_FILE=${q(tokenFile)} -- ${entry.command} ${q(script)}`,
    },
    {
      id: "codex", name: "Codex", where: "Add this to ~/.codex/config.toml (the .codex folder in your home folder).", lang: "toml",
      text: `[mcp_servers.meldmind]\ncommand = ${q(entry.command)}\nargs = [${q(script)}]\nenv = { MELDMIND_PORT = ${q(port)}, MELDMIND_TOKEN_FILE = ${q(tokenFile)} }`,
    },
    { id: "gemini-cli", name: "Gemini CLI", where: "Add this to ~/.gemini/settings.json. If the file already has mcpServers, add only the meldmind part.", lang: "json", text: json },
    { id: "claude-desktop", name: "Claude desktop", where: "Open Claude, Settings, Developer, Edit Config, and add this. Restart Claude after.", lang: "json", text: json },
  ];
}

export function mergeMcpConfig(existing, entry) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const prev = base.mcpServers && typeof base.mcpServers === "object" && !Array.isArray(base.mcpServers) ? { ...base.mcpServers } : {};
  prev.meldmind = entry;
  base.mcpServers = prev;
  return base;
}

export function previewMcpAdd({ home, command, script, port } = {}) {
  const file = mcpConfigPath(home);
  const entry = meldmindMcpEntry({ command, script, port, tokenFile: tokenPath() });
  const blob = JSON.stringify(entry);
  if (/sk-|AIza|Bearer|password/i.test(blob)) {
    return { ok: false, message: "The config would have contained a secret, so it was not prepared." };
  }
  return {
    ok: true,
    needsConfirm: true,
    file,
    entry,
    message: "Add to Antigravity writes the Meldmind server into ~/.gemini/config/mcp_config.json. Other servers in that file stay. The bridge token stays in Meldmind's data folder and is not copied into the config. Nothing is written until you confirm.",
  };
}

export function writeMcpConfig({ confirm, home, command, script, port } = {}) {
  if (confirm === true) guard("desktop");
  const preview = previewMcpAdd({ home, command, script, port });
  if (!preview.ok) return preview;
  if (confirm !== true) return preview;
  const file = preview.file;
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return { ok: false, message: "That config file is not JSON. It was not changed." }; }
  }
  const next = mergeMcpConfig(existing, preview.entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  ensureBridgeToken();
  return { ok: true, file, message: "Meldmind was added to Antigravity. Other MCP servers in that file were kept. Restart Antigravity if it was already open." };
}

function jobs() {
  try { const list = doc(JOBS, () => []); return Array.isArray(list) ? list : []; } catch { return []; }
}
function save(list) { putDoc(JOBS, list.slice(0, MAX)); }

export function publicBridgeJob(j) {
  if (!j) return null;
  const ag = findJob(j.id);
  const text = stripSecrets(ag?.text || j.text || "");
  return {
    id: j.id,
    task: clip(j.task, 240),
    agent: j.agent || "",
    status: ag?.status || j.status,
    text: clip(text, 2000),
    error: ag?.error || j.error || null,
  };
}

export function listBridgeAgents() {
  return listExternalAgents().map((a) => ({ id: a.id, name: a.name, via: a.via }));
}

export async function submitBridgeJob({ task, agent } = {}) {
  guard("desktop");
  const clean = stripSecrets(String(task || "")).trim();
  if (!clean) {
    const err = new Error("task is required");
    err.status = 400;
    throw err;
  }
  const who = String(agent || "").trim().slice(0, 40);
  const now = Date.now();
  let job = { id: "mj-" + crypto.randomBytes(6).toString("hex"), task: clip(clean, 4000), agent: who, status: "queued", text: "Waiting in Meldmind. Nothing was sent.", error: null, createdAt: now, updatedAt: now };
  if (who === "antigravity" && cardView().ready) {
    const sent = await dispatchJob({ task: clean, source: { kind: "click" } });
    job = { ...job, id: sent.id, status: sent.status, text: sent.text || "Sent to Antigravity on this PC." };
  }
  const list = jobs().filter((j) => j.id !== job.id);
  list.unshift(job);
  save(list);
  return publicBridgeJob(job);
}

export function getBridgeJob(id) {
  const local = jobs().find((j) => j.id === id);
  if (local) return publicBridgeJob(local);
  const ag = findJob(id);
  return ag ? publicBridgeJob({ id: ag.id, task: ag.task, agent: "antigravity", status: ag.status, text: ag.text, error: ag.error }) : null;
}

export function scriptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-demo-server.js");
}
