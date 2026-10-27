// 0.4.23 Mac-style GUI loader. Does nothing unless the Mac style is on (see /mac/index.js).
import { startMac } from "/mac/index.js";

window.CC.register({ id: "mac" });
startMac(window.CC).catch((e) => console.warn("[mac]", e));
