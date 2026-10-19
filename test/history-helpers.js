// Test plumbing for Phase 23: build export zips from the fixture JSON, and a stand-in for the Supabase sync
// functions in supabase/sync.sql (same names, arguments and refusals; token kept as SHA-256 only).
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

export const FIX = path.join(ROOT, "test", "fixtures", "history");
export const fixture = (src, file = "conversations.json") => fs.readFileSync(path.join(FIX, src, file));

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// entries: [{ name, data: Buffer|string, store?: true, encrypted?: true }]
export function makeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const comp = e.store ? data : zlib.deflateRawSync(data);
    const method = e.store ? 0 : 8, flags = (e.encrypted ? 1 : 0) | 0x800;
    const name = Buffer.from(e.name), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export const chatgptZip = () => makeZip([{ name: "conversations.json", data: fixture("chatgpt") }, { name: "chat.html", data: "<html></html>" }, { name: "user.json", data: "{}" }]);
// stored and deflated entries mixed, one folder down, plus a macOS junk folder that must be ignored
export const claudeZip = () => makeZip([{ name: "__MACOSX/export/conversations.json", data: "junk", store: true }, { name: "export/conversations.json", data: fixture("claude"), store: true }, { name: "export/projects.json", data: fixture("claude", "projects.json") }, { name: "export/users.json", data: "[]" }]);

const sha = (s) => crypto.createHash("sha256").update(String(s ?? "")).digest("hex");
export class MockSyncDb {
  constructor() { this.spaces = new Map(); this.items = new Map(); this.seq = 0; this.calls = []; }
  fail(msg) { throw Object.assign(new Error(msg), { httpStatus: 400 }); }
  ok(space, token) { const s = this.spaces.get(space); return !!s && s.token_hash === sha(token); }
  call(fn, a) {
    this.calls.push({ fn, args: a });
    if (fn === "cc_sync_create") {
      if (String(a.p_token || "").length < 40) this.fail("bad sync token");
      if (this.spaces.has(a.p_space)) this.fail("space exists");
      this.spaces.set(a.p_space, { space: a.p_space, token_hash: sha(a.p_token), salt: a.p_salt, kdf: a.p_kdf, check_blob: a.p_check });
      return { ok: true };
    }
    if (fn === "cc_sync_meta") { const s = this.spaces.get(a.p_space); return s ? { salt: s.salt, kdf: s.kdf, check: s.check_blob } : null; }
    if (!this.ok(a.p_space, a.p_token)) this.fail("bad sync token");
    if (fn === "cc_sync_push") {
      for (const it of a.p_items) {
        if (!/^[0-9a-f]{40}$/.test(it.item)) this.fail("bad item id");
        this.items.set(`${a.p_space}/${it.item}`, { space: a.p_space, item: it.item, blob: it.blob, seq: ++this.seq, updated_at: it.updated_at });
      }
      return { stored: a.p_items.length };
    }
    if (fn === "cc_sync_pull") return [...this.items.values()].filter((r) => r.space === a.p_space && r.seq > (a.p_since || 0)).sort((x, y) => x.seq - y.seq).slice(0, a.p_limit || 200).map(({ item, blob, seq, updated_at }) => ({ item, blob, seq, updated_at }));
    if (fn === "cc_sync_delete_space") { this.spaces.delete(a.p_space); for (const k of [...this.items.keys()]) if (k.startsWith(a.p_space + "/")) this.items.delete(k); return { ok: true }; }
    this.fail("no such function");
  }
  // in-process transport for server/history-sync.js (refusals come back like the real transport's)
  transport() {
    return async (fn, args) => {
      try { return structuredClone(this.call(fn, structuredClone(args))); }
      catch (e) {
        if (/bad sync token/.test(e.message)) throw Object.assign(new Error("The sync service did not accept this device's key."), { status: 401, code: "bad_token" });
        throw Object.assign(new Error(e.message), { status: 502 });
      }
    };
  }
  // for helpers.startStub({ rpc }): license functions get the stub's default answer
  stubRpc() {
    return (fn, args) => {
      if (!fn.startsWith("cc_sync_")) return { ok: false, tier: "free", status: "unknown", message: "stub: not found" };
      try { return { rows: this.call(fn, args) ?? {} }; } catch (e) { return { httpStatus: 400, rows: { message: e.message } }; }
    };
  }
}
