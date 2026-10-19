// Port picking for the desktop app. v0.3.0 bug: if anything already answered /api/health on 4747
// (for example a developer copy of the server started from the repo), the installed app attached to
// it instead of starting its own. Keys then went to the wrong server and data folder, and that
// server's key checks failed. Now the app always starts its own server on a free port and only
// trusts a server that echoes this launch's random instance id.
const net = require("node:net");

function isFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

async function pickFreePort(preferred, { span = 40, avoid = [] } = {}) {
  for (let p = preferred; p < preferred + span; p++) if (!avoid.includes(p) && (await isFree(p))) return p;
  // fall back to any free port the OS hands out
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

const isOurServer = (health, instance) => !!health && health.ok === true && health.app === "command-ai" && !!instance && health.instance === instance;

module.exports = { isFree, pickFreePort, isOurServer };
