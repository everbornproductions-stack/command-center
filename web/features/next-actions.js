// Next actions under a finished answer (flag_nextactions, 0.4.19): Make 3 variations, Add to project,
// Send to Finish, and one Send to menu. The bar draws only when the flag is on. Nothing is sent or
// spent from here: variations fill the orders box and wait for the person.
import { mountBar } from "../next-actions-ui.js";
import { commandVariationText, cleanText } from "../next-actions.js";

const CC = window.CC;

function fillOrders(text) {
  const box = document.getElementById("orders");
  const next = commandVariationText(text);
  if (!box || !next) { CC.toast("There is nothing to vary yet.", true); return; }
  box.value = next;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  CC.toast("Three versions are asked for in the box. Press Go when you are ready.");
}

CC.register({
  id: "next-actions",
  deliverable: { order: 11, render(el, run) {
    el.innerHTML = "";
    if (!CC.S?.flags?.nextactions || !run?.id || !run.deliverable) return;
    mountBar(el, {
      kind: "command",
      text: run.deliverable,
      ref: run.id,
      name: cleanText(run.title || run.prompt || run.deliverable, 60),
      onVariations: fillOrders,
    });
  } },
});
