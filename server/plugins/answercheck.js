// 0.4.34: POST /api/answer-check { text } runs the send rules on an AI answer about credit repair, real estate, loans or
// insurance and returns the warnings to show under it. Read only: nothing is changed, saved or sent.
import { checkAnswer } from "../compliance-guard.js";

export const id = "answer-check"; // must match the first part of the address (/api/answer-check)

export async function routes(req, res, url, body, h) {
  if (req.method === "POST" && url.pathname === "/api/answer-check") return h.json(res, 200, checkAnswer(String(body?.text || ""))), true;
  return false;
}
