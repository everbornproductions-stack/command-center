// Instant two-way voice (0.4.21): OpenAI Realtime over WebRTC, or an ElevenLabs Agent over a socket.
// The server mints a short-lived token (POST /api/voice/realtime), so the real key never reaches the page.
// The handlers are plain functions so tests feed them events with no network and no microphone.
// The app owns approvals: a tool call goes through the same controller as a typed command, so publish,
// delete, send and spend still wait for a spoken or clicked "yes".

const textOf = (v) => (typeof v === "string" ? v : "");

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try { const j = JSON.parse(String(raw || "{}")); return j && typeof j === "object" ? j : {}; } catch { return {}; }
}

// What the model is told after a tool ran. A risky tool answers "waiting for yes" and the model says so.
export function toolOutput(result) {
  if (!result) return "Done.";
  if (result.waiting) return `Waiting for the user to say yes: ${result.say || "confirm"}. Ask them and do not repeat the action.`;
  if (result.ok === false) return `It did not work: ${result.say || "unknown"}`;
  return result.say || "Done.";
}

// One OpenAI Realtime server event. ctx = { controller, send(obj), onState(state), onHeard(text), onReply(text) }.
export async function handleOpenAIEvent(evt, ctx) {
  const t = evt?.type;
  if (t === "input_audio_buffer.speech_started") { ctx.onState?.("listening"); ctx.send?.({ type: "output_audio_buffer.clear" }); return "barge-in"; }
  if (t === "input_audio_buffer.speech_stopped") { ctx.onState?.("thinking"); return "thinking"; }
  if (t === "conversation.item.input_audio_transcription.completed") {
    const heard = textOf(evt.transcript).trim();
    if (heard) ctx.onHeard?.(heard);
    // "stop" is local: the app stops the voice at once without waiting for the model.
    if (heard && ctx.controller?.isStopWord?.(heard)) { ctx.send?.({ type: "response.cancel" }); ctx.send?.({ type: "output_audio_buffer.clear" }); await ctx.controller.hear(heard); return "stop"; }
    return "heard";
  }
  if (t === "response.output_audio.delta" || t === "response.audio.delta" || t === "output_audio_buffer.started") { ctx.onState?.("speaking"); return "speaking"; }
  if (t === "response.output_audio_transcript.done" || t === "response.audio_transcript.done") { ctx.onReply?.(textOf(evt.transcript)); return "reply"; }
  if (t === "response.done" || t === "output_audio_buffer.stopped") { ctx.onState?.("listening"); return "listening"; }
  if (t === "response.function_call_arguments.done" || (t === "response.output_item.done" && evt.item?.type === "function_call")) {
    const name = evt.name || evt.item?.name;
    const callId = evt.call_id || evt.item?.call_id;
    const args = parseArgs(evt.arguments ?? evt.item?.arguments);
    if (!name || !callId) return "ignored";
    ctx.onState?.("thinking");
    const result = await ctx.controller.runAction(name, args);
    ctx.send?.({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: toolOutput(result) } });
    ctx.send?.({ type: "response.create" });
    return "tool";
  }
  return "ignored";
}

// One ElevenLabs Agent socket message. ctx adds playPcm(base64), clearAudio().
export async function handleElevenEvent(msg, ctx) {
  const t = msg?.type;
  if (t === "ping") { ctx.send?.({ type: "pong", event_id: msg.ping_event?.event_id }); return "pong"; }
  if (t === "audio") { ctx.onState?.("speaking"); ctx.playPcm?.(msg.audio_event?.audio_base_64 || ""); return "speaking"; }
  if (t === "interruption") { ctx.clearAudio?.(); ctx.onState?.("listening"); return "barge-in"; }
  if (t === "user_transcript") { const h = textOf(msg.user_transcription_event?.user_transcript).trim(); if (h) ctx.onHeard?.(h); ctx.onState?.("thinking"); return "heard"; }
  if (t === "agent_response") { ctx.onReply?.(textOf(msg.agent_response_event?.agent_response)); ctx.onState?.("listening"); return "reply"; }
  if (t === "client_tool_call") {
    const c = msg.client_tool_call || {};
    if (!c.tool_name || !c.tool_call_id) return "ignored";
    ctx.onState?.("thinking");
    const result = await ctx.controller.runAction(c.tool_name, parseArgs(c.parameters));
    ctx.send?.({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: toolOutput(result), is_error: result?.ok === false && !result?.waiting });
    return "tool";
  }
  return "ignored";
}

// ---- browser connectors (not run by tests; the handlers above are) ----
export async function connectOpenAI(session, ctx) {
  const pc = new RTCPeerConnection();
  const audio = document.createElement("audio");
  audio.autoplay = true;
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  pc.addTrack(mic.getAudioTracks()[0], mic);
  const dc = pc.createDataChannel("oai-events");
  const send = (o) => { try { if (dc.readyState === "open") dc.send(JSON.stringify(o)); } catch { /* closed */ } };
  dc.onmessage = (e) => { let j; try { j = JSON.parse(e.data); } catch { return; } void handleOpenAIEvent(j, { ...ctx, send }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(session.url, { method: "POST", body: offer.sdp, headers: { authorization: `Bearer ${session.secret}`, "content-type": "application/sdp" } });
  if (!res.ok) { mic.getTracks().forEach((t) => t.stop()); pc.close(); throw new Error(`Instant voice could not start (${res.status}).`); }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return {
    engine: "openai",
    cancel() { send({ type: "response.cancel" }); send({ type: "output_audio_buffer.clear" }); },
    close() { try { dc.close(); } catch {} try { pc.close(); } catch {} mic.getTracks().forEach((t) => t.stop()); audio.srcObject = null; },
  };
}

function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

export async function connectEleven(session, ctx) {
  const ws = new WebSocket(session.signedUrl);
  const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
  const src = actx.createMediaStreamSource(mic);
  const proc = actx.createScriptProcessor(4096, 1, 1);
  const send = (o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch { /* closed */ } };
  let playAt = 0;
  const sources = new Set();
  const playPcm = (b64) => {
    if (!b64) return;
    const bytes = b64ToBytes(b64);
    const f = new Float32Array(bytes.length / 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < f.length; i++) f[i] = dv.getInt16(i * 2, true) / 32768;
    const buf = actx.createBuffer(1, f.length, 16000);
    buf.copyToChannel(f, 0);
    const s = actx.createBufferSource();
    s.buffer = buf; s.connect(actx.destination);
    playAt = Math.max(playAt, actx.currentTime);
    s.start(playAt); playAt += buf.duration;
    sources.add(s); s.onended = () => sources.delete(s);
  };
  const clearAudio = () => { for (const s of sources) { try { s.stop(); } catch {} } sources.clear(); playAt = 0; };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("Instant voice could not start.")); });
  send({ type: "conversation_initiation_client_data" });
  ws.onmessage = (e) => { let j; try { j = JSON.parse(e.data); } catch { return; } void handleElevenEvent(j, { ...ctx, send, playPcm, clearAudio }); };
  proc.onaudioprocess = (e) => {
    const f = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
    let bin = ""; const u = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    send({ user_audio_chunk: btoa(bin) });
  };
  src.connect(proc); proc.connect(actx.destination);
  return {
    engine: "elevenlabs",
    cancel() { clearAudio(); },
    close() { try { ws.close(); } catch {} try { proc.disconnect(); src.disconnect(); } catch {} mic.getTracks().forEach((t) => t.stop()); try { actx.close(); } catch {} },
  };
}

// session = the reply of POST /api/voice/realtime. Returns a handle with close() and cancel(), or null for engine "none".
export async function connectInstant(session, ctx) {
  if (session?.engine === "openai") return connectOpenAI(session, ctx);
  if (session?.engine === "elevenlabs") return connectEleven(session, ctx);
  return null;
}
