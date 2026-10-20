# Mail accounts

Gmail, Google (the browser helper) and Outlook can each have more than one account. The first account for a provider is the one that already existed: its token stays on the vault id it has always used (`google-helper`, `mail-gmail`, `mail-outlook`). Each account added after that stores its token in the same vault under `mail-acct-<id>`.

Nothing in this module logs a token, a refresh token, an authorization code, or a client secret. The setup wizard is a separate change. It should call this API and should not add its own copy of these routes.

## Functions (`server/mail-accounts.js`)

- `listAccounts(provider?)` returns public rows. `provider` is `google`, `gmail`, `outlook`, or omitted for all three. A row is `{ id, provider, label, isDefault, legacy, connected, needsSignIn, scopes, connectedAt }`. No token fields.
- `addAccount({ provider, label })` creates a labeled account that is not connected yet. The label is one line, up to 40 characters. The first account for that provider becomes the default.
- `removeAccount(id)` deletes the account and its vault token. Removing the original account keeps the OAuth client secret in the vault.
- `setDefaultAccount(id)` chooses the account a task uses when the task does not name one.
- `setAccountLabel(id, label)` renames an account.

`google` is the browser helper sign-in (Gmail and Drive together). `gmail` and `outlook` are the read-only receipt mailboxes on the Subscriptions page.

## HTTP

| Method | Path | Body | Calls |
| --- | --- | --- | --- |
| GET | `/api/mail-accounts` | | `listAccounts` |
| GET | `/api/mail-accounts?provider=google` | | `listAccounts("google")` |
| POST | `/api/mail-accounts` | `{ provider, label }` | `addAccount` |
| DELETE | `/api/mail-accounts/:id` | | `removeAccount` |
| POST | `/api/mail-accounts/:id/default` | | `setDefaultAccount` |
| POST | `/api/mail-accounts/:id/label` | `{ label }` | `setAccountLabel` |

Connect an account with the sign-in that provider already has, and pass `accountId` from `addAccount`:

- Browser helper Google: `POST /api/browser/google/start` with `{ origin, gmail, drive, send, accountId }`, then `POST /api/browser/google/finish` with `{ code, state }`. The pending sign-in remembers `accountId`. Leaving `accountId` out connects the original Google account.
- Receipt mail: `POST /api/services/mail/start` with `{ source, origin, accountId }` (`source` is `gmail` or `outlook`), then `POST /api/services/mail/finish` with `{ code, state }`.

## Tasks

- `POST /api/browser/jobs` accepts `accountId`. That job's Gmail and Drive calls use that Google account. Councils and missions omit it and use the default.
- `POST /api/services/mail/scan` accepts `accountId` for `gmail` or `outlook`. Omitted, the scan uses the default account.

The Settings pages show **Add another account**, a label on each row, a default choice, and the task picker (Send to Browser helper, and Scan for receipts). Those pages are not the setup wizard.
