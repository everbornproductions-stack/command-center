// 0.4.21 (Melius idea): every result keeps its older versions. "Try again" and "Change this part"
// add Version 2, 3 ... next to Version 1 instead of replacing it. A result is one chain, named by a key
// (the id of the first run). Nothing here calls an AI, spends or sends anything.
import { doc, putDoc } from "./store.js";

export const DOC = "versions";
export const MAX_VERSIONS = 30, MAX_CHAINS = 300, MAX_TEXT = 200_000;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const store = () => doc(DOC, () => ({ chains: [] }));
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const view = (v) => ({ n: v.n, runId: v.runId, text: v.text, prompt: v.prompt, how: v.how, note: v.note, at: v.at });

// Look a chain up by its key, or by any run that is in it.
export function listVersions(key, runId = "") {
  const d = store();
  const c = (key && d.chains.find((x) => x.key === String(key))) || (runId && d.chains.find((x) => x.versions.some((v) => v.runId === String(runId)))) || null;
  if (c) key = c.key;
  return { key: String(key || ""), title: c?.title || "", versions: (c?.versions || []).map(view) };
}

// how: "first" | "again" | "change". Adding the same run twice returns the version it already has.
export function addVersion({ key, runId, prompt = "", text = "", how = "first", note = "", title = "" } = {}) {
  const k = clip(key, 80);
  if (!k) throw bad("A result key is needed.");
  const body = String(text ?? "");
  if (!body.trim()) throw bad("There is no result to keep.");
  const d = store();
  let c = d.chains.find((x) => x.key === k);
  if (!c) {
    c = { key: k, title: clip(title || prompt, 90), updated: "", versions: [] };
    d.chains.push(c);
  }
  const rid = clip(runId, 80);
  const have = rid && c.versions.find((v) => v.runId === rid);
  if (have) return { added: false, version: view(have), count: c.versions.length };
  const n = (c.versions.reduce((m, v) => Math.max(m, v.n), 0)) + 1;
  const v = { n, runId: rid, text: body.slice(0, MAX_TEXT), prompt: clip(prompt, 2000), how: ["again", "change"].includes(how) ? how : "first", note: clip(note, 300), at: new Date().toISOString() };
  c.versions.push(v);
  // keep Version 1 and the newest ones
  while (c.versions.length > MAX_VERSIONS) c.versions.splice(1, 1);
  c.updated = v.at;
  if (d.chains.length > MAX_CHAINS) { d.chains.sort((a, b) => (a.updated < b.updated ? 1 : -1)); d.chains.length = MAX_CHAINS; }
  putDoc(DOC, d);
  return { added: true, version: view(v), count: c.versions.length };
}

export function versionLabel(v) { return `Version ${v.n}`; }

// The words sent to the AI for each button. The old text is quoted so the AI changes only what was asked.
export function tryAgainPrompt(prompt) { return String(prompt || "").trim(); }
export function changePartPrompt({ prompt = "", text = "", change = "" } = {}) {
  const ask = clip(change, 1500);
  if (!ask) throw bad("Say what to change.");
  return [
    String(prompt || "").trim(),
    "",
    "Here is the earlier result:",
    String(text || "").slice(0, 12000),
    "",
    `Change only this part and keep the rest the same: ${ask}`,
  ].join("\n").trim();
}
