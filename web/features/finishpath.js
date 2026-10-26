// Looks good, Finish / Edit further under a Command answer (flag_finishpath, 0.4.19). The Finish
// button in the bar and the pill are drawn by app.js. Nothing is sent from here.
import { mountPair } from "../finishpath-ui.js";
import { cleanText } from "../finishpath.js";

const CC = window.CC;

function editFurther() {
  const box = document.getElementById("orders");
  if (!box) return;
  box.focus();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  CC.toast("Change the words in the box, then press Go.");
}

CC.register({
  id: "finishpath",
  deliverable: { order: 11.5, render(el, run) {
    el.innerHTML = "";
    if (!CC.S?.flags?.finishpath || !run?.id || !run.deliverable) return;
    mountPair(el, { kind: "command", text: run.deliverable, name: cleanText(run.title || run.prompt || "", 60), onEdit: editFurther });
  } },
});
