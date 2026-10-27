// Momentum Mode (flag_momentum, 0.4.19): tells the next step bar when a result shows. The bar itself
// is drawn by app.js through web/momentum-ui.js. Nothing is sent or run from here.
import { noteResult } from "../momentum-ui.js";

const CC = window.CC;

CC.register({
  id: "momentum",
  deliverable: { order: 12, render(el, run) {
    if (!CC.S?.flags?.momentum || !run?.id || !run.deliverable) return;
    noteResult(run);
  } },
});
