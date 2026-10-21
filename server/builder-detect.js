// Shared detection for guided builders.
// The next guided-builders pull request should import this module and call
// registerBuilder for each new builder. Do not copy the matching rules.
//
// A builder is suggested only when a signal matches:
//   a connected service, words in a chat or mission, or a file name.
// The Settings gallery lists every builder even when nothing matches.
// Dismissals and the master suggestions switch are applied here so both
// pull requests share one rule.

export const CARD_TITLE = "Want help building this?";

export const BUILDERS = [
  {
    id: "site",
    name: "Site Builder",
    plain: "Build a website from a short description.",
    tier: "pro",
    group: "web",
    engine: { name: "GrapesJS", license: "BSD-3", separate: false },
    keywords: [/\b(website|web site|landing page|home ?page)\b/i],
    services: [],
    files: [/\.html?$/i, /landing/i],
  },
  {
    id: "page",
    name: "Client Page Editor",
    plain: "Edit one page a client can look at.",
    tier: "pro",
    group: "web",
    engine: { name: "Puck", license: "MIT", separate: false },
    keywords: [/\b(client page|page editor|edit the page)\b/i],
    services: [],
    files: [/client-page/i, /\.puck\.json$/i],
  },
  {
    id: "static",
    name: "Static export",
    plain: "Save the site as files you can host anywhere.",
    tier: "free",
    group: "web",
    engine: { name: "Astro", license: "MIT", separate: false },
    keywords: [/\b(static export|static site|astro)\b/i],
    services: [],
    files: [/\.astro$/i, /astro\.config/i],
  },
  {
    id: "health",
    name: "Site Health Check",
    plain: "Check a page and fix the easy parts.",
    tier: "free",
    group: "web",
    engine: { name: "Lighthouse", license: "Apache-2.0", separate: false },
    keywords: [/\b(lighthouse|site health|page speed)\b/i],
    services: [],
    files: [/lighthouse/i],
  },
  {
    id: "publish",
    name: "One-click Publish",
    plain: "Put the site on Netlify or Vercel when you click Publish.",
    tier: "pro",
    group: "web",
    engine: { name: "Netlify and Vercel", license: "their APIs", separate: true },
    keywords: [/\b(netlify|vercel|publish the site|go live)\b/i],
    services: ["netlify", "vercel"],
    files: [/netlify\.toml$/i, /vercel\.json$/i],
  },
  {
    id: "social",
    name: "Social Calendar",
    plain: "Plan posts on a calendar. Nothing posts until you click.",
    tier: "pro",
    group: "marketing",
    engine: { name: "Postiz", license: "AGPL-3.0", separate: true },
    keywords: [/\b(post schedule|content calendar|social calendar|schedule posts)\b/i],
    services: ["postiz", "instagram", "meta"],
    files: [/content-calendar/i, /post-schedule/i],
  },
  {
    id: "reel",
    name: "Reel Maker",
    plain: "Turn a clip or an idea into a short reel.",
    tier: "extreme",
    group: "marketing",
    engine: { name: "WhisperX and auto-editor", license: "BSD-2 and Unlicense", separate: false },
    keywords: [/\b(reels?|short video|tiktok|shorts)\b/i],
    services: [],
    files: [/\.(mp4|mov|webm|wav|mp3)$/i],
  },
  {
    id: "email",
    name: "Email Sequences",
    plain: "Write an email series with an unsubscribe line.",
    tier: "pro",
    group: "marketing",
    engine: { name: "HighLevel or listmonk", license: "their APIs", separate: true },
    keywords: [/\b(email series|email sequence|drip campaign|welcome series)\b/i],
    services: ["highlevel", "ghl", "listmonk"],
    files: [/\.eml$/i, /email-series/i],
  },
  {
    id: "ads",
    name: "Ad Copy Studio",
    plain: "Write ad text that fits each platform.",
    tier: "free",
    group: "marketing",
    engine: { name: "Meldmind", license: "this app", separate: false },
    keywords: [/\b(ad copy|facebook ad|google ad|insurance ad|credit ad|write an ad)\b/i],
    services: [],
    files: [/ad-copy/i, /ads\.csv$/i],
  },
  {
    id: "seo",
    name: "SEO Fixer",
    plain: "Fix the title and description a health check flagged.",
    tier: "free",
    group: "web",
    engine: { name: "Lighthouse", license: "Apache-2.0", separate: false },
    keywords: [/\b(seo|meta description|title tag|search ranking)\b/i],
    services: [],
    files: [/sitemap\.xml$/i, /robots\.txt$/i],
  },
];

const added = [];

function cleanBuilder(def) {
  if (!def || typeof def.id !== "string" || !/^[a-z][a-z0-9-]{0,40}$/.test(def.id)) return null;
  return {
    id: def.id,
    name: String(def.name || def.id).slice(0, 80),
    plain: String(def.plain || "").slice(0, 200),
    tier: ["free", "pro", "extreme"].includes(def.tier) ? def.tier : "pro",
    group: def.group === "marketing" ? "marketing" : "web",
    engine: {
      name: String(def.engine?.name || "Meldmind").slice(0, 80),
      license: String(def.engine?.license || "").slice(0, 80),
      separate: !!def.engine?.separate,
    },
    keywords: Array.isArray(def.keywords) ? def.keywords.filter((re) => re instanceof RegExp) : [],
    services: (def.services || []).map((s) => String(s).toLowerCase()),
    files: Array.isArray(def.files) ? def.files.filter((re) => re instanceof RegExp) : [],
  };
}

// The second pull request adds builders here. A duplicate id is ignored.
export function registerBuilder(def) {
  const row = cleanBuilder(def);
  if (!row) return null;
  if (allBuilders().some((b) => b.id === row.id)) return null;
  added.push(row);
  return row;
}

export function allBuilders() {
  return [...BUILDERS.map((b) => cleanBuilder(b)).filter(Boolean), ...added];
}

export function builderById(id) {
  return allBuilders().find((b) => b.id === id) || null;
}

export function signalKey(id, reason) {
  const kind = String(reason?.kind || "");
  const detail = String(reason?.detail || "").trim().toLowerCase();
  return `${id}:${kind}:${detail}`;
}

function score(kind) {
  if (kind === "service") return 3;
  if (kind === "words") return 2;
  return 1;
}

// text: chat, mission, or the words currently in the box.
// services: connected service ids, already lowercased by the caller or here.
// files: file names only. Contents are never read.
// settings: { suggestions: boolean, dismissed: { [signalKey]: true } }
export function detectNeeds({ text = "", services = [], files = [], settings = {} } = {}) {
  if (settings.suggestions === false) return [];
  const dismissed = settings.dismissed || {};
  const blob = String(text || "");
  const connected = new Set((services || []).map((s) => String(s).toLowerCase()));
  const names = (files || []).map((f) => String(f || "")).filter(Boolean);
  const hits = [];
  for (const b of allBuilders()) {
    const reasons = [];
    for (const re of b.keywords) {
      const m = blob.match(re);
      if (m) reasons.push({ kind: "words", detail: m[0] });
    }
    for (const service of b.services) {
      if (connected.has(service)) reasons.push({ kind: "service", detail: service });
    }
    for (const name of names) {
      if (b.files.some((re) => re.test(name))) reasons.push({ kind: "file", detail: name.split(/[/\\]/).pop() });
    }
    reasons.sort((a, c) => score(c.kind) - score(a.kind));
    const fresh = reasons.find((r) => !dismissed[signalKey(b.id, r)]);
    if (!fresh) continue;
    hits.push({
      id: b.id,
      name: b.name,
      plain: b.plain,
      tier: b.tier,
      group: b.group,
      engine: b.engine,
      reason: fresh,
      score: score(fresh.kind),
    });
  }
  hits.sort((a, c) => c.score - a.score || a.name.localeCompare(c.name));
  return hits;
}

export function cardCopy(hit) {
  if (!hit) return null;
  let why = "It looks like you need this.";
  if (hit.reason?.kind === "service") why = `You connected ${hit.reason.detail}.`;
  else if (hit.reason?.kind === "file") why = `You have a file named ${hit.reason.detail}.`;
  else if (hit.reason?.kind === "words") why = `You mentioned "${hit.reason.detail}".`;
  return {
    title: CARD_TITLE,
    body: `${hit.name}. ${hit.plain} ${why}`.replace(/\s+/g, " ").trim(),
    id: hit.id,
    signal: signalKey(hit.id, hit.reason),
  };
}
