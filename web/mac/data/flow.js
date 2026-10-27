// Mac part "flow" (0.4.23): pure logic for the Simple 3 step flow. No DOM, no network.
// State: { path, step, style, text, photos[], runId }. Steps: home, style, tell, working, done, incomplete.
// Every function returns a new state; the old one is never changed.

export const PATHS = ["website", "image", "video", "campaign", "mod"];
export const STEPS = ["home", "style", "tell", "working", "done", "incomplete"];

export const PATH_LABEL = { website: "Website", image: "Image", video: "Video", campaign: "Campaign", mod: "Game mod" };
export const FINISH_LABEL = { website: "Publish site", image: "Download image", video: "Download video", campaign: "Post campaign", mod: "Download mod" };
export const TELL_HINT = {
  website: "Tell us about your business in one sentence.",
  image: "Say what the picture should show.",
  video: "Say what should happen in the video.",
  campaign: "Tell us about your business and who it is for.",
  mod: "Say what your mod should change in the game.",
};
export const HOME_TITLE = "What do you want to make?";
export const STEP_NUMBER = { style: 1, tell: 2, working: 2, done: 3, incomplete: 3 };
export const STEP_NAMES = ["Pick a style", "Tell us about it", "Done"];

// A small list used only when the cards part has no data yet. Three styles per path, the first is the popular one.
export const FALLBACK_STYLES = {
  website: [
    { id: "clean", title: "Clean and simple", desc: "Light, easy to read, lots of space.", style: "clean and simple with plenty of white space", popular: true },
    { id: "bold", title: "Bold and colorful", desc: "Big headlines and strong colors.", style: "bold and colorful with big headlines" },
    { id: "warm", title: "Warm and friendly", desc: "Soft colors and a personal feel.", style: "warm and friendly with soft colors" },
  ],
  image: [
    { id: "photo", title: "Real photo", desc: "Looks like a photograph.", style: "a realistic photograph", popular: true },
    { id: "paint", title: "Painting", desc: "Soft brush strokes and rich color.", style: "an oil painting" },
    { id: "cartoon", title: "Cartoon", desc: "Fun, bright and playful.", style: "a bright, playful cartoon" },
  ],
  video: [
    { id: "calm", title: "Calm and smooth", desc: "Slow, gentle movement.", style: "calm and smooth, slow camera movement", popular: true },
    { id: "lively", title: "Lively", desc: "Quick, fun and full of energy.", style: "lively and energetic" },
    { id: "movie", title: "Movie look", desc: "Dramatic light, like a film.", style: "cinematic, dramatic light" },
  ],
  campaign: [
    { id: "friendly", title: "Friendly week", desc: "A week of warm, simple posts.", style: "friendly and helpful", popular: true },
    { id: "sale", title: "Big sale", desc: "Posts that push one offer.", style: "focused on one special offer" },
    { id: "story", title: "Tell my story", desc: "Posts about who you are.", style: "personal, telling the story behind the business" },
  ],
  mod: [
    { id: "fun", title: "Just for fun", desc: "A small, silly change.", style: "a small, fun change", popular: true },
    { id: "harder", title: "Harder game", desc: "Tougher enemies and rules.", style: "a harder, more challenging game" },
    { id: "new", title: "Something new", desc: "A new item or place.", style: "a brand new item or place" },
  ],
};

export function isPath(p) { return PATHS.includes(p); }

export function initial() {
  return { path: "", step: "home", style: null, text: "", photos: [], runId: "" };
}

// Turn whatever the cards part gives (or nothing) into a clean list of styles for a path.
export function stylesFor(path, fromCards) {
  const src = Array.isArray(fromCards) && fromCards.length ? fromCards : FALLBACK_STYLES[path] || [];
  return src.filter((s) => s && (s.id || s.title)).map((s, i) => ({
    id: String(s.id || s.title),
    title: String(s.title || s.name || s.id),
    desc: String(s.desc || s.description || ""),
    style: String(s.style || s.prompt || s.title || s.id),
    popular: s.popular === true || (i === 0 && !src.some((x) => x && x.popular === true)),
  }));
}

export function popularStyle(path, fromCards) {
  const list = stylesFor(path, fromCards);
  return list.find((s) => s.popular) || list[0] || null;
}

// ---- transitions ----
export function start(state, path) {
  if (!isPath(path)) return { ...initial() };
  return { ...initial(), path, step: "style" };
}

export function pickStyle(state, style) {
  if (!isPath(state.path) || !style) return state;
  const s = typeof style === "string" ? { id: style, title: style, style } : style;
  return { ...state, style: { id: String(s.id || s.title || ""), title: String(s.title || s.id || ""), style: String(s.style || s.title || s.id || "") }, step: "tell" };
}

export function setText(state, text) {
  return { ...state, text: String(text ?? "").slice(0, 600) };
}

export function addPhoto(state, photo) {
  if (!photo) return state;
  const photos = [...state.photos, photo].slice(0, 12);
  return { ...state, photos };
}

export function removePhoto(state, index) {
  return { ...state, photos: state.photos.filter((_, i) => i !== index) };
}

export function canGo(state) {
  return state.step === "tell" && isPath(state.path) && state.text.trim().length >= 3;
}

export function go(state, runId = "") {
  if (!canGo(state)) return state;
  return { ...state, step: "working", runId: String(runId || "") };
}

export function setRun(state, runId) {
  return { ...state, runId: String(runId || "") };
}

// The run ended. incomplete=true means part of it failed or was not checked.
export function finish(state, { incomplete = false } = {}) {
  if (state.step !== "working") return state;
  return { ...state, step: incomplete ? "incomplete" : "done" };
}

// Retry goes back to working with the same words.
export function retry(state) {
  if (state.step !== "incomplete" && state.step !== "done") return state;
  return { ...state, step: "working" };
}

export function back(state) {
  switch (state.step) {
    case "style": return initial();
    case "tell": return { ...state, step: "style", style: null };
    case "working": return { ...state, step: "tell", runId: "" };
    case "done":
    case "incomplete": return { ...state, step: "tell", runId: "" };
    default: return state;
  }
}

export function reset() { return initial(); }

export function active(state) { return state.step !== "home"; }

// ---- words ----
export function crumb(state) {
  if (state.step === "home" || !isPath(state.path)) return "";
  const l = PATH_LABEL[state.path];
  return { style: `${l} · step 1`, tell: `${l} · step 2`, working: `${l} · working`, done: `${l} · done`, incomplete: `${l} · not finished` }[state.step] || l;
}

export function stepTitle(state) {
  switch (state.step) {
    case "home": return HOME_TITLE;
    case "style": return `Pick a style for your ${PATH_LABEL[state.path].toLowerCase()}`;
    case "tell": return "Tell us about it";
    case "working": return "Your AIs are working";
    case "done": return "Done";
    case "incomplete": return "Not quite finished";
    default: return "";
  }
}

export function finishLabel(path) { return FINISH_LABEL[path] || "Finish"; }

// The words sent through the normal Send path. The result must still be understood by the existing
// picture/video recognisers (web/make-intent.js), so those paths lead with "Make an image of" / "Make a N second video of".
export function buildPrompt(path, style, text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const st = style && typeof style === "object" ? style.style || style.title || "" : String(style || "");
  const s = st.trim();
  switch (path) {
    case "image": return `Make an image of ${t}${s ? `, in the style of ${s}` : ""}`;
    case "video": return `Make a 5 second video of ${t}${s ? `, ${s}` : ""}`;
    case "website": return `Build a website for ${t}${s ? `. Style: ${s}` : ""}. Give me the complete page as one HTML file.`;
    case "campaign": return `Plan a marketing campaign for ${t}${s ? `. Style: ${s}` : ""}. Write a week of social posts.`;
    case "mod": return `Make a game mod: ${t}${s ? `. Style: ${s}` : ""}`;
    default: return t;
  }
}

// Only website, campaign and mod go through the plain chat answer; picture and video go to the makers.
export function skipsProjectStart(path) { return path === "website" || path === "campaign" || path === "mod"; }

// "Free" or "About $0.04" from the Auto team line ("Auto team, about $0.04") or a number.
export function costLine(input) {
  if (input === 0) return "Free";
  if (typeof input === "number") return input < 0.005 ? "About $0.01 or less" : `About $${input.toFixed(2)}`;
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (/\bfree\b|\$0\.00\b/i.test(s)) return "Free";
  const m = s.match(/\$\s?(\d+(?:\.\d+)?)/);
  if (/or less/i.test(s)) return "About $0.01 or less";
  if (m) { const n = Number(m[1]); return n < 0.005 ? "Free" : `About $${n.toFixed(2)}`; }
  return "";
}

// Three simple bars for the working step, from a progress guess 0..1 (a run has no exact numbers).
export function bars(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const part = (lo, hi) => Math.round(Math.max(0, Math.min(1, (p - lo) / (hi - lo))) * 100);
  return [{ label: "Planning", pct: part(0, 0.33) }, { label: "Making it", pct: part(0.25, 0.8) }, { label: "Checking", pct: part(0.7, 1) }];
}

// Is a live run (CC.S.live) finished? status words come from the engine.
export function runState(live) {
  const st = String(live?.status || "");
  if (!live || !live.id) return "none";
  if (["running", "planning", "assembling", "paused", "scheduled"].includes(st)) return "busy";
  if (st === "done-with-errors" || st === "failed" || st === "error") return "incomplete";
  if (live.mission && (live.mission.incomplete || (live.mission.tasks || []).some((t) => t.status === "failed"))) return "incomplete";
  if (st === "done" || st === "complete" || st === "completed") return "done";
  return st ? "busy" : "none";
}
