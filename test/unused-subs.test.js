// 0.4.21 item 14: the weekly report flags subscriptions not used through Meldmind in 30 days.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unusedSubscriptions, unusedLines, usedProviders } from "../server/unused-subs.js";

const NOW = Date.UTC(2026, 9, 26, 12);
const day = 86400000;
const subs = [
  { id: "claude", name: "Claude", provider: "anthropic", monthly: 20 },
  { id: "chatgpt", name: "ChatGPT", provider: "openai", listPrice: 20, monthly: null },
  { id: "grok", name: "Grok", provider: "xai", monthly: 30 },
  { id: "gem", name: "Gemini", provider: "google", monthly: 20 },
  { id: "new", name: "Fresh AI", provider: "groq", monthly: 5, addedAt: NOW - 3 * day },
  { id: "nf", name: "Netflix", provider: null, monthly: 15 },
  { id: "free", name: "Unpriced", provider: "xai", monthly: null },
];
const entries = [
  { kind: "call", provider: "anthropic", ts: NOW - 40 * day }, // too old
  { kind: "call", provider: "plan-codex", ts: NOW - 2 * day }, // used through the signed-in app
  { kind: "credits", provider: "xai", ts: NOW - 1 * day },       // a balance note is not use
  { kind: "image", provider: "plan-gemini-cli", ts: NOW - 5 * day },
];

test("a call through the API or the signed-in app in the last 30 days counts as use", () => {
  assert.deepEqual([...usedProviders(entries, NOW)].sort(), ["plan-codex", "plan-gemini-cli"]);
  const { unused } = unusedSubscriptions(subs, entries, NOW);
  assert.deepEqual(unused.map((s) => s.id), ["claude", "grok"], "ChatGPT (via Codex) and Gemini (via Gemini CLI) were used");
});

test("a new subscription, an unpriced one and one Meldmind cannot see are not called unused", () => {
  const { unused, unknown } = unusedSubscriptions(subs, entries, NOW);
  assert.ok(!unused.some((s) => ["new", "free", "nf"].includes(s.id)));
  assert.deepEqual(unknown.map((s) => s.id), ["nf"]);
});

test("report lines: plain words, price, and no em-dashes", () => {
  const lines = unusedLines(subs, entries, NOW);
  assert.match(lines[0], /\*\*Claude\*\*: not used through Meldmind in 30 days, \$20\/month/);
  assert.match(lines.at(-1), /cannot see use of Netflix/);
  assert.ok(!lines.join("\n").includes("—"));
  assert.deepEqual(unusedLines([{ name: "A", provider: "xai", monthly: 3 }], [{ kind: "call", provider: "xai", ts: NOW }], NOW), []);
});
