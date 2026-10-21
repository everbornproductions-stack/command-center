// A guessed Pro prompt must not stop an order.
// The pack is sent only when it was chosen and every required fact is already filled.
// Missing facts stay in the chip under the orders box.

export function detectApplied({ autoApply = false, keepApplied = false, halted = false } = {}) {
  return !!(keepApplied || autoApply) && !halted;
}

export function attachPack(pack) {
  if (!pack || pack.removed || !pack.templateId || pack.halted || pack.applied === false) return null;
  return { templateId: pack.templateId, inputs: pack.inputs || {} };
}
