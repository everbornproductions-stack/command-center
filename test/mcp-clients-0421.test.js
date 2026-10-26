// Meldmind inside other AI tools (Top 10 #5): copy-ready setup lines, no secrets, nothing written.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { clientSnippets } from "../server/meldmind-bridge.js";

test("clientSnippets: four tools, the token file is named but never the token", () => {
  const list = clientSnippets({ command: "node", script: "C:\\App\\mcp-demo-server.js", port: 4747, tokenFile: "C:\\Data\\bridge.token" });
  assert.deepEqual(list.map((c) => c.id), ["claude-code", "codex", "gemini-cli", "claude-desktop"]);
  assert.match(list[0].text, /^claude mcp add meldmind --env MELDMIND_PORT=4747 /);
  assert.match(list[1].text, /\[mcp_servers\.meldmind\]/);
  assert.equal(JSON.parse(list[2].text).mcpServers.meldmind.args[0], "C:\\App\\mcp-demo-server.js");
  for (const c of list) assert.doesNotMatch(c.text, /sk-|AIza|Bearer/);
});

test("GET /api/bridge/clients answers on the session token and writes no other tool's files", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcpcl-"));
  const srv = await startServer({ env: { CC_MCP_HOME: home } });
  try {
    const r = await srv.api("/bridge/clients");
    assert.equal(r.status, 200);
    assert.equal(r.json.clients.length, 4);
    assert.match(r.json.note, /changes nothing/);
    assert.deepEqual(fs.readdirSync(home), []);
    const tok = fs.readFileSync(path.join(srv.dir, "bridge.token"), "utf8").trim();
    for (const c of r.json.clients) assert.equal(c.text.includes(tok), false);
  } finally { await srv.stop(); fs.rmSync(home, { recursive: true, force: true }); }
});
