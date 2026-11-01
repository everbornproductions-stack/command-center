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

    async function fetchChats() {
      try {
        const res = await CC.api("/chathist?limit=100");
        chats = res.items || [];
      } catch {
        chats = [];
      }
      render();
    }

    async function reopenChat(chatId) {
      try {
        if (typeof CC.openChat === "function") {
          await CC.openChat(chatId);
        } else if (typeof CC.go === "function") {
          CC.go("command");
          const res = await CC.api(`/chathist/get?id=${encodeURIComponent(chatId)}`);
          if (res && typeof CC.restoreChat === "function") {
            CC.restoreChat(res);
          }
        }
        closeDrawer();
      } catch (e) {
        CC.toast?.(e.message || "Could not open chat", true);
      }
    }

    async function redoChat(chatId) {
      try {
        const r = await CC.api("/chathist/redo", { method: "POST", body: { id: chatId } });
        CC.toast?.(r.changed ? "Running it again with your change." : "Running that again.");
        closeDrawer();
      } catch (e) {
        CC.toast?.(e.message, true);
      }
    }

    function render() {
      const filtered = filterChats(chats, query);
      const chips = filterChips(filtered, CC.S?.projects || []);
      if (!chips.some((c) => c.id === filter)) filter = "all";
      const groups = groupForDrawer(filtered, { projects: CC.S?.projects || [], current: CC.S?.project || "", filter });
      const e = (s) => (CC.esc ? CC.esc(s) : String(s));

      let itemFlatIndex = 0;

      container.innerHTML = `
        <div class="mac-hist-header">
          <span class="mac-hist-title">History</span>
          <button type="button" class="mac-hist-close" aria-label="Close history">&times;</button>
        </div>
        <div class="mac-hist-search-box">
          <input type="text" class="mac-hist-search" placeholder="Search chats..." value="${CC.esc ? CC.esc(query) : query}" aria-label="Search chats">
        </div>
        <div class="mac-hist-chips" role="group" aria-label="Show only">${chips.map((c) => `<button type="button" class="mac-hist-chip${c.id === filter ? " on" : ""}" data-chip="${e(c.id)}" aria-pressed="${c.id === filter}">${e(c.label)}${c.id === "all" ? "" : ` ${c.n}`}</button>`).join("")}</div>
        <div class="mac-hist-content" role="list">
          ${groups.length === 0 ? `<div class="mac-hist-empty">Nothing here yet. Your chats show up here.</div>` : ""}
          ${groups.map((g) => {
            // a search opens every group so no match is hidden
            const open = !!query || !closed.has(g.key);
            const all = !!query || showAll.has(g.key);
            const shown = open ? (all ? g.items : g.items.slice(0, SHOW_FIRST)) : [];
            return `
            <div class="mac-hist-group" data-group="${e(g.key)}">
              <button type="button" class="mac-hist-group-label mac-hist-group-toggle" data-toggle="${e(g.key)}" aria-expanded="${open}">${open ? "&#9662;" : "&#9656;"} ${e(g.label)}${g.current ? " (current project)" : ""} <span class="mac-hist-count">${g.items.length} · ${agoWord(g.latest)}</span></button>
              ${shown.map((item) => {
                const idx = itemFlatIndex++;
                const title = titleOf(item);
                const isFocused = idx === selectedIndex;
                return `
                  <button type="button" class="mac-hist-item ${isFocused ? "focused" : ""}" role="listitem" data-id="${CC.esc ? CC.esc(item.id) : item.id}" data-index="${idx}" title="${CC.esc ? CC.esc(title) : title}">
                    <span class="mac-hist-item-title">${CC.esc ? CC.esc(title) : title}</span>
                    <button type="button" class="mac-hist-redo-btn" data-redo="${CC.esc ? CC.esc(item.id) : item.id}" title="Do this again">Redo</button>
                  </button>
                `;
              }).join("")}
              ${open && !all && g.items.length > SHOW_FIRST ? `<button type="button" class="mac-hist-more" data-more="${e(g.key)}">Show all ${g.items.length}</button>` : ""}
            </div>`;
          }).join("")}
        </div>
      `;

      // Wire up events
      const closeBtn = container.querySelector(".mac-hist-close");
      closeBtn?.addEventListener("click", closeDrawer);

      const searchInput = container.querySelector(".mac-hist-search");
      searchInput?.addEventListener("input", (e) => {
        query = e.target.value;
        selectedIndex = -1;
        render();
      });

      // Keep focus on search if it was open
      if (isOpen && searchInput && document.activeElement !== searchInput && !container.querySelector(".mac-hist-redo-btn:focus")) {
        // Only focus search on initial open or when query changes without losing input focus
      }

      container.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.toggle;
        if (closed.has(k)) closed.delete(k); else closed.add(k);
        saveClosed(closed); render();
      }));
      container.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.chip; selectedIndex = -1; render(); }));
      container.querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { showAll.add(b.dataset.more); render(); }));

      container.querySelectorAll(".mac-hist-item").forEach((el) => {
        el.addEventListener("click", (e) => {
          if (e.target.closest("[data-redo]")) return;
          const id = el.getAttribute("data-id");
          if (id) reopenChat(id);
        });
      });

      container.querySelectorAll("[data-redo]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-redo");
          if (id) redoChat(id);
        });
      });
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
    container.addEventListener("keydown", (e) => {
      if (!isOpen) return;
      const items = container.querySelectorAll(".mac-hist-item");
      if (e.key === "Escape") {
        closeDrawer();
        e.stopPropagation();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateFocus(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateFocus(items);
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          e.preventDefault();
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

    // Click outside to close
    function outsideClickHandler(e) {
      if (isOpen && !container.contains(e.target) && !e.target.closest("#mac-sidebar-history-btn, [data-mac-history], #mac-sidebtn, #mac-dock [data-action-target=\"history\"]")) {
        closeDrawer();
      }
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
    const escHandler = (e) => { if (e.key === "Escape" && isOpen) closeDrawer(); };
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
