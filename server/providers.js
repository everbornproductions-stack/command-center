// Streaming chat adapters. One async generator per API family.
// Yields { type: "delta", text } ... then { type: "done", usage: { input, output }, stop }.
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, geminiBase } from "./registry.js";
import { providerMessage } from "./health.js";
import { getSecret } from "./vault.js";
import { doc } from "./store.js";
import { cacheSystem } from "./savings.js";

export class ProviderError extends Error {
  constructor(provider, status, message, body) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.body = body && typeof body === "object" ? body : null;
  }
}

// Keep the parsed body on the error so health lights can tell credits from a bad key.
function providerFailure(provider, status, txt) {
  let j = null;
  try { j = JSON.parse(txt || ""); } catch { /* not JSON */ }
  const err = new ProviderError(provider.id, status, `${provider.name}: HTTP ${status} ${providerMessage(j, txt)}`, j);
  err.text = String(txt || "").slice(0, 400);
  return err;
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
// Images (Phase 6, chat with files): a user turn's content may be a list of { type: "text", text } and
// { type: "image", mime, data (base64) } parts; each API gets its own shape.
const hasImage = (m) => Array.isArray(m.content) && m.content.some((c) => c?.type === "image");
const openaiParts = (m) => m.content.map((c) => (c.type === "image" ? { type: "image_url", image_url: { url: `data:${c.mime};base64,${c.data}` } } : { type: "text", text: c.text || "" }));
const anthropicParts = (m) => m.content.map((c) => (c.type === "image" ? { type: "image", source: { type: "base64", media_type: c.mime, data: c.data } } : { type: "text", text: c.text || "" }));
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
    } else out.push({ role: m.role, content: hasImage(m) ? anthropicParts(m) : m.content });
  }
  return out;
}
// OpenAI shapes: tool_calls on the assistant turn, one "tool" message per result.
function openaiMessages(messages) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) return { role: "assistant", content: textOf(m) || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args && typeof c.args === "object" ? c.args : {}) } })) };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.id, content: String(m.content ?? "") };
    if (hasImage(m)) return { role: m.role, content: openaiParts(m) };
    return { role: m.role, content: textOf(m) };
  });
}

export const messageShapes = { anthropic: anthropicMessages, openai: openaiMessages }; // for tests

// ---------- Anthropic (official SDK) ----------
async function* anthropicStream({ provider, model, system, messages, maxTokens, effort, signal, tools }) {
  const client = new Anthropic({ apiKey: requireKey(provider), baseURL: provider.baseUrl, maxRetries: 1, defaultHeaders: extraHeaders(provider) });
  const systemBody = cacheSystem(system);
  const params = {
    model,
    max_tokens: maxTokens,
    messages: tools?.length || messages.some((m) => m.role === "tool" || m.toolCalls || hasImage(m)) ? anthropicMessages(messages) : messages,
    ...(systemBody ? { system: systemBody } : {}),
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
        cacheRead: final.usage?.cache_read_input_tokens || 0,
        cacheRate: "anthropic",
      },
    };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(provider.id, e.status || 500, `${provider.name}: ${e.message}`, e.error || null);
  }
}

// ---------- Google Gemini native (generativelanguage). AQ. auth keys are rejected on the OpenAI-compatible Bearer route. ----------
function geminiContents(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({ role: "model", parts: [...(textOf(m).trim() ? [{ text: textOf(m) }] : []), ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args && typeof c.args === "object" ? c.args : {} } }))] });
    } else if (m.role === "tool") {
      const block = { functionResponse: { name: m.name || "tool", response: { result: String(m.content ?? "") } } };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.parts) && last.parts.every((p) => p.functionResponse)) last.parts.push(block);
      else out.push({ role: "user", parts: [block] });
    } else if (hasImage(m)) {
      out.push({ role: m.role === "assistant" ? "model" : "user", parts: m.content.map((c) => (c.type === "image" ? { inlineData: { mimeType: c.mime, data: c.data } } : { text: c.text || "" })) });
    } else {
      const text = textOf(m);
      if (!text) continue;
      out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
    }
  }
  return out;
}
async function* geminiStream({ provider, model, system, messages, maxTokens, signal, tools }) {
  const key = requireKey(provider);
  const contents = geminiContents(messages);
  const body = { contents: contents.length ? contents : [{ role: "user", parts: [{ text: "" }] }], generationConfig: { maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description || "", parameters: t.parameters || { type: "object", properties: {} } })) }];
  // Key in the header only. Never a query string, never Authorization: Bearer (that 400s an AQ. key).
  const headers = { "content-type": "application/json", "x-goog-api-key": key };
  const url = `${geminiBase(provider)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  let res;
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (e) { throw new ProviderError(provider.id, 0, `${provider.name}: network error (${e.message})`); }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw providerFailure(provider, res.status, txt);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", outText = "", stop = null, usage = null;
  const calls = [];
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
      if (!data || data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new ProviderError(provider.id, j.error.code || 400, `${provider.name}: ${providerMessage(j, "")}`, j);
      if (j.usageMetadata) usage = j.usageMetadata;
      const cand = j.candidates?.[0];
      if (cand?.finishReason) stop = cand.finishReason === "STOP" ? "stop" : cand.finishReason === "MAX_TOKENS" ? "length" : String(cand.finishReason).toLowerCase();
      for (const part of cand?.content?.parts || []) {
        if (part.text) { outText += part.text; yield { type: "delta", text: part.text }; }
        if (part.functionCall?.name) calls.push({ name: part.functionCall.name, args: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : parseArgs(part.functionCall.args) });
      }
    }
  }
  const toolCalls = calls.map((c, i) => ({ id: `call_${i}_${c.name}`, name: c.name, args: c.args }));
  yield {
    type: "done",
    stop: toolCalls.length ? "tool_calls" : stop,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: {
      input: usage?.promptTokenCount ?? approxTokens([system || "", ...messages.map((m) => textOf(m))].join("\n")),
      output: usage?.candidatesTokenCount ?? approxTokens(outText),
      estimated: !usage,
    },
  };
}

// ---------- OpenAI-compatible chat completions (OpenAI, xAI, OpenRouter, Perplexity, DeepSeek, Groq, Mistral) ----------
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
    headers["X-Title"] = "Meldmind";
  }
  let res;
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new ProviderError(provider.id, 0, `${provider.name}: network error (${e.message})`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw providerFailure(provider, res.status, txt);
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
      cacheRead: usage?.prompt_tokens_details?.cached_tokens || 0,
      cacheRate: "openai",
      // OpenRouter returns the exact billed amount in USD; others do not
      cost: typeof usage?.cost === "number" ? usage.cost : undefined,
      actualModel: actualModel && actualModel !== model ? actualModel : undefined,
    },
  };
}

// Spend caps (alerts plugin): a provider at 100% of its monthly cap is never called, even when no
// other AI is left. Read only; the alerts plugin owns that document.
function capStopped(pid) { try { return (doc("alerts.state", () => undefined)?.stop || []).includes(pid); } catch { return false; } }

export function streamChat(opts) {
  const provider = typeof opts.provider === "string" ? PROVIDERS[opts.provider] : opts.provider;
  if (!provider || provider.kind !== "text") throw new ProviderError(opts.provider?.id || opts.provider, 400, "Unknown text provider");
  if (capStopped(provider.id)) { const e = new ProviderError(provider.id, 402, `${provider.name} has reached its monthly spend cap. Raise the cap in Settings or wait for next month.`); e.code = "cap"; throw e; }
  const o = { ...opts, provider, maxTokens: opts.maxTokens || 4096 };
  if (provider.api === "anthropic") return anthropicStream(o);
  if (provider.api === "gemini" || provider.id === "google") return geminiStream(o);
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
