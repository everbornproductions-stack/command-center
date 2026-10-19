// Demo-mode smoke test (npm run smoke): starts the server in a temp data dir as owner (CC_DEV_OWNER=1,
// unpackaged), turns demo mode on, runs one Single, one Council and one Mission against the three
// pretend AIs, then starts a Free copy and checks the gates. No real keys, no spend, no data/ access.
import { startServer } from "./helpers.js";

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
  check((await owner.api("/state")).json.subscriptionsLocked === false, "subscriptions unlocked for owner");
} catch (e) { check(false, e.message); } finally { await owner.stop(); }

log("free copy");
const free = await startServer();
try {
  const st = await free.api("/state");
  check(st.json.license.tier === "free" && st.json.license.configured === false, "no cloud → free");
  check((await free.api("/mission", { method: "POST", body: { goal: "x" } })).status === 402, "mission gated");
  check((await free.api("/projects", { method: "POST", body: { name: "Second", categories: [] } })).status === 402, "2nd project gated");
  check((await free.api("/subscriptions", { method: "POST", body: { name: "x" } })).status === 402, "subscriptions gated");
  check(st.json.subscriptionsLocked === true && st.json.subscriptions.length === 0, "subscriptions locked in state");
  check((await free.api("/cloud", { method: "POST", body: { url: "", anonKey: "" } })).status === 400, "empty cloud refused");
  check((await free.api("/state", { noToken: true })).status === 401, "no token → 401");
} catch (e) { check(false, e.message); } finally { await free.stop(); }

log(failures ? `${failures} check(s) FAILED` : "all smoke checks passed");
process.exit(failures ? 1 : 0);
