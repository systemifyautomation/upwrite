"use strict";

/**
 * UpWrite – Offscreen audio document
 *
 * Created by the service worker via chrome.offscreen.createDocument() with
 * reason AUDIO_PLAYBACK. Plays a two-note ascending chime the moment it
 * loads, then signals the SW so it can close this document.
 */
(function () {
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
    tone(880,  t,        0.18, 0.40); // A5 – first note
    tone(1318, t + 0.18, 0.40, 0.35); // E6 – second note (ascending chime)

    // Notify the SW once the chime is done so it can close this document
    const totalDuration = (0.18 + 0.40) * 1000 + 100; // ms
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "CHIME_DONE" }).catch(() => {});
    }, totalDuration);

  } catch (_) {
    // AudioContext unavailable — signal done immediately so document is closed
    chrome.runtime.sendMessage({ type: "CHIME_DONE" }).catch(() => {});
  }
})();
