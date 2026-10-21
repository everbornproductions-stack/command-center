// Settings switch and the daily anonymous ping. Counts come from event ids only.
// The ping is not sent when the switch is off, and nothing here calls Square.
import { HOSTED, allContexts, runAs } from "../store.js";
import { localFetch } from "../loopback-fetch.js";
import {
  SHARE_LABEL, noteUse, osName, pingDestination, publicState, sendDuePing, setShare, startUsageLoop, usesFromEvent,
} from "../usage.js";

export const id = "usage";
export { SHARE_LABEL };

export function init(h) {
  startUsageLoop(async () => {
    const go = () => sendDuePing({
      tier: h.licenseState().tier,
      version: h.VERSION,
      os: osName({ hosted: HOSTED }),
      destination: pingDestination(),
      fetchImpl: localFetch,
    });
    if (HOSTED) {
      for (const c of allContexts()) await runAs(c, go);
      return;
    }
    await go();
  });
}

export function onEvent(ev) {
  for (const use of usesFromEvent(ev)) noteUse(use.feature, use.id);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/usage\/?/, "");
  if (req.method === "GET" && p === "") return h.json(res, 200, publicState());
  if (req.method === "POST" && p === "") {
    if (typeof body?.share !== "boolean") return h.json(res, 400, { error: "Send share: true or false." });
    const view = setShare(body.share);
    h.emit("log", { text: view.share ? "Anonymous usage counts on." : "Anonymous usage counts off. Nothing is sent." });
    return h.json(res, 200, view);
  }
  return false;
}
