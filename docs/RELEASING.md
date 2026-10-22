# Releasing a new version of Meldmind (so the in-app update button finds it)

The Windows app checks for updates when it starts, when it is opened again from the shortcut, and every hour. People can also press
**Help > Check for updates** (the top-bar Help menu, and the Help page).
When a newer version is out, the app shows **Update ready, restart**. Nothing downloads until they click it.
If the check cannot read the public `latest.yml`, it shows **Couldn't check for updates** with **Download**, which opens the releases page.

Since v0.3.2 the updater runs in the Electron main process (electron/updater.cjs), not in the local server. On launch the app shows a "Meldmind vX.Y.Z is ready" window (Install now / Later), and the tray menu has Check for updates, Install update and Restart app. This works even when the engine or the window fails, so a broken build can still update itself.

Updates come from GitHub Releases in the PUBLIC repo `everbornproductions-stack/command-center-releases`.
The source code repo (`command-center`) stays private. The releases repo only holds installers and
release notes. No token is built into the app, so the releases repo must stay public.

User data (settings, encrypted keys, ledger, projects) lives in `%APPDATA%\Everborn Command\data` (the folder keeps
its original name on purpose, so data survives the rename to Meldmind),
not in the install folder, so updating or reinstalling keeps it.

## Steps (on the Windows PC, in the command-center folder)

1. **Bump the version.** Pick the next number: `npm version minor --no-git-tag-version`
   (0.2.0 becomes 0.3.0) or `npm version patch --no-git-tag-version` for a small fix (0.2.0 becomes 0.2.1).
   The update only shows if the new number is higher than the installed one.
   Then add that same version to `docs/WHATS-NEW.json` with plain-language bullets. The app shows
   that note once on the first launch after the update (and once on a first install, for the new
   version only). After an update it lists every bundled note from the version that was installed
   through the new one, newest first, including versions that were skipped. The notes are in the
   app, so they work offline. Settings and Help can open the same note again. The pre-install
   update prompt still uses the one release note from the update feed. If the release adds or changes
   something people see, add or update a step in the onboarding tour (`web/features/tour.js`).
   `npm test` fails when `package.json` version has no What's new entry. Also set
   `docs/help/catalog.json` `lastUpdatedVersion` to that same version, and update the help
   article a person would open for each What's new bullet (set that article's
   `lastUpdatedVersion` to the new version). `npm test` fails when the catalog is behind,
   when no article is stamped with the new version, or when a What's new bullet has no
   matching words in those updated articles. The installer keeps `docs/WHATS-NEW.json` and
   `docs/help/` even though the rest of `docs/` is left out.
2. **Test.** `npm test` and `npm run smoke`. Both must pass.
3. **Commit and push** the version bump: `git add package.json package-lock.json` then
   `git commit -m "Release vX.Y.Z"` and `git push`.
4. **Build.** Set `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` to the Supabase
   publishable key (it starts with `sb_publishable_`). Never use the service key, and do not
   commit the value. `npm run dist` (and `npm run dist:mac`) writes that key into
   `server/cloud-defaults.json` for the installer, then puts the empty value back.
   If neither variable is set, the release build stops and says so. Without the key every
   installed copy stays on the Free tier and `EVERBORN-OWNER` cannot redeem.
   On GitHub Actions the same names are repo secrets (see `docs/ci/mac-build.yml`).
   This makes three files in `dist\` that matter:
   - `Meldmind-Setup-X.Y.Z.exe` (the installer)
   - `Meldmind-Setup-X.Y.Z.exe.blockmap` (lets updates download only what changed)
   - `latest.yml` (tells the app what the newest version is)
5. **Publish the release** (replace X.Y.Z):

   ```
   gh release create vX.Y.Z --repo everbornproductions-stack/command-center-releases --title "Meldmind vX.Y.Z" --notes "What changed, in plain words" dist\Meldmind-Setup-X.Y.Z.exe dist\Meldmind-Setup-X.Y.Z.exe.blockmap dist\latest.yml
   ```

   All three files must be on the same release. If the upload drops (large files from this PC can),
   upload the missing file again with
   `gh release upload vX.Y.Z <file> --repo everbornproductions-stack/command-center-releases --clobber`.
   You can also drag the files onto the release page on github.com.
6. **Check.** Open the installed app and choose **Help > Check for updates**. It should say
   **Update ready, restart** for vX.Y.Z. Nothing downloads until that click. If the check
   cannot read the release, it says **Couldn't check for updates** and **Download** opens the releases page.

## Good to know

- Do not publish a release as a draft or pre-release; the app only looks at normal releases.
- Do not rename the files; `latest.yml` points at the exact installer name.
- The portable .exe in `dist\` does not self-update. Only the installed (Setup) version does.
- Until Windows code signing is set up (see "Windows code signing" below), the installer is not signed, so Windows SmartScreen may warn on the first install
  ("More info" then "Run anyway"). Updates install without that prompt.
- Never put a token, service key, or password into `electron-builder.yml` or the app. The publishable key is injected from `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` at build time and is not committed.
- The phone / web app updates itself when the hub is updated; it shows "New version available, Refresh".

## Windows on GitHub Actions

`.github/workflows/release-windows.yml` runs on a Windows runner when you push a tag `vX.Y.Z` or start it by hand (Actions, Windows release, Run workflow). The tag must match `package.json` (`v0.4.5` when the version is `0.4.5`).

It runs `npm ci`, then `npm test`. If that test run fails, the job runs `npm test` once more before it stops. It then runs `npm run smoke`. It then runs the same publishable-key check as `npm run dist`. The key is `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` (the build reads `CC_SUPABASE_ANON_KEY` first). Each name may be a repo secret or, when that secret is empty, a repository variable of the same name. The job stops when neither is set. `npm run dist` writes that publishable key into the installer and clears it again. The job checks that `Meldmind-Setup-X.Y.Z.exe` is a real installer and that `latest.yml` names it, then publishes a normal release (not a draft, not a pre-release) on `everbornproductions-stack/command-center-releases` with these three files:

- `Meldmind-Setup-X.Y.Z.exe`
- `Meldmind-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`

Add both secrets at https://github.com/everbornproductions-stack/command-center/settings/secrets/actions

- `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key (`sb_publishable_...`). Never the service key. Set either name as a secret or as a repository variable. Without one of them the workflow stops, because an empty key would leave every installed copy on the Free tier.
- `RELEASES_TOKEN`: a fine-grained token with Contents read and write on `everbornproductions-stack/command-center-releases` only. The workflow uses it to upload the release. It is not built into the app.

`.github/workflows/windows-ci.yml` runs on every pull request and every push to `main`. A pull request runs `npm ci`, `npm test`, and `npm run smoke` only. A push to `main` also runs `npm run dist`. A new push cancels the older run of that ref. It does not publish, and it does not read signing secrets or the publishable key. That package is not a release installer.

## Windows code signing (Azure Artifact Signing)

The release job signs the Windows installer with Microsoft Azure Artifact Signing (it used to be called Trusted Signing) through electron-builder's built-in `azureSignOptions`. Signing turns on by itself once all seven values below exist. Until then the job builds unsigned, exactly as before, and the build step prints one line:

`Code signing is not set up yet, building unsigned.`

After the build, the step "Verify the installer signature" runs `Get-AuthenticodeSignature` on `Meldmind-Setup-X.Y.Z.exe` and prints `Valid` or `NotSigned`. It fails the job only when signing is set up but the installer is not validly signed. An unsigned installer while signing is not set up does not fail. Pull request CI (`windows-ci.yml`) and the Mac build stay unsigned. No value is printed to the log.

One-time setup, in this order:

1. **Identity validation.** In the Azure portal, create an Artifact Signing account (search for "Artifact Signing" or "Trusted Signing"), then open Identity validation and start a Public validation for Everborn Productions. Microsoft checks the business. This can take days. Nothing can be signed until it says Completed.
2. **Certificate profile.** In the same account, open Certificate profiles and create a Public Trust profile linked to that identity validation. Note the account name, the profile name, and the account endpoint (for example `https://eus.codesigning.azure.net/`, it depends on the region you picked).
3. **App registration.** In Microsoft Entra ID, open App registrations, create one (for example "Meldmind release signing"), and add a client secret under Certificates and secrets. Note the Directory (tenant) ID, the Application (client) ID, and the secret value (it is shown once).
4. **Role.** On the Artifact Signing account (or on the certificate profile), open Access control (IAM), Add role assignment, pick **Artifact Signing Certificate Profile Signer** (older portals call it Trusted Signing Certificate Profile Signer), and assign it to that app registration.
5. **GitHub.** At https://github.com/everbornproductions-stack/command-center/settings/variables/actions add these repository variables (they are not secret):
   - `AZURE_SIGNING_ENDPOINT`: the account endpoint from step 2.
   - `AZURE_SIGNING_ACCOUNT`: the Artifact Signing account name.
   - `AZURE_SIGNING_PROFILE`: the certificate profile name.
   - `AZURE_SIGNING_PUBLISHER`: the publisher name exactly as it shows in the certificate (the validated business name).

   At https://github.com/everbornproductions-stack/command-center/settings/secrets/actions add these repository secrets:
   - `AZURE_TENANT_ID`: the Directory (tenant) ID.
   - `AZURE_CLIENT_ID`: the Application (client) ID.
   - `AZURE_CLIENT_SECRET`: the client secret value.

The three secrets go only to the build step. The next tagged release then prints `Code signing is set up. The installer will be signed with Azure Artifact Signing.` and the verify step should print `Valid`. The client secret expires (the portal shows when). Make a new one before then and update `AZURE_CLIENT_SECRET`, or the release stops at the verify step.

### One-click Sign in with Google: the client secret

The Google and Microsoft sign-in app ids are public and are in `server/oauth-clients.json`. Microsoft needs no secret. Google's desktop sign-in app also needs its client secret when Meldmind trades the sign-in code for a token. That secret is never committed.

- Add the repository secret `GOOGLE_OAUTH_CLIENT_SECRET` at https://github.com/everbornproductions-stack/command-center/settings/secrets/actions. The value is the client secret of the Google Cloud OAuth client "Meldmind" (Desktop app).
- The release workflow gives it only to the build steps (Windows and Mac). `npm run dist` and `npm run dist:mac` write it into `server/oauth-clients.json` for the build (`scripts/inject-oauth-secret.mjs`, called by `scripts/inject-cloud-key.mjs`) and put the file back when the build ends. The value is never printed.
- Without it the build still finishes and prints one line saying the secret is not set. Sign in with Google then shows "coming soon" and the Advanced own-client path. Sign in with Microsoft still works.
- For a local run, set `CC_GOOGLE_CLIENT_SECRET` in that shell only. Do not put it in a file.

`.github/workflows/mac-ci.yml` runs when you push a tag `vX.Y.Z` or start it by hand. It does not run on a pull request or on a push to `main`. It runs `npm ci`, `npm test`, and `npm run smoke` on a Mac runner. A new run cancels the older run of that ref. It does not build a disk image, does not publish, and does not read a secret. The unsigned installer workflow stays parked at `docs/ci/mac-build.yml`.

## Mac (unsigned for now)

- The Windows release workflow (`.github/workflows/release-windows.yml`) has a `mac-release` job. A `vX.Y.Z` tag, or Run workflow, builds an unsigned `Meldmind-<version>-<arch>.dmg` and `.zip` (x64 and arm64) with electron-builder. There is no Apple signing.
- `.github/workflows/mac-ci.yml` runs `npm test` and `npm run smoke` on macOS when you push a tag `vX.Y.Z` or start it by hand. It does not run on a pull request or on a push to `main`. It does not build a disk image.
- One-time setup: add the repo secret `RELEASES_TOKEN` (Settings > Secrets and variables > Actions) holding a fine-grained token with Contents read and write on `command-center-releases` only. Without it, the files are still downloadable from the workflow run's artifacts.
- The Mac job runs `npm test`, `npm run smoke` and `npm run dist:mac`. It never publishes: if the release `vX.Y.Z` does not exist yet, it creates it as a **draft** with the Mac files, and the Windows job adds the installer and publishes it as usual. If the Windows release is already published, the Mac files and `latest-mac.yml` are added to it. The Mac job does not upload `latest.yml`.
- Mac app data lives in `~/Library/Application Support/Everborn Command` (same folder name as Windows, kept across updates). Keys are sealed with the macOS Keychain through the desktop app.
- First open: right-click the app, then Open. Help says the same thing.
- TODO (needs an Apple Developer account, $99/year): signing and notarization. Until then Gatekeeper warns on the first open, and in-app updates cannot install on Mac (Apple only allows signed apps to self-update). Automatic updates for Mac are coming soon. On a Mac, Install now opens the release page so you download the new .dmg instead. Once signing is on, set `MAC_SELF_UPDATE = true` in electron/main.cjs.
