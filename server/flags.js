// Release flags for 0.4.19 slices. A flag is on only when its CC_FLAG_* variable is "1".
// The 0.4.19 build sets it on after review; tests leave it off unless they set it.
export function promptdropOn(env = process.env) {
  return String(env.CC_FLAG_PROMPTDROP || "") === "1";
}
