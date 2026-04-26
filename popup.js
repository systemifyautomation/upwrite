/**
 * Upright – Popup Script
 *
 * Orchestrates:
 *  1. Settings (webhook URL persistence via chrome.storage.sync)
 *  2. Extraction of proposal data from the active Upwork tab
 *  3. Loom video URL capture
 *  4. Sending the payload to the n8n webhook via background service worker
 *  5. Rendering the AI-generated response fields
 *  6. Auto-filling the proposal form via the content script
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
  loomUrl: "",
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
/*  Extract proposal                                                    */
/* ================================================================== */
function extractProposal() {
  if (!state.activeTabId) return;
  showStatus("Extracting proposal data…", "info");

  chrome.tabs.sendMessage(
    state.activeTabId,
    { type: "EXTRACT_PROPOSAL" },
    (response) => {
      if (chrome.runtime.lastError) {
        showStatus(
          "Could not reach the page. Try refreshing the proposal page.",
          "error"
        );
        return;
      }
      if (!response || !response.success) {
        showStatus(response?.error || "Extraction failed.", "error");
        return;
      }
      state.proposalData = response.data;
      renderProposalData(response.data);
      updateSendButton();
      clearStatus();
    }
  );
}

function renderProposalData(data) {
  hide($("extract-placeholder"));
  show($("proposal-data"));

  $("data-job-title").textContent = data.jobTitle || "—";
  $("data-job-title").title = data.jobTitle || "";

  $("data-client").textContent = data.clientName || "—";
  $("data-budget").textContent = data.budget || "—";

  const coverEl = $("data-cover-found");
  if (data.coverLetter.found) {
    coverEl.textContent = "Found";
    coverEl.className = "data-value data-value--badge badge--found";
  } else {
    coverEl.textContent = "Not found";
    coverEl.className = "data-value data-value--badge badge--not-found";
  }

  const qCount = data.questions.length;
  $("data-questions-count").textContent = qCount === 0 ? "None" : `${qCount}`;
}

/* ================================================================== */
/*  Loom video                                                          */
/* ================================================================== */
function openLoomRecorder() {
  // Opens the Loom web recorder in a new tab.
  // After recording, the user can paste the share URL back.
  chrome.tabs.create({ url: "https://www.loom.com/record" });
}

function setLoomUrl(url) {
  if (!url) return;
  state.loomUrl = url.trim();
  $("loom-url-display").textContent = truncateUrl(state.loomUrl, 38);
  $("loom-url-display").href = state.loomUrl;
  show($("loom-recorded"));
  hide($("loom-not-recorded"));
  updateSendButton();
}

function removeLoom() {
  state.loomUrl = "";
  $("input-loom-url").value = "";
  hide($("loom-recorded"));
  show($("loom-not-recorded"));
  updateSendButton();
}

function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + "…";
}

/* ================================================================== */
/*  Send to webhook                                                     */
/* ================================================================== */
function updateSendButton() {
  const btn = $("btn-send");
  btn.disabled = !state.proposalData || !state.webhookUrl;
}

function buildPayload() {
  const data = state.proposalData;
  return {
    source: "upright-extension",
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
    loomUrl: state.loomUrl || null,
    sentAt: new Date().toISOString(),
  };
}

function sendToWebhook() {
  if (!state.proposalData || !state.webhookUrl) return;

  const btn = $("btn-send");
  btn.disabled = true;
  btn.textContent = "Sending…";
  showStatus("Sending to webhook…", "info");

  const payload = buildPayload();

  chrome.runtime.sendMessage(
    { type: "SEND_WEBHOOK", url: state.webhookUrl, payload },
    (response) => {
      btn.textContent = "Send to Webhook";
      updateSendButton();

      if (!response || !response.success) {
        showStatus(
          `Webhook error: ${response?.error || "Unknown error"}`,
          "error"
        );
        return;
      }

      showStatus("Response received!", "success");
      state.webhookResponse = response.data;
      renderResponse(response.data);
    }
  );
}

/* ================================================================== */
/*  Render webhook response                                             */
/* ================================================================== */
function renderResponse(data) {
  const container = $("response-fields");
  container.innerHTML = "";

  // Normalise: the webhook can return various shapes.
  // Expected shape: { coverLetter: string, questions: string[] }
  // But we also handle arrays and plain strings gracefully.
  let coverLetter = "";
  let questions = [];

  if (typeof data === "string") {
    coverLetter = data;
  } else if (Array.isArray(data)) {
    // Treat first item as cover letter, rest as question answers
    [coverLetter, ...questions] = data;
  } else if (data && typeof data === "object") {
    // Accept camelCase (coverLetter), snake_case (cover_letter), or generic "text"
    // to stay compatible with different n8n workflow output node configurations.
    coverLetter = data.coverLetter || data.cover_letter || data.text || "";
    if (Array.isArray(data.questions)) {
      questions = data.questions;
    } else if (Array.isArray(data.answers)) {
      questions = data.answers;
    }
  }

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
/*  Auto-fill                                                           */
/* ================================================================== */
function autofillForm() {
  if (!state.webhookResponse || !state.activeTabId) return;

  const btn = $("btn-autofill");
  btn.disabled = true;
  btn.textContent = "Filling…";

  chrome.tabs.sendMessage(
    state.activeTabId,
    { type: "AUTOFILL_PROPOSAL", payload: state.webhookResponse },
    (response) => {
      btn.disabled = false;
      btn.textContent = "Auto-fill Form";

      const autofillStatus = $("autofill-status");
      if (chrome.runtime.lastError || !response || !response.success) {
        autofillStatus.textContent =
          response?.error || "Auto-fill failed. Refresh the page and try again.";
        autofillStatus.className = "status-bar status-bar--error";
        show(autofillStatus);
        return;
      }

      const filled = response.results.length;
      autofillStatus.textContent = `✓ ${filled} field${filled !== 1 ? "s" : ""} filled successfully.`;
      autofillStatus.className = "status-bar status-bar--success";
      show(autofillStatus);
      setTimeout(() => hide(autofillStatus), 3000);
    }
  );
}

/* ================================================================== */
/*  Event listeners                                                     */
/* ================================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await initView();

  /* -- Header -- */
  $("btn-settings").addEventListener("click", () => showSettingsPanel(true));

  /* -- Settings panel -- */
  $("btn-settings-save").addEventListener("click", saveSettings);
  $("btn-settings-cancel").addEventListener("click", () =>
    showSettingsPanel(false)
  );

  /* -- Extract -- */
  $("btn-extract").addEventListener("click", extractProposal);
  $("btn-re-extract").addEventListener("click", () => {
    state.proposalData = null;
    hide($("proposal-data"));
    show($("extract-placeholder"));
    hide($("section-response"));
    updateSendButton();
  });

  /* -- Loom -- */
  $("btn-record-loom").addEventListener("click", openLoomRecorder);
  $("input-loom-url").addEventListener("change", (e) => {
    const url = e.target.value.trim();
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname === "loom.com" ||
        parsed.hostname.endsWith(".loom.com")
      ) {
        setLoomUrl(url);
      }
    } catch (_) {
      // ignore invalid URLs
    }
  });
  $("btn-remove-loom").addEventListener("click", removeLoom);

  /* -- Send -- */
  $("btn-send").addEventListener("click", sendToWebhook);
  $("btn-open-settings-from-warning").addEventListener("click", () =>
    showSettingsPanel(true)
  );

  /* -- Response -- */
  $("btn-copy-all").addEventListener("click", copyAll);
  $("btn-autofill").addEventListener("click", autofillForm);
});
