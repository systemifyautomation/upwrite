/**
 * UpWrite – Popup Script
 *
 * Orchestrates:
 *  1. Settings (webhook URL persistence via chrome.storage.sync)
 *  2. Optional video URL capture
 *  3. Auto-extract proposal data, send to the n8n webhook,
 *     and auto-fill the form with the AI-generated response
 */

"use strict";

/* ================================================================== */
/*  DOM helpers                                                         */
/* ================================================================== */
const $ = (id) => document.getElementById(id);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");
const isHidden = (el) => el && el.classList.contains("hidden");

/* ================================================================== */
/*  State                                                               */
/* ================================================================== */
let state = {
  webhookUrl: "",
  proposalData: null,      // extracted from content script
  webhookResponse: null,   // AI-generated response from n8n
  videoUrl: "",
  activeTabId: null,
};

/* ================================================================== */
/*  Status bar helpers                                                  */
/* ================================================================== */
function showStatus(message, type = "info") {
  const bar = $("status-bar");
  const text = $("status-text");
  text.textContent = message;
  bar.className = `status-bar status-bar--${type}`;
  show(bar);
}

function clearStatus() {
  hide($("status-bar"));
}

/* ================================================================== */
/*  Settings                                                            */
/* ================================================================== */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "LOAD_SETTINGS" }, (response) => {
      if (response && response.success) {
        state.webhookUrl = response.settings.webhookUrl || "";
        $("input-webhook").value = state.webhookUrl;
      }
      resolve();
    });
  });
}

function saveSettings() {
  const url = $("input-webhook").value.trim();
  chrome.runtime.sendMessage(
    { type: "SAVE_SETTINGS", settings: { webhookUrl: url } },
    () => {
      state.webhookUrl = url;
      showSettingsPanel(false);
      updateSendButton();
      showStatus("Settings saved.", "success");
      setTimeout(clearStatus, 2500);
    }
  );
}

function showSettingsPanel(visible) {
  if (visible) {
    hide($("view-main"));
    hide($("view-not-upwork"));
    show($("view-settings"));
  } else {
    hide($("view-settings"));
    // Restore appropriate main view
    initView();
  }
}

/* ================================================================== */
/*  View routing                                                        */
/* ================================================================== */
async function initView() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTabId = tab?.id ?? null;

  const isUpworkProposal =
    tab?.url &&
    /https:\/\/www\.upwork\.com\/(nx\/proposals|ab\/proposals|proposals)\//.test(tab.url);

  if (!isUpworkProposal) {
    hide($("view-settings"));
    hide($("view-main"));
    show($("view-not-upwork"));
    return;
  }

  hide($("view-settings"));
  hide($("view-not-upwork"));
  show($("view-main"));
  updateSendButton();
  updateWebhookWarning();
}

/* ================================================================== */
/*  Webhook warning                                                     */
/* ================================================================== */
function updateWebhookWarning() {
  if (!state.webhookUrl) {
    show($("no-webhook-warning"));
  } else {
    hide($("no-webhook-warning"));
  }
}

/* ================================================================== */
/*  Extract proposal (internal, Promise-based)                          */
/* ================================================================== */
function doExtract() {
  return new Promise((resolve) => {
    if (!state.activeTabId) return resolve(null);
    chrome.tabs.sendMessage(
      state.activeTabId,
      { type: "EXTRACT_PROPOSAL" },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus(
            "Could not reach the page. Try refreshing the proposal page.",
            "error"
          );
          return resolve(null);
        }
        if (!response || !response.success) {
          showStatus(response?.error || "Extraction failed.", "error");
          return resolve(null);
        }
        resolve(response.data);
      }
    );
  });
}

/* ================================================================== */
/*  Screen recording                                                    */
/* ================================================================== */
function openRecorder() {
  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html") });
}

function setVideoUrl(url) {
  if (!url) return;
  state.videoUrl = url.trim();
  $("video-url-display").textContent = truncateUrl(state.videoUrl, 38);
  $("video-url-display").href = state.videoUrl;
  show($("video-recorded"));
  hide($("video-not-recorded"));
  updateSendButton();
}

function removeVideo() {
  state.videoUrl = "";
  $("input-video-url").value = "";
  hide($("video-recorded"));
  show($("video-not-recorded"));
  updateSendButton();
}

function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + "…";
}

async function checkRecordingDone() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["recordingDone"], (items) => {
      if (items.recordingDone) {
        show($("record-done-hint"));
        chrome.storage.local.remove(["recordingDone"]);
      }
      resolve();
    });
  });
}

/* ================================================================== */
/*  Send to webhook                                                     */
/* ================================================================== */
function updateSendButton() {
  const btn = $("btn-send");
  btn.disabled = !state.webhookUrl;
}

function buildPayload() {
  const data = state.proposalData;
  return {
    source: "upwrite-extension",
    pageUrl: data.pageUrl,
    job: {
      title: data.jobTitle,
      description: data.jobDescription,
      clientName: data.clientName,
      budget: data.budget,
    },
    proposal: {
      coverLetter: {
        placeholder: data.coverLetter.placeholder,
        currentValue: data.coverLetter.currentValue,
      },
      questions: data.questions.map((q) => ({
        label: q.label,
        placeholder: q.placeholder,
        currentValue: q.currentValue,
      })),
    },
    videoUrl: state.videoUrl || null,
    sentAt: new Date().toISOString(),
  };
}

async function sendToWebhook() {
  if (!state.webhookUrl) return;

  const btn = $("btn-send");
  btn.disabled = true;
  btn.textContent = "Extracting…";
  showStatus("Extracting proposal data…", "info");

  const data = await doExtract();
  if (!data) {
    btn.textContent = "Generate Proposal";
    updateSendButton();
    return;
  }
  state.proposalData = data;

  // Disable the button for 5 seconds after sending
  btn.disabled = true;
  btn.textContent = "Please wait…";
  setTimeout(() => {
    btn.textContent = "Generate Proposal";
    updateSendButton();
  }, 5000);

  showStatus("Sent to AI — working in the background. You can close this popup.", "success");

  const payload = buildPayload();

  // Write the job to storage. The background picks it up via storage.onChanged,
  // which is immune to the popup closing (unlike sendMessage which dies with the port).
  chrome.storage.local.set({
    upwrite_pending: {
      tabId:      state.activeTabId,
      webhookUrl: state.webhookUrl,
      payload,
    },
  });
}

function extractString(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    return v.answer || v.text || v.value || v.content || JSON.stringify(v);
  }
  return String(v ?? "");
}

/* ================================================================== */
/*  Render webhook response                                             */
/* ================================================================== */
function renderResponse(data) {
  // Unwrap n8n's single-element array wrapper
  if (Array.isArray(data) && data.length === 1 &&
      data[0] !== null && typeof data[0] === "object" && !Array.isArray(data[0])) {
    data = data[0];
  }

  let coverLetter = "";
  let questions   = [];

  if (typeof data === "string") {
    coverLetter = data;
  } else if (Array.isArray(data)) {
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

  const container = $("response-fields");
  container.innerHTML = "";

  // Store normalised for autofill
  state.webhookResponse = { coverLetter, questions };

  // Render cover letter
  container.appendChild(
    createResponseField("Cover Letter", "coverLetter", coverLetter, null)
  );

  // Render each question answer
  const questionDefs = state.proposalData?.questions || [];
  questions.forEach((answer, i) => {
    const label = questionDefs[i]?.label || `Question ${i + 1}`;
    container.appendChild(createResponseField(label, "question", answer, i));
  });

  show($("section-response"));
}

function createResponseField(label, type, value, index) {
  const wrap = document.createElement("div");
  wrap.className = "response-field";

  const lbl = document.createElement("div");
  lbl.className = "response-field__label";
  lbl.textContent = label;

  const ta = document.createElement("textarea");
  ta.className = "response-field__textarea";
  ta.dataset.type = type;
  if (index !== null && index !== undefined) ta.dataset.index = String(index);
  ta.value = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  ta.rows = 5;
  ta.addEventListener("input", () => {
    // Keep state in sync when user edits the textarea manually
    if (type === "coverLetter") {
      state.webhookResponse.coverLetter = ta.value;
    } else if (type === "question") {
      const idx = parseInt(ta.dataset.index, 10);
      const questions = state.webhookResponse?.questions;
      if (Array.isArray(questions) && !isNaN(idx) && idx >= 0 && idx < questions.length) {
        questions[idx] = ta.value;
      }
    }
  });

  wrap.appendChild(lbl);
  wrap.appendChild(ta);
  return wrap;
}

/* ================================================================== */
/*  Copy all                                                            */
/* ================================================================== */
function copyAll() {
  if (!state.webhookResponse) return;
  const parts = [];
  if (state.webhookResponse.coverLetter) {
    parts.push(`--- Cover Letter ---\n${state.webhookResponse.coverLetter}`);
  }
  state.webhookResponse.questions.forEach((q, i) => {
    const label = state.proposalData?.questions[i]?.label || `Question ${i + 1}`;
    parts.push(`--- ${label} ---\n${q}`);
  });
  navigator.clipboard
    .writeText(parts.join("\n\n"))
    .then(() => {
      const btn = $("btn-copy-all");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1500);
    })
    .catch((err) => showStatus(`Copy failed: ${err.message}`, "error"));
}

/* ================================================================== */
/*  Handle background-completed response                                */
/* ================================================================== */
function handleStoredResponse(stored) {
  if (stored.error) {
    showStatus(`Webhook error: ${stored.error}`, "error");
    return;
  }
  if (stored.raw !== undefined) {
    renderResponse(stored.raw);
    showStatus("Proposal generated and form filled!", "success");
    setTimeout(clearStatus, 4000);
  }
}

async function checkPendingResponse() {
  if (!state.activeTabId) return;
  const key = `response_${state.activeTabId}`;
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (items) => {
      if (items[key]) {
        const stored = items[key];
        chrome.storage.local.remove([key]);
        handleStoredResponse(stored);
      }
      resolve();
    });
  });
}

/* ================================================================== */
/*  Live storage listener — updates popup if it stays open while AI    */
/*  is working in the background                                        */
/* ================================================================== */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !state.activeTabId) return;
  const key = `response_${state.activeTabId}`;
  if (!changes[key]?.newValue) return;
  const stored = changes[key].newValue;
  chrome.storage.local.remove([key]);
  handleStoredResponse(stored);
});

/* ================================================================== */
/*  Event listeners                                                     */
/* ================================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await initView();
  await checkRecordingDone();
  await checkPendingResponse();

  // Clear any badge the background set for this tab
  if (state.activeTabId) {
    chrome.action.setBadgeText({ text: "", tabId: state.activeTabId });
  }

  /* -- Header -- */
  $("btn-settings").addEventListener("click", () => showSettingsPanel(true));

  /* -- Settings panel -- */
  $("btn-settings-save").addEventListener("click", saveSettings);
  $("btn-settings-cancel").addEventListener("click", () =>
    showSettingsPanel(false)
  );

  /* -- Recording -- */
  $("btn-start-recording").addEventListener("click", openRecorder);
  $("input-video-url").addEventListener("change", (e) => {
    const url = e.target.value.trim();
    try {
      new URL(url); // validate
      if (url) {
        setVideoUrl(url);
      }
    } catch (_) {
      // ignore invalid URLs
    }
  });
  $("btn-remove-video").addEventListener("click", removeVideo);

  /* -- Send -- */
  $("btn-send").addEventListener("click", sendToWebhook);
  $("btn-open-settings-from-warning").addEventListener("click", () =>
    showSettingsPanel(true)
  );

  /* -- Response -- */
  $("btn-copy-all").addEventListener("click", copyAll);
});
