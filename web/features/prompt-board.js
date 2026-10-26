// Pro prompts board: one shelf per template, search across shelves, open or closed memory.
// Pure helpers stay free of window so tests and the server can import them.
// The tab mounts this at runtime. Sort and filter appear only in Expert mode.

export const SHELVES = [
  { id: "sales", label: "Sales and Follow-up", blurb: "Replies, calls, and follow-ups." },
  { id: "marketing", label: "Marketing and Content", blurb: "Posts, hooks, and articles." },
  { id: "leadership", label: "Leadership and Team", blurb: "Hiring, coaching, and reviews." },
  { id: "productivity", label: "Productivity and Delegation", blurb: "Time, hand-offs, and what to drop." },
  { id: "planning", label: "Planning and Operations", blurb: "Plans, SOPs, and the weekly view." },
  { id: "build", label: "Build and Spec", blurb: "Spec it out and the multi-agent builder." },
  { id: "creative", label: "Creative", blurb: "Music video and reels." },
  { id: "industry", label: "Industry packs", blurb: "Real estate, mortgage, credit repair, and creators. Pro. No promised results." },
  { id: "custom", label: "Custom/My prompts", blurb: "Prompts you wrote or saved." },
  { id: "marketplace", label: "Marketplace", blurb: "Prompt packs from the Marketplace." },
];

const SHELF_IDS = new Set(SHELVES.map((s) => s.id));
const MOVABLE = new Set(SHELVES.map((s) => s.id).filter((id) => id !== "marketplace"));

const OVERRIDE = {
  "automate-week": "productivity",
  "build-it-right": "build",
  "spec-it-out": "build",
  "agent-team": "build",
  "vacation-test": "productivity",
  "friday-checkin": "leadership",
  "daily-sundown": "productivity",
  "delegation-handoff": "productivity",
  "buy-back-time": "productivity",
  "ai-leverage": "productivity",
  "pricing-tiers": "sales",
  "ad-funnel": "marketing",
  "reel-scripts": "creative",
  "friday-coach": "leadership",
  "talk-to-me": "planning",
  "business-profile": "planning",
  "master-voice": "planning",
  "re-listing-brief": "industry",
  "re-buyer-followup": "industry",
  "mtg-process-explainer": "industry",
  "mtg-rate-talk": "industry",
  "cr-dispute-draft": "industry",
  "cr-status-update": "industry",
  "cr8-sponsor-script": "industry",
  "cr8-caption-pack": "industry",
};

const BY_CATEGORY = {
  "Sales/clients": "sales",
  "Content": "marketing",
  "People/hiring": "leadership",
  "Personal/coaching": "productivity",
  "Money": "planning",
  "Strategy/ops": "planning",
};

export const OPEN_KEY = "cc.prompts.shelves.open";

export function shelfFor(template) {
  const id = String(template?.id || "");
  if (OVERRIDE[id]) return OVERRIDE[id];
  const name = String(template?.name || "");
  if (/spec it out|agent team/i.test(name)) return "build";
  if (/\breels?\b|music video/i.test(name)) return "creative";
  return BY_CATEGORY[template?.category] || "planning";
}

export function shelfLabel(id) {
  return SHELVES.find((s) => s.id === id)?.label || "Planning and Operations";
}

export function uiExperience(sources = {}) {
  const raw = sources.uiMode ?? sources.experience ?? sources.dataUi ?? sources.stored ?? "simple";
  return String(raw).toLowerCase() === "expert" ? "expert" : "simple";
}

export function boardControls(mode) {
  const expert = mode === "expert";
  return { search: true, categories: true, sort: expert, filter: expert };
}

export function matchesQuery(item, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const blob = [item?.name, item?.title, item?.description, item?.promise, item?.text, item?.category, item?.shelf, shelfLabel(item?.shelf)]
    .filter(Boolean).join(" ").toLowerCase();
  return blob.includes(needle);
}

export function marketplacePacks(overview) {
  const rows = [];
  const seen = new Set();
  for (const list of [overview?.catalog, overview?.installed]) {
    for (const row of list || []) {
      if (row?.kind !== "prompt") continue;
      const id = String(row.id || row.listingId || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        name: row.title || row.name || "Prompt pack",
        description: row.promise || row.description || "Marketplace prompt pack",
        shelf: "marketplace",
        kind: "prompt",
      });
    }
  }
  return rows;
}

function knownShelf(id, fallback) {
  return SHELF_IDS.has(id) ? id : fallback;
}

function decorate(item, source) {
  let shelf;
  if (source === "marketplace") shelf = "marketplace";
  else if (source === "custom") shelf = knownShelf(item?.shelf, "custom");
  else shelf = knownShelf(item?.shelf, null) || shelfFor(item);
  if (source === "custom" && shelf === "marketplace") shelf = "custom";
  return {
    id: item.id,
    name: item.name || item.title || "Prompt",
    description: item.description || item.promise || "",
    text: item.text || "",
    category: item.category || "",
    shelf,
    shelfLabel: shelfLabel(shelf),
    source,
    movable: source === "custom",
  };
}

export function buildBoard({ templates = [], custom = [], marketplace = [], query = "", mode = "simple", sort = "pack", filter = "all" } = {}) {
  const expert = mode === "expert";
  const items = [
    ...templates.map((row) => decorate(row, "pack")),
    ...custom.map((row) => decorate(row, "custom")),
    ...marketplace.map((row) => decorate(row, "marketplace")),
  ];
  let rows = items.filter((item) => matchesQuery(item, query));
  const useFilter = expert && filter && filter !== "all" && SHELF_IDS.has(filter);
  if (useFilter) rows = rows.filter((item) => item.shelf === filter);
  const groups = SHELVES.map((shelf) => {
    let list = rows.filter((item) => item.shelf === shelf.id);
    if (expert && sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return { ...shelf, items: list };
  });
  if (useFilter) return groups.filter((g) => g.id === filter);
  const q = String(query || "").trim();
  return groups.filter((g) => g.items.length || (!q && (g.id === "custom" || g.id === "marketplace")));
}

export function assignCustom({ id, shelf, ownIds, current = {} }) {
  const own = new Set(ownIds || []);
  if (!own.has(String(id || ""))) {
    const err = new Error("Only your own prompts can move.");
    err.status = 400;
    throw err;
  }
  if (!MOVABLE.has(shelf)) {
    const err = new Error("Pick a category from the list.");
    err.status = 400;
    throw err;
  }
  return { ...current, [id]: shelf };
}

export function readOpen(storage, ids) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem?.(OPEN_KEY) || "null"); } catch { saved = null; }
  const open = {};
  for (const id of ids) open[id] = !(saved && typeof saved === "object" && saved[id] === false);
  return open;
}

export function writeOpen(storage, open) {
  if (!storage?.setItem) return;
  const slim = {};
  for (const [id, on] of Object.entries(open || {})) if (SHELF_IDS.has(id)) slim[id] = on !== false;
  try { storage.setItem(OPEN_KEY, JSON.stringify(slim)); } catch { /* private mode */ }
}

export function voteBar(item, esc = escapeText) {
  const upOn = item?.mine === "up";
  const downOn = item?.mine === "down";
  const fresh = item?.fresh ? `<span class="chip">New this week</span>` : "";
  const credit = item?.credit ? `<span class="small dim">${esc(item.credit)}</span>` : "";
  return `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
    <button type="button" class="btn sm" data-vote="up" data-id="${esc(item?.id || "")}" aria-pressed="${upOn ? "true" : "false"}" aria-label="Thumbs up">Thumbs up</button>
    <button type="button" class="btn sm" data-vote="down" data-id="${esc(item?.id || "")}" aria-pressed="${downOn ? "true" : "false"}" aria-label="Thumbs down">Thumbs down</button>
    <span class="small dim">${esc(item?.scoreLabel || "No votes yet")}</span>
    ${fresh}${credit}
  </div>`;
}

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderBoard(groups, { open = {}, searching = false, esc = escapeText } = {}) {
  if (!groups.length) return `<div class="empty">No prompts match.</div>`;
  return groups.map((g) => {
    const shown = searching || open[g.id] !== false;
    const moves = SHELVES.filter((s) => MOVABLE.has(s.id));
    const items = g.items.map((item) => {
      const move = item.movable ? `<label class="small dim" style="display:block;margin-top:4px">Move to <select data-move="${esc(item.id)}" aria-label="Move ${esc(item.name)}">${moves.map((s) => `<option value="${esc(s.id)}"${s.id === item.shelf ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>` : "";
      const attr = item.source === "custom" ? "data-custom" : item.source === "marketplace" ? "data-pack" : "data-open";
      return `<div style="margin-top:8px"><button class="btn" type="button" ${attr}="${esc(item.id)}" style="text-align:left;width:100%"><b>${esc(item.name)}</b><div class="small dim">${esc(item.description)}</div></button>${voteBar(item, esc)}${move}</div>`;
    }).join("");
    const empty = g.items.length ? "" : `<div class="small dim" style="margin-top:8px">${g.id === "custom" ? "Prompts you save show up here. Nothing is sent." : "Prompt packs from the Marketplace show up here."}</div>`;
    return `<details class="panel" data-shelf="${esc(g.id)}"${shown ? " open" : ""}><summary><b>${esc(g.label)}</b> <span class="dim small">${g.items.length}</span></summary><div class="small dim">${esc(g.blurb)}</div>${items}${empty}</details>`;
  }).join("");
}

function pageExperience() {
  const cc = window.CC || {};
  const fromFn = typeof cc.uiMode === "function" ? cc.uiMode() : cc.uiMode;
  return uiExperience({
    uiMode: cc.S?.uiMode || fromFn,
    dataUi: document.body?.dataset?.ui || document.documentElement?.dataset?.ui,
  });
}

function memory() {
  try { return window.localStorage; } catch { return null; }
}

export function mountPromptBoard(view, model, actions = {}) {
  const tools = view.querySelector("#pp-tools");
  const list = view.querySelector("#pp-list");
  const search = view.querySelector("#pp-q");
  if (!list || !search) return;
  const esc = actions.esc || escapeText;
  const toast = actions.toast || ((m) => window.CC?.toast?.(m));
  let sort = "pack";
  let filter = "all";
  const ids = SHELVES.map((s) => s.id);
  let open = readOpen(memory(), ids);

  if (tools && !tools.dataset.ready) {
    tools.dataset.ready = "1";
    tools.innerHTML = `<label class="small">Sort <select id="pp-sort" aria-label="Sort prompts"><option value="pack">Pack order</option><option value="name">Name</option></select></label>
      <label class="small">Filter <select id="pp-filter" aria-label="Filter by category"><option value="all">All categories</option>${SHELVES.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("")}</select></label>`;
    tools.querySelector("#pp-sort").addEventListener("change", (e) => { sort = e.target.value; draw(); });
    tools.querySelector("#pp-filter").addEventListener("change", (e) => { filter = e.target.value; draw(); });
  }

  const draw = () => {
    const mode = pageExperience();
    const controls = boardControls(mode);
    // 0.4.20: .row sets display:flex, which beats the hidden attribute, so Sort and Filter
    // showed in Simple mode and did nothing. Hide with display as well.
    if (tools) { tools.hidden = !controls.sort; tools.style.display = controls.sort ? "" : "none"; }
    const query = search.value || "";
    const groups = buildBoard({
      templates: model.templates || [],
      custom: model.custom || [],
      marketplace: model.marketplace || [],
      query,
      mode,
      sort,
      filter,
    });
    const pinned = query.trim().length > 0 || (mode === "expert" && filter !== "all");
    list.innerHTML = renderBoard(groups, { open, searching: pinned, esc });
    list.querySelectorAll("details[data-shelf] > summary").forEach((sum) => sum.addEventListener("click", () => {
      if (pinned) return;
      const d = sum.parentElement;
      open[d.dataset.shelf] = !d.open;
      writeOpen(memory(), open);
    }));
    list.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", () => actions.onVote?.(b.dataset.id, b.dataset.vote)));
    list.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => actions.onOpen?.(b.dataset.open)));
    list.querySelectorAll("[data-custom]").forEach((b) => b.addEventListener("click", () => {
      const item = (model.custom || []).find((row) => row.id === b.dataset.custom);
      if (item) actions.onCustom?.(item);
    }));
    list.querySelectorAll("[data-pack]").forEach((b) => b.addEventListener("click", () => {
      const item = (model.marketplace || []).find((row) => row.id === b.dataset.pack);
      if (item) actions.onPack?.(item);
    }));
    list.querySelectorAll("[data-move]").forEach((sel) => sel.addEventListener("change", async () => {
      const id = sel.dataset.move;
      const shelf = sel.value;
      try {
        await actions.onMove?.(id, shelf);
        const row = (model.custom || []).find((p) => p.id === id);
        if (row) row.shelf = shelf;
        draw();
      } catch (e) {
        toast(e.message || "Could not move that prompt.", true);
        draw();
      }
    }));
  };
  if (!search.dataset.board) {
    search.dataset.board = "1";
    search.addEventListener("input", draw);
  }
  draw();
  return draw;
}
