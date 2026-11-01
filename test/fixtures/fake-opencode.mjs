// A pretend `opencode serve` for test/opencode-0433.test.js. It speaks the small part of OpenCode's REST API that
// Meldmind uses: GET /config/providers, POST /session, POST /session/:id/prompt_async, GET /session/:id/message,
// GET /session/status, POST /session/:id/abort, DELETE /session/:id. Anything else answers the web app's HTML, like
// the real server (so GET /v1/models is not JSON). Modes: ok, never (never answers), error (out of free usage).
// Test controls: POST /__mode {mode}, GET /__log. Run as a program: node fake-opencode.mjs serve --port N.
// No network beyond 127.0.0.1, no real model.
import http from "node:http";
import { pathToFileURL } from "node:url";

export const PROVIDERS = {
  providers: [
    { id: "anthropic", name: "Anthropic", models: { "claude-x": { id: "claude-x", name: "Claude X", cost: { input: 3, output: 15 } } } },
    { id: "opencode", name: "OpenCode Zen", models: {
      "paid-pro": { id: "paid-pro", name: "Paid Pro", cost: { input: 1, output: 2 } },
      "trainer-free": { id: "trainer-free", name: "Trainer Free", note: "Prompts may be used for training", cost: { input: 0, output: 0 } },
      "glm-5.3-flash-free": { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free", cost: { input: 0, output: 0 } },
      "big-pickle": { id: "big-pickle", name: "Big Pickle", cost: { input: 0, output: 0 } },
    } },
  ],
  default: { opencode: "big-pickle" },
};

export function startFake({ port = 0, mode = "ok", answer = "OK from the fake OpenCode", answerAfterMs = 400 } = {}) {
  const st = { mode, sessions: new Map(), log: [], n: 0 };
  const send = (res, code, body) => {
    const json = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json", connection: "close" });
    res.end(json);
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const u = new URL(req.url, "http://127.0.0.1");
      const p = u.pathname;
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      st.log.push({ method: req.method, path: p, directory: u.searchParams.get("directory") || "", body });
      if (p === "/__mode" && req.method === "POST") { st.mode = body?.mode || "ok"; return send(res, 200, { mode: st.mode }); }
      if (p === "/__log") return send(res, 200, st.log);
      if (p === "/config/providers" && req.method === "GET") return send(res, 200, PROVIDERS);
      if (p === "/doc") return send(res, 200, { openapi: "3.1.0" });
      if (p === "/session/status" && req.method === "GET") {
        const out = {};
        for (const [id, s] of st.sessions) {
          if (s.aborted || !s.promptAt) continue;
          if (s.mode === "ok" && Date.now() - s.promptAt >= answerAfterMs) continue; // idle sessions are left out
          if (s.mode === "error") continue;
          out[id] = { type: "busy" };
        }
        return send(res, 200, out);
      }
      if (p === "/session" && req.method === "POST") {
        const id = `ses_fake${++st.n}`;
        st.sessions.set(id, { id, mode: st.mode, promptAt: 0, aborted: false, prompt: null, directory: u.searchParams.get("directory") || "" });
        return send(res, 200, { id, title: body?.title || "", directory: u.searchParams.get("directory") || "" });
      }
      const m = p.match(/^\/session\/([^/]+)(?:\/([a-z_]+))?$/);
      const s = m ? st.sessions.get(decodeURIComponent(m[1])) : null;
      if (m && !s) return send(res, 404, { name: "NotFoundError" });
      if (s && m[2] === "prompt_async" && req.method === "POST") { s.promptAt = Date.now(); s.prompt = body; res.writeHead(204, { connection: "close" }); return res.end(); }
      if (s && m[2] === "abort" && req.method === "POST") { s.aborted = true; return send(res, 200, true); }
      if (s && !m[2] && req.method === "DELETE") { st.sessions.delete(s.id); return send(res, 200, true); }
      if (s && m[2] === "message" && req.method === "GET") {
        const msgs = [];
        if (s.promptAt) {
          msgs.push({ info: { id: "msg_u", role: "user", sessionID: s.id, time: { created: s.promptAt } }, parts: (s.prompt?.parts || []) });
          const info = { id: "msg_a", role: "assistant", sessionID: s.id, time: { created: s.promptAt }, providerID: s.prompt?.model?.providerID, modelID: s.prompt?.model?.modelID };
          const parts = [{ type: "step-start" }];
          if (s.mode === "ok" && Date.now() - s.promptAt >= answerAfterMs) { info.time.completed = Date.now(); info.finish = "stop"; parts.push({ type: "text", text: answer }, { type: "step-finish" }); }
          if (s.mode === "error") { info.time.completed = Date.now(); info.error = { name: "UnknownError", data: { message: "FreeUsageLimitError: free usage limit reached for today" } }; }
          if (s.aborted && !info.time.completed) info.error = { name: "MessageAbortedError", data: { message: "Aborted" } };
          msgs.push({ info, parts });
        }
        return send(res, 200, msgs);
      }
      res.writeHead(200, { "content-type": "text/html", connection: "close" });
      res.end("<!doctype html><title>OpenCode</title>");
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const realPort = server.address().port;
      resolve({
        port: realPort, base: `http://127.0.0.1:${realPort}`, state: st, server,
        setMode: (mm) => { st.mode = mm; },
        close: () => new Promise((r) => { try { server.closeAllConnections(); } catch { /* old node */ } server.close(() => r()); }),
      });
    });
  });
}

// as a program: node fake-opencode.mjs serve --port N --hostname 127.0.0.1
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 0;
  startFake({ port, mode: process.env.FAKE_OC_MODE || "ok" }).then(() => { /* keeps running until killed */ });
}
