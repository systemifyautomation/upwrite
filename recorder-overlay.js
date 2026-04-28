"use strict";

(function () {
  if (document.getElementById("uw-overlay-root")) return;

  /* ── State ─────────────────────────────────────────────────────────── */
  let recordingMode    = null;   // "screen" | "camera"
  let cameraStream     = null;   // live camera preview (video only)
  let recStream        = null;   // stream fed to MediaRecorder
  let screenDispStream = null;   // getDisplayMedia stream (screen mode)
  let camRecStream     = null;   // camera video for bubble preview (screen mode)
  let micStream        = null;   // mic audio (screen mode)
  let audioCtxRef      = null;   // AudioContext for mixing (screen mode)
  let mediaRecorder    = null;
  let port             = null;   // background port for chunk streaming
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

  // Only used by camera-only mode (screen mode timer driven by RECORDING_TICK)
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
    document.getElementById("uw-btn-screen").textContent = "Choose screen\u2026";
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
    if (btn) { btn.disabled = true; btn.textContent = "Saving\u2026"; }
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
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

  /* ── Messages from background (camera-only RECORDING_COMPLETE from port handler) ── */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RECORDING_COMPLETE" || msg.type === "REMOVE_OVERLAY" || msg.type === "RECORDING_ERROR") {
      cleanup();
    }
  });

  /* ── Screen recording ───────────────────────────────────────────────── */
  async function startScreenRecording() {
    try {
      if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }

      // getDisplayMedia shows Chrome's native screen picker in the current tab.
      screenDispStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });

      // Camera — composited as a PiP bubble and also shown in the overlay preview
      try {
        camRecStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 360 }, height: { ideal: 360 }, facingMode: "user" },
          audio: false,
        });
        const previewEl = document.getElementById("uw-cam-video");
        if (previewEl) {
          previewEl.srcObject = camRecStream;
          previewEl.play().catch(() => {});
        }
      } catch (_) { camRecStream = null; }

      // Mic (optional — mixed with screen audio)
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }, video: false,
        });
      } catch (_) { micStream = null; }

      // ── Canvas compositing: screen + camera PiP ──────────────────────
      const vt = screenDispStream.getVideoTracks()[0];
      const { width = 1280, height = 720 } = vt.getSettings();

      const compCanvas = document.createElement("canvas");
      compCanvas.width  = width;
      compCanvas.height = height;
      compCanvas.style.cssText = "all:initial;position:fixed;top:-9999px;left:-9999px;pointer-events:none;";
      document.body.appendChild(compCanvas);
      const compCtx = compCanvas.getContext("2d");

      const vidScreenComp = document.createElement("video");
      vidScreenComp.autoplay = true; vidScreenComp.muted = true; vidScreenComp.playsInline = true;
      vidScreenComp.style.cssText = "all:initial;position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;";
      document.body.appendChild(vidScreenComp);
      vidScreenComp.srcObject = screenDispStream;
      await new Promise((res) => {
        if (vidScreenComp.readyState >= 1) { res(); return; }
        vidScreenComp.onloadedmetadata = res;
      });
      vidScreenComp.play().catch(() => {});

      let vidCamComp = null;
      if (camRecStream) {
        vidCamComp = document.createElement("video");
        vidCamComp.autoplay = true; vidCamComp.muted = true; vidCamComp.playsInline = true;
        vidCamComp.style.cssText = "all:initial;position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;";
        document.body.appendChild(vidCamComp);
        vidCamComp.srcObject = camRecStream;
        await new Promise((res) => {
          if (vidCamComp.readyState >= 1) { res(); return; }
          vidCamComp.onloadedmetadata = res;
        });
        vidCamComp.play().catch(() => {});
      }

      const CAM_RATIO = 0.22, CAM_PAD = 28;
      let compDrawRaf = null;
      let compDrawActive = true;
      function drawCompFrame() {
        if (!compDrawActive) return;
        if (vidScreenComp.readyState >= 2) {
          compCtx.drawImage(vidScreenComp, 0, 0, width, height);
        }
        if (vidCamComp && vidCamComp.readyState >= 2) {
          const short = Math.min(width, height);
          const size  = Math.round(short * CAM_RATIO);
          const x = width - size - CAM_PAD, y = height - size - CAM_PAD;
          const cx = x + size / 2, cy = y + size / 2, r = size / 2;
          compCtx.save();
          compCtx.beginPath();
          compCtx.arc(cx, cy, r, 0, Math.PI * 2);
          compCtx.clip();
          compCtx.translate(x + size, y);
          compCtx.scale(-1, 1);
          compCtx.drawImage(vidCamComp, 0, 0, size, size);
          compCtx.restore();
          compCtx.beginPath();
          compCtx.arc(cx, cy, r + 3, 0, Math.PI * 2);
          compCtx.strokeStyle = "rgba(255,255,255,0.88)";
          compCtx.lineWidth   = 5;
          compCtx.stroke();
        }
        compDrawRaf = requestAnimationFrame(drawCompFrame);
      }
      compDrawRaf = requestAnimationFrame(drawCompFrame);

      // Handle user clicking "Stop sharing" in Chrome's toolbar
      vt.addEventListener("ended", () => {
        if (overlayTimer) { clearInterval(overlayTimer); overlayTimer = null; }
        const btn = document.getElementById("uw-btn-stop");
        if (btn) { btn.disabled = true; btn.textContent = "Saving\u2026"; }
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      });

      // Build the record stream: composited canvas video + combined audio
      const audioTracks = buildAudioMix(screenDispStream, micStream);
      const canvasStream = compCanvas.captureStream(0); // 0 = manual frame timing via rAF

      // Wait for the first real frame to be drawn so the recording is not blank
      await new Promise((res) => {
        if (vidScreenComp.readyState >= 3) { res(); return; }
        vidScreenComp.addEventListener("canplay", res, { once: true });
      });

      recStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

      port = chrome.runtime.connect({ name: "recording-stream" });
      port.onDisconnect.addListener(() => { port = null; });

      const mimeType =
        ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
          .find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const pending = [];
      mediaRecorder = new MediaRecorder(recStream, mimeType ? { mimeType } : {});

      mediaRecorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const p = e.data.arrayBuffer().then((buf) => { if (port) port.postMessage({ type: "CHUNK", chunk: buf }); });
        pending.push(p);
      };

      mediaRecorder.onstop = async () => {
        compDrawActive = false;
        if (compDrawRaf !== null) { cancelAnimationFrame(compDrawRaf); compDrawRaf = null; }
        vidScreenComp.srcObject = null; vidScreenComp.remove();
        if (vidCamComp) { vidCamComp.srcObject = null; vidCamComp.remove(); }
        compCanvas.remove();
        screenDispStream?.getTracks().forEach((t) => t.stop()); screenDispStream = null;
        camRecStream?.getTracks().forEach((t) => t.stop()); camRecStream = null;
        micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
        audioCtxRef?.close().catch(() => {}); audioCtxRef = null;
        await Promise.allSettled(pending); pending.length = 0;
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
    } catch (_err) {
      // User cancelled the picker or permission denied — reset buttons
      const s = document.getElementById("uw-btn-screen");
      const c = document.getElementById("uw-btn-cam");
      if (s) {
        s.disabled = false;
        s.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Share Screen';
      }
      if (c) c.disabled = false;
      screenDispStream?.getTracks().forEach((t) => t.stop()); screenDispStream = null;
      camRecStream?.getTracks().forEach((t) => t.stop()); camRecStream = null;
      micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
    }
  }

  function buildAudioMix(dispStream, mic) {
    const screenAudio = dispStream.getAudioTracks();
    const micAudio    = mic ? mic.getAudioTracks() : [];
    if (!screenAudio.length && !micAudio.length) return [];
    if (screenAudio.length && micAudio.length) {
      audioCtxRef = new AudioContext();
      const dest = audioCtxRef.createMediaStreamDestination();
      audioCtxRef.createMediaStreamSource(new MediaStream(screenAudio)).connect(dest);
      audioCtxRef.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
      return dest.stream.getAudioTracks();
    }
    return screenAudio.length ? screenAudio : micAudio;
  }

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
