// Projects hub: every project has categories (Social Posts, Music Videos, Website, Client Work...)
// with clickable links to where the work lives (YouTube, Instagram, GHL, Cloudflare...).
// The Everborn HQ adapter reads hq/state.json (task board) and studio/credit-log.csv (media credits).
import fs from "node:fs";
import path from "node:path";
import { HQ_DIR, readJson } from "./paths.js";
import { HOSTED, doc, putDoc } from "./store.js";

const SEED = {
  projects: [
    {
      id: "everborn", name: "Everborn Productions", color: "#D97757", kind: "company", hqClient: "everborn",
      summary: "AI-built CRM, marketing and media for small businesses.",
      categories: [
        { id: "website", name: "Website", links: [
          { name: "everbornproductions.com", url: "https://everbornproductions.com" },
          { name: "Cloudflare Pages", url: "https://dash.cloudflare.com" },
          { name: "Search Console", url: "https://search.google.com/search-console" },
        ] },
        { id: "social", name: "Social Posts", links: [
          { name: "Instagram", url: "https://www.instagram.com" },
          { name: "TikTok Studio", url: "https://www.tiktok.com/tiktokstudio" },
          { name: "Meta Business Suite", url: "https://business.facebook.com" },
          { name: "YouTube Studio", url: "https://studio.youtube.com" },
        ] },
        { id: "clients", name: "Client Work", links: [
          { name: "Capital City Life (site)", url: "https://capitalcitylife.com" },
          { name: "HQ board (hub)", url: "https://claude.ai/artifact/KNVXeiXJhhxZZstSNeYLPH" },
        ] },
        { id: "money", name: "Money", links: [
          { name: "Square", url: "https://app.squareup.com/dashboard" },
          { name: "Stripe", url: "https://dashboard.stripe.com" },
        ] },
      ],
    },
    {
      id: "jake-stien", name: "Jake Stien (music)", color: "#FF5A5F", kind: "music", hqClient: "everborn",
      summary: "AI music videos: Suno → Kling / Flow → Sync.so → ffmpeg → YouTube, TikTok, Instagram.",
      categories: [
        { id: "music-videos", name: "Music Videos", links: [
          { name: "YouTube channel", url: "https://www.youtube.com" },
          { name: "YouTube Studio analytics", url: "https://studio.youtube.com" },
          { name: "Suno library", url: "https://suno.com/me" },
          { name: "Kling projects", url: "https://app.klingai.com" },
          { name: "Google Flow", url: "https://flow.google.com" },
          { name: "Sync.so studio", url: "https://sync.so" },
          { name: "Hedra", url: "https://www.hedra.com/app" },
        ] },
        { id: "distribution", name: "Distribution", links: [
          { name: "DistroKid", url: "https://distrokid.com" },
          { name: "YouTube Music", url: "https://music.youtube.com" },
          { name: "TikTok @chrismagee672", url: "https://www.tiktok.com/@chrismagee672" },
        ] },
        { id: "social", name: "Social Posts", links: [
          { name: "Instagram", url: "https://www.instagram.com" },
          { name: "TikTok Studio", url: "https://www.tiktok.com/tiktokstudio" },
        ] },
      ],
    },
    {
      id: "snap-credit-fix", name: "Snap Credit Fix", color: "#20B8CD", kind: "client", hqClient: "snap-credit-fix",
      summary: "Credit repair client: GoHighLevel CRM, DisputeFox, affiliate program, dealer outreach.",
      categories: [
        { id: "crm", name: "CRM & Automation", links: [
          { name: "GoHighLevel", url: "https://app.gohighlevel.com" },
          { name: "GHL Workflows", url: "https://client-app-automation-workflows.leadconnectorhq.com" },
          { name: "Zapier", url: "https://zapier.com/app/zaps" },
          { name: "DisputeFox", url: "https://pulse.disputeprocess.com" },
        ] },
        { id: "website", name: "Website", links: [
          { name: "snapcreditfix.com", url: "https://snapcreditfix.com" },
          { name: "go.snapcreditfix.com", url: "https://go.snapcreditfix.com" },
          { name: "Cloudflare", url: "https://dash.cloudflare.com" },
        ] },
        { id: "social", name: "Social & Ads", links: [
          { name: "Meta Ads Manager", url: "https://adsmanager.facebook.com" },
          { name: "Meta Business Suite", url: "https://business.facebook.com" },
          { name: "Instagram", url: "https://www.instagram.com" },
        ] },
        { id: "partners", name: "Partners & Affiliates", links: [
          { name: "Skool (Rob The Credit Guy)", url: "https://www.skool.com" },
          { name: "Tradeline Genie", url: "https://tradelinegenie.org" },
          { name: "Callers.io", url: "https://callers.io" },
        ] },
      ],
    },
    {
      id: "capital-city-life", name: "Capital City Life (insurance)", color: "#4E8CFF", kind: "client", hqClient: "capital-city-life",
      summary: "Insurance site and reels; SEO lane.",
      categories: [
        { id: "website", name: "Website", links: [
          { name: "capitalcitylife.com", url: "https://capitalcitylife.com" },
          { name: "Cloudflare", url: "https://dash.cloudflare.com" },
        ] },
        { id: "social", name: "Social Posts", links: [
          { name: "Instagram", url: "https://www.instagram.com" },
        ] },
        { id: "carriers", name: "Carriers & Tools", links: [
          { name: "Mutual of Omaha producer", url: "https://producer.mutualofomaha.com" },
          { name: "iPipeline iGO", url: "https://igoforms2.ipipeline.com" },
          { name: "Integrity leads", url: "https://leads.integrity.com" },
        ] },
      ],
    },
  ],
};

// A new hosted user starts with one empty project instead of the seeded Everborn hubs.
const HOSTED_SEED = { projects: [{ id: "my-project", name: "My project", color: "#22d3ee", kind: "company", summary: "Rename me in Projects, then add links to where the work lives.", categories: [{ id: "links", name: "Links", links: [] }] }] };
const data = () => doc("projects", () => structuredClone(HOSTED ? HOSTED_SEED : SEED));
const save = () => putDoc("projects", data());
export function loadProjects() { return data(); }
export const listProjects = () => data().projects;
export function saveProject(p) {
  const d = data();
  const i = d.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) d.projects[i] = { ...d.projects[i], ...p };
  else d.projects.push({ ...p, id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), categories: p.categories || [] });
  save();
  return d.projects.find((x) => x.id === (p.id || d.projects[d.projects.length - 1].id));
}
export function deleteProject(id) {
  const d = data();
  d.projects = d.projects.filter((p) => p.id !== id);
  save();
}
export function addLink(projectId, categoryId, link) {
  const p = data().projects.find((x) => x.id === projectId);
  if (!p) throw new Error("project not found");
  let c = p.categories.find((x) => x.id === categoryId);
  if (!c) { c = { id: categoryId, name: categoryId, links: [] }; p.categories.push(c); }
  c.links.push({ name: link.name, url: link.url });
  save();
  return p;
}
export function removeLink(projectId, categoryId, url) {
  const p = data().projects.find((x) => x.id === projectId);
  const c = p?.categories.find((x) => x.id === categoryId);
  if (c) c.links = c.links.filter((l) => l.url !== url);
  save();
  return p;
}

// ---------- Everborn HQ adapter ----------
export function hqSnapshot() {
  // the HQ folder is a local-PC feature; a hosted hub has no such folder
  if (HOSTED) return { available: false, dir: null, tasks: [], decisions: [], agents: [], credits: null, updated: null };
  const stateFile = path.join(HQ_DIR, "hq", "state.json");
  const creditFile = path.join(HQ_DIR, "studio", "credit-log.csv");
  const out = { available: fs.existsSync(stateFile), dir: HQ_DIR, tasks: [], decisions: [], agents: [], credits: null, updated: null };
  if (out.available) {
    const st = readJson(stateFile, {});
    out.updated = st.updated || null;
    out.tasks = (st.tasks || []).filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, owner: t.owner, client: t.client, status: t.status, priority: t.priority, due: t.due || null }));
    out.decisions = (st.decisions_for_chris || []).filter((d) => d.status === "open").map((d) => ({ id: d.id, question: d.question, recommendation: d.recommendation, date: d.date }));
    out.agents = (st.agents || []).map((a) => ({ id: a.id, name: a.name, dept: a.dept, status: a.status, current: (a.current || []).length }));
  }
  if (fs.existsSync(creditFile)) {
    const lines = fs.readFileSync(creditFile, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(",");
    const idx = (n) => head.indexOf(n);
    const byTool = {}, byProject = {}, byDay = {};
    let total = 0, rows = 0;
    for (const line of lines) {
      const cells = splitCsv(line);
      const credits = Number(cells[idx("credits")] || 0);
      if (!credits) continue;
      rows++; total += credits;
      const tool = cells[idx("tool")] || "?", proj = cells[idx("project")] || "?", day = cells[idx("date")] || "?";
      byTool[tool] = (byTool[tool] || 0) + credits;
      byProject[proj] = (byProject[proj] || 0) + credits;
      byDay[day] = (byDay[day] || 0) + credits;
    }
    out.credits = { total, rows, byTool, byProject, byDay, file: creditFile };
  }
  return out;
}
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
