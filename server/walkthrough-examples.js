// Watch an example reads the fictional samples in walkthroughs/examples/.
// Those files are the source of truth when they are present. A missing folder,
// a missing file, or unreadable JSON becomes a labeled placeholder. Nothing here calls an AI.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { TYPES } from "./walkthroughs.js";

export const EXAMPLE_NOTE = "Example data. This is a sample project with made-up details. Nothing was sent and no AI was called.";

const FILES = {
  website: "website.json",
  "music-video": "music-video.json",
  marketing: "marketing-campaign.json",
  app: "app.json",
  "business-plan": "business-plan.json",
  reels: "social-reels.json",
};

export function placeholderExample(typeId) {
  const type = TYPES.find((t) => t.id === typeId) || { id: typeId, name: typeId, questions: [], nextSteps: [] };
  const answers = {};
  for (const q of type.questions || []) {
    if (q.required) answers[q.key] = "Example data";
  }
  const nextSteps = (type.nextSteps || []).length >= 2
    ? type.nextSteps
    : [
      "Put the sample file in place, then watch the example again.",
      "Nothing was sent and no AI was called.",
    ];
  return {
    type: type.id,
    typeName: type.name,
    business: "Example",
    idea: `Example data. The sample file for ${type.name} is not on this computer.`,
    questions: (type.questions || []).map((q) => ({
      key: q.key, label: q.label, required: !!q.required, placeholder: q.placeholder || "",
    })),
    answers,
    plan: {
      title: `${type.name} example`,
      source: "placeholder",
      assembly: "Example data. Nothing was sent.",
      steps: [{
        id: "t1",
        title: "Example step",
        capability: "writing",
        deps: [],
        instructions: "Example data only.",
        deliverable: "Example data",
        provider: "anthropic",
        model: "example",
        agentName: "Example AI",
        output: "Example data. This placeholder stands in until the sample file is present.",
      }],
    },
    deliverable: "Example data. This is a placeholder because the sample file is not on this computer.",
    nextSteps,
    disclaimer: EXAMPLE_NOTE,
    placeholder: true,
  };
}

function fromFile(type, data) {
  if (!data || typeof data !== "object" || !data.plan || !Array.isArray(data.plan.steps) || !data.plan.steps.length) {
    return placeholderExample(type);
  }
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
    placeholder: false,
  };
}

export function loadExamples(dir) {
  return Object.entries(FILES).map(([type, file]) => {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      return fromFile(type, JSON.parse(raw));
    } catch {
      return placeholderExample(type);
    }
  });
}

export const EXAMPLES = loadExamples(path.join(ROOT, "walkthroughs", "examples"));

export function exampleByType(type) {
  return EXAMPLES.find((e) => e.type === type) || null;
}
