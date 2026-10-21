// Phase 29: live project view. Who is working, the current step, ledger cost,
// Open in <service> links, outside-agent handoffs, and a flow map driven by the same job events.
// The map is SVG and CSS. prefers-reduced-motion keeps the highlights and drops the moving light.
import { eased, SIZE_MS } from "../graph-usage.js";
const { S, api, esc, money, go, toast } = window.CC;
const SVG_NS = "http://www.w3.org/2000/svg";

const css = `
.lv-wrap { display: flex; flex-direction: column; gap: 12px; }
.lv-map { position: relative; border-radius: 14px; background: radial-gradient(420px 220px at 50% 42%, #132033 0%, #070b12 68%); border: 1px solid #1e293b; box-shadow: inset 0 1px 0 #ffffff10, 0 18px 40px -28px #000; overflow: hidden; }
.lv-map svg { width: 100%; height: 300px; display: block; }
.lv-map.lv-compact svg { height: 210px; }
.lv-node { cursor: default; opacity: 1; transition: opacity .7s ease; }
.lv-node.lv-ghost { opacity: .28; }
.lv-node.lv-gone { opacity: .16; }
.lv-node text { font-family: var(--sans, Inter, sans-serif); text-anchor: middle; pointer-events: none; }
.lv-node .lv-name { font-size: 11px; font-weight: 600; transition: opacity .35s ease; }
.lv-node.lv-tiny .lv-name { opacity: 0; }
.lv-node.lv-tiny:hover .lv-name, .lv-node.lv-tiny:focus .lv-name { opacity: 1; }
.lv-node .lv-init { font-size: 11px; font-weight: 700; }
.lv-halo { opacity: 0; transition: opacity .7s ease; transform-box: fill-box; transform-origin: center; }
.lv-node.lv-live .lv-halo { opacity: .9; animation: lv-pulse 2.4s ease-in-out infinite; }
.lv-node.lv-hub { opacity: .92; }
.lv-edge, .lv-glow-stroke, .lv-stream { fill: none; stroke-linecap: round; transition: opacity .7s ease, stroke .7s ease; }
.lv-edge { stroke-width: 1.15; opacity: .28; }
.lv-glow-stroke { stroke-width: 7; opacity: 0; filter: url(#lv-soft); }
.lv-stream { stroke-width: 1.6; opacity: 0; stroke-dasharray: 3 14; }
.lv-edges .lv-hot .lv-edge { opacity: .95; stroke-width: 1.5; }
.lv-edges .lv-hot .lv-glow-stroke { opacity: .45; }
.lv-edges .lv-hot .lv-stream { opacity: 1; animation: lv-stream 1.15s linear infinite; }
.lv-edges .lv-gone { opacity: .12; }
.lv-spin { transform-box: fill-box; transform-origin: center; animation: lv-spin 2.8s linear infinite; }
.lv-particle { filter: url(#lv-soft); }
@keyframes lv-stream { to { stroke-dashoffset: -34; } }
@keyframes lv-spin { to { transform: rotate(360deg); } }
@keyframes lv-pulse { 0%, 100% { opacity: .28; } 50% { opacity: .95; } }
.lv-status { padding: 8px 12px 10px; font-size: 12.5px; color: var(--text, #e5e7eb); min-height: 18px; letter-spacing: .01em; }
.lv-float { position: fixed; z-index: 40; max-width: 280px; padding: 8px 10px; border-radius: 10px; background: #0c121c; border: 1px solid #234; color: #e5e7eb; font-size: 12px; line-height: 1.4; pointer-events: none; box-shadow: 0 12px 32px rgba(0,0,0,.45); }
.lv-picks { display: flex; flex-wrap: wrap; gap: 6px; }
.lv-picks button.on { border-color: var(--accent, #22d3ee); color: var(--accent, #22d3ee); }
.lv-captions { margin: 0; }
.lv-caption { margin: 0; }
.lv-caption-calm { display: none; }
.lv-hands { display: flex; flex-direction: column; gap: 8px; }
.lv-hand { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line, #1f2937); }
.lv-hand .lv-job { flex: 1; min-width: 140px; }
.lv-hand .lv-result { color: #cbd5e1; }
.lv-stage:has(.lv-map.lv-reduced) .lv-caption-live { display: none; }
.lv-stage:has(.lv-map.lv-reduced) .lv-caption-calm { display: block; }
@media (prefers-reduced-motion: reduce) {
  .lv-halo, .lv-spin, .lv-stream, .lv-edge, .lv-glow-stroke, .lv-node { animation: none !important; transition: none !important; }
  .lv-particle, .lv-dot, .lv-stream { display: none !important; }
  .lv-node.lv-live .lv-halo { opacity: .4; }
  .lv-caption-live { display: none; }
  .lv-caption-calm { display: block; }
}
.lv-reduced .lv-halo, .lv-reduced .lv-spin, .lv-reduced .lv-stream, .lv-reduced .lv-edge, .lv-reduced .lv-glow-stroke, .lv-reduced .lv-node { animation: none !important; }
.lv-reduced .lv-particle, .lv-reduced .lv-dot, .lv-reduced .lv-stream { display: none !important; }
.lv-reduced .lv-node.lv-live .lv-halo { opacity: .4; }
.lv-ops-foot { display: flex; justify-content: flex-end; margin-top: 12px; }
.lv-ops-foot .btn { font-weight: 600; }
`;
if (!document.getElementById("lv-style")) { const style = document.createElement("style"); style.id = "lv-style"; style.textContent = css; document.head.appendChild(style); }

let cache = null;
let selected = "";
let loading = false;
const floatTip = document.createElement("div");
floatTip.className = "lv-float";
floatTip.hidden = true;
document.body.appendChild(floatTip);

function motionReduced() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
function pulseMoves(pulse) {
  if (motionReduced()) return false;
  return !pulse || pulse.animate !== false;
}
function safeColor(c) { return /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#94a3b8"; }
function safePath(d) { return typeof d === "string" && /^[MLQ0-9,.\s-]+$/.test(d) ? d : ""; }
function svgEl(name, attrs) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  return n;
}
function showTip(node, ev) {
  floatTip.textContent = node?.dataset.tip || "";
  floatTip.hidden = !floatTip.textContent;
  if (floatTip.hidden) return;
  const box = (ev?.currentTarget || node).getBoundingClientRect();
  floatTip.style.left = Math.max(8, Math.min(box.left, window.innerWidth - 300)) + "px";
  floatTip.style.top = (box.bottom + 8) + "px";
}
function hideTip() { floatTip.hidden = true; }

function ensureMap(slot, compact) {
  let map = slot.querySelector(":scope > .lv-map");
  if (map) { map.classList.toggle("lv-compact", !!compact); return map; }
  map = document.createElement("div");
  map.className = "lv-map" + (compact ? " lv-compact" : "");
  map.innerHTML = `<svg viewBox="0 0 680 320" role="img">
      <defs>
        <pattern id="lv-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0 H0 V28" fill="none" stroke="#132033" stroke-width="0.6"/></pattern>
        <radialGradient id="lv-vig" cx="50%" cy="42%" r="68%"><stop offset="0%" stop-color="#16324a" stop-opacity="0.55"/><stop offset="100%" stop-color="#05070c" stop-opacity="0"/></radialGradient>
        <filter id="lv-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.1"/></filter>
      </defs>
      <rect width="100%" height="100%" fill="#070b12"/>
      <rect width="100%" height="100%" fill="url(#lv-grid)"/>
      <rect width="100%" height="100%" fill="url(#lv-vig)"/>
      <g class="lv-edges"></g>
      <g class="lv-particles"></g>
      <g class="lv-nodes"></g>
    </svg><div class="lv-status"></div>`;
  slot.appendChild(map);
  return map;
}
function bindMap(map) {
  if (map.dataset.bound) return;
  map.dataset.bound = "1";
  map.addEventListener("mouseover", (e) => { const n = e.target.closest?.(".lv-node"); if (n && map.contains(n)) showTip(n, e); });
  map.addEventListener("mouseout", (e) => { const n = e.target.closest?.(".lv-node"); if (n) hideTip(); });
  map.addEventListener("focusin", (e) => { const n = e.target.closest?.(".lv-node"); if (n && map.contains(n)) showTip(n, e); });
  map.addEventListener("focusout", hideTip);
}
const nodeTweens = new Map();
let nodeRaf = 0;
function paintGeom(g, geom) {
  const x = geom.x, y = geom.y, r = geom.r;
  const halo = g.querySelector(".lv-halo");
  halo.setAttribute("cx", x); halo.setAttribute("cy", y); halo.setAttribute("r", r + 12);
  const core = g.querySelector(".lv-core");
  core.setAttribute("cx", x); core.setAttribute("cy", y); core.setAttribute("r", r);
  const spin = g.querySelector(".lv-spin");
  spin.setAttribute("cx", x); spin.setAttribute("cy", y); spin.setAttribute("r", r + 7);
  const init = g.querySelector(".lv-init");
  init.setAttribute("x", x); init.setAttribute("y", y + 4);
  init.setAttribute("font-size", r < 14 ? "8" : "11");
  const name = g.querySelector(".lv-name");
  name.setAttribute("x", x); name.setAttribute("y", y + r + 16);
}
function aimNode(g, x, y, r, reduced) {
  const cur = g._geom;
  if (reduced || !cur) {
    g._geom = { x, y, r };
    paintGeom(g, g._geom);
    nodeTweens.delete(g);
    return;
  }
  if (Math.abs(cur.x - x) < 0.15 && Math.abs(cur.y - y) < 0.15 && Math.abs(cur.r - r) < 0.15) {
    g._geom = { x, y, r };
    paintGeom(g, g._geom);
    nodeTweens.delete(g);
    return;
  }
  nodeTweens.set(g, { from: { ...cur }, to: { x, y, r }, t0: performance.now() });
  if (!nodeRaf) nodeRaf = requestAnimationFrame(stepNodes);
}
function stepNodes(now) {
  const reduced = motionReduced();
  for (const [g, tw] of nodeTweens) {
    const t = (now - tw.t0) / SIZE_MS;
    if (reduced || t >= 1) {
      g._geom = { ...tw.to };
      nodeTweens.delete(g);
    } else {
      g._geom = {
        x: eased(tw.from.x, tw.to.x, t, false),
        y: eased(tw.from.y, tw.to.y, t, false),
        r: eased(tw.from.r, tw.to.r, t, false),
      };
    }
    paintGeom(g, g._geom);
  }
  nodeRaf = nodeTweens.size ? requestAnimationFrame(stepNodes) : 0;
}
function syncMap(map, flow) {
  if (!flow) return;
  const reduced = motionReduced() || !!flow.reducedMotion || flow.motion === "calm";
  map.classList.toggle("lv-reduced", reduced);
  const svg = map.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${flow.width || 680} ${flow.height || 320}`);
  svg.setAttribute("aria-label", flow.summary || "Live flow");
  map.querySelector(".lv-status").textContent = flow.summary || "Nobody is working right now.";
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edgeG = svg.querySelector(".lv-edges");
  const partG = svg.querySelector(".lv-particles");
  const nodeG = svg.querySelector(".lv-nodes");
  const seenE = new Set();
  for (const e of edges) {
    const id = `${e.from}>${e.to}`;
    const path = safePath(e.path);
    if (!path) continue;
    seenE.add(id);
    let g = edgeG.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!g) {
      g = svgEl("g", { "data-id": id });
      g.appendChild(svgEl("path", { class: "lv-glow-stroke" }));
      g.appendChild(svgEl("path", { class: "lv-edge" }));
      g.appendChild(svgEl("path", { class: "lv-stream" }));
      edgeG.appendChild(g);
    }
    g.classList.toggle("lv-hot", !!e.hot);
    g.classList.remove("lv-gone");
    const color = e.hot ? safeColor(byId[e.to]?.color || byId[e.from]?.color || "#22d3ee") : "#1e293b";
    for (const p of g.querySelectorAll("path")) p.setAttribute("d", path);
    g.querySelector(".lv-edge").setAttribute("stroke", color);
    g.querySelector(".lv-glow-stroke").setAttribute("stroke", e.hot ? color : "#1e293b");
    g.querySelector(".lv-stream").setAttribute("stroke", color);
  }
  edgeG.querySelectorAll("[data-id]").forEach((g) => { if (!seenE.has(g.getAttribute("data-id"))) g.classList.add("lv-gone"); });
  const hotKey = edges.filter((e) => e.hot).map((e) => `${e.from}>${e.to}:${e.path}`).join("|") + (reduced ? ":calm" : ":live");
  if (partG.dataset.key !== hotKey) {
    partG.dataset.key = hotKey;
    partG.replaceChildren();
    if (!reduced) {
      for (const e of edges) {
        if (!e.hot) continue;
        const path = safePath(e.path);
        if (!path) continue;
        const color = safeColor(byId[e.to]?.color || byId[e.from]?.color || "#22d3ee");
        for (let i = 0; i < 3; i++) {
          const c = svgEl("circle", { class: "lv-particle", r: i === 1 ? "2.6" : "1.6", fill: color });
          c.appendChild(svgEl("animateMotion", { dur: "2.6s", repeatCount: "indefinite", begin: `${(i * 0.85).toFixed(2)}s`, path }));
          partG.appendChild(c);
        }
      }
      for (const p of (flow.pulses || []).filter(pulseMoves)) {
        const path = safePath(p.path);
        if (!path) continue;
        const color = safeColor(byId[p.to]?.color || byId[p.from]?.color || "#67e8f9");
        const c = svgEl("circle", { class: "lv-dot", r: "3.2", fill: color });
        c.appendChild(svgEl("animateMotion", { dur: "1.15s", repeatCount: "1", fill: "freeze", path }));
        partG.appendChild(c);
      }
    }
  }
  const seenN = new Set();
  for (const n of nodes) {
    seenN.add(n.id);
    let g = nodeG.querySelector(`[data-id="${CSS.escape(n.id)}"]`);
    const r = n.radius || (n.id === "hub" ? 26 : 18);
    if (!g) {
      g = svgEl("g", { class: "lv-node", tabindex: "0", "data-id": n.id });
      g.appendChild(svgEl("circle", { class: "lv-halo" }));
      g.appendChild(svgEl("circle", { class: "lv-core" }));
      g.appendChild(svgEl("circle", { class: "lv-spin" }));
      g.appendChild(svgEl("text", { class: "lv-init" }));
      g.appendChild(svgEl("text", { class: "lv-name" }));
      g.appendChild(svgEl("title"));
      nodeG.appendChild(g);
    }
    const color = safeColor(n.color);
    const live = n.presence === "live" || (n.id !== "hub" && n.active);
    const ghost = n.id !== "hub" && !live;
    g.classList.toggle("lv-live", live);
    g.classList.toggle("lv-ghost", ghost);
    g.classList.toggle("lv-hub", n.id === "hub");
    g.classList.toggle("lv-tiny", n.id !== "hub" && !!n.tiny);
    g.classList.remove("lv-gone");
    g.dataset.tip = n.tip || n.name || "";
    g.querySelector("title").textContent = n.tip || n.name || "";
    const halo = g.querySelector(".lv-halo");
    halo.setAttribute("fill", color);
    const core = g.querySelector(".lv-core");
    core.setAttribute("fill", "#0b1018"); core.setAttribute("stroke", color); core.setAttribute("stroke-width", live ? "2.4" : "1.15");
    const spin = g.querySelector(".lv-spin");
    spin.setAttribute("fill", "none"); spin.setAttribute("stroke", color); spin.setAttribute("stroke-width", "1.35");
    spin.setAttribute("stroke-dasharray", "8 26"); spin.setAttribute("stroke-linecap", "round");
    spin.style.display = live && n.spin ? "" : "none";
    const init = g.querySelector(".lv-init");
    init.setAttribute("fill", color);
    init.textContent = n.initials || "";
    const name = g.querySelector(".lv-name");
    name.setAttribute("fill", ghost ? "#64748b" : "#e2e8f0");
    name.textContent = n.name || "";
    aimNode(g, n.x, n.y, r, reduced);
  }
  nodeG.querySelectorAll("[data-id]").forEach((g) => {
    if (seenN.has(g.getAttribute("data-id"))) return;
    g.classList.add("lv-ghost", "lv-gone");
    g.classList.remove("lv-live");
  });
}
function mountSlot(slot, flow, compact) {
  if (!slot || !flow) return;
  const map = ensureMap(slot, compact);
  bindMap(map);
  syncMap(map, flow);
}

function linksHtml(links) {
  const rows = (links || []).filter((l) => l && l.url && l.rel !== "agent");
  if (!rows.length) return "";
  return `<div class="row small" style="gap:8px;flex-wrap:wrap">${rows.map((l) => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || "Open")}</a>`).join("")}</div>`;
}
function noteHtml() {
  return `<p class="dim small" style="margin:0">${esc(cache?.note || "API chats do not appear in claude.ai, grok.com or ChatGPT history. Watch the work here.")}</p>`;
}
function moneyOf(n) { return money(n || 0, n && Math.abs(n) < 0.01 ? 4 : 2); }
function focusProject(view) {
  if (!view) return null;
  if (selected === "*") return null;
  if (selected && view.projects.some((p) => p.id === selected)) return view.projects.find((p) => p.id === selected);
  const fromBar = S.project && view.projects.find((p) => p.id === S.project);
  if (fromBar) return fromBar;
  return view.projects.find((p) => p.working) || null;
}
function bits(view) {
  const focus = focusProject(view);
  const flow = focus ? focus.flow : view.flow;
  const runs = focus ? focus.runs : view.runs;
  const links = focus ? focus.links : [];
  const handoffs = (runs || []).flatMap((r) => r.handoffs || []);
  return { focus, flow, runs, links, handoffs };
}
function badge(p) {
  if (!p) return "";
  const who = (p.flow?.nodes || []).filter((n) => n.active).map((n) => n.name).join(", ");
  const cred = p.credits ? ` · ${p.credits} credits` : "";
  return `<span class="chip ${p.working ? "green" : ""}">Live</span> ${esc(who || (p.working ? p.step : "idle"))} <span class="mono dim">${moneyOf(p.cost)}${esc(cred)}</span>`;
}
function handoffHtml(list) {
  if (!list?.length) return "";
  const rows = list.map((h) => {
    const open = h.link?.url ? `<a class="btn sm" href="${esc(h.link.url)}" target="_blank" rel="noopener">Open</a>` : "";
    const result = h.status === "reported" && h.result ? `<span class="lv-result">${esc(h.result)}</span>` : "";
    const when = h.sentLabel ? `<span class="dim">Sent ${esc(h.sentLabel)}</span>` : "";
    const note = h.status === "reported" ? "This agent reported back. The result is the text it sent." : h.status === "working" ? "This agent is working. Meldmind is waiting for it to report back." : "Meldmind sent this job. Nothing else is sent until that agent reports back.";
    return `<div class="lv-hand"><span class="chip ${h.status === "working" ? "green" : ""}">${esc(h.name || "")}</span><span class="chip">${esc(h.statusLabel || "")}</span><span class="lv-job">${esc(h.task || "")}</span>${when}${result}${open}<div class="hint" role="note">${esc(note)}</div></div>`;
  }).join("");
  return `<div class="panel lv-hands"><h3>Outside agents</h3><p class="dim small" style="margin:0 0 6px">Sent, working, or reported back. Results can take a few minutes. This page only watches.</p>${rows}</div>`;
}
function captions() {
  return `<div class="lv-captions"><p class="dim small lv-caption lv-caption-live">The bright node is working now. Light along a line is work moving. Idle agents stay on the map, dimmed.</p><p class="dim small lv-caption lv-caption-calm">Motion is reduced. The active agent stays lit, and idle ones stay dim. Moving light is off.</p></div>`;
}

function tutorialsHtml(list) {
  const items = list || [];
  if (!items.length) return "";
  return `<div class="panel" id="lv-tutorials"><h3>Start a project</h3>
    <p class="dim small">These sit on the live map. Watch plays an example. Start opens the real walk. Nothing is sent until you click.</p>
    ${items.map((t) => `<div class="route" style="margin-top:8px">
      <b>${esc(t.name)}</b>
      <ol class="lv-steps">${(t.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="row" style="gap:8px;margin-top:6px">
        <button type="button" class="btn sm" data-watch="${esc(t.id)}">Watch on the map</button>
        <button type="button" class="btn sm primary" data-begin="${esc(t.id)}">Start this project</button>
      </div>
    </div>`).join("")}
  </div>`;
}
function tabInner(view) {
  const { focus, runs, links, handoffs } = bits(view);
  const picks = [`<button class="btn sm ${focus ? "" : "on"}" data-proj="*">All</button>`]
    .concat(view.projects.map((p) => `<button class="btn sm ${focus && focus.id === p.id ? "on" : ""}" data-proj="${esc(p.id)}">${esc(p.name)}</button>`)).join("");
  const cards = view.projects.map((p) => `<div class="panel" data-open="${esc(p.id)}" style="cursor:pointer;border-left:3px solid ${safeColor(p.color)}">
      <div class="row"><b>${esc(p.name)}</b><span class="dim small" style="margin-left:auto">${badge(p)}</span></div>
      <div class="small" style="margin-top:6px">${esc(p.step || "Idle")}</div>
    </div>`).join("");
  const runRows = (runs || []).slice(0, 12).map((r) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px">
      <span class="chip ${r.working ? "green" : ""}">${esc(r.kind || "")}</span>
      <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(r.title || r.step || "")}</span>
      <span class="dim">${esc(r.step || "")}</span>
      <span class="mono dim">${moneyOf(r.cost)}${r.credits ? " · " + esc(String(r.credits)) + " cr" : ""}</span>
    </div>`).join("") || `<div class="dim small">No runs on this view yet. Send orders from Command and they show up here.</div>`;
  return `<div class="lv-wrap">
    <div class="row"><h3 style="margin:0">Live</h3><span class="dim small">who is working, the step, and what it has cost</span></div>
    ${noteHtml()}
    <div class="lv-picks">${picks}</div>
    <div class="lv-stage"><div class="lv-map-slot"></div>${captions()}</div>
    ${tutorialsHtml(view.tutorials)}
    ${linksHtml(links)}
    <p class="dim small" style="margin:0">Open in the service when it has a page for the job.</p>
    ${handoffHtml(handoffs)}
    <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px">${cards || `<div class="dim small">No projects yet.</div>`}</div>
    <div class="panel"><h3>Runs <span class="right">${(runs || []).length}</span></h3>${runRows}</div>
  </div>`;
}
function cmdInner(view) {
  const p = (S.project && view.projects.find((x) => x.id === S.project)) || view.projects.find((x) => x.working) || null;
  const flow = p?.flow || view.flow;
  const active = (flow?.nodes || []).filter((n) => n.active);
  const line = active.length ? active.map((n) => n.tip).join(" · ") : (p ? `${p.name}: ${p.step || "idle"} · ${moneyOf(p.cost)}` : (flow?.summary || "Nobody is working right now."));
  const handLinks = (p?.runs || []).flatMap((r) => r.handoffs || []).filter((h) => h.link?.url);
  const openRow = handLinks.map((h) => `<a class="btn sm" href="${esc(h.link.url)}" target="_blank" rel="noopener" title="${esc(h.name || "Open")}">Open</a>`).join("");
  return `<div class="route" style="margin-top:8px">
    <div class="row small" style="gap:8px"><b>Live</b><span style="flex:1">${esc(line)}</span></div>
    ${linksHtml(p?.links || [])}
    ${openRow ? `<div class="row small" style="gap:8px;margin-top:6px">${openRow}</div>` : ""}
  </div>`;
}
function mountOpsButton() {
  const ops = document.querySelector(".panel.ops");
  if (!ops) return;
  let foot = ops.querySelector(".lv-ops-foot");
  if (!foot) {
    foot = document.createElement("div");
    foot.className = "lv-ops-foot";
    ops.appendChild(foot);
  }
  if (foot.querySelector("#lv-open")) return;
  foot.innerHTML = `<button class="btn sm primary" type="button" id="lv-open">Open live view</button>`;
  foot.querySelector("#lv-open").addEventListener("click", () => { selected = S.project || ""; go("liveview"); });
}
function delivInner(view, runId) {
  const run = (view?.runs || []).find((r) => r.id === runId);
  return `<div style="margin-top:10px">${linksHtml(run?.links || [])}${handoffHtml(run?.handoffs || [])}${noteHtml()}</div>`;
}

function wire(root) {
  if (!root) return;
  root.querySelectorAll("[data-watch]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api(`/walkthrough/example/${encodeURIComponent(b.dataset.watch)}/play`, { method: "POST", body: { immediate: true, experience: window.CC.uiMode?.() || "simple" } });
      toast("Example playing on the map. No AI was called.");
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll("[data-begin]").forEach((b) => b.addEventListener("click", () => window.CC.startProject?.begin?.(b.dataset.begin)));
  root.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => { selected = b.dataset.proj === "*" ? "*" : b.dataset.proj; paint(); }));
  root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { S.view = "projects"; S.openProject = b.dataset.open; window.CC.render(); }));
  mountOpsButton();
}
function paint() {
  if (!cache) return;
  const root = document.getElementById("lv-root");
  if (root) {
    const kept = root.querySelector(".lv-map");
    root.innerHTML = tabInner(cache);
    const slot = root.querySelector(".lv-map-slot");
    if (kept && slot) slot.appendChild(kept);
    mountSlot(slot, bits(cache).flow, false);
    wire(root);
  }
  const cmd = document.getElementById("lv-cmd");
  if (cmd) { cmd.innerHTML = cmdInner(cache); wire(cmd); }
  const del = document.getElementById("lv-deliv");
  if (del) del.innerHTML = delivInner(cache, S.live?.id);
  decorate();
}
function decorate() {
  const view = document.getElementById("view");
  if (!cache || S.view !== "projects" || !view) return;
  if (S.openProject) {
    const p = cache.projects.find((x) => x.id === S.openProject);
    const header = view.querySelector(":scope > .row");
    if (!p || !header) return;
    let d = view.querySelector(":scope > .lv-inject");
    if (!d || d.dataset.project !== p.id) {
      view.querySelectorAll(":scope > .lv-inject").forEach((n) => n.remove());
      d = document.createElement("div");
      d.className = "lv-inject";
      d.dataset.project = p.id;
      d.style.margin = "0 0 14px";
      header.insertAdjacentElement("afterend", d);
    }
    const kept = d.querySelector(".lv-map");
    d.innerHTML = `<div class="lv-stage"><div class="lv-map-slot"></div>${captions()}</div>${linksHtml(p.links)}<div style="margin-top:8px">${handoffHtml(p.runs?.flatMap((r) => r.handoffs || []) || [])}</div><div style="margin-top:8px">${noteHtml()}</div><p class="dim small" style="margin:8px 0 0">Open in the service when it has a page for the job.</p>`;
    const slot = d.querySelector(".lv-map-slot");
    if (kept && slot) slot.appendChild(kept);
    mountSlot(slot, p.flow, false);
    return;
  }
  view.querySelectorAll(".pcard").forEach((card) => {
    const p = cache.projects.find((x) => x.id === card.dataset.id);
    if (!p) return;
    let line = card.querySelector(":scope > .lv-inject");
    if (!line) {
      line = document.createElement("div");
      line.className = "lv-inject small";
      line.style.marginTop = "8px";
      card.appendChild(line);
    }
    line.innerHTML = badge(p);
  });
}
function watchView() {
  const view = document.getElementById("view");
  if (!view || view.dataset.lvWatch) return;
  view.dataset.lvWatch = "1";
  new MutationObserver(() => scheduleDecorate()).observe(view, { childList: true });
}
watchView();
let decorTimer = 0;
function scheduleDecorate() { clearTimeout(decorTimer); decorTimer = setTimeout(decorate, 0); }
function ensure() {
  if (cache || loading) return;
  loading = true;
  const q = motionReduced() ? "?motion=reduce" : "";
  api("/liveview" + q).then((v) => { cache = v; loading = false; paint(); }).catch(() => { loading = false; });
}

CC.register({
  id: "liveview",
  tab: { label: "Live", short: "Live", icon: "◉", order: 12, render(view) {
    view.innerHTML = `<div id="lv-root"><div class="empty">Loading the live view…</div></div>`;
    const q = motionReduced() ? "?motion=reduce" : "";
    api("/liveview" + q).then((v) => {
      cache = v;
      const root = document.getElementById("lv-root");
      if (!root) return;
      root.innerHTML = tabInner(v);
      mountSlot(root.querySelector(".lv-map-slot"), bits(v).flow, false);
      wire(root);
    }).catch((e) => { const root = document.getElementById("lv-root"); if (root) root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  } },
  command: { order: 8, render(el) {
    el.innerHTML = `<div id="lv-cmd"></div>`;
    mountOpsButton();
    if (cache) { const box = el.querySelector("#lv-cmd"); box.innerHTML = cmdInner(cache); wire(box); }
    else ensure();
  } },
  deliverable: { order: 12, render(el) {
    el.id = "lv-deliv";
    el.innerHTML = delivInner(cache, S.live?.id);
    if (!cache) ensure();
  } },
  onEvent(ev) {
    if (ev.type === "liveview.update" && ev.view) {
      const tutorials = ev.view.tutorials || cache?.tutorials;
      cache = tutorials ? { ...ev.view, tutorials } : ev.view;
      paint();
    }
  },
  onState() { scheduleDecorate(); ensure(); },
});
