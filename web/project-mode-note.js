// Simple / Expert per project (0.4.25). A project's own choice beats the saved global one, so a person could
// open a project they never touched and find it in the other mode. When that happens a short note says so and
// offers one button to use the global mode everywhere (which clears every project's own choice).

const label = (m) => (m === "expert" ? "Expert" : "Simple");
const norm = (m) => (m === "expert" || m === "simple" ? m : null);

// null when there is nothing to say; otherwise the words for the note.
export function projectModeNote(project, globalMode) {
  const own = norm(project?.uiMode);
  const global = norm(globalMode) || "simple";
  if (!own || own === global) return null;
  return { own, global, text: `This project is set to ${label(own)}.`, button: `Use ${label(global)} everywhere`, keep: `Keep ${label(own)} here` };
}

// The projects whose own choice must be cleared for "Use X everywhere".
export function projectsWithOwnMode(projects) {
  return (Array.isArray(projects) ? projects : []).filter((p) => p && p.id && norm(p.uiMode)).map((p) => p.id);
}
