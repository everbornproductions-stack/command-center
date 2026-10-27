// 0.4.21: the AI News side panel is gone. AI News has one home: its own item in the left menu (view "ai-news",
// web/features/community.js). This file stays only to clear a panel that an older page left behind, so nothing
// floats over the page. The helpers in /news-rail.js are still used by tests and by in-app links.
document.getElementById("cc-rail")?.remove();
document.getElementById("cc-rail-style")?.remove();
document.body.classList.remove("rail-dock-right", "rail-dock-left");
window.CC.register({ id: "news-rail" });
