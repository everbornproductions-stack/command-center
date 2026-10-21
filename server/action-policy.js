// Send, post, charge, pay, and delete always wait for a click.
// A read or a list does not, once the person has allowed read-only tools.
// Tool names use underscores, so send_mail and charge_card still count.
const SEND = /\b(send|sends|sending|post|posts|posting|publish|publishes|publishing|charge|charges|charging|pay|pays|payment|purchase|purchases|buy|delete|deletes|deleting)\b/i;
const words = (s) => String(s || "").replace(/[_./-]+/g, " ");

export function riskyAction(tool) {
  const name = String(tool?.name || "");
  if (/^execute_zapier_write_action$/i.test(name)) return true;
  if (/^execute_zapier_read_action$/i.test(name)) return false;
  const nameWords = words(name);
  if (/^(inspect|discover|list|get|search|find|lookup)\b/i.test(nameWords) && !SEND.test(nameWords)) return false;
  const blob = words(`${name} ${tool?.title || ""} ${tool?.description || ""}`);
  return SEND.test(blob);
}
