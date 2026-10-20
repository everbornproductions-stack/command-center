// Live ops graph: a hub (Meldmind) in the centre, every AI around it.
// At rest, bubble size follows each AI's share of jobs in the last 30 days.
// During a run, AIs in that run grow (the busiest the largest) and the others shrink.
// Nodes glow while an AI works, and a particle travels along an edge when one AI hands work to another.
import { ringPositions, bubbleScales, isTiny, easeOutCubic, layoutBubbles, SIZE_MS, USAGE_MAX } from "./graph-usage.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

const STYLE_ID = "cc-graph-usage-style";
const STYLE = `
.node .node-name { transition: opacity .35s ease; }
.node.tiny .node-name { opacity: 0; }
.node.tiny:hover .node-name, .node.tiny:focus .node-name { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .node .node-name { transition: none; }
}
`;

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export class AgentGraph {
  constructor(container) {
    ensureStyle();
    this.container = container;
    this.svg = el("svg", { viewBox: "0 0 800 340", preserveAspectRatio: "xMidYMid meet" });
    container.appendChild(this.svg);
    this.defs = el("defs");
    this.svg.appendChild(this.defs);
    const glow = el("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
    glow.innerHTML = `<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>`;
    this.defs.appendChild(glow);
    this.gEdges = el("g"); this.gHot = el("g"); this.gNodes = el("g"); this.gParticles = el("g");
    this.svg.append(this.gEdges, this.gHot, this.gNodes, this.gParticles);
    this.nodes = new Map();
    this.hub = { x: 400, y: 170 };
    this.active = new Map(); // providerId -> count
    this.counts = null;
    this.runLive = false;
    this.runCounts = {};
    this.runActive = [];
    this.fit = 1;
    this._raf = 0;
    this.drawHub();
  }
  reduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch { return false; }
  }
  drawHub() {
    const g = el("g", { class: "hub" });
    g.append(el("circle", { cx: this.hub.x, cy: this.hub.y, r: 46, class: "hub-ring" }));
    g.append(el("circle", { cx: this.hub.x, cy: this.hub.y, r: 30, fill: "#0b1622", stroke: "#22d3ee", "stroke-width": 1.5, filter: "url(#glow)" }));
    const t = el("text", { x: this.hub.x, y: this.hub.y + 4, class: "node-label", "font-size": "9" }); t.textContent = "MELDMIND"; t.setAttribute("fill", "#67e8f9");
    g.append(t);
    this.hubG = g;
    this.gNodes.appendChild(g);
  }
  setProviders(list) {
    // text providers inner ring, media/tools outer arc at the bottom
    const text = list.filter((p) => p.kind === "text");
    const media = list.filter((p) => p.kind !== "text");
    this.gEdges.innerHTML = ""; this.gNodes.innerHTML = ""; this.nodes.clear(); this.drawHub();
    const textNodes = ringPositions(text, { hx: this.hub.x, hy: this.hub.y, rx: 300, ry: 118, start: Math.PI * 1.08, end: Math.PI * 1.92 });
    const mediaNodes = ringPositions(media, { hx: this.hub.x, hy: this.hub.y, rx: 330, ry: 140, start: Math.PI * 0.12, end: Math.PI * 0.88 });
    for (const p of textNodes) this.addNode(p, p.x, p.y, 22, "text");
    for (const p of mediaNodes) this.addNode(p, p.x, p.y, 15, "media");
    if (this.counts) this.setUsage(this.counts);
  }
  addNode(p, x, y, r, cls) {
    const edge = el("path", { d: `M${this.hub.x},${this.hub.y} L${x},${y}`, class: "edge" });
    this.gEdges.appendChild(edge);
    const g = el("g", { class: `node ${cls}`, "data-id": p.id, tabindex: "0", style: "cursor:pointer" });
    const title = el("title"); title.textContent = p.name;
    const halo = el("circle", { cx: x, cy: y, r: r + 8, fill: p.color, opacity: 0 });
    const circ = el("circle", { cx: x, cy: y, r, fill: "#0d1420", stroke: p.color, "stroke-width": 1.5 });
    const light = el("circle", { cx: x + r * 0.72, cy: y - r * 0.72, r: 4, fill: "#4b5563", stroke: "#0b0f17", "stroke-width": 1.5 });
    const initial = el("text", { x, y: y + 4, class: "node-label" }); initial.textContent = p.name.slice(0, 2).toUpperCase(); initial.setAttribute("fill", p.color);
    const label = el("text", { x, y: y + r + 13, class: "node-label node-name" }); label.textContent = p.name;
    const sub = el("text", { x, y: y + r + 24, class: "node-sub" }); sub.textContent = "";
    g.append(title, halo, circ, light, initial, label, sub);
    g.addEventListener("click", () => this.onNodeClick?.(p.id));
    this.gNodes.appendChild(g);
    const node = {
      id: p.id, name: p.name, x, y, homeX: x, homeY: y, baseR: r, r,
      sx: x, sy: y, sr: r, ax: x, ay: y, ar: r, wantX: x, wantY: y, wantR: r, t0: 0,
      usage: 1, tiny: false, seen: false, color: p.color, g, halo, circ, light, initial, label, sub, edge,
    };
    this.nodes.set(p.id, node);
    this.setStatus(p.id, p.status?.status || "grey");
  }
  setUsage(counts, run) {
    this.counts = counts || {};
    if (run) {
      this.runLive = !!run.live;
      this.runCounts = { ...(run.runCounts || {}) };
      this.runActive = run.activeIds || [];
    }
    this.syncScales();
    this.relayout();
  }
  syncScales() {
    const ids = [...this.nodes.keys()];
    const frame = bubbleScales(ids, this.counts || {}, {
      live: !!this.runLive,
      runCounts: this.runCounts,
      activeIds: this.runActive,
    });
    this.peak = frame.peak;
    this.runLive = frame.live;
    for (const id of ids) {
      const n = this.nodes.get(id);
      n.usage = frame.scales[id];
      n.tiny = isTiny(n.usage, frame.peak);
    }
  }
  relayout() {
    // Reserve the large size so a run can grow a bubble without covering its neighbours.
    const items = [...this.nodes.values()].map((n) => ({
      id: n.id, x: n.homeX, y: n.homeY,
      r: n.baseR * USAGE_MAX,
      tail: (n.usage ?? 1) < 1 ? 2 : 16,
    }));
    items.push({ id: "hub", x: this.hub.x, y: this.hub.y, r: 36, pin: true, tail: 0 });
    const placed = layoutBubbles(items, { width: 800, height: 340, pad: 8, margin: 8 });
    const by = new Map(placed.map((p) => [p.id, p]));
    this.fit = placed.find((p) => !p.pin)?.fit ?? placed[0]?.fit ?? 1;
    for (const n of this.nodes.values()) {
      const p = by.get(n.id);
      if (!p) continue;
      n.tx = p.x; n.ty = p.y;
    }
    this.aim(true);
  }
  aim(move) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const reduced = this.reduced();
    let changed = false;
    for (const [id, n] of this.nodes) {
      const targetR = n.baseR * (n.usage ?? 1) * (this.fit || 1);
      const targetX = n.tx ?? n.homeX;
      const targetY = n.ty ?? n.homeY;
      if (reduced || !n.seen) {
        n.sx = targetX; n.sy = targetY; n.sr = targetR; n.seen = true;
        n.ax = targetX; n.ay = targetY; n.ar = targetR; n.t0 = now - SIZE_MS;
      } else if (Math.abs(n.sr - targetR) > 0.05 || (move && (Math.abs(n.sx - targetX) > 0.4 || Math.abs(n.sy - targetY) > 0.4))) {
        n.ax = n.sx; n.ay = n.sy; n.ar = n.sr; n.t0 = now;
        changed = true;
      }
      n.wantX = targetX; n.wantY = targetY; n.wantR = targetR;
      n.g.classList.toggle("tiny", !!n.tiny);
      const tip = n.name + (n.tiny ? (this.runLive ? " (not in this run)" : " (rarely used)") : "");
      const title = n.g.querySelector("title");
      if (title) title.textContent = tip;
    }
    this.paint();
    if (changed && !reduced) this.kick();
  }
  paint() {
    for (const n of this.nodes.values()) {
      const r = n.sr;
      n.r = r;
      n.x = n.sx; n.y = n.sy;
      n.halo.setAttribute("cx", n.sx); n.halo.setAttribute("cy", n.sy); n.halo.setAttribute("r", r + 8);
      n.circ.setAttribute("cx", n.sx); n.circ.setAttribute("cy", n.sy); n.circ.setAttribute("r", r);
      n.light.setAttribute("cx", n.sx + r * 0.72); n.light.setAttribute("cy", n.sy - r * 0.72);
      n.light.setAttribute("r", Math.max(2.5, Math.min(4.5, r * 0.18)));
      n.initial.setAttribute("x", n.sx); n.initial.setAttribute("y", n.sy + 4);
      n.initial.setAttribute("font-size", String(Math.max(8, Math.min(11, r * 0.62))));
      n.label.setAttribute("x", n.sx); n.label.setAttribute("y", n.sy + r + 13);
      n.sub.setAttribute("x", n.sx); n.sub.setAttribute("y", n.sy + r + 24);
      n.edge.setAttribute("d", `M${this.hub.x},${this.hub.y} L${n.sx},${n.sy}`);
      if (n.spinner) {
        n.spinner.setAttribute("cx", n.sx); n.spinner.setAttribute("cy", n.sy); n.spinner.setAttribute("r", r + 4);
        const anim = n.spinner.querySelector("animateTransform");
        if (anim) { anim.setAttribute("from", `0 ${n.sx} ${n.sy}`); anim.setAttribute("to", `360 ${n.sx} ${n.sy}`); }
      }
    }
  }
  kick() {
    if (this._raf) return;
    const step = (now) => {
      let moving = false;
      const reduced = this.reduced();
      for (const n of this.nodes.values()) {
        const t = (now - n.t0) / SIZE_MS;
        if (reduced || t >= 1) {
          n.sx = n.wantX; n.sy = n.wantY; n.sr = n.wantR;
        } else {
          const k = easeOutCubic(t);
          n.sx = n.ax + (n.wantX - n.ax) * k;
          n.sy = n.ay + (n.wantY - n.ay) * k;
          n.sr = n.ar + (n.wantR - n.ar) * k;
          moving = true;
        }
      }
      this.paint();
      this._raf = moving ? requestAnimationFrame(step) : 0;
    };
    this._raf = requestAnimationFrame(step);
  }
  setStatus(id, status) {
    const n = this.nodes.get(id); if (!n) return;
    const c = { green: "#34d399", amber: "#fbbf24", red: "#f87171", grey: "#4b5563" }[status] || "#4b5563";
    n.light.setAttribute("fill", c);
    n.light.setAttribute("filter", status === "grey" ? "" : "url(#glow)");
    n.circ.setAttribute("opacity", status === "grey" ? 0.45 : 1);
  }
  activate(id, label) {
    const n = this.nodes.get(id); if (!n) return;
    this.active.set(id, (this.active.get(id) || 0) + 1);
    n.halo.setAttribute("opacity", 0.22);
    n.circ.setAttribute("filter", "url(#glow)");
    n.circ.setAttribute("stroke-width", 2.5);
    n.edge.classList.add("hot"); n.edge.setAttribute("stroke", n.color);
    n.sub.textContent = (label || "working").slice(0, 26);
    this.spin(n);
    this.runActive = [...this.active.entries()].filter(([, c]) => c > 0).map(([k]) => k);
    this.runLive = this.runActive.length > 0;
    this.syncScales();
    this.aim(false);
  }
  deactivate(id, label) {
    const n = this.nodes.get(id); if (!n) return;
    const c = Math.max(0, (this.active.get(id) || 1) - 1);
    this.active.set(id, c);
    if (c === 0) {
      n.halo.setAttribute("opacity", 0);
      n.circ.removeAttribute("filter");
      n.circ.setAttribute("stroke-width", 1.5);
      n.edge.classList.remove("hot"); n.edge.removeAttribute("stroke");
      n.sub.textContent = label ? label.slice(0, 26) : "";
      n.spinner?.remove(); n.spinner = null;
    }
    this.runActive = [...this.active.entries()].filter(([, c]) => c > 0).map(([k]) => k);
    this.runLive = this.runActive.length > 0;
    this.syncScales();
    this.aim(false);
  }
  spin(n) {
    if (n.spinner) return;
    const arc = el("circle", { cx: n.sx, cy: n.sy, r: n.sr + 4, fill: "none", stroke: n.color, "stroke-width": 1.5, "stroke-dasharray": "18 40", "stroke-linecap": "round" });
    if (!this.reduced()) {
      const anim = el("animateTransform", { attributeName: "transform", type: "rotate", from: `0 ${n.sx} ${n.sy}`, to: `360 ${n.sx} ${n.sy}`, dur: "1.6s", repeatCount: "indefinite" });
      arc.appendChild(anim);
    }
    n.g.appendChild(arc);
    n.spinner = arc;
  }
  // a particle travelling from one AI to another (through a curve), or to/from the hub
  pulse(from, to, text) {
    const a = from === "hub" ? this.hub : this.nodes.get(from);
    const b = to === "hub" ? this.hub : this.nodes.get(to);
    if (!a || !b) return;
    const ax = a.sx ?? a.x, ay = a.sy ?? a.y, bx = b.sx ?? b.x, by = b.sy ?? b.y;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(60, len * 0.25);
    const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
    const d = `M${ax},${ay} Q${cx},${cy} ${bx},${by}`;
    const color = (from !== "hub" && a.color) || (b.color) || "#22d3ee";
    const path = el("path", { d, class: "edge hot", stroke: color, "stroke-dasharray": "4 6", opacity: 0.8 });
    this.gHot.appendChild(path);
    const dot = el("circle", { r: 4, fill: color, filter: "url(#glow)" });
    const mv = el("animateMotion", { dur: "1.1s", repeatCount: 1, path: d });
    dot.appendChild(mv);
    this.gParticles.appendChild(dot);
    if (text) {
      const t = el("text", { x: cx, y: cy - 6, class: "node-sub" }); t.textContent = text.slice(0, 28); t.setAttribute("fill", color);
      this.gParticles.appendChild(t);
      setTimeout(() => t.remove(), 1800);
    }
    setTimeout(() => { dot.remove(); path.remove(); }, 1600);
  }
  resetAll() {
    this.runCounts = {};
    this.runActive = [];
    this.runLive = false;
    for (const [id] of this.nodes) { this.active.set(id, 1); this.deactivate(id); }
  }
}
