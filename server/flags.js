// Release feature flags for 0.4.19 slices. Each flag is forced with an env var, CC_FLAG_<NAME>=1 or =0.
// A flag that is off leaves the older behaviour exactly as it was. The 0.4.19 build turns them on after review.
const DEFAULTS = {
  projectbar: false, // Working-in project bar, Continue this project, soft delete with Recently Deleted
  promptdrop: false, // Prompts dropdown under the boxes and the original video prompt pack
  nextactions: false, // Next actions bar, Send to menu and the Remix fixes after a result
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
export const flagView = () => ({ projectbar: flagOn("projectbar"), promptdrop: flagOn("promptdrop"), nextactions: flagOn("nextactions") });
