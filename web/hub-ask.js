// "Ask Meldmind about this" and "Make another like this" in the MindMedia inspector (0.4.21, H2).
// Pure: builds the words that go into the chat box. Nothing is sent; the person presses Go.
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const KIND = { image: "picture", video: "video", audio: "audio", text: "text", site: "site", file: "file" };

export function askAbout(item = {}, text = "") {
  const name = clip(item.name, 80) || "this item";
  const body = clip(text, 1200);
  return `About my saved ${KIND[item.kind] || "item"} "${name}"${body ? `:\n"${body}"` : "."}\n\nMy question: `;
}

export function makeAnother(item = {}) {
  const name = clip(item.name, 80) || "this item";
  const prompt = clip(item.provenance?.prompt || item.prompt, 600);
  return `Make another ${KIND[item.kind] || "one"} like "${name}"${prompt ? `. The first request was: ${prompt}` : ""}.\nWhat to change: `;
}
