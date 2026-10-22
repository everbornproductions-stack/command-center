// Practice answers for demo mode (0.4.17). The pretend AIs (Nova, Atlas and Sage) answer with
// short, plausible examples shaped like the request: a post, an email, a plan, a summary, code,
// a list, or a plain answer. Each pretend AI has its own style, so a council shows a real-looking
// difference of opinion. Everything is built here from the request text: no network, no key,
// nothing spent. Every answer ends with the "Practice answer from a pretend AI" label.

export const PRACTICE_LABEL = "Practice answer from a pretend AI";

const NAMES = { "nova-ultra": "Nova Ultra", "nova-lite": "Nova Lite", "atlas-pro": "Atlas Pro", "sage-mini": "Sage Mini" };

// 0 = Nova (warm, a little longer), 1 = Atlas (structured), 2 = Sage (short and plain)
export function voiceOf(model) {
  const m = String(model || "").toLowerCase();
  if (m.startsWith("atlas")) return 1;
  if (m.startsWith("sage")) return 2;
  return 0;
}

export function modelLabel(model) {
  return NAMES[model] || String(model || "a pretend AI");
}

export function practiceFooter(model) {
  return `*${PRACTICE_LABEL} (${modelLabel(model)}). Nothing was spent. Add a key in Settings for real answers.*`;
}

// The request itself: the first line after a QUESTION: / TASK: / GOAL: tag, without the app's own wrapping.
export function requestOf(user) {
  const u = String(user || "");
  const q = u.match(/QUESTION:\n([^\n]+)/);
  if (q) return q[1].trim();
  return u.replace(/^(QUESTION|TASK|GOAL):\s*/i, "").split("\n")[0].trim();
}

const KINDS = [
  ["code", /\b(code|script|function|python|javascript|typescript|sql|regex|bug|html|css|api endpoint|snippet)\b/i],
  ["email", /\b(e-?mail|follow[ -]?up|reply to|write to|letter|message to|thank[- ]you note|cold outreach)\b/i],
  ["post", /\b(post|caption|instagram|tiktok|tweet|reel|linkedin|facebook|social media|hashtags?)\b/i],
  ["summary", /\b(summar\w*|recap|tl;?dr|key points|main points|sum up)\b/i],
  ["plan", /\b(plan|schedule|roadmap|timeline|week|weekly|launch|strategy|checklist|steps to)\b/i],
  ["list", /\b(ideas?|list|names|options|ways to|top \d+|\d+ (ways|ideas|tips|things|reasons))\b/i],
];

export function kindOf(text) {
  const t = String(text || "");
  for (const [kind, re] of KINDS) if (re.test(t)) return kind;
  return "answer";
}

// "for my bakery" -> "bakery". Falls back to a neutral phrase.
export function subjectOf(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/\b(?:for|about|at|of) (?:my|our|the|a|an) ([a-z][a-z' -]{1,40}?)(?=[.,!?;:]|$| (?:about|to|on|that|this|next|for|with|in|and|who)\b)/);
  // The day is said elsewhere in the answer ("our Saturday bakery special" becomes "bakery special").
  const s = m ? m[1].replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekly|daily)\b/g, " ").replace(/\s+/g, " ").trim() : "";
  return s && s.split(" ").length <= 4 ? s : "";
}

function hashtag(s) {
  const words = String(s || "").split(/[^a-z0-9]+/i).filter(Boolean).slice(0, 3);
  return words.length ? "#" + words.map((w) => w[0].toUpperCase() + w.slice(1)).join("") : "#SmallBusiness";
}

function dayOf(text) {
  const m = String(text || "").match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|tomorrow|today)\b/i);
  if (!m) return "this week";
  const d = m[1].toLowerCase();
  if (d === "weekend") return "this weekend";
  if (d === "today" || d === "tomorrow") return d;
  return "this " + d[0].toUpperCase() + d.slice(1);
}

function post(req, v) {
  const biz = subjectOf(req) || "shop";
  const when = dayOf(req);
  const tag = hashtag(biz);
  if (v === 1) {
    return [
      `**Option A (friendly)**\nIt's almost ${when.replace(/^this /, "")} at the ${biz}. Something new is waiting for you, and it tends to go early. Come say hi.\n${tag} #ShopLocal`,
      `**Option B (urgent)**\n${when[0].toUpperCase() + when.slice(1)} only: our newest pick at the ${biz}, while it lasts. Doors open at [time].\n${tag} #LimitedTime`,
      `**Best time to post:** the evening before, between 6 and 8 pm.\n**Picture:** one close-up, natural light, no text on the image.`,
    ].join("\n\n");
  }
  if (v === 2) return `${when[0].toUpperCase() + when.slice(1)} at the ${biz}: something new, first come first served. See you there.\n${tag}`;
  return [
    `${when[0].toUpperCase() + when.slice(1)} at the ${biz} is going to be a good one. We've been working on something new, and we can't wait for you to try it.`,
    `Come early, because the first batch never lasts long. Tag a friend who needs this in their weekend.`,
    `${tag} #ShopLocal #SupportSmallBusiness`,
  ].join("\n\n");
}

function email(req, v) {
  const about = subjectOf(req);
  const topic = about ? `the ${about}` : "what we discussed";
  if (v === 1) {
    return [
      `**Subject:** Next steps on ${topic}`,
      `Hi [Name],\n\nThanks again for your time on [day]. A quick recap so we're on the same page:\n\n- You'd like [main goal] by [date].\n- I'll send [what you promised] by [date].\n- The open question is [budget, timing, or approval].`,
      `Would [Tuesday at 10 am] work for a 15-minute call to close that last point?\n\nBest,\n[Your name]`,
    ].join("\n\n");
  }
  if (v === 2) return `**Subject:** Quick follow-up\n\nHi [Name], just checking in on ${topic}. Is [Thursday] still good for a short call? Happy to work around you.\n\n[Your name]`;
  return [
    `**Subject:** Following up on ${topic}`,
    `Hi [Name],\n\nI hope your week is going well. I wanted to follow up on ${topic} and make sure you have everything you need from me.`,
    `If it helps, I can put together a short summary with options and prices so you can share it with your team. Would [day] work for a quick call?\n\nThanks again,\n[Your name]`,
  ].join("\n\n");
}

function plan(req, v) {
  const biz = subjectOf(req) || "project";
  if (v === 1) {
    return [
      `| Week | Focus | Done when |\n|---|---|---|\n| 1 | Pick one goal and one number to watch | Goal written down |\n| 2 | Make the first version for the ${biz} | Shown to 3 people |\n| 3 | Fix what they found, then launch | Live, with a date |\n| 4 | Look at the number, keep what worked | Next month planned |`,
      `**Risk to watch:** trying to do all four weeks in week one.`,
    ].join("\n\n");
  }
  if (v === 2) return `1. Pick one goal for the ${biz}.\n2. Make a small first version this week.\n3. Check the result in two weeks and adjust.`;
  return [
    `**This week:** write down the one result you want from the ${biz}, and who it is for.`,
    `**Next week:** make a small first version and show it to three people you trust. Ask what was confusing.`,
    `**Week 3:** fix the top two problems, then launch with a clear date.`,
    `**Week 4:** look at what happened, keep what worked, and plan the next month.`,
  ].join("\n\n");
}

function sentencesOf(user) {
  const body = String(user || "").split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
  return (body.match(/[^.!?]{12,}[.!?]/g) || []).map((s) => s.trim()).slice(0, 3);
}

function summary(req, v, user) {
  const s = sentencesOf(user);
  const points = s.length ? s : ["The main goal is stated near the start.", "There is one open question about timing.", "A decision is needed before work starts."];
  if (v === 2) return `**In one line:** ${points[0]}\n\n**Next step:** decide on the open question.`;
  const bullets = points.map((p) => `- ${p}`).join("\n");
  if (v === 1) return `**Key points**\n\n${bullets}\n\n**Decision needed:** who owns the next step, and by when.`;
  return `Here's the short version.\n\n${bullets}\n\n**What I'd do next:** reply with the one question that is still open, so nothing stalls.`;
}

function code(req, v) {
  const t = req.toLowerCase();
  const py = /\bpython\b/.test(t);
  const sql = /\bsql\b/.test(t);
  if (sql) {
    return "```sql\n-- Customers who ordered in the last 30 days, newest first\nSELECT c.name, MAX(o.created_at) AS last_order\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'\nGROUP BY c.name\nORDER BY last_order DESC;\n```" + (v === 1 ? "\n\n**Note:** add an index on orders(customer_id, created_at) if this is slow." : "");
  }
  if (py) {
    return "```python\nimport csv\n\ndef read_rows(path):\n    \"\"\"Read a CSV file and return a list of dicts, skipping empty rows.\"\"\"\n    with open(path, newline=\"\", encoding=\"utf-8\") as f:\n        return [row for row in csv.DictReader(f) if any(row.values())]\n\nif __name__ == \"__main__\":\n    print(len(read_rows(\"data.csv\")), \"rows\")\n```" + (v === 1 ? "\n\n**Test it:** run it on a file with one blank line and check the count." : "");
  }
  const body = "```js\n// Remove duplicates by email, keeping the first one seen\nexport function uniqueByEmail(people) {\n  const seen = new Set();\n  return people.filter((p) => {\n    const key = String(p.email || \"\").trim().toLowerCase();\n    if (!key || seen.has(key)) return false;\n    seen.add(key);\n    return true;\n  });\n}\n```";
  if (v === 2) return body;
  if (v === 1) return `${body}\n\n**Why this way:** a Set check is one pass, so it stays fast on large lists.\n**Edge case:** blank emails are dropped. Keep them if you need every row.`;
  return `Here's a small, readable version you can drop in.\n\n${body}\n\nIt trims spaces and ignores capital letters, so "Ann@x.com " and "ann@x.com" count as the same person.`;
}

function list(req, v) {
  const biz = subjectOf(req) || "business";
  const ideas = [
    `A behind-the-scenes look at how the ${biz} gets ready each morning`,
    `Customer question of the week, answered in 30 seconds`,
    `A before and after that shows the result, not the process`,
    `A weekend offer with a clear end time`,
    `A thank-you post for a regular customer (with their OK)`,
  ];
  if (v === 2) return ideas.slice(0, 3).map((x, i) => `${i + 1}. ${x}`).join("\n");
  if (v === 1) return `${ideas.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n**Start with:** number 2. It is the easiest to repeat every week.`;
  return `${ideas.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nIf you only try one, make it the behind-the-scenes post. People like seeing the real ${biz}.`;
}

function answer(req, v) {
  if (v === 1) {
    return `**Short answer:** start small, measure one thing, then decide.\n\n| Option | Good for | Watch out for |\n|---|---|---|\n| Do it yourself | Low cost, full control | Takes your time |\n| Hire help | Faster, expert eye | Costs more up front |\n| Wait a month | More information | Lost momentum |\n\n**My pick:** try it yourself for two weeks, then decide with real numbers.`;
  }
  if (v === 2) return `Start small and test one thing at a time. Decide after two weeks, with real numbers.`;
  return `**Short answer:** for most people, the best first step is a small test you can finish in a week.\n\n**Why:** a small test shows you what works before you spend real time or money.\n\n**What to do next:**\n1. Write down the one result you want.\n2. Pick the smallest step that would show progress.\n3. Check back in a week and keep what worked.`;
}

const BUILDERS = { post, email, plan, summary, code, list, answer };

// The answer body (no heading, no footer) for this request and this pretend AI.
export function practiceBody(user, model) {
  const req = requestOf(user);
  const kind = kindOf(req);
  return BUILDERS[kind](req, voiceOf(model), user);
}

// The whole practice answer the pretend AI streams back.
export function practiceAnswer(user, model, lead = []) {
  const req = requestOf(user);
  const topic = req.slice(0, 70) || "Your request";
  return [...lead, `## ${topic}`, practiceBody(user, model), practiceFooter(model)].join("\n\n");
}

// What the reviewers say differs, by kind. Letters stay anonymous, like the real peer review.
const DIFFER = {
  post: "A is warmer and longer; C is shorter and may be too plain to stop the scroll. They differ on adding a deadline.",
  email: "B adds a recap and a fixed call time; C is shorter. They differ on how direct the ask should be.",
  plan: "B uses a weekly table; C has only three steps. They differ on how much to plan before starting.",
  summary: "They agree on the main point; B adds a decision owner that the others leave out.",
  code: "Same approach; B adds an edge case note, C gives the code with no explanation.",
  list: "They differ on which idea to start with: B says the weekly question, A says behind the scenes.",
  answer: "They agree on starting small; B compares options in a table, C gives one line.",
};

export function practiceDisagreement(user) {
  return DIFFER[kindOf(requestOf(user))] || DIFFER.answer;
}

// The chair's verdict in a pretend council: the merged answer, where they disagreed, and credits.
export function practiceVerdict(user, model) {
  const req = requestOf(user);
  const kind = kindOf(req);
  const seats = [...String(user || "").matchAll(/### Answer ([A-J]) \((.+?)(?:, peer score [^)\n]*)?\)\n/g)].map((m) => ({ letter: m[1], name: m[2].trim() }));
  const by = (i) => seats[i]?.name || ["Nova", "Atlas", "Sage"][i];
  const merged = BUILDERS[kind](req, 1, user);
  const disagreed = {
    post: [`${by(0)} wanted a warmer, longer caption; ${by(2)} wanted one short line.`, `${by(1)} suggested giving two versions and a time to post. The verdict keeps both versions.`],
    email: [`${by(1)} wanted a recap and a fixed call time; ${by(2)} said keep it to two lines.`, "The verdict keeps the recap but cuts it to three bullets."],
    plan: [`${by(1)} wanted a week-by-week table; ${by(2)} said three steps are enough to start.`, "The verdict keeps the table and marks week 1 as the only must-do."],
    summary: [`${by(1)} added who owns the next step; the others did not.`],
    code: [`${by(2)} gave the code only; ${by(1)} added an edge case. The verdict keeps the note.`],
    list: [`${by(0)} would start with behind the scenes; ${by(1)} with the weekly question.`],
    answer: [`${by(1)} compared three options; ${by(2)} gave a one-line answer. The verdict keeps the comparison.`],
  }[kind];
  const credits = seats.length
    ? seats.map((s, i) => `- Answer ${s.letter} (${s.name}): ${["the warm opening", "the structure", "the short version"][i % 3]}.`).join("\n")
    : "- Every answer added something.";
  return [`## ${req.slice(0, 70) || "Council verdict"}`, merged, `**Where the council disagreed**\n${disagreed.map((d) => `- ${d}`).join("\n")}`, `**Credits**\n${credits}`, practiceFooter(model)].join("\n\n");
}
