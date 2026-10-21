// One-page security summary. Built in process so the Help page can download it
// without a third-party PDF library. One page, Helvetica, no remote fonts.

function escPdf(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function onePagePdf(lines) {
  const body = [];
  let y = 748;
  const paint = (text, size) => {
    body.push("BT");
    body.push(`/F1 ${size} Tf`);
    body.push(`54 ${y} Td (${escPdf(text)}) Tj`);
    body.push("ET");
  };
  const rows = (lines || []).map((l) => String(l ?? ""));
  if (rows.length) {
    paint(rows[0], 16);
    y -= 26;
  }
  for (const line of rows.slice(1)) {
    if (y < 48) break;
    if (!line) { y -= 8; continue; }
    paint(line.slice(0, 95), 11);
    y -= 14;
  }
  const stream = body.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const startxref = Buffer.byteLength(out);
  out += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, "binary");
}

export const SECURITY_LINES = [
  "Meldmind security summary",
  "an Everborn product. One page. Nothing here is sent for you.",
  "",
  "Your keys stay on this PC. Windows seals them with DPAPI. macOS and Linux",
  "use the OS keychain. Keys are not logged and are not shown again after save.",
  "",
  "The local server answers only this computer. It binds 127.0.0.1, checks the",
  "Host and Origin headers, and requires a session token from this launch.",
  "",
  "A share link made on this PC only works on this PC. Copy or export the text",
  "if someone else needs it. Costs stay hidden unless you tick the box.",
  "",
  "Before sending, SSNs and account numbers are masked. Dates of birth that are",
  "labeled as such are masked too. Nothing is posted, sent, or charged without",
  "a click. A failed run that cost $0 says Nothing was charged.",
  "",
  "You can type in any language. Meldmind does not train on your prompts.",
];

export function securityPdf() {
  return onePagePdf(SECURITY_LINES);
}
