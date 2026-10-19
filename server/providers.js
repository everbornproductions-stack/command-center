// Streaming chat adapters. One async generator per API family.
// Yields { type: "delta", text } ... then { type: "done", usage: { input, output }, stop }.
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS } from "./registry.js";
import { getSecret } from "./vault.js";

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

function approxTokens(text) {
  return Math.ceil((text || "").length / 4);
}

export function requireKey(provider) {
  const s = getSecret(provider.id, provider.keyEnv);
  if (!s) throw new ProviderError(provider.id, 401, `${provider.name}: no API key saved. Add it in Settings.`);
  return s.key;
}

// ---------- Anthropic (official SDK) ----------
async function* anthropicStream({ provider, model, system, messages, maxTokens, effort, signal }) {
  const client = new Anthropic({ apiKey: requireKey(provider), baseURL: provider.baseUrl, maxRetries: 1 });
  const params = {
    model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {}),
    ...(effort ? { output_config: { effort } } : {}),
  };
  let stream;
  try {
    stream = client.messages.stream(params, { signal });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield { type: "delta", text: ev.delta.text };
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield { type: "delta", text: "\n\n[Claude declined this request (safety refusal).]" };
    }
    yield {
      type: "done",
      stop: final.stop_reason,
      usage: {
        input: (final.usage?.input_tokens || 0) + (final.usage?.cache_read_input_tokens || 0) + (final.usage?.cache_creation_input_tokens || 0),
        output: final.usage?.output_tokens || 0,
      },
    };
  } catch (e) {
    throw new ProviderError(provider.id, e.status || 500, `${provider.name}: ${e.message}`);
  }
}

// ---------- OpenAI-compatible chat completions (OpenAI, xAI, Gemini, OpenRouter, Perplexity, DeepSeek, Groq, Mistral) ----------
async function* openaiCompatStream({ provider, model, system, messages, maxTokens, signal }) {
  const key = requireKey(provider);
  const msgs = [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((c) => c.text || "").join("\n") }))];
  const body = { model, messages: msgs, stream: true };
  if (provider.id === "openai") body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  if (provider.id !== "perplexity") body.stream_options = { include_usage: true };
  const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://everbornproductions.com";
    headers["X-Title"] = "Command AI";
  }
  let res;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new ProviderError(provider.id, 0, `${provider.name}: network error (${e.message})`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt.slice(0, 300);
    try { msg = JSON.parse(txt).error?.message || msg; } catch {}
    throw new ProviderError(provider.id, res.status, `${provider.name}: HTTP ${res.status} ${msg}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", usage = null, outText = "", stop = null, actualModel = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.usage) usage = j.usage;
      if (j.model) actualModel = j.model;
      const ch = j.choices?.[0];
      const t = ch?.delta?.content;
      if (t) { outText += t; yield { type: "delta", text: t }; }
      if (ch?.finish_reason) stop = ch.finish_reason;
      if (j.citations && provider.id === "perplexity") j._citations = j.citations;
    }
  }
  yield {
    type: "done",
    stop,
    usage: {
      input: usage?.prompt_tokens ?? approxTokens(msgs.map((m) => m.content).join("\n")),
      output: usage?.completion_tokens ?? approxTokens(outText),
      estimated: !usage,
      // OpenRouter returns the exact billed amount in USD; others do not
      cost: typeof usage?.cost === "number" ? usage.cost : undefined,
      actualModel: actualModel && actualModel !== model ? actualModel : undefined,
    },
  };
}

export function streamChat(opts) {
  const provider = typeof opts.provider === "string" ? PROVIDERS[opts.provider] : opts.provider;
  if (!provider || provider.kind !== "text") throw new ProviderError(opts.provider?.id || opts.provider, 400, "Unknown text provider");
  const o = { ...opts, provider, maxTokens: opts.maxTokens || 4096 };
  if (provider.api === "anthropic") return anthropicStream(o);
  return openaiCompatStream(o);
}

// Non-streaming convenience: collects the whole answer.
export async function complete(opts, onDelta) {
  let text = "";
  let usage = { input: 0, output: 0 };
  let stop = null;
  for await (const ev of streamChat(opts)) {
    if (ev.type === "delta") { text += ev.text; onDelta?.(ev.text); }
    else if (ev.type === "done") { usage = ev.usage; stop = ev.stop; }
  }
  return { text, usage, stop };
}

// Pull a JSON object out of a model answer that may be wrapped in prose or fences.
export function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { return JSON.parse(c.slice(s, e + 1)); } catch {}
    }
  }
  return null;
}
