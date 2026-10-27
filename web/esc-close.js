// Escape closes a dialog wherever the focus is (0.4.21, dogfood 04: "Who will read this" ignored Esc when the focus
// was not inside the box, for example after a mouse click on the page behind it or a screen reader move).
// The key is listened for on the whole page while the dialog is open; the newest open dialog closes first.
const open = [];
let bound = false;
function onKey(e) {
  if (e.key !== "Escape") return;
  while (open.length && !open[open.length - 1].el.isConnected) open.pop();
  const top = open[open.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}
export function closeOnEscape(el, close) {
  if (!bound && typeof document !== "undefined" && typeof document.addEventListener === "function") { document.addEventListener("keydown", onKey, true); bound = true; }
  const entry = { el, close };
  open.push(entry);
  return () => { const i = open.indexOf(entry); if (i >= 0) open.splice(i, 1); };
}
export const openDialogCount = () => open.filter((x) => x.el.isConnected).length;
