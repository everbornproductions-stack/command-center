// One short line for a button that cannot work yet because a key is missing (0.4.25, audit A5).
// A disabled button with only a tooltip looks dead, so the screens show this line next to it and the button
// stays pressable: a press says what is missing instead of doing nothing. Pure functions, no window, so tests import it.

export const IMAGE_NO_KEY_LINE = "Add an image key in Settings to make pictures.";
export const MEDIA_NO_KEY_LINE = "Add a key for this in Settings to make it for real. Without one it is a free practice run.";

const imageReady = (p) => (p?.ready != null ? !!p.ready : !!p?.keyed);

/** Images: the line to show for this kind of image job, or "" when a provider for it is ready. */
export function imageKeyLine(providers, op = "generate", selected = "") {
  const list = (providers || []).filter((p) => (p.ops || []).includes(op));
  if (selected) {
    const pick = list.find((p) => p.id === selected);
    if (pick) return imageReady(pick) ? "" : IMAGE_NO_KEY_LINE;
  }
  return list.some(imageReady) ? "" : IMAGE_NO_KEY_LINE;
}

/** Media: the line for the chosen provider of this kind, or "" when it has a key or an MCP connection. */
export function mediaKeyLine(providers, kind = "video", selected = "") {
  const list = (providers || []).filter((p) => (p.kinds || []).includes(kind));
  const pick = list.find((p) => p.id === selected) || list[0];
  if (!pick) return MEDIA_NO_KEY_LINE;
  return pick.keyed || pick.connected ? "" : MEDIA_NO_KEY_LINE;
}
