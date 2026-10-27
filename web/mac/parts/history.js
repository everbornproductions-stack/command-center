// 0.4.23 Mac-style GUI: History sidebar (drawer) part
import { groupByDay, filterChats, titleOf } from "../data/history.js";

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
      const groups = groupByDay(filtered, Date.now());

      let itemFlatIndex = 0;

      container.innerHTML = `
        <div class="mac-hist-header">
          <span class="mac-hist-title">History</span>
          <button type="button" class="mac-hist-close" aria-label="Close history">&times;</button>
        </div>
        <div class="mac-hist-search-box">
          <input type="text" class="mac-hist-search" placeholder="Search chats..." value="${CC.esc ? CC.esc(query) : query}" aria-label="Search chats">
        </div>
        <div class="mac-hist-content" role="list">
          ${groups.length === 0 ? `<div class="mac-hist-empty">Nothing here yet. Your chats show up here.</div>` : ""}
          ${groups.map((g) => `
            <div class="mac-hist-group">
              <div class="mac-hist-group-label">${g.label}</div>
              ${g.items.map((item) => {
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
            </div>
          `).join("")}
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
