// 0.4.23 Mac part: dock
import { itemsFor, magnifyScale } from "../data/dock.js";

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
      const items = itemsFor(currentMode);
      root.innerHTML = items.map((d, i) => {
        if (d.type === "sep") {
          return `<div class="sep${d.expert ? " ex" : ""}" role="separator"></div>`;
        }
        const isActive = (d.action.type === "view" && d.action.view === currentView) ||
                         (d.action.type === "path" && currentView === "command");
        const runClass = isActive ? " run" : "";
        const exClass = d.expert ? " ex" : "";
        return `<button class="di ${d.gradient}${runClass}${exClass}" data-p="${d.label}" data-action-type="${d.action.type}" data-action-target="${d.action.view || d.action.path || d.action.panel || ""}" data-idx="${i}" aria-label="${d.label}">${d.icon}</button>`;
      }).join("");
    }

    render();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function handleMouseMove(e) {
      if (reducedMotion) return;
      const buttons = root.querySelectorAll(".di");
      requestAnimationFrame(() => {
        buttons.forEach((b) => {
          if (!b.offsetParent) return;
          const r = b.getBoundingClientRect();
          const c = r.left + r.width / 2;
          const d = Math.abs(e.clientX - c);
          const z = magnifyScale(d);
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

      if (type === "view") {
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

    ctx._unsubDock = () => {
      unsubMode?.();
      unsubView?.();
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
