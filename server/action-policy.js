// Send, reply, pay, delete, and the other acting words always wait for a click.
// A tool is read-only only when its name starts with a read word and has no risky word.
// Anything else asks, unless the server marked it read-only and the name has no risky word.
// Tool names use underscores, so send_mail and forward_email still count.
const RISKY = /\b(send|sends|sending|sent|post|posts|posting|posted|publish|publishes|publishing|published|charge|charges|charging|charged|pay|pays|paying|paid|payment|payments|purchase|purchases|purchasing|purchased|buy|buys|buying|bought|delete|deletes|deleting|deleted|reply|replies|replied|replying|forward|forwards|forwarded|forwarding|share|shares|shared|sharing|invite|invites|invited|inviting|submit|submits|submitted|submitting|transfer|transfers|transferred|transferring|refund|refunds|refunded|refunding|cancel|cancels|canceled|cancelled|canceling|cancelling|remove|removes|removed|removing|archive|archives|archived|archiving|move|moves|moved|moving|unsubscribe|unsubscribes|unsubscribed|unsubscribing|order|orders|ordered|ordering|checkout|checkouts|sign|signs|signed|signing|approve|approves|approved|approving|update|updates|updated|updating|edit|edits|edited|editing|write|writes|wrote|written|writing|create|creates|created|creating|schedule|schedules|scheduled|scheduling|book|books|booked|booking)\b/i;
const READ_START = /^(inspect|discover|list|get|search|find|lookup|read|view|fetch)\b/i;
const words = (s) => String(s || "").replace(/[_./-]+/g, " ");

export function riskyAction(tool) {
  const name = String(tool?.name || "");
  if (/^execute_zapier_write_action$/i.test(name)) return true;
  if (/^execute_zapier_read_action$/i.test(name)) return false;
  const nameWords = words(name);
  if (READ_START.test(nameWords) && !RISKY.test(nameWords)) return false;
  const blob = words(`${name} ${tool?.title || ""} ${tool?.description || ""}`);
  if (RISKY.test(blob)) return true;
  // A hinted reader with no risky word can still run after Allow read-only.
  // The demo clock is one of those. A name like forward_email never takes this path.
  if (tool?.annotations?.readOnlyHint === true && !RISKY.test(nameWords)) return false;
  return true;
}
