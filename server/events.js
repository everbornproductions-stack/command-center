// Event bus. Everything the UI shows live goes through here.
// Event names: provider.status, agent.start, agent.delta, agent.done, agent.error,
// agent.msg (one AI talking to another), task.update, mission.update, ledger.entry,
// council.update, log.
import { EventEmitter } from "node:events";
import { currentUserId } from "./store.js";

class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.ring = [];
    this.seq = 0;
  }
  emitEvent(type, data) {
    // every event is tagged with the user it belongs to, so a hosted hub only fans it out to that user
    const ev = { seq: ++this.seq, ts: Date.now(), type, user: currentUserId(), ...data };
    if (type !== "agent.delta") {
      this.ring.push(ev);
      if (this.ring.length > 400) this.ring.shift();
    }
    this.emit("event", ev);
    return ev;
  }
  recent(n = 150) {
    return this.ring.slice(-n);
  }
}

export const bus = new Bus();
export const emit = (type, data) => bus.emitEvent(type, data);
