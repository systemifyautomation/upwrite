"use strict";

/**
 * UpWrite – Screen Recorder engine
 *
 * This page (recorder.html) is opened automatically by background.js when the
 * user clicks "Share Screen" in the on-page overlay. It has no user-facing UI
 * — all visual feedback lives in the overlay. This page exists only because
 * chrome.desktopCapture.chooseDesktopMedia + getUserMedia(chromeMediaSource)
 * MUST run from an extension page context.
 */

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;  // 100 MB safety cap
const CANVAS_FPS    = 30;
const CAM_PIP_RATIO = 0.22;   // camera bubble = 22% of the shorter screen edge
const CAM_PIP_PAD   = 28;     // px from canvas bottom-right corner

let screenStream  = null;
let cameraStream  = null;
let micStream     = null;
let audioCtx      = null;
let mediaRecorder = null;
let chunks        = [];
let timerSeconds  = 0;
let timerInterval = null;
let drawInterval  = null;
let isRecording   = false;

const vidScreen = (() => {
  const el = document.getElementById("vid-screen") || document.createElement("video");
  el.id = "vid-screen"; el.autoplay = true; el.muted = true;
  el.setAttribute("playsinline", ""); el.style.display = "none";
  if (!el.parentNode) document.body.appendChild(el);
  return el;
})();
const vidCam    = document.getElementById("vid-cam");
const mixCanvas = (() => {
  const el = document.getElementById("mix-canvas") || document.createElement("canvas");
  el.id = "mix-canvas"; el.style.display = "none";
  if (!el.parentNode) document.body.appendChild(el);
  return el;
})();
const ctx2d     = mixCanvas.getContext("2d");
const statusEl  = document.getElementById("status");

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

/* ── UI state machine ────────────────────────────────────────────────── */
const STATES = ["idle", "requesting", "recording", "stopped"];
function showState(name) {
  STATES.forEach((s) => {
    const el = document.getElementById("state-" + s);
    if (el) el.classList.toggle("r-state--hidden", s !== name);
  });
}

function showError(msg) {
  const el = document.getElementById("r-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("r-state--hidden");
  setTimeout(() => el.classList.add("r-state--hidden"), 6000);
}

/* ── Bootstrap — wire buttons; getDisplayMedia fires only on btn-start click ── */
(function () {
  const btnStart    = document.getElementById("btn-start");
  const btnStop     = document.getElementById("btn-stop");
  const btnDone     = document.getElementById("btn-done");
  const btnRerecord = document.getElementById("btn-rerecord");
  const btnClose    = document.getElementById("btn-close");

  if (btnStart) {
    btnStart.addEventListener("click", () => {
      showState("requesting");
      startRecording().catch((err) => {
        showState("idle");
        showError(String(err));
        chrome.runtime.sendMessage({
          type: "RECORDING_COMPLETE", ok: false, error: String(err),
        }).catch(() => {});
      });
    });
  }

  if (btnStop) btnStop.addEventListener("click", () => stopRecording());
  if (btnDone) btnDone.addEventListener("click", () => window.close());
  if (btnRerecord) btnRerecord.addEventListener("click", () => showState("idle"));
  if (btnClose) {
    btnClose.addEventListener("click", () => {
      if (isRecording) stopRecording();
      else {
        chrome.runtime.sendMessage({
          type: "RECORDING_COMPLETE", ok: false, error: "Recording cancelled.",
        }).catch(() => {});
        window.close();
      }
    });
  }
})();

/* ── IDB helpers ────────────────────────────────────────────────────────
   recorder.html shares the extension origin so it can write directly to
   the same IDB that the SW and popup read from.
   ─────────────────────────────────────────────────────────────────────── */
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("upwrite-db", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("recordings");
    req.onsuccess       = (e) => resolve(e.target.result);
    req.onerror         = (e) => reject(e.target.error);
  });
}

async function saveToIDB(buffer, duration, mimeType) {
  const db = await openIDB();
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

/* ── Codec selection ──────────────────────────────────────────────────── */
function getSupportedMimeType() {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/* ── Audio mixing ────────────────────────────────────────────────────── */
function buildAudioTracks() {
  const screenAudio = screenStream.getAudioTracks();
  const micAudio    = micStream ? micStream.getAudioTracks() : [];
  if (!screenAudio.length && !micAudio.length) return [];
  if (screenAudio.length && micAudio.length) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(screenAudio)).connect(dest);
    audioCtx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
    return dest.stream.getAudioTracks();
  }
  return screenAudio.length ? screenAudio : micAudio;
}

/* ── Canvas draw loop ────────────────────────────────────────────────── */
function startCanvasDraw() {
  // Use setInterval instead of requestAnimationFrame — rAF throttles to ~1 fps
  // when recorder.html is an unfocused background popup, producing a blank video.
  drawInterval = setInterval(() => {
    if (!isRecording) { clearInterval(drawInterval); drawInterval = null; return; }
    if (vidScreen.readyState >= 2) {
      ctx2d.drawImage(vidScreen, 0, 0, mixCanvas.width, mixCanvas.height);
    }
    if (cameraStream && vidCam.readyState >= 2) drawCameraBubble();
  }, 1000 / CANVAS_FPS);
}

function drawCameraBubble() {
  const short = Math.min(mixCanvas.width, mixCanvas.height);
  const size  = Math.round(short * CAM_PIP_RATIO);
  const pad   = CAM_PIP_PAD;
  const x  = mixCanvas.width  - size - pad;
  const y  = mixCanvas.height - size - pad;
  const cx = x + size / 2, cy = y + size / 2, r = size / 2;

  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
  ctx2d.clip();
  ctx2d.translate(x + size, y);
  ctx2d.scale(-1, 1);
  ctx2d.drawImage(vidCam, 0, 0, size, size);
  ctx2d.restore();

  // White border ring
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx2d.strokeStyle = "rgba(255,255,255,0.88)";
  ctx2d.lineWidth   = 5;
  ctx2d.stroke();
}

/* ── Main recording ──────────────────────────────────────────────────── */
async function startRecording() {
  if (isRecording) return;

  setStatus("Capturing screen\u2026");

  // Extension pages can call getDisplayMedia directly — no streamId needed.
  // IMPORTANT: this must be called from a user gesture (btn-start click).
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: true,
    });
  } catch (err) {
    // User cancelled the picker or permission denied
    throw err; // caller (btn-start handler) shows error + resets state
  }

  // Camera PiP (optional)
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 360 }, height: { ideal: 360 }, facingMode: "user" },
      audio: false,
    });
    vidCam.srcObject = cameraStream;
  } catch (_) {
    cameraStream = null;
  }

  // Microphone (optional)
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (_) {
    micStream = null;
  }

  // Size the canvas to match the captured screen resolution
  const videoTrack = screenStream.getVideoTracks()[0];
  const { width = 1280, height = 720 } = videoTrack.getSettings();
  mixCanvas.width  = width;
  mixCanvas.height = height;

  // Feed screen into hidden <video> for canvas compositing
  vidScreen.srcObject = screenStream;
  await new Promise((res) => {
    if (vidScreen.readyState >= 1) { res(); return; }
    vidScreen.onloadedmetadata = res;
  });
  vidScreen.play().catch(() => {});

  if (cameraStream) {
    await new Promise((res) => {
      if (vidCam.readyState >= 1) { res(); return; }
      vidCam.onloadedmetadata = res;
    });
    vidCam.play().catch(() => {});
  }

  const audioTracks = buildAudioTracks();

  isRecording = true;

  let recordStream;
  if (cameraStream) {
    const canvasStream = mixCanvas.captureStream(30); // 30fps — captureStream(0) requires manual requestFrame() calls and produces no data
    recordStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    startCanvasDraw();
  } else {
    recordStream = new MediaStream([...screenStream.getVideoTracks(), ...audioTracks]);
  }

  // Handle the native "Stop sharing" button in Chrome's toolbar
  videoTrack.addEventListener("ended", () => { if (isRecording) stopRecording(); });

  // Wait for the first real video frame before starting MediaRecorder so
  // early chunks are not blank.
  await new Promise((res) => {
    if (vidScreen.readyState >= 3) { res(); return; }
    vidScreen.addEventListener("canplay", res, { once: true });
  });

  // MediaRecorder
  chunks = [];
  timerSeconds = 0;
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(
    recordStream,
    { mimeType, videoBitsPerSecond: 3_000_000 }
  );
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(250);

  setStatus("Recording\u2026");

  // Show recorder.html recording state
  showState("recording");
  const pipEl = document.getElementById("r-pip");
  if (pipEl) pipEl.classList.toggle("r-pip--hidden", !cameraStream);

  // Timer — drives recorder.html display and relays ticks to overlay via background
  const rTimer = document.getElementById("r-timer");
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    if (rTimer) {
      const m = String(Math.floor(timerSeconds / 60)).padStart(2, "0");
      const s = String(timerSeconds % 60).padStart(2, "0");
      rTimer.textContent = m + ":" + s;
    }
    chrome.runtime.sendMessage({ type: "RECORDING_TICK", seconds: timerSeconds }).catch(() => {});
  }, 1000);

  chrome.runtime.sendMessage({ type: "RECORDING_STARTED" }).catch(() => {});
}

/* ── Stop ────────────────────────────────────────────────────────────── */
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(timerInterval); timerInterval = null;
  if (drawInterval !== null) { clearInterval(drawInterval); drawInterval = null; }
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

/* ── After stop ──────────────────────────────────────────────────────── */
async function onRecordingStop() {
  setStatus("Saving\u2026");
  const mime     = mediaRecorder?.mimeType || "video/webm";
  const blob     = new Blob(chunks, { type: mime });
  const duration = timerSeconds;
  chunks = [];

  // Tear down all streams
  screenStream?.getTracks().forEach((t) => t.stop()); screenStream = null;
  cameraStream?.getTracks().forEach((t) => t.stop()); cameraStream = null;
  micStream?.getTracks().forEach((t) => t.stop());    micStream    = null;
  audioCtx?.close().catch(() => {});                  audioCtx     = null;
  vidScreen.srcObject = null;
  vidCam.srcObject    = null;

  if (blob.size === 0) {
    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE", ok: false,
      error: "Recording produced no data. Please try again.",
    }).catch(() => {});
    window.close();
    return;
  }

  if (blob.size > MAX_RECORDING_BYTES) {
    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE", ok: false,
      error: `Recording is ${(blob.size / 1024 / 1024).toFixed(1)} MB — exceeds the 100 MB limit.`,
    }).catch(() => {});
    window.close();
    return;
  }

  try {
    const buffer = await blob.arrayBuffer();
    await saveToIDB(buffer, duration, mime);
    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE", ok: true,
      size: buffer.byteLength, duration, mimeType: mime,
    }).catch(() => {});
    // Show stopped state with duration
    const durEl = document.getElementById("r-duration");
    if (durEl) {
      const m = String(Math.floor(duration / 60)).padStart(2, "0");
      const s = String(duration % 60).padStart(2, "0");
      durEl.textContent = "Recorded " + m + ":" + s;
    }
    showState("stopped");
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE", ok: false, error: String(err),
    }).catch(() => {});
    window.close();
  }
}

/* ── Message handler ─────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STOP_RECORDING" && isRecording) stopRecording();
  // START_WITH_STREAM_ID is handled via the sendMessage response callback above
});

/* ── Handle window closed externally ────────────────────────────────── */
window.addEventListener("beforeunload", () => {
  if (isRecording) {
    isRecording = false;
    try {
      chrome.runtime.sendMessage({
        type: "RECORDING_COMPLETE", ok: false,
        error: "Recording window was closed.",
      });
    } catch (_) {}
  }
});
