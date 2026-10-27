// Voice navigation (0.4.21). ONE action registry shared by buttons and voice.
// Pure logic, no DOM and no network: the app gives the controller a "host" (open a screen, start a run,
// speak, remember...) and tests give it a fake host, so every action is tested with a typed transcript.
//   ACTIONS      the registry. Each row: id, label (the button name), risk ("safe" | "confirm"), examples, run(host, args).
//   parseCommand fast local phrase parser. Returns { action, args } or { action: "unknown" }.
//   createController(host, opts)  hear(text) -> parse -> (ask for "yes" when risky) -> run -> Heard / Doing / Done strip.
// Risky actions (publish, send, delete, spend) never run without a spoken or clicked "yes". Silence cancels.
// "stop" is local and instant: it stops the voice, cancels a waiting question and stops a running job.

export const CONFIRM_MS = 8000;
export const NO_MATCH = "I did not catch that. Try: open MindMedia, new project called Beach Ads, use council, stop, or what can I say.";

// Screens a person can ask for by name. id = the app's view id. memories lives inside Settings.
export const SCREENS = [
  { id: "command", label: "Chat", names: ["chat", "home", "the chat", "command", "start", "main"] },
  { id: "mindmedia", label: "MindMedia", names: ["mindmedia", "mind media", "media hub", "my media", "media library"] },
  { id: "projects", label: "Projects", names: ["projects", "my projects", "project list"] },
  { id: "memories", label: "Memories", names: ["memories", "memory", "my memories", "memory section", "what you remember"], settings: "memories" },
  { id: "settings", label: "Settings", names: ["settings", "setup options", "preferences"] },
  { id: "keys", label: "Keys", names: ["keys", "api keys", "my keys", "my ais", "connect an ai", "add a key"], settings: "keys" },
  { id: "history", label: "History", names: ["history", "past chats", "recent chats", "old chats"] },
  { id: "images", label: "Images", names: ["images", "image maker", "pictures"] },
  { id: "media", label: "Media jobs", names: ["media jobs", "video maker", "media maker"] },
  { id: "publish", label: "Publish", names: ["publish", "publishing"] },
  { id: "prompts", label: "Prompts", names: ["prompts", "pro prompts", "prompt library"] },
  { id: "community", label: "Community", names: ["community"] },
  { id: "help", label: "Help", names: ["help screen", "user guide", "the guide", "help page"] },
  { id: "liveview", label: "Live Ops", names: ["live ops", "live view", "live", "what is running"] },
  { id: "schedules", label: "Schedules", names: ["schedules", "schedule"] },
  { id: "agents", label: "Agents", names: ["agents"] },
  { id: "news", label: "AI News", names: ["ai news", "news"] },
];

const MODES = { auto: "auto", "auto team": "auto", single: "single", council: "council", mission: "mission", team: "auto" };

// Per-screen phrases for the "What can I say?" card. "*" is shown everywhere.
export const SCREEN_HELP = {
  "*": ["Open MindMedia", "Go to settings", "Start a new project called Beach Ads", "Switch to Growtiv8", "Use council", "Stop", "What's running?", "Read it to me", "Remember that my brand color is teal", "Show numbers", "What can I say?"],
  command: ["Make an image of a woman on a beach", "Write a caption for a bakery post", "Use mission", "Run it", "Read the last result", "Ask Claude to redo part 2"],
  mindmedia: ["Publish this to MindMedia", "Open projects", "Read it to me"],
  projects: ["Start a new project called Beach Ads", "Switch to <project name>", "Delete project <name> (I will ask you to say yes)"],
  settings: ["Show memories", "Show keys", "Forget my old address (I will ask you to say yes)"],
  memories: ["Remember that I like short captions", "Forget my old address (I will ask you to say yes)"],
};

export function helpFor(screen) {
  const list = [...(SCREEN_HELP[screen] || []), ...SCREEN_HELP["*"]];
  return [...new Set(list)];
}

const clean = (t) => String(t || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9'#$% ]+/g, " ").replace(/\s+/g, " ").trim();
const title = (t) => String(t || "").trim().replace(/\s+/g, " ").replace(/^["'“]+|["'”.]+$/g, "");

const STOP = /^(stop|stop it|stop that|stop talking|stop please|cancel|cancel that|never ?mind|be quiet|quiet|hush|shut up|enough|pause)$/;
const YES = /^(yes|yes please|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|go for it|affirmative|correct|that's right)$/;
const NO = /^(no|nope|no thanks|nah|don't|do not|negative|not now|cancel|stop|never ?mind)$/;

export function isStop(text) { return STOP.test(stripFiller(clean(text))); }
export function isYes(text) { return YES.test(stripFiller(clean(text))); }
export function isNo(text) { return NO.test(stripFiller(clean(text))); }

function stripFiller(c) {
  return c.replace(/^(hey |ok |okay )?meld(mind)?[ ,]*/, "").replace(/^(please|can you|could you|would you|will you|i want you to|i'd like to|i want to) /, "").replace(/ please$/, "").trim();
}

export function findScreen(name) {
  const n = clean(name).replace(/^(the|my) /, "").replace(/ (screen|page|section|tab|view|panel)$/, "").trim();
  if (!n) return null;
  for (const s of SCREENS) if (s.names.some((x) => clean(x) === n) || clean(s.label) === n) return s;
  return null;
}

// Best project by name: exact, then starts with, then contains. Returns the project or null.
export function findProject(name, projects = []) {
  const n = clean(name);
  if (!n) return null;
  const rows = projects.map((p) => ({ p, c: clean(p.name || p.id) }));
  return (rows.find((r) => r.c === n) || rows.find((r) => r.c.startsWith(n)) || rows.find((r) => r.c.includes(n)) || rows.find((r) => n.includes(r.c) && r.c.length > 2) || {}).p || null;
}

const RUN_VERBS = /^(make|create|write|draft|generate|build|plan|design|find|research|summari[sz]e|explain|tell me|give me|show me how|compare|list|brainstorm|translate|rewrite|edit|fix|code|ask|compose|produce|help me|what is|what are|who is|how do|how does|why |can i|i need|i want)\b/;

// text -> { action, args, heard } ; { action: "unknown" } when nothing matches.
export function parseCommand(text, ctx = {}) {
  const heard = title(text);
  const c = stripFiller(clean(text));
  const out = (action, args = {}) => ({ action, args, heard });
  if (!c) return { action: "unknown", args: {}, heard };
  if (STOP.test(c)) return out("stop");
  if (/^(what can i say|what can you do|what can i ask|show commands|show me commands|voice help|help me|help|commands|list commands)$/.test(c)) return out("help");
  if (/^(show|turn on|display) (the )?numbers$/.test(c)) return out("numbers", { on: true });
  if (/^(hide|turn off|remove|clear) (the )?numbers$/.test(c)) return out("numbers", { on: false });
  let m = c.match(/^(?:click|press|tap|choose|select|number|pick) (?:number )?(\d{1,2})$/);
  if (m) return out("click_number", { n: Number(m[1]) });
  if (/^(what'?s|what is|what are) (running|happening|going on)|^status$|^how is it going$|^how'?s it going$|^how much (has|did|does) (this|it|that) cost|^how much have i spent|^are you (done|finished)|^is it done$/.test(c)) return out("status");
  if (/^read (it|that|this|the (last |latest )?(result|answer|reply|response)|(the )?last (result|answer|reply))( out)?( to me| aloud| out loud)?$|^read it out( loud)?$|^read (back )?(the )?(result|answer)$|^say it( again)?$/.test(c)) return out("read_result");
  m = c.match(/^(?:publish|post|put) (?:it|this|that|the (?:last |latest )?(?:result|answer|image|video)|this (?:result|image|video))?\s*(?:in|to|on|into) (?:the )?mind ?media$/) || c.match(/^publish (?:it|this|that)$/);
  if (m) return out("publish_mindmedia");
  m = c.match(/^(?:remember|memorize|note|save to memory)(?: that| this)?[: ]+(.{3,})$/);
  if (m) return out("remember", { text: title(m[1]) });
  m = c.match(/^(?:forget|delete the memory|erase the memory|remove the memory)(?: that| about| the memory about| my)?[: ]+(.{2,})$/);
  if (m) return out("forget", { text: title(m[1]) });
  // steering a Council or Mission step: "ask Claude to redo part 2", "retry step 3"
  m = c.match(/^(?:ask|tell|have|get) (\w+(?: \w+)?) to (?:redo|retry|rerun|do again|try again|fix)(?: (?:part|step|task)? ?(\d{1,2}|one|two|three|four|five|six))?(?: (?:part|step) (\d{1,2}))?$/) ;
  if (m) return out("steer", { ai: m[1], step: numWord(m[2] || m[3]), verb: "redo" });
  m = c.match(/^(?:redo|retry|rerun|do again|try again|fix) (?:part|step|task) (\d{1,2}|one|two|three|four|five|six)(?: (?:with|using|on) (\w+(?: \w+)?))?$/);
  if (m) return out("steer", { ai: m[2] || "", step: numWord(m[1]), verb: "redo" });
  m = c.match(/^(?:use|pick|choose|switch to|go (?:back )?to|set|change to|change the mode to) (?:the )?(auto team|auto|single|council|mission|team)(?: mode| team| ai)?$/);
  if (m && MODES[m[1]]) return out("set_mode", { mode: MODES[m[1]] });
  if (/^(?:run|send|go|start|do|submit)(?: it| that| this| now)?$|^run (?:the |my )?(?:orders|request|job)$|^send it$/.test(c)) return out("run", { request: "" });
  m = c.match(/^(?:start|create|make|open|begin|add) (?:a |an |another )?new project(?: (?:called|named|for|about))?\s*(.*)$/) || c.match(/^new project(?: (?:called|named))?\s*(.*)$/);
  if (m) return out("new_project", { name: title(heardTail(text, m[1])) });
  m = c.match(/^delete (?:the )?project (?:called |named )?(.+)$/);
  if (m) return out("delete_project", { name: title(heardTail(text, m[1])) });
  m = c.match(/^(?:buy|purchase|pay for|spend|upgrade|subscribe)(?: to| for)? (.+)$/);
  if (m) return out("spend", { what: title(m[1]) });
  m = c.match(/^(?:send|email|mail|text|share) (.+)$/);
  if (m && !/^(?:it|that|this|now)$/.test(m[1])) return out("send_out", { what: title(m[1]) });
  if (/^(back|go back|previous screen|take me back)$/.test(c)) return out("back");
  m = c.match(/^(?:open|go to|take me to|show me|show|bring up|switch to|navigate to|visit|jump to|head to|pull up)(?: me)?(?: to)? (?:the |my )?(.+)$/);
  if (m) {
    const target = m[1];
    const screen = findScreen(target);
    if (screen) return out("open_screen", { screen: screen.id });
    const proj = target.match(/^(?:project |the project )(.+)$/);
    if (/^(?:switch to|open|go to)\b/.test(c) && !/\b(screen|page|section|tab)$/.test(target)) return out("switch_project", { name: title(heardTail(text, proj ? proj[1] : target)) });
  }
  if (RUN_VERBS.test(c)) return out("run", { request: heard, natural: true });
  // A long sentence with no known verb is probably a request, but a connected model gets the first look.
  if (c.split(" ").length >= 6) return { ...out("run", { request: heard, natural: true }), weak: true };
  return { action: "unknown", args: {}, heard };
}

// The words after a keyword keep the speaker's capitalisation, so project names look right.
function heardTail(original, lowerTail) {
  const t = String(original || "");
  const tail = String(lowerTail || "").trim();
  if (!tail) return "";
  const i = t.toLowerCase().lastIndexOf(tail.toLowerCase());
  return i >= 0 ? t.slice(i, i + tail.length) : tail;
}

function numWord(v) {
  if (!v) return 0;
  const w = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  return Number(v) || w[v] || 0;
}

const ask = (what) => (host) => `${what}? Say yes or no.`;

// The registry. label = the visible button name (a button for each action says the same words).
export const ACTIONS = {
  open_screen: {
    id: "open_screen", label: "Open a screen", risk: "safe", examples: ["Open MindMedia", "Go to settings", "Show memories"],
    async run(host, a) {
      const s = SCREENS.find((x) => x.id === a.screen) || findScreen(a.screen);
      if (!s) return { ok: false, say: "I do not know that screen." };
      await host.openScreen(s);
      return { ok: true, doing: `opening ${s.label}`, say: `Now in ${s.label}.` };
    },
  },
  back: { id: "back", label: "Go back", risk: "safe", examples: ["Back"], async run(host) { await host.back(); return { ok: true, doing: "going back", say: "Back." }; } },
  new_project: {
    id: "new_project", label: "New project", risk: "safe", examples: ["Start a new project called Beach Ads"],
    async run(host, a) {
      if (!a.name) return { ok: false, say: "What should I call it? Say: new project called Beach Ads." };
      const made = await host.newProject(a.name);
      return made === false ? { ok: false, say: "I could not start that project." } : { ok: true, doing: `creating project ${a.name}`, say: `Project ${a.name} is ready.` };
    },
  },
  switch_project: {
    id: "switch_project", label: "Switch project", risk: "safe", examples: ["Switch to Growtiv8"],
    async run(host, a) {
      const list = (await host.projects?.()) || [];
      const p = findProject(a.name, list);
      if (!p) return { ok: false, say: `I could not find a project called ${a.name}.` };
      await host.switchProject(p);
      return { ok: true, doing: `switching to ${p.name}`, say: `Switched to ${p.name}.` };
    },
  },
  set_mode: {
    id: "set_mode", label: "Pick a mode", risk: "safe", examples: ["Use council", "Go back to auto"],
    async run(host, a) {
      const mode = MODES[a.mode];
      if (!mode) return { ok: false, say: "Pick auto, single, council or mission." };
      const r = await host.setMode(mode);
      return r === false ? { ok: false, say: `I could not switch to ${mode} here.` } : { ok: true, doing: `using ${mode}`, say: `Using ${mode}.` };
    },
  },
  run: {
    id: "run", label: "Run", risk: "safe", examples: ["Make an image of a woman on a beach", "Run it"],
    // Paid jobs over the budget line need a yes first (the host decides with spendCheck).
    async confirmFirst(host, a) {
      const r = await host.spendCheck?.(a.request || "");
      return r && r.overBudget ? `This may cost about ${r.estimate || "more than your budget line"}. Go ahead` : "";
    },
    async run(host, a) {
      const text = a.request || (await host.getText?.()) || "";
      if (!String(text).trim()) return { ok: false, say: "There is nothing to run yet. Say what you want first." };
      await host.run(String(text).trim());
      return { ok: true, doing: "sending your request", say: "On it. I will tell you when it is done." };
    },
  },
  stop: {
    id: "stop", label: "Stop", risk: "safe", examples: ["Stop", "Cancel that"],
    async run(host) { await host.stopSpeech?.(); const r = await host.stop?.(); return { ok: true, doing: "stopping", say: r === false ? "" : "Stopped." , silent: true }; },
  },
  status: {
    id: "status", label: "Status", risk: "safe", examples: ["What's running?", "How much has this cost?"],
    async run(host) {
      const s = (await host.status?.()) || {};
      const say = s.running ? `${s.label || "A job is running"}${s.cost ? `. Cost so far ${s.cost}` : ""}.` : `Nothing is running.${s.cost ? ` Last cost ${s.cost}.` : ""}`;
      return { ok: true, doing: "checking", say };
    },
  },
  read_result: {
    id: "read_result", label: "Read result", risk: "safe", examples: ["Read it to me"],
    async run(host) {
      const r = await host.lastResult?.();
      if (!r || !String(r.text || "").trim()) return { ok: false, say: "There is no finished result to read yet." };
      return { ok: true, doing: "reading the result", say: String(r.text).trim(), long: true };
    },
  },
  remember: {
    id: "remember", label: "Remember", risk: "safe", examples: ["Remember that my brand color is teal"],
    async run(host, a) {
      const r = await host.remember(a.text);
      if (r && r.refused) return { ok: false, say: "I will not remember passwords, keys or account numbers." };
      if (r === false) return { ok: false, say: "I could not save that." };
      return { ok: true, doing: "saving a memory", say: `Remembered: ${a.text}.` };
    },
  },
  forget: {
    id: "forget", label: "Forget", risk: "confirm", examples: ["Forget my old address"],
    prompt: (a) => `Forget "${a.text}"? Say yes or no.`,
    async run(host, a) {
      const r = await host.forget(a.text);
      if (r === false || (r && r.deleted === 0)) return { ok: false, say: `I found nothing about ${a.text} to forget.` };
      return { ok: true, doing: "forgetting", say: `Forgot ${a.text}.` };
    },
  },
  help: {
    id: "help", label: "What can I say?", risk: "safe", examples: ["What can I say?"],
    async run(host) {
      const list = helpFor(host.view?.() || "command");
      await host.showHelp?.(list);
      return { ok: true, doing: "showing what you can say", say: `You can say things like: ${list.slice(0, 4).join(", ")}. The full list is on screen.` };
    },
  },
  publish_mindmedia: {
    id: "publish_mindmedia", label: "Save to MindMedia", risk: "confirm",
    prompt: async (a, host) => { const r = await host.lastResult?.(); return `Save "${(r && r.title) || "this result"}" to MindMedia? Say yes or no.`; },
    async run(host) {
      const r = await host.lastResult?.();
      if (!r) return { ok: false, say: "There is no finished result to save yet." };
      const out = await host.publish(r);
      return out === false ? { ok: false, say: "It could not be saved." } : { ok: true, doing: "saving to MindMedia", say: "Saved to MindMedia." };
    },
  },
  delete_project: {
    id: "delete_project", label: "Delete project", risk: "confirm",
    prompt: (a) => `Delete project ${a.name}? This cannot be undone. Say yes or no.`,
    async run(host, a) {
      const p = findProject(a.name, (await host.projects?.()) || []);
      if (!p) return { ok: false, say: `I could not find a project called ${a.name}.` };
      const r = await host.deleteProject(p);
      return r === false ? { ok: false, say: "I could not delete it. Use the Projects screen." } : { ok: true, doing: `deleting ${p.name}`, say: `Deleted ${p.name}.` };
    },
  },
  // Sending outside the app and spending money: a voice "yes" only OPENS the right screen. The on-screen button still asks.
  send_out: {
    id: "send_out", label: "Send", risk: "confirm",
    prompt: (a) => `Send ${a.what}? I will open the send screen and you press the button. Say yes or no.`,
    async run(host) { await host.openScreen(findScreen("publish")); return { ok: true, doing: "opening the publish screen", say: "The send screen is open. Press Send there to finish." }; },
  },
  spend: {
    id: "spend", label: "Spend", risk: "confirm",
    prompt: (a) => `Open the billing screen to ${a.what}? Say yes or no.`,
    async run(host) { await host.openScreen(findScreen("settings")); return { ok: true, doing: "opening settings", say: "Settings are open. Money is only spent when you press the button there." }; },
  },
  steer: {
    id: "steer", label: "Redo a part", risk: "safe", examples: ["Ask Claude to redo part 2"],
    async run(host, a) {
      const r = await host.steer?.(a);
      if (r === false || r === undefined) return { ok: false, say: "I could not redo that part. Open the run and use Try again." };
      return { ok: true, doing: `asking ${a.ai || "another AI"} to redo part ${a.step || ""}`.replace(/ $/, ""), say: "Asked again. I will tell you when it is done." };
    },
  },
  numbers: {
    id: "numbers", label: "Show numbers", risk: "safe", examples: ["Show numbers", "Hide numbers"],
    async run(host, a) { const n = await host.numbers?.(!!a.on); return { ok: true, doing: a.on ? "numbering the controls" : "hiding numbers", say: a.on ? `Numbers are on${n ? `, 1 to ${n}` : ""}. Say a number to click it.` : "Numbers are off." }; },
  },
  click_number: {
    id: "click_number", label: "Click a number", risk: "safe", examples: ["Click 3"],
    async run(host, a) {
      const r = await host.clickNumber?.(a.n);
      return r ? { ok: true, doing: `clicking ${a.n}`, say: `Clicked ${a.n}.` } : { ok: false, say: `There is no number ${a.n}. Say show numbers first.` };
    },
  },
};

// Buttons and voice both call this. runAction("stop"), runAction("open_screen", { screen: "mindmedia" }).
export const actionList = () => Object.values(ACTIONS).map((a) => ({ id: a.id, label: a.label, risk: a.risk, examples: a.examples || [] }));

// ---- the controller: Heard / Doing / Done, spoken yes, silence cancels ----
export function createController(host, opts = {}) {
  const confirmMs = opts.confirmMs ?? CONFIRM_MS;
  const setT = opts.setTimeout || setTimeout;
  const clearT = opts.clearTimeout || clearTimeout;
  const model = opts.interpret || null; // async (text, ctx) -> { action, args } | null   (a cheap connected model)
  let strip = { phase: "idle", heard: "", doing: "", done: "", waiting: "" };
  let pending = null;
  let timer = null;
  let busy = false;
  const subs = new Set();
  const emit = (patch) => { strip = { ...strip, ...patch }; for (const f of subs) { try { f(strip); } catch { /* a bad listener must not break voice */ } } };
  const say = async (text, o = {}) => { if (text && host.speak) { try { await host.speak(text, o); } catch { /* text only */ } } };
  const clearPending = () => { clearT(timer); timer = null; pending = null; };

  async function execute(action, args, heard) {
    const def = ACTIONS[action];
    if (!def) { emit({ phase: "done", done: NO_MATCH }); await say(NO_MATCH); return { ok: false, say: NO_MATCH }; }
    emit({ phase: "doing", doing: ACTIONS[action].examples?.length ? (def.label + "...") : def.label, done: "" });
    let r;
    try { r = await def.run(host, args || {}); }
    catch (e) { r = { ok: false, say: `That did not work: ${String(e?.message || e).slice(0, 120)}` }; }
    emit({ phase: "done", doing: r.doing || "", done: r.say ? shortLine(r.say) : "Done." });
    if (r.say && !r.silent) await say(r.say, { long: !!r.long });
    return r;
  }

  async function askConfirm(action, args, heard, prompt) {
    clearPending();
    pending = { action, args, heard, prompt };
    emit({ phase: "waiting", waiting: prompt, doing: "", done: "" });
    timer = setT(() => { void expire(); }, confirmMs);
    await say(prompt);
    return { ok: true, waiting: true, say: prompt };
  }

  async function expire() {
    if (!pending) return false;
    clearPending();
    emit({ phase: "done", waiting: "", done: "No answer, so I cancelled it." });
    await say("No answer, so I cancelled it.");
    return true;
  }

  async function hear(text) {
    const heard = title(text);
    if (!heard) return { ok: false, ignored: true };
    // "stop" is local and instant, even mid-reply and even while a question waits for a yes.
    if (isStop(heard)) {
      const wasWaiting = !!pending;
      clearPending();
      emit({ phase: "doing", heard, waiting: "" });
      if (wasWaiting) await host.stopSpeech?.();
      if (!wasWaiting) { const r = await ACTIONS.stop.run(host, {}); emit({ phase: "done", done: wasWaiting ? "Cancelled." : (r.say || "Stopped.") }); return { ok: true, action: "stop" }; }
      emit({ phase: "done", done: "Cancelled." });
      return { ok: true, action: "stop", cancelled: true };
    }
    if (pending) {
      if (isYes(heard)) { const p = pending; clearPending(); emit({ heard, waiting: "" }); return { ...(await execute(p.action, p.args, p.heard)), action: p.action, confirmed: true }; }
      if (isNo(heard)) { clearPending(); emit({ phase: "done", heard, waiting: "", done: "Cancelled." }); await say("Cancelled."); return { ok: true, cancelled: true }; }
      clearPending(); // anything else cancels the question and counts as a new command
    }
    emit({ phase: "heard", heard, doing: "", done: "", waiting: "" });
    let cmd = parseCommand(heard, { view: host.view?.() });
    if ((cmd.action === "unknown" || cmd.weak) && model) {
      try { const guess = await model(heard, { view: host.view?.(), actions: actionList() }); if (guess && ACTIONS[guess.action]) cmd = { action: guess.action, args: guess.args || {}, heard }; }
      catch { /* no model: fall through to the plain line */ }
    }
    if (cmd.action === "unknown") {
      emit({ phase: "done", done: NO_MATCH });
      await say(NO_MATCH);
      return { ok: false, unknown: true, say: NO_MATCH };
    }
    return runParsed(cmd);
  }

  async function runParsed(cmd) {
    const def = ACTIONS[cmd.action];
    let prompt = "";
    if (def.risk === "confirm") prompt = typeof def.prompt === "function" ? await def.prompt(cmd.args, host) : ask("Do it")(host);
    else if (def.confirmFirst) prompt = (await def.confirmFirst(host, cmd.args)) ? `${await def.confirmFirst(host, cmd.args)}? Say yes or no.` : "";
    if (prompt) return { ...(await askConfirm(cmd.action, cmd.args, cmd.heard, prompt)), action: cmd.action };
    return { ...(await execute(cmd.action, cmd.args, cmd.heard)), action: cmd.action };
  }

  // The same registry from a button: runAction("open_screen", { screen: "mindmedia" }). Risky ones still ask.
  async function runAction(action, args = {}) {
    if (!ACTIONS[action]) return { ok: false, say: "Unknown action." };
    if (isStop(action) || action === "stop") { clearPending(); await host.stopSpeech?.(); }
    emit({ heard: ACTIONS[action].label });
    return runParsed({ action, args, heard: ACTIONS[action].label });
  }

  // The app speaks and shows a line on its own (a finished run). Not a command; nothing runs.
  async function notify(text, o = {}) {
    emit({ phase: "done", done: shortLine(text), waiting: "" });
    await say(text, o);
  }

  return {
    hear, runAction, expire, notify, isStopWord: isStop,
    noteHeard(h) { emit({ phase: "heard", heard: title(h) }); },
    confirm: () => hear("yes"), decline: () => hear("no"),
    get strip() { return strip; },
    get pending() { return pending ? { action: pending.action, prompt: pending.prompt } : null; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    cancelAll() { clearPending(); emit({ phase: "idle", waiting: "" }); },
    isBusy: () => busy,
  };
}

function shortLine(t) { const s = String(t).replace(/\s+/g, " ").trim(); return s.length > 140 ? s.slice(0, 137) + "..." : s; }

// ---- talk-back settings (saved under settings.voiceTalk; the older tap/hold settings stay under settings.voice) ----
export const TALK_DEFAULTS = Object.freeze({ talk: false, speak: true, handsFree: false, hotkey: "Ctrl+Space", wakeWord: false, instant: true, elevenAgentId: "" });
export const NO_KEY_LINE = "Add a key to talk (OpenAI, Groq, ElevenLabs or Gemini).";
export const HANDS_FREE_AUTO_OFF_MS = 10 * 60 * 1000;
const HOTKEY = /^(?:(?:Ctrl|Alt|Shift|Meta)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Tab|`|;|,|\.|\/)$/;

export function coerceTalk(v) {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return {
    talk: o.talk === true,
    speak: o.speak !== false,
    handsFree: o.handsFree === true,
    hotkey: typeof o.hotkey === "string" && HOTKEY.test(o.hotkey) ? o.hotkey : TALK_DEFAULTS.hotkey,
    wakeWord: o.wakeWord === true,
    instant: o.instant !== false,
    elevenAgentId: typeof o.elevenAgentId === "string" && /^[A-Za-z0-9_-]{0,80}$/.test(o.elevenAgentId) ? o.elevenAgentId : "",
  };
}

// Partial update on top of what is saved. Rejects junk with a plain message.
export function normalizeTalk(patch, current = TALK_DEFAULTS) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw Object.assign(new Error("Send the voice settings as an object."), { status: 400, code: "voice_invalid" });
  const next = { ...coerceTalk(current) };
  for (const k of ["talk", "speak", "handsFree", "wakeWord", "instant"]) {
    if (patch[k] === undefined) continue;
    if (typeof patch[k] !== "boolean") throw Object.assign(new Error(`${k} must be on or off.`), { status: 400, code: "voice_invalid" });
    next[k] = patch[k];
  }
  if (patch.hotkey !== undefined) {
    if (typeof patch.hotkey !== "string" || !HOTKEY.test(patch.hotkey)) throw Object.assign(new Error("That shortcut is not valid. Try Ctrl+Space."), { status: 400, code: "voice_invalid" });
    next.hotkey = patch.hotkey;
  }
  if (patch.elevenAgentId !== undefined) {
    if (typeof patch.elevenAgentId !== "string" || !/^[A-Za-z0-9_-]{0,80}$/.test(patch.elevenAgentId)) throw Object.assign(new Error("That agent id is not valid."), { status: 400, code: "voice_invalid" });
    next.elevenAgentId = patch.elevenAgentId;
  }
  return next;
}

// A keydown event as "Ctrl+Space" (null for a bare modifier). Used for the push-to-talk hotkey.
export function comboOf(e) {
  const k = e?.key;
  if (!k || ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(k)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  const key = k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k;
  return [...mods, key].join("+");
}

// Words that wake Meld (setting is off by default). Returns the command after the wake word, "" for the word alone, or null.
export function stripWake(text) {
  const c = String(text || "").trim();
  const m = c.match(/^(?:hey|hi|okay|ok)[ ,]+(?:meld|mel|held|meld mind|meldmind)\b[ ,.!?:-]*(.*)$/i);
  return m ? m[1].trim() : null;
}

// Cut text into sentences so the reply can start speaking at once and be stopped between sentences.
export function sentences(text) {
  const t = String(text || "").replace(/```[\s\S]*?```/g, " (code left out) ").replace(/[*_#>`]+/g, "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g) || [t];
  const out = [];
  let cur = "";
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if ((cur + " " + p).trim().length < 40 && cur !== "") { cur = (cur + " " + p).trim(); continue; }
    if (cur) out.push(cur);
    cur = p;
  }
  if (cur) out.push(cur);
  return out.map((s) => s.slice(0, 400));
}

