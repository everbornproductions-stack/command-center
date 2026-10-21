// Extra Pro prompts. Same row shape as server/prompts/catalog.js.
// Joined from catalog.js with one push. Nothing here is copied from a named coach.

const OPS = "Strategy/ops";
const SALES = "Sales/clients";
const CONTENT = "Content";
const PEOPLE = "People/hiring";
const PERSONAL = "Personal/coaching";

function inp(key, label, extra = {}) {
  return { key, label, required: extra.required !== false, profile: extra.profile || null, link: extra.link || null, multiline: !!extra.multiline };
}

const GUARD = "Guardrail: no fabricated results, testimonials or income claims.";

export const MORE_TEMPLATES = [
  {
    id: "coaching-sbi",
    name: "Coaching conversation (SBI)",
    category: PEOPLE,
    description: "Verbal scripts and a Situation-Behavior-Impact coaching framework for process and cultural alignment.",
    phrases: ["coaching conversation", "coaching conversation (sbi)", "situation-behavior-impact", "situation behavior impact"],
    words: ["sbi"],
    inputs: [
      inp("situation", "Situation (for example, good technical work but late to meetings or not updating project dashboards)", { multiline: true }),
      inp("values", "Company core values", { multiline: true }),
    ],
    role: "You are a corporate leadership coach and industrial psychologist. You focus on process and cultural alignment, not personal criticism.",
    context: "Situation: {{situation}}. Company core values: {{values}}.",
    command: "Write complete verbal scripts and a coaching framework built on Situation-Behavior-Impact. Focus on process and cultural alignment, not personal criticism. Use only the situation and the company core values above.",
    format: "Four blocks: (1) an opening script with an exact, non-threatening first sentence; (2) an SBI breakdown with word-for-word Situation, Behavior, and Impact templates; (3) 2 discovery questions to uncover the real roadblock; (4) a 2-line accountability pact with a review date next week.",
    output: "An SBI coaching script in four blocks.",
  },
  {
    id: "delegation-handoff",
    name: "Delegation hand-off plan",
    category: OPS,
    description: "A 4-week I do, we do, you do hand-off with training, review loops, and a sign-off.",
    phrases: ["delegation hand-off", "delegation handoff", "i do we do you do", "delegation hand-off plan"],
    words: ["delegatee"],
    inputs: [
      inp("task", "Task to delegate", { multiline: true }),
      inp("process", "Current process (time and tools)", { multiline: true }),
      inp("delegatee", "Delegatee role"),
    ],
    role: "You are a systems engineer and operations documentation specialist.",
    context: "Task to delegate: {{task}}. Current process (time and tools): {{process}}. Delegatee role: {{delegatee}}.",
    command: "Write a 4-week gradual hand-off using I do, we do, you do. Week 1, I do and you watch: training parameters, a screen-recording checklist, and reference docs. Week 2, we do it together: the delegatee owns about 30% of the low-risk inputs and I approve the output. Week 3, you do and I watch: metrics, review loops, and a quality audit. Week 4, full ownership: a sign-off sheet and a KPI reporting cadence. Use only the task, the current process, and the delegatee role above.",
    format: "Week 1 (I do, you watch): training parameters, screen-recording checklist, reference docs. Week 2 (we do): about 30% of the low-risk inputs, with approval. Week 3 (you do, I watch): metrics, review loops, quality audit. Week 4 (full ownership): sign-off sheet and KPI reporting cadence.",
    output: "A 4-week delegation hand-off plan.",
  },
  {
    id: "dm-booked-call",
    name: "DM sequence to booked call",
    category: SALES,
    description: "Four brief, casual DMs from a trigger to a low-pressure screen-share. Drafts only.",
    phrases: ["dm sequence", "dm sequence to booked call", "booked call sequence", "dms to a call"],
    words: ["screen-share"],
    inputs: [
      inp("platform", "Platform"),
      inp("trigger", "Trigger (a keyword comment or a download)"),
      inp("offer", "Offer", { profile: "offer", multiline: true }),
    ],
    role: "You are an inbound conversation closer and B2B sales psychologist. You draft. You do not send.",
    context: "Platform: {{platform}}. Trigger (a keyword comment or a download): {{trigger}}. Offer: {{offer}}.",
    command: `Write 4 brief, casual DMs. DM 1 delivers the asset and asks a low-stakes role question. DM 2 digs into their #1 problem. DM 3 shares a short peer example only when the inputs contain a real one; otherwise leave a blank and do not invent a customer, a quote, or a number. DM 4 offers a low-pressure screen-share to map a plan. All four are drafts. Do not send them. ${GUARD}`,
    format: "Four drafts: DM 1 (asset plus a low-stakes role question). DM 2 (#1 problem). DM 3 (short peer example, or a blank if none was given). DM 4 (low-pressure screen-share to map a plan). Guardrail: no fabricated results, testimonials or income claims.",
    output: "A four-message DM sequence. Nothing is sent.",
  },
  {
    id: "weekly-time-audit",
    name: "Weekly time audit",
    category: PERSONAL,
    description: "A week scored by hourly value and energy, with three items to drop and a deep-work layout.",
    phrases: ["weekly time audit", "time audit", "energizing or draining"],
    words: ["draining"],
    inputs: [
      inp("hourlyValue", "Hourly value of my time"),
      inp("highValue", "Top 2 highest-value activities", { multiline: true }),
      inp("taskLog", "Last week's task log", { multiline: true }),
    ],
    role: "You are a performance-driven executive coach.",
    context: "Hourly value of my time: {{hourlyValue}}. Top 2 highest-value activities: {{highValue}}. Last week's task log: {{taskLog}}.",
    command: "Build a table of each task from the log, its hourly value, and whether it is energizing or draining. Compare the tasks with the hourly value of my time and the top 2 highest-value activities. Name the top 3 items to drop next week, and set each one to automate, delegate, or eliminate. Then lay out an ideal week with deep-work blocks. Do not invent tasks that are not in the log, and do not invent an hourly value.",
    format: "Table: task, hourly value, energizing or draining. Top 3 items to drop next week (each set to automate, delegate, or eliminate). Ideal week layout with deep-work blocks.",
    output: "A weekly time audit.",
  },
  {
    id: "prelaunch-risk-audit",
    name: "Pre-launch risk audit",
    category: OPS,
    description: "The launch bottleneck, integration fallbacks, testing hours, and a 48-hour go/no-go list.",
    phrases: ["pre-launch risk audit", "prelaunch risk audit", "go/no-go checklist", "launch risk audit"],
    words: ["over-allocated"],
    inputs: [
      inp("company", "Company", { profile: "businessName" }),
      inp("project", "Project", { multiline: true }),
      inp("launchDate", "Launch date"),
      inp("tools", "Tool stack", { profile: "tools", multiline: true }),
    ],
    role: "You are an operations and systems architect.",
    context: "Company: {{company}}. Project: {{project}}. Launch date: {{launchDate}}. Tool stack: {{tools}}.",
    command: "Name the biggest bottleneck in one sentence. Build a table of integration failure points, impact (L/M/H), and a manual fallback. Estimate testing hours and who is over-allocated. Close with a 5-point go/no-go checklist for 48 hours before launch. Use only the company, project, launch date, and tool stack above. Mark any hour estimate you had to guess.",
    format: "Biggest bottleneck in one sentence. Table: integration failure point, impact (L/M/H), manual fallback. Testing hours and who is over-allocated. 5-point go/no-go checklist for 48 hours before launch.",
    output: "A pre-launch risk audit.",
  },
  {
    id: "thought-leadership-outline",
    name: "Thought leadership article outline",
    category: CONTENT,
    description: "A B2B article outline: myth, cost, framework, a 4-step checklist, and a comment close.",
    phrases: ["thought leadership", "thought leadership article", "article outline", "industry myth outline"],
    words: ["ghostwriter"],
    inputs: [
      inp("reader", "Target reader"),
      inp("lesson", "Core lesson", { multiline: true }),
      inp("tone", "Tone"),
    ],
    role: "You are a B2B ghostwriter and positioning specialist. The close is a draft. Nothing is posted.",
    context: "Target reader: {{reader}}. Core lesson: {{lesson}}. Tone: {{tone}}.",
    command: `Write 3 headlines. Name a costly industry myth. Show how the mistake drains time or money. Present our framework and its result. Give a 4-step checklist. Close by asking readers to comment a keyword to get a resource. Match the tone. If the inputs do not state a measured result, leave the result blank. The close is a draft and nothing is posted. ${GUARD}`,
    format: "3 headlines. A costly industry myth. How the mistake drains time or money. Our framework with its result. A 4-step checklist. A close that asks readers to comment a keyword to get a resource. Guardrail: no fabricated results, testimonials or income claims.",
    output: "A thought-leadership article outline. Nothing is posted.",
  },
  {
    id: "win-back-lead",
    name: "Win back a lost lead",
    category: SALES,
    description: "Two drafts for a lead who declined about 90 days ago. Nothing is sent.",
    phrases: ["win back a lost lead", "lost lead", "win-back message", "declined 90 days ago"],
    words: ["win-back"],
    inputs: [
      inp("offer", "Offer", { profile: "offer", multiline: true }),
      inp("declined", "Why they declined 90 days ago", { multiline: true }),
      inp("brandVoice", "Brand voice", { multiline: true }),
    ],
    role: "You are a B2B pipeline strategist. You draft. You do not send.",
    context: "Offer: {{offer}}. Why they declined 90 days ago: {{declined}}. Brand voice: {{brandVoice}}.",
    command: `Write 2 messages in the brand voice. Message 1 is a 3-sentence check-in sharing a relevant case study or tool, with no pitch. If no real case study was given, share a tool or a process note and do not invent a result. Message 2, sent 4 days later, asks directly whether the problem is solved or still a priority this quarter. Both are drafts. Do not send them. ${GUARD}`,
    format: "Message 1: a 3-sentence check-in, a relevant case study or tool, no pitch. Message 2, sent 4 days later: a direct question on whether the problem is solved or still a priority this quarter. Guardrail: no fabricated results, testimonials or income claims.",
    output: "Two win-back drafts. Nothing is sent.",
  },
  {
    id: "personal-touch-handoff",
    name: "Hand off 'only I can do it' tasks",
    category: PERSONAL,
    description: "A table of personal-touch tasks, a one-page fill-in style guide, and the first hand-off.",
    phrases: ["only i can do it", "personal touch tasks", "hand off only i can do it", "style guide handoff"],
    words: ["style-guide"],
    inputs: [
      inp("hourlyValue", "Hourly value of my time"),
      inp("highValue", "Top 2 highest-value activities", { multiline: true }),
      inp("personalTasks", "Tasks I believe need my personal touch", { multiline: true }),
    ],
    role: "You are an executive efficiency coach.",
    context: "Hourly value of my time: {{hourlyValue}}. Top 2 highest-value activities: {{highValue}}. Tasks I believe need my personal touch: {{personalTasks}}.",
    command: "Build a table of each task I believe needs my personal touch, the hidden rule or style it relies on, and who or which AI workflow can handle it. Then write a 1-page fill-in style guide template. Then name the #1 task to hand off within 48 hours. Compare the tasks with the hourly value of my time and the top 2 highest-value activities. Do not invent a dollar figure.",
    format: "Table: task, hidden rule or style, who or which AI workflow. A 1-page fill-in style guide template. The #1 task to hand off within 48 hours.",
    output: "A hand-off plan for tasks that feel like only you can do them.",
  },
];
