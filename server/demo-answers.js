// Practice answers for demo mode (0.4.17). The pretend AIs (Nova, Atlas and Sage) answer with
// short, plausible examples shaped like the request: a post, an email, a plan, a summary, code,
// a list, or a plain answer. Each pretend AI has its own style, so a council shows a real-looking
// difference of opinion. Everything is built here from the request text: no network, no key,
// nothing spent. Every answer ends with the "Sample answer: add a key for real answers" label.

export const PRACTICE_LABEL = "Sample answer: add a key for real answers";

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
  return `*${PRACTICE_LABEL} (${modelLabel(model)}). Nothing was spent.*`;
}

// The request itself: the first line after a QUESTION: / TASK: / GOAL: tag, without the app's own wrapping.
export function requestOf(user) {
  const u = String(user || "");
  const q = u.match(/QUESTION:\n([^\n]+)/);
  if (q) return q[1].trim();
  return u.replace(/^(QUESTION|TASK|GOAL):\s*/i, "").split("\n")[0].trim();
}

const KINDS = [
  // 0.4.37 (panel 0435 item 6): named HTML files are website requests, including plumber.html.
  ["website", /\b(website|web ?page|landing page|html page|[\w-]+\.html?)\b/i],
  // 0.4.37 (panel 0435 item 1): a run instruction at the end must not hide the requested code.
  ["code", /\b(code|script|program|function|python|javascript|typescript|powershell|apps script|google sheets script|bash|shell|sql|json|regex|bug|html|css|api endpoint|snippet)\b/i],
  ["howto", /\b(how (?:do|can|to)|steps? to|instructions? for|explain how)\b/i],
  ["review", /\b(reply|respond)\b.{0,30}\b(review|rating)\b|\b(review|rating)\b.{0,30}\b(reply|response)\b/i],
  ["legal", /\b(opposing counsel|attorney|lawyer|legal note|case file)\b/i],
  ["credit", /\b(credit repair|credit update|credit report)\b/i],
  ["listing", /\b(listing|open house|flyer|property description)\b/i],
  ["sop", /\b(sop|standard operating procedure|checklist)\b/i],
  // 0.4.37 (panel 0435 item 6): route stream titles and headline requests to counted title output.
  ["titles", /\b(title ideas?|titles? for|stream titles?|ideas? for (?:a|my|the) video|video hooks?|thumbnail text|headlines?|outline for (?:a|my|the) video)\b/i],
  // 0.4.37 (panel 0435 item 6): explicit line requests need short subject text, not a generic answer.
  ["lines", /\b\d{1,2}\s+(?:short\s+)?lines?\b/i],
  ["howto", /\bhow\b/i],
  // 0.4.31: a spreadsheet or a data list is a table, so the Spreadsheet and List or data paths really save a file in demo
  // 0.4.37 (panel 0435 item 6): price lists are data tables even without a file extension.
  ["table", /\b(spread ?sheets?|excel|xlsx|xlsm|csv|price list|guest list|(?:in|as|into) a table|table of|columns?)\b/i],
  ["email", /\b(e-?mail|follow[ -]?up|reply to|write to|renewal|letter|message to|thank[- ]you note|cold outreach)\b/i],
  ["post", /\b(posts?|caption|instagram|tiktok|tweet|reel|linkedin|facebook|social media|hashtags?)\b/i],
  ["summary", /\b(summar\w*|recap|tl;?dr|key points|main points|sum up)\b/i],
  ["plan", /\b(plan|schedule|roadmap|timeline|week|weekly|launch|strategy|checklist|steps to)\b/i],
  ["list", /\b(ideas?|list|names|options|ways to|top \d+|\d+ (ways|ideas|tips|things|reasons))\b/i],
];

// A request that asks to save a spreadsheet or a CSV file wants a table, whatever other words it uses.
const SAVES_TABLE = /\b(?:save|saved|name|call|export|as)\b[^.\n]{0,40}?\b[\w-]+\.(?:xlsx|xlsm|csv)\b/i;

export function kindOf(text) {
  const t = String(text || "");
  if (SAVES_TABLE.test(t)) return "table";
  // 0.4.37 (panel 0435 item 1): generated script prompts append "how to run it" after their task.
  if (/\b(?:script|program|function|code|python|javascript|typescript|powershell|apps script|bash|shell|sql|json)\b/i.test(t)) return "code";
  for (const [kind, re] of KINDS) if (re.test(t)) return kind;
  return "answer";
}

// "for my bakery" -> "bakery". Falls back to a neutral phrase.
export function subjectOf(text) {
  const t = String(text || "").toLowerCase();
  // 0.4.37 (panel 0435 item 6): a named creator is the topic of a title request.
  const titleFor = String(text || "").match(/\b(?:stream\s+)?titles?\s+for\s+(?:(?:my|our|the|a|an)\s+)?([a-z][a-z' -]{1,30}?)(?=[.,!?;:]|$|\s+(?:about|on|for)\b)/i);
  if (titleFor?.[1]) return titleFor[1].trim().split(/\s+/).slice(0, 4).join(" ");
  // 0.4.37 (panel 0435 item 6): titles and short lines can name a topic without an article.
  const topic = t.match(/\b(?:about|on|for)\s+(?:my|our|the|a|an)\s+([a-z][a-z' -]{1,40}?)(?=[.,!?;:]|$|\s+(?:under|with|who|that|this|next)\b)/);
  // (the day is said elsewhere in the answer, as below: "our Saturday bakery special" is "bakery special")
  const topicWords = topic?.[1] ? topic[1].replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekly|daily)\b/g, " ").replace(/\s+/g, " ").trim() : "";
  if (topicWords) return topicWords.split(/\s+/).slice(0, 4).join(" ");
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
  // 0.4.37 (panel 0435 item 6): renewal drafts mention the renewal decision and requested details.
  if (/renewal|renew|policy|insurance/i.test(req)) return `**Subject:** Insurance renewal\n\nHi [Name],\n\nI am writing about the upcoming renewal. Please send the updated premium, coverage details, and the date you need my decision.\n\nCould you share the renewal options by [date]?\n\nThank you,\n[Your name]`;
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
  // 0.4.36 (panel 0432 item 3): a SQLite request gets a script that runs in SQLite (the sample below is PostgreSQL)
  if (/\bsqlite\b|\.sql\b/.test(t)) {
    return "```sql\n-- A small books table, two rows, and the list, newest first\nCREATE TABLE IF NOT EXISTS books (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  author TEXT NOT NULL,\n  year INTEGER\n);\nINSERT INTO books (title, author, year) VALUES\n  ('Sample Book One', 'A. Writer', 1999),\n  ('Sample Book Two', 'B. Author', 2021);\nSELECT title, author, year FROM books ORDER BY year DESC;\n```" + (v === 1 ? "\n\n**Run it:** sqlite3 library.db < library.sql" : "");
  }
  if (sql) {
    return "```sql\n-- Customers who ordered in the last 30 days, newest first\nSELECT c.name, MAX(o.created_at) AS last_order\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'\nGROUP BY c.name\nORDER BY last_order DESC;\n```" + (v === 1 ? "\n\n**Note:** add an index on orders(customer_id, created_at) if this is slow." : "");
  }
  // 0.4.37 (panel 0435 item 6): Python requests get task shaped Python, not an unrelated CSV reader.
  if (py) {
    // a CSV request still gets the CSV reader: that one fits it (the panel's complaint was every request getting it)
    const sample = /renam(?:e|es|ing).*photo|photo.*renam/i.test(req)
      ? "from pathlib import Path\n\nfolder = Path(\"photos\")\nfor path in sorted(folder.iterdir()):\n    if path.is_file():\n        target = path.with_name(f\"{path.stem}-renamed{path.suffix}\")\n        print(f\"{path.name} -> {target.name}\")\n        # Uncomment after checking the preview.\n        # path.rename(target)"
      : /\bcsv\b/i.test(req)
        ? "import csv\n\ndef read_rows(path):\n    \"\"\"Read a CSV file and return a list of dicts, skipping empty rows.\"\"\"\n    with open(path, newline=\"\", encoding=\"utf-8\") as f:\n        return [row for row in csv.DictReader(f) if any(row.values())]\n\nif __name__ == \"__main__\":\n    print(len(read_rows(\"data.csv\")), \"rows\")"
        : "def main():\n    # Replace this sample value with your input.\n    value = \"sample\"\n    print(value)\n\nif __name__ == \"__main__\":\n    main()";
    return `\`\`\`python\n${sample}\n\`\`\``;
  }
  // 0.4.37 (panel 0435 item 6): JSON is valid data rather than prose.
  if (/\bjson\b/i.test(t)) return jsonSample(req);
  // 0.4.37 (panel 0435 item 7): PowerShell output uses native comments and a parameter block.
  if (/\bpowershell\b|\.ps1\b/i.test(t)) return "```powershell\nparam(\n    [string]$Source = \".\\sermons\",\n    [string]$Destination = \".\\backup\"\n)\n\n# Copy sermon files while keeping their names.\nNew-Item -ItemType Directory -Path $Destination -Force | Out-Null\nGet-ChildItem -Path $Source -File | Copy-Item -Destination $Destination -WhatIf\n```";
  // 0.4.37 (panel 0435 item 7): shell samples use shell comments.
  if (/\b(?:bash|shell)\b|\.sh\b/i.test(t)) return "```sh\n#!/usr/bin/env sh\n# Show files in the source folder.\nsource_dir=\"${1:-.}\"\nfind \"$source_dir\" -maxdepth 1 -type f -print\n```";
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

// 0.4.37 (panel 0435 item 6): a JSON sample with as many records as were asked for ("15 product records"), valid JSON
function jsonSample(req) {
  const m = String(req || "").match(/\b(\d{1,2})\s+(?:\w+\s+){0,2}(?:items?|products?|records?|entries|rows?|objects?)\b/i);
  const n = Math.min(15, Math.max(1, m ? Number(m[1]) : 3));
  const names = ["Classic tee", "Coffee mug", "Tote bag", "Sticker pack", "Gift card", "Candle", "Notebook", "Water bottle", "Cap", "Phone case", "Poster", "Keychain", "Socks", "Hoodie", "Pin set"];
  const rows = Array.from({ length: n }, (_, i) => ({ id: `SKU-${String(i + 1).padStart(3, "0")}`, name: names[i % names.length], price: 5 + ((i * 7) % 30), inStock: i % 4 !== 3 }));
  return "```json\n" + JSON.stringify(rows, null, 2) + "\n```";
}
function requestedCount(req, fallback = 3) {
  const m = String(req).match(/\b(\d{1,2})\s+(?:(?:short|youtube|video|stream|title|headline|content|social)\s+){0,3}(?:lines?|steps?|titles?|headlines?|ideas?|posts?|items?)\b/i);
  return m ? Math.min(20, Number(m[1])) : fallback;
}
function fitAnswer(req, v, kind) {
  // 0.4.37 (panel 0435 item 6): retain the topic after common requested counts and plain-language verbs.
  const titleSubject = kind === "titles" ? req.match(/\b(?:stream\s+)?titles?\s+for\s+(?:(?:my|our|the|a|an)\s+)?([a-z][a-z' -]{1,30}?)(?=[.,!?;:]|$|\s+(?:about|on|for)\b)/i)?.[1]?.trim() : "";
  const subject = titleSubject || subjectOf(req) || req.replace(/\b(?:write|make|draft|create|give me|please|in|\d+|short|lines?|about|three)\b/ig, "").trim().slice(0, 60) || "your request";
  const n = requestedCount(req, kind === "howto" ? 3 : 3);
  const lines = Array.from({ length: n }, (_, i) => {
    // 0.4.37 (panel 0435 item 6): keep the action phrase intact in how-to steps.
    if (kind === "howto") {
      const action = req.match(/how (?:do|can) i\s+(.+?)(?:[?.]|$)/i)?.[1];
      const topic = action || subject;
      return `${i + 1}. ${["First, prepare to", "Next, follow the steps to", "Then check that you can", "Finally, try to"][i % 4]} ${topic}.`;
    }
    if (kind === "titles") return `${i + 1}. ${["A simple guide to", "What to know about", "The best tips for", "A closer look at"][i % 4]} ${subject}`;
    if (kind === "sop") {
      const topic = req.match(/\bfor\s+(?:(?:my|our|the|a|an)\s+)?(.+?)(?:[?.]|$)/i)?.[1] || subject;
      return `${i + 1}. ${["Check", "Record", "Tell the owner", "Follow up on"][i % 4]} ${topic.replace(/^(?:an?\s+)?SOP\s+checklist\s+(?:for\s+)?/i, "")}.`;
    }
    if (kind === "lines") {
      const topic = req.match(/\babout\s+(.+?)(?:[?.]|$)/i)?.[1] || subject;
      return `${i + 1}. ${topic}: ${["A small change can make a big difference", "Look closely and ask a good question", "Keep learning one step at a time"][i % 3]}.`;
    }
    return `${i + 1}. ${subject}: ${["A clear first step", "What to check", "A helpful update", "Next steps"][i % 4]}.`;
  });
  if (kind === "website") {
    const named = String(req).match(/\b(?:called|named)\s+([A-Z][\w &'’-]*(?:\s+[A-Z][\w &'’-]*){0,3})/);
    const biz = (named?.[1] || subjectOf(req) || "Your business").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
    // 0.4.37 (panel 0435 item 6): include a working contact form and a phone link for service pages.
    const plumber = /plumb/i.test(req);
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${biz}</title></head><body><header><h1>${biz}</h1><p>${plumber ? "Local plumbing service and repairs." : `A simple page for ${biz}.`}</p>${plumber ? '<a href="tel:5550100">Call (555) 0100</a>' : ""}</header><main><h2>${plumber ? "Request service" : "What we offer"}</h2><p>Learn more about ${biz} and get in touch.</p><form action="#" method="get"><label>Name <input name="name" required></label><label>Email <input type="email" name="email" required></label><label>How can we help? <textarea name="message"></textarea></label><button type="submit">Send request</button></form><a href="mailto:hello@example.com">Contact us</a></main></body></html>`;
  }
  if (kind === "code") {
    const t = req.toLowerCase();
    // 0.4.37 (panel 0435 item 6): code-routed JSON stays JSON instead of becoming JavaScript.
    if (/\bjson\b/i.test(t)) return jsonSample(req);
    const isPy = /\bpython\b/.test(t);
    // 0.4.37 (panel 0435 item 7): keep fallback samples valid in the requested language.
    const isPs = /\bpowershell\b|\.ps1\b/.test(t);
    const isSh = /\b(?:bash|shell)\b|\.sh\b/.test(t);
    const isGs = /\b(?:apps script|google sheets script)\b/.test(t);
    const lang = isPy ? "python" : isPs ? "powershell" : isSh ? "sh" : /\b(?:node(?:\.js)?|javascript|js)\b/.test(t) ? "js" : "js";
    const task = req.replace(/[\r\n]+/g, " ").replace(/`/g, "");
    if (lang === "python") return `\`\`\`python\n# Sample task: ${task}\ndef main():\n    print(${JSON.stringify(subject)})\n\nif __name__ == "__main__":\n    main()\n\`\`\``;
    if (lang === "powershell") return `\`\`\`powershell\nparam(\n    [string]$InputPath = ".",\n    [string]$OutputPath = ".\\output"\n)\n\n# Sample task: ${task}\nNew-Item -ItemType Directory -Path $OutputPath -Force | Out-Null\nGet-ChildItem -Path $InputPath -File | Select-Object Name, Length\n\`\`\``;
    if (lang === "sh") return `\`\`\`sh\n#!/usr/bin/env sh\n# Sample task: ${task}\nprintf '%s\\n' "${subject.replace(/["\\$`]/g, "")}"\n\`\`\``;
    // 0.4.37 (panel 0435 item 1): Sheets scripts use the Apps Script spreadsheet service.
    if (isGs) return `\`\`\`javascript\n// Mark rows with a value in column A.\nfunction markRows() {\n  const sheet = SpreadsheetApp.getActiveSheet();\n  const count = sheet.getLastRow();\n  if (!count) return;\n  const values = sheet.getRange(1, 1, count, 1).getValues();\n  values.forEach((row, index) => {\n    if (row[0]) sheet.getRange(index + 1, 2).setValue("Ready");\n  });\n}\n\`\`\``;
    return `\`\`\`${lang}\n// Sample task: ${task}\nfunction run() {\n  console.log(${JSON.stringify(subject)});\n}\n\nrun();\n\`\`\``;
  }
  if (kind === "review") return `Sample review reply about ${subject}: Thank you for sharing your feedback. We appreciate you taking the time to let us know, and we will follow up on your comments.`;
  if (kind === "legal") return `Sample note to opposing counsel about ${subject}: I am writing to confirm receipt and ask that we coordinate the next steps and relevant dates. Please let me know if anything needs correction.`;
  if (kind === "credit") return `Sample credit update about ${subject}: We reviewed the items you shared and noted the next steps. Results vary, and this sample is not a promise of a specific outcome.`;
  if (kind === "listing") return `Sample listing for ${subject}: Visit an inviting place with useful details to explore. Join us for the open house and ask questions about the property.`;
  if (kind === "email") return `Sample follow-up letter about ${subject}: Thank you for your time. I am writing about ${subject} and would be glad to discuss the next steps. Best, [Your name]`;
  return lines.join("\n");
}

// ---- 0.4.31: a small table built from the request (a budget with a total, products, contacts, a tracker) ----
// A spreadsheet total is a formula (=SUM), so the sheet adds up again when a number changes; a CSV gets the number.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const AMOUNTS = { rent: 1200, mortgage: 1500, food: 450, groceries: 450, gas: 160, fuel: 160, utilities: 180, electric: 120, electricity: 120, water: 60, phone: 60, internet: 70, insurance: 140, car: 300, childcare: 600, savings: 200, fun: 100, eating: 150, clothes: 80, gym: 40 };
function amountFor(item, i) {
  const k = String(item).toLowerCase().split(/\s+/).find((w) => AMOUNTS[w]);
  if (k) return AMOUNTS[k];
  let h = 0;
  for (const c of String(item)) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 50 + ((h + i * 7) % 20) * 10;
}
// "products in my shop with name, price and stock" -> ["Name", "Price", "Stock"]
export function columnsOf(req) {
  const m = String(req || "").match(/\bwith (?:columns? (?:for )?)?([a-z][a-z /&'-]*?(?:\s*,\s*[a-z][a-z /&'-]*?)*(?:,? and [a-z][a-z /&'-]*?)?)(?=[.;:!?]|$| (?:for|in|to|so|that|each)\b)/i);
  if (!m) return [];
  const cols = m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((c) => c.trim().replace(/^(?:a|an|the|their|its|each)\s+/i, "")).filter(Boolean);
  if (cols.length < 2 || cols.length > 6 || cols.some((c) => c.split(/\s+/).length > 3)) return [];
  return cols.map(cap);
}
// "monthly budget for my house, rent, food, gas" -> ["Rent", "Food", "Gas"]
function itemsOf(req) {
  const first = String(req || "").split(/[.!?](?:\s|$)/)[0];
  const parts = first.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return [];
  const items = parts.slice(1).filter((p) => p.split(/\s+/).length <= 3 && !/\b(with|for|use|save)\b/i.test(p));
  return items.length >= 2 ? items.slice(0, 8).map(cap) : [];
}
const NAMES_OF = {
  product: ["Classic tee", "Coffee mug", "Tote bag", "Sticker pack", "Gift card"],
  person: ["Ann Lee", "Ben Ortiz", "Cara Shah", "Dan Kim", "Eva Brooks"],
  task: ["Order supplies", "Call the printer", "Update the price list", "Post the weekly special", "Pay the invoices"],
};
function cellFor(col, i, kind) {
  const c = col.toLowerCase();
  const names = NAMES_OF[kind] || NAMES_OF.product;
  if (/\b(name|item|product|title|task|contact|lead|person|customer)\b/.test(c)) return names[i % names.length];
  if (/\b(price|cost|amount|rate|value)\b/.test(c)) return [18, 12, 22, 5, 25][i % 5].toFixed(2);
  if (/\b(stock|qty|quantity|count|units|inventory|on hand)\b/.test(c)) return String([24, 40, 15, 60, 100][i % 5]);
  if (/e-?mail/.test(c)) return `${names[i % names.length].split(" ")[0].toLowerCase()}@example.com`;
  if (/phone|mobile|cell/.test(c)) return `555-01${String(10 + i * 7).padStart(2, "0")}`;
  if (/\b(date|due|when|deadline)\b/.test(c)) return `Nov ${3 + i * 2}`;
  if (/\bstatus\b/.test(c)) return ["New", "Called", "Booked", "Waiting", "Done"][i % 5];
  if (/\b(owner|who)\b/.test(c)) return ["You", "Sam", "You", "Jo", "Sam"][i % 5];
  if (/\b(sku|id|code)\b/.test(c)) return `SKU-${101 + i}`;
  if (/\b(category|type|kind)\b/.test(c)) return ["Clothing", "Kitchen", "Bags", "Paper", "Gifts"][i % 5];
  if (/\b(next step|follow)/.test(c)) return ["Send prices", "Call back Friday", "Book a visit", "Send the guide", "Check in next week"][i % 5];
  if (/\b(hours?|time)\b/.test(c)) return String([2, 1.5, 3, 0.5, 4][i % 5]);
  if (/\bnotes?\b/.test(c)) return ["Best seller", "Reorder soon", "New this month", "Gift idea", "Seasonal"][i % 5];
  return "[fill in]";
}
const tableRow = (cells) => `| ${cells.join(" | ")} |`;
const mdTable = (head, rows) => [tableRow(head), tableRow(head.map(() => "---")), ...rows.map(tableRow)].join("\n");

/** The table for a spreadsheet or list request: { kind, table, total } (total is set for a budget or an invoice). */
export function tableFor(req) {
  const t = String(req || "");
  const csv = /\bcsv\b/i.test(t);
  const cols = columnsOf(t);
  // 0.4.37 (panel 0435 item 6): wedding guest files use guest columns, not shop inventory fields.
  if (/guest.?list|wedding/i.test(t) && !cols.length) {
    const head = ["Name", "RSVP", "Meal", "Table"];
    const names = ["Alex Morgan", "Jamie Lee", "Riley Chen", "Taylor Jones", "Jordan Patel"];
    const rows = names.map((name, i) => [name, ["Yes", "Pending", "Yes", "No", "Pending"][i], ["Vegetarian", "Standard", "Vegan", "Standard", "Gluten free"][i], String(i + 1)]);
    return { kind: "person", table: mdTable(head, rows), total: null };
  }
  if (/\binvoices?\b/i.test(t)) {
    const items = itemsOf(t).length ? itemsOf(t) : ["Design work", "Printing", "Delivery"];
    const qty = [3, 2, 1, 4, 2, 1, 3, 2], price = [80, 45, 25, 30, 60, 15, 40, 20];
    const rows = items.map((it, i) => [it, String(qty[i]), price[i].toFixed(2), csv ? (qty[i] * price[i]).toFixed(2) : `=B${i + 2}*C${i + 2}`]);
    const sum = items.reduce((a, _, i) => a + qty[i] * price[i], 0);
    rows.push([csv ? "Total due" : "**Total due**", "", "", csv ? sum.toFixed(2) : `=SUM(D2:D${items.length + 1})`]);
    return { kind: "invoice", table: mdTable(["Item", "Qty", "Price", "Line total"], rows), total: sum };
  }
  if (/\b(budget|expenses?|spending|bills|costs|money)\b/i.test(t) && !cols.length) {
    const items = itemsOf(t).length ? itemsOf(t) : ["Rent", "Groceries", "Utilities", "Gas", "Phone"];
    const amounts = items.map((it, i) => amountFor(it, i));
    const rows = items.map((it, i) => [it, amounts[i].toFixed(2)]);
    const sum = amounts.reduce((a, b) => a + b, 0);
    rows.push([csv ? "Total" : "**Total**", csv ? sum.toFixed(2) : `=SUM(B2:B${items.length + 1})`]);
    return { kind: "budget", table: mdTable(["Item", "Monthly amount"], rows), total: sum };
  }
  let kind = "product", head = cols;
  // (guests, attendees and RSVPs are people too: a guest list with its own columns got shop products as names)
  if (/\b(contacts?|leads?|customers?|clients?|people|members?|guests?|attendees?|invitees?|rsvps?|wedding|students?|volunteers?|staff|employees?)\b/i.test(t)) {
    kind = "person";
    if (!head.length) head = /\bleads?\b/i.test(t) ? ["Name", "Email", "Status", "Next step"] : ["Name", "Phone", "Email"];
  } else if (/\b(tracker|track|tasks?|habits?|hours|to-?do|schedule|jobs?)\b/i.test(t)) {
    kind = "task";
    if (!head.length) head = ["Task", "Owner", "Due", "Status"];
  } else if (!head.length) head = ["Name", "Price", "Stock"];
  const rows = [0, 1, 2, 3, 4].map((i) => head.map((c) => cellFor(c, i, kind)));
  return { kind, table: mdTable(head, rows), total: null };
}

function table(req, v) {
  const { kind, table: tbl, total } = tableFor(req);
  const csv = /\bcsv\b/i.test(req);
  const what = { budget: "budget", invoice: "invoice", person: "list", task: "tracker", product: "list" }[kind];
  if (v === 2) return tbl;
  if (v === 1) {
    const note = total != null
      ? (csv ? `**Note:** the total is ${total.toFixed(2)}. Add the column again after you change a number.` : "**Note:** the total is a formula, so it adds up again when you change a number.")
      : "**Note:** one row per item and the header row first, so it opens cleanly in Excel or Google Sheets.";
    return `${tbl}\n\n${note}`;
  }
  return `Here is a starting ${what} you can change. Swap in your own numbers and names.\n\n${tbl}\n\n${total != null ? "Check each amount against a real bill before you rely on the total." : "Add a row for each new item and keep the header row as it is."}`;
}

// 0.4.37 (panel 0435 item 6): route counted educational lines to the short-line builder.
const BUILDERS = { post, email, plan, summary, code, list, answer, table, website: fitAnswer, howto: fitAnswer, review: fitAnswer, legal: fitAnswer, credit: fitAnswer, listing: fitAnswer, sop: fitAnswer, titles: fitAnswer, lines: fitAnswer };

// The heading over a practice answer (0.4.25). It used to be the first 70 characters, which cut
// "Write a week of Instagram posts for my two-location bakery. Save them as posts.md." to "...Save them".
// Now: the whole request when it fits in 90 characters; else its whole first sentence when that fits;
// else the request cut at the last word boundary before 90 characters, with "...". A full stop inside a
// word (posts.md, 2.5) is not the end of a sentence.
// 0.4.31: a folder path is dropped from the heading ("save it as menu.md in C:\Users\...\cafe" keeps
// "save it as menu.md"), so the cut never lands inside a path and the file name stays.
export const TITLE_MAX = 90;
const FOLDER_PATH = /\s+(?:in|into|to|under|inside|at)\s+(?:the\s+|my\s+)?(?:folder\s+)?(?:"[^"]*[\\/][^"]*"|'[^']*[\\/][^']*'|(?:[A-Za-z]:[\\/]|~[\\/]|\\\\|\/|\.{1,2}[\\/]|(?!(?:and|either)\/or\b)[A-Za-z][\w.-]+[\\/])[^\s"']*(?:\s+[^\s"']*[\\/][^\s"']*)*)(?:\s+folder\b)?/g;
/** The request without folder paths ("in C:\Users\me\Desktop", "to ~/notes/"), for a heading. */
export function withoutFolderPath(text) {
  return String(text || "").replace(FOLDER_PATH, "").replace(/\s+([.,;:!?])/g, "$1");
}
export function answerTitle(req, max = TITLE_MAX) {
  const whole = String(req || "").replace(/\s+/g, " ").trim();
  const t = withoutFolderPath(whole).trim();
  if (!t) return "";
  const tidy = (x) => x.replace(/\.$/, "").trim();
  const cutAt = (x, n) => {
    const cut = x.slice(0, n + 1);
    const space = cut.lastIndexOf(" ");
    return (space > n / 2 ? cut.slice(0, space) : x.slice(0, n)).replace(/[\s,;:.!?-]+$/, "");
  };
  const first = t.match(/^.+?[.!?](?=\s|$)/)?.[0];
  let out = t.length <= max ? tidy(t) : first && first.length <= max ? tidy(first) : cutAt(t, max) + "...";
  // a path was dropped: the file name it was saved under stays in the heading ("... save it as menu.md")
  if (t !== whole) {
    const save = t.match(/\b(?:save|saved|write|export|put|store|name|call)\b[^.!?]{0,40}?\b[\w-]+\.[a-z0-9]{1,5}\b/i)?.[0];
    const file = save?.match(/[\w-]+\.[a-z0-9]{1,5}$/i)?.[0];
    if (file && !out.includes(file)) {
      const head = t.slice(0, t.indexOf(save)).replace(/[\s,;:.!?-]+$/, "");
      const room = max - save.length - 4;
      out = !head ? save : head.length <= room ? `${head}, ${save}` : `${cutAt(head, Math.max(room, 20))}... ${save}`;
    }
  }
  return out;
}

// The answer body (no heading, no footer) for this request and this pretend AI.
export function practiceBody(user, model) {
  const req = requestOf(user);
  const kind = kindOf(req);
  if (kind === "code" && /\bsqlite\b|\.sql\b/i.test(req)) return code(req, voiceOf(model));
  if (kind === "code" && /\b(?:node(?:\.js)?|javascript|\bjs\b|powershell|apps script|google sheets script|bash|shell|json)\b/i.test(req)) return fitAnswer(req, voiceOf(model), "code");
  return BUILDERS[kind] === fitAnswer ? BUILDERS[kind](req, voiceOf(model), kind) : BUILDERS[kind](req, voiceOf(model), user);
}

// The whole practice answer the pretend AI streams back.
export function practiceAnswer(user, model, lead = []) {
  const req = requestOf(user);
  const topic = answerTitle(req) || "Your request";
  return [...lead, `## ${topic}`, practiceBody(user, model), practiceFooter(model)].join("\n\n");
}

// What the reviewers say differs, by kind. Letters stay anonymous, like the real peer review.
const DIFFER = {
  post: "A is warmer and longer; C is shorter and may be too plain to stop the scroll. They differ on adding a deadline.",
  email: "B adds a recap and a fixed call time; C is shorter. They differ on how direct the ask should be.",
  plan: "B uses a weekly table; C has only three steps. They differ on how much to plan before starting.",
  summary: "They agree on the main point; B adds a decision owner that the others leave out.",
  code: "Same approach; B adds an edge case note, C gives the code with no explanation.",
  table: "Same table; B adds a note on the totals, C gives the table with no words.",
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
    table: [`${by(2)} gave the table only; ${by(1)} added a note on the totals. The verdict keeps the note.`],
    list: [`${by(0)} would start with behind the scenes; ${by(1)} with the weekly question.`],
    answer: [`${by(1)} compared three options; ${by(2)} gave a one-line answer. The verdict keeps the comparison.`],
  }[kind];
  const credits = seats.length
    ? seats.map((s, i) => `- Answer ${s.letter} (${s.name}): ${["the warm opening", "the structure", "the short version"][i % 3]}.`).join("\n")
    : "- Every answer added something.";
  return [`## ${answerTitle(req) || "Council verdict"}`, merged, `**Where the council disagreed**\n${disagreed.map((d) => `- ${d}`).join("\n")}`, `**Credits**\n${credits}`, practiceFooter(model)].join("\n\n");
}
