// Schedules, agent teams, and pipelines that a Pro prompt can create on click.
// Outbound stays off. New schedules are paused until the person turns them on.

import fs from "node:fs";
import * as Schedules from "../schedules.js";
import { createAgent, listAgents } from "../custom-agents.js";
import { getTemplate, SCHEDULED_IDS } from "./catalog.js";
import { renderTemplate } from "./render.js";

export const KLING_PRESENT = fs.existsSync(new URL("../media/kling.js", import.meta.url));
export const VOICE_PRESENT = fs.existsSync(new URL("../plugins/voice.js", import.meta.url));
export const SCHEDULES_PRESENT = fs.existsSync(new URL("../schedules.js", import.meta.url));

const TEAM = [
  {
    name: "Data cleanse and mapping",
    description: "Cleans a source file and maps fields before the next agent.",
    instructions: "ROLE: You clean data and map fields.\nCONTEXT: You receive a raw export and a target field list.\nCOMMAND: Drop empty rows, flag duplicates, and map each source column to a target field. Halt if a target field has no source.\nFORMAT: A mapping table and a list of rows that need a human.",
  },
  {
    name: "Formatting and API prep",
    description: "Turns mapped rows into the JSON a later API call would use.",
    instructions: "ROLE: You prepare payloads.\nCONTEXT: You receive the mapping table from Data cleanse and mapping.\nCOMMAND: Write one example payload and the field rules. Do not call any API.\nFORMAT: Example JSON, required fields, and what to do when a field is missing.",
  },
  {
    name: "Reporting and notification",
    description: "Writes the report and a draft notice. It does not send.",
    instructions: "ROLE: You report what the pipeline found.\nCONTEXT: You receive the clean set and the payload rules.\nCOMMAND: Summarize counts that were actually in the input. Draft a notice. Do not send it.\nFORMAT: Counts, exceptions, and a DRAFT notice.",
  },
];

function pipelineDoc(h) {
  return h.doc("pipelines.saved", () => ({ items: [] }));
}

export function savePipeline(h, item) {
  const d = pipelineDoc(h);
  d.items = Array.isArray(d.items) ? d.items : [];
  const i = d.items.findIndex((x) => x.id === item.id);
  if (i >= 0) d.items[i] = item;
  else d.items.push(item);
  h.putDoc("pipelines.saved", d);
  return item;
}

function step(title, i, instructions) {
  return { title: title.slice(0, 80), capability: "writing", deps: i ? [i] : [], instructions: instructions.slice(0, 1000), deliverable: "The step's output" };
}

export function createTeam(h) {
  const agents = [];
  const existing = listAgents();
  for (const spec of TEAM) {
    const found = existing.find((a) => a.name === spec.name) || agents.find((a) => a.name === spec.name);
    if (found) { agents.push(found); continue; }
    agents.push(createAgent({ name: spec.name, description: spec.description, instructions: spec.instructions, provider: "auto", model: null }));
  }
  const pipe = savePipeline(h, {
    id: "pp-agent-team",
    name: "Agent team",
    icon: "◎",
    category: "Ops",
    description: "Data cleanse, formatting, then a draft report. Nothing is sent.",
    inputs: [{ key: "source", label: "Source to clean" }],
    steps: TEAM.map((spec, i) => step(spec.name, i, spec.instructions)),
    assembly: "One handoff: clean rows, payload rules, draft report.",
    mode: "balanced",
    qa: true,
    budgetUsd: 2,
    createdAt: Date.now(),
  });
  return { agents: agents.map((a) => ({ id: a.id, name: a.name, instructions: a.instructions })), pipeline: { id: pipe.id, name: pipe.name } };
}

export function createLeveragePipelines(h) {
  const capture = savePipeline(h, {
    id: "pp-leverage-capture",
    name: "Leverage: capture the task",
    icon: "⛓",
    category: "Ops",
    description: "Write down one repeated task so a later pipeline can run it.",
    inputs: [{ key: "task", label: "Repeated task" }],
    steps: [step("Name the task and the owner", 0, "State the task, who does it today, and the cost if it was given. Do not invent a cost."), step("Write the handoff", 1, "Write the inputs and the done line for the next run.")],
    assembly: "A one-page task card.",
    mode: "economy",
    qa: false,
    budgetUsd: 1,
    createdAt: Date.now(),
  });
  const report = savePipeline(h, {
    id: "pp-leverage-report",
    name: "Leverage: weekly report",
    icon: "▤",
    category: "Ops",
    description: "A weekly report from notes the person supplies.",
    inputs: [{ key: "notes", label: "This week's notes" }],
    steps: [step("Sort the notes", 0, "Group the notes into done, stuck, and next."), step("Draft the report", 1, "Write a short report. Mark any number that was not in the notes.")],
    assembly: "A one-page weekly report.",
    mode: "economy",
    qa: false,
    budgetUsd: 1,
    createdAt: Date.now(),
  });
  return [capture, report].map((p) => ({ id: p.id, name: p.name }));
}

export function createBriefPipeline(h, inputs = {}, profile = {}) {
  const rendered = renderTemplate("brain-dump-brief", inputs, profile, { unattended: true });
  const lines = String(inputs.dump || rendered.values?.dump || "").split(/\n/).map((s) => s.replace(/^[-*\d.)\s]+/, "").trim()).filter((s) => s.length > 2).slice(0, 8);
  const titles = lines.length ? lines : ["Capture the brief", "Do the next milestone", "Check the definition of done"];
  const pipe = savePipeline(h, {
    id: "pp-brain-dump",
    name: "Brain dump pipeline",
    icon: "✦",
    category: "Ops",
    description: "Milestones from a brain dump. Dependencies run in order.",
    inputs: [{ key: "dump", label: "Brain dump" }],
    steps: titles.map((title, i) => step(title, i, `Do this milestone: ${title}. Use only facts from the brief.`)),
    assembly: "The milestones in order, then the definition of done.",
    mode: "balanced",
    qa: true,
    budgetUsd: 2,
    createdAt: Date.now(),
  });
  return { id: pipe.id, name: pipe.name, steps: pipe.steps.length, halted: false };
}

export function scheduledPlan() {
  return SCHEDULED_IDS.map((id) => {
    const tpl = getTemplate(id);
    return { templateId: id, name: tpl.name, cron: tpl.schedule.cron, label: tpl.schedule.label };
  });
}

export function installSchedules(profile) {
  if (!SCHEDULES_PRESENT) {
    return { installed: [], todo: "Scheduler module is not loaded. Register Friday Coach, Monday Chief of Staff, Friday team check-in, and Daily sundown when schedules exist." };
  }
  let existing = [];
  try { existing = Schedules.listSchedules(); } catch (e) { return { installed: [], todo: e.message }; }
  const installed = [];
  for (const id of SCHEDULED_IDS) {
    const tpl = getTemplate(id);
    const name = tpl.name.slice(0, 80);
    const already = existing.find((s) => s.name === name);
    if (already) { installed.push({ templateId: id, scheduleId: already.id, status: "already" }); continue; }
    const rendered = renderTemplate(id, {}, profile, { unattended: true });
    try {
      const created = Schedules.createSchedule({
        name,
        enabled: false,
        target: { kind: "chat", text: rendered.prompt.slice(0, 20000) },
        trigger: { type: "cron", cron: tpl.schedule.cron },
        capUsd: 1,
        after: { action: "none" },
      });
      installed.push({ templateId: id, scheduleId: created.schedule.id, status: "paused", cron: tpl.schedule.cron });
    } catch (e) {
      installed.push({ templateId: id, status: "todo", error: e.message });
    }
  }
  return {
    installed,
    note: "These are paused. Turn one on in Schedules when you want it. Desktop schedules only run while the app is open. The result stays in the app. Nothing is sent.",
  };
}
