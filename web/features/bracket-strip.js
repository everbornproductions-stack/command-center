// A small strip above the chat box that lists the [blanks] in a prompt and lets the person type each one
// (0.4.21). Typing fills every copy of that blank in the box. Nothing is sent; Send stays the person's click.
import { bracketFields, fillBracket } from "/bracket-fill.js";

let t = 0;
function draw() {
  const box = document.getElementById("orders");
  if (!box) return;
  let strip = document.getElementById("cc-brackets");
  const names = bracketFields(box.value);
  if (!names.length) { strip?.remove(); return; }
  if (strip && strip.dataset.names === names.join("|")) return;
  if (!strip) {
    strip = document.createElement("div");
    strip.id = "cc-brackets";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", "Fill in the blanks");
    strip.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0";
    box.insertAdjacentElement("beforebegin", strip);
  }
  strip.dataset.names = names.join("|");
  strip.innerHTML = `<span class="small dim">Fill in the blanks:</span>`;
  for (const n of names) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = n;
    inp.setAttribute("aria-label", n);
    inp.style.cssText = "width:140px;max-width:100%";
    inp.addEventListener("change", () => {
      const next = fillBracket(box.value, n, inp.value);
      if (next !== box.value) { box.value = next; box.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    strip.appendChild(inp);
  }
}
document.addEventListener("input", (e) => {
  if (e.target?.id !== "orders") return;
  clearTimeout(t);
  t = setTimeout(draw, 250);
});
window.CC.register({ id: "bracket-strip", onState() { clearTimeout(t); t = setTimeout(draw, 250); } });
