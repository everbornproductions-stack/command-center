# Releasing a new version of Command AI (so the in-app update button finds it)

The Windows app checks for updates when it starts and every 4 hours. People can also press
**Settings > Check for updates**. When a newer version is out, a banner says
"Update available: vX.Y.Z" with an **Update and restart** button. Nothing downloads until they click it.

Updates come from GitHub Releases in the PUBLIC repo `everbornproductions-stack/command-center-releases`.
The source code repo (`command-center`) stays private. The releases repo only holds installers and
release notes. No token is built into the app, so the releases repo must stay public.

User data (settings, encrypted keys, ledger, projects) lives in `%APPDATA%\Everborn Command\data` (the folder keeps
its original name on purpose, so data survives the rename to Command AI),
not in the install folder, so updating or reinstalling keeps it.

## Steps (on the Windows PC, in the command-center folder)

1. **Bump the version.** Pick the next number: `npm version minor --no-git-tag-version`
   (0.2.0 becomes 0.3.0) or `npm version patch --no-git-tag-version` for a small fix (0.2.0 becomes 0.2.1).
   The update only shows if the new number is higher than the installed one.
2. **Test.** `npm test` and `npm run smoke`. Both must pass.
3. **Commit and push** the version bump: `git add package.json package-lock.json` then
   `git commit -m "Release vX.Y.Z"` and `git push`.
4. **Build.** `npm run dist`. This makes three files in `dist\` that matter:
   - `Command-AI-Setup-X.Y.Z.exe` (the installer)
   - `Command-AI-Setup-X.Y.Z.exe.blockmap` (lets updates download only what changed)
   - `latest.yml` (tells the app what the newest version is)
5. **Publish the release** (replace X.Y.Z):

   ```
   gh release create vX.Y.Z --repo everbornproductions-stack/command-center-releases --title "Command AI vX.Y.Z" --notes "What changed, in plain words" dist\Command-AI-Setup-X.Y.Z.exe dist\Command-AI-Setup-X.Y.Z.exe.blockmap dist\latest.yml
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
- Never put a token, key or password into `electron-builder.yml` or the app.
- The phone / web app updates itself when the hub is updated; it shows "New version available, Refresh".
