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
/*  Normalize webhook response                                           */
/*  Mirrors the shape-detection logic in popup.js renderResponse()      */
/* ------------------------------------------------------------------ */
function extractString(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    return v.answer || v.text || v.value || v.content || JSON.stringify(v);
  }
  return String(v ?? "");
}

function normalizeWebhookResponse(data) {
  // n8n often wraps its output in a single-element array — unwrap it.
  if (Array.isArray(data) && data.length === 1 &&
      data[0] !== null && typeof data[0] === "object" && !Array.isArray(data[0])) {
    data = data[0];
  }

  let coverLetter = "";
  let questions   = [];

  if (typeof data === "string") {
    coverLetter = data;
  } else if (Array.isArray(data)) {
    // Multi-element array: first element = cover letter, rest = question answers
    const [first, ...rest] = data;
    coverLetter = extractString(first);
    questions   = rest.map(extractString);
  } else if (data && typeof data === "object") {
    coverLetter = extractString(
      data.coverLetter ?? data.cover_letter ?? data.text ?? data.output ?? ""
    );
    const rawQ = data.questions ?? data.answers ?? data.questionAnswers ?? [];
    if (Array.isArray(rawQ)) questions = rawQ.map(extractString);
  }

  return { coverLetter, questions };
}

/* ------------------------------------------------------------------ */
/*  Autofill executor — injected directly into the tab via             */
/*  chrome.scripting.executeScript so it works even while the tab is   */
/*  backgrounded. Must be self-contained (no SW-scope references).     */
/* ------------------------------------------------------------------ */
function autofillInTab(payload) {
  function simulateInput(el, value) {
    const desc = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    );
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    ["input", "change", "blur"].forEach((t) =>
      el.dispatchEvent(new Event(t, { bubbles: true }))
    );
  }
  function queryFirst(selectors) {
    for (const s of selectors) {
      try { const el = document.querySelector(s); if (el) return el; } catch (_) {}
    }
    return null;
  }
  function queryAll(selectors) {
    const seen = new Set(), out = [];
    for (const s of selectors) {
      try {
        document.querySelectorAll(s).forEach((el) => {
          if (!seen.has(el)) { seen.add(el); out.push(el); }
        });
        if (out.length) break;
      } catch (_) {}
    }
    return out;
  }
  const COVER = [
    "textarea[name='cover_letter']", "textarea[id*='cover']",
    "textarea[aria-label*='cover']", "textarea[aria-label*='Cover']",
    "textarea[placeholder*='cover']", "textarea[placeholder*='Cover']",
    "textarea[class*='cover']", "textarea",
  ];
  const QUESTIONS = [
    "[data-test='additional-question'] textarea",
    "[data-qa='additional-question'] textarea",
    "[class*='question'] textarea",
    "[class*='Question'] textarea",
    "fieldset textarea",
  ];
  const coverEl = queryFirst(COVER);
  const questionEls = queryAll(QUESTIONS).filter((el) => el !== coverEl);
  if (coverEl && payload.coverLetter) simulateInput(coverEl, payload.coverLetter);
  if (Array.isArray(payload.questions)) {
    payload.questions.forEach((answer, i) => {
      const el = questionEls[i];
      if (el && answer) simulateInput(el, answer);
    });
  }
}

/* ------------------------------------------------------------------ */
/*  System notification                                                  */
/*  Uses the OS notification system so the alert appears even when the  */
/*  user is in a different browser, app, or the file manager.           */
/* ------------------------------------------------------------------ */
function showNotificationWindow(message, type /* "success" | "error" */) {
  const id = `upwrite-${Date.now()}`;
  chrome.notifications.create(id, {
    type:             "basic",
    iconUrl:          chrome.runtime.getURL("icons/icon128.png"),
    title:            "UpWrite",
    message:          message,
    requireInteraction: true,   // stays on screen until dismissed
  }).catch((err) => {
    // Surface errors in the service worker console for easier debugging
    console.error("[UpWrite] Notification failed:", err);
  });
}

/* ------------------------------------------------------------------ */
/*  Chime player — offscreen document plays a two-note audio chime      */
/* ------------------------------------------------------------------ */
async function playChime() {
  try {
    // Only one offscreen document can exist at a time; create if not present
    await chrome.offscreen.createDocument({
      url:           chrome.runtime.getURL("offscreen.html"),
      reasons:       ["AUDIO_PLAYBACK"],
      justification: "Play proposal-ready notification chime.",
    });
    // Document auto-plays on load. CHIME_DONE message closes it (see below).
  } catch (_) {
    // Document already exists or offscreen API unavailable — non-fatal
  }
}

/* CHIME_DONE from offscreen.js closes the document once sound finishes */

/* ------------------------------------------------------------------ */
/*  Alarm keepalive                                                      */
/*  Fires every ~25 s to prevent the SW from being suspended during     */
/*  a long-running AI webhook fetch.                                    */
/* ------------------------------------------------------------------ */
const KEEPALIVE_ALARM = "upwrite-keepalive";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Accessing any Chrome API resets the SW idle timer
    chrome.storage.local.get("_ping");
  }
});

/* ------------------------------------------------------------------ */
/*  Storage trigger                                                      */
/*  The popup writes { upwrite_pending: job } instead of sending a      */
/*  message, so closing the popup cannot kill the in-progress fetch.    */
/* ------------------------------------------------------------------ */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.upwrite_pending?.newValue) return;
  const job = changes.upwrite_pending.newValue;
  // Remove immediately so a SW restart doesn't re-process it
  chrome.storage.local.remove("upwrite_pending");
  processProposal(job);
});

async function processProposal({ tabId, webhookUrl, payload }) {
  // Start the keepalive alarm — cleared in the finally block
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  try {
    const res = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    const ct   = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const normalized = normalizeWebhookResponse(data);
    const ts = Date.now();

    // Persist for popup rendering and discarded-tab fallback
    await new Promise((r) => chrome.storage.local.set({
      [`response_${tabId}`]: { normalized, raw: data, timestamp: ts },
      [`autofill_${tabId}`]: normalized,
    }, r));

    // Inject autofill directly — works even while the tab is backgrounded
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func:   autofillInTab,
        args:   [normalized],
      });
      // Script ran — discard the visibilitychange fallback
      chrome.storage.local.remove([`autofill_${tabId}`]);
    } catch (_) {
      // Tab was discarded — storage fallback remains for visibilitychange pickup
    }

    // Badge on the extension icon
    chrome.action.setBadgeText({ text: "\u2713", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#14a800", tabId });

    // Play audio chime (non-blocking — offscreen doc closes itself via CHIME_DONE)
    playChime();

    // Floating popup window — visible regardless of active tab or application
    showNotificationWindow("\u2713 UpWrite: Proposal ready! Fields have been filled in.", "success");

  } catch (err) {
    const ts = Date.now();

    await new Promise((r) => chrome.storage.local.set({
      [`response_${tabId}`]: { error: err.message, timestamp: ts },
    }, r));

    chrome.action.setBadgeText({ text: "!", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e94560", tabId });

    // Play chime even on error so the user is alerted
    playChime();

    // Floating popup window — visible regardless of active tab or application
    showNotificationWindow(`\u2717 UpWrite: Webhook failed \u2014 ${err.message}`, "error");

  } finally {
    chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

/* ------------------------------------------------------------------ */
/*  In-memory set of tabs where the content script has signalled ready  */
/* ------------------------------------------------------------------ */
const readyTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /* ---- Offscreen chime finished — close the document ---- */
  if (message.type === "CHIME_DONE") {
    chrome.offscreen.closeDocument().catch(() => {});
    return false;
  }

  /* ---- Content script ready notification ---- */
  if (message.type === "CONTENT_SCRIPT_READY") {
    if (sender.tab?.id) readyTabs.add(sender.tab.id);
    // Reply with the tabId so the content script can use it for storage lookups
    sendResponse({ tabId: sender.tab?.id ?? null });
    return true;
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

  /* ---- Recording complete (from recorder.html tab) ---- */
  if (message.type === "RECORDING_COMPLETE") {
    chrome.storage.local.set({ recordingDone: true }, () => {
      sendResponse({ success: true });
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
