// What Meldmind can do, and the short tour that introduces it.
// A step or a list row is shown only when its page is in this app.
// Missing features (open pull requests, in-progress builders, Remix 2) stay hidden.
// Prices here are the plan: Pro $18.99 a month, Extreme $29.99 a month.
// The Subscriptions page and the Square link are unchanged.

export const PLAN = {
  free: { id: "free", label: "Free", price: "$0" },
  pro: { id: "pro", label: "Pro", price: "$18.99 a month" },
  extreme: { id: "extreme", label: "Extreme", price: "$29.99 a month" },
};

const TIER_RANK = { free: 0, pro: 1, extreme: 2 };

function asSet(value) {
  if (!value) return new Set();
  if (value instanceof Set) return value;
  return new Set(value);
}

export function normalizeProbe(probe = {}) {
  return {
    features: asSet(probe.features),
    views: asSet(probe.views),
    walks: asSet(probe.walks),
    builtins: asSet(probe.builtins),
  };
}

export function joinAnd(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function has(set, id) {
  return !!id && set.has(id);
}

function settingsOpen(probe, feature, focus) {
  if (!has(probe.features, feature) || !has(probe.views, "settings")) return null;
  return { view: "settings", focus: focus || `[data-feature='${feature}']` };
}

function viewOpen(probe, id, focus) {
  if (has(probe.views, id)) return { view: id, focus: focus || "" };
  return null;
}

// Built-in pages this app already draws. Tour and Help read these flags.
// A later build drops a flag when that control is removed, and the step hides.
export const GUIDE_BUILTINS = ["hub", "council", "mission", "phone", "whats-new"];

const BUILDERS = [
  { id: "website", name: "a website", walks: ["website"], views: ["website"], features: ["website", "builder-website"] },
  { id: "marketing", name: "marketing", walks: ["marketing"], views: ["marketing"], features: ["marketing", "builder-marketing"] },
  { id: "reels", name: "reels", walks: ["reels"], views: ["reels"], features: ["reels", "builder-reels"] },
  { id: "highlevel", name: "HighLevel", walks: ["highlevel"], views: ["highlevel"], features: ["highlevel", "ghl", "builder-highlevel"] },
  { id: "accounting", name: "accounting", walks: ["accounting"], views: ["accounting"], features: ["accounting", "builder-accounting"] },
  { id: "booking", name: "booking", walks: ["booking"], views: ["booking"], features: ["booking", "builder-booking"] },
  { id: "meetings", name: "meeting notes", walks: ["meeting-notes", "meetings"], views: ["meeting-notes", "meetings"], features: ["meeting-notes", "meetings", "builder-meetings"] },
  { id: "contracts", name: "contracts", walks: ["contracts"], views: ["contracts"], features: ["contracts", "builder-contracts"] },
  { id: "assistant", name: "a chat assistant", walks: ["chat-assistant"], views: ["chat-assistant", "assistant"], features: ["chat-assistant", "assistant", "builder-assistant"] },
];

function builderOpen(probe, spec) {
  for (const id of spec.views) {
    const page = viewOpen(probe, id);
    if (page) return page;
  }
  for (const id of spec.features) {
    const page = viewOpen(probe, id) || settingsOpen(probe, id);
    if (page) return page;
  }
  if (spec.walks.some((id) => has(probe.walks, id)) && has(probe.views, "start")) {
    return { view: "start", focus: "#sp-root" };
  }
  return null;
}

function buildersSentence(parts) {
  const list = joinAnd(parts.map((p) => p.name));
  const onStart = parts.every((p) => p.open.view === "start");
  if (onStart) return `Start a project walks you through ${list} when you want to make one.`;
  return `A guided builder walks you through ${list} when you want to make one.`;
}

function remixSentence(parts) {
  const ids = new Set(parts.map((p) => p.id));
  const from = [];
  if (ids.has("screenshot")) from.push("a screenshot");
  if (ids.has("starters")) from.push("a game starter");
  const how = from.length ? ` from ${joinAnd(from)}` : "";
  let end = "";
  if (ids.has("test") && ids.has("publish")) end = ", then you test it and publish when you click";
  else if (ids.has("test")) end = ", then you test it when you click";
  else if (ids.has("publish")) end = ", and you publish only when you click";
  return `Remix rebuilds an app or a game you show it${how}, with your own name and look${end}.`;
}

function researchSentence(parts) {
  const ids = new Set(parts.map((p) => p.id));
  if (ids.has("research") && ids.has("refocus")) {
    return "Research finds answers and shows its sources, and Refocus helps you finish work you already started.";
  }
  if (ids.has("refocus")) return "Refocus lines up work you already started so you can finish it.";
  return "Research finds answers on the web and shows the pages it used.";
}

function connectSentence(parts) {
  return `You can connect ${joinAnd(parts.map((p) => p.name))}, and nothing goes out until you say so.`;
}

function safetySentence(parts) {
  if (parts.some((p) => p.id === "phone")) {
    return "Nothing is sent, posted, or bought until you click OK, and your phone can approve it.";
  }
  return "Nothing is sent, posted, or bought until you click OK.";
}

function teamsSentence(parts) {
  const ids = new Set(parts.map((p) => p.id));
  const hosted = ids.has("hosted");
  const teams = ids.has("teams");
  const people = ids.has("people");
  if (teams && people && hosted) return "Teams and People are where you share work, and Extreme can keep a run going while this PC is off.";
  if (teams && hosted) return "Teams is where you share work with people, and Extreme can keep a run going while this PC is off.";
  if (people && hosted) return "People is where you talk with your team, and Extreme can keep a run going while this PC is off.";
  if (hosted) return "Extreme can keep a run going in the cloud while this PC is off.";
  if (teams && people) return "Teams is where you share projects, and People is where you talk with them.";
  if (people) return "People is where you talk with your team.";
  return "Teams is where you invite people and share the projects you choose.";
}

function highestTier(parts, fallback) {
  let best = fallback;
  for (const part of parts) {
    const tier = part.tier || fallback;
    if ((TIER_RANK[tier] ?? 0) > (TIER_RANK[best] ?? 0)) best = tier;
  }
  return best;
}

function blankNote() {
  return "";
}

export const GUIDE = [
  {
    id: "hub",
    title: "One hub for all your AIs",
    helpId: "one-hub",
    tier: "free",
    sentence: () => "One hub holds all your AIs, picks the best one for each task, and learns from you.",
    note: blankNote,
    badge: () => "free",
    prefer: (parts) => parts[0].open,
    parts: [
      {
        id: "hub",
        name: "your AIs",
        tier: "free",
        open(p) {
          if (!has(p.builtins, "hub") || !has(p.views, "command")) return null;
          return { view: "command", focus: "#orders" };
        },
      },
    ],
  },
  {
    id: "missions",
    title: "Missions and councils",
    helpId: "missions-and-councils",
    tier: "pro",
    sentence(parts) {
      const ids = new Set(parts.map((p) => p.id));
      if (ids.has("council") && ids.has("mission")) {
        return "A council asks several AIs at once, and a mission breaks a bigger job into steps that get checked.";
      }
      if (ids.has("mission")) return "A mission breaks a bigger job into steps that get checked.";
      return "A council asks several AIs at once and compares their answers.";
    },
    note(parts) {
      if (parts.some((p) => p.id === "mission")) return "Free includes 5 councils a month, and missions are part of Pro.";
      return "Free includes 5 councils a month.";
    },
    badge(parts) {
      return parts.some((p) => p.id === "mission") ? "pro" : "free";
    },
    prefer: (parts) => parts[0].open,
    parts: [
      {
        id: "council",
        name: "a council",
        tier: "free",
        open(p) {
          if (!has(p.builtins, "council") || !has(p.views, "command")) return null;
          return { view: "command", focus: "#orders" };
        },
      },
      {
        id: "mission",
        name: "a mission",
        tier: "pro",
        open(p) {
          if (!has(p.builtins, "mission") || !has(p.views, "command")) return null;
          return { view: "command", focus: "#orders" };
        },
      },
    ],
  },
  {
    id: "remix",
    title: "Remix any app or game",
    helpId: "remix-any-app",
    tier: "pro",
    sentence: remixSentence,
    note: () => "Extreme is $29.99 a month and has no monthly cap.",
    badge: () => "pro",
    prefer(parts) {
      return parts.find((p) => p.open.view === "remix")?.open || parts[0].open;
    },
    parts: [
      {
        id: "screenshot",
        name: "Remix",
        tier: "pro",
        open(p) {
          return viewOpen(p, "screenshot")
            || viewOpen(p, "screenshot-to-app")
            || settingsOpen(p, "screenshot-to-app")
            || (has(p.views, "remix") ? { view: "remix", focus: "#remix-root" } : null);
        },
      },
      {
        id: "starters",
        name: "a game starter",
        tier: "pro",
        open(p) {
          return viewOpen(p, "game-starters")
            || settingsOpen(p, "game-starters")
            || (has(p.views, "remix") ? { view: "remix", focus: "#remix-root" } : null);
        },
      },
      {
        id: "test",
        name: "a test",
        tier: "pro",
        open(p) {
          return viewOpen(p, "remix-test")
            || settingsOpen(p, "remix-test")
            || viewOpen(p, "game-test");
        },
      },
      {
        id: "publish",
        name: "publish",
        tier: "pro",
        open(p) {
          if (!has(p.views, "remix") && !has(p.features, "remix") && !has(p.views, "remix-publish")) return null;
          return viewOpen(p, "remix-publish")
            || settingsOpen(p, "remix-publish")
            || (has(p.views, "remix") ? viewOpen(p, "publish", "#pub-tour") : null);
        },
      },
    ],
  },
  {
    id: "builders",
    title: "Guided builders",
    helpId: "guided-builders",
    tier: "free",
    sentence: buildersSentence,
    note: () => "Open the builder you see, and a full mission is part of Pro.",
    badge: () => "free",
    prefer: (parts) => parts[0].open,
    parts: BUILDERS.map((spec) => ({
      id: spec.id,
      name: spec.name,
      tier: "free",
      open(p) { return builderOpen(p, spec); },
    })),
  },
  {
    id: "research",
    title: "Research and Refocus",
    helpId: "research-and-refocus",
    tier: "free",
    sentence: researchSentence,
    note(parts) {
      if (parts.some((p) => p.id === "refocus")) return "Refocus is Pro, and rebuilding a finished piece is Extreme when that choice is on the page.";
      return "";
    },
    badge(parts) {
      return parts.some((p) => p.id === "refocus") ? "pro" : "free";
    },
    prefer(parts) {
      return parts.find((p) => p.id === "research")?.open || parts[0].open;
    },
    parts: [
      {
        id: "research",
        name: "Research",
        tier: "free",
        open(p) {
          if (has(p.views, "research")) return { view: "research", focus: "" };
          if ((has(p.features, "search") || has(p.features, "research")) && has(p.views, "settings")) {
            const id = has(p.features, "research") ? "research" : "search";
            return { view: "settings", focus: `[data-feature='${id}']` };
          }
          return null;
        },
      },
      {
        id: "refocus",
        name: "Refocus",
        tier: "pro",
        open(p) {
          return viewOpen(p, "refocus", "#rf-root") || settingsOpen(p, "refocus", "[data-feature='refocus']");
        },
      },
    ],
  },
  {
    id: "connect",
    title: "Connect your apps",
    helpId: "connect-your-apps",
    tier: "free",
    sentence: connectSentence,
    note: () => "Free includes one connected service, and Pro includes more.",
    badge: () => "free",
    prefer(parts) {
      return parts.find((p) => p.open.view !== "settings")?.open || parts[0].open;
    },
    parts: [
      {
        id: "zapier",
        name: "Zapier and Make",
        tier: "free",
        open(p) {
          return viewOpen(p, "apps") || settingsOpen(p, "apps", "[data-feature='apps']");
        },
      },
      {
        id: "mcp",
        name: "MCP",
        tier: "free",
        open(p) {
          return settingsOpen(p, "mcp", "[data-feature='mcp']") || viewOpen(p, "mcp");
        },
      },
      {
        id: "webhooks",
        name: "webhooks",
        tier: "free",
        open(p) {
          return viewOpen(p, "schedules", "#sch-root")
            || settingsOpen(p, "schedules")
            || (has(p.features, "apps") ? settingsOpen(p, "apps", "[data-feature='apps']") : null);
        },
      },
    ],
  },
  {
    id: "safety",
    title: "You stay in control",
    helpId: "safe-control",
    tier: "free",
    sentence: safetySentence,
    note(parts) {
      if (parts.some((p) => p.id === "phone")) return "The OK click is on every plan, and turning the phone link on is Pro at $18.99 a month.";
      return "";
    },
    badge: () => "free",
    prefer(parts) {
      return parts.find((p) => p.id === "phone")?.open || parts[0].open;
    },
    parts: [
      {
        id: "ok",
        name: "Publish",
        tier: "free",
        open(p) {
          if (has(p.views, "publish")) return { view: "publish", focus: "#pub-tour" };
          if (has(p.features, "browser") && has(p.views, "settings")) return { view: "settings", focus: "[data-feature='browser']" };
          if (has(p.features, "smarter-control") && has(p.views, "settings")) return { view: "settings", focus: "[data-feature='smarter-control']" };
          return null;
        },
      },
      {
        id: "phone",
        name: "Phone",
        tier: "pro",
        open(p) {
          if (has(p.features, "smarter-control") && has(p.views, "settings")) {
            return { view: "settings", focus: "[data-feature='smarter-control']" };
          }
          if (has(p.builtins, "phone") && has(p.views, "settings")) return { view: "settings", focus: "#phone-pair" };
          return null;
        },
      },
    ],
  },
  {
    id: "teams",
    title: "Teams, People, and hosted runs",
    helpId: "teams-and-hosted",
    tier: "pro",
    sentence: teamsSentence,
    note(parts) {
      const hosted = parts.some((p) => p.id === "hosted");
      const teams = parts.some((p) => p.id === "teams");
      if (hosted && teams) return "The Teams page asks for a Studio licence before you create a workspace, and hosted runs are Extreme.";
      if (hosted) return "Hosted runs are Extreme.";
      if (teams) return "The Teams page asks for a Studio licence before you create a workspace.";
      return "";
    },
    badge(parts) {
      return highestTier(parts, "pro");
    },
    prefer(parts) {
      return parts.find((p) => p.id === "teams")?.open
        || parts.find((p) => p.id === "people")?.open
        || parts[0].open;
    },
    parts: [
      {
        id: "teams",
        name: "Teams",
        tier: "pro",
        open(p) {
          return viewOpen(p, "workspaces") || settingsOpen(p, "workspaces");
        },
      },
      {
        id: "people",
        name: "People",
        tier: "pro",
        open(p) {
          return viewOpen(p, "userchat")
            || viewOpen(p, "people")
            || settingsOpen(p, "userchat")
            || settingsOpen(p, "people");
        },
      },
      {
        id: "hosted",
        name: "hosted runs",
        tier: "extreme",
        open(p) {
          return viewOpen(p, "hosted-runs") || settingsOpen(p, "hosted-runs", "[data-feature='hosted-runs']");
        },
      },
    ],
  },
  {
    id: "whats-new",
    title: "What's new after an update",
    helpId: "after-an-update",
    tier: "free",
    sentence: () => "After each update, a short What's new note shows what changed.",
    note: () => "The note shows once. Replay the tour any time from Help.",
    badge: () => "free",
    prefer: (parts) => parts[0].open,
    parts: [
      {
        id: "whats-new",
        name: "What's new",
        tier: "free",
        open(p) {
          if (!has(p.builtins, "whats-new") || !has(p.views, "help")) return null;
          return { view: "help", focus: "#can-do", article: "after-an-update" };
        },
      },
    ],
  },
];

function resolveParts(area, probe) {
  const parts = [];
  for (const part of area.parts) {
    const open = part.open(probe);
    if (!open?.view || !probe.views.has(open.view)) continue;
    parts.push({
      id: part.id,
      name: part.name,
      tier: part.tier || area.tier,
      open,
    });
  }
  return parts;
}

export function visibleGuide(probe) {
  const p = normalizeProbe(probe);
  const rows = [];
  for (const area of GUIDE) {
    const parts = resolveParts(area, p);
    if (!parts.length) continue;
    const tier = area.badge(parts);
    const plan = PLAN[tier] || PLAN.free;
    const open = area.prefer(parts);
    rows.push({
      id: area.id,
      title: area.title,
      body: area.sentence(parts),
      tier,
      tierLabel: plan.label,
      price: plan.price,
      priceNote: area.note(parts) || "",
      helpId: area.helpId,
      open,
      parts,
    });
  }
  return rows;
}

// Plain steps and a how-to-start line for the downloadable guide.
// The same parts as the tour, so a hidden feature never gets a step.
const GUIDE_COPY = {
  hub: {
    steps: () => [
      "Open the chat box.",
      "Say what you want in plain words.",
      "Meldmind picks the best AI for that task.",
      "It learns from the jobs you run, so the next pick gets sharper.",
    ],
    start: () => "Type a request in the chat box. You can try this on Free, including while the pretend AIs are on.",
  },
  missions: {
    steps(parts) {
      const ids = new Set(parts.map((p) => p.id));
      const steps = ["Open the chat box and type the job in plain words."];
      if (ids.has("council")) steps.push("Pick a council when you want several AIs to answer the same question.");
      if (ids.has("mission")) steps.push("Pick a mission when the job should be split into steps that get checked.");
      steps.push("Nothing starts until you click.");
      return steps;
    },
    start(parts) {
      if (parts.some((p) => p.id === "mission")) {
        return "Open the chat box. In Expert you can pick Council or Mission before you run it. Free includes 5 councils a month.";
      }
      return "Open the chat box and ask for a council. Free includes 5 councils a month.";
    },
  },
  remix: {
    steps(parts) {
      const ids = new Set(parts.map((p) => p.id));
      const steps = ["Open Remix."];
      if (ids.has("screenshot")) steps.push("Show a screenshot of the app or game you want to rebuild.");
      if (ids.has("starters")) steps.push("Pick a game starter when you want a game.");
      steps.push("Keep your own name, characters, and look.");
      if (ids.has("test")) steps.push("Test it before you share it.");
      if (ids.has("publish")) steps.push("Publish only when you click.");
      return steps;
    },
    start: () => "Open Remix from Help. Extreme is $29.99 a month and has no monthly cap.",
  },
  builders: {
    steps(parts) {
      const list = joinAnd(parts.map((p) => p.name));
      const onStart = parts.every((p) => p.open.view === "start");
      return [
        onStart ? "Open Start a project." : "Open the builder for the job you want.",
        `Pick ${list}.`,
        "Answer the short questions in plain words.",
        "Read the draft and ask for changes before anything is finished.",
      ];
    },
    start(parts) {
      const list = joinAnd(parts.map((p) => p.name));
      const where = parts.every((p) => p.open.view === "start") ? "Start a project" : "the builder";
      return `Open ${where} and choose ${list}. Opening a builder is free. A full mission is part of Pro.`;
    },
  },
  research: {
    steps(parts) {
      const ids = new Set(parts.map((p) => p.id));
      const steps = [];
      if (ids.has("research")) {
        steps.push("Turn on web search when you want sources.");
        steps.push("Ask the question in plain words.");
        steps.push("Open a page it lists and read it yourself.");
      }
      if (ids.has("refocus")) {
        steps.push("Open Refocus and type the work you already started.");
        steps.push("Read the list from oldest to newest, and rebuild only when you click.");
      }
      return steps;
    },
    start(parts) {
      const ids = new Set(parts.map((p) => p.id));
      if (ids.has("research") && ids.has("refocus")) {
        return "Open Settings for web search, or open Refocus when you want to finish work you already started.";
      }
      if (ids.has("refocus")) return "Open Refocus and type a topic, such as half-done reels.";
      return "Open Settings and find Web search. Search stays off until you turn it on.";
    },
  },
  connect: {
    steps(parts) {
      const steps = parts.map((p) => {
        if (p.id === "mcp") return "Open Settings for MCP. In Simple, switch to Expert to see that panel.";
        if (p.id === "webhooks") return "Open Schedules for webhooks.";
        if (p.id === "zapier") return "Open the Zapier and Make page when you want those apps.";
        return `Open ${p.name}.`;
      });
      steps.push("Nothing goes out until you say so.");
      return steps;
    },
    start(parts) {
      const first = parts.find((p) => p.open.view !== "settings") || parts[0];
      const where = first.id === "webhooks" ? "Schedules" : first.id === "mcp" ? "Settings" : first.name;
      return `Open ${where} and connect one service. Free includes one connected service, and Pro includes more.`;
    },
  },
  safety: {
    steps(parts) {
      const steps = [
        "Read the preview before anything is sent, posted, or bought.",
        "Click OK only when it is what you wanted.",
      ];
      if (parts.some((p) => p.id === "phone")) steps.push("Turn on the phone link if you want your phone to approve a waiting action.");
      steps.push("Stop ends a control that is using an app.");
      return steps;
    },
    start(parts) {
      if (parts.some((p) => p.id === "phone")) return "Open Settings and find Phone and other devices. The link stays off until you turn it on.";
      return "Open Publish and read the preview. Click OK only when you want it sent.";
    },
  },
  teams: {
    steps(parts) {
      const ids = new Set(parts.map((p) => p.id));
      const steps = [];
      if (ids.has("teams")) {
        steps.push("Open Teams.");
        steps.push("Invite a person with a link you send yourself.");
        steps.push("Share only the projects you choose.");
      }
      if (ids.has("people")) steps.push("Open People when you want to talk with your team.");
      if (ids.has("hosted")) steps.push("On Extreme, a hosted run can keep going while this PC is off. It still waits for your OK.");
      if (!steps.length) steps.push("Open the page for your team.");
      return steps;
    },
    start(parts) {
      const ids = new Set(parts.map((p) => p.id));
      if (ids.has("teams")) return "Open Teams. The page asks for a Studio licence before you create a workspace.";
      if (ids.has("people")) return "Open People to talk with your team.";
      return "Open hosted runs. Extreme is $29.99 a month.";
    },
  },
  "whats-new": {
    steps: () => [
      "After an update, read the short What's new note.",
      "Click Got it to close it, or Take the tour to walk through the app.",
      "Open Help any time to read the note again.",
    ],
    start: () => "Open Help and click Check for updates when you want to look. Nothing downloads until you click.",
  },
};

export function guidePages(probe) {
  return visibleGuide(probe).map((row) => {
    const copy = GUIDE_COPY[row.id] || {};
    return {
      ...row,
      steps: copy.steps ? copy.steps(row.parts) : [],
      start: copy.start ? copy.start(row.parts) : "",
    };
  });
}

export function tourSteps(probe) {
  return visibleGuide(probe).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    tier: row.tier,
    tierLabel: row.tierLabel,
    price: row.price,
    priceNote: row.priceNote,
    helpId: row.helpId,
    view: row.open.view,
    target: row.open.focus || "",
    open: row.open,
    action: "try",
  }));
}

export function matchesQuery(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.title,
    row.body,
    row.tierLabel,
    row.price,
    row.priceNote,
    ...(row.parts || []).map((p) => p.name),
  ].join(" ").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

// The running app: registered features, their tabs, walk types, and built-in pages.
export function liveProbe(cc) {
  const root = cc || globalThis.CC || {};
  const features = new Set((root.features || []).map((f) => f?.id).filter(Boolean));
  const views = new Set(["command", "projects", "credits", "subscriptions", "settings", "setup", "help"]);
  for (const f of root.features || []) {
    if (f?.tab && f.id) views.add(f.id);
  }
  const walks = new Set(root.guideWalks || []);
  const builtins = new Set(root.guideBuiltins || []);
  if (features.has("tour") || builtins.has("whats-new")) builtins.add("whats-new");
  return { features, views, walks, builtins };
}

export async function rememberWalks(apiFn, cc) {
  const root = cc || globalThis.CC;
  if (!root || typeof apiFn !== "function") return [];
  if (Array.isArray(root.guideWalks)) return root.guideWalks;
  try {
    const data = await apiFn("/walkthrough");
    root.guideWalks = (data?.types || []).map((t) => t.id);
  } catch {
    root.guideWalks = [];
  }
  return root.guideWalks;
}
