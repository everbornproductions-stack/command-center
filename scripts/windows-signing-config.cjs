// electron-builder loads this from electron-builder.yml (extends).
// It adds win.azureSignOptions only when the Azure signing secrets and
// variables are all set. Secret values are not written into the config.
const path = require("node:path");
const { applySigningConfig } = require("./windows-signing.cjs");

const MARKER = path.join(__dirname, "..", ".windows-signing-mode");

module.exports = function windowsSigningConfig() {
  return applySigningConfig(process.env, { markerPath: MARKER, log: console.log });
};
