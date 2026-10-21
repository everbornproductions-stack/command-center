// Describe, preview, build, test, and publish. Preview names the AIs and does not send.
// Build writes a draft on this computer. Publish sends only after a click.
import { getBuilder } from "./registry.js";
import { webBuilderGate, publishGate, tierRank } from "../../feature-gate.js";
import {
  SAMPLE_HEALTH_HTML, SAMPLE_SEO_HTML, renderPage, checkPage, scoresFor, seoExtras, applyPageFix, escapeHtml,
} from "./health.js";
import {
  COMPLIANCE_BANNER, COMPLIANCE_BOXES, AD_LIMITS, isRegulated, boxesOk, claimIssue,
  adLines, limitIssues, trimLine, emailFooter, addressIssue,
} from "./compliance.js";
import { sendPublish } from "./publish.js";

const PAGE_NAMES = ["Home", "About", "Contact"];
const DAYS = ["Monday", "Wednesday", "Friday", "Tuesday", "Thursday", "Saturday", "Sunday"];
const SERVICES = new Set(["listmonk", "mautic", "highlevel"]);
const TARGETS = new Set(["local", "netlify", "vercel", "postiz", "listmonk", "mautic", "highlevel"]);
const REGULATED_BUILDERS = new Set(["ad-copy", "social-calendar", "reel-maker"]);

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function cleanInput(body = {}) {
  const pages = String(body.pages ?? "").split(",").map((p) => clip(p, 40)).filter(Boolean).slice(0, 8);
  const platform = String(body.platform || "instagram").toLowerCase();
  const service = String(body.service || "listmonk").toLowerCase();
  const target = String(body.target || "").toLowerCase();
  const posts = Math.min(7, Math.max(1, Number(body.posts) || 3));
  const seconds = Math.min(60, Math.max(5, Number(body.seconds) || 15));
  const compliance = body.compliance && typeof body.compliance === "object" ? body.compliance : {};
  return {
    name: clip(body.name, 80),
    about: clip(body.about, 600),
    audience: clip(body.audience, 160),
    pages: pages.length ? pages : [...PAGE_NAMES],
    html: String(body.html || "").slice(0, 20000),
    copy: clip(body.copy, 5000),
    topic: clip(body.topic, 200),
    platform: AD_LIMITS[platform] ? platform : "instagram",
    address: clip(body.address, 200),
    unsubscribe: clip(body.unsubscribe, 200),
    service: SERVICES.has(service) ? service : "listmonk",
    target: TARGETS.has(target) ? target : "",
    serviceUrl: clip(body.serviceUrl, 300),
    remotion: body.remotion === true,
    remotionAck: body.remotionAck === true,
    compliance: {
      noPromises: compliance.noPromises === true,
      followLaws: compliance.followLaws === true,
      notAdvice: compliance.notAdvice === true,
    },
    posts,
    seconds,
    confirm: body.confirm === true,
    confirmed: body.confirmed === true,
  };
}

export function withDefaults(input) {
  return {
    ...input,
    name: input.name || "My business",
    about: input.about || "What we do, in one or two sentences.",
    audience: input.audience || "People nearby",
    unsubscribe: input.unsubscribe || "Reply with the word unsubscribe",
  };
}

export function fieldsFor(id) {
  const name = { id: "name", label: "Name", type: "text", placeholder: "My business", advanced: false };
  const about = { id: "about", label: "What is it for?", type: "textarea", placeholder: "A sentence or two is enough.", advanced: false };
  const audience = { id: "audience", label: "Who is it for?", type: "text", placeholder: "People nearby", advanced: false };
  const pages = { id: "pages", label: "Pages", type: "text", placeholder: "Home, About, Contact", advanced: true };
  const html = { id: "html", label: "Paste a page (optional)", type: "textarea", placeholder: "Leave blank to use the sample.", advanced: true };
  const posts = { id: "posts", label: "How many posts?", type: "number", placeholder: "3", advanced: false };
  const seconds = { id: "seconds", label: "Length in seconds", type: "number", placeholder: "15", advanced: false };
  const remotion = { id: "remotion", label: "Use Remotion (paid license)", type: "checkbox", advanced: true };
  const address = { id: "address", label: "Postal address", type: "text", placeholder: "Street, city, region, postal code", advanced: false };
  const unsubscribe = { id: "unsubscribe", label: "Unsubscribe line", type: "text", placeholder: "Reply with the word unsubscribe", advanced: true };
  const service = { id: "service", label: "Email service", type: "select", options: ["listmonk", "mautic", "highlevel"], advanced: true };
  const platform = { id: "platform", label: "Where will the ad run?", type: "select", options: Object.keys(AD_LIMITS), advanced: false };
  const topic = { id: "topic", label: "Topic", type: "text", placeholder: "What the ad is about", advanced: false };
  const copy = { id: "copy", label: "Your line (optional)", type: "textarea", placeholder: "Leave blank and we will use the name and the description.", advanced: true };
  const serviceUrl = { id: "serviceUrl", label: "Service address", type: "text", placeholder: "https://...", advanced: true };
  const token = { id: "token", label: "Token", type: "password", placeholder: "Saved in the vault. Never shown again.", advanced: true, connect: true };
  const main = [name, about];
  const more = [];
  if (id === "site-builder" || id === "astro-export") {
    main.push(audience);
    more.push(pages, targetField(), token);
  } else if (id === "client-page") {
    main.push(audience);
    more.push(targetField(), token);
  } else if (id === "site-health" || id === "seo-fixer") {
    more.push(html, targetField(), token);
  } else if (id === "social-calendar") {
    main.push(posts);
    more.push(serviceUrl, token);
  } else if (id === "reel-maker") {
    main.push(seconds);
    more.push(remotion);
  } else if (id === "email-sequences") {
    main.push(address);
    more.push(unsubscribe, service, serviceUrl, token);
  } else if (id === "ad-copy") {
    main.push(topic, platform);
    more.push(copy);
  }
  return { main, more };
}

function targetField() {
  return { id: "target", label: "Where to publish", type: "select", options: ["local", "netlify", "vercel"], advanced: true };
}

export function defaultTarget(id, { tier = "free", connectors = [] } = {}) {
  const pro = tierRank(tier) >= tierRank("pro");
  const has = (name) => (connectors || []).map((c) => String(c).toLowerCase()).includes(name);
  if (id === "social-calendar") return "postiz";
  if (id === "email-sequences") return "listmonk";
  if (id === "ad-copy" || id === "reel-maker") return "local";
  if (pro && has("netlify")) return "netlify";
  if (pro && has("vercel")) return "vercel";
  return "local";
}

function routeOf(ranked) {
  const top = (ranked || []).find((row) => row && (row.name || row.model));
  if (!top) {
    return { providerName: "No AI connected", name: "Draft prepared here", model: null, provider: null, sent: false, note: "No AI is connected. The draft stays on this computer." };
  }
  return {
    providerName: top.providerName || top.provider || "AI",
    name: top.name || top.model,
    model: top.model || null,
    provider: top.provider || null,
    sent: false,
    note: "This AI would receive the description. Nothing was sent.",
  };
}

function recipients(builder, ranked) {
  const ais = (ranked || []).slice(0, 3).map((row) => ({
    providerName: row.providerName || row.provider || "AI",
    name: row.name || row.model || "Model",
    receives: `The description for ${builder.title}. No files and no keys.`,
  }));
  return {
    ais,
    services: (builder.tools || []).map((tool) => ({ name: tool.name, license: tool.license, receives: tool.how })),
    withheld: ["API keys", "publish tokens", "the vault"],
  };
}

function regulatedOf(builder, input, ctx = {}) {
  if (!REGULATED_BUILDERS.has(builder.id)) return null;
  const blob = `${input.topic} ${input.about} ${input.name} ${input.copy} ${ctx.note || ""}`;
  if (!isRegulated(blob)) return null;
  return { required: true, banner: COMPLIANCE_BANNER, boxes: COMPLIANCE_BOXES };
}

function toolsFile(builder, extra = "") {
  const lines = (builder.tools || []).map((tool) => `${tool.name}. ${tool.license}. ${tool.how}`);
  return `${lines.join("\n")}${extra ? `\n${extra}` : ""}\n`;
}

function pageFiles(pages) {
  return pages.map((page, index) => ({
    path: index === 0 ? "index.html" : `${page.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "page"}/index.html`,
    text: page.html,
  }));
}

function baseDraft(builder, input, ctx) {
  return {
    builderId: builder.id,
    tier: builder.tier,
    title: builder.title,
    name: input.name,
    about: input.about,
    route: routeOf(ctx.ranked),
    publishDefault: input.target || defaultTarget(builder.id, ctx),
    compliance: regulatedOf(builder, input, ctx),
    tools: builder.tools,
  };
}

function siteArtifact(builder, input) {
  const pages = input.pages.map((page) => ({
    name: page,
    html: renderPage({ name: input.name, about: input.about, page, audience: input.audience }),
  }));
  const editor = builder.id === "client-page"
    ? {
      editor: "Puck", license: "MIT", started: false,
      note: "Saved as blocks a client can edit. Puck was not started.",
      data: {
        root: { title: input.name },
        content: [
          { type: "Heading", props: { text: input.name } },
          { type: "Text", props: { text: input.about } },
        ],
      },
    }
    : builder.id === "astro-export"
      ? { editor: "Astro", license: "MIT", started: false, note: "Pages were written on this computer. Astro was not downloaded or started." }
      : { editor: "GrapesJS", license: "BSD-3", spdx: "BSD-3-Clause", started: false, note: "Saved as blocks GrapesJS can open. GrapesJS was not started." };
  const pagesUsed = builder.id === "client-page" ? pages.slice(0, 1) : pages;
  return {
    ...editor,
    pages: pagesUsed,
    files: [...pageFiles(pagesUsed), { path: "TOOLS.txt", text: toolsFile(builder) }],
  };
}

function healthArtifact(input) {
  const html = input.html || SAMPLE_HEALTH_HTML;
  const issues = checkPage(html, 0);
  return {
    editor: "Lighthouse",
    license: "Apache-2.0",
    started: false,
    note: "Checked on this computer. Lighthouse was not started.",
    html,
    scores: scoresFor(issues),
    files: [{ path: "index.html", text: html }, { path: "TOOLS.txt", text: "Lighthouse. Apache-2.0. Named here. Not started.\n" }],
  };
}

function seoArtifact(input) {
  const html = input.html || SAMPLE_SEO_HTML;
  const extras = seoExtras(html, input);
  const issues = [...checkPage(html, 0), ...extras.issues];
  return {
    editor: "Lighthouse",
    license: "Apache-2.0",
    started: false,
    note: extras.note,
    html,
    rewrite: { title: extras.rewriteTitle, description: extras.rewriteMeta },
    scores: scoresFor(issues),
    files: [{ path: "index.html", text: html }, { path: "TOOLS.txt", text: "Lighthouse. Apache-2.0. Named here. Not started.\n" }],
  };
}

function calendarArtifact(input) {
  const posts = DAYS.slice(0, input.posts).map((day) => ({
    day,
    text: `${input.name}: ${input.about}`.slice(0, 2200),
  }));
  return {
    editor: "Postiz",
    license: "AGPL-3.0",
    bundled: false,
    started: false,
    note: "Postiz runs as its own service. It is not included here, and nothing is scheduled until you click Publish.",
    posts,
    files: [{ path: "calendar.json", text: JSON.stringify({ posts }, null, 2) }],
  };
}

function reelArtifact(input) {
  const on = input.remotion === true && input.remotionAck === true;
  return {
    editor: "Reel",
    seconds: input.seconds,
    started: false,
    captions: [{ at: "0:00", text: input.about.slice(0, 80) }],
    cuts: [{ start: 0, end: input.seconds, keep: true, reason: "Keep the clip until you pick cuts." }],
    toolsRun: [
      { name: "WhisperX", license: "BSD-2", started: false, note: "Captions were prepared here. WhisperX was not started." },
      { name: "auto-editor", license: "Unlicense", started: false, note: "The cut list was prepared here. auto-editor was not started." },
    ],
    remotion: {
      on,
      included: false,
      note: on
        ? "You turned Remotion on. This build does not include it. The reel plan still uses WhisperX and auto-editor, and neither program was started."
        : "Remotion stays off. It needs a paid license.",
    },
    files: [{ path: "reel.json", text: JSON.stringify({ seconds: input.seconds, name: input.name }, null, 2) }],
  };
}

function emailArtifact(input) {
  const footer = emailFooter(input);
  const subjects = [`Welcome from ${input.name}`, "A useful next step", "Still interested?"];
  const emails = subjects.map((subject) => ({
    subject,
    body: `${input.about}\n\n${footer}`,
  }));
  const notes = {
    listmonk: "listmonk runs as its own service. It is not included here.",
    mautic: "Mautic runs as its own service. It is not included here.",
    highlevel: "HighLevel sends only after you click Publish, using the token already saved for HighLevel.",
  };
  return {
    editor: input.service,
    bundled: false,
    started: false,
    note: notes[input.service],
    footer,
    emails,
    files: [{ path: "emails.txt", text: emails.map((email) => `${email.subject}\n${email.body}`).join("\n\n---\n\n") }],
  };
}

function adArtifact(input) {
  const lines = adLines(input);
  return {
    editor: "Meldmind routing",
    license: "Included",
    started: false,
    note: "The line stays on this computer. The routed AI was not called.",
    platform: input.platform,
    limit: AD_LIMITS[input.platform],
    lines,
    files: [{ path: "ad.txt", text: lines.map((line) => `${line.part} (${line.max}): ${line.text}`).join("\n") }],
  };
}

function makeArtifact(builder, input) {
  if (builder.id === "site-health") return healthArtifact(input);
  if (builder.id === "seo-fixer") return seoArtifact(input);
  if (builder.id === "social-calendar") return calendarArtifact(input);
  if (builder.id === "reel-maker") return reelArtifact(input);
  if (builder.id === "email-sequences") return emailArtifact(input);
  if (builder.id === "ad-copy") return adArtifact(input);
  return siteArtifact(builder, input);
}

export function issuesFor(builderId, artifact, input) {
  const issues = [];
  if (builderId === "site-builder" || builderId === "client-page" || builderId === "astro-export") {
    for (const [index, page] of (artifact.pages || []).entries()) issues.push(...checkPage(page.html, index));
  } else if (builderId === "site-health") {
    issues.push(...checkPage(artifact.html, 0));
  } else if (builderId === "seo-fixer") {
    issues.push(...checkPage(artifact.html, 0));
    issues.push(...seoExtras(artifact.html, input).issues);
  } else if (builderId === "ad-copy") {
    issues.push(...limitIssues(artifact.lines));
  } else if (builderId === "email-sequences") {
    const address = addressIssue(input.address);
    if (address) issues.push(address);
    const footer = artifact.footer || "";
    if (!/unsubscribe/i.test(footer) || !footer.includes(input.name || "My business")) {
      issues.push({ id: "footer", kind: "footer", title: "The footer is missing", detail: "Every email needs the business name and an unsubscribe line.", blocking: true, fixable: false });
    }
  }
  const claim = claimIssue(`${input.topic} ${input.about} ${input.copy} ${(artifact.lines || []).map((line) => line.text).join(" ")}`);
  if (claim && REGULATED_BUILDERS.has(builderId)) issues.push(claim);
  if (artifact.scores) artifact.scores = scoresFor(issues);
  return issues;
}

function fail(status, code, error, extra = {}) {
  return { ok: false, status, code, error, ran: false, sent: false, ...extra };
}

export function previewBuilder(id, body, ctx = {}) {
  const builder = getBuilder(id);
  if (!builder) return fail(404, "missing", "That builder was not found.");
  const input = withDefaults(cleanInput(body || {}));
  const gate = webBuilderGate(builder.tier, ctx.tier);
  const compliance = regulatedOf(builder, input, ctx);
  return {
    ok: true,
    ran: false,
    sent: false,
    builder: { id: builder.id, title: builder.title, tier: builder.tier, summary: builder.summary },
    gate,
    steps: builder.steps,
    description: { name: input.name, about: input.about, audience: input.audience },
    recipients: recipients(builder, ctx.ranked),
    compliance,
    publishDefault: input.target || defaultTarget(builder.id, ctx),
    fields: fieldsFor(builder.id),
    note: "Nothing is sent until you click Build, and nothing is published until you click Publish.",
  };
}

export function buildBuilder(id, body, ctx = {}) {
  const builder = getBuilder(id);
  if (!builder) return fail(404, "missing", "That builder was not found.");
  const raw = cleanInput(body || {});
  if (!raw.confirm) return fail(400, "confirm", "Click Build to start. Nothing was sent.");
  const input = withDefaults(raw);
  const gate = webBuilderGate(builder.tier, ctx.tier);
  if (!gate.ok) return fail(gate.status, gate.code, gate.message, { gate });
  if (builder.id === "reel-maker" && raw.remotion && !raw.remotionAck) {
    return fail(400, "remotion_license", "Remotion needs a paid license. Leave it off, or confirm that you have one. Nothing was started.");
  }
  const compliance = regulatedOf(builder, input, ctx);
  if (compliance && !boxesOk(raw.compliance)) {
    return fail(400, "compliance", "Check the boxes first. Meldmind does not give advice for this kind of ad.", { compliance });
  }
  const made = makeArtifact(builder, input);
  const draft = {
    ...baseDraft(builder, input, ctx),
    input,
    artifact: made,
    files: made.files || [],
    issues: issuesFor(builder.id, made, input),
  };
  return { ok: true, ran: true, sent: false, gate, draft, note: "Built on this computer. Nothing was sent." };
}

export function testBuilder(draft) {
  if (!draft) return fail(404, "missing", "Build first. Nothing was sent.");
  const input = draft.input || withDefaults(cleanInput({}));
  const issues = issuesFor(draft.builderId, draft.artifact || {}, input);
  const next = { ...draft, issues };
  if (draft.artifact?.scores) next.artifact = { ...draft.artifact, scores: scoresFor(issues) };
  return {
    ok: true,
    ran: false,
    sent: false,
    draft: next,
    issues,
    scores: next.artifact?.scores || null,
    note: "Checked on this computer. Nothing was sent.",
  };
}

function htmlOf(draft) {
  if (draft.artifact?.html) return { where: "html", html: draft.artifact.html };
  const pages = draft.artifact?.pages;
  if (pages?.length) return { where: "pages", pages };
  return null;
}

export function fixBuilder(draft, issueId) {
  if (!draft) return fail(404, "missing", "Build first. Nothing was sent.");
  const issues = draft.issues || issuesFor(draft.builderId, draft.artifact || {}, draft.input || {});
  const issue = issues.find((row) => row.id === issueId);
  if (!issue) return fail(404, "missing", "That item is already done.");
  if (!issue.fixable) return fail(400, "not_fixable", "This item needs a change from you. Nothing was sent.");
  const input = draft.input || {};
  const next = { ...draft, artifact: { ...draft.artifact }, files: [...(draft.files || [])] };
  const title = issue.rewrite || `${input.name || "My business"} | ${input.about || "What we do"}`.slice(0, 60);
  const description = issue.kind === "seo-meta"
    ? (issue.rewrite || input.about || "What we do, in one or two sentences.").slice(0, 160)
    : (input.about || "What we do, in one or two sentences.").slice(0, 160);
  const ctx = { title, description, about: description, alt: input.name || "Image" };
  if (issue.kind === "limit") {
    next.artifact.lines = (next.artifact.lines || []).map((line) => (line.part === issue.part ? trimLine(line) : line));
    next.files = next.files.map((file) => (file.path === "ad.txt"
      ? { ...file, text: next.artifact.lines.map((line) => `${line.part} (${line.max}): ${line.text}`).join("\n") }
      : file));
  } else {
    const bag = htmlOf(next);
    if (!bag) return fail(400, "not_fixable", "There is no page to fix.");
    if (bag.where === "html") {
      next.artifact.html = applyPageFix(bag.html, issue.kind, ctx);
      next.files = next.files.map((file) => (file.path === "index.html" ? { ...file, text: next.artifact.html } : file));
    } else {
      const index = issue.pageIndex || 0;
      const pages = bag.pages.map((page, i) => (i === index ? { ...page, html: applyPageFix(page.html, issue.kind, ctx) } : page));
      next.artifact.pages = pages;
      const rebuilt = pageFiles(pages);
      next.files = [...rebuilt, ...next.files.filter((file) => !rebuilt.some((row) => row.path === file.path) && file.path !== "index.html")];
    }
  }
  const tested = testBuilder(next);
  return { ok: true, ran: false, sent: false, fixed: issueId, draft: tested.draft, issues: tested.issues, note: "Fixed on this computer. Nothing was sent." };
}

export function blockingIssues(draft) {
  return (draft?.issues || []).filter((issue) => issue.blocking);
}

export async function publishBuilder(draft, body, ctx = {}) {
  if (!draft) return fail(404, "missing", "Build first. Nothing was sent.");
  const raw = cleanInput(body || {});
  if (!raw.confirmed) return fail(400, "confirm_required", "Click Publish to send. Nothing was sent.");
  const gate = webBuilderGate(draft.tier, ctx.tier);
  if (!gate.ok) return fail(gate.status, gate.code, gate.message, { gate });
  const target = raw.target || draft.publishDefault || "local";
  const publish = publishGate(target, ctx.tier);
  if (!publish.ok) return fail(publish.status, publish.code, publish.message, { gate: publish });
  const blocking = blockingIssues(draft);
  if (blocking.length) {
    return fail(400, "test_failed", "Fix the items from Test first. Nothing was sent.", { issues: blocking });
  }
  if (target === "local") {
    return { ok: true, ran: false, sent: false, status: "saved", dryRun: false, target, note: "Saved on this computer. Nothing was sent." };
  }
  const payload = publishBody(draft, target);
  const result = await sendPublish({
    target,
    token: ctx.token || "",
    url: ctx.serviceUrl || raw.serviceUrl || "",
    body: payload,
    fetchImpl: ctx.fetchImpl,
    secrets: [ctx.token],
  });
  if (!result.ok) return { ...result, ran: false, target };
  return { ...result, ran: result.sent === true, target, gate: publish };
}

function publishBody(draft, target) {
  const files = (draft.files || []).filter((file) => file.path.endsWith(".html") || file.path.endsWith(".txt") || file.path.endsWith(".json")).map((file) => ({
    path: file.path,
    body: file.text,
  }));
  if (target === "postiz") return { posts: draft.artifact?.posts || [] };
  if (target === "listmonk" || target === "mautic" || target === "highlevel") {
    return { name: draft.name, emails: draft.artifact?.emails || [] };
  }
  return { name: slug(draft.name), files };
}

function slug(name) {
  const s = String(name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (s || "site").slice(0, 40);
}

export function publicDraft(draft) {
  if (!draft) return null;
  const { input, ...rest } = draft;
  return {
    ...rest,
    input: input ? {
      name: input.name,
      about: input.about,
      audience: input.audience,
      pages: input.pages,
      platform: input.platform,
      service: input.service,
      address: input.address || "",
      posts: input.posts,
      seconds: input.seconds,
      remotion: input.remotion === true,
    } : null,
  };
}

export { escapeHtml, COMPLIANCE_BANNER, COMPLIANCE_BOXES };
