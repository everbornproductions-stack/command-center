// Start a project tutorials for the live map. The walkthroughs themselves stay in
// server/walkthroughs.js. This list only tells the map how to introduce each one.
import { TYPES } from "./walkthroughs.js";

export function mapTutorials() {
  return TYPES.map((t) => ({
    id: t.id,
    name: t.name,
    steps: [
      "The router sits at the center of the map.",
      `A ${t.name} project shows the handoff on the map.`,
      "Watch on the map is an example. No AI is called, and nothing is sent.",
      "Start this project opens the real walk. Sending still needs a click.",
    ],
  }));
}
