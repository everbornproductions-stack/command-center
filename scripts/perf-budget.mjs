// Installer size and eager-import check. Windows CI runs this after packaging.
// Set CC_REQUIRE_INSTALLER=1 when the installer must exist (that job).
// Set CC_IDLE_RAM_BYTES to a measured sum of every Electron process.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installerWithinBudget, idleRamOk, installerCap, BASELINE, IDLE_RAM_BUDGET } from "../server/perf/budget.js";
import { allSpecifiers, eagerSpecifiers, heavySpecifiers } from "../server/perf/eager.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

for (const rel of ["electron/main.cjs", "server/index.js"]) {
  const src = read(rel);
  const heavy = heavySpecifiers([...eagerSpecifiers(src), ...allSpecifiers(src)]);
  if (heavy.length) problems.push(`${rel} imports a heavy module: ${heavy.join(", ")}`);
}

const pkg = JSON.parse(read("package.json"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const name of Object.keys(deps)) {
  if (heavySpecifiers([name]).length) problems.push(`package.json depends on ${name}. Heavy tools are add-ons, not dependencies.`);
}

const version = pkg.version;
const exe = path.join(root, "dist", `Meldmind-Setup-${version}.exe`);
if (fs.existsSync(exe)) {
  const size = fs.statSync(exe).size;
  if (!installerWithinBudget(size)) {
    problems.push(`Installer is ${size} bytes. The cap is ${installerCap()} (${BASELINE.installerBytes} plus 15%).`);
  } else {
    console.log(`Installer ${size} bytes is within ${installerCap()}.`);
  }
} else if (process.env.CC_REQUIRE_INSTALLER === "1") {
  problems.push(`Installer not found at ${exe}.`);
} else {
  console.log("No installer in dist. Size check skipped. Set CC_REQUIRE_INSTALLER=1 on the package job.");
}

if (process.env.CC_IDLE_RAM_BYTES) {
  const ram = Number(process.env.CC_IDLE_RAM_BYTES);
  if (!idleRamOk(ram)) problems.push(`Idle RAM ${ram} bytes is over the ${IDLE_RAM_BUDGET} byte budget.`);
  else console.log(`Idle RAM ${ram} bytes is within ${IDLE_RAM_BUDGET}.`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Performance budget checks passed.");
