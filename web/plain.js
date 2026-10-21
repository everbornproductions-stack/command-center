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
  openRouter: {
    label: "OpenRouter",
    plain: "one key for many AIs",
    explain: "One password that reaches several AIs. Meldmind does not charge extra for it.",
  },
  teamSpace: {
    label: "Team space",
    plain: "a shared place for people you invite",
    explain: "People you invite can see the projects you share. Nothing is emailed until you pass the link on yourself.",
  },
  pipeline: {
    label: "Pipeline",
    plain: "a saved set of steps",
    explain: "The steps are already chosen. Nothing starts until you click Run.",
  },
  council: {
    label: "Council",
    plain: "several AIs answer",
    explain: "Several AIs answer, then one writes the result you see.",
  },
  mission: {
    label: "Mission",
    plain: "a job split into steps",
    explain: "Meldmind splits the job, then shows you the result. A send still waits for a click.",
  },
  api: {
    label: "API",
    plain: "a connection for apps",
    explain: "A way for one app to ask another app to do something.",
  },
  model: {
    label: "Model",
    plain: "which version of an AI answers",
    explain: "The same AI company can offer a fast version and a careful version.",
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
