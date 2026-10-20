// Loopback fetches (the test mocks, Ollama, LM Studio) must not reuse a socket.
// Undici's shared pool keeps HTTP/1.1 sockets alive. On Windows the next request
// on that socket can sit forever with no headers, which the tests report as a
// 60 second wait. A private agent with pipelining off sends one Connection: close
// and drops the socket after the reply. CC_NET_TRACE=1 writes each of those
// fetches to stderr with writeSync so a Windows log shows the last one.
import fs from "node:fs";
import { Agent } from "undici";

// One request per socket. A keep-alive pool on Windows hands the next chat a
// socket the server has already finished, and that chat waits with no headers.
const agent = new Agent({
  pipelining: 0,
  connections: 256,
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
});

export function isLoopback(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch { return false; }
}

export function netTrace(line) {
  if (process.env.CC_NET_TRACE !== "1") return;
  try { fs.writeSync(2, `NETTRACE ${line}\n`); } catch {}
}

function where(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.replace(/hook/gi, "cb")}`;
  } catch { return "url"; }
}

export async function localFetch(url, opts = {}) {
  const local = isLoopback(url);
  const t0 = Date.now();
  const place = local ? where(url) : "";
  if (local) netTrace(`start ${opts.method || "GET"} ${place}`);
  try {
    const headers = { ...(opts.headers || {}) };
    if (local) headers.connection = "close";
    const res = await fetch(url, { ...opts, headers, ...(local ? { dispatcher: agent } : {}) });
    if (local) netTrace(`headers ${res.status} ${Date.now() - t0}ms ${place}`);
    return res;
  } catch (e) {
    if (local) netTrace(`error ${Date.now() - t0}ms ${e?.name || "Error"} ${place}`);
    throw e;
  }
}
