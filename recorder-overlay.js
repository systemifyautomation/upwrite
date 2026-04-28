"use strict";

(function () {
  if (document.getElementById("uw-overlay-root")) return;

  /* ── State ─────────────────────────────────────────────────────────── */
  let recordingMode    = null;   // "screen" | "camera"
  let cameraStream     = null;   // live camera preview (video only)
  let recStream        = null;   // stream fed to MediaRecorder (camera-only)
  let screenDispStream = null;   // unused in screen mode (kept for cleanup safety)
  let camRecStream     = null;   // unused in screen mode (kept for cleanup safety)
  let micStream        = null;   // unused in screen mode (kept for cleanup safety)
  let audioCtxRef      = null;   // unused in screen mode (kept for cleanup safety)
  let mediaRecorder    = null;
  let port             = null;   // background port for chunk streaming (camera-only)
  let overlayTimer     = null;
  let overlaySeconds   = 0;

  /* ── Helpers ────────────────────────────────────────────────────────── */
  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* ── Styles ─────────────────────────────────────────────────────────── */
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    #uw-wrap {
      all: initial;
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #uw-cam-bubble {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      overflow: hidden;
      border: 3px solid rgba(255,255,255,0.9);
      box-shadow: 0 4px 24px rgba(0,0,0,0.45);
      background: #1a1a2e;
      flex-shrink: 0;
    }
    #uw-cam-video {
      all: initial;
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
    #uw-panel {
      background: rgba(15,15,25,0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 14px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 0;
      box-shadow: 0 4px 24px rgba(0,0,0,0.55);
      min-width: 158px;
    }
    .uw-btn {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      width: 100%;
      padding: 9px 12px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: filter 0.15s, opacity 0.15s;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .uw-btn:hover:not(:disabled) { filter: brightness(1.12); }
    .uw-btn:disabled { opacity: 0.55; cursor: default; }
    #uw-btn-screen { background: #14a800; color: #fff; }
    #uw-btn-cam    { background: rgba(255,255,255,0.1); color: #fff; margin-top: 7px; }
    #uw-btn-cancel { background: transparent; color: #777; font-size: 12px; padding: 5px 12px; margin-top: 5px; }
    #uw-btn-cancel:hover:not(:disabled) { filter: none; color: #bbb; }
    #uw-btn-stop   { background: #e94560; color: #fff; margin-top: 9px; }
    #uw-rec-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    #uw-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #e94560;
      flex-shrink: 0;
      animation: uw-blink 1.1s step-start infinite;
    }
    @keyframes uw-blink { 0%,100%{opacity:1} 50%{opacity:0.1} }
    #uw-timer {
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.5px;
      font-family: system-ui, monospace, sans-serif;
    }
  `;
  document.head.appendChild(styleEl);

  /* ── DOM ────────────────────────────────────────────────────────────── */
  const wrapEl = document.createElement("div");
  wrapEl.id = "uw-overlay-root";
  wrapEl.innerHTML = `
    <div id="uw-wrap">
      <div id="uw-cam-bubble">
        <video id="uw-cam-video" autoplay muted playsinline></video>
      </div>
      <div id="uw-panel">
        <!-- Phase 1: pre-recording -->
        <div id="uw-phase-idle">
          <button class="uw-btn" id="uw-btn-screen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            Share Screen
          </button>
          <button class="uw-btn" id="uw-btn-cam">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            Camera Only
          </button>
          <button class="uw-btn" id="uw-btn-cancel">&#x2715; Cancel</button>
        </div>
        <!-- Phase 2: recording -->
        <div id="uw-phase-rec" style="display:none">
          <div id="uw-rec-row">
            <div id="uw-dot"></div>
            <span id="uw-timer">00:00</span>
          </div>
          <button class="uw-btn" id="uw-btn-stop">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="2"/></svg>
            Stop Recording
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapEl);

  /* ── Camera preview ─────────────────────────────────────────────────── */
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "user", width: { ideal: 360 }, height: { ideal: 360 } }, audio: false })
    .then((stream) => {
      cameraStream = stream;
      const vid = document.getElementById("uw-cam-video");
      vid.srcObject = stream;
      vid.play().catch(() => {});
    })
    .catch(() => { /* camera unavailable – bubble stays dark */ });

  /* ── Phase switch ───────────────────────────────────────────────────── */
  function enterRecordingPhase() {
    document.getElementById("uw-phase-idle").style.display = "none";
    document.getElementById("uw-phase-rec").style.display  = "block";
  }

  // Only used by camera-only mode (screen mode timer driven by RECORDING_TICK from recorder.js)
  function startLocalTimer() {
    overlaySeconds = 0;
    overlayTimer = setInterval(() => {
      overlaySeconds++;
      const el = document.getElementById("uw-timer");
      if (el) el.textContent = fmt(overlaySeconds);
    }, 1000);
  }

  /* ── Button handlers ────────────────────────────────────────────────── */
  document.getElementById("uw-btn-screen").addEventListener("click", () => {
    recordingMode = "screen";
    document.getElementById("uw-btn-screen").disabled = true;
    document.getElementById("uw-btn-screen").textContent = "Choose screen…";
    document.getElementById("uw-btn-cam").disabled = true;
    startScreenRecording();
  });

  document.getElementById("uw-btn-cam").addEventListener("click", () => {
    recordingMode = "camera";
    startCameraOnlyRecording();
  });

  document.getElementById("uw-btn-cancel").addEventListener("click", cleanup);

  document.getElementById("uw-btn-stop").addEventListener("click", () => {
    if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
    const btn = document.getElementById("uw-btn-stop");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    if (recordingMode === "screen") {
      // Tell background to stop the recorder.html recording
      chrome.runtime.sendMessage({ type: "STOP_RECORDING" }).catch(() => {});
    } else if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  });

  /* ── Camera-only recording ──────────────────────────────────────────── */
  async function startCameraOnlyRecording() {
    try {
      // Stop the preview-only stream; request a new one with audio
      if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }

      recStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 360 }, height: { ideal: 360 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      document.getElementById("uw-cam-video").srcObject = recStream;

      port = chrome.runtime.connect({ name: "recording-stream" });
      port.onDisconnect.addListener(() => { port = null; });

      const mimeType =
        ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
          .find((t) => MediaRecorder.isTypeSupported(t)) || "";

      const pending = [];
      mediaRecorder = new MediaRecorder(recStream, mimeType ? { mimeType } : {});

      mediaRecorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const p = e.data.arrayBuffer().then((buf) => {
          if (port) port.postMessage({ type: "CHUNK", chunk: buf });
        });
        pending.push(p);
      };

      mediaRecorder.onstop = async () => {
        await Promise.allSettled(pending);
        pending.length = 0;
        recStream?.getTracks().forEach((t) => t.stop());
        recStream = null;
        const actualMime = mediaRecorder.mimeType || mimeType || "video/webm";
        if (port) {
          port.postMessage({ type: "RECORDING_DONE", duration: overlaySeconds, mimeType: actualMime });
          port.disconnect();
        }
        port = null;
      };

      mediaRecorder.start(1000);
      enterRecordingPhase();
      startLocalTimer();
    } catch (err) {
      try { chrome.runtime.sendMessage({ type: "RECORDING_ERROR", error: String(err) }); } catch (_) {}
      cleanup();
    }
  }

  /* ── Screen recording ───────────────────────────────────────────────── */
  async function startScreenRecording() {
    if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }

    try {
      // Delegate to the background SW which calls chrome.desktopCapture.chooseDesktopMedia()
      // and opens recorder.html (an extension page). This avoids calling getDisplayMedia()
      // from a content script, which is blocked by Upwork's Permissions-Policy header.
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "REQUEST_SCREEN_CAPTURE" }, (res) => {
          resolve(chrome.runtime.lastError ? null : res);
        });
      });

      if (!response?.ok) {
        // User cancelled the picker or an error occurred — reset buttons
        const s = document.getElementById("uw-btn-screen");
        const c = document.getElementById("uw-btn-cam");
        if (s) {
          s.disabled = false;
          s.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Share Screen';
        }
        if (c) c.disabled = false;
      }
      // ok: true → recorder.html is loading; overlay waits for RECORDING_STARTED
      // then RECORDING_TICK messages from recorder.js to drive the timer.
    } catch (_err) {
      const s = document.getElementById("uw-btn-screen");
      const c = document.getElementById("uw-btn-cam");
      if (s) {
        s.disabled = false;
        s.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Share Screen';
      }
      if (c) c.disabled = false;
    }
  }

  /* ── Messages from background ───────────────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg) => {
    // screen mode: recorder.js started — show the recording UI
    if (msg.type === "RECORDING_STARTED") {
      enterRecordingPhase();
      overlaySeconds = 0;
    }
    // screen mode: timer tick relayed from recorder.js
    if (msg.type === "RECORDING_TICK") {
      overlaySeconds = msg.seconds;
      const el = document.getElementById("uw-timer");
      if (el) el.textContent = fmt(msg.seconds);
    }
    // screen mode: user cancelled the picker before confirming
    if (msg.type === "SCREEN_CAPTURE_CANCELLED") {
      const s = document.getElementById("uw-btn-screen");
      const c = document.getElementById("uw-btn-cam");
      if (s) {
        s.disabled = false;
        s.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Share Screen';
      }
      if (c) c.disabled = false;
    }
    if (msg.type === "RECORDING_COMPLETE" || msg.type === "REMOVE_OVERLAY" || msg.type === "RECORDING_ERROR") {
      cleanup();
    }
  });

  /* ── Cleanup ────────────────────────────────────────────────────────── */
  function cleanup() {
    if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
    cameraStream?.getTracks().forEach((t) => t.stop());
    recStream?.getTracks().forEach((t) => t.stop());
    screenDispStream?.getTracks().forEach((t) => t.stop());
    camRecStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    audioCtxRef?.close().catch(() => {});
    cameraStream = null; recStream = null; screenDispStream = null;
    camRecStream = null; micStream = null; audioCtxRef = null;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    styleEl.remove();
    wrapEl.remove();
  }
})();
