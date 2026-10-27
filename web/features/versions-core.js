// Pure helpers for web/features/versions.js (no page needed, so node tests can import this file).

// Tabs: Version 1, 2, 3 ... with the shown one marked.
export function versionTabs(versions = [], showing) {
  return versions.map((v) => ({ n: v.n, label: `Version ${v.n}`, on: v.n === showing }));
}

const STATUS = { done: "done", running: "working", failed: "did not finish", error: "did not finish", incomplete: "incomplete", pending: "waiting" };

// The "Show steps" list: one plain line per step.
export function stepRows(run) {
  const raw = run?.mission?.tasks || Object.values(run?.tasks || {});
  return (raw || []).filter((t) => t && t.title).map((t, i) => {
    const bits = [`${i + 1}. ${t.title}`];
    const st = STATUS[t.status] || t.status;
    if (st) bits.push(st);
    if (t.provider) bits.push(`by ${t.providerName || t.provider}`);
    return { n: i + 1, line: bits.join(", ") };
  });
}

// Line shown under the prompt box. No em-dashes.
export function costLineHtml(r, esc = (s) => String(s)) {
  if (!r?.line) return "";
  return `${esc(r.line)}${r.free ? "" : ". You can change this under Priority."}`;
}
