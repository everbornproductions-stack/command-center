// Send, reply, pay, delete, and the other acting words always wait for a click.
// A tool is read-only only when its name starts with a read word and has no risky word.
// Anything else asks, unless the server marked it read-only and the name has no risky word.
// Tool names use underscores, so send_mail and forward_email still count.
const RISKY = /\b(send|sends|sending|sent|post|posts|posting|posted|publish|publishes|publishing|published|charge|charges|charging|charged|pay|pays|paying|paid|payment|payments|purchase|purchases|purchasing|purchased|buy|buys|buying|bought|delete|deletes|deleting|deleted|reply|replies|replied|replying|forward|forwards|forwarded|forwarding|share|shares|shared|sharing|invite|invites|invited|inviting|submit|submits|submitted|submitting|transfer|transfers|transferred|transferring|refund|refunds|refunded|refunding|cancel|cancels|canceled|cancelled|canceling|cancelling|remove|removes|removed|removing|archive|archives|archived|archiving|move|moves|moved|moving|unsubscribe|unsubscribes|unsubscribed|unsubscribing|order|orders|ordered|ordering|checkout|checkouts|sign|signs|signed|signing|approve|approves|approved|approving|update|updates|updated|updating|edit|edits|edited|editing|write|writes|wrote|written|writing|create|creates|created|creating|schedule|schedules|scheduled|scheduling|book|books|booked|booking)\b/i;
const READ_START = /^(inspect|discover|list|get|search|find|lookup|read|view|fetch)\b/i;
// Extra acting words (0.4.20). Names are read word by word, so sendEmail, send-email, send_email and
// SendEmail all show the word "send". A name written as one lowercase blob (sendmail) is caught by the stems.
const MORE_RISKY = /\b(run|runs|running|exec|execute|executes|executed|executing|install|installs|installed|installing|deploy|deploys|deployed|deploying|overwrite|overwrites|grant|grants|granted|granting|reset|resets|kill|kills|killed|upload|uploads|uploaded|uploading|confirm|confirms|confirmed|place|places|placed|drop|drops|dropped|wipe|wipes|wiped|erase|erases|revoke|revokes|rename|renames|push|pushes|merge|merges|truncate|destroy|destroys|terminate|terminates|restart|restarts|shutdown|reboot|rm|unlink|tweet|broadcast|notify|notifies|withdraw|withdraws|donate|subscribe|subscribes|dispatch|disable|disables|disabled|disabling|export|exports|exported|exporting|download|downloads|downloaded|downloading|dm|dms)\b/i;
// Split on _ . / - spaces and camelCase / PascalCase / digit edges.
const words = (s) => String(s || "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  .replace(/[_./\-]+/g, " ");
// A single token that hides a risky stem inside it (sendmail, deletefile, payinvoice).
const HIDDEN = /^(send|post|publish|charge|purchase|delete|reply|forward|submit|transfer|refund|cancel|remove|archive|unsubscribe|checkout|approve|overwrite|execute|install|deploy|upload|wipe|erase|destroy|pay)/i;
const hiddenStem = (text) => String(text || "").split(/\s+/).some((t) => t.length > 4 && !READ_WORD.test(t) && HIDDEN.test(t));
const READ_WORD = /^(sender|senders|postal|postcode|poster|mailbox|emailaddress|payload|payee|payer)$/i;

export function riskyAction(tool) {
  const name = String(tool?.name || "");
  if (/^execute_zapier_write_action$/i.test(name)) return true;
  if (/^execute_zapier_read_action$/i.test(name)) return false;
  const nameWords = words(name);
  const nameRisky = RISKY.test(nameWords) || MORE_RISKY.test(nameWords) || hiddenStem(nameWords);
  const blob = words(`${name} ${tool?.title || ""} ${tool?.description || ""}`);
  if (READ_START.test(nameWords) && !nameRisky) {
    // 0.4.21: a read-sounding name can still act ("get_report ... and email it"), so the description is read too,
    // unless the server itself marked the tool read-only.
    if (tool?.annotations?.readOnlyHint === true) return false;
    return RISKY.test(blob) || MORE_RISKY.test(blob);
  }
  if (nameRisky || RISKY.test(blob) || MORE_RISKY.test(blob)) return true;
  // A hinted reader with no risky word can still run after Allow read-only.
  // The demo clock is one of those. A name like forward_email never takes this path.
  if (tool?.annotations?.readOnlyHint === true && !nameRisky) return false;
  return true;
}
