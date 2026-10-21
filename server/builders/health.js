// Page checks in the shape of a Lighthouse pass. Lighthouse itself is not started.
// Tests and the app both use this. Nothing here opens a network or a browser.

export const SAMPLE_HEALTH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<h1>Sample page</h1>
<p>A starter page so you can try Fix it.</p>
<img src="logo.png">
</body>
</html>
`;

export const SAMPLE_SEO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home</title>
<meta name="description" content="Page">
</head>
<body>
<h1>Home</h1>
<p>Tell people what this page is.</p>
</body>
</html>
`;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPage({ name, about, page, audience }) {
  const title = `${name} | ${page}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(about)}">
</head>
<body>
<h1>${escapeHtml(name)}</h1>
<p>${escapeHtml(about)}</p>
<p>For ${escapeHtml(audience || "visitors")}.</p>
</body>
</html>
`;
}

export function checkPage(html, pageIndex = 0) {
  const src = String(html || "");
  const issues = [];
  const id = (kind) => `${kind}:${pageIndex}`;
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(src)) {
    issues.push({ id: id("title"), kind: "title", pageIndex, title: "Add a page title", detail: "The page has no title.", blocking: true, fixable: true });
  }
  if (!/name=["']description["']/i.test(src)) {
    issues.push({ id: id("meta"), kind: "meta", pageIndex, title: "Add a short description", detail: "The page has no description.", blocking: true, fixable: true });
  }
  if (!/<html[^>]*\blang=/i.test(src)) {
    issues.push({ id: id("lang"), kind: "lang", pageIndex, title: "Set the page language", detail: "The page does not say which language it is.", blocking: true, fixable: true });
  }
  if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(src)) {
    issues.push({ id: id("alt"), kind: "alt", pageIndex, title: "Describe the image", detail: "An image has no text alternative.", blocking: true, fixable: true });
  }
  if (!/<h1[\s>]/i.test(src)) {
    issues.push({ id: id("h1"), kind: "h1", pageIndex, title: "Add a heading", detail: "The page has no main heading.", blocking: true, fixable: true });
  }
  return issues;
}

export function scoresFor(issues) {
  const kinds = new Set(["title", "meta", "lang", "alt", "h1"]);
  const n = (issues || []).filter((issue) => kinds.has(issue.kind)).length;
  const score = Math.max(0, 100 - n * 15);
  return { performance: score, accessibility: score, seo: score, bestPractices: score };
}

export function seoExtras(html, input = {}) {
  const src = String(html || "");
  const title = ((src.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const meta = ((src.match(/name=["']description["'][^>]*content=["']([^"']*)["']/i) || src.match(/content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || "").trim();
  const rewriteTitle = `${input.name || "My business"} | ${input.about || "What we do"}`.replace(/\s+/g, " ").trim().slice(0, 60);
  const rewriteMeta = String(input.about || "What we do, in one or two sentences.").replace(/\s+/g, " ").trim().slice(0, 160);
  const issues = [];
  if (title.length < 12 || /^home$/i.test(title)) {
    issues.push({
      id: "seo-title", kind: "seo-title", pageIndex: 0, title: "Rewrite the page title",
      detail: `Prepared title: ${rewriteTitle}`, blocking: true, fixable: true, rewrite: rewriteTitle,
    });
  }
  if (meta.length < 20) {
    issues.push({
      id: "seo-meta", kind: "seo-meta", pageIndex: 0, title: "Rewrite the description",
      detail: `Prepared description: ${rewriteMeta}`, blocking: true, fixable: true, rewrite: rewriteMeta,
    });
  }
  return { issues, rewriteTitle, rewriteMeta, note: "Prepared here for the AI named in the preview. Nothing was sent." };
}

export function applyPageFix(html, kind, ctx = {}) {
  const title = escapeHtml(ctx.title || "Home");
  const desc = escapeHtml(ctx.description || ctx.about || "A page");
  const alt = escapeHtml(ctx.alt || "Image");
  let out = String(html || "");
  if (kind === "title" || kind === "seo-title") {
    if (/<title>[\s\S]*?<\/title>/i.test(out)) out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
    else if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}<title>${title}</title>`);
    else out = `<title>${title}</title>\n${out}`;
  } else if (kind === "meta" || kind === "seo-meta") {
    const tag = `<meta name="description" content="${desc}">`;
    if (/name=["']description["']/i.test(out)) out = out.replace(/<meta[^>]*name=["']description["'][^>]*>/i, tag);
    else if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
    else out = `${tag}\n${out}`;
  } else if (kind === "lang") {
    if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html([^>]*)>/i, (m, attrs) => (/\blang=/.test(attrs) ? m : `<html lang="en"${attrs}>`));
    } else out = `<html lang="en">\n${out}`;
  } else if (kind === "alt") {
    out = out.replace(/<img\b([^>]*?)>/gi, (m, attrs) => (/\balt=/.test(attrs) ? m : `<img${attrs} alt="${alt}">`));
  } else if (kind === "h1") {
    if (!/<h1[\s>]/i.test(out)) {
      if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${m}<h1>${title}</h1>`);
      else out += `<h1>${title}</h1>`;
    }
  }
  return out;
}
