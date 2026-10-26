// Release feature flags for 0.4.19 slices. Each flag is forced with an env var, CC_FLAG_<NAME>=1 or =0.
// A flag that is off leaves the older behaviour exactly as it was. They are on by default in 0.4.19; CC_FLAG_<NAME>=0 turns one off.
// To add a flag, add one line to DEFAULTS. flagView() lists every flag in the table by itself.
const DEFAULTS = {
  projectbar: true, // Working-in project bar, Continue this project, soft delete with Recently Deleted
  promptdrop: true, // Prompts dropdown under the boxes and the original video prompt pack
  nextactions: true, // Next actions bar, Send to menu and the Remix fixes after a result
  projectmedia: true, // Per-project Media tab, asset tray, version stacks, tags, links
  finishrouter: true, // Finish router: picks the right editor, confirmation chip, Why this editor, General workspace
  finishpath: true, // Always-visible Finish, Looks good / Edit further pair, Finish preview card, progress pill, Undo and Branch
  freechat: true, // Free signed-in people post to the shared Community room with a per-install device token (needs supabase/community_free_posting.sql)
  takeover: true, // Review and Take Over Tasks panel, project mirroring, Owner tools
  templates: true, // Custom project templates: Save as template, Start from a template
  momentum: true, // Momentum Mode: action bar that suggests the next step, autosave checkpoint, Resume Momentum, Low Power, Owner tuning
  photoeditor: true, // Photo editor: non-destructive sliders, before/after, versions in the project, enhancement prompts
  signalsend: false, // Sending anonymous quality signals. OFF: this repo has no receiver for /api/metrics/signals. Turn on with CC_FLAG_SIGNALSEND=1 once the metrics service has one.
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
