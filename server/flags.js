// Release feature flags for 0.4.19 slices. Each flag is forced with an env var, CC_FLAG_<NAME>=1 or =0.
// A flag that is off leaves the older behaviour exactly as it was. The 0.4.19 build turns them on after review.
// To add a flag, add one line to DEFAULTS. flagView() lists every flag in the table by itself.
const DEFAULTS = {
  projectbar: false, // Working-in project bar, Continue this project, soft delete with Recently Deleted
  promptdrop: false, // Prompts dropdown under the boxes and the original video prompt pack
  nextactions: false, // Next actions bar, Send to menu and the Remix fixes after a result
  projectmedia: false, // Per-project Media tab, asset tray, version stacks, tags, links
  photoeditor: false, // Photo editor: non-destructive sliders, before/after, versions in the project, enhancement prompts
  publish: false, // Publish plus: caption variations, content calendar with approval, website publish with preview and rollback
  finishrouter: false, // Finish router: picks the right editor, confirmation chip, Why this editor, General workspace
  finishpath: false, // Always-visible Finish, Looks good / Edit further pair, Finish preview card, progress pill, Undo and Branch
  momentum: false, // Momentum Mode: action bar that suggests the next step, autosave checkpoint, Resume Momentum, Low Power, Owner tuning
  takeover: false, // Review and Take Over Tasks panel, project mirroring, Owner tools

  templates: false, // Custom project templates: Save as template, Start from a template
  videoeditor: false, // Video sound and subtitle editor: sound line, subtitles, timing, transitions, preview and export
  finishers: false, // Category finishers: documents, accounting, automations, music, presentations, programs, games
};
export function flagOn(name) {
  const v = process.env["CC_FLAG_" + String(name).toUpperCase()];
  if (v === "1" || v === "on") return true;
  if (v === "0" || v === "off") return false;
  return !!DEFAULTS[name];
}
export function promptdropOn(env = process.env) {
  const v = String(env.CC_FLAG_PROMPTDROP || "");
  if (v === "1" || v === "on") return true;
  if (v === "0" || v === "off") return false;
  return !!DEFAULTS.promptdrop;
}
// The saved setting (flag_projectmedia) is used only when no env var forces the flag.
export function projectmediaOn(settings = {}) {
  const v = process.env.CC_FLAG_PROJECTMEDIA;
  if (v === "1" || v === "on" || v === "0" || v === "off") return flagOn("projectmedia");
  if (settings && typeof settings.flag_projectmedia === "boolean") return settings.flag_projectmedia;
  return flagOn("projectmedia");
}
// The saved setting (flag_takeover) is used only when no env var forces the flag.
export function takeoverOn(settings = {}) {
  const v = process.env.CC_FLAG_TAKEOVER;
  if (v === "1" || v === "on" || v === "0" || v === "off") return flagOn("takeover");
  if (settings && typeof settings.flag_takeover === "boolean") return settings.flag_takeover;
  return flagOn("takeover");
}

// The saved setting (flag_templates) is used only when no env var forces the flag.
export function templatesOn(settings = {}) {
  const v = process.env.CC_FLAG_TEMPLATES;
  if (v === "1" || v === "on" || v === "0" || v === "off") return flagOn("templates");
  if (settings && typeof settings.flag_templates === "boolean") return settings.flag_templates;
  return flagOn("templates");
}
export const flagView = () => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, flagOn(k)]));
