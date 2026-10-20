// Watch an example reads the fictional samples in walkthroughs/examples/.
// Those files are the source of truth. Nothing here calls an AI.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

export const EXAMPLE_NOTE = "Example data. This is a sample project with made-up details. Nothing was sent and no AI was called.";

const FILES = {
  website: "website.json",
  "music-video": "music-video.json",
  marketing: "marketing-campaign.json",
  app: "app.json",
  "business-plan": "business-plan.json",
  reels: "social-reels.json",
};

function loadOne(type, file) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "walkthroughs", "examples", file), "utf8"));
  const answers = {};
  for (const q of data.questions || []) {
    const value = data.answers?.[q.key] ?? q.answer ?? "";
    if (String(value).trim()) answers[q.key] = String(value);
  }
  return {
    type,
    typeName: data.name,
    business: data.business,
    idea: data.idea,
    questions: (data.questions || []).map((q) => ({
      key: q.key, label: q.label, required: !!q.required, placeholder: q.placeholder || "",
    })),
    answers,
    plan: data.plan,
    deliverable: data.deliverable,
    nextSteps: data.nextSteps || [],
    disclaimer: data.disclaimer || EXAMPLE_NOTE,
  };
}

export const EXAMPLES = Object.entries(FILES).map(([type, file]) => loadOne(type, file));

export function exampleByType(type) {
  return EXAMPLES.find((e) => e.type === type) || null;
}
