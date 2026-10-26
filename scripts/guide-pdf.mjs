// The downloadable "What Meldmind can do" guide.
// Pages come from web/features/guide.js, the same list as the tour.
import fs from "node:fs";
import PDFDocument from "pdfkit";
import { PLAN, guidePages } from "../web/features/guide.js";

const NAVY = "#0c1424";
const INK = "#142033";
const MUTED = "#5c6b7a";
const CYAN = "#0e7490";
const CYAN_BRIGHT = "#22d3ee";
const PAPER = "#f4f7fb";
const WHITE = "#ffffff";
const LINE = "#d7e0ea";
const CARD = "#ffffff";

const BADGE = {
  free: { bg: "#d1fae5", fg: "#065f46", label: "Free" },
  pro: { bg: "#cffafe", fg: "#155e75", label: "Pro" },
  extreme: { bg: "#fef3c7", fg: "#92400e", label: "Extreme" },
};

const W = 612;
const H = 792;
const M = 48;

function badgeLabel(page) {
  if (page.tier === "free") return "Free";
  return `${page.tierLabel}  ${page.price}`;
}

function drawBadge(doc, x, y, tier, text) {
  const look = BADGE[tier] || BADGE.free;
  doc.font("Helvetica-Bold").fontSize(9);
  const label = text || look.label;
  const w = doc.widthOfString(label) + 16;
  doc.roundedRect(x, y, w, 18, 9).fill(look.bg);
  doc.fillColor(look.fg).text(label, x + 8, y + 4, { lineBreak: false, width: w });
  return w;
}

function footer(doc, meta, pageNo, pages) {
  doc.save();
  doc.strokeColor(LINE).moveTo(M, H - 36).lineTo(W - M, H - 36).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text("Meldmind", M, H - 26, { lineBreak: false });
  doc.text("an Everborn product", M + 70, H - 26, { lineBreak: false });
  doc.text(`Version ${meta.version}`, W / 2 - 30, H - 26, { lineBreak: false });
  doc.text(`${pageNo} / ${pages}`, W - M - 36, H - 26, { lineBreak: false });
  doc.restore();
}

function innerHeader(doc) {
  doc.rect(0, 0, W, 8).fill(CYAN_BRIGHT);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text("MELDMIND", M, 22, { lineBreak: false, characterSpacing: 1.2 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("an Everborn product", M + 92, 22, { lineBreak: false, characterSpacing: 0 });
  doc.strokeColor(LINE).moveTo(M, 40).lineTo(W - M, 40).stroke();
}

function cover(doc, meta) {
  doc.rect(0, 0, W, H).fill(NAVY);
  doc.rect(0, 0, 12, H).fill(CYAN_BRIGHT);
  doc.circle(M + 8, 78, 8).fill(CYAN_BRIGHT);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(WHITE).text("MELDMIND", M + 26, 72, { lineBreak: false, characterSpacing: 2.4 });
  doc.font("Helvetica").fontSize(11).fillColor(CYAN_BRIGHT).text("an Everborn product", M, 108, { characterSpacing: 0 });
  doc.font("Helvetica").fontSize(11).fillColor("#8b95a7").text("GUIDE", M, 210, { characterSpacing: 2 });
  doc.font("Helvetica-Bold").fontSize(36).fillColor(WHITE).text("What Meldmind\ncan do", M, 232, { width: W - M * 2, lineGap: 2, characterSpacing: 0 });
  doc.font("Helvetica").fontSize(13).fillColor("#c5d0dc").text("One hub for your AIs. A short guide to what is in this app, and how to start each part.", M, 340, { width: 420, lineGap: 3 });
  doc.rect(M, 430, 72, 3).fill(CYAN_BRIGHT);
  doc.font("Helvetica").fontSize(11).fillColor("#8b95a7").text("Plan prices. This guide does not charge you. Adding a licence happens on the Subscriptions page.", M, 460, { width: 420 });
  doc.font("Helvetica").fontSize(10).fillColor("#8b95a7").text("Version", M, H - 92, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(WHITE).text(meta.version, M, H - 74, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor("#8b95a7").text("Date", M + 140, H - 92, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(WHITE).text(meta.date, M + 140, H - 74, { lineBreak: false });
}

function overview(doc, pages, meta) {
  doc.rect(0, 0, W, H).fill(PAPER);
  innerHeader(doc);
  doc.font("Helvetica").fontSize(10).fillColor(CYAN).text("Overview", M, 54, { characterSpacing: 1 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text("Everything in one look", M, 70, { characterSpacing: 0 });
  doc.font("Helvetica").fontSize(11).fillColor(INK).text("Meldmind is one place for the AIs you already use. It picks the best one for each task and learns from you. The rows below are the parts in this app. Each later page is one of them, with plain steps and how to start.", M, 104, { width: W - M * 2, lineGap: 2 });

  const plans = [PLAN.free, PLAN.pro, PLAN.extreme];
  const gap = 12;
  const boxW = (W - M * 2 - gap * 2) / 3;
  const boxY = 176;
  plans.forEach((plan, i) => {
    const x = M + i * (boxW + gap);
    doc.roundedRect(x, boxY, boxW, 58, 8).fill(CARD);
    doc.roundedRect(x, boxY, boxW, 58, 8).lineWidth(1).strokeColor(LINE).stroke();
    drawBadge(doc, x + 12, boxY + 10, plan.id, plan.label);
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(plan.price, x + 12, boxY + 34, { lineBreak: false, width: boxW - 20 });
  });

  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Version ${meta.version}   |   ${meta.date}   |   Only pages that are in this app.`, M, 240, { width: W - M * 2 });

  let y = 262;
  const listBottom = H - 78;
  pages.forEach((page, i) => {
    const bodyH = doc.font("Helvetica").fontSize(10).heightOfString(page.body, { width: W - M * 2 - 150 });
    const rowH = Math.max(32, bodyH + 14);
    if (y + rowH > listBottom) throw new Error("The overview does not fit on one page.");
    doc.roundedRect(M, y, W - M * 2, rowH, 6).fill(CARD);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(CYAN).text(String(i + 1).padStart(2, "0"), M + 10, y + 8, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(page.title, M + 40, y + 7, { lineBreak: false, width: 280 });
    const look = BADGE[page.tier] || BADGE.free;
    doc.font("Helvetica-Bold").fontSize(8);
    const pill = look.label;
    const pw = doc.widthOfString(pill) + 12;
    doc.roundedRect(W - M - pw - 10, y + 8, pw, 14, 7).fill(look.bg);
    doc.fillColor(look.fg).text(pill, W - M - pw - 4, y + 11, { lineBreak: false });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(page.body, M + 40, y + 22, { width: W - M * 2 - 150 });
    y += rowH + 4;
  });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text("Each page after this one is one area: the steps, the plan, and how to start.", M, H - 64, { width: W - M * 2 });
  footer(doc, meta, 2, pages.length + 2);
}

function section(doc, page, index, total, meta) {
  doc.rect(0, 0, W, H).fill(PAPER);
  innerHeader(doc);
  doc.font("Helvetica").fontSize(10).fillColor(CYAN).text(String(index).padStart(2, "0"), M, 54, { characterSpacing: 1 });
  doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(page.title, M, 70, { width: W - M * 2 - 20, characterSpacing: 0 });
  const titleH = doc.heightOfString(page.title, { width: W - M * 2 - 20 });
  let y = 70 + titleH + 10;
  const pillW = drawBadge(doc, M, y, page.tier, badgeLabel(page));
  if (page.priceNote) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(page.priceNote, M + pillW + 10, y + 4, { width: W - M * 2 - pillW - 16 });
  }
  y += 32;
  doc.font("Helvetica").fontSize(12).fillColor(INK).text(page.body, M, y, { width: W - M * 2, lineGap: 2 });
  y = doc.y + 8;
  const names = page.parts.map((p) => p.name).join(", ");
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`In this app: ${names}.`, M, y, { width: W - M * 2 });
  y = doc.y + 16;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Steps", M, y);
  y = doc.y + 8;
  page.steps.forEach((step, n) => {
    doc.circle(M + 9, y + 8, 9).fill(CYAN);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(WHITE).text(String(n + 1), M + 4, y + 4, { width: 12, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(step, M + 28, y + 1, { width: W - M * 2 - 28 });
    y = doc.y + 8;
  });

  const startH = doc.font("Helvetica").fontSize(11).heightOfString(page.start, { width: W - M * 2 - 28 });
  const boxH = startH + 36;
  const boxY = H - 56 - boxH;
  if (y + 8 > boxY) throw new Error(`The ${page.title} section does not fit on one page.`);
  doc.roundedRect(M, boxY, W - M * 2, boxH, 8).fill("#ecfeff");
  doc.rect(M, boxY, 4, boxH).fill(CYAN_BRIGHT);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(CYAN).text("How to start", M + 16, boxY + 10, { lineBreak: false });
  doc.font("Helvetica").fontSize(11).fillColor(INK).text(page.start, M + 16, boxY + 26, { width: W - M * 2 - 28 });
  footer(doc, meta, index + 2, total);
}

export function renderGuidePdf(doc, { probe, version, date }) {
  const pages = guidePages(probe);
  if (!pages.length) throw new Error("The guide has no pages. The probe did not find any features.");
  const meta = { version: String(version), date: String(date) };
  cover(doc, meta);
  doc.addPage({ size: "LETTER", margin: 0 });
  overview(doc, pages, meta);
  pages.forEach((page, i) => {
    doc.addPage({ size: "LETTER", margin: 0 });
    section(doc, page, i + 1, pages.length + 2, meta);
  });
  return pages;
}

export function writeGuidePdf({ file, probe, version, date }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      compress: false,
      info: {
        Title: "What Meldmind can do",
        Author: "Everborn Productions",
        Subject: `Meldmind guide, version ${version}, ${date}. an Everborn product.`,
        Creator: "Meldmind",
      },
    });
    const out = fs.createWriteStream(file);
    doc.pipe(out);
    try {
      const pages = renderGuidePdf(doc, { probe, version, date });
      doc.end();
      out.on("finish", () => resolve({ file, pages }));
      out.on("error", reject);
    } catch (err) {
      doc.end();
      reject(err);
    }
  });
}

export function formatGuideDate(date) {
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00Z`);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
