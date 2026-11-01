// 0.4.23 Mac part: dock
import { itemsFor, magnifyFor, autoHideOk, DOCK_HIDE_MS, DOCK_EDGE_PX } from "../data/dock.js";

export default {
  id: "dock",
  mount(ctx) {
    const { CC, bus, slot } = ctx;
    let root = slot("mac-dock");
    if (!root) {
      let macRoot = slot("mac-root");
      if (!macRoot) {
        macRoot = document.createElement("div");
        macRoot.id = "mac-root";
        document.body.appendChild(macRoot);
      }
      const dockw = document.createElement("div");
      dockw.className = "dockw";
      root = document.createElement("div");
      root.id = "mac-dock";
      dockw.appendChild(root);
      macRoot.appendChild(dockw);
    }

    let currentMode = CC.uiMode?.() || "simple";
    let currentView = CC.S?.view || "command";

    function render() {
      // 0.4.36: a keyboard pick redraws the dock; keep the focus on the same button so it does not drop to the page.
      const had = root.contains(document.activeElement) ? document.activeElement.dataset?.p : null;
      paint();
      if (had) [...root.querySelectorAll(".di")].find((b) => b.dataset.p === had)?.focus({ preventScroll: true });
    }
    function paint() {
      const items = itemsFor(currentMode);
      root.innerHTML = items.map((d, i) => {
        if (d.type === "sep") {
          return `<div class="sep${d.expert ? " ex" : ""}" role="separator"></div>`;
        }
        const isActive = ((d.action.type === "view" || d.action.type === "chat") && d.action.view === currentView) ||
                         (d.action.type === "path" && currentView === "command");
        const runClass = isActive ? " run" : "";
        const exClass = d.expert ? " ex" : "";
        return `<button class="di ${d.gradient}${runClass}${exClass}" data-p="${d.label}" data-action-type="${d.action.type}" data-action-target="${d.action.view || d.action.path || d.action.panel || ""}" data-idx="${i}" aria-label="${d.label}">${d.icon}</button>`;
      }).join("");
    }

    render();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The resting icon size: 54 px in Framed, smaller (--mac-di) in Fill the window.
    const iconBase = () => parseFloat(getComputedStyle(root).getPropertyValue("--mac-di")) || 54;

    function handleMouseMove(e) {
      if (reducedMotion) return;
      const buttons = root.querySelectorAll(".di");
      const base = iconBase();
      requestAnimationFrame(() => {
        buttons.forEach((b) => {
          if (!b.offsetParent) return;
          const r = b.getBoundingClientRect();
          const c = r.left + r.width / 2;
          const d = Math.abs(e.clientX - c);
          const z = magnifyFor(d, base);
          b.style.width = z + "px";
          b.style.height = z + "px";
        });
      });
    }

    function handleMouseLeave() {
      if (reducedMotion) return;
      const buttons = root.querySelectorAll(".di");
      requestAnimationFrame(() => {
        buttons.forEach((b) => {
          b.style.width = "";
          b.style.height = "";
        });
      });
    }

    root.addEventListener("mousemove", handleMouseMove);
    root.addEventListener("mouseleave", handleMouseLeave);

    root.addEventListener("click", (e) => {
      const b = e.target.closest(".di");
      if (!b) return;
      if (!reducedMotion) {
        b.classList.remove("bounce");
        void b.offsetWidth;
        b.classList.add("bounce", "run");
      }
      const type = b.dataset.actionType;
      const target = b.dataset.actionTarget;

      if (type === "chat") {
        // 0.4.28 (Chris: "the chat button does nothing"): Simple already shows the Command page, so going there did
        // nothing visible. Open chat the same way "Just chat instead" does, then put the cursor in the box.
        if (typeof CC.go === "function" && CC.S?.view !== "command") CC.go("command");
        currentView = "command";
        bus.emit("view", "command");
        bus.emit("chat", { open: true });
        render();
        setTimeout(() => { const box = document.getElementById("orders"); if (box) { box.scrollIntoView({ block: "center" }); box.focus(); } }, 60);
      } else if (type === "view") {
        if (typeof CC.go === "function") CC.go(target);
        currentView = target;
        bus.emit("view", target);
        render();
      } else if (type === "open") {
        bus.emit("open", { panel: target });
      } else if (type === "path") {
        const path = target;
        CC.mac.flowReady = false;
        bus.emit("flow", { path, step: 1 });
        
        setTimeout(() => {
          if (!CC.mac.flowReady) {
            if (path === "gamemod") {
              if (typeof CC.go === "function") CC.go("remix");
            } else {
              if (typeof CC.go === "function") CC.go("command");
              const orders = document.getElementById("orders") || document.getElementById("ask");
              if (orders) {
                const starterMap = {
                  website: "Build a website for my ",
                  image: "Make an image of ",
                  video: "Make a 5 second video of ",
                  campaign: "Plan a marketing campaign for my "
                };
                const starter = starterMap[path];
                if (starter) {
                  orders.value = starter;
                  orders.focus?.();
                }
              }
            }
          }
        }, 15);
      }
    });

    root.addEventListener("keydown", (e) => {
      const buttons = Array.from(root.querySelectorAll(".di"));
      const focused = document.activeElement;
      const idx = buttons.indexOf(focused);
      if (idx === -1) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = buttons[(idx + 1) % buttons.length];
        next?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = buttons[(idx - 1 + buttons.length) % buttons.length];
        prev?.focus();
      }
    });

    const unsubMode = bus.on("mode", (m) => {
      currentMode = m;
      render();
    });

    const unsubView = bus.on("view", (v) => {
      currentView = v;
      render();
    });

    // ---- 0.4.36: auto-hide in "Fill the window" ----
    // The dock hides once the pointer has been away from it for 2 s, and comes back when the pointer reaches the
    // bottom 8 px of the window or the keyboard moves focus into it (it stays in the tab order while hidden, just
    // moved below the edge). Never in Framed, under 760 px wide, or on a touch screen. body.mac-dock-away tells
    // shell.css to give the window body the dock's band back.
    const body = document.body;
    let hideTimer = 0, near = false;
    let touch = (() => { try { return matchMedia("(hover: none) and (pointer: coarse)").matches; } catch { return false; } })();
    const allowed = () => autoHideOk({ style: body.dataset.macwin === "framed" ? "framed" : "fill", width: innerWidth, touch });
    // The band is the dock plus the closed Asset Tray at its right (shell.css moves them together).
    const BAND = "#mac-dock, #cc-asset-tray.collapsed";
    const inBand = (el) => !!el?.closest?.(BAND);
    const focusInside = () => inBand(document.activeElement);
    const setAway = (away) => { if (body.classList.contains("mac-dock-away") !== away) body.classList.toggle("mac-dock-away", away); };
    function showDock() { clearTimeout(hideTimer); hideTimer = 0; setAway(false); }
    function scheduleHide() {
      clearTimeout(hideTimer); hideTimer = 0;
      if (!allowed()) { setAway(false); return; }
      hideTimer = setTimeout(() => { hideTimer = 0; if (allowed() && !near && !focusInside()) setAway(true); }, DOCK_HIDE_MS);
    }
    function nearDock(e) {
      if (e.clientY >= innerHeight - DOCK_EDGE_PX) return true;
      if (body.classList.contains("mac-dock-away")) return false;
      return [...document.querySelectorAll(BAND)].some((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && e.clientY >= r.top - 4 && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
      });
    }
    const onPointerMove = (e) => {
      if (e.pointerType === "touch") { touch = true; near = false; showDock(); return; }
      const now = nearDock(e);
      if (now === near) return;
      near = now;
      if (near) showDock(); else scheduleHide();
    };
    const onPointerOut = (e) => { if (!e.relatedTarget && near) { near = false; scheduleHide(); } }; // the pointer left the window
    const onFocusIn = (e) => { if (inBand(e.target)) showDock(); };
    const onFocusOut = (e) => { if (inBand(e.target) && !inBand(e.relatedTarget)) setTimeout(() => { if (!focusInside() && !near) scheduleHide(); }, 0); };
    const onResize = () => { if (!allowed()) showDock(); else if (!near && !hideTimer && !body.classList.contains("mac-dock-away")) scheduleHide(); };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    addEventListener("resize", onResize);
    const unsubWindow = bus.on("window", () => { if (allowed()) { if (!near) scheduleHide(); } else showDock(); });
    scheduleHide();

    ctx._unsubDock = () => {
      unsubMode?.();
      unsubView?.();
      unsubWindow?.();
      clearTimeout(hideTimer);
      body.classList.remove("mac-dock-away");
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      removeEventListener("resize", onResize);
      root.removeEventListener("mousemove", handleMouseMove);
      root.removeEventListener("mouseleave", handleMouseLeave);
    };
  },
  unmount(ctx) {
    ctx._unsubDock?.();
    const root = ctx.slot?.("mac-dock");
    root?.remove();
  }
};
