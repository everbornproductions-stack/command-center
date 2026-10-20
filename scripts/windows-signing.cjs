// Optional Azure Trusted Signing (Artifact Signing) for the Windows build.
// Secret values stay in the environment for Azure. They are never written into
// electron-builder config, a marker file, or a log line.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SECRET_NAMES = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];
const VAR_NAMES = ["AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_CERT_PROFILE", "AZURE_PUBLISHER_NAME"];
const TIMESTAMP_SERVER = "http://timestamp.acs.microsoft.com";

function trimmed(env, name) {
  return String(env[name] ?? "").trim();
}

function redact(text, env) {
  let out = String(text);
  for (const name of SECRET_NAMES) {
    const value = String(env[name] ?? "");
    if (value.length >= 4 && out.includes(value)) out = out.split(value).join("[redacted]");
    const cut = value.trim();
    if (cut.length >= 4 && cut !== value && out.includes(cut)) out = out.split(cut).join("[redacted]");
  }
  return out;
}

function validEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "" && url.pathname !== "/") return false;
  return /(^|\.)codesigning\.azure\.net$/.test(url.hostname);
}

function validAccount(value, min, max) {
  if (value.length < min || value.length > max) return false;
  if (!/^[A-Za-z]/.test(value) || !/[A-Za-z0-9]$/.test(value)) return false;
  if (/--/.test(value)) return false;
  return /^[A-Za-z0-9-]+$/.test(value);
}

function validPublisher(value) {
  if (value.length < 2 || value.length > 400) return false;
  if (/[\0-\x1f$`"';&|\\]/.test(value)) return false;
  return /[A-Za-z]/.test(value);
}

function signingPlan(env = process.env) {
  const secrets = SECRET_NAMES.map((name) => ({ name, value: trimmed(env, name), raw: String(env[name] ?? "") }));
  const vars = VAR_NAMES.map((name) => ({ name, value: trimmed(env, name), raw: String(env[name] ?? "") }));
  const anySecret = secrets.some((item) => item.value.length > 0 || /[\0\r\n]/.test(item.raw));
  if (!anySecret) {
    return {
      mode: "skip",
      message: redact("Windows code signing skipped: AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET are absent. The build publishes an unsigned installer.", env),
      azureSignOptions: null,
    };
  }

  const problems = [];
  for (const item of secrets) {
    if (/[\0\r\n]/.test(item.raw)) problems.push(`${item.name} contains a line break`);
    else if (!item.value) problems.push(`${item.name} is missing`);
  }
  for (const item of vars) {
    if (/[\0\r\n]/.test(item.raw)) {
      problems.push(`${item.name} contains a line break`);
      continue;
    }
    if (!item.value) {
      problems.push(`${item.name} is missing`);
      continue;
    }
    if (item.name === "AZURE_SIGNING_ENDPOINT" && !validEndpoint(item.value)) {
      problems.push("AZURE_SIGNING_ENDPOINT must be an https address on codesigning.azure.net");
    }
    if (item.name === "AZURE_SIGNING_ACCOUNT" && !validAccount(item.value, 3, 24)) {
      problems.push("AZURE_SIGNING_ACCOUNT must be 3 to 24 letters or digits, start with a letter, and contain no repeated hyphens");
    }
    if (item.name === "AZURE_CERT_PROFILE" && !validAccount(item.value, 5, 100)) {
      problems.push("AZURE_CERT_PROFILE must be 5 to 100 letters or digits, start with a letter, and contain no repeated hyphens");
    }
    if (item.name === "AZURE_PUBLISHER_NAME" && !validPublisher(item.value)) {
      problems.push("AZURE_PUBLISHER_NAME must be the certificate subject, with no quotes or line breaks");
    }
  }
  if (problems.length) {
    const message = redact(
      `Windows code signing stopped: ${problems.join("; ")}. Set every Azure signing secret and variable, or leave AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET empty to publish an unsigned installer. Secret values are not printed.`,
      env,
    );
    return { mode: "incomplete", message, azureSignOptions: null };
  }

  const byName = Object.fromEntries(vars.map((item) => [item.name, item.value]));
  const azureSignOptions = {
    endpoint: byName.AZURE_SIGNING_ENDPOINT,
    codeSigningAccountName: byName.AZURE_SIGNING_ACCOUNT,
    certificateProfileName: byName.AZURE_CERT_PROFILE,
    publisherName: byName.AZURE_PUBLISHER_NAME,
    fileDigest: "SHA256",
    timestampRfc3161: TIMESTAMP_SERVER,
    timestampDigest: "SHA256",
  };
  const message = redact(
    `Windows code signing is on. The app executable and the NSIS installer will be signed, then latest.yml is written from the signed installer. Account: ${azureSignOptions.codeSigningAccountName}. Profile: ${azureSignOptions.certificateProfileName}. Endpoint: ${azureSignOptions.endpoint}. Publisher: ${azureSignOptions.publisherName}.`,
    env,
  );
  return { mode: "sign", message, azureSignOptions };
}

function applySigningConfig(env = process.env, { markerPath, log = () => {} } = {}) {
  const plan = signingPlan(env);
  if (plan.mode === "incomplete") throw new Error(plan.message);
  if (markerPath) {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    const body = plan.mode === "sign" ? "sign\n" : "skip\n";
    fs.writeFileSync(markerPath, body);
  }
  log(plan.message);
  if (plan.mode === "skip") return {};
  return { win: { azureSignOptions: plan.azureSignOptions } };
}

function unquote(value) {
  const text = String(value ?? "").trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith("\"") && text.endsWith("\""))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseLatestYml(text) {
  const out = { version: "", path: "", sha512: "", files: [] };
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^  - url:\s*(.*?)\s*$/);
    if (item) {
      current = { url: unquote(item[1]), sha512: "", size: null };
      out.files.push(current);
      continue;
    }
    const nested = line.match(/^    (sha512|size|url):\s*(.*?)\s*$/);
    if (nested && current) {
      if (nested[1] === "size") current.size = Number(unquote(nested[2]));
      else current[nested[1]] = unquote(nested[2]);
      continue;
    }
    const top = line.match(/^(version|path|sha512):\s*(.*?)\s*$/);
    if (top) out[top[1]] = unquote(top[2]);
  }
  return out;
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

function signingDecision(env, markerText) {
  const marker = String(markerText ?? "").trim();
  const secretsOn = SECRET_NAMES.some((name) => trimmed(env, name).length > 0 || /[\0\r\n]/.test(String(env[name] ?? "")));
  if (marker !== "" && marker !== "sign" && marker !== "skip") {
    return { error: "Windows signing marker must be sign or skip.", signature: false };
  }
  if (secretsOn && marker !== "sign") {
    return {
      error: "Windows code signing stopped: Azure signing secrets are set, and this build did not sign. Leave AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET empty to publish an unsigned installer.",
      signature: false,
    };
  }
  if (!secretsOn && marker === "sign") {
    return {
      error: "Windows code signing stopped: this build is marked signed, and the Azure signing secrets are absent in the check step.",
      signature: false,
    };
  }
  return { error: null, signature: marker === "sign" };
}

function authenticodeScript(filePath) {
  const file = String(filePath);
  if (!file || /['\r\n]/.test(file)) throw new Error("The signature check refused this file path.");
  return `Get-AuthenticodeSignature -LiteralPath '${file}' | Select-Object -ExpandProperty Status`;
}

async function verifyInstallerFeed({ dir, env = process.env, platform = process.platform, markerText = "", appExe = "win-unpacked/Meldmind.exe", signStatus = authenticodeStatus } = {}) {
  const errors = [];
  const decision = signingDecision(env, markerText);
  if (decision.error) errors.push(redact(decision.error, env));

  const ymlPath = path.join(dir, "latest.yml");
  if (!fs.existsSync(ymlPath)) {
    errors.push("latest.yml is missing, so the installer hash cannot be checked.");
    return { ok: false, errors, signature: decision.signature };
  }
  const parsed = parseLatestYml(fs.readFileSync(ymlPath, "utf8"));
  const named = parsed.files.length ? parsed.files : [{ url: parsed.path, sha512: parsed.sha512, size: null }];
  if (!parsed.path || !parsed.sha512) errors.push("latest.yml has no installer path or sha512.");

  let matched = false;
  for (const file of named) {
    if (!file.url) {
      errors.push("latest.yml lists an installer with no file name.");
      continue;
    }
    const installer = path.resolve(dir, file.url);
    const root = path.resolve(dir);
    if (installer !== root && !installer.startsWith(root + path.sep)) {
      errors.push("latest.yml names an installer outside the build folder.");
      continue;
    }
    if (!fs.existsSync(installer)) {
      errors.push(`latest.yml names ${file.url}, and that file is missing.`);
      continue;
    }
    const digest = await sha512Base64(installer);
    const size = fs.statSync(installer).size;
    if (file.sha512 !== digest) errors.push(`latest.yml sha512 does not match ${file.url}. Auto-update would reject this file.`);
    if (file.size != null && file.size !== size) errors.push(`latest.yml size does not match ${file.url}.`);
    if (parsed.path === file.url) {
      matched = true;
      if (parsed.sha512 !== digest) errors.push("latest.yml sha512 does not match the installer. Auto-update would reject this file.");
    }
    const blockmap = `${installer}.blockmap`;
    if (!fs.existsSync(blockmap) || fs.statSync(blockmap).size < 1) {
      errors.push(`${file.url}.blockmap is missing.`);
    }
  }
  if (parsed.path && !matched) errors.push("latest.yml path does not match a listed installer file.");

  if (decision.signature && platform === "win32" && errors.length === 0) {
    const files = [path.join(dir, appExe)];
    if (parsed.path) files.push(path.join(dir, parsed.path));
    for (const file of files) {
      if (!fs.existsSync(file)) {
        errors.push(`${path.basename(file)} is missing, so its signature cannot be checked.`);
        continue;
      }
      const status = signStatus(file);
      if (status !== "Valid") errors.push(`${path.basename(file)} signature status is ${status || "missing"}.`);
    }
  }

  const summary = decision.signature
    ? "latest.yml matches the signed installer."
    : "latest.yml matches the installer. Signing was skipped, so the file is unsigned.";
  return { ok: errors.length === 0, errors, signature: decision.signature, summary: errors.length ? "" : summary };
}

function authenticodeStatus(filePath) {
  const { execFileSync } = require("node:child_process");
  const script = authenticodeScript(filePath);
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  return String(out).trim();
}

module.exports = {
  SECRET_NAMES,
  VAR_NAMES,
  TIMESTAMP_SERVER,
  redact,
  signingPlan,
  applySigningConfig,
  parseLatestYml,
  sha512Base64,
  signingDecision,
  authenticodeScript,
  verifyInstallerFeed,
};
