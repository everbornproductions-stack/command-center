// Websites and marketing builders. Each one is suggested only when its detect block matches.
// Workstream B does not edit this file. It calls registerBuilder.

import { registerBuilder, clearBuilders } from "./registry.js";

const WEB = {
  words: ["website", "web site", "landing page", "homepage", "home page", "my site", "site builder"],
  connectors: ["netlify", "vercel"],
  projectKinds: ["website", "site"],
  projectWords: ["website", "landing page", "homepage"],
};

let loaded = false;

const CATALOG = [
  {
    id: "site-builder",
    title: "Site Builder",
    group: "web",
    tier: "pro",
    summary: "A few pages for your business, laid out as blocks. Publish when you click.",
    detect: WEB,
    tools: [
      { name: "GrapesJS", license: "BSD-3", how: "Named here. Not started in this build." },
    ],
  },
  {
    id: "client-page",
    title: "Client Page Editor",
    group: "web",
    tier: "pro",
    summary: "One page a client can change, with a heading and a short text block.",
    detect: {
      ...WEB,
      words: [...WEB.words, "client page", "edit the page"],
    },
    tools: [
      { name: "Puck", license: "MIT", how: "Named here. Not started in this build." },
    ],
  },
  {
    id: "astro-export",
    title: "Static export",
    group: "web",
    tier: "free",
    summary: "Plain pages saved on this computer. Astro is named and is not downloaded.",
    detect: {
      ...WEB,
      words: [...WEB.words, "static site", "static export"],
    },
    tools: [
      { name: "Astro", license: "MIT", how: "Named here. Not downloaded or started." },
    ],
  },
  {
    id: "site-health",
    title: "Site Health Check",
    group: "web",
    tier: "free",
    summary: "A check for a title, a description, images, and the page language, with Fix it.",
    detect: {
      ...WEB,
      words: [...WEB.words, "lighthouse", "site health", "health check"],
    },
    tools: [
      { name: "Lighthouse", license: "Apache-2.0", how: "Named here. The check runs on this computer." },
    ],
  },
  {
    id: "social-calendar",
    title: "Social Calendar",
    group: "marketing",
    tier: "pro",
    summary: "A week of posts. Postiz schedules them only after you click, and it stays a separate service.",
    detect: {
      words: ["posts", "social post", "content calendar", "instagram", "tiktok", "facebook", "linkedin", "reel", "reels"],
      connectors: ["instagram", "meta", "tiktok", "facebook", "linkedin", "x", "twitter", "youtube", "postiz"],
      projectKinds: ["social", "marketing"],
      projectWords: ["posts", "instagram", "social"],
    },
    tools: [
      { name: "Postiz", license: "AGPL-3.0", how: "Separate service. Not included in Meldmind." },
    ],
  },
  {
    id: "reel-maker",
    title: "Reel Maker",
    group: "marketing",
    tier: "extreme",
    summary: "A short reel plan with captions and cuts. Remotion stays off unless you turn it on.",
    detect: {
      words: ["reel", "reels", "short video"],
      connectors: ["tiktok", "instagram", "youtube"],
      projectKinds: ["reel"],
      projectWords: ["reel", "reels"],
    },
    tools: [
      { name: "WhisperX", license: "BSD-2", how: "Named here. Not started in this build." },
      { name: "auto-editor", license: "Unlicense", how: "Named here. Not started in this build." },
      { name: "Remotion", license: "Paid license", how: "Optional and off. It needs a paid license." },
    ],
  },
  {
    id: "email-sequences",
    title: "Email Sequences",
    group: "marketing",
    tier: "pro",
    summary: "A short run of emails with a postal address and an unsubscribe line built in.",
    detect: {
      words: ["email sequence", "newsletter", "drip", "email campaign"],
      connectors: ["highlevel", "ghl", "listmonk", "mautic"],
      projectKinds: ["email"],
      projectWords: ["newsletter", "email sequence"],
    },
    tools: [
      { name: "listmonk", license: "AGPL-3.0", how: "Separate service. Not included in Meldmind." },
      { name: "Mautic", license: "GPL-3.0", how: "Separate service. Not included in Meldmind." },
      { name: "HighLevel", license: "API", how: "Uses the HighLevel token you already saved. Sends only after a click." },
    ],
  },
  {
    id: "ad-copy",
    title: "Ad Copy Studio",
    group: "marketing",
    tier: "free",
    summary: "Short lines that fit each network. Credit repair and insurance ads get checkboxes, not advice.",
    detect: {
      words: ["ad", "ads", "advertisement", "ad copy", "sponsored"],
      connectors: [],
      projectKinds: ["ads"],
      projectWords: ["ads", "advertisement"],
    },
    tools: [
      { name: "Meldmind routing", license: "Included", how: "Picks an AI on this computer. The words are not sent." },
    ],
  },
  {
    id: "seo-fixer",
    title: "SEO Fixer",
    group: "marketing",
    tier: "free",
    summary: "A title and a description prepared here, plus the same page check as Site Health.",
    detect: {
      words: ["seo", "search ranking", "meta description", "website", "landing page"],
      connectors: ["netlify", "vercel"],
      projectKinds: ["website", "site"],
      projectWords: ["seo", "website"],
    },
    tools: [
      { name: "Lighthouse", license: "Apache-2.0", how: "Named here. The check runs on this computer." },
      { name: "Meldmind routing", license: "Included", how: "Names the AI that would rewrite the page. Nothing is sent." },
    ],
  },
];

export function catalogDefs() {
  return CATALOG.map((item) => ({ ...item, detect: { ...item.detect }, tools: item.tools.map((tool) => ({ ...tool })) }));
}

export function ensureCatalog() {
  if (loaded) return;
  loaded = true;
  for (const def of CATALOG) registerBuilder(def);
}

export function resetCatalogForTests() {
  clearBuilders();
  loaded = false;
  ensureCatalog();
}

ensureCatalog();
