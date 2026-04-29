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
let overlayTabId           = null;  // tab with the active recording overlay
let activeRecorderWindowId = null;  // windowId of the open recorder.html popup
let recorderTabId          = null;  // tabId of the recorder.html page



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
      // Support both new format (buffer: ArrayBuffer) and old format (blob: Blob)
      let blob;
      if (rec.buffer instanceof ArrayBuffer) {
        blob = new Blob([rec.buffer], { type: rec.mimeType || "video/webm" });
      } else if (rec.blob instanceof Blob) {
        blob = rec.blob;
      } else {
        return resolve(null); // unreadable record
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

async function saveRecordingToIDB(buffer, duration, mimeType) {
  const db = await openSwDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").put(
      { buffer, duration, mimeType, timestamp: Date.now(), size: buffer.byteLength },
      "current"
    );
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Camera-only recording: chunk port handler                           */
/*  Overlay streams ArrayBuffer chunks via a long-lived port; we        */
/*  reassemble them here and save to the extension's IDB.               */
/* ------------------------------------------------------------------ */
let _camChunks       = [];
let _camOverlayTabId = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recording-stream") return;
  _camChunks       = [];
  _camOverlayTabId = overlayTabId;  // capture at connect time

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "CHUNK" && msg.chunk instanceof ArrayBuffer) {
      _camChunks.push(msg.chunk);
    }
    if (msg.type === "RECORDING_DONE") {
      const mimeType = msg.mimeType || "video/webm";
      const duration = msg.duration || 0;
      const chunks   = _camChunks;
      _camChunks     = [];

      const totalSize = chunks.reduce((s, b) => s + b.byteLength, 0);
      const combined  = new Uint8Array(totalSize);
      let offset = 0;
      for (const buf of chunks) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }

      try {
        await saveRecordingToIDB(combined.buffer, duration, mimeType);
        chrome.storage.local.set({
          upwrite_recording_meta: { size: combined.byteLength, duration, mimeType, timestamp: Date.now() },
        });
        if (_camOverlayTabId) {
          chrome.tabs.sendMessage(_camOverlayTabId, { type: "RECORDING_COMPLETE", ok: true, duration }).catch(() => {});
        }
      } catch (err) {
        if (_camOverlayTabId) {
          chrome.tabs.sendMessage(_camOverlayTabId, { type: "RECORDING_COMPLETE", ok: false, error: String(err) }).catch(() => {});
        }
      }
      overlayTabId     = null;
      _camOverlayTabId = null;
    }
  });

  port.onDisconnect.addListener(() => { _camChunks = []; });
});

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
  // Recording now runs in recorder.js, not the offscreen doc.
  // Create the offscreen doc only for audio chime playback.
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

async function scrollToJobTitle(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          "h3.h5",
          "h1.job-title",
          "[data-test='job-title']",
          "[data-qa='job-title']",
          "h1[class*='title']",
          "h1",
        ];

        let titleEl = null;
        for (const selector of selectors) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              titleEl = el;
              break;
            }
          } catch (_) {
            // ignore invalid selectors
          }
        }

        if (titleEl) {
          titleEl.scrollIntoView({ behavior: "auto", block: "start" });
          // Keep some breathing room above the title for cleaner screenshots.
          window.scrollBy(0, -12);
          return true;
        }

        window.scrollTo({ top: 0, behavior: "auto" });
        return false;
      },
    });
  } catch (_) {
    // Non-fatal: capture can still be attempted.
  }
}

async function focusTabForCapture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.windowId) return null;

  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});

  // Give Chrome a short moment to switch active tab and paint.
  await new Promise((resolve) => setTimeout(resolve, 180));

  return tab;
}

async function captureJobTitleScreenshot(tabId) {
  try {
    const tab = await focusTabForCapture(tabId);
    if (!tab?.windowId) {
      return { blob: null, error: "Tab/window not available for screenshot." };
    }

    await scrollToJobTitle(tabId);
    // Give the tab one paint frame to settle after scroll before capture.
    await new Promise((resolve) => setTimeout(resolve, 220));

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });

    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      return { blob: null, error: "captureVisibleTab returned empty data URL." };
    }

    const blob = await fetch(dataUrl).then((r) => r.blob());
    if (!blob || blob.size === 0) {
      return { blob: null, error: "Captured image blob is empty." };
    }

    return { blob, error: null };
  } catch (err) {
    return { blob: null, error: String(err) };
  }
}

async function processProposal({ tabId, webhookUrl, payload, hasVideo, screenshotMode }) {
  // Start the keepalive alarm — cleared in the finally block
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  try {
    // Always send multipart/form-data so n8n receives the same structure
    // whether or not a video is attached.
    //  • "payload" field — the full proposal JSON serialized as a string
    //    (n8n receives it in $json.payload, identical in both cases)
    //  • "video" field   — binary recording, present only when hasVideo is true
    const formData = new FormData();

    let uploadedVideo = false;
    let usedScreenshot = false;
    let screenshotError = null;

    // Only attempt to read a recorded/uploaded blob from IDB when the user's
    // chosen mode can actually produce one (not auto-mode, not URL mode).
    // This prevents a leftover blob from a previous submission being reused.
    const canHaveBlob = !screenshotMode && !payload.videoUrl;
    if (canHaveBlob) {
      try {
        const rec = await getRecordingFromIDB();
        if (rec?.blob) {
          const ext = rec.blob.type.includes("mp4") ? "mp4" : "webm";
          formData.append("video", rec.blob, `recording.${ext}`);
          uploadedVideo = true;
          // Delete immediately so it isn't reused on the next submission.
          await deleteRecordingFromIDB().catch(() => {});
        }
      } catch (_) { /* blob unavailable — continue */ }
    }

    // Only take a screenshot when the user explicitly chose "Automated screenshot" mode.
    if (screenshotMode && !uploadedVideo && !payload.videoUrl) {
      const capture = await captureJobTitleScreenshot(tabId);
      screenshotError = capture.error;
      if (capture.blob) {
        formData.append("screenshot", capture.blob, `job-title-${Date.now()}.png`);
        usedScreenshot = true;
      }
    }

    // Include lightweight context flags to simplify n8n branching and debugging.
    const contextImageType = uploadedVideo ? "video" : (usedScreenshot ? "screenshot" : "none");
    formData.append("context_image_type", contextImageType);
    if (screenshotError) {
      formData.append("context_image_error", screenshotError.slice(0, 500));
    }
    formData.append("payload", JSON.stringify(payload));

    chrome.storage.local.set({
      upwrite_last_context_capture: {
        tabId,
        type: contextImageType,
        error: screenshotError || null,
        timestamp: Date.now(),
      },
    });

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
  /* ---- Offscreen chime finished — close doc only if not recording ---- */
  if (message.type === "CHIME_DONE") {
    // Don't close the offscreen doc while it's still needed for recording
    if (!activeRecorderWindowId) {
      chrome.offscreen.closeDocument().catch(() => {});
    }
    return false;
  }

  /* ---- Popup: inject pre-recording overlay into the active tab ---- */
  if (message.type === "INJECT_RECORDER_OVERLAY") {
    const tabId = message.tabId;
    if (!tabId) { sendResponse({ ok: false, error: "No tabId provided." }); return true; }
    overlayTabId = tabId;
    chrome.scripting.executeScript({
      target: { tabId },
      files:  ["recorder-overlay.js"],
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => {
        overlayTabId = null;
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  /* ---- Overlay requests screen recording — open recorder.html directly ---- */
  if (message.type === "REQUEST_SCREEN_CAPTURE") {
    // recorder.html calls getDisplayMedia() itself — extension pages can do this
    // without a user gesture and without the chooseDesktopMedia/streamId flow,
    // which is incompatible with service-worker context.
    chrome.windows.create(
      { url: chrome.runtime.getURL("recorder.html"), type: "popup", width: 520, height: 480, focused: true },
      (win) => {
        activeRecorderWindowId = win.id;
        recorderTabId = win.tabs[0].id;
        sendResponse({ ok: true });
      }
    );
    return true; // async sendResponse
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

  /* ---- Save recording to Downloads folder ---- */
  if (message.type === "DOWNLOAD_RECORDING") {
    getRecordingFromIDB()
      .then((rec) => {
        if (!rec?.blob) { sendResponse({ ok: false, error: "No recording found." }); return; }
        const ext     = (rec.mimeType || "video/webm").includes("mp4") ? "mp4" : "webm";
        const blobUrl = URL.createObjectURL(rec.blob);
        chrome.downloads.download(
          { url: blobUrl, filename: `upwrite-recording-${Date.now()}.${ext}`, saveAs: false },
          (downloadId) => {
            // Revoke blob URL once the download manager has queued the item
            URL.revokeObjectURL(blobUrl);
            if (chrome.runtime.lastError || downloadId === undefined) {
              sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Download failed." });
            } else {
              sendResponse({ ok: true, downloadId });
            }
          }
        );
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async sendResponse
  }

  /* ---- Delete stored recording (from popup) ---- */
  if (message.type === "DELETE_RECORDING") {
    deleteRecordingFromIDB().catch(() => {});
    chrome.storage.local.remove(["upwrite_recording_meta", "upwrite_recording_error"]);
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

  /* ---- Popup: load recording buffer from IDB ---- */
  if (message.type === "GET_RECORDING") {
    getRecordingFromIDB()
      .then((rec) => {
        if (!rec?.buffer) {
          sendResponse({ buffer: null });
        } else {
          sendResponse({
            buffer:   rec.buffer,
            duration: rec.duration,
            size:     rec.size,
            mimeType: rec.mimeType,
          });
        }
      })
      .catch(() => sendResponse({ buffer: null }));
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
