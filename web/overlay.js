// Headline text on a picture, drawn with the page's canvas (0.4.21). The server does PNG pictures itself
// (server/overlay.js); a JPEG or WebP picture is drawn here and the finished PNG is saved through
// POST /api/dogfood/overlay/save. Same layout as the server so both look alike.
export function layoutLines(measure, text, px, maxW, maxLines = 4) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const wrap = (size) => {
    const lines = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (measure(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur);
    return lines;
  };
  let size = px, lines = wrap(size);
  const min = Math.round(px * 0.42);
  while ((lines.length > maxLines || lines.some((l) => measure(l, size) > maxW)) && size > min) { size = Math.round(size * 0.92); lines = wrap(size); }
  return { lines: lines.slice(0, maxLines), px: size };
}

// img: a loaded HTMLImageElement or ImageBitmap. Returns a PNG data address.
export function headlineDataUrl(img, text, { position = "bottom", color = "#ffffff", doc = document } = {}) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = doc.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, h);
  const margin = Math.round(w * 0.07);
  const family = `800 {px}px Montserrat, "Segoe UI", Arial, sans-serif`;
  const measure = (t, size) => { g.font = family.replace("{px}", size); return g.measureText(t).width; };
  const { lines, px } = layoutLines(measure, text, Math.round(w * 0.095), w - margin * 2);
  const lead = Math.round(px * 1.18), block = lines.length * lead;
  const top = position === "top" ? margin : position === "center" ? Math.round((h - block) / 2) : h - margin - block;
  const pad = Math.round(px * 1.3);
  const grad = g.createLinearGradient(0, top - pad, 0, top + block + pad);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.3, "rgba(0,0,0,.62)"); grad.addColorStop(0.7, "rgba(0,0,0,.62)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.fillRect(0, Math.max(0, top - pad), w, Math.min(h, block + pad * 2));
  g.font = family.replace("{px}", px); g.textBaseline = "top"; g.textAlign = "center";
  lines.forEach((l, i) => {
    g.fillStyle = "rgba(0,0,0,.55)"; g.fillText(l, w / 2 + Math.max(1, px * 0.03), top + i * lead + Math.max(1, px * 0.03));
    g.fillStyle = color; g.fillText(l, w / 2, top + i * lead);
  });
  return c.toDataURL("image/png");
}
