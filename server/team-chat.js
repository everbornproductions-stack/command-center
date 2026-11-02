// 0.4.39 (Chris: agents as a team): which helper answers a chat. The Simple hint picks an employee by its plain id;
// Chat with it on a Team desk passes the desk's id ("emp-<id>" for an employee, the id of one of My agents).
// The chat is a normal chat: no task is made, and the agent's own "Never send or post" switch still applies.
import { employeeRunOptions, getEmployee } from "./employees.js";
import { getAgent, runOptions } from "./custom-agents.js";

export function chatStaff(id, { prompt, projectId = null } = {}) {
  const s = String(id || "");
  const empId = s.startsWith("emp-") && getEmployee(s.slice(4)) ? s.slice(4) : s;
  if (getEmployee(empId)) { const o = employeeRunOptions(empId, { prompt, projectId }); return { system: o.system, agent: o.agent, tools: o.tools }; }
  const a = getAgent(s);
  if (!a) throw Object.assign(new Error("That agent is not on your team any more."), { status: 404 });
  const o = runOptions(a, { prompt, projectId });
  const out = { system: o.system, agent: o.agent, tools: o.tools, agentId: o.agentId };
  if (o.provider && o.model) { out.provider = o.provider; out.model = o.model; }
  if (o.toolAllow) out.toolAllow = o.toolAllow;
  if (o.noSend) { out.noSend = true; out.sendMessages = false; }
  return out;
}
