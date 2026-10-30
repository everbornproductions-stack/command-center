// Mac part "flow" (0.4.23): pure logic for the Simple 3 step flow. No DOM, no network.
// State: { path, step, style, text, photos[], runId }. Steps: home, style, tell, working, done, incomplete.
// Every function returns a new state; the old one is never changed.

// 0.4.28: five more paths for the files Meldmind really saves (a named .xlsx, .docx, .pptx, script or .csv).
export const PATHS = ["website", "image", "video", "campaign", "mod", "spreadsheet", "document", "slides", "script", "data"];
export const FILE_PATHS = ["spreadsheet", "document", "slides", "script", "data"];
export const STEPS = ["home", "style", "tell", "working", "done", "incomplete"];

export const PATH_LABEL = { website: "Website", image: "Image", video: "Video", campaign: "Campaign", mod: "Game mod", spreadsheet: "Spreadsheet", document: "Document", slides: "Slides", script: "App or script", data: "List or data" };
export const PATH_BLURB = { website: "A page for your business.", image: "A picture from your words.", video: "A short clip.", campaign: "A week of posts.", mod: "A change for your game.", spreadsheet: "A sheet with totals that add up.", document: "A letter, plan or guide in Word.", slides: "A short deck to present.", script: "A small tool that runs on your PC.", data: "A clean list you can open anywhere." };
export const FINISH_LABEL = { website: "Publish site", image: "Download image", video: "Download video", campaign: "Post campaign", mod: "Download mod", spreadsheet: "Open spreadsheet", document: "Open document", slides: "Open slides", script: "Open file", data: "Open list" };
// When a file path ended without a saved file, the finish button opens the copy and download choices instead.
export const NO_FILE_FINISH = "Copy or download";
export const TELL_HINT = {
  website: "Tell us about your business in one sentence.",
  image: "Say what the picture should show.",
  video: "Say what should happen in the video.",
  campaign: "Tell us about your business and who it is for.",
  mod: "Say what your mod should change in the game.",
  spreadsheet: "Say what the sheet is for and what it should add up.",
  document: "Say who it is for and what it should say.",
  slides: "Say what the talk is about and who will watch it.",
  script: "Say what the tool should do. Step by step is best.",
  data: "Say what the list is about and which columns it needs.",
};
// The example in the box on step 2. Paths without one show the hint again.
export const TELL_PLACEHOLDER = {
  spreadsheet: "For example: monthly budget for my house, rent, food, gas",
  document: "For example: a letter to my landlord about a repair",
  slides: "For example: why my bakery is a good place to invest",
  script: "For example: rename the photos in a folder by the date taken",
  data: "For example: products in my shop with name, price and stock",
};
export function tellPlaceholder(path) { return TELL_PLACEHOLDER[path] || TELL_HINT[path] || ""; }
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
  spreadsheet: [
    { id: "budget", title: "Budget", desc: "Money in, money out, totals.", style: "budget", popular: true },
    { id: "tracker", title: "Tracker", desc: "Track tasks, hours or habits.", style: "tracker" },
    { id: "invoice", title: "Invoice", desc: "Items, prices and a total due.", style: "invoice" },
  ],
  document: [
    { id: "letter", title: "Letter", desc: "A clear, polite letter.", style: "letter", popular: true },
    { id: "plan", title: "Plan", desc: "Goals, steps and dates.", style: "plan" },
    { id: "guide", title: "Guide", desc: "How to do something, step by step.", style: "guide" },
  ],
  slides: [
    { id: "pitch", title: "Pitch", desc: "Win someone over in a few slides.", style: "pitch", popular: true },
    { id: "training", title: "Training", desc: "Teach a team how to do it.", style: "training" },
    { id: "update", title: "Update", desc: "Where things stand and what is next.", style: "update" },
  ],
  script: [
    { id: "python", title: "Python script", desc: "Runs on your PC.", style: "Python script", ext: "py", popular: true },
    { id: "calculator", title: "Web calculator", desc: "One page that works in your browser.", style: "web calculator", ext: "html" },
    { id: "powershell", title: "PowerShell", desc: "Handy jobs on Windows.", style: "PowerShell script", ext: "ps1" },
  ],
  data: [
    { id: "contacts", title: "Contacts", desc: "Names, phones and emails.", style: "contacts", popular: true },
    { id: "products", title: "Products", desc: "Items, prices and stock.", style: "products" },
    { id: "leads", title: "Leads", desc: "People to follow up with.", style: "leads" },
  ],
};

// ---- 0.4.28: the file a file path saves ----
// Each path saves one kind of file. A style may pick another kind (a web calculator is .html, a JSON list is .json).
export const SAVE_EXT = { spreadsheet: "xlsx", document: "docx", slides: "pptx", script: "py", data: "csv" };
export const ALLOWED_EXT = { spreadsheet: ["xlsx"], document: ["docx"], slides: ["pptx"], script: ["py", "html", "ps1", "gs", "js", "sql"], data: ["csv", "json"] };
export function savesFile(path) { return FILE_PATHS.includes(path); }
export function extFor(path, style) {
  const e = String((style && typeof style === "object" && style.ext) || "").toLowerCase().replace(/^\./, "");
  if (e && (ALLOWED_EXT[path] || []).includes(e)) return e;
  return SAVE_EXT[path] || "";
}
const NAME_SKIP = new Set("a an the for my our your his her their of to and or with me us make made making build create write i we you in on at that this these those it its is are be please want need some from by about so can could will would each every all just like who what which how".split(" "));
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/;
const PRODUCT_WORD = /^(node|next|nuxt|vue|react|express|three|d3|chart|p5|socket|alpine|ember|backbone|jquery|angular|nest|deno|bun|electron|svelte|astro|remix|gatsby|meteor)$/;
// A short, safe file name from the person's words: lowercase letters and digits joined by dashes, at most 4 words and 40 characters.
export function fileName(text, fallback = "my-file") {
  const words = String(text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !NAME_SKIP.has(w));
  let name = "";
  for (const w of words) {
    const next = name ? `${name}-${w}` : w.slice(0, 40);
    if (next.length > 40) break;
    name = next;
    if (name.split("-").length >= 4) break;
  }
  if (!name) name = String(fallback || "my-file").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-file";
  // a name Windows will not take, or one that reads as a product ("node.js"), gets a plain ending
  if (RESERVED.test(name) || PRODUCT_WORD.test(name)) name += "-file";
  return name;
}
export function fileFor(path, style, text) {
  const ext = extFor(path, style);
  if (!ext) return "";
  const st = style && typeof style === "object" ? style : null;
  return `${fileName(text, st?.id || st?.title || path)}.${ext}`;
}

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
    ...(s.ext ? { ext: String(s.ext) } : {}),
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
  return { ...state, style: { id: String(s.id || s.title || ""), title: String(s.title || s.id || ""), style: String(s.style || s.title || s.id || ""), ...(s.ext ? { ext: String(s.ext) } : {}) }, step: "tell" };
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
export function pathBlurb(path) { return PATH_BLURB[path] || ""; }

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
    // 0.4.28: each file path names the file, so the run really saves it (server/named-file.js wantedFile)
    case "spreadsheet": case "document": case "slides": case "script": case "data": return fileGoal(path, style, s, t.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()));
    default: return t;
  }
}
function fileGoal(path, style, s, t) {
  switch (path) {
    case "spreadsheet": return `Make an Excel spreadsheet for ${t}${s ? `. Kind: ${s}` : ""}. Use working formulas for every total (for example =SUM(B2:B10)), so the numbers add up again when I change them. Save it as ${fileFor(path, style, t)}`;
    case "document": return `Write a Word document for ${t}${s ? `. Kind: ${s}` : ""}. Use clear headings and short paragraphs. Save it as ${fileFor(path, style, t)}`;
    case "slides": return `Make a PowerPoint deck about ${t}${s ? `. Kind: ${s}` : ""}. Keep it short, 6 to 10 slides. Save it as ${fileFor(path, style, t)}`;
    case "script": return `${SCRIPT_ASK[extFor(path, style)] || SCRIPT_ASK.py} that does this: ${t}. Keep it to one file with short comments, and say in plain words how to run it. Save it as ${fileFor(path, style, t)}`;
    case "data": return extFor(path, style) === "json"
      ? `Make a JSON data file of ${t}${s ? `. Kind: ${s}` : ""}. Use one object per item, each with the same fields. Save it as ${fileFor(path, style, t)}`
      : `Make a CSV list of ${t}${s ? `. Kind: ${s}` : ""}. Header row first, one row per line, commas between columns. Save it as ${fileFor(path, style, t)}`;
    default: return t;
  }
}
// What a script path asks for, by the kind of file. (Never "Node.js": it once read as a file name, LESSONS 2026-10-27.)
const SCRIPT_ASK = {
  py: "Write a small Python script",
  html: "Make a small web calculator as one HTML file (the page, its style and its script together)",
  ps1: "Write a small PowerShell script for Windows",
  gs: "Write a small Google Sheets script (Apps Script)",
  js: "Write a small JavaScript program for Node",
  sql: "Write a SQL query",
};

// Only website, campaign and mod go through the plain chat answer; picture and video go to the makers.
// 0.4.28: the file paths skip it too (an "app" would otherwise open the project questions).
export function skipsProjectStart(path) { return path === "website" || path === "campaign" || path === "mod" || savesFile(path); }
// A file path runs as a Mission when the plan has Missions (Pro, a trial, Extreme). From 0.4.28 a single chat answer that
// names a file saves it on every plan too, so on Free it goes as one answer (Single) that still names the file; it is
// never left to Auto team, which could pick a Mission the plan does not have. "" keeps the choice under More options.
export function runMode(path, missionsOn = true) { return savesFile(path) ? (missionsOn ? "mission" : "single") : ""; }
// 0.4.28: one more Quick pick on Home, next to the picture, website, video and posts ideas.
export const EXTRA_IDEAS = [{ chip: "spreadsheet", text: "A budget spreadsheet for my family" }];

// ---- 0.4.28: words that pick a path ("make me a budget spreadsheet") ----
// Strong words name the kind of file and win over picture or video words. Weak words are checked last.
const STRONG_WORDS = [
  ["spreadsheet", /\b(spread ?sheets?|excel|xlsx|work ?books?)\b/i],
  ["slides", /\b(power ?points?|pptx|slide ?decks?|slide ?shows?|slides|keynote)\b/i],
  ["document", /\b(word (?:docs?|documents?|files?)|docx|ms word|microsoft word)\b/i],
  ["script", /\b(python|power ?shell|apps script|scripts?|ps1|sql (?:query|queries))\b/i],
  ["data", /\b(csv|json)\b/i],
];
const WEAK_WORDS = [
  ["spreadsheet", /\b(sheets?|budgets?|invoices?|ledger|timesheets?)\b/i],
  ["slides", /\b(decks?|presentations?)\b/i],
  ["document", /\b(documents?|docs?|letters?|resumes?|r[eé]sum[eé]s?|handbook|essay)\b/i],
  ["script", /\b(programs?|apps?|calculators?|automate)\b/i],
  ["data", /\b(lists?|data ?sets?|data|contacts|leads)\b/i],
];
// a script for a video, a play or an ad is words to read, not a program
const SPOKEN_SCRIPT = /\b(?:video|film|movie|youtube|tiktok|podcast|play|ad|sales|call|phone)\s+scripts?\b|\bscripts?\s+for\s+(?:an?\s+|my\s+|the\s+|our\s+)?(?:video|film|movie|youtube|tiktok|podcast|play|ad|reel|sales call|call)\b/i;
export function filePathFromWords(text, { weak = true } = {}) {
  const t = String(text || "");
  if (SPOKEN_SCRIPT.test(t)) return "document";
  for (const [p, re] of STRONG_WORDS) if (re.test(t)) return p;
  if (weak) for (const [p, re] of WEAK_WORDS) if (re.test(t)) return p;
  return "";
}
// The whole word check for the box on Home. visualKind is what the picture and video recogniser said ("image", "video" or "").
export function pathFromWords(text, visualKind = "") {
  const t = String(text || "").trim();
  if (!t) return "";
  const strong = filePathFromWords(t, { weak: false });
  if (strong) return strong;
  const visual = visualKind === "image" || visualKind === "video" ? visualKind : "";
  // a picture or video word wins; a bare scene guess ("a presentation on safety") loses to a file word below
  if (visual && VISUAL_NOUN.test(t)) return visual;
  if (/\b(mod|minecraft|skyrim|game mod)\b/i.test(t)) return "mod";
  if (/\b(campaign|posts?|social|week of)\b/i.test(t)) return "campaign";
  if (/\b(web ?site|web ?page|landing page|site)\b/i.test(t)) return "website";
  return filePathFromWords(t) || visual;
}
const VISUAL_NOUN = /\b(pictures?|images?|photos?|photographs?|pics?|drawings?|paintings?|illustrations?|logos?|icons?|posters?|wallpapers?|art(?:work)?|videos?|clips?|animations?|films?|movies?|draw|paint|sketch)\b/i;
export const SAY_IT_HINT = "Pick what to make above first, or say it with a word like picture, video, website, spreadsheet, slides, or script.";

// ---- 0.4.28: the saved file on the Done step ----
// From a finished run's savedFile (and askedFolder when the run copied it there). null when the run named no file.
export function savedFileInfo(mission) {
  const f = mission?.savedFile;
  if (!f) return null;
  const name = String(f.name || f.requested || "").split(/[\\/]/).pop();
  if (!f.ok) return { ok: false, name, line: `Not saved: ${String(f.error || `${name} was not written.`).replace(/^Not saved:\s*/i, "")}` };
  const copy = String(f.copiedTo || mission?.askedFolder?.folder || "");
  return { ok: true, name, path: String(f.path || ""), copy, line: `Saved as ${name}` };
}

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
