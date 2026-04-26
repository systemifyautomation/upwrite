/**
 * UpWrite – Background Service Worker
 *
 * Responsibilities:
 *  1. Forward webhook requests from the popup (avoids CORS issues).
 *  2. Persist/retrieve extension settings (webhook URL etc.).
 *  3. Track which tabs have the content script ready.
 */

"use strict";

/* ------------------------------------------------------------------ */
/*  In-memory set of tabs where the content script has signalled ready  */
/* ------------------------------------------------------------------ */
const readyTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /* ---- Content script ready notification ---- */
  if (message.type === "CONTENT_SCRIPT_READY") {
    if (sender.tab?.id) readyTabs.add(sender.tab.id);
    return false;
  }

  /* ---- Check if current tab has content script ---- */
  if (message.type === "CHECK_TAB_READY") {
    sendResponse({ ready: readyTabs.has(message.tabId) });
    return true;
  }

  /* ---- Webhook request proxy ---- */
  if (message.type === "SEND_WEBHOOK") {
    const { url, payload } = message;

    if (!url || typeof url !== "string") {
      sendResponse({ success: false, error: "No webhook URL provided." });
      return true;
    }

    try {
      new URL(url);
    } catch (_) {
      sendResponse({ success: false, error: "Invalid webhook URL." });
      return true;
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        let data;
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          data = await res.json();
        } else {
          data = await res.text();
        }
        sendResponse({ success: res.ok, status: res.status, data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true; // keep message channel open for async response
  }

  /* ---- Save settings ---- */
  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.sync.set(message.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  /* ---- Load settings ---- */
  if (message.type === "LOAD_SETTINGS") {
    chrome.storage.sync.get(null, (items) => {
      sendResponse({ success: true, settings: items });
    });
    return true;
  }
});

/* ------------------------------------------------------------------ */
/*  Clean up readyTabs when a tab is closed or navigates away           */
/* ------------------------------------------------------------------ */
chrome.tabs.onRemoved.addListener((tabId) => readyTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") readyTabs.delete(tabId);
});
