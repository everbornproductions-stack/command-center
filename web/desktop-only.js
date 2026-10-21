// Features that need this computer. The hosted web app hides them.
// The same list is served to the browser as ids. It does not hide a feature on the desktop app.
export const DESKTOP_ONLY = [
  "setup",
  "libraries",
  "bookmarks",
  "hotkey",
  "projectfiles",
  "updates",
  "extension",
  "browser",
];

export function isDesktopOnly(id) {
  return DESKTOP_ONLY.includes(id);
}
