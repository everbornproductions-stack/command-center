// Phone web companion (Slice D2, flag_phoneweb).
// Tests feature flag gating (default OFF in tests), same project and stage sync,
// dual-control queued directions with "latest explicit direction wins",
// one-tap quick actions, phone approvals, and live mission steering.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget, ROOT } from "./helpers.js";
import {
  FLAG_NAME,
  FLOW_STAGES,
  QUICK_ACTIONS,
  isPhoneWebEnabled,
  normalizeStage,
  inferStageFromRun,
} from "../server/phoneweb.js";
import {
  PHONEWEB_STAGES,
  PHONEWEB_QUICK_BUTTONS,
  isPhoneCompanionEnabled,
  resolveClientQueue,
} from "../web/features/phoneweb.js";
import { idsFor } from "../web/perf/registry.js";

test("unit: flag_phoneweb defaults to OFF and enables via settings or env", () => {
  assert.equal(FLAG_NAME, "flag_phoneweb");
  assert.equal(isPhoneWebEnabled({}, {}), false);
  assert.equal(isPhoneWebEnabled({ flag_phoneweb: false }, { CC_FLAG_PHONEWEB: "1" }), false);
  assert.equal(isPhoneWebEnabled({ flag_phoneweb: true }, {}), true);
  assert.equal(isPhoneWebEnabled({ flags: { flag_phoneweb: true } }, {}), true);
  assert.equal(isPhoneWebEnabled({}, { CC_FLAG_PHONEWEB: "1" }), true);
  assert.equal(isPhoneWebEnabled({}, { CC_FLAG_PHONEWEB: "true" }), true);

  assert.equal(isPhoneCompanionEnabled({ settings: {} }), false);
  assert.equal(isPhoneCompanionEnabled({ settings: { flag_phoneweb: true } }), true);
});

test("unit: Flow stages, client queue resolution, and registry rules", () => {
  assert.equal(FLOW_STAGES.length, 6);
  assert.deepEqual(
    FLOW_STAGES.map((s) => s.id),
    ["creative", "planning", "ai-movement", "build", "testing", "finish"],
  );
  assert.deepEqual(
    PHONEWEB_STAGES.map((s) => s.id),
    ["creative", "planning", "ai-movement", "build", "testing", "finish"],
  );
  assert.deepEqual(
    QUICK_ACTIONS.map((a) => a.id),
    ["schedule", "book", "email", "post", "image", "home"],
  );
  assert.deepEqual(
    PHONEWEB_QUICK_BUTTONS.map((a) => a.id),
    ["schedule", "book", "email", "post", "image", "home"],
  );

  assert.equal(normalizeStage("Planning"), "planning");
  assert.equal(normalizeStage("movement"), "ai-movement");
  assert.equal(normalizeStage("tweaks"), "testing");
  assert.equal(normalizeStage("finished"), "finish");
  assert.equal(normalizeStage("nonexistent"), "");

  assert.equal(inferStageFromRun({ status: "planning" }), "planning");
  assert.equal(inferStageFromRun({ status: "running" }), "build");
  assert.equal(inferStageFromRun({ status: "qa" }), "testing");
  assert.equal(inferStageFromRun({ status: "done" }), "finish");

  const resolved = resolveClientQueue([
    { id: "d1", text: "First direction", status: "superseded", explicit: true },
    { id: "n1", text: "Also include a summary table", status: "queued", explicit: false, kind: "note" },
    { id: "d2", text: "Second direction wins", status: "queued", explicit: true },
  ]);
  assert.equal(resolved.winner?.id, "d2");
  assert.equal(resolved.notes.length, 1);
  assert.equal(resolved.superseded.length, 1);

  // Light mode on command must remain empty; normal command and settings include phoneweb.
  assert.deepEqual(idsFor("command", { light: true }), []);
  assert.ok(idsFor("command").includes("phoneweb"));
  assert.ok(idsFor("settings").includes("phoneweb"));

  for (const rel of [
    ["server", "phoneweb.js"],
    ["server", "plugins", "phoneweb.js"],
    ["web", "features", "phoneweb.js"],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, ...rel), "utf8");
    assert.doesNotMatch(src, /\u2014/, `${rel.join("/")} must not contain an em dash`);
    assert.doesNotMatch(src, /\u2013/, `${rel.join("/")} must not contain an en dash`);
  }
});

test("server: flag_phoneweb is OFF by default and gates companion routes until enabled", { timeout: waitBudget(90000) }, async () => {
  const s = await startServer();
  try {
    // 0. Only a session with the token can reach the companion API.
    assert.equal((await s.api("/phoneweb/state", { noToken: true })).status, 401);
    assert.equal((await s.api("/phoneweb/direction", { method: "POST", noToken: true, body: { text: "x" } })).status, 401);

    // 1. Default state in tests: flag_phoneweb is OFF.
    const offState = await s.api("/phoneweb/state");
    assert.equal(offState.status, 200);
    assert.equal(offState.json.enabled, false);
    assert.equal(offState.json.flag, "flag_phoneweb");

    const blockedCtx = await s.api("/phoneweb/context", { method: "POST", body: { stage: "planning" } });
    assert.equal(blockedCtx.status, 403);
    assert.equal(blockedCtx.json.code, "flag_disabled");

    const blockedDir = await s.api("/phoneweb/direction", { method: "POST", body: { text: "Should be blocked" } });
    assert.equal(blockedDir.status, 403);

    const blockedQuick = await s.api("/phoneweb/quick", { method: "POST", body: { action: "schedule", text: "Blocked" } });
    assert.equal(blockedQuick.status, 403);

    // 2. Enable flag_phoneweb via settings.
    const saved = await s.api("/settings", { method: "POST", body: { flag_phoneweb: true } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.flag_phoneweb, true);

    const onState = await s.api("/phoneweb/state");
    assert.equal(onState.status, 200);
    assert.equal(onState.json.enabled, true);
    assert.equal(onState.json.stage, "creative");
    assert.equal(onState.json.stages.length, 6);
    assert.equal(onState.json.quickActions.length, 6);

    // 3. Same project and stage sync between desktop and phone.
    const proj = await s.api("/projects", { method: "POST", body: { name: "Launch Campaign", color: "#22d3ee" } });
    assert.equal(proj.status, 200);
    const projectId = proj.json.id;

    const synced = await s.api("/phoneweb/context", {
      method: "POST",
      body: {
        projectId,
        stage: "ai-movement",
        homeLocation: "10 Downing St, London",
        homeMode: "transit",
        from: "phone",
      },
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.json.context.projectId, projectId);
    assert.equal(synced.json.context.stage, "ai-movement");
    assert.equal(synced.json.context.stageLabel, "AI Movement");
    assert.equal(synced.json.state.projectName, "Launch Campaign");

    const appState = await s.api("/state");
    assert.equal(appState.json.settings.activeProject, projectId);
    assert.equal(appState.json.settings.activeStage, "ai-movement");

    const badStage = await s.api("/phoneweb/context", { method: "POST", body: { stage: "not-a-stage" } });
    assert.equal(badStage.status, 400);
    assert.equal(badStage.json.code, "bad_stage");

    // 4. Dual-control queued directions: latest explicit direction wins, additive notes stay.
    const d1 = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Make the landing page dark blue.", projectId, explicit: true, from: "phone" },
    });
    assert.equal(d1.status, 202);
    assert.equal(d1.json.mode, "queued");
    assert.equal(d1.json.queue.activeDirection.text, "Make the landing page dark blue.");

    const note1 = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Include the customer quote in the footer.", projectId, explicit: false, kind: "note", from: "desktop" },
    });
    assert.equal(note1.status, 202);
    assert.equal(note1.json.queue.activeDirection.id, d1.json.direction.id, "additive note does not replace the explicit direction");
    assert.equal(note1.json.queue.notes.length, 1);

    const d2 = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Use a warm cream palette instead of dark blue.", projectId, explicit: true, from: "phone" },
    });
    assert.equal(d2.status, 202);
    assert.deepEqual(d2.json.supersededIds, [d1.json.direction.id]);
    assert.equal(d2.json.queue.activeDirection.id, d2.json.direction.id);
    assert.equal(d2.json.queue.activeDirection.text, "Use a warm cream palette instead of dark blue.");
    assert.equal(d2.json.queue.superseded[0].id, d1.json.direction.id);
    assert.match(d2.json.queue.promptBlock, /Use a warm cream palette instead of dark blue/);
    assert.match(d2.json.queue.promptBlock, /Include the customer quote in the footer/);
    assert.doesNotMatch(d2.json.queue.promptBlock, /dark blue\.\s*$/);

    // Consuming the queue applies the winning direction and note, and clears the active queue.
    const consumed = await s.api("/phoneweb/direction/consume", {
      method: "POST",
      body: { projectId },
    });
    assert.equal(consumed.status, 200);
    assert.equal(consumed.json.consumed.winner.id, d2.json.direction.id);
    assert.equal(consumed.json.consumed.notes.length, 1);
    assert.equal(consumed.json.queue.totalQueued, 0);

    // Queueing and cancelling a direction.
    const d3 = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Temporary direction to cancel", projectId },
    });
    assert.equal(d3.status, 202);
    const cancelled = await s.api("/phoneweb/direction/cancel", {
      method: "POST",
      body: { id: d3.json.direction.id },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.entry.status, "cancelled");
    assert.equal(cancelled.json.queue.totalQueued, 0);

    // 5. Quick actions and phone approvals.
    const qaSchedule = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "schedule", text: "Review launch checklist", when: "Friday 10:00" },
    });
    assert.equal(qaSchedule.status, 200);
    assert.equal(qaSchedule.json.entry.status, "scheduled");
    assert.match(qaSchedule.json.entry.summary, /Friday 10:00/);

    const qaImage = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "image", text: "Espresso cup on oak table", lighting: "golden-hour", ambience: "cinematic" },
    });
    assert.equal(qaImage.status, 200);
    assert.equal(qaImage.json.entry.status, "created");
    assert.match(qaImage.json.entry.detail.prompt, /golden-hour/);
    assert.match(qaImage.json.entry.detail.prompt, /filmic grain/);

    const qaHome = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "home", homeLocation: "10 Downing St, London", homeMode: "walking" },
    });
    assert.equal(qaHome.status, 200);
    assert.equal(qaHome.json.entry.status, "ready");
    assert.match(qaHome.json.entry.detail.mapsUrl, /10%20Downing%20St/);
    assert.match(qaHome.json.entry.detail.mapsUrl, /travelmode=walking/);

    // Outbound quick actions hold for phone approval.
    const qaPost = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "post", platform: "instagram", text: "Our new release is live today." },
    });
    assert.equal(qaPost.status, 200);
    assert.equal(qaPost.json.entry.status, "needs-approval");
    assert.ok(qaPost.json.entry.approvalId);
    assert.equal(qaPost.json.approvals.pending.length, 1);

    const qaBook = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "book", text: "Studio Room B", when: "Monday 14:00", amount: 45 },
    });
    assert.equal(qaBook.status, 200);
    assert.equal(qaBook.json.entry.status, "needs-approval");

    const qaEmail = await s.api("/phoneweb/quick", {
      method: "POST",
      body: { action: "email", to: "team@example.com", subject: "Launch update", text: "Here is the summary." },
    });
    assert.equal(qaEmail.status, 200);
    assert.equal(qaEmail.json.entry.status, "needs-approval");

    // Approve the Instagram post and decline the booking from the phone companion.
    const approved = await s.api("/phoneweb/approval", {
      method: "POST",
      body: { id: qaPost.json.entry.approvalId, decision: "approve" },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.approval.status, "approved");
    assert.equal(approved.json.quickAction.status, "approved");

    const declined = await s.api("/phoneweb/approval", {
      method: "POST",
      body: { id: qaBook.json.entry.approvalId, decision: "decline" },
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.approval.status, "declined");
    assert.equal(declined.json.quickAction.status, "declined");
  } finally {
    await s.stop();
  }
});

test("server: queued directions steer an active mission with latest-explicit-direction-wins", { timeout: waitBudget(90000) }, async () => {
  const s = await startServer({
    env: {
      CC_FLAG_PHONEWEB: "1",
      CC_DEV_OWNER: "1",
      CC_STATUS_PAGES: "off",
      CC_MISSION_WAVE_HOLD_MS: "500",
    },
  });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const st = await s.api("/phoneweb/state");
    assert.equal(st.status, 200);
    assert.equal(st.json.enabled, true);

    const posted = await s.api("/mission", {
      method: "POST",
      body: { goal: "Write a short launch checklist for a coffee shop.", mode: "economy", budgetUsd: 1, qa: false },
    });
    assert.equal(posted.status, 202);

    // Queue an initial explicit direction and then supersede it while the mission is in flight.
    const first = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Focus on tea only.", explicit: true, from: "phone" },
    });
    assert.equal(first.status, 202);

    const second = await s.api("/phoneweb/direction", {
      method: "POST",
      body: { text: "Focus on espresso and pastries.", explicit: true, from: "phone" },
    });
    assert.equal(second.status, 202);
    assert.deepEqual(second.json.supersededIds, [first.json.direction.id]);

    let doneMission = null;
    const deadline = Date.now() + waitBudget(30000);
    while (Date.now() < deadline && !doneMission) {
      const cur = await s.api("/state");
      const m = (cur.json.missions || []).find((x) => x.kind === "mission" && ["done", "done-with-errors", "failed"].includes(x.status));
      if (m) {
        const full = await s.api(`/missions/${m.id}`);
        if (full.status === 200) doneMission = full.json;
      }
      if (!doneMission) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(doneMission, "mission finished");
    assert.ok(Array.isArray(doneMission.appliedDirections), "queued direction was applied to the mission");
    assert.equal(doneMission.appliedDirections.at(-1).text, "Focus on espresso and pastries.");
  } finally {
    await s.stop();
  }
});
