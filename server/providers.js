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

// extra headers saved with a custom provider (kept in the vault next to its key)
const extraHeaders = (provider) => { const s = getSecret(provider.id, provider.keyEnv); return { ...(s?.headers || {}), ...(provider.api === "anthropic" && s?.workspaceId ? { "anthropic-workspace-id": s.workspaceId } : {}) }; };

// ---------- tool calling (Phase 16, MCP) ----------
// Callers pass tools: [{ name, description, parameters }] (JSON schema). The transcript may then hold
//   { role: "assistant", content: text, toolCalls: [{ id, name, args }] }   what the model asked for
//   { role: "tool", id, name, content: text, isError }                       what the tool answered
// and "done" carries toolCalls: [{ id, name, args }] when the model stopped to call tools.
const textOf = (m) => (typeof m.content === "string" ? m.content : (m.content || []).map((c) => c.text || "").join("\n"));
const parseArgs = (s) => { if (s && typeof s === "object") return s; try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
// Anthropic shapes: tool_use blocks on the assistant turn, tool_result blocks grouped into one user turn.
function anthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({ role: "assistant", content: [...(textOf(m).trim() ? [{ type: "text", text: textOf(m) }] : []), ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args && typeof c.args === "object" ? c.args : {} }))] });
    } else if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.id, content: String(m.content ?? ""), ...(m.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) last.content.push(block);
      else out.push({ role: "user", content: [block] });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}
// OpenAI shapes: tool_calls on the assistant turn, one "tool" message per result.
function openaiMessages(messages) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) return { role: "assistant", content: textOf(m) || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args && typeof c.args === "object" ? c.args : {}) } })) };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.id, content: String(m.content ?? "") };
    return { role: m.role, content: textOf(m) };
  });
}

// ---------- Anthropic (official SDK) ----------
async function* anthropicStream({ provider, model, system, messages, maxTokens, effort, signal, tools }) {
  const client = new Anthropic({ apiKey: requireKey(provider), baseURL: provider.baseUrl, maxRetries: 1, defaultHeaders: extraHeaders(provider) });
  const params = {
    model,
    max_tokens: maxTokens,
    messages: tools?.length || messages.some((m) => m.role === "tool" || m.toolCalls) ? anthropicMessages(messages) : messages,
    ...(system ? { system } : {}),
    ...(effort ? { output_config: { effort } } : {}),
    ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
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
    const toolCalls = (final.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input && typeof b.input === "object" ? b.input : {} }));
    yield {
      type: "done",
      stop: final.stop_reason,
      toolCalls: toolCalls.length ? toolCalls : undefined,
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
async function* openaiCompatStream({ provider, model, system, messages, maxTokens, signal, webSearch, maxSources, tools }) {
  const key = requireKey(provider);
  const msgs = [...(system ? [{ role: "system", content: system }] : []), ...openaiMessages(messages)];
  const body = { model, messages: msgs, stream: true };
  if (tools?.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (provider.id === "openai") body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  if (provider.id !== "perplexity") body.stream_options = { include_usage: true };
  // the model's own web search (Phase 15): xAI Live Search is asked for explicitly; Perplexity Sonar always searches
  if (webSearch && provider.id === "xai") body.search_parameters = { mode: "on", return_citations: true, max_search_results: Math.min(20, Math.max(1, maxSources || 5)) };
  const headers = { ...extraHeaders(provider), "content-type": "application/json", ...(key && key !== "no-key" ? { authorization: `Bearer ${key}` } : {}) };
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
  let buf = "", usage = null, outText = "", stop = null, actualModel = null, citations = null, searchResults = null;
  const calls = new Map(); // index -> { id, name, args (json text) } assembled from streamed fragments
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
      for (const tc of ch?.delta?.tool_calls || []) {
        const i = tc.index ?? calls.size;
        const cur = calls.get(i) || { id: null, name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(i, cur);
      }
      // a non-streaming answer shape (some gateways ignore stream: true)
      for (const tc of ch?.message?.tool_calls || []) calls.set(calls.size, { id: tc.id, name: tc.function?.name || "", args: tc.function?.arguments || "" });
      if (ch?.finish_reason) stop = ch.finish_reason;
      // Perplexity and xAI send the pages they used: citations = URLs, search_results = { title, url } rows
      if (Array.isArray(j.citations) && j.citations.length) citations = j.citations;
      if (Array.isArray(j.search_results) && j.search_results.length) searchResults = j.search_results;
    }
  }
  const cited = searchResults ? searchResults.map((r) => ({ url: r.url, title: r.title })) : citations;
  const toolCalls = [...calls.values()].filter((c) => c.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, args: parseArgs(c.args) }));
  yield {
    type: "done",
    stop,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    citations: cited || undefined,
    usage: {
      input: usage?.prompt_tokens ?? approxTokens(msgs.map((m) => m.content || "").join("\n")),
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
