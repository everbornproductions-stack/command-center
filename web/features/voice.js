// Voice orders: a mic button next to "Send orders". Uses the browser's speech recognition
// (Chrome, Edge, the Electron shell). Push-to-talk by default; "auto-send" sends when you stop talking.
const { $, toast } = window.CC;

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

CC.register({
  id: "voice",
  command: { order: 1, render(el) {
    if (!SR) { el.innerHTML = `<div class="dim small" style="margin-top:6px">Voice orders need Chrome, Edge or the desktop app (no speech recognition in this browser). Wispr Flow dictation works in the box above.</div>`; return; }
    el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px"><button class="btn sm" id="vo-mic" title="Hold to talk, release to stop">🎙 Hold to talk</button><label class="row small" style="gap:4px"><input type="checkbox" id="vo-auto"> auto-send</label><span class="dim" id="vo-status"></span></div>`;
    const btn = el.querySelector("#vo-mic"), status = el.querySelector("#vo-status");
    let rec = null, finalText = "";
    const start = () => {
      if (rec) return;
      rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; finalText = "";
      const box = $("#orders"); const base = box.value.trim();
      rec.onresult = (e) => { let interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t + " "; else interim += t; } box.value = (base ? base + " " : "") + finalText + interim; box.dispatchEvent(new Event("input")); };
      rec.onerror = (e) => { status.textContent = e.error === "not-allowed" ? "microphone blocked in the browser" : `mic: ${e.error}`; stop(); };
      rec.onend = () => { rec = null; btn.classList.remove("primary"); status.textContent = finalText ? "captured" : ""; if (finalText && el.querySelector("#vo-auto").checked) $("#go")?.click(); };
      try { rec.start(); btn.classList.add("primary"); status.textContent = "listening…"; } catch (e) { toast(e.message, true); rec = null; }
    };
    const stop = () => { try { rec?.stop(); } catch {} };
    btn.addEventListener("mousedown", start); btn.addEventListener("touchstart", (e) => { e.preventDefault(); start(); });
    btn.addEventListener("mouseup", stop); btn.addEventListener("mouseleave", stop); btn.addEventListener("touchend", stop);
    btn.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); rec ? stop() : start(); } });
  } },
});
