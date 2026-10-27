// 0.4.23 Mac-style GUI: cards part and mountCards helper.

import { PATHS, pageOf, nextIndex, dotsFor, pathData as pathOf } from "../data/cards.js";

export function mountCards(container, opts = {}) {
  if (!container) return;
  const pathKey = opts.path || "website";
  const pathData = pathOf(pathKey) || PATHS.website;
  const styles = pathData.styles || [];
  const onPick = typeof opts.onPick === "function" ? opts.onPick : () => {};

  // Default to popular style index
  let currentIndex = styles.findIndex((s) => s.popular);
  if (currentIndex < 0) currentIndex = 0;

  container.innerHTML = `
    <div class="cards" tabindex="0" role="region" aria-label="${pathData.title}">
      <div class="track" id="mac-card-track">
        ${styles.map((s, i) => `
          <div class="card ${i === currentIndex ? "sel" : ""}" data-idx="${i}" role="button" aria-label="${s.name}">
            <div class="art ${s.gradient}"></div>
            ${s.popular === true ? '<span class="badge">Most popular</span>' : ""}
            <div class="t">${s.name}</div>
            <div class="d">${s.desc}</div>
          </div>
        `).join("")}
      </div>
      <div class="dots" aria-hidden="true">
        ${styles.map((_, i) => `
          <i data-c="${i}" class="${i === currentIndex ? "on" : ""}"></i>
        `).join("")}
      </div>
    </div>
  `;

  const track = container.querySelector("#mac-card-track");
  const cardsEl = container.querySelector(".cards");
  const cardNodes = container.querySelectorAll(".card");
  const dotNodes = container.querySelectorAll(".dots i");

  function updateSelection(idx, notify = true) {
    currentIndex = Math.max(0, Math.min(styles.length - 1, idx));
    cardNodes.forEach((card, i) => {
      card.classList.toggle("sel", i === currentIndex);
    });
    dotNodes.forEach((dot, i) => {
      dot.classList.toggle("on", i === currentIndex);
    });

    if (track && cardNodes[currentIndex]) {
      const cardWidth = cardNodes[currentIndex].offsetWidth || 240;
      const gap = 16;
      const offset = currentIndex * (cardWidth + gap);
      track.style.transform = `translateX(${-offset}px)`;
    }

    if (notify) {
      onPick(styles[currentIndex]);
    }
  }

  // Initial notification of pre-picked popular style
  onPick(styles[currentIndex]);

  // Click handler for cards
  cardNodes.forEach((card) => {
    card.addEventListener("click", () => {
      const idx = parseInt(card.dataset.idx, 10);
      updateSelection(idx);
    });
  });

  // Click handler for dots
  dotNodes.forEach((dot) => {
    dot.addEventListener("click", () => {
      const idx = parseInt(dot.dataset.c, 10);
      updateSelection(idx);
    });
  });

  // Keyboard navigation
  cardsEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      updateSelection(currentIndex - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      updateSelection(currentIndex + 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(styles[currentIndex]);
    }
  });

  // Pointer drag / swipe
  let x0 = null;
  cardsEl.addEventListener("pointerdown", (e) => {
    x0 = e.clientX;
  });
  cardsEl.addEventListener("pointerup", (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 40) {
      const dir = e.clientX < x0 ? 1 : -1;
      updateSelection(currentIndex + dir);
    }
    x0 = null;
  });

  // Horizontal wheel scroll
  let wheelTimer = 0;
  cardsEl.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) > 20 && Date.now() - wheelTimer > 400) {
      wheelTimer = Date.now();
      const dir = e.deltaX > 0 ? 1 : -1;
      updateSelection(currentIndex + dir);
    }
  }, { passive: true });

  return {
    getCurrent: () => styles[currentIndex],
    setIndex: (idx) => updateSelection(idx)
  };
}

export default {
  id: "cards",
  mount(ctx) {
    const CC = ctx.CC || window.CC;
    if (CC) {
      CC.mac = CC.mac || {};
      CC.mac.cards = { PATHS, mountCards, pageOf, nextIndex, dotsFor };
    }
  },
  unmount(ctx) {
    const CC = ctx.CC || window.CC;
    if (CC?.mac?.cards) {
      delete CC.mac.cards;
    }
  }
};
