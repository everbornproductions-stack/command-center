// Pure rating row and preference helpers (0.4.21, P-rate).
// ESM, no DOM dependencies, shared between the browser and Node unit tests.

export function contributors(run, pnameFn = (id) => id) {
  const out = [];
  if (!run) return out;
  if (run.kind === "council" && run.council) {
    for (const a of Object.values(run.council.answers || {})) {
      if (a && a.provider) {
        out.push({
          provider: a.provider,
          model: a.model || "",
          label: `${pnameFn(a.provider)}${a.letter ? ` (answer ${a.letter})` : ""}`
        });
      }
    }
    if (run.council.verdict?.model || run.council.verdict?.provider) {
      const v = run.council.verdict;
      out.push({
        provider: v.provider,
        model: v.model,
        label: `${pnameFn(v.provider)} (verdict)`
      });
    }
  } else if ((run.kind === "mission" && run.mission) || run.tasks || run.mission?.tasks) {
    const tasks = run.mission?.tasks || run.tasks || [];
    for (const t of tasks) {
      if (!t || t.save) continue; // Meldmind's own save step is not an AI to rate
      // every step that ran gets its own row (code, QA, agent, failed and empty steps too); a step that never started has nothing to rate
      const ran = !!(t.output || t.provider || ["done", "failed", "review", "revised", "skipped-input"].includes(t.status) || t.notDone);
      if (!ran) continue;
      // a step that said it could not do the job keeps its row, but is never counted as good work by the preference line (!t.notDone)
      const good = !t.notDone && t.status !== "failed";
      const kind = t.media?.kind ? `media/${t.media.kind}` : null;
      out.push({
        provider: t.provider || "meldmind",
        model: t.model || t.provider || "step",
        stepId: t.id,
        stepKind: kind,
        good,
        label: `${pnameFn(t.provider || "meldmind")} · ${t.title || t.id}${kind ? ` (${kind.replace("media/", "")})` : ""}${t.notDone ? " (said it could not do it)" : t.status === "failed" ? " (failed)" : ""}`,
        capability: kind ? "media" : (t.capability || "writing")
      });
      if (t.review && !t.review.unchecked && (t.review.model || t.review.provider)) {
        out.push({
          provider: t.review.provider,
          model: t.review.model,
          stepId: `${t.id}:qa`,
          label: `${pnameFn(t.review.provider)} · checked "${t.title || t.id}"`,
          capability: "analysis"
        });
      }
    }
    const assembler = run.mission?.assembler || run.assembler;
    if (assembler) {
      out.push({
        provider: assembler.provider,
        model: assembler.model,
        stepId: "assembly",
        label: `${pnameFn(assembler.provider)} (assembly)`,
        capability: "writing"
      });
    }
  } else {
    const a = run.primary ? run.agents?.[run.primary] : null;
    if (a) {
      out.push({ provider: a.provider, model: a.model, label: pnameFn(a.provider) });
    } else if (run.provider) {
      out.push({ provider: run.provider, model: run.model, label: pnameFn(run.provider) });
    }
  }
  // Do NOT dedupe by provider or model: every step/task gets its own row.
  return out;
}

export function preferLine({ up, rated, ran = [], top = null } = {}) {
  if (!up) return ""; // after a thumbs down, show nothing
  if (!top || !top.name) return "";
  // must name an AI that really ran a step in this run
  const didRun = ran.some((c) => c.good !== false && c.provider === top.provider && (!top.model || c.model === top.model));
  if (!didRun) return "";
  return `Meldmind now prefers ${top.name} for this kind of work.`;
}
