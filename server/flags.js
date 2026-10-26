// Release feature flags. Each flag can be forced with an env var, CC_FLAG_<NAME>=1 or =0.
// A flag that is off leaves the older behaviour exactly as it was.
const DEFAULTS = {
  projectbar: false, // Working-in project bar, Continue this project, soft delete with Recently Deleted
};
export function flagOn(name) {
  const v = process.env["CC_FLAG_" + String(name).toUpperCase()];
  if (v === "1" || v === "on") return true;
  if (v === "0" || v === "off") return false;
  return !!DEFAULTS[name];
}
export const flagView = () => ({ projectbar: flagOn("projectbar") });
