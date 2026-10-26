# Welcome email

Chris asked for this on 2026-10-21. The locked spec in docs/DECISIONS.md (item 22) is unchanged and still says it is not in the run order. This page is how the sender works. It does not deploy anything, and it does not touch Stripe.

## When it sends

The app queues one welcome per email address:

- Website download signup: `POST /api/welcome/signup` with `{ email, firstName, source: "download" }`.
- In-app account creation: the same route with `source: "account"`.
- A licence that activates: `server/license.js` queues the welcome after a successful check. Tier `pro` is recorded as a Pro purchase (that is how a Stripe Pro purchase shows up). Any other tier is a licence redeem. A mail problem does not fail the licence check. The same email is not sent again on a later recheck.

The provider is `none` until it is changed. In that state the queue returns `{ sent: false, reason: "disabled" }` and nothing leaves the machine.

## Template

`emails/welcome.html` and `emails/welcome.txt` are the only copies. Placeholders are `{{FIRST_NAME}}` and `{{INSTALL_URL}}`. The HTML is a single column, max width 560, and it uses Meldmind colours. The install link is one page with the Windows installer and the Mac download. The default page is `https://everbornproductions.com/command-center/`.

The letter says the account is ready, that chats and settings back up automatically, that they are hosted on Everborn's Supabase, that each person sees only their own data (row level security), and how to add AI keys or connect via MCP from Settings. Nothing in the product is sent until the person clicks. The letter makes no income or results claims.

## Provider

Config document `welcome.mail`:

```json
{ "provider": "none", "from": "Meldmind <hello@everbornproductions.com>", "installUrl": "https://everbornproductions.com/command-center/" }
```

`POST /api/welcome/config` accepts `provider`, `from`, and `installUrl`. It refuses `key`, `apiKey`, `token`, `secret`, and `serviceKey`. The mail key is vault id `welcome-mail` (`{ key }`). Chris sets that secret on the server. It is never written into the template, the docs, or a test.

`registerMailProvider(name, fn)` adds another sender. The built-in name is `resend`. It posts to the Resend email API with the vault key as a bearer token. The key is not logged. With no key the result is `{ sent: false, reason: "no-key" }`.

The Supabase service key is not read by this module. It stays in the hosted server environment, as it does today.

## Tests

`CC_INSTANCE` on every test server starts with `test-`. `liveMailAllowed()` is then false, so a configured provider still does not send. Unit tests pass their own `fetchImpl` and do not call the network. Do not put a real key in the vault for a test.
