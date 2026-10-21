// Upload and voice for a text box. The words land in the box. Nothing is sent from here.
const { api, toast } = window.CC;

export const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.markdown,.csv,.doc,.docx";

function blobToB64(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
    return btoa(bin);
  });
}

function readB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const cut = raw.indexOf(",");
      resolve(cut >= 0 ? raw.slice(cut + 1) : raw);
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function appendText(box, text) {
  const extra = String(text || "").replace(/^\s+|\s+$/g, "");
  if (!box || !extra) return;
  const cur = box.value || "";
  if (!cur) box.value = extra;
  else {
    const joiner = extra.includes("\n") ? "\n" : " ";
    box.value = `${cur.replace(/\s+$/, "")}${joiner}${extra}`;
  }
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

export function wireVoice(button, { getBox, status }) {
  if (!button) return;
  let rec = null;
  let stream = null;
  button.addEventListener("click", async () => {
    if (rec) {
      button.disabled = true;
      if (status) status.textContent = "Transcribing...";
      const blob = await rec.stop();
      rec = null;
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      stream = null;
      try {
        const audio = await blobToB64(blob);
        const heard = await api("/voice/dictate", { method: "POST", body: { mime: blob.type || "audio/webm", audio } });
        const box = getBox();
        if (heard.text) appendText(box, heard.text);
        if (status) status.textContent = heard.text
          ? "Edit the words, then send when you are ready. Nothing is sent yet."
          : "No words were heard. Try again.";
      } catch (e) {
        if (status) status.textContent = "";
        toast(e.message, true);
      }
      button.textContent = "Voice";
      button.setAttribute("aria-pressed", "false");
      button.disabled = false;
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("Voice needs a microphone in this browser or the desktop app.", true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      media.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const stopped = new Promise((resolve) => {
        media.onstop = () => resolve(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
      });
      media.start();
      rec = {
        stop() {
          try { if (media.state !== "inactive") media.stop(); } catch { /* already stopped */ }
          return stopped;
        },
      };
      button.textContent = "Stop";
      button.setAttribute("aria-pressed", "true");
      if (status) status.textContent = "Recording. Click Stop, then edit the words. Nothing is sent yet.";
    } catch {
      toast("The microphone is blocked.", true);
    }
  });
}

export function wireUpload(button, input, { url, onSaved, status, before = [] }) {
  if (!button || !input) return { take: async () => {} };
  const take = async (files) => {
    const list = [...files].filter(Boolean);
    if (!list.length) return;
    if (before.length + list.length > 4) toast("Up to 4 files.", true);
    for (const file of list.slice(0, Math.max(0, 4 - before.length))) {
      if (file.size > 4 * 1024 * 1024) {
        toast("That file is over 4 MB.", true);
        continue;
      }
      try {
        const data = await readB64(file);
        const saved = await api(url, { method: "POST", body: { name: file.name, mime: file.type || "application/octet-stream", data } });
        onSaved(saved);
        if (status) status.textContent = "The file stays on this computer. Edit the words, then send when you are ready.";
      } catch (e) { toast(e.message, true); }
    }
  };
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    take(files);
  });
  return { take };
}
