// Banner when a handoff-only AI gains a direct API or MCP route.
// One click adds it to councils and missions. Not now hides that ask.
const { api, esc, toast } = window.CC;

let notices = [];

function paint() {
  const slot = document.getElementById("graduate-slot");
  if (!slot) return;
  const n = notices[0];
  if (!n) { slot.innerHTML = ""; return; }
  slot.innerHTML = `<div class="graduate-banner" role="status">
    <p>${esc(n.text)}</p>
    <button type="button" class="btn sm primary" id="graduate-add">Add it</button>
    <button type="button" class="btn sm" id="graduate-later">Not now</button>
  </div>`;
  slot.querySelector("#graduate-add").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const data = await api("/graduate/approve", { method: "POST", body: { id: n.id } });
      notices = data.notices || [];
      toast(`${n.name} can run in councils and missions.`);
      paint();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message, true);
    }
  });
  slot.querySelector("#graduate-later").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const data = await api("/graduate/dismiss", { method: "POST", body: { id: n.id } });
      notices = data.notices || [];
      paint();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message, true);
    }
  });
}

let inflight = null;
function refresh() {
  const slot = document.getElementById("graduate-slot");
  if (!slot) return inflight;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await api("/graduate");
      notices = data.notices || [];
      paint();
    } catch { /* the next render tries again */ }
  })().finally(() => { inflight = null; });
  return inflight;
}

window.CC.register({
  id: "graduate",
  command: { order: 1, render() { paint(); refresh(); } },
  onState() { refresh(); },
});
