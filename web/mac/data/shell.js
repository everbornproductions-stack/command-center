// 0.4.23 Mac shell: the words the title bar shows. Pure functions, no DOM, unit tested.
// The AIs are counted the same way the status strip counts them: a provider that is connected
// (isOnBar) is ready, and one that is out of credits (pausedNow) is said so.
import { pausedNow } from "../../access-label.js";
import { isOnBar } from "../../composer-ais.js";

// The pill is about the AIs that answer, so media makers and tool servers are left out.
function counts(p) {
  if (!p) return false;
  const kind = p.kind || "text";
  if (kind !== "text" && kind !== "agent") return false;
  return isOnBar(p, []);
}

// "3 ready", "3 ready, 1 out of credits", or the empty state.
export function readyLine(providers) {
  const list = (Array.isArray(providers) ? providers : []).filter(counts);
  if (!list.length) return "No AIs yet";
  const out = list.filter(pausedNow).length;
  const ready = list.length - out;
  return out ? `${ready} ready, ${out} out of credits` : `${ready} ready`;
}

// The little label after the app name: the label of the page we are on, "Home" when there is none.
export function crumbFor(view, labels) {
  const map = labels && typeof labels === "object" ? labels : {};
  const label = map[String(view || "")];
  return label || "Home";
}

// The banner that flashes under the title bar when the switch moves.
export function modeBanner(mode) {
  return mode === "expert"
    ? "Expert: every tool, Live Ops and settings"
    : "Simple: pick, describe, done";
}
