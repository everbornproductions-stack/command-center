// Fit check for the Publish panel (0.4.21, M4 M14): turns the server's problem lines into one plain line
// each, with the one fix that clears it. Pure, so tests can call it.
// A fix is { id, label }: "link" focuses the link box, "drive" switches to Google Drive, "account" and "room"
// point at the picker, "time" at the time box.
export function fitFixes(problems = [], channel = "") {
  const out = [];
  for (const raw of problems) {
    const p = String(raw || "");
    if (!p) continue;
    let fix = null;
    if (/public https link|needs a picture or video|public link/i.test(p)) fix = { id: "link", label: "Paste a link" };
    else if (/connected social account/i.test(p)) fix = { id: "account", label: "Pick an account" };
    else if (/channel/i.test(p) && channel === "slack") fix = { id: "room", label: "Pick a channel" };
    else if (/in the past/i.test(p)) fix = { id: "time", label: "Change the time" };
    if (fix && fix.id === "link" && channel !== "drive") out.push({ text: p, fix, alt: { id: "drive", label: "Save to Drive instead" } });
    else out.push({ text: p, fix });
  }
  return out;
}

// What extra boxes a place needs, in plain words.
export function fieldsFor(channel, kind) {
  const f = [];
  if (channel === "instagram") f.push({ id: "link", label: kind === "text" ? "Public link to the picture or video (your words become the caption)" : "Public link to the picture or video (leave empty if this item already has one)" });
  if (channel === "ghl") { f.push({ id: "account", label: "Which accounts" }); f.push({ id: "time", label: "Post later (optional)" }); f.push({ id: "link", label: "Public link to a picture or video (optional)" }); }
  if (channel === "slack") f.push({ id: "room", label: "Which channel" });
  return f;
}
