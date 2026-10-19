import { settings, save, forget, parseCode, ping, send, grabPage } from "./shared.js";

const $ = (id) => document.getElementById(id);
const say = (t, cls = "") => { $("msg").textContent = t; $("msg").className = "msg " + cls; };
const DONE = { draft: "Sent: it is waiting in Marching orders.", chat: "Sent: the answer is coming in Meldmind.", council: "Sent: the council is meeting in Meldmind." };

async function show() {
  const s = await settings();
  $("pair").hidden = !!s.code; $("main").hidden = !s.code;
  if (!s.code) return;
  $("action").value = s.action;
  $("who").textContent = `Paired${s.name ? ` as "${s.name}"` : ""} with Meldmind on port ${s.port}.`;
  try { const p = await ping(s.code, s.port); $("who").textContent = `Paired${p.name ? ` as "${p.name}"` : ""} with Meldmind${p.version ? ` v${p.version}` : ""} on port ${p.port}.`; }
  catch (e) { say(e.message, "err"); }
}

$("do-pair").addEventListener("click", async () => {
  try {
    const c = parseCode($("code").value);
    say("Checking…");
    const p = await ping(c.code, c.port);
    await save({ code: c.code, port: p.port, name: p.name || "" });
    say("Paired.", "ok"); show();
  } catch (e) { say(e.message, "err"); }
});
$("action").addEventListener("change", () => save({ action: $("action").value }));
$("unpair").addEventListener("click", async () => { await forget(); say("Unpaired here. Also remove it in Meldmind > Settings > Browser extension."); show(); });

async function sendFromTab(selectionOnly) {
  say("Sending…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let page = { title: tab?.title || "", url: tab?.url || "", text: "", selection: "" };
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabPage }); if (r?.result) page = { ...page, ...r.result }; }
    catch { if (!/^https?:/.test(page.url)) throw new Error("The browser does not let extensions read this page. Try a normal web page."); }
    if (selectionOnly && !page.selection) throw new Error("Select some text on the page first.");
    const note = $("note").value.trim();
    await send(selectionOnly ? { kind: "selection", url: page.url, title: page.title, text: page.selection, note } : { kind: "page", url: page.url, title: page.title, text: page.text, note });
    say(DONE[$("action").value] || "Sent.", "ok");
  } catch (e) { say(e.message, "err"); }
}
$("send-page").addEventListener("click", () => sendFromTab(false));
$("send-sel").addEventListener("click", () => sendFromTab(true));
show();
