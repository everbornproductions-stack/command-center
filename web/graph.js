// Live ops graph: a hub (Command) in the centre, every AI around it. Nodes glow while an AI works,
// and a particle travels along an edge whenever one AI hands something to another.
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

export class AgentGraph {
  constructor(container) {
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
    this.drawHub();
  }
  drawHub() {
    const g = el("g", { class: "hub" });
    g.append(el("circle", { cx: this.hub.x, cy: this.hub.y, r: 46, class: "hub-ring" }));
    g.append(el("circle", { cx: this.hub.x, cy: this.hub.y, r: 30, fill: "#0b1622", stroke: "#22d3ee", "stroke-width": 1.5, filter: "url(#glow)" }));
    const t = el("text", { x: this.hub.x, y: this.hub.y + 4, class: "node-label" }); t.textContent = "COMMAND"; t.setAttribute("fill", "#67e8f9");
    g.append(t);
    this.hubG = g;
    this.gNodes.appendChild(g);
  }
  setProviders(list) {
    // text providers inner ring, media/tools outer arc at the bottom
    const text = list.filter((p) => p.kind === "text");
    const media = list.filter((p) => p.kind !== "text");
    this.gEdges.innerHTML = ""; this.gNodes.innerHTML = ""; this.nodes.clear(); this.drawHub();
    const place = (arr, rx, ry, start, end, r, cls) => {
      arr.forEach((p, i) => {
        const a = arr.length === 1 ? (start + end) / 2 : start + ((end - start) * i) / (arr.length - 1);
        const x = this.hub.x + rx * Math.cos(a), y = this.hub.y + ry * Math.sin(a);
        this.addNode(p, x, y, r, cls);
      });
    };
    place(text, 300, 118, Math.PI * 1.08, Math.PI * 1.92, 22, "text");
    place(media, 330, 140, Math.PI * 0.12, Math.PI * 0.88, 15, "media");
  }
  addNode(p, x, y, r, cls) {
    const edge = el("path", { d: `M${this.hub.x},${this.hub.y} L${x},${y}`, class: "edge" });
    this.gEdges.appendChild(edge);
    const g = el("g", { class: `node ${cls}`, "data-id": p.id, style: "cursor:pointer" });
    const halo = el("circle", { cx: x, cy: y, r: r + 8, fill: p.color, opacity: 0 });
    const circ = el("circle", { cx: x, cy: y, r, fill: "#0d1420", stroke: p.color, "stroke-width": 1.5 });
    const light = el("circle", { cx: x + r * 0.72, cy: y - r * 0.72, r: 4, fill: "#4b5563", stroke: "#0b0f17", "stroke-width": 1.5 });
    const initial = el("text", { x, y: y + 4, class: "node-label" }); initial.textContent = p.name.slice(0, 2).toUpperCase(); initial.setAttribute("fill", p.color);
    const label = el("text", { x, y: y + r + 13, class: "node-label" }); label.textContent = p.name;
    const sub = el("text", { x, y: y + r + 24, class: "node-sub" }); sub.textContent = "";
    g.append(halo, circ, light, initial, label, sub);
    g.addEventListener("click", () => this.onNodeClick?.(p.id));
    this.gNodes.appendChild(g);
    this.nodes.set(p.id, { x, y, r, color: p.color, g, halo, circ, light, sub, edge });
    this.setStatus(p.id, p.status?.status || "grey");
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
  }
  spin(n) {
    if (n.spinner) return;
    const arc = el("circle", { cx: n.x, cy: n.y, r: n.r + 4, fill: "none", stroke: n.color, "stroke-width": 1.5, "stroke-dasharray": "18 40", "stroke-linecap": "round" });
    const anim = el("animateTransform", { attributeName: "transform", type: "rotate", from: `0 ${n.x} ${n.y}`, to: `360 ${n.x} ${n.y}`, dur: "1.6s", repeatCount: "indefinite" });
    arc.appendChild(anim);
    n.g.appendChild(arc);
    n.spinner = arc;
  }
  // a particle travelling from one AI to another (through a curve), or to/from the hub
  pulse(from, to, text) {
    const a = from === "hub" ? this.hub : this.nodes.get(from);
    const b = to === "hub" ? this.hub : this.nodes.get(to);
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(60, len * 0.25);
    const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
    const d = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
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
    for (const [id] of this.nodes) { this.active.set(id, 1); this.deactivate(id); }
  }
}
