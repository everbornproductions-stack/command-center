// Example projects for the guided Start a project walkthroughs.
// Content only: each JSON file under walkthroughs/examples/ is a fictional sample,
// checked against walkthroughs/examples/schema.json. No server, no UI, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const DIR = path.join(ROOT, "walkthroughs", "examples");
const FILES = ["website", "music-video", "marketing-campaign", "app", "business-plan", "social-reels"];
const WALK = {
  website: "website",
  "music-video": "music-video",
  "marketing-campaign": "marketing",
  app: "app",
  "business-plan": "business-plan",
  "social-reels": "reels",
};
const PAIRS = { anthropic: "Claude", openai: "GPT", google: "Gemini", xai: "Grok" };
const EM = /[\u2014\u2013\u2012]/;
const KEYISH = /sk-ant-|sk-proj-|sk-or-|AIza[0-9A-Za-z]|gsk_[A-Za-z0-9]|pplx-|Bearer [A-Za-z0-9]|xai-[A-Za-z0-9]{8,}|api[_-]?key|secret[_-]?key|BEGIN [A-Z ]*PRIVATE/i;

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const schema = readJson("schema.json");
const examples = FILES.map((id) => ({ id, file: `${id}.json`, data: readJson(`${id}.json`), text: fs.readFileSync(path.join(DIR, `${id}.json`), "utf8") }));

function deref(schemaNode, root) {
  if (schemaNode && schemaNode.$ref) {
    assert.ok(schemaNode.$ref.startsWith("#/"), schemaNode.$ref);
    const next = schemaNode.$ref.slice(2).split("/").reduce((node, key) => node[key], root);
    return deref(next, root);
  }
  return schemaNode;
}

function typeOk(type, data) {
  if (type === "array") return Array.isArray(data);
  if (type === "object") return data !== null && typeof data === "object" && !Array.isArray(data);
  if (type === "integer") return Number.isInteger(data);
  if (type === "number") return typeof data === "number" && Number.isFinite(data);
  if (type === "string") return typeof data === "string";
  if (type === "boolean") return typeof data === "boolean";
  return false;
}

// A small draft 2020-12 checker for the keywords this schema uses.
export function validate(node, data, root = node, at = "$") {
  const schemaNode = deref(node, root);
  const errors = [];
  if (schemaNode.const !== undefined && data !== schemaNode.const) errors.push(`${at} must be ${JSON.stringify(schemaNode.const)}`);
  if (schemaNode.enum && !schemaNode.enum.includes(data)) errors.push(`${at} must be one of ${schemaNode.enum.join(", ")}`);
  if (schemaNode.type && !typeOk(schemaNode.type, data)) {
    errors.push(`${at} must be ${schemaNode.type}`);
    return errors;
  }
  if (typeof data === "string") {
    if (schemaNode.minLength != null && data.length < schemaNode.minLength) errors.push(`${at} is shorter than ${schemaNode.minLength}`);
    if (schemaNode.maxLength != null && data.length > schemaNode.maxLength) errors.push(`${at} is longer than ${schemaNode.maxLength}`);
    if (schemaNode.pattern && !new RegExp(schemaNode.pattern).test(data)) errors.push(`${at} must match ${schemaNode.pattern}`);
  }
  if (typeof data === "number") {
    if (schemaNode.minimum != null && data < schemaNode.minimum) errors.push(`${at} is below ${schemaNode.minimum}`);
    if (schemaNode.maximum != null && data > schemaNode.maximum) errors.push(`${at} is above ${schemaNode.maximum}`);
  }
  if (Array.isArray(data)) {
    if (schemaNode.minItems != null && data.length < schemaNode.minItems) errors.push(`${at} needs at least ${schemaNode.minItems} items`);
    if (schemaNode.maxItems != null && data.length > schemaNode.maxItems) errors.push(`${at} has more than ${schemaNode.maxItems} items`);
    if (schemaNode.items) data.forEach((item, i) => errors.push(...validate(schemaNode.items, item, root, `${at}[${i}]`)));
  }
  if (schemaNode.type === "object") {
    const props = schemaNode.properties || {};
    for (const key of schemaNode.required || []) if (data[key] === undefined) errors.push(`${at}.${key} is required`);
    if (schemaNode.minProperties != null && Object.keys(data).length < schemaNode.minProperties) errors.push(`${at} needs at least ${schemaNode.minProperties} properties`);
    for (const [key, value] of Object.entries(data)) {
      if (props[key]) errors.push(...validate(props[key], value, root, `${at}.${key}`));
      else if (schemaNode.additionalProperties === false) errors.push(`${at}.${key} is not allowed`);
      else if (schemaNode.additionalProperties && typeof schemaNode.additionalProperties === "object") errors.push(...validate(schemaNode.additionalProperties, value, root, `${at}.${key}`));
    }
  }
  return errors;
}

const cents = (n) => Math.round(n * 100);

test("six example projects validate against walkthroughs/examples/schema.json", () => {
  const present = fs.readdirSync(DIR).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(present, [...FILES.map((id) => `${id}.json`), "schema.json"].sort());
  for (const ex of examples) {
    const errors = validate(schema, ex.data);
    assert.deepEqual(errors, [], `${ex.file}: ${errors.join("; ")}`);
    assert.equal(ex.data.example, true);
    assert.equal(ex.data.fictional, true);
    assert.equal(ex.data.type, ex.id);
    assert.equal(ex.data.walkthroughType, WALK[ex.id]);
    assert.equal(PAIRS[ex.data.plan.steps[0].provider] ? true : false, true);
  }
});

test("each example is a full fictional walk: Q&A, routed steps, sample cost and time, review, deliverable", () => {
  for (const ex of examples) {
    const doc = ex.data;
    assert.ok(!EM.test(fs.readFileSync(path.join(DIR, "schema.json"), "utf8")), "schema.json has an em dash or en dash");
    assert.ok(!EM.test(ex.text), `${ex.file} has an em dash or en dash`);
    assert.ok(!KEYISH.test(ex.text), `${ex.file} looks like it contains a key`);
    assert.match(doc.disclaimer, /Example data/);
    assert.match(doc.deliverable, /Example data/);
    assert.match(doc.deliverableSummary, /Example data/);
    assert.match(doc.idea, new RegExp(doc.business.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const required = doc.questions.filter((item) => item.required);
    assert.ok(required.length >= 2, `${ex.file} needs two required questions`);
    assert.deepEqual(Object.keys(doc.answers).sort(), doc.questions.map((item) => item.key).sort());
    for (const item of doc.questions) {
      assert.equal(doc.answers[item.key], item.answer);
      if (item.required) assert.ok(item.answer.trim(), item.key);
    }

    const ids = doc.plan.steps.map((step) => step.id);
    assert.deepEqual(ids, ids.map((_, i) => `t${i + 1}`), `${ex.file} step ids`);
    let cost = 0;
    let minutes = 0;
    for (const step of doc.plan.steps) {
      assert.equal(step.model, "example");
      assert.equal(step.status, "done");
      assert.equal(step.agentName, PAIRS[step.provider], `${ex.file} ${step.id} agent`);
      assert.match(step.why, /example/i);
      assert.match(step.output, /\S/);
      for (const dep of step.deps) {
        assert.ok(ids.includes(dep), dep);
        assert.ok(ids.indexOf(dep) < ids.indexOf(step.id), `${step.id} depends on a later step`);
      }
      cost += step.costUsd;
      minutes += step.timeMinutes;
    }
    assert.equal(cents(cost), cents(doc.totals.costUsd), `${ex.file} cost total`);
    assert.equal(minutes, doc.totals.timeMinutes, `${ex.file} time total`);
    for (const note of doc.reviewNotes) assert.ok(ids.includes(note.stepId), note.stepId);
    assert.ok(doc.nextSteps.length >= 2);
    assert.match(doc.deliverable, /\[ASK\]|not sent|not posted|Nothing was published|No clip|No code was shipped|does not recommend a buy|Nothing was posted/i);
  }
});

test("the schema rejects a sample that is not flagged as example data", () => {
  const broken = structuredClone(examples[0].data);
  broken.example = false;
  assert.ok(validate(schema, broken).some((line) => line.includes("example")));

  const extra = structuredClone(examples[0].data);
  extra.apiKey = "not-a-real-key";
  assert.ok(validate(schema, extra).some((line) => line.includes("apiKey")));

  const thin = structuredClone(examples[1].data);
  delete thin.reviewNotes;
  assert.ok(validate(schema, thin).some((line) => line.includes("reviewNotes")));

  const skipped = structuredClone(examples[2].data);
  skipped.plan.steps[0].why = "too short";
  assert.ok(validate(schema, skipped).some((line) => line.includes("why")));
});
