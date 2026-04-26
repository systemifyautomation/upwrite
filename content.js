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
      "h1.job-title",
      "[data-test='job-title']",
      "[data-qa='job-title']",
      "h1[class*='title']",
      "h1",
    ],
    jobDescription: [
      "[data-test='description']",
      "[data-qa='description']",
      ".job-description",
      "[class*='description']",
      "[class*='job-details']",
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
  /*  extractProposal()                                                   */
  /*  Returns a structured object with all proposal-page data.            */
  /* ------------------------------------------------------------------ */
  function extractProposal() {
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
    if (message.type === "EXTRACT_PROPOSAL") {
      try {
        sendResponse({ success: true, data: extractProposal() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
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
  /*  Signal that the content script is ready                             */
  /* ------------------------------------------------------------------ */
  chrome.runtime.sendMessage(
    { type: "CONTENT_SCRIPT_READY", url: window.location.href },
    () => {
      if (chrome.runtime.lastError) { /* intentionally ignored during startup */ }
    }
  );
})();
