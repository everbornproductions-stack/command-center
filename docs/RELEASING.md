# Releasing a new version of Meldmind (so the in-app update button finds it)

The Windows app checks for updates when it starts and every 30 minutes. People can also press
**Help > Check for updates** (the top-bar menu that also has Settings and Take the tour again).
When a newer version is out, the top bar shows **Update available**. After it has downloaded, the
same button says **Restart to update**. A banner still offers **Update and restart**. Nothing downloads until they click it.

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
   that note once after the update (and once on a first launch). If the release adds or changes
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
6. **Check.** Open the installed app, Settings, **Check for updates**. It should say
   "Update available: vX.Y.Z". Click **Update and restart**.

## Good to know

- Do not publish a release as a draft or pre-release; the app only looks at normal releases.
- Do not rename the files; `latest.yml` points at the exact installer name.
- The portable .exe in `dist\` does not self-update. Only the installed (Setup) version does.
- The app is not code-signed yet, so Windows SmartScreen may warn on the first install
  ("More info" then "Run anyway"). Updates install without that prompt.
- Never put a token, service key, or password into `electron-builder.yml` or the app. The publishable key is injected from `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` at build time and is not committed.
- The phone / web app updates itself when the hub is updated; it shows "New version available, Refresh".

## Windows on GitHub Actions

`.github/workflows/release-windows.yml` runs on a Windows runner when you push a tag `vX.Y.Z` or start it by hand (Actions, Windows release, Run workflow). The tag must match `package.json` (`v0.4.6` when the version is `0.4.6`).

It runs `npm ci`, then `npm test`. If that test run fails, the job runs `npm test` once more before it stops. It then runs `npm run smoke`. It then runs the same publishable-key check as `npm run dist`. The key is `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` (the build reads `CC_SUPABASE_ANON_KEY` first). Each name may be a repo secret or, when that secret is empty, a repository variable of the same name. The job stops when neither is set. Before the installer is built, and before anything is published, it runs `npm run smoke:packaged`. That step checks every bare package import under `server/` and the Electron main process is listed in `dependencies` (Node built-ins and `electron` are allowed). It builds the unpacked app with `electron-builder --dir`, starts it headless with a temporary user-data folder, and waits up to 60 seconds for `/api/health`. The job fails if the engine does not answer, or if the log contains "server failed". The process tree and the temporary folder are removed afterwards. This smoke does not write the publishable key. `npm run dist` then writes that publishable key into the installer and clears it again. The job checks that `Meldmind-Setup-X.Y.Z.exe` is a real installer and that `latest.yml` names it, then publishes a normal release (not a draft, not a pre-release) on `everbornproductions-stack/command-center-releases` with these three files:

- `Meldmind-Setup-X.Y.Z.exe`
- `Meldmind-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`

Add both secrets at https://github.com/everbornproductions-stack/command-center/settings/secrets/actions

- `CC_SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key (`sb_publishable_...`). Never the service key. Set either name as a secret or as a repository variable. Without one of them the workflow stops, because an empty key would leave every installed copy on the Free tier.
- `RELEASES_TOKEN`: a fine-grained token with Contents read and write on `everbornproductions-stack/command-center-releases` only. The workflow uses it to upload the release. It is not built into the app.

`.github/workflows/windows-ci.yml` runs on every pull request and every push to `main`. It runs `npm ci`, `npm test`, `npm run smoke`, `npm run smoke:packaged`, and `npm run dist` on a Windows runner. The packaged smoke is the same unpacked launch as the release job: `electron-builder --dir`, a headless start, and a wait of up to 60 seconds for `/api/health`. It does not publish, and it does not read signing secrets or the publishable key. That package is not a release installer.

## Mac (unsigned for now)

- GitHub Actions workflow **Mac build**. It is parked at `docs/ci/mac-build.yml` because the PC's GitHub login cannot push workflow files yet. To turn it on: run `gh auth refresh -s workflow` once, then `git mv docs/ci/mac-build.yml .github/workflows/mac-build.yml`, commit and push. The workflow builds `Meldmind-<version>-<arch>.dmg` and `.zip` on a Mac runner. Start it from the Actions tab (Run workflow) after the Windows release is up, or push a `vX.Y.Z` tag.
- One-time setup: add the repo secret `RELEASES_TOKEN` (Settings > Secrets and variables > Actions) holding a fine-grained token with Contents read and write on `command-center-releases` only. Without it, the files are still downloadable from the workflow run's artifacts.
- The workflow runs `npm test`, `npm run smoke` and `npm run dist:mac` (x64 and arm64). It never publishes: if the release `vX.Y.Z` does not exist yet, it creates it as a **draft** with the Mac files, and you add the Windows files and publish it as usual. If the Windows release is already published, the Mac files and `latest-mac.yml` are added to it.
- Mac app data lives in `~/Library/Application Support/Everborn Command` (same folder name as Windows, kept across updates). Keys are sealed with the macOS Keychain through the desktop app.
- TODO (needs an Apple Developer account, $99/year): signing and notarization. Until then Mac users right-click the app and choose Open the first time, and the in-app update button cannot install on Mac (Apple only allows signed apps to self-update). On a Mac, "Install now" opens the release page so they download the new .dmg instead. Once signing is on, set `MAC_SELF_UPDATE = true` in electron/main.cjs.
