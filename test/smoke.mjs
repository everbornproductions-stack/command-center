// Demo-mode smoke test (npm run smoke): starts the server in a temp data dir as owner (CC_DEV_OWNER=1,
// unpackaged), turns demo mode on, runs one Single, one Council and one Mission against the three
// pretend AIs, then starts a Free copy and checks the gates. No real keys, no spend, no data/ access.
import { startServer } from "./helpers.js";
import { chatgptZip } from "./history-helpers.js";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(s, pred, label, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const st = await s.api("/state"); const hit = pred(st.json); if (hit) return hit; await sleep(1000); }
  throw new Error(`timed out waiting for ${label}`);
}
const done = (kind) => (st) => st.missions.find((m) => m.kind === kind && m.status === "done");
let failures = 0;
const check = (ok, what) => { log(ok ? "PASS" : "FAIL", what); if (!ok) failures++; };

log("owner copy (dev override)");
const owner = await startServer({ env: { CC_DEV_OWNER: "1" } });
try {
  const st = await owner.api("/state");
  check(st.json.license.tier === "owner", `tier is owner (${st.json.license.tier})`);
  const demo = await owner.api("/demo", { method: "POST", body: { on: true } });
  check(demo.status === 200 && demo.json.demo === true, "demo mode on");
  check((await owner.api("/chat", { method: "POST", body: { prompt: "Write a two-line welcome note for a new customer." } })).status === 202, "single accepted");
  const single = await waitFor(owner, done("single"), "single to finish", 60000);
  check(!!single, `single finished (${single?.title})`);
  check((await owner.api("/council", { method: "POST", body: { prompt: "Which of three hooks works best for a launch post?", lite: true } })).status === 202, "council accepted");
  const council = await waitFor(owner, done("council"), "council to finish", 120000);
  check(!!council, `council finished (winner: ${council?.winner})`);
  check((await owner.api("/mission", { method: "POST", body: { goal: "Plan a one-week social campaign for a small bakery.", mode: "economy", budgetUsd: 1 } })).status === 202, "mission accepted");
  const mission = await waitFor(owner, done("mission"), "mission to finish", 180000);
  check(!!mission, `mission finished (${mission?.tasks} tasks, $${mission?.cost})`);
  const cmp = await owner.api("/compare", { method: "POST", body: { prompt: "Name a new bakery in three words.", columns: [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-pro" }, { provider: "demo-sage", model: "sage-mini" }] } });
  check(cmp.status === 202, "side-by-side accepted");
  let cr = null; for (let i = 0; i < 120 && cr?.status !== "done"; i++) { await sleep(500); cr = (await owner.api(`/compare/${cmp.json?.id}`)).json; }
  check(cr?.status === "done" && cr.columns.every((c) => c.status === "done" && c.cost > 0 && c.ms > 0), `side-by-side finished (3 columns, $${cr?.cost})`);
  // knowledge library (demo embedder): upload, index, then a chat that names the library cites it
  const lib = (await owner.api("/libraries", { method: "POST", body: { name: "Smoke handbook", provider: "demo-nova", model: "nova-embed" } })).json;
  const stg = (await owner.api(`/libraries/${lib?.id}/stage`, { method: "POST", body: { kind: "files", files: [{ name: "returns.md", text: "Returns are accepted within 30 days with the receipt." }, { name: "hours.txt", text: "The shop opens at 9 and closes at 17 on weekdays." }] } })).json;
  check(stg?.files?.length === 2 && stg.estimate.cost >= 0, `library staged (2 files, estimate $${stg?.estimate?.cost})`);
  check((await owner.api(`/libraries/${lib?.id}/index`, { method: "POST", body: { stageId: stg?.stageId } })).status === 202, "library indexing accepted");
  let li = null; for (let i = 0; i < 60 && li?.job?.status !== "done"; i++) { await sleep(250); li = (await owner.api(`/libraries/${lib?.id}`)).json; }
  check(li?.job?.status === "done" && li.chunks >= 2, `library indexed (${li?.chunks} passages)`);
  const singles = (await owner.api("/state")).json.missions.filter((m) => m.kind === "single").length;
  check((await owner.api("/chat", { method: "POST", body: { prompt: "How long do I have to return something?", libraries: [lib?.id] } })).status === 202, "library chat accepted");
  const libChat = await waitFor(owner, (s) => { const list = s.missions.filter((m) => m.kind === "single"); return list.length > singles && list.find((m) => m.status === "done" && !(m.id === single.id)); }, "library chat to finish", 60000);
  const libRun = (await owner.api(`/missions/${libChat.id}`)).json;
  check(libRun?.librarySources?.[0]?.title === "returns.md" && /\[L1\]/.test(libRun.deliverable || ""), "library chat cites [L1] from returns.md");
  const missionsBefore = (await owner.api("/state")).json.missions.filter((m) => m.kind === "mission").map((m) => m.id);
  check((await owner.api("/mission", { method: "POST", body: { goal: "Write a returns notice for the shop window.", mode: "economy", budgetUsd: 1, libraries: [lib?.id] } })).status === 202, "library mission accepted");
  const libMission = await waitFor(owner, (s) => s.missions.find((m) => m.kind === "mission" && m.status === "done" && !missionsBefore.includes(m.id)), "library mission to finish", 180000);
  const lm = (await owner.api(`/missions/${libMission.id}`)).json;
  check(lm?.librarySources?.some((x) => x.title === "returns.md"), `library mission has the library sources (${lm?.librarySources?.length})`);
  check((await owner.api(`/libraries/${lib?.id}`, { method: "DELETE" })).status === 200, "library deleted");
  // custom agent and a saved prompt with {{variables}} (Phase 19)
  const ag = (await owner.api("/agents", { method: "POST", body: { name: "Smoke greeter", provider: "demo-nova", model: "nova-lite", instructions: "Greet new customers warmly in two lines.", starters: ["Greet Ana"] } })).json;
  check(/^ag-/.test(ag?.id || ""), "agent created");
  const agRun = await owner.api(`/agents/${ag?.id}/run`, { method: "POST", body: { prompt: "Greet Ana" } });
  let ar = null; for (let i = 0; i < 120 && !(ar && ar.status !== "running"); i++) { await sleep(500); const r = await owner.api(`/missions/${agRun.json?.runId}`); if (r.status === 200) ar = r.json; }
  check(ar?.status === "done" && ar.customAgent?.id === ag?.id && /Smoke greeter/.test(ar.deliverable || ""), "agent run finished with its instructions");
  const pr = (await owner.api("/agents/prompts", { method: "POST", body: { name: "Smoke promo", text: "Announce {{item}} for {{day}}.", agentId: ag?.id } })).json;
  check((await owner.api(`/agents/prompts/${pr?.id}/run`, { method: "POST", body: { values: { item: "rye" } } })).status === 400, "prompt with a missing variable refused");
  check((await owner.api(`/agents/prompts/${pr?.id}/fill`, { method: "POST", body: { values: { item: "rye", day: "Friday" } } })).json?.text === "Announce rye for Friday.", "prompt variables substituted");
  const bundle = (await owner.api("/agents/export")).json;
  check(bundle?.agents?.length === 1 && bundle.prompts.length === 1, "agents exported");
  check((await owner.api(`/agents/${ag?.id}`, { method: "DELETE" })).status === 200, "agent deleted");
  const imp = (await owner.api("/agents/import", { method: "POST", body: { data: bundle } })).json;
  check(imp?.agents?.[0]?.instructions === "Greet new customers warmly in two lines.", "agents imported back");
  const arts = (await owner.api("/artifacts/extract", { method: "POST", body: { runId: single?.id, text: "## Menu\n```html\n<!doctype html><html><head><title>Menu</title></head><body><p>Rye</p></body></html>\n```\n```chart\n{\"type\":\"bar\",\"labels\":[\"Mon\"],\"series\":[{\"name\":\"Loaves\",\"values\":[4]}]}\n```" } })).json;
  check(arts?.items?.length === 2 && arts.items[0].kind === "html" && arts.items[1].kind === "chart", "artifacts found in an answer (html, chart)");
  const fr = (await owner.api(`/artifacts/${arts?.items?.[0]?.id}/frame`)).json;
  check(fr?.sandbox === "allow-scripts" && /connect-src 'none'/.test(fr.html) && !fr.html.includes(owner.token), "artifact frame sandboxed, no network, no token");
  const v2 = (await owner.api(`/artifacts/${arts?.items?.[0]?.id}/versions`, { method: "POST", body: { content: "<p>Spelt</p>" } })).json;
  check(v2?.versions?.length === 2 && v2.versions[0].content.includes("Rye"), "artifact edit is version 2, version 1 kept");
  const exf = await owner.raw({ path: `/api/artifacts/${arts?.items?.[0]?.id}/export?v=1`, headers: { "x-cc-token": owner.token } });
  check(exf.status === 200 && /attachment; filename="menu-v1\.html"/.test(exf.headers["content-disposition"] || "") && exf.text.includes("Rye"), "artifact exported as a file");
  // image generation (Phase 21): price first, then a demo image saved to the gallery with its prompt
  check((await owner.api("/images", { method: "POST", body: { provider: "demo-image", prompt: "A rye loaf on a table" } })).status === 409, "image refused before the price is shown");
  const iest = (await owner.api("/images/estimate", { method: "POST", body: { provider: "demo-image", n: 2 } })).json;
  const img = (await owner.api("/images", { method: "POST", body: { provider: "demo-image", prompt: "A rye loaf on a table", n: 2, estimate: iest?.usd } })).json;
  check(img?.files?.length === 2 && (await owner.api("/images")).json.items[0]?.params?.prompt === "A rye loaf on a table", "demo images saved to the gallery with the prompt");
  check((await owner.api("/state")).json.ledger.recent.filter((e) => e.kind === "image").length === 2, "one ledger line per image");
  const imgv = (await owner.api("/images/estimate", { method: "POST", body: { provider: "openai", op: "variation" } })).json;
  check(imgv?.keyed === false && /Add your OpenAI key/.test(imgv.keyMessage || ""), "no OpenAI key: a clear add-a-key message");
  // scheduled and triggered agents (Phase 22): wrong webhook token refused, the right one runs, a send waits for approval
  const sch = (await owner.api("/schedules", { method: "POST", body: { name: "Smoke hook", target: { kind: "chat", text: "Say hello in five words." }, trigger: { type: "webhook" }, capUsd: 1, after: { action: "webhook", url: "http://127.0.0.1:9/never" } } })).json;
  const hk = (t) => owner.raw({ method: "POST", path: sch?.schedule?.hookPath || "/api/schedules/hook/sch-missing0", headers: { "content-type": "application/json", "x-cc-trigger-token": t }, body: {} });
  check((await hk("wrong")).status === 401, "schedule webhook with a wrong token refused (401)");
  const hr = await hk(sch?.token || "none");
  check(hr.status === 202, "schedule webhook with the right token queued a run");
  let sr = null; for (let i = 0; i < 120 && !(sr && !["queued", "running"].includes(sr.status)); i++) { await sleep(500); sr = (await owner.api(`/schedules/runs/${hr.json?.run_id}`)).json; }
  check(sr?.status === "needs_approval" && sr.cost > 0, "scheduled result waits for approval before it is sent");
  check((await owner.api(`/schedules/runs/${sr?.id}/reject`, { method: "POST" })).json?.status === "rejected", "Don't send drops the result (nothing sent)");
  // smaller extras (Phase 24): live prices, the quick launcher, the browser extension, workspace keys
  const lp = (await owner.api("/pricing/live")).json;
  check(lp?.on === true && lp.rows?.some((r) => r.model === "grok-4.3" && r.source === "built-in"), "live prices on, built-in prices until OpenRouter answers (local stub here)");
  const qk = (await owner.api("/hotkey")).json;
  check(qk?.accelerator === "Alt+Space" && qk.desktop === false, "quick launcher: Alt+Space by default, desktop app only");
  const pair = (await owner.api("/extension/pairings", { method: "POST", body: { name: "Smoke browser" } })).json;
  const ping = (code) => owner.raw({ path: "/api/ext/ping", headers: code ? { authorization: `Bearer ${code}` } : {} });
  check((await ping("cce.4747.wrongwrongwrongwrongwrongwrongwrong0")).status === 401 && (await ping(pair?.code)).status === 200, "extension accepted only with its pairing code");
  const wsk = (await owner.api("/workspaces", { method: "POST", body: { name: "Smoke team" } })).json;
  check((await owner.api(`/wskeys/${wsk?.id}`, { method: "POST", body: { provider: "openai", key: "sk-smoke-not-a-real-key-0000" } })).json?.masked === "sk-s…0000", "workspace key saved, shown masked only");
  check((await owner.api("/state")).json.subscriptionsLocked === false, "subscriptions unlocked for owner");
  const mk = (await owner.api("/marketplace")).json;
  check(mk?.paidEnabled === false && mk.revenueShare?.placeholder === true && mk.revenueShare?.everbornPct === 20 && mk.catalog?.some((c) => c.id === "demo-week-of-posts" && c.price?.type === "free"), "marketplace demo catalog, placeholder revenue share, paid checkout off");
  const mkInst = await owner.api("/marketplace/install", { method: "POST", body: { listingId: "demo-week-of-posts" } });
  check(mkInst.status === 200 && mkInst.json?.ran === false && mkInst.json?.charged === false, "marketplace install copies a free demo pipeline and does not run it");
  const mkPaid = await owner.api("/marketplace/install", { method: "POST", body: { listingId: "demo-follow-up" } });
  check(mkPaid.status === 409 && mkPaid.json?.charged === false && /nothing is charged|No charge was made/i.test(mkPaid.json?.error || ""), "paid marketplace listing refused, nothing charged");
} catch (e) { check(false, e.message); } finally { await owner.stop(); }

log("free copy");
const free = await startServer();
try {
  const st = await free.api("/state");
  check(st.json.license.tier === "free" && st.json.license.configured === false, "no cloud → free");
  check((await free.api("/mission", { method: "POST", body: { goal: "x" } })).status === 402, "mission gated");
  check((await free.api("/schedules", { method: "POST", body: { name: "x", target: { kind: "mission", text: "x" }, trigger: { type: "cron", cron: "@daily" } } })).status === 402, "mission schedule gated");
  check((await free.api("/projects", { method: "POST", body: { name: "Second", categories: [] } })).status === 402, "2nd project gated");
  check((await free.api("/subscriptions", { method: "POST", body: { name: "x" } })).status === 402, "subscriptions gated");
  check(st.json.subscriptionsLocked === true && st.json.subscriptions.length === 0, "subscriptions locked in state");
  check((await free.api("/cloud", { method: "POST", body: { url: "", anonKey: "" } })).status === 400, "empty cloud refused");
  check((await free.api("/state", { noToken: true })).status === 401, "no token → 401");
  // history import and sync (Phase 23): an export zip imports with its chats; a bad file is refused clearly; sync is off by default
  const upZip = async (buf) => { const r = await fetch(`${free.base}/api/history/preview`, { method: "POST", headers: { "content-type": "application/zip", "x-cc-token": free.token }, body: buf }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const hpv = await upZip(chatgptZip());
  check(hpv.status === 200 && hpv.json?.source === "chatgpt" && hpv.json.conversations === 2, "ChatGPT export zip read (preview, nothing filed yet)");
  const himp = await free.api("/history/import", { method: "POST", body: { token: hpv.json?.token, projectId: "" } });
  const hlist = (await free.api("/missions")).json.filter((m) => m.kind === "imported");
  check(himp.json?.added === 2 && hlist.some((m) => m.title === "Tagline ideas for a bakery"), "imported chats are in the run history");
  const hbad = await upZip(Buffer.from("not a zip"));
  check(hbad.status === 400 && /not a zip file/.test(hbad.json?.error || ""), "a bad export file is refused with a clear message");
  const hsync = (await free.api("/history/sync")).json;
  check(hsync?.enabled === false && (await free.api("/history/sync/setup", { method: "POST", body: { passphrase: "a long enough passphrase" } })).status === 400, "sync is off by default and needs a cloud project");
  check((await free.api("/wskeys/w-any", { method: "POST", body: { provider: "openai", key: "sk-smoke-not-a-real-key-0000" } })).status === 402, "workspace keys gated (Studio)");
} catch (e) { check(false, e.message); } finally { await free.stop(); }

log(failures ? `${failures} check(s) FAILED` : "all smoke checks passed");
process.exit(failures ? 1 : 0);
