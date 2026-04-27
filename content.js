/**
 * UpWrite – Content Script
 *
 * Runs on Upwork proposal pages. Responsible for:
 *  1. Extracting job + proposal field data from the DOM.
 *  2. Receiving "AUTOFILL" messages from the popup and writing
 *     AI-generated text back into the proposal form fields.
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Selector registry                                                    */
  /*  Upwork's UI changes periodically; keeping selectors in one place    */
  /*  makes future maintenance straightforward.                           */
  /* ------------------------------------------------------------------ */
  const SELECTORS = {
    jobTitle: [
      "h3.h5",           // observed DOM: <h3 class="mb-6x h5">
      "h1.job-title",
      "[data-test='job-title']",
      "[data-qa='job-title']",
      "h1[class*='title']",
      "h1",
    ],
    jobDescription: [
      // Upwork proposal page – specific class from observed DOM
      "div.description.text-body-sm",
      "[data-test='description']",
      "[data-qa='description']",
      ".job-description",
      "[class*='description']",
      "[class*='job-details']",
    ],
    // "more" button inside the air3 truncation widget
    descriptionMoreBtn: [
      "div.description button.air3-truncation-btn[aria-expanded='false']",
      "button.air3-truncation-btn[aria-expanded='false']",
      "button[data-ev-label='truncation_toggle'][aria-expanded='false']",
    ],
    clientName: [
      "[data-test='client-name']",
      "[data-qa='client-name']",
      "[class*='client-name']",
      "[class*='clientName']",
    ],
    budget: [
      "[data-test='budget']",
      "[data-qa='budget']",
      "[class*='budget']",
      "[class*='hourly-range']",
    ],
    coverLetter: [
      "textarea[name='cover_letter']",
      "textarea[id*='cover']",
      "textarea[aria-label*='cover']",
      "textarea[aria-label*='Cover']",
      "textarea[placeholder*='cover']",
      "textarea[placeholder*='Cover']",
      "textarea[class*='cover']",
      // generic fallback: first visible textarea on the page
      "textarea",
    ],
    questions: [
      // Upwork wraps additional questions in various containers
      "[data-test='additional-question'] textarea",
      "[data-qa='additional-question'] textarea",
      "[class*='question'] textarea",
      "[class*='Question'] textarea",
      "fieldset textarea",
    ],
    questionLabels: [
      "[data-test='additional-question'] label",
      "[data-qa='additional-question'] label",
      "[class*='question'] label",
      "[class*='Question'] label",
      "fieldset label",
    ],
  };

  /* ------------------------------------------------------------------ */
  /*  Helper – first matching element                                     */
  /* ------------------------------------------------------------------ */
  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      try {
        const el = root.querySelector(selector);
        if (el) return el;
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Helper – all matching elements (de-duplicated)                      */
  /* ------------------------------------------------------------------ */
  function queryAll(selectors, root = document) {
    const seen = new Set();
    const results = [];
    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach((el) => {
          if (!seen.has(el)) {
            seen.add(el);
            results.push(el);
          }
        });
        if (results.length) break;
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return results;
  }

  /* ------------------------------------------------------------------ */
  /*  Helper – get trimmed text content                                   */
  /* ------------------------------------------------------------------ */
  function getText(el) {
    return el ? el.textContent.trim() : "";
  }

  /* ------------------------------------------------------------------ */
  /*  Helper – find the visible label for a question textarea             */
  /* ------------------------------------------------------------------ */
  const MAX_LABEL_SEARCH_DEPTH = 8;

  function findQuestionLabel(textarea) {
    // Walk up the DOM to find the closest label-like ancestor text.
    // The broad `p, span` fallback is intentional: Upwork's React UI uses
    // various element types for question labels, so we widen the net and
    // rely on the `!label.contains(textarea)` guard to skip the textarea's
    // own container text.
    let node = textarea.parentElement;
    for (let i = 0; i < MAX_LABEL_SEARCH_DEPTH && node; i++) {
      const label = node.querySelector("label, [class*='label'], [class*='Label'], p, span");
      if (label && label.textContent.trim() && !label.contains(textarea)) {
        return label.textContent.trim();
      }
      node = node.parentElement;
    }
    // fallback to aria-label on the textarea itself
    return textarea.getAttribute("aria-label") || textarea.getAttribute("placeholder") || "";
  }

  /* ------------------------------------------------------------------ */
  /*  expandDescription()                                                 */
  /*  Clicks the "more" truncation button (if present) and waits until    */
  /*  aria-expanded becomes "true" before resolving.                      */
  /* ------------------------------------------------------------------ */
  function expandDescription() {
    return new Promise((resolve) => {
      const btn = queryFirst(SELECTORS.descriptionMoreBtn);
      if (!btn) return resolve(); // already expanded or button not found

      // Listen for the attribute flip so we know the content is visible
      const observer = new MutationObserver(() => {
        if (btn.getAttribute("aria-expanded") === "true") {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(btn, { attributes: true, attributeFilter: ["aria-expanded"] });

      btn.click();

      // Safety timeout: resolve after 1 s even if the attribute never flips
      setTimeout(() => { observer.disconnect(); resolve(); }, 1000);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  extractProposal()                                                   */
  /*  Returns a structured object with all proposal-page data.            */
  /* ------------------------------------------------------------------ */
  async function extractProposal() {
    await expandDescription();

    const jobTitle = getText(queryFirst(SELECTORS.jobTitle));
    const jobDescription = getText(queryFirst(SELECTORS.jobDescription));
    const clientName = getText(queryFirst(SELECTORS.clientName));
    const budget = getText(queryFirst(SELECTORS.budget));

    const coverLetterEl = queryFirst(SELECTORS.coverLetter);
    const coverLetter = {
      currentValue: coverLetterEl ? coverLetterEl.value : "",
      placeholder: coverLetterEl ? (coverLetterEl.getAttribute("placeholder") || "") : "",
      found: !!coverLetterEl,
    };

    // Additional questions – exclude the cover letter textarea if matched
    const questionEls = queryAll(SELECTORS.questions).filter(
      (el) => el !== coverLetterEl
    );
    const questions = questionEls.map((el) => ({
      label: findQuestionLabel(el),
      currentValue: el.value,
      placeholder: el.getAttribute("placeholder") || "",
    }));

    const pageUrl = window.location.href;

    return {
      pageUrl,
      jobTitle,
      jobDescription,
      clientName,
      budget,
      coverLetter,
      questions,
      extractedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  simulateInput()                                                     */
  /*  Sets a textarea value in a way that React/Vue controlled inputs     */
  /*  recognise as a real user change.                                    */
  /* ------------------------------------------------------------------ */
  function simulateInput(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    );
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /* ------------------------------------------------------------------ */
  /*  autofill()                                                          */
  /*  Writes AI-generated text into the proposal form fields.             */
  /* ------------------------------------------------------------------ */
  function autofill(payload) {
    const coverLetterEl = queryFirst(SELECTORS.coverLetter);
    const questionEls = queryAll(SELECTORS.questions).filter(
      (el) => el !== coverLetterEl
    );

    const results = [];

    if (coverLetterEl && payload.coverLetter) {
      simulateInput(coverLetterEl, payload.coverLetter);
      results.push({ field: "coverLetter", status: "filled" });
    }

    if (Array.isArray(payload.questions)) {
      payload.questions.forEach((answer, index) => {
        const el = questionEls[index];
        if (el && answer) {
          simulateInput(el, answer);
          results.push({ field: `question_${index}`, status: "filled" });
        }
      });
    }

    return results;
  }

  /* ------------------------------------------------------------------ */
  /*  Message listener                                                     */
  /* ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isContextValid()) return false;

    if (message.type === "EXTRACT_PROPOSAL") {
      extractProposal()
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // keep message channel open for async response
    }

    if (message.type === "AUTOFILL_PROPOSAL") {
      try {
        const results = autofill(message.payload);
        sendResponse({ success: true, results });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Extension context guard                                             */
  /*  After a reload, the old content script stays on the page but its   */
  /*  Chrome API access is revoked. Any chrome.* call will throw          */
  /*  "Extension context invalidated". This helper lets callers detect   */
  /*  that state and bail out cleanly.                                    */
  /* ------------------------------------------------------------------ */
  function isContextValid() {
    try {
      // Accessing chrome.runtime.id throws when the context is dead
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Pending autofill check (storage fallback for discarded tabs)        */
  /* ------------------------------------------------------------------ */
  let myTabId = null;

  function checkPendingAutofill() {
    if (!myTabId || !isContextValid()) return;
    const key = `autofill_${myTabId}`;
    try {
      chrome.storage.local.get([key], (items) => {
        if (chrome.runtime.lastError) return;
        if (items[key]) {
          autofill(items[key]);
          try { chrome.storage.local.remove([key]); } catch (_) {}
        }
      });
    } catch (_) {
      // Context invalidated between the guard check and the API call — ignore
    }
  }

  // When the user switches back to this tab, pick up any pending autofill
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkPendingAutofill();
  });

  /* ------------------------------------------------------------------ */
  /*  Signal that the content script is ready                             */
  /* ------------------------------------------------------------------ */
  try {
    chrome.runtime.sendMessage(
      { type: "CONTENT_SCRIPT_READY", url: window.location.href },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.tabId) {
          myTabId = response.tabId;
          // Check immediately in case autofill data arrived before this script loaded
          checkPendingAutofill();
        }
      }
    );
  } catch (_) {
    // Context already invalid at startup — nothing to do
  }
})();
