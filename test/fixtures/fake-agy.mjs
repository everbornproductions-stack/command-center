#!/usr/bin/env node
// A stand-in for the Antigravity CLI. Tests set FAKE_AGY_MODE. No network.
const mode = process.env.FAKE_AGY_MODE || "ok";
const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("agy 1.4.0\n");
  process.exit(0);
}

if (mode === "signin") {
  process.stderr.write("authentication required\n");
  process.exit(1);
}

if (mode === "quota") {
  const line = JSON.stringify({ event: "result", result: { status: "ERROR", response: "", error: "quota exceeded", usage: { input_tokens: 0, output_tokens: 0 } } });
  process.stdout.write(line + "\n");
  process.exit(1);
}

if (mode === "hang") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (mode === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 30000));
  process.stdout.write(JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "ok\n", usage: { input_tokens: 3, output_tokens: 1 } } }) + "\n");
  process.exit(0);
}

const secret = "sk-testsecretkey1234567890abcd";
const events = [
  { event: "init", conversation_id: "c1", init: { permission_mode: "request-review" } },
  { event: "step_update", step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "hello " } },
  { event: "step_update", step_update: { step_type: "agent_response", state: "DONE", text_delta: secret } },
  { event: "result", result: { conversation_id: "c1", status: "SUCCESS", response: `hello ${secret}\n`, usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 } } },
];
for (const ev of events) process.stdout.write(JSON.stringify(ev) + "\n");
process.exit(0);
