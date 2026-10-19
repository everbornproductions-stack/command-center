# History import and encrypted sync (Phase 23)

## Import your ChatGPT and Claude chats

1. Ask for your export:
   - ChatGPT: Settings > Data controls > Export data.
   - Claude: Settings > Privacy > Export data.
   Each service emails you a link to a .zip.
2. In Meldmind, open the **History** tab. Pick the zip, or type where it is on this PC (handy for very large exports). Click **Read the file**.
3. Check the preview: how many chats and messages, the date range, the newest titles and, for Claude, the projects inside. Nothing is filed yet.
4. Choose where the chats go: a new project per source ("Imported from ChatGPT", and one per Claude project), a project you already have, or no project. Click **Import**.

What you get:
- Every chat keeps its title, its dates and every message in order. Each one is in the run history as an "imported" run and opens like any answer.
- ChatGPT: only the thread you saw is kept. Earlier edited branches, hidden system messages and tool output are left out. Images show as `[image]`.
- Claude: attachments show as `[attached: file name]`, tool use as `[used a tool: name]`.
- Importing the same export again adds nothing. A newer export updates only the chats that changed.
- On the Free plan (one project), "a new project" files the chats without a project and says so.

Privacy: the zip is read on this PC only. It is never uploaded, and nothing from it is sent to any AI. Import works on the desktop app only; the hosted hub refuses it.

A bad file gets a plain message: not a zip, cut off, damaged, password protected, no conversations.json, or not the ChatGPT or Claude format.

Limits: 512 MB through the file picker, 1 GB by location on this PC, 50,000 chats per import.

## Sync chats with your phone (optional, off by default)

Sync keeps your chats on the desktop and your phone in step through **your own Supabase project**. Everything is end-to-end encrypted:

- A key is made from your passphrase (PBKDF2-SHA256, 600,000 rounds, a random salt per sync space). The passphrase and the key never leave your devices.
- Each chat is sealed with AES-256-GCM before it leaves the PC. Supabase stores only the sealed copy, an id that is itself a keyed hash (so not even chat ids are visible), and a sequence number. It never stores titles, text, the passphrase or the key.
- Lose the passphrase and nobody can open the copies, us included.
- What syncs: single-AI chats and imported chats. Councils and missions stay on the PC.

Set up once:
1. Run `supabase/sync.sql` on your Supabase project in the SQL editor. Chris decides when; it has not been run on any live project.
2. Fill in Settings > Cloud (project address and publishable key) on the desktop.
3. In History > Sync, type a passphrase of 10 or more characters twice and click **Turn on sync**. You get a sync code such as `ABCDE-FGH23-JKLMN-PQRS4`.
4. On another desktop, enter the same code and passphrase. On the phone, open the hosted hub, go to History and unlock with the code and passphrase. The phone unlocks the chats in its browser; the hub server never sees them, and nothing stays after the page is closed.

The desktop syncs every 10 minutes while the app runs, or when you click **Sync now**. **Turn off** forgets the key on this PC. Tick "delete the locked copies in the cloud" to empty the space too.

Remember on this PC: the key, not the passphrase, is kept in the Windows vault (DPAPI). Untick it to keep it only until the app closes.

How access is controlled: the tables have row-level security on with no policies. The only way in is four functions. Push, pull and delete need a token derived from the key; the server keeps only its SHA-256. The sync code alone returns the salt and a sealed check value, which a second device needs to tell a wrong passphrase from a wrong code. Treat the code as private.
