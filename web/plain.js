// Short explanations for words that are easy to skip past.
// The label is the jargon plus the plain words. The note says what happens.

export const TERMS = {
  mcp: {
    label: "MCP",
    plain: "a plug-in connection",
    explain: "A tool server an AI can call, such as a calendar or a folder on this PC.",
  },
  oauth: {
    label: "OAuth",
    plain: "sign in with the service",
    explain: "You sign in on their site. Meldmind never sees your password.",
  },
  webhook: {
    label: "Webhook",
    plain: "a web address that receives a message",
    explain: "Another service can start a job, or receive a result, by calling this address.",
  },
  senderKey: {
    label: "Sender key",
    plain: "a password for that address",
    explain: "The other service sends this secret so Meldmind knows the call is yours.",
  },
  handoff: {
    label: "Handoff",
    plain: "continue in another chat",
    explain: "Meldmind copies a prompt and opens that site. You paste it. Nothing is typed for you.",
  },
  scf: {
    label: "SCF mode",
    plain: "credit repair safety",
    explain: "Extra rules so a draft does not promise a score, a deletion, or a guaranteed result.",
  },
};

export function plainLabel(id) {
  const t = TERMS[id];
  return t ? `${t.label} (${t.plain})` : String(id || "");
}

export function plainExplain(id) {
  return TERMS[id]?.explain || "";
}

export function handoffRowNote(name) {
  const who = String(name || "that chat").trim() || "that chat";
  return `Continue in ${who} copies a prompt and opens that page. You paste it. Meldmind does not type or send.`;
}
