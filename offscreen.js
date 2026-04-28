"use strict";

/**
 * UpWrite – Offscreen Document
 *
 * Sole responsibility: play the two-note notification chime and signal
 * CHIME_DONE so the background SW can close this document.
 *
 * Screen recording now runs entirely in recorder.js (the recorder popup
 * window) where the desktopCapture streamId is valid. This document no
 * longer handles any media capture.
 */

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "PLAY_CHIME") {
    playChime();
  }

  return false;
});

function playChime() {
  try {
    const ctx = new AudioContext();

    function tone(freq, startTime, duration, volume) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    }

    const t = ctx.currentTime;
    tone(880,  t,        0.18, 0.40);
    tone(1318, t + 0.18, 0.40, 0.35);

    const totalDuration = (0.18 + 0.40) * 1000 + 100;
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "CHIME_DONE" }).catch(() => {});
    }, totalDuration);
  } catch (_) {
    chrome.runtime.sendMessage({ type: "CHIME_DONE" }).catch(() => {});
  }
}
