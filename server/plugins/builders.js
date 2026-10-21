// Guided builders. Routes live at /api/builders.
// Detection is server/builder-detect.js so the next builders pull request can reuse it.
// Tiers are server/feature-gate.js. Tokens stay in the vault and are never logged.
// Nothing is sent, posted, or published unless this request includes confirm: true.

import crypto from "node:crypto";
import { ctx } from "../store.js";
import { listProjects } from "../projects.js";
import * as PF from "../project-files.js";
import { allows, assertTier, lockMessage, rankName, tierLabel } from "../feature-gate.js";
import { allBuilders, builderById, cardCopy, detectNeeds, signalKey } from "../builder-detect.js";
import {
  applyFix, auditHtml, assertCanSendEmail, bad, buildPage, buildSite, calendarFrom, clip,
  draftAds, draftSequence, fetchTranscript, firstLine, publishNetlify, publishVercel,
  reelPlan, sendHighlevel, sendListmonk, sendPostiz, seoPlan, sparsePage, toAstro, cleanBase,
} from "../builder-work.js";

export const id = "builders";

const DOC = "builders.state";
const STEPS = ["describe", "preview", "build", "test", "publish", "done"];
const CAP = {
  site: "code", page: "writing", static: "code", health: "analysis", publish: "code",
  social: "creative", reel: "creative", email: "writing", ads: "writing", seo: "writing",
};
const VAULTS = {
  netlify: ["builder-netlify", "CC_NETLIFY_TOKEN"],
  vercel: ["builder-vercel", "CC_VERCEL_TOKEN"],
  postiz: ["builder-postiz", "CC_POSTIZ_TOKEN"],
  listmonk: ["builder-listmonk", "CC_LISTMONK_TOKEN"],
  highlevel: ["ghl", "CC_GHL_TOKEN"],
};

const empty = () => ({ suggestions: true, dismissed: {}, remotion: false, postizUrl: "", listmonkUrl: "", address: "", jobs: [] });
const state = (h) => h.doc(DOC, empty);
const save = (h, st) => h.putDoc(DOC, st);

function tokenOf(h, host) {
  const pair = VAULTS[host];
  if (!pair) return "";
  try {
    const secret = h.getSecret(pair[0], pair[1]);
    return secret?.key ? String(secret.key) : "";
  } catch { return ""; }
}

function knownSecrets(h) {
  return Object.keys(VAULTS).map((host) => tokenOf(h, host)).filter((s) => s.length > 3);
}

function send(h, res, status, obj) {
  let text = JSON.stringify(obj);
  for (const secret of knownSecrets(h)) text = text.split(secret).join("[hidden]");
  h.json(res, status, JSON.parse(text));
}

function logSafe(h, text) {
  let line = String(text || "");
  for (const secret of knownSecrets(h)) line = line.split(secret).join("[hidden]");
  h.emit("log", { text: line });
}

function baseFor(host, st) {
  if (host === "netlify") return process.env.CC_NETLIFY_API || "https://api.netlify.com";
  if (host === "vercel") return process.env.CC_VERCEL_API || "https://api.vercel.com";
  if (host === "postiz") return process.env.CC_POSTIZ_API || st.postizUrl || "";
  if (host === "listmonk") return process.env.CC_LISTMONK_API || st.listmonkUrl || "";
  if (host === "highlevel") return process.env.CC_GHL_API_URL || "https://services.leadconnectorhq.com";
  return "";
}

function fileNames() {
  const names = [];
  try {
    for (const project of listProjects()) {
      try {
        const overview = PF.overview(project.id);
        for (const file of overview.files || []) if (file.title) names.push(file.title);
      } catch { /* a project with no library yet */ }
    }
  } catch { /* libraries are optional */ }
  return names;
}

function missionText() {
  try {
    return ctx().store.listMissions((m) => [m.title, m.prompt, m.goal].filter(Boolean).join("\n")).filter(Boolean).slice(0, 40).join("\n");
  } catch { return ""; }
}

function serviceIds(h, st) {
  const out = new Set();
  if (tokenOf(h, "netlify")) out.add("netlify");
  if (tokenOf(h, "vercel")) out.add("vercel");
  if (tokenOf(h, "postiz") || st.postizUrl) out.add("postiz");
  if (tokenOf(h, "listmonk") || st.listmonkUrl) out.add("listmonk");
  if (tokenOf(h, "highlevel")) { out.add("highlevel"); out.add("ghl"); }
  try { if (h.hasSecret("meta")) { out.add("meta"); out.add("instagram"); } } catch { /* vault not open */ }
  return [...out];
}

function suggestions(h, draft) {
  const st = state(h);
  const text = `${missionText()}\n${draft || ""}`;
  return detectNeeds({ text, services: serviceIds(h, st), files: fileNames(), settings: st });
}

function gallery(tier) {
  return allBuilders().map((b) => ({
    id: b.id,
    name: b.name,
    plain: b.plain,
    tier: b.tier,
    group: b.group,
    engine: b.engine,
    locked: !allows(b.tier, tier),
    lock: allows(b.tier, tier) ? "" : lockMessage(b.tier),
  }));
}

function publicState(h, draft) {
  const st = state(h);
  const tier = h.licenseState().tier;
  const hits = suggestions(h, draft);
  const top = hits[0] || null;
  return {
    tier,
    tierLabel: tierLabel(tier),
    rank: rankName(tier),
    suggestionsOn: st.suggestions !== false,
    remotion: st.remotion === true,
    postizUrl: st.postizUrl || "",
    listmonkUrl: st.listmonkUrl || "",
    address: st.address || "",
    hosts: {
      netlify: !!tokenOf(h, "netlify"),
      vercel: !!tokenOf(h, "vercel"),
      postiz: !!tokenOf(h, "postiz"),
      listmonk: !!tokenOf(h, "listmonk"),
      highlevel: !!tokenOf(h, "highlevel"),
    },
    suggestion: top ? cardCopy(top) : null,
    also: hits.slice(1, 4).map((hit) => ({ id: hit.id, name: hit.name })),
    gallery: gallery(tier),
    jobs: st.jobs.slice(0, 12).map(publicJob),
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    builderId: job.builderId,
    name: job.name,
    step: job.step,
    brief: job.brief || "",
    options: {
      askAi: job.options?.askAi !== false,
      host: job.options?.host || "netlify",
      channel: job.options?.channel || "highlevel",
      remotion: job.options?.remotion === true,
    },
    preview: job.preview || null,
    result: job.result || null,
    test: job.test || null,
    publish: job.publish || null,
    writer: job.writer || null,
  };
}

function needBuilder(h, builderId) {
  const builder = builderById(builderId);
  if (!builder) throw bad("That builder is not in the list.", 404, "not_found");
  assertTier(builder.tier, h.licenseState().tier);
  return builder;
}

function needJob(h, jobId) {
  const job = state(h).jobs.find((row) => row.id === jobId);
  if (!job) throw bad("That builder session was not found.", 404, "not_found");
  needBuilder(h, job.builderId);
  return job;
}

function atLeast(job, step) {
  const at = STEPS.indexOf(job.step);
  const need = STEPS.indexOf(step);
  if (at < need) throw bad("Finish the step you are on first.", 409, "step");
}

async function writeLine(h, brief, builderId, ask) {
  if (ask === false) return null;
  let list = [];
  try { list = h.rank({ capability: CAP[builderId] || "writing", difficulty: 1, mode: "economy", small: true }) || []; } catch { return null; }
  const model = list[0];
  if (!model) return null;
  try {
    const started = Date.now();
    const result = await h.complete({
      provider: model.provider,
      model: model.model,
      maxTokens: 160,
      system: "Write one short paragraph in plain words. No title.",
      messages: [{ role: "user", content: String(brief || "").slice(0, 1200) }],
    });
    h.recordCall({
      provider: model.provider,
      model: model.model,
      usage: result.usage || { input: 0, output: 0 },
      role: "builder",
      ms: Date.now() - started,
    });
    const text = String(result.text || "").trim().slice(0, 600);
    return text ? { text, name: model.name, provider: model.provider, model: model.model } : null;
  } catch { return null; }
}

async function runBuild(h, job, st) {
  const written = await writeLine(h, job.brief, job.builderId, job.options?.askAi !== false);
  const line = written?.text || "";
  job.writer = written ? { name: written.name, provider: written.provider, model: written.model } : null;
  if (job.builderId === "site") job.result = buildSite({ brief: job.brief, written: line });
  else if (job.builderId === "page") job.result = buildPage({ brief: job.brief, written: line });
  else if (job.builderId === "static") {
    const site = buildSite({ brief: job.brief, written: line });
    job.result = { ...toAstro(site.html, firstLine(job.brief)), html: site.html };
  } else if (job.builderId === "health") {
    const html = /<\w[\s\S]*>/.test(job.brief) && /<\/[a-z0-9]+>/i.test(job.brief) ? String(job.brief).slice(0, 200000) : sparsePage(job.brief);
    job.result = { html, audit: auditHtml(html) };
  } else if (job.builderId === "publish") {
    const site = buildSite({ brief: job.brief, written: line });
    job.result = { html: site.html, host: job.options?.host === "vercel" ? "vercel" : "netlify" };
  } else if (job.builderId === "social") job.result = calendarFrom(line || job.brief);
  else if (job.builderId === "reel") {
    const url = process.env.CC_WHISPERX_URL || "";
    const transcript = url ? await fetchTranscript(url, job.brief) : null;
    const remotion = st.remotion === true && job.options?.remotion === true;
    job.result = reelPlan({ brief: line || job.brief, remotion, transcript });
  } else if (job.builderId === "email") {
    job.result = { ...draftSequence(line || job.brief, st.address), channel: job.options?.channel === "listmonk" ? "listmonk" : "highlevel" };
  } else if (job.builderId === "ads") job.result = draftAds(line || job.brief);
  else if (job.builderId === "seo") {
    const plan = seoPlan(job.options?.html || "", line || job.brief);
    const meta = plan.rewrites.find((row) => row.id === "meta");
    if (meta && line) meta.value = clip(line, 155);
    job.result = plan;
  }
  job.step = "build";
}

function runTest(job) {
  const html = job.result?.html || "";
  if (["site", "page", "publish", "static", "health", "seo"].includes(job.builderId)) job.test = auditHtml(html);
  else if (job.builderId === "ads") job.test = { warning: job.result?.warning || null, ready: true, posted: false };
  else if (job.builderId === "email") {
    const emails = job.result?.emails || [];
    job.test = {
      emails: emails.length,
      unsubscribe: emails.every((email) => String(email.text).includes("{{unsubscribe_url}}")),
      addressSet: !!job.result?.addressSet,
    };
  } else if (job.builderId === "reel") job.test = { cuts: (job.result?.cuts || []).length, remotion: !!job.result?.remotion?.on };
  else if (job.builderId === "social") job.test = { posts: (job.result?.posts || []).length, status: "draft" };
  else job.test = { ok: true };
  job.step = "test";
}

function siteName(job) {
  return (firstLine(job.brief) || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
}

async function runPublish(h, job, st, body) {
  if (body.confirm !== true) throw bad("Click the button to finish. Nothing was sent.", 409, "confirm_required");
  if (job.publish?.sent === true) throw bad("Already sent. Start again if you want another one.", 409, "already_sent");
  if (job.builderId === "static") {
    job.publish = { sent: false, saved: true, files: job.result?.files || {}, note: "Saved here. Astro was not downloaded." };
  } else if (["site", "page", "publish"].includes(job.builderId)) {
    const host = body.host === "vercel" || job.options?.host === "vercel" ? "vercel" : "netlify";
    const html = job.result?.html || "";
    const name = siteName(job);
    job.publish = host === "vercel"
      ? await publishVercel({ base: baseFor(host, st), token: tokenOf(h, host), html, name, confirm: true })
      : await publishNetlify({ base: baseFor(host, st), token: tokenOf(h, host), html, name, confirm: true });
    logSafe(h, `${host === "vercel" ? "Vercel" : "Netlify"} accepted the site.`);
  } else if (job.builderId === "social") {
    const base = baseFor("postiz", st);
    const token = tokenOf(h, "postiz");
    if (!base || !token) {
      job.publish = { sent: false, saved: true, posts: job.result?.posts || [], note: "Saved on this computer. Nothing was sent. Add Postiz under More options when you want to send." };
    } else {
      job.publish = await sendPostiz({ base, token, posts: job.result?.posts || [], confirm: true });
      logSafe(h, "Postiz accepted the posts.");
    }
  } else if (job.builderId === "email") {
    assertCanSendEmail({ confirm: true, address: st.address });
    const emails = (job.result?.emails || []).map((email) => ({
      ...email,
      text: String(email.text).split("{{postal_address}}").join(st.address.trim()),
    }));
    if (!emails.every((email) => email.text.includes("{{unsubscribe_url}}"))) {
      throw bad("Every email needs an unsubscribe line. Nothing was sent.", 400, "canspam");
    }
    const channel = body.channel === "listmonk" || job.options?.channel === "listmonk" ? "listmonk" : "highlevel";
    job.publish = channel === "listmonk"
      ? await sendListmonk({ base: baseFor("listmonk", st), token: tokenOf(h, "listmonk"), emails, confirm: true })
      : await sendHighlevel({ base: baseFor("highlevel", st), token: tokenOf(h, "highlevel"), emails, confirm: true });
    logSafe(h, channel === "listmonk" ? "listmonk accepted the series." : "HighLevel accepted the series.");
  } else if (job.builderId === "ads") {
    job.publish = { sent: false, posted: false, saved: true, note: "Saved here. Nothing was posted to an ad account." };
  } else if (job.builderId === "reel") {
    job.publish = { sent: false, saved: true, note: "Saved on this computer. Nothing was posted." };
  } else {
    job.publish = { sent: false, saved: true, html: job.result?.html || "", note: "Saved on this computer. Nothing was published." };
  }
  job.step = "done";
}

function fillPreview(h, job) {
  let ais = [];
  try {
    ais = (h.rank({ capability: CAP[job.builderId] || "writing", difficulty: 1, mode: "balanced", small: true }) || []).slice(0, 3).map((model) => ({
      name: model.name,
      provider: model.provider,
      model: model.model,
      why: "Ready to help with this.",
    }));
  } catch { ais = []; }
  job.preview = {
    ais,
    note: ais.length ? "These AIs can help. Nothing runs until you click Build." : "No AI is connected. Build still makes a simple draft.",
  };
  job.step = "preview";
}

export async function routes(req, res, url, body, h) {
  const path = url.pathname;
  if (path === "/api/builders" && req.method === "GET") {
    send(h, res, 200, publicState(h, url.searchParams.get("draft") || ""));
    return true;
  }
  if (path === "/api/builders/settings" && req.method === "POST") {
    const st = state(h);
    if (typeof body.suggestions === "boolean") st.suggestions = body.suggestions;
    if (typeof body.remotion === "boolean") st.remotion = body.remotion;
    if (typeof body.address === "string") st.address = body.address.trim().slice(0, 200);
    if (typeof body.postizUrl === "string") st.postizUrl = body.postizUrl.trim() ? cleanBase(body.postizUrl.trim()) : "";
    if (typeof body.listmonkUrl === "string") st.listmonkUrl = body.listmonkUrl.trim() ? cleanBase(body.listmonkUrl.trim()) : "";
    if (body.clearDismissed === true) st.dismissed = {};
    save(h, st);
    logSafe(h, st.suggestions === false ? "Builder suggestions are off." : "Builder settings saved.");
    send(h, res, 200, publicState(h, ""));
    return true;
  }
  if (path === "/api/builders/dismiss" && req.method === "POST") {
    const st = state(h);
    const key = body.signal || signalKey(body.id, { kind: body.kind, detail: body.detail });
    if (!key || key.endsWith(":")) throw bad("Say which suggestion to hide.");
    st.dismissed[String(key).slice(0, 180).toLowerCase()] = true;
    save(h, st);
    send(h, res, 200, publicState(h, url.searchParams.get("draft") || body.draft || ""));
    return true;
  }
  if (path === "/api/builders/token" && req.method === "POST") {
    const host = String(body.host || "");
    const pair = VAULTS[host];
    if (!pair) throw bad("Unknown place to save a token.");
    const token = String(body.token || "").trim();
    if (token && token.length < 8) throw bad("That token looks too short.");
    if (host === "highlevel") {
      const prev = h.getSecret("ghl") || {};
      const locationId = String(body.locationId || prev.locationId || "").trim();
      await h.setSecret("ghl", token ? { key: token, locationId } : null);
    } else {
      await h.setSecret(pair[0], token ? { key: token } : null);
    }
    logSafe(h, token ? `${host} token saved in the vault.` : `${host} token removed.`);
    send(h, res, 200, { ok: true, host, saved: !!token });
    return true;
  }
  if (path === "/api/builders/open" && req.method === "POST") {
    const builder = needBuilder(h, String(body.id || ""));
    const st = state(h);
    const job = {
      id: `bj-${crypto.randomBytes(8).toString("hex")}`,
      builderId: builder.id,
      name: builder.name,
      step: "describe",
      brief: "",
      options: { askAi: true, host: "netlify", channel: "highlevel", remotion: false },
      preview: null,
      result: null,
      test: null,
      publish: null,
      createdAt: Date.now(),
    };
    st.jobs.unshift(job);
    st.jobs = st.jobs.slice(0, 30);
    save(h, st);
    logSafe(h, `Opened ${builder.name}.`);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }

  const jobMatch = path.match(/^\/api\/builders\/jobs\/(bj-[a-f0-9]{16})\/(describe|preview|build|test|ready|publish|fix)$/);
  if (!jobMatch) return false;
  if (req.method !== "POST") return false;
  const job = needJob(h, jobMatch[1]);
  const action = jobMatch[2];
  const st = state(h);

  if (action === "describe") {
    job.brief = String(body.brief || "").trim().slice(0, 4000);
    if (!job.brief) throw bad("Describe it in a sentence or two.");
    job.options = {
      askAi: body.askAi !== false,
      host: body.host === "vercel" ? "vercel" : "netlify",
      channel: body.channel === "listmonk" ? "listmonk" : "highlevel",
      remotion: body.remotion === true,
      html: typeof body.html === "string" ? body.html.slice(0, 200000) : "",
    };
    job.result = null;
    job.test = null;
    job.publish = null;
    job.writer = null;
    fillPreview(h, job);
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "preview") {
    atLeast(job, "preview");
    fillPreview(h, job);
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "build") {
    atLeast(job, "preview");
    await runBuild(h, job, st);
    save(h, st);
    logSafe(h, `${job.name} draft is ready.`);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "test") {
    atLeast(job, "build");
    runTest(job);
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "ready") {
    atLeast(job, "test");
    job.step = "publish";
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "fix") {
    atLeast(job, "build");
    const fixId = String(body.fixId || "");
    if (!["title", "meta", "viewport", "h1", "alt", "lang"].includes(fixId)) throw bad("That fix is not on the list.");
    const value = body.value || (job.result?.rewrites || []).find((row) => row.id === fixId)?.value || job.brief;
    job.result = job.result || {};
    job.result.html = applyFix(job.result.html || "", fixId, value);
    job.result.audit = auditHtml(job.result.html);
    job.test = job.result.audit;
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  if (action === "publish") {
    atLeast(job, "test");
    await runPublish(h, job, st, body || {});
    save(h, st);
    send(h, res, 200, { job: publicJob(job) });
    return true;
  }
  return false;
}
