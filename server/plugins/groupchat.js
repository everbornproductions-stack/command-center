// AI group chat (Phase 44). Up to 4 AIs, each with a persona.
// A reply is sent only when the person clicks send. The support persona is not a therapist.
import { demosHidden } from "../demo-visibility.js";
import { extractJson } from "../providers.js";
import { redact, bad } from "../together-text.js";
import { fileReport } from "../moderation.js";

export const id = "groupchat";
const DOC = "groupchat";
export const MAX_AIS = 4;

export const SUPPORT_NOTE = "This persona is not a licensed therapist. If you are in crisis, call or text 988, the Suicide and Crisis Lifeline. Help is free, private, and available all day.";

export const PERSONAS = {
  fun: { label: "Fun", prompt: "You are the fun persona in a group chat. Be warm, playful, and brief. No cruelty." },
  technical: { label: "Technical", prompt: "You are the technical persona. Be precise and brief. Name one tradeoff in plain words." },
  coach: { label: "Coach", prompt: "You are the coach persona. Be practical and brief. Give one next step. You are not a doctor." },
  support: { label: "Support", prompt: `You are the support persona. You are not a licensed therapist. If the person may be in crisis, tell them to call or text 988, the Suicide and Crisis Lifeline. Be kind and brief. ${SUPPORT_NOTE}` },
};

const state = (h) => {
  const d = h.doc(DOC, () => ({ members: [], messages: [] }));
  d.members ||= [];
  d.messages ||= [];
  return d;
};

export function personaList() {
  return Object.entries(PERSONAS).map(([id, p]) => ({ id, label: p.label }));
}

function ais(h) {
  const out = [];
  for (const p of Object.values(h.PROVIDERS || {})) {
    if (p.kind !== "text") continue;
    if (p.demo && demosHidden()) continue;
    if (!h.hasSecret(p.id) && !p.demo) continue;
    const models = (p.models || []).map((m) => ({ id: m.id, name: m.name }));
    if (!models.length) continue;
    out.push({ id: p.id, name: p.name, models });
  }
  return out;
}

function cleanMembers(body, available) {
  const raw = Array.isArray(body.members) ? body.members : [];
  if (!raw.length) throw bad(400, "Pick at least one AI.", "members");
  if (raw.length > MAX_AIS) throw bad(400, `Pick up to ${MAX_AIS} AIs.`, "members");
  const seen = new Set();
  const members = [];
  for (const row of raw) {
    const provider = String(row.provider || "");
    const persona = String(row.persona || "");
    if (seen.has(provider)) throw bad(400, "Each AI is picked once.", "members");
    seen.add(provider);
    const ai = available.find((a) => a.id === provider);
    if (!ai) throw bad(400, "That AI is not connected. Turn on demo mode or add a key.", "provider");
    if (!PERSONAS[persona]) throw bad(400, "Pick a persona: fun, technical, coach, or support.", "persona");
    const model = ai.models.some((m) => m.id === row.model) ? row.model : ai.models[0].id;
    members.push({ provider, model, persona, name: ai.name });
  }
  return members;
}

export function repliesFrom(text) {
  const parsed = extractJson(text);
  let list = Array.isArray(parsed?.replies) ? parsed.replies : String(text || "").split(/\n+/);
  list = list.map((s) => redact(String(s || "").trim(), 400)).filter(Boolean).slice(0, 3);
  if (list.length === 1) {
    const bits = list[0].split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (bits.length >= 2) list = bits.slice(0, 3);
  }
  if (list.length === 0) list = ["No reply."];
  if (list.length === 1) list = [list[0], "That is the short version."];
  return list.slice(0, 3);
}

function systemFor(persona) {
  const p = PERSONAS[persona];
  return `Meldmind group chat persona: ${persona}.\n${p.prompt}\nReply as JSON only: {"replies":["...","..."]} with 2 or 3 short replies. No keys and no secrets.\nJSON only.`;
}

function supportOn(members) {
  return members.some((m) => m.persona === "support");
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/groupchat/, "").replace(/\/$/, "") || "/";
  const d = state(h);
  const available = ais(h);

  if (req.method === "GET" && p === "/") {
    return h.json(res, 200, {
      max: MAX_AIS,
      personas: personaList(),
      supportNote: SUPPORT_NOTE,
      supportOn: supportOn(d.members),
      ais: available,
      members: d.members,
      messages: d.messages.slice(-40),
    });
  }

  if (req.method === "POST" && p === "/members") {
    const members = cleanMembers(body, available);
    d.members = members;
    h.putDoc(DOC, d);
    return h.json(res, 200, { members, supportOn: supportOn(members), supportNote: supportOn(members) ? SUPPORT_NOTE : null });
  }

  if (req.method === "POST" && p === "/send") {
    const text = redact(String(body.text || "").trim(), 4000);
    if (!text) throw bad(400, "Write a message first. Nothing is sent until you click Send.", "text");
    if (!d.members.length) throw bad(400, "Pick who is in the chat first.", "members");
    const userMsg = { id: "m-" + Date.now().toString(36), role: "you", text, at: Date.now() };
    const replies = [];
    for (const member of d.members) {
      const started = Date.now();
      try {
        const out = await h.complete({
          provider: member.provider,
          model: member.model,
          maxTokens: 400,
          system: systemFor(member.persona),
          messages: [{ role: "user", content: text }],
        });
        const usage = out.usage || { input: 0, output: 0 };
        h.recordCall({ provider: member.provider, model: member.model, usage, missionId: userMsg.id, role: "groupchat", ms: Date.now() - started });
        const lines = repliesFrom(out.text);
        replies.push({ provider: member.provider, name: member.name, persona: member.persona, replies: lines, at: Date.now() });
      } catch (e) {
        replies.push({ provider: member.provider, name: member.name, persona: member.persona, error: redact(e.message, 200), replies: [], at: Date.now() });
      }
    }
    if (replies.every((r) => !r.replies.length)) throw bad(502, "None of the AIs answered. Check the keys or turn on demo mode.", "ais");
    const row = { ...userMsg, replies };
    d.messages.push(row);
    if (d.messages.length > 80) d.messages.splice(0, d.messages.length - 80);
    h.putDoc(DOC, d);
    return h.json(res, 200, { message: row, supportOn: supportOn(d.members), supportNote: supportOn(d.members) ? SUPPORT_NOTE : null });
  }

  if (req.method === "POST" && p === "/report") {
    const row = fileReport(h, { area: "groupchat", targetType: "reply", targetId: body.targetId, reason: body.reason });
    return h.json(res, 200, row);
  }

  return false;
}
