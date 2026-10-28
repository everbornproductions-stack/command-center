// Keep the owner's private working rules out of mission plans (0.4.23.1, dogfood 07, 11, 12).
// A coding assistant that reads a person's own CLAUDE.md (for example "commit and push to the private GitHub repo",
// "save media to Google Drive", "Supabase") can repeat those rules inside a plan or an answer. They are the owner's
// habits for their own projects, not part of the job the user typed. Pure functions, no files read.

// a line or step that is about the owner's storage routine
const ROUTINE = [
  /\bcommit(?:ted|ting)?\s+(?:and|&|then)\s+push(?:ed|ing)?\b/i,
  /\bpush(?:ed|ing)?\s+(?:it\s+|them\s+|the\s+\w+\s+)?to\s+(?:the\s+)?(?:private\s+)?(?:github|git\b|repo)/i,
  /\bprivate\s+(?:github\s+)?repo\b/i,
  /\bcloud[-\s]first\b/i,
  /\bEverborn\s+Cloud\b/i,
  /\bG:\\My Drive\b/i,
  /\bback\s*up\s+(?:\w+\s+){0,3}?to\s+(?:github|google\s+drive|drive|supabase)\b/i,
  /\b(?:copy|save|sync|upload|put)\s+(?:\w+\s+){0,3}(?:to|in|into)\s+(?:the\s+)?(?:google\s+)?drive\b.*\bsync/i,
  /\bnothing\s+may\s+live\s+only\s+on\b/i,
  /\bsupabase\s+postgres\b/i,
  /\bnothing\s+has\s+been\s+saved\s+anywhere\s+yet\b/i,
];
const matchesRoutine = (s) => ROUTINE.some((re) => re.test(s));

// did the person themselves ask for it? Then it is theirs and stays.
const ASKED = /\b(github|git\b|commit|push|google\s+drive|my\s+drive|supabase|back\s*up|backup)\b/i;
export const userAsked = (goal) => ASKED.test(String(goal || ""));

/** Remove sentences and lines that carry the private routine. Text the user's own goal asked for is left alone. */
export function stripPrivateRules(text, goal = "") {
  const t = String(text ?? "");
  if (!t || userAsked(goal)) return t;
  const out = t.split("\n").map((line) => {
    if (!matchesRoutine(line)) return line;
    // keep any sentence in the line that is not about the routine
    const kept = line.split(/(?<=[.!?])\s+/).filter((s) => !matchesRoutine(s));
    return kept.join(" ").trim();
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** A planned step that only carries out the owner's routine ("Commit and push", "Back up files to GitHub and Drive"). */
export function isPrivateRuleStep(t = {}, goal = "") {
  if (userAsked(goal)) return false;
  const title = String(t.title || "");
  const body = `${title}\n${t.instructions || ""}\n${t.deliverable || ""}`;
  if (matchesRoutine(title)) return true;
  // the instructions are routine and nothing else is asked
  const extra = `${t.instructions || ""}\n${t.deliverable || ""}`;
  return matchesRoutine(extra) && !stripPrivateRules(extra, "").trim();
}

/** Drop routine steps from a plan, clean the rest, and close the gaps in deps. Returns the plan and how many steps went. */
export function cleanPlan(plan, goal = "") {
  if (!plan || !Array.isArray(plan.tasks) || userAsked(goal)) return { plan, dropped: 0 };
  const drop = new Set(plan.tasks.filter((t) => isPrivateRuleStep(t, goal)).map((t) => t.id));
  if (drop.size === plan.tasks.length) return { plan, dropped: 0 }; // never leave an empty plan
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const through = (deps = []) => [...new Set(deps.flatMap((d) => (drop.has(d) ? through(byId.get(d)?.deps || []) : [d])))];
  const tasks = plan.tasks.filter((t) => !drop.has(t.id)).map((t) => ({
    ...t,
    title: stripPrivateRules(t.title, goal) || t.title,
    instructions: stripPrivateRules(t.instructions, goal),
    deliverable: stripPrivateRules(t.deliverable, goal),
    deps: through(t.deps || []),
  }));
  const assembly = typeof plan.assembly === "string" ? stripPrivateRules(plan.assembly, goal) : plan.assembly;
  return { plan: { ...plan, tasks, assembly }, dropped: drop.size };
}
