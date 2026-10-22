// Simple mode: say plainly who answered, and offer a council only when one is possible.
// offer is state.councilOffer from the server (server/council-offer.js).
// answeredBy is the name of the AI that wrote the answer ("Claude Sonnet 5.5"), or
// { kind: "council", names: [...] } for a council answer.

export const ASK_COUNCIL = "Ask a council";

export function simpleAnswerLine(offer, answeredBy) {
  if (answeredBy && typeof answeredBy === "object" && answeredBy.kind === "council") {
    const names = (answeredBy.names || []).filter(Boolean);
    return { text: names.length ? `A council answered: ${names.join(", ")}.` : "A council answered.", offer: null };
  }
  const name = String(answeredBy || "").trim();
  const text = name ? `Answered by one AI (${name}).` : "Answered by one AI.";
  if (offer?.canCouncil) return { text, offer: ASK_COUNCIL };
  const hint = offer && !offer.practice && offer.count >= 1 ? " Add a second AI company, or an OpenRouter key, to ask a council." : "";
  return { text: text + hint, offer: null };
}

// What Ask a council sends: the same question to POST /api/council, with no named seats,
// so the router picks AIs from different companies (or OpenRouter families).
export function councilRequest(prompt, { projectId } = {}) {
  return { path: "/council", body: { prompt: String(prompt || ""), ...(projectId ? { projectId } : {}) } };
}
