// Three main actions under every finished answer, and every other action under More (0.4.17).
// The persona review asked for Copy, Double-check, and a way to test the answer on real
// people, with the rest out of the way. Nothing is removed: each feature still draws its own
// buttons, and this file only moves them. Moving a button keeps its click handler.

export const MAIN_ACTIONS = [
  { id: "copy", label: "Copy" },
  { id: "check", label: "Double-check", find: "#cc-check" },
  { id: "personas", label: "Test with personas", find: "[data-feature='personas'] button" },
];

// Blocks that stay in view because they say something about the answer (the practice label,
// who wrote it, a Double-check result). Their buttons still move to More.
export const KEEP_IN_VIEW = new Set(["desk"]);

// The next actions bar (flag_nextactions) stays where it was drawn, right under the main buttons.
export const PINNED = new Set(["next-actions", "finishpath"]);

export const MORE_LABEL = "More actions";

// Pure: which feature blocks go under More. ids are the data-feature names in drawing order.
export function planActions(ids) {
  const list = (ids || []).map(String);
  return {
    main: MAIN_ACTIONS.map((a) => a.id),
    stay: list.filter((id) => KEEP_IN_VIEW.has(id)),
    more: list.filter((id) => !KEEP_IN_VIEW.has(id) && !PINNED.has(id) && id !== "personas"),
  };
}

// box is #deliv-extras after the features drew into it.
export function arrangeAnswerActions(box, { onCopy, open = false, onToggle } = {}) {
  if (!box || box.querySelector(":scope > .answer-main")) return null;
  const blocks = [...box.querySelectorAll(":scope > [data-feature]")];
  const plan = planActions(blocks.map((b) => b.dataset.feature));
  const doc = box.ownerDocument;
  const main = doc.createElement("div");
  main.className = "answer-main";
  main.setAttribute("role", "group");
  main.setAttribute("aria-label", "Answer actions");
  const copy = doc.createElement("button");
  copy.type = "button";
  copy.className = "btn sm";
  copy.id = "cc-copy-main";
  copy.textContent = MAIN_ACTIONS[0].label;
  copy.addEventListener("click", () => onCopy?.());
  main.appendChild(copy);
  for (const action of MAIN_ACTIONS.slice(1)) {
    const btn = box.querySelector(action.find);
    if (!btn) continue;
    btn.textContent = action.label;
    btn.classList.add("btn", "sm");
    main.appendChild(btn);
  }
  const more = doc.createElement("details");
  more.className = "answer-more";
  more.open = !!open;
  more.innerHTML = `<summary>${MORE_LABEL}</summary>`;
  if (onToggle) more.addEventListener("toggle", () => onToggle(more.open));
  const body = doc.createElement("div");
  body.className = "answer-more-body";
  more.appendChild(body);
  for (const block of blocks) {
    const id = block.dataset.feature;
    if (id === "personas") { block.hidden = true; continue; }
    if (PINNED.has(id)) continue;
    if (plan.stay.includes(id)) {
      // The info stays. Its own buttons (Do this again) go under More.
      for (const row of block.querySelectorAll(".cc-desk-row")) {
        if (row.querySelector("button, a")) {
          const holder = doc.createElement("div");
          holder.dataset.from = id;
          holder.appendChild(row);
          body.appendChild(holder);
        }
      }
      continue;
    }
    body.appendChild(block);
  }
  box.prepend(main);
  box.appendChild(more);
  return { main, more };
}
