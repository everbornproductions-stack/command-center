// Preload for test/mac.test.js: makes this Node process report macOS, so the server's Mac code paths
// (server/vault.js picks its sealing method from process.platform at import) run on the Windows test PC.
Object.defineProperty(process, "platform", { value: "darwin" });
