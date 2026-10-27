// Send, reply, pay, delete, and the other acting words always wait for a click.
// A tool is read-only only when its name starts with a read word, has no risky word, and its description has none either (or the server marked it read-only).
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

// "Never send or post" (0.4.21, item P): the send family only, for an agent whose noSend switch is on.
// It reuses the word splitter and the classifier above: a tool counts as a sender only when its name or
// its description says send, post, publish, email, message, tweet, upload, dm, reply, forward, notify,
// notification, push or slack (and share or comment as a verb) AND riskyAction() already counts it as an
// action. Readers (read_email, list_files, search_inbox) are left in the list.
const SEND_WORD = /\b(send|sends|sending|sent|post|posts|posting|posted|publish|publishes|publishing|published|email|emails|message|messages|messaging|tweet|tweets|tweeting|tweeted|upload|uploads|uploading|uploaded|dm|reply|forward|notify|notification|slack|push)\b/i;
// Two of the new words only count as a verb (0.4.22, panel row 69): "share file" shares content
// while "share link info" only reads a link, and "write comment" posts while "get comment" and
// "list comments" only read. A reader-sounding NAME still scans its DESCRIPTION, as before.
const SEND_SHARE = /\bshares?\s+(?:a\s+|an\s+|the\s+|some\s+|these\s+|those\s+|my\s+|your\s+|our\s+)?(?:files?|photos?|pictures?|images?|videos?|audio|docs?|documents?|messages?|mail|posts?|notes?|cards?|decks?|albums?|folders?|playlists?|stories|attachments?|media|slides?|sheets?|reports?|contacts?|pages?)\b/i;
const SEND_COMMENT = /\b(?:write|post|add|create|submit|send|publish|place|insert|save|leave)\s+comments?\b/i;
// One blob hiding a sender inside it: sendmail, sendemail, posttweet, uploadpic.
const SEND_STEM = /^(send|posts?|publish|emails?|messages?|tweets?|uploads?)/;
const sendStem = (text) => String(text || "").split(/\s+/).some((t) => t.length > 4 && !READ_WORD.test(t) && SEND_STEM.test(t));
export function sendTool(tool) {
  const name = String(tool?.name || "");
  const blob = words(`${name} ${tool?.title || ""} ${tool?.description || ""}`);
  if (!SEND_WORD.test(blob) && !SEND_SHARE.test(blob) && !SEND_COMMENT.test(blob) && !sendStem(words(name))) return false;
  return riskyAction(tool);
}
// The list a noSend agent actually gets: senders out, readers and the rest still there.
export const filterSendTools = (list) => (Array.isArray(list) ? list : []).filter((t) => !sendTool(t));

export function riskyAction(tool) {
  const name = String(tool?.name || "");
  if (/^execute_zapier_write_action$/i.test(name)) return true;
  if (/^execute_zapier_read_action$/i.test(name)) return false;
  const nameWords = words(name);
  const nameRisky = RISKY.test(nameWords) || MORE_RISKY.test(nameWords) || hiddenStem(nameWords);
  const blob = words(`${name} ${tool?.title || ""} ${tool?.description || ""}`);
  // A reader is read-only by its NAME (0.4.20 rule, pinned by tests): list_files that mentions "post" in its description stays a reader.
  // 0.4.21 (audit E6): a reader NAME no longer hides a risky DESCRIPTION. A server that says get_status
  // "deletes all files and sends them by email" asks first. A server that marks the tool read-only
  // (readOnlyHint true) and a name with no risky word is still trusted as a reader.
  const descBlob = words(`${tool?.title || ""} ${tool?.description || ""}`);
  const descRisky = RISKY.test(descBlob) || MORE_RISKY.test(descBlob);
  if (READ_START.test(nameWords) && !nameRisky) return descRisky && tool?.annotations?.readOnlyHint !== true;
  if (nameRisky || RISKY.test(blob)) return true;
  // A hinted reader with no risky word can still run after Allow read-only.
  // The demo clock is one of those. A name like forward_email never takes this path.
  if (tool?.annotations?.readOnlyHint === true && !nameRisky) return false;
  return true;
}
