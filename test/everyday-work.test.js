// Docs, meeting notes, and a mock lead follow-up. No HighLevel or Twilio network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { summarizeText, actionsFromTranscript, TRY_DOCS, TRY_PREP, TRY_LEAD, TWILIO_NOTICE } from "../server/everyday-work.js";

const EM = "\u2014";
const DRIVE_TEXT = "The Q3 proposal covers a new landing page. The budget stays flat. Launch is in November. Extra sentence four should be dropped.";
const NOTION_TEXT = "The Q3 proposal lists the open questions for Dana.";

test("a summary keeps three sentences, and action lines are the to-dos", () => {
  const summary = summarizeText(DRIVE_TEXT);
  assert.match(summary, /landing page/);
  assert.equal(summary.includes("Extra sentence"), false);
  const actions = actionsFromTranscript("We agreed the launch stays in November.\n- Dana will send the revised deck.\nMark needs to book the room.\n");
  assert.deepEqual(actions, ["Dana will send the revised deck.", "Mark needs to book the room."]);
  assert.throws(() => summarizeText("the password is hunter2"), /password/);
  const src = fs.readFileSync(path.join(ROOT, "server/everyday-work.js"), "utf8");
  assert.equal(src.includes("api.gohighlevel.com") || src.includes("api.twilio.com"), false);
  assert.match(src, /driveList/);
  assert.match(src, /notionList/);
  for (const file of ["server/everyday-work.js", "server/plugins/everyday-work.js", "web/features/everyday-work.js", "docs/help/everyday-docs.md", "docs/help/everyday-meetings.md", "docs/help/everyday-leads.md"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/everyday-docs.md"), "utf8"), /Try saying: Find the Q3 proposal/);
  assert.equal([TRY_DOCS, TRY_PREP, TRY_LEAD, TWILIO_NOTICE].some((s) => s.includes(EM)), false);
});

function mock() {
  const m = { sent: [], methods: [] };
  const json = (res, code, obj) => {
    res.writeHead(code, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(obj));
  };
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const u = new URL(req.url, "http://127.0.0.1");
    m.methods.push(`${req.method} ${u.pathname}`);
    if (u.pathname === "/token") return json(res, 200, { access_token: "g-access-everyday", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.readonly" });
    if (u.pathname === "/v1/oauth/token") return json(res, 200, { access_token: "n-access-everyday", workspace_name: "Fake workspace" });
    if (u.pathname === "/drive/v3/files") return json(res, 200, { files: [{ id: "q3prop01", name: "Q3 proposal", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/q3prop01/edit" }] });
    if (u.pathname === "/drive/v3/files/q3prop01" && u.searchParams.get("alt") !== "media") return json(res, 200, { id: "q3prop01", name: "Q3 proposal", mimeType: "application/vnd.google-apps.document" });
    if (u.pathname === "/drive/v3/files/q3prop01/export") {
      res.writeHead(200, { "content-type": "text/plain", connection: "close" });
      return res.end(DRIVE_TEXT);
    }
    if (u.pathname === "/v1/search") return json(res, 200, { results: [{ object: "page", id: "page-0001-aaaa", url: "https://www.notion.so/page-0001", properties: { Name: { type: "title", title: [{ plain_text: "Q3 notes" }] } } }] });
    if (u.pathname === "/v1/pages/page-0001-aaaa") return json(res, 200, { id: "page-0001-aaaa", url: "https://www.notion.so/page-0001", properties: { Name: { type: "title", title: [{ plain_text: "Q3 notes" }] } } });
    if (u.pathname === "/v1/blocks/page-0001-aaaa/children") return json(res, 200, { results: [{ id: "b-1", type: "paragraph", paragraph: { rich_text: [{ plain_text: NOTION_TEXT }] } }], has_more: false });
    if (u.pathname === "/lead") { m.sent.push(JSON.parse(body || "{}")); return json(res, 200, {}); }
    return json(res, 404, { message: "no route" });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      m.base = `http://127.0.0.1:${srv.address().port}`;
      m.close = () => new Promise((done) => { try { srv.closeAllConnections(); } catch {} srv.close(done); });
      resolve(m);
    });
  });
}

const BLANK = {
  CC_STATUS_PAGES: "off",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
};

test("find reads Drive and Notion, prep stays local, and a lead send is a click", async () => {
  const secret = "hunter2-doc-secret";
  let free;
  try {
    free = await startServer({ env: { ...BLANK } });
    const gated = await free.api("/everyday-work/leads", { method: "POST", body: { name: "Ana", email: "ana@client.test", phone: "+15555550123" } });
    assert.equal(gated.status, 402, gated.text);
  } finally { if (free) await free.stop(); }

  const box = await mock();
  let s;
  try {
    s = await startServer({ env: {
      ...BLANK,
      CC_DEV_OWNER: "1",
      CC_GOOGLE_TOKEN_URL: box.base,
      CC_DRIVE_API_URL: box.base,
      CC_NOTION_API_URL: box.base,
      CC_EVERYDAY_LEAD_URL: `${box.base}/lead`,
    } });
    assert.ok((await s.api("/state")).json.plugins.includes("everyday-work"));
    await s.api("/libraries/google/client", { method: "POST", body: { clientId: "1234-everyday.apps.googleusercontent.com", clientSecret: "GOCSPX-everyday-doc-test" } });
    const gs = new URL((await s.api("/libraries/google/start", { method: "POST", body: { origin: s.base } })).json.url);
    assert.equal((await s.api("/libraries/google/finish", { method: "POST", body: { code: "good", state: gs.searchParams.get("state") } })).status, 200);
    await s.api("/libraries/notion/client", { method: "POST", body: { clientId: "notion-client-everyday", clientSecret: "secret_notion_everyday" } });
    const ns = new URL((await s.api("/libraries/notion/start", { method: "POST", body: { origin: s.base } })).json.url);
    assert.equal((await s.api("/libraries/notion/finish", { method: "POST", body: { code: "n-code", state: ns.searchParams.get("state") } })).status, 200);

    const local = await s.api("/everyday-work/pages", { method: "POST", body: { title: "Q3 proposal local", text: "Local notes for the Q3 proposal. Kept on this computer." } });
    assert.equal(local.status, 200, local.text);
    const found = await s.api("/everyday-work/find", { method: "POST", body: { q: "Q3 proposal" } });
    assert.equal(found.status, 200, found.text);
    assert.equal(found.json.wroteDrive, false);
    assert.equal(found.json.sends, false);
    assert.ok(found.json.matches.some((hit) => hit.source === "local"));
    const drive = found.json.matches.find((hit) => hit.source === "drive");
    assert.ok(drive, found.text);
    assert.match(drive.summary, /landing page/);
    assert.equal(drive.summary.includes("Extra sentence"), false);
    assert.ok(found.json.matches.some((hit) => hit.source === "notion" && hit.summary.includes("open questions")));
    assert.ok(box.methods.filter((x) => x.startsWith("POST /drive")).length === 0, "Drive is only read");
    const unsaved = await s.api("/everyday-work/save", { method: "POST", body: { title: "Nope", text: "Not yet." } });
    assert.equal(unsaved.status, 400);
    const saved = await s.api("/everyday-work/save", { method: "POST", body: { confirm: true, title: drive.title, text: drive.summary } });
    assert.equal(saved.json.wroteDrive, false);
    assert.equal(saved.json.wroteNotion, false);
    assert.equal(saved.json.page.source, "meldmind");

    const refused = await s.api("/everyday-work/pages", { method: "POST", body: { title: "Secret", text: `password is ${secret}` } });
    assert.equal(refused.status, 400);
    const recorded = await s.api("/everyday-work/meetings", { method: "POST", body: { title: "Call", record: true } });
    assert.equal(recorded.status, 400);
    const meeting = await s.api("/everyday-work/meetings", { method: "POST", body: {
      title: "Q3 proposal review",
      at: "2:00 pm",
      notes: "Dana sent the draft.",
      transcript: "We agreed the launch stays in November.\n- Dana will send the revised deck.\nMark needs to book the room.\n",
    } });
    assert.equal(meeting.status, 200, meeting.text);
    const id = meeting.json.meeting.id;
    const prep = await s.api(`/everyday-work/meetings/${id}/prep`, { method: "POST", body: {} });
    assert.equal(prep.json.sends, false);
    assert.equal(prep.json.wroteCalendar, false);
    assert.match(prep.json.lines.join("\n"), /Dana sent the draft/);
    assert.match(prep.json.lines.join("\n"), /Q3 proposal/);
    const preview = await s.api(`/everyday-work/meetings/${id}/tasks`, { method: "POST", body: {} });
    assert.equal(preview.json.saved, false);
    assert.equal((await s.api("/everyday-work")).json.tasks.length, 0);
    const added = await s.api(`/everyday-work/meetings/${id}/tasks`, { method: "POST", body: { confirm: true } });
    assert.equal(added.json.saved, true);
    assert.equal(added.json.tasks.length, 2);

    const lead = await s.api("/everyday-work/leads", { method: "POST", body: { name: "Ana", email: "ana@client.test", phone: "+15555550123", note: "Asked about the Q3 proposal." } });
    assert.equal(lead.status, 200, lead.text);
    assert.equal(lead.json.lead.highlevel, false);
    assert.equal(lead.json.lead.sends, false);
    assert.match(lead.json.lead.notice, /does not send a text or look up a price/);
    const bare = await s.api(`/everyday-work/leads/${lead.json.lead.id}/send`, { method: "POST", body: { channel: "sms", to: lead.json.lead.drafts.sms.to, body: lead.json.lead.drafts.sms.body } });
    assert.equal(bare.status, 400);
    assert.equal(box.sent.length, 0);
    const sms = lead.json.lead.drafts.sms;
    const sent = await s.api(`/everyday-work/leads/${lead.json.lead.id}/send`, { method: "POST", body: { confirm: true, channel: "sms", to: sms.to, body: sms.body } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.network, false);
    assert.equal(sent.json.delivered, true);
    assert.deepEqual(box.sent[0], { channel: "sms", to: sms.to, subject: "", body: sms.body });
    const again = await s.api(`/everyday-work/leads/${lead.json.lead.id}/send`, { method: "POST", body: { confirm: true, channel: "sms", to: sms.to, body: sms.body } });
    assert.equal(again.status, 409);
    const dumped = fs.readdirSync(s.dir).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(s.dir, f), "utf8")).join("\n");
    assert.equal(dumped.includes(secret), false);
    assert.equal(s.log.includes(secret), false);
  } finally {
    if (s) await s.stop();
    await box.close();
  }
});
