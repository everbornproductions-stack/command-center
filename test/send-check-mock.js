// Shared mock for the send-check tests: two OpenAI-style providers (xai, groq) whose behaviour the test flips.
import http from "node:http";

export const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake" };
export async function mocks() {
  const behave = { xai: "ok", groq: "ok" };
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "mock: no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    seen.push({ prefix, model: j.model });
    const b = behave[prefix];
    if (b === 402) return send(402, { error: { message: "Payment required: no credits." } });
    if (b === "quota") return send(429, { error: { message: "You exceeded your current quota, please check your plan and billing details. limit: 0" } });
    let text = `Answer from ${j.model}.`;
    if (/Reply with JSON only: \{"capability"/.test(sys)) text = `{"capability":"coding","difficulty":2,"needWeb":false,"summary":"mock"}`;
    if (b === "empty") text = "";
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    if (text) res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: text ? 10 : 0 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, behave, seen, calls: (p, from = 0) => seen.slice(from).filter((x) => x.prefix === p), close: () => new Promise((r) => srv.close(r)) };
}
