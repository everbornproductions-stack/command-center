// Help tab API. GET returns the bundled articles. POST /ask answers from those
// articles with a connected text AI, or returns search hits when it cannot.
// The question and any key are never written to the log.
import { getStatus } from "../health.js";
import { HELP_DIR, loadHelp, pickHelpProvider, searchReply, NO_AI, AI_DOWN } from "../help.js";
import { securityPdf } from "../security-pdf.js";

export const id = "help";

const MAX_Q = 1000;

function cleanQuestion(value) {
  const q = String(value || "").replace(/\s+/g, " ").trim();
  if (!q) return { error: "Type a question first." };
  if (q.length > MAX_Q) return { error: "Keep the question under 1000 characters." };
  return { question: q };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/help\/?/, "");
  if (req.method === "GET" && (p === "security.pdf" || p === "/security.pdf")) {
    const buf = securityPdf();
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="meldmind-security.pdf"',
      "content-length": buf.length,
      "cache-control": "no-store",
    });
    res.end(buf);
    return true;
  }
  let pack;
  try { pack = loadHelp(HELP_DIR); }
  catch (e) { return h.json(res, 500, { error: e.message }); }

  if (req.method === "GET" && (p === "" || p === "/")) {
    return h.json(res, 200, { lastUpdatedVersion: pack.catalog.lastUpdatedVersion, articles: pack.articles });
  }
  if (req.method === "POST" && p === "ask") {
    const q = cleanQuestion(body?.question);
    if (q.error) return h.json(res, 400, { error: q.error });
    const pick = pickHelpProvider(h.PROVIDERS, { hasSecret: h.hasSecret, statusOf: getStatus });
    if (!pick) return h.json(res, 200, searchReply(NO_AI, pack.articles, q.question));
    const hits = searchReply(NO_AI, pack.articles, q.question).hits;
    const excerpts = hits.length
      ? pack.articles.filter((a) => hits.some((hit) => hit.id === a.id)).map((a) => `## ${a.title}\n${a.body.slice(0, 1800)}`).join("\n\n")
      : "(no matching article)";
    const system = "You answer questions about Meldmind using only the help excerpts below. If the excerpts do not say, say you do not know and name the closest article. Do not invent steps, prices, or clicks.\n\n" + excerpts;
    const t0 = Date.now();
    try {
      const out = await h.complete({
        provider: pick.providerId,
        model: pick.model,
        system,
        messages: [{ role: "user", content: q.question }],
        maxTokens: 500,
      });
      const text = String(out?.text || "").trim();
      if (!text) return h.json(res, 200, searchReply(AI_DOWN, pack.articles, q.question));
      try {
        h.recordCall({
          provider: pick.providerId,
          model: pick.model,
          usage: out.usage || { input: 0, output: 0 },
          role: "help",
          ms: Date.now() - t0,
        });
      } catch { /* the answer still stands if the ledger line fails */ }
      return h.json(res, 200, { source: "ai", answer: text, hits, provider: pick.providerId, model: pick.model });
    } catch {
      h.emit("log", { text: "Help answer could not reach a connected AI. Showing search instead." });
      return h.json(res, 200, searchReply(AI_DOWN, pack.articles, q.question));
    }
  }
  return false;
}
