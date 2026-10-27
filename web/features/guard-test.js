// A box to try the send guard: paste a message, pick where it would go, and read what it says.
// Nothing is connected, sent or saved.
import { warningsHtml } from "/compliance-ui.js";
const { api, toast, esc } = window.CC;

function render(el) {
  el.innerHTML = `<div class="panel" id="guard-test"><h3>Try the send guard</h3>
    <p class="small">Paste a text, email or post and see what Meldmind would warn about before it goes out. Nothing is sent or saved.</p>
    <label class="lbl" for="gt-text">Message</label><textarea id="gt-text" rows="4" style="width:100%"></textarea>
    <label class="lbl" for="gt-ch">Where would it go?</label>
    <select id="gt-ch"><option value="sms">A text message</option><option value="email">An email</option><option value="post">A post or an ad</option></select>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="gt-go">Check it</button></div>
    <div id="gt-out" role="status" aria-live="polite"></div></div>`;
  el.querySelector("#gt-go").addEventListener("click", async () => {
    const text = el.querySelector("#gt-text").value;
    if (!text.trim()) return toast("Paste a message first.", true);
    try {
      const r = await api("/guardtest", { method: "POST", body: { text, channel: el.querySelector("#gt-ch").value, consent: true } });
      el.querySelector("#gt-out").innerHTML = `<p><b>${esc(r.summary)}</b></p>${warningsHtml(r.warnings)}`;
    } catch (e) { toast(e.message, true); }
  });
}

window.CC.register({ id: "guard-test", settings: { order: 48, render } });
