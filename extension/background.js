// Right-click menu: "Send page to Command AI", "Send selection to Command AI", "Send link to Command AI".
// What happens (put it in Marching orders, ask now, or a council) is set in the popup. Only this PC's app is called.
import { send, grabPage } from "./shared.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "cc-page", title: "Send page to Command AI", contexts: ["page"] });
    chrome.contextMenus.create({ id: "cc-selection", title: "Send selection to Command AI", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "cc-link", title: "Send link to Command AI", contexts: ["link"] });
  });
});

function badge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }).catch(() => {}), 4000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab && tab.id;
  try {
    if (info.menuItemId === "cc-link") {
      await send({ kind: "link", url: info.linkUrl, title: tab && tab.title, text: "" });
    } else {
      let page = { title: tab && tab.title, url: tab && tab.url, text: "", selection: info.selectionText || "" };
      try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: grabPage }); if (r && r.result) page = { ...page, ...r.result }; } catch { /* pages the browser protects: send what the menu gave us */ }
      if (info.menuItemId === "cc-selection") await send({ kind: "selection", url: page.url, title: page.title, text: page.selection || info.selectionText || "" });
      else await send({ kind: "page", url: page.url, title: page.title, text: page.text });
    }
    badge(tabId, "OK", "#16a34a");
  } catch (e) {
    console.warn("Command AI:", e.message);
    badge(tabId, "!", "#dc2626");
  }
});
