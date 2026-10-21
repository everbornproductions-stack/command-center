// Per-user job queue for hosted runs. A list call only sees that user's jobs.
// The runner is handed one user's opened keys and never the queue.

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

export function budgetDecision({ budgetUsd, spentUsd = 0, nextUsd = 0 } = {}) {
  const budget = Number(budgetUsd);
  const spent = Number(spentUsd) || 0;
  const next = Number(nextUsd) || 0;
  if (!Number.isFinite(budget) || budget <= 0 || budget > 10000) {
    return { ok: false, reason: "Set a budget above $0 and up to $10000 before handing this to the cloud." };
  }
  if (spent + next > budget + 1e-9) {
    return { ok: false, reason: `Stopped. This would pass the $${budget} budget.` };
  }
  return { ok: true, budget };
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    userId: job.userId,
    kind: job.kind,
    refId: job.refId,
    title: job.title,
    status: job.status,
    cost: job.cost || 0,
    text: job.text || "",
    budgetUsd: job.budgetUsd,
    synced: !!job.synced,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
  };
}

function newId() {
  return `hw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createQueue() {
  const users = new Map();

  function bucket(userId) {
    const id = String(userId || "").trim();
    if (!id || id.length > 128) throw fail(400, "A user is required.", "user");
    if (!users.has(id)) users.set(id, []);
    return { id, jobs: users.get(id) };
  }

  return {
    add(userId, input = {}) {
      if (input.optIn !== true) throw fail(403, "Nothing is handed to the cloud until you opt in.", "opt_in");
      const kind = input.kind === "mission" ? "mission" : input.kind === "schedule" ? "schedule" : "";
      if (!kind) throw fail(400, "Hand off a schedule or a mission.", "kind");
      const decision = budgetDecision({ budgetUsd: input.budgetUsd });
      if (!decision.ok) throw fail(400, decision.reason, "budget");
      const estimate = Number(input.estimateUsd) || 0;
      const over = estimate > decision.budget;
      const { id, jobs } = bucket(userId);
      const job = {
        id: newId(),
        userId: id,
        kind,
        refId: String(input.refId || "").slice(0, 80),
        title: String(input.title || "").slice(0, 120),
        prompt: String(input.prompt || "").slice(0, 4000),
        budgetUsd: decision.budget,
        estimateUsd: estimate,
        envelopes: over ? [] : (Array.isArray(input.envelopes) ? input.envelopes : []),
        status: over ? "stopped" : "queued",
        cost: 0,
        text: over ? budgetDecision({ budgetUsd: decision.budget, nextUsd: estimate }).reason : "",
        synced: false,
        createdAt: Date.now(),
        finishedAt: over ? Date.now() : null,
      };
      jobs.push(job);
      return publicJob(job);
    },

    claimNext() {
      for (const jobs of users.values()) {
        const job = jobs.find((j) => j.status === "queued");
        if (!job) continue;
        job.status = "running";
        return job;
      }
      return null;
    },

    finish(userId, jobId, result, secrets) {
      const { jobs } = bucket(userId);
      const job = jobs.find((j) => j.id === jobId);
      if (!job || job.userId !== userId) return null;
      const cost = Number(result?.cost) || 0;
      let status = result?.status === "failed" ? "failed" : result?.status === "stopped" ? "stopped" : "done";
      let text = String(result?.text || "");
      if (cost > job.budgetUsd) {
        status = "stopped";
        text = `Stopped. This would pass the $${job.budgetUsd} budget.`;
      }
      for (const value of Object.values(secrets || {})) {
        const raw = String(value || "");
        if (raw.length >= 4) text = text.split(raw).join("[key]");
      }
      job.status = status;
      job.cost = cost;
      job.text = text.slice(0, 4000);
      job.finishedAt = Date.now();
      job.envelopes = [];
      return publicJob(job);
    },

    list(userId) {
      return bucket(userId).jobs.map(publicJob);
    },

    sync(userId) {
      const { jobs } = bucket(userId);
      const ready = jobs.filter((j) => !j.synced && (j.status === "done" || j.status === "stopped" || j.status === "failed"));
      for (const job of ready) job.synced = true;
      const running = jobs.some((j) => j.status === "queued" || j.status === "running");
      return { running, jobs: ready.map(publicJob) };
    },
  };
}
