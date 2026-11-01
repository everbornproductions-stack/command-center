// 0.4.23 Mac-style GUI: History sidebar (drawer) part
import { filterChats, titleOf, groupForDrawer, filterChips, agoWord, SHOW_FIRST } from "../data/history.js";

// 0.4.34: grouped by project (the one in use first) and by kind of work, newest group first; each group folds and
// shows its newest few. Which groups are folded is remembered on this computer.
const CLOSED_KEY = "cc.hist.closed";
const readClosed = () => { try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]")); } catch { return new Set(); } };
const saveClosed = (set) => { try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...set].slice(0, 200))); } catch {} };

export default {
  id: "history",
  async mount({ CC, bus, slot }) {
    let container = document.getElementById("mac-history-drawer");
    if (!container) {
      container = document.createElement("div");
      container.id = "mac-history-drawer";
      container.setAttribute("role", "complementary");
      container.setAttribute("aria-label", "Chat History");
      const root = slot("mac-root") || document.body;
      root.appendChild(container);
    }

    let chats = [];
    let query = "";
    let isOpen = false;
    let selectedIndex = -1;
    const closed = readClosed();
    const showAll = new Set();
    let filter = "all";
    const e = (s) => (CC.esc ? CC.esc(s) : String(s));

    async function fetchChats() {
      try {
        const res = await CC.api("/chathist?limit=100");
        chats = res.items || [];
      } catch {
        chats = [];
      }
      render();
    }

    // 0.4.37 (panel 0435 item 3): CC.openChat and GET /api/chathist/get never existed ("no such route"). Open the chat the
    // way the History page does (CC.openRun), on the chat page, and in the Simple Mac look step the 3-step screen aside.
    async function reopenChat(chatId) {
      if (typeof CC.openRun !== "function") { CC.toast?.("Could not open that chat here. Open History from the menu.", true); return; }
      closeDrawer();
      CC.makeChat?.reset?.();
      if (CC.S) CC.S.scPage = "chat";
      await CC.openRun(chatId);
      if (document.body.dataset.ui === "simple" && CC.S?.live?.id === chatId) bus.emit("chat", { open: true });
    }

    async function redoChat(chatId) {
      try {
        const r = await CC.api("/chathist/redo", { method: "POST", body: { id: chatId } });
        CC.toast?.(r.changed ? "Running it again with your change." : "Running that again.");
        closeDrawer();
      } catch (err) {
        CC.toast?.(err.message, true);
      }
    }

    // 0.4.37 (panel 0435 item 4): the header and the search box are drawn once and kept, so typing never rebuilds the box
    // and focus and the caret stay where they are. Only the chips and the list are drawn again.
    function shell() {
      if (container.querySelector(".mac-hist-content")) return;
      container.innerHTML = `
        <div class="mac-hist-header">
          <span class="mac-hist-title">History</span>
          <button type="button" class="mac-hist-close" aria-label="Close history">&times;</button>
        </div>
        <div class="mac-hist-search-box">
          <input type="text" class="mac-hist-search" placeholder="Search chats..." aria-label="Search chats" autocomplete="off">
        </div>
        <div class="mac-hist-chips" role="group" aria-label="Show only"></div>
        <div class="mac-hist-content" role="list"></div>
      `;
      container.querySelector(".mac-hist-close").addEventListener("click", closeDrawer);
      container.querySelector(".mac-hist-search").addEventListener("input", (ev) => {
        query = ev.target.value;
        selectedIndex = -1;
        render();
      });
    }

    // What had focus inside the chips or the list, so a keyboard user lands on the same control after a redraw.
    function focusKey() {
      const a = document.activeElement;
      if (!a || !container.contains(a)) return null;
      if (a.dataset.chip) return `[data-chip="${CSS.escape(a.dataset.chip)}"]`;
      if (a.dataset.toggle) return `[data-toggle="${CSS.escape(a.dataset.toggle)}"]`;
      if (a.dataset.more) return `[data-toggle="${CSS.escape(a.dataset.more)}"]`;
      return null;
    }

    function render() {
      shell();
      const keep = focusKey();
      const search = container.querySelector(".mac-hist-search");
      if (search && search.value !== query && document.activeElement !== search) search.value = query;
      const filtered = filterChats(chats, query);
      const chips = filterChips(filtered, CC.S?.projects || []);
      if (!chips.some((c) => c.id === filter)) filter = "all";
      const groups = groupForDrawer(filtered, { projects: CC.S?.projects || [], current: CC.S?.project || "", filter });

      let itemFlatIndex = 0;

      // 0.4.37 (panel 0435 item 10c): a chip counts its kind everywhere, projects included (what it shows when picked).
      container.querySelector(".mac-hist-chips").innerHTML = chips.map((c) => `<button type="button" class="mac-hist-chip${c.id === filter ? " on" : ""}" data-chip="${e(c.id)}" aria-pressed="${c.id === filter}"${c.id === "all" || c.id === "projects" ? "" : ` title="${e(`${c.n} in all, projects included`)}"`}>${e(c.label)}${c.id === "all" ? "" : ` ${c.n}`}</button>`).join("");
      // 0.4.37 (panel 0435 item 10): a row is a plain box holding two buttons. A button inside a button is not allowed in
      // HTML, so the Redo button used to fall out under every row as an invisible extra line. The group name gets its own
      // span so a long name is cut with "..." on one line instead of wrapping the header into three.
      container.querySelector(".mac-hist-content").innerHTML = `
          ${groups.length === 0 ? `<div class="mac-hist-empty">${query ? "Nothing matches that." : "Nothing here yet. Your chats show up here."}</div>` : ""}
          ${groups.map((g) => {
            // a search opens every group so no match is hidden
            const open = !!query || !closed.has(g.key);
            const all = !!query || showAll.has(g.key);
            const shown = open ? (all ? g.items : g.items.slice(0, SHOW_FIRST)) : [];
            const name = `${g.label}${g.current ? " (current project)" : ""}`;
            return `
            <div class="mac-hist-group" data-group="${e(g.key)}">
              <button type="button" class="mac-hist-group-label mac-hist-group-toggle" data-toggle="${e(g.key)}" aria-expanded="${open}" title="${e(name)}"><span aria-hidden="true">${open ? "&#9662;" : "&#9656;"}</span> <span class="mac-hist-group-name">${e(name)}</span> <span class="mac-hist-count">${g.items.length} · ${agoWord(g.latest)}</span></button>
              ${shown.map((item) => {
                const idx = itemFlatIndex++;
                const title = titleOf(item);
                const isFocused = idx === selectedIndex;
                return `
                  <div class="mac-hist-row" role="listitem">
                    <button type="button" class="mac-hist-item ${isFocused ? "focused" : ""}" data-id="${e(item.id)}" data-index="${idx}" title="${e(title)}">
                      <span class="mac-hist-item-title">${e(title)}</span>
                    </button>
                    <button type="button" class="mac-hist-redo-btn" data-redo="${e(item.id)}" title="Do this again" aria-label="Do again: ${e(title)}">Redo</button>
                  </div>
                `;
              }).join("")}
              ${open && !all && g.items.length > SHOW_FIRST ? `<button type="button" class="mac-hist-more" data-more="${e(g.key)}">Show all ${g.items.length}</button>` : ""}
            </div>`;
          }).join("")}
      `;

      container.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.toggle;
        if (closed.has(k)) closed.delete(k); else closed.add(k);
        saveClosed(closed); render();
      }));
      container.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.chip; selectedIndex = -1; render(); }));
      container.querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { showAll.add(b.dataset.more); render(); }));

      container.querySelectorAll(".mac-hist-item").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          if (id) reopenChat(id);
        });
      });

      container.querySelectorAll("[data-redo]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const id = btn.getAttribute("data-redo");
          if (id) redoChat(id);
        });
      });

      if (keep) container.querySelector(keep)?.focus({ preventScroll: true });
    }

    function openDrawer() {
      isOpen = true;
      container.classList.add("open");
      selectedIndex = -1;
      fetchChats();
      setTimeout(() => {
        const searchInput = container.querySelector(".mac-hist-search");
        searchInput?.focus();
      }, 50);
    }

    function closeDrawer() {
      if (!isOpen) return;
      isOpen = false;
      container.classList.remove("open");
    }

    // Keyboard navigation inside drawer
    container.addEventListener("keydown", (ev) => {
      if (!isOpen) return;
      const items = container.querySelectorAll(".mac-hist-item");
      if (ev.key === "Escape") {
        closeDrawer();
        ev.stopPropagation();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateFocus(items);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateFocus(items);
      } else if (ev.key === "Enter") {
        // a row that has the keyboard focus opens itself (the button's own click); the arrow-key pick opens from the box
        if (ev.target.closest?.(".mac-hist-item, .mac-hist-redo-btn, [data-chip], [data-toggle], [data-more], .mac-hist-close")) return;
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          ev.preventDefault();
          const id = items[selectedIndex].getAttribute("data-id");
          if (id) reopenChat(id);
        }
      }
    });

    function updateFocus(items) {
      items.forEach((it, idx) => {
        if (idx === selectedIndex) {
          it.classList.add("focused");
          it.scrollIntoView({ block: "nearest" });
        } else {
          it.classList.remove("focused");
        }
      });
    }

    // Click outside to close.
    // 0.4.37 (panel 0435 item 2): a click inside the drawer redraws the list, so by the time the click reaches the page its
    // target is no longer in the drawer and the old check closed it on every chip, fold and Show all. The path the click
    // took is kept from the moment it started, so a click that began inside never counts as outside.
    function outsideClickHandler(ev) {
      if (!isOpen) return;
      const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
      if (path.includes(container) || container.contains(ev.target)) return;
      if (ev.target.closest?.("#mac-sidebar-history-btn, [data-mac-history], #mac-sidebtn, #mac-dock [data-action-target=\"history\"]")) return;
      closeDrawer();
    }
    document.addEventListener("click", outsideClickHandler);

    // Bus subscriptions
    const unsubOpen = bus.on("open", (payload) => {
      if (payload?.panel === "history") {
        // The shell says open: true or false; a bare request (dock) toggles.
        const want = typeof payload.open === "boolean" ? payload.open : !isOpen;
        if (want && !isOpen) openDrawer();
        else if (!want && isOpen) closeDrawer();
      }
    });
    // Escape closes the drawer wherever focus is (another part may hold focus).
    const escHandler = (ev) => { if (ev.key === "Escape" && isOpen) closeDrawer(); };
    document.addEventListener("keydown", escHandler);

    // Store unmount cleanup
    container._cleanup = () => {
      document.removeEventListener("click", outsideClickHandler);
      document.removeEventListener("keydown", escHandler);
      unsubOpen?.();
    };

    render();
  },

  unmount({ bus }) {
    const container = document.getElementById("mac-history-drawer");
    container?._cleanup?.();
    container?.remove();
  }
};
