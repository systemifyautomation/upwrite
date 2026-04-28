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

// Maps notification ID → proposal tabId so the click handler can focus it.
const notifTabMap = new Map();

async function showNotificationWindow(message, type /* "success" | "error" */, tabId = null) {
  const notifId = `upwrite_${Date.now()}`;
  if (tabId != null) notifTabMap.set(notifId, tabId);

  await chrome.notifications.create(notifId, {
    type:    "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title:   type === "error" ? "UpWrite – Error" : "UpWrite – Proposal Ready",
    message,
  });

  // Auto-clear after 10 seconds
  setTimeout(() => {
    chrome.notifications.clear(notifId);
    notifTabMap.delete(notifId);
  }, 10000);
}

// Click → focus the proposal tab
chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId);
  const tabId = notifTabMap.get(notifId);
  notifTabMap.delete(notifId);
  if (tabId == null) return;
  chrome.tabs.update(tabId, { active: true }, () => {
    if (chrome.runtime.lastError) return;
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab?.windowId) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Recording state                                                      */
/* ------------------------------------------------------------------ */
// Tab where the recorder overlay is currently injected.
let activeOverlayTabId = null;



/* ------------------------------------------------------------------ */
/*  IndexedDB helpers (SW shares origin with recorder.html)             */
/* ------------------------------------------------------------------ */
function openSwDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("upwrite-db", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("recordings");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getRecordingFromIDB() {
  const db = await openSwDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("recordings", "readonly");
    const req = tx.objectStore("recordings").get("current");
    req.onsuccess = (e) => {
      const rec = e.target.result;
      if (!rec) return resolve(null);
      // Duck-type check instead of instanceof to handle cross-realm ArrayBuffers.
      let blob;
      if (rec.buffer && rec.buffer.byteLength > 0) {
        blob = new Blob([rec.buffer], { type: rec.mimeType || "video/webm" });
      } else if (rec.blob && rec.blob.size > 0) {
        blob = rec.blob;
      } else {
        return resolve(null); // unreadable or empty record
      }
      resolve({ ...rec, blob });
    };
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function deleteRecordingFromIDB() {
  const db = await openSwDB();
  return new Promise((resolve) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").delete("current");
    tx.oncomplete = () => resolve();
  });
}

// recorder-overlay.js handles recording entirely in the content-script
// context — no IDB access needed here for chunk streaming.

/* ------------------------------------------------------------------ */
/*  Offscreen document management                                        */
/*  One document is kept alive during recording; re-created for chimes.  */
/* ------------------------------------------------------------------ */

/**
 * Ensure the offscreen document exists.
 * reasons: array — e.g. ["DISPLAY_MEDIA", "AUDIO_PLAYBACK"]
 * When recording is active the doc is already open with DISPLAY_MEDIA;
 * we keep it alive so the chime can play in the same doc.
 */
async function ensureOffscreenDoc(reasons, justification) {
  try {
    const exists = await chrome.offscreen.hasDocument().catch(() => false);
    if (!exists) {
      await chrome.offscreen.createDocument({
        url:    chrome.runtime.getURL("offscreen.html"),
        reasons,
        justification,
      });
    }
  } catch (_) {
    // Already exists or API unavailable — non-fatal
  }
}

/* ------------------------------------------------------------------ */
/*  Chime player                                                         */
/* ------------------------------------------------------------------ */
async function playChime() {
  // Re-use the offscreen doc if it already exists (e.g. during recording).
  // Otherwise create one just for audio playback.
  await ensureOffscreenDoc(["AUDIO_PLAYBACK"], "Play proposal-ready notification chime.");
  chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY_CHIME" }).catch(() => {});
}

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

async function processProposal({ tabId, webhookUrl, payload, hasVideo }) {
  // Start the keepalive alarm — cleared in the finally block
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  try {
    // Always send multipart/form-data so n8n receives the same structure
    // whether or not a video is attached.
    //  • "payload" field — the full proposal JSON serialized as a string
    //    (n8n receives it in $json.payload, identical in both cases)
    //  • "video" field   — binary recording, present only when hasVideo is true
    const formData = new FormData();
    formData.append("payload", JSON.stringify(payload));

    if (hasVideo) {
      try {
        const items = await new Promise((r) => chrome.storage.local.get("upwrite_recording", r));
        const rec = items.upwrite_recording;
        if (rec?.buffer) {
          const blob = new Blob([rec.buffer], { type: rec.mimeType || "video/webm" });
          const ext  = (rec.mimeType || "").includes("mp4") ? "mp4" : "webm";
          formData.append("video", blob, `recording.${ext}`);
        }
      } catch (_) { /* blob unavailable — send without video */ }
    }

    const res = await fetch(webhookUrl, { method: "POST", body: formData });

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
    showNotificationWindow("\u2713 UpWrite: Proposal ready! Fields have been filled in.", "success", tabId);

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
    showNotificationWindow(`\u2717 UpWrite: Webhook failed \u2014 ${err.message}`, "error", tabId);

  } finally {
    chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

/* ------------------------------------------------------------------ */
/*  In-memory set of tabs where the content script has signalled ready  */
/* ------------------------------------------------------------------ */
const readyTabs = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /* ---- Offscreen chime finished ---- */
  if (message.type === "CHIME_DONE") {
    chrome.offscreen.closeDocument().catch(() => {});
    return false;
  }

  /* ---- Popup: inject recorder overlay into the active Upwork tab ---- */
  if (message.type === "OPEN_RECORDER") {
    const tabId = message.tabId;
    if (!tabId) { sendResponse({ ok: false, error: "No target tab." }); return true; }
    chrome.scripting.executeScript({
      target: { tabId },
      files:  ["recorder-overlay.js"],
    }).then(() => {
      activeOverlayTabId = tabId;
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  /* ---- Overlay requests screen picker via desktopCapture + opens recorder.html ---- */
  if (message.type === "REQUEST_SCREEN_CAPTURE") {
    const senderTab = sender.tab;
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen", "window", "tab"],
      senderTab,
      (streamId) => {
        if (!streamId) {
          // User cancelled the picker
          if (senderTab?.id) {
            chrome.tabs.sendMessage(senderTab.id, { type: "SCREEN_CAPTURE_CANCELLED" }).catch(() => {});
          }
          sendResponse({ ok: false, cancelled: true });
          return;
        }
        pendingStreamId = streamId;
        chrome.windows.create(
          { url: chrome.runtime.getURL("recorder.html"), type: "popup", width: 220, height: 60, focused: false },
          (win) => {
            activeRecorderWindowId = win.id;
            recorderTabId = win.tabs[0].id;
            sendResponse({ ok: true });
          }
        );
      }
    );
    return true; // async sendResponse
  }

  /* ---- recorder.html is ready — hand off the pending stream ID ---- */
  if (message.type === "RECORDER_READY") {
    const sid = pendingStreamId;
    pendingStreamId = null;
    sendResponse({ streamId: sid || null });
    return true;
  }

  /* ---- recorder.js signals recording has started — relay to overlay ---- */
  if (message.type === "RECORDING_STARTED") {
    if (overlayTabId) {
      chrome.tabs.sendMessage(overlayTabId, { type: "RECORDING_STARTED" }).catch(() => {});
    }
    return false;
  }

  /* ---- Timer tick from recorder.js — relay to overlay ---- */
  if (message.type === "RECORDING_TICK") {
    if (overlayTabId) {
      chrome.tabs.sendMessage(overlayTabId, { type: "RECORDING_TICK", seconds: message.seconds }).catch(() => {});
    }
    return false;
  }

  /* ---- Overlay stop button — forward to recorder.html ---- */
  if (message.type === "STOP_RECORDING") {
    if (recorderTabId) {
      chrome.tabs.sendMessage(recorderTabId, { type: "STOP_RECORDING" }).catch(() => {});
    }
    return false;
  }

  /* ---- recorder.js finished — persist metadata and notify overlay ---- */
  if (message.type === "RECORDING_COMPLETE") {
    const { ok, size, duration, mimeType: recMimeType, error } = message;
    activeRecorderWindowId = null;
    recorderTabId = null;
    if (ok) {
      chrome.storage.local.set({
        upwrite_recording_meta: { size, duration, mimeType: recMimeType, timestamp: Date.now() },
      });
    } else {
      chrome.storage.local.set({ upwrite_recording_error: error || "Recording failed." });
    }
    if (overlayTabId) {
      chrome.tabs.sendMessage(overlayTabId, { type: "RECORDING_COMPLETE", ok, error }).catch(() => {});
      overlayTabId = null;
    }
    return false;
  }

  /* ---- Overlay: recording is ready in chrome.storage.local ---- */
  // The content script already wrote the buffer to chrome.storage.local
  // (content scripts share extension storage). We just stamp the meta flag
  // so the popup knows to show the preview.
  if (message.type === "RECORDING_DONE") {
    const { duration, mimeType, size } = message;
    chrome.storage.local.set({
      upwrite_recording_meta: { size, duration, mimeType, timestamp: Date.now() },
    });
    sendResponse({ ok: true });
    return true;
  }

  /* ---- Delete stored recording (from popup) ---- */
  if (message.type === "DELETE_RECORDING") {
    deleteRecordingFromIDB().catch(() => {});
    chrome.storage.local.remove(["upwrite_recording", "upwrite_recording_meta", "upwrite_recording_error"]);
    sendResponse({ ok: true });
    return false;
  }

  /* ---- Content script ready notification ---- */
  if (message.type === "CONTENT_SCRIPT_READY") {
    if (sender.tab?.id) readyTabs.add(sender.tab.id);
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

    return true;
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
