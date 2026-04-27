/**
 * UpWrite – Recorder Script
 *
 * Handles screen + camera recording without any third-party service.
 * Features:
 *  - Screen capture via getDisplayMedia()
 *  - Optional camera overlay (PiP bubble) via getUserMedia()
 *  - Optional microphone via getUserMedia()
 *  - Canvas-based mixing when camera is enabled (screen + circular PiP)
 *  - MediaRecorder → WebM output
 *  - Download on completion
 *  - Notifies background service worker when done
 */

"use strict";

/* ================================================================== */
/*  Constants                                                           */
/* ================================================================== */
const STATES = { IDLE: "idle", REQUESTING: "requesting", RECORDING: "recording", STOPPED: "stopped" };
const CANVAS_FPS = 30;
const CAM_PIP_RATIO = 0.22;  // camera bubble = 22% of the shorter canvas dimension
const CAM_PIP_PAD   = 28;    // px from bottom-right edge

/* ================================================================== */
/*  State                                                               */
/* ================================================================== */
let recState     = STATES.IDLE;
let screenStream = null;
let cameraStream = null;
let micStream    = null;
let audioCtx     = null;
let mediaRecorder = null;
let chunks       = [];
let recordedBlob = null;
let rafId        = null;
let timerInterval = null;
let timerSeconds = 0;

/* ================================================================== */
/*  DOM refs                                                            */
/* ================================================================== */
const $ = (id) => document.getElementById(id);

const stateEls = Object.fromEntries(
  Object.values(STATES).map((s) => [s, $(`state-${s}`)])
);

const vidScreen  = $("vid-screen");
const vidCam     = $("vid-cam");
const vidPreview = $("vid-preview");
const mixCanvas  = $("mix-canvas");
const ctx2d      = mixCanvas.getContext("2d");

/* ================================================================== */
/*  State machine                                                       */
/* ================================================================== */
function setState(s) {
  recState = s;
  Object.entries(stateEls).forEach(([key, el]) => {
    el.classList.toggle("r-state--hidden", key !== s);
  });
}

/* ================================================================== */
/*  Helpers                                                             */
/* ================================================================== */
function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function getSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/* ================================================================== */
/*  Button wiring                                                       */
/* ================================================================== */
$("btn-close").addEventListener("click", () => {
  cleanup();
  window.close();
});

$("btn-start").addEventListener("click", startRecording);
$("btn-stop").addEventListener("click", stopRecording);
$("btn-download").addEventListener("click", downloadRecording);

$("btn-done").addEventListener("click", () => {
  notifyBackground();
  window.close();
});

$("btn-rerecord").addEventListener("click", () => {
  cleanup();
  if (vidPreview.src) {
    URL.revokeObjectURL(vidPreview.src);
    vidPreview.src = "";
  }
  recordedBlob = null;
  setState(STATES.IDLE);
});

/* ================================================================== */
/*  Start recording                                                     */
/* ================================================================== */
async function startRecording() {
  setState(STATES.REQUESTING);

  const wantCamera = $("opt-camera").checked;
  const wantMic    = $("opt-mic").checked;

  /* ── 1. Screen capture (required) ── */
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: CANVAS_FPS }, cursor: "always" },
      audio: true, // system audio when available
    });
  } catch (_) {
    // User cancelled the picker or permission denied
    cleanup();
    setState(STATES.IDLE);
    return;
  }

  /* ── 2. Camera (optional) ── */
  if (wantCamera) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 360 }, height: { ideal: 360 }, facingMode: "user" },
        audio: false,
      });
      vidCam.srcObject = cameraStream;
    } catch (_) {
      cameraStream = null; // camera unavailable — continue without
    }
  }

  /* ── 3. Microphone (optional) ── */
  if (wantMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch (_) {
      micStream = null;
    }
  }

  /* ── 4. Size canvas to match screen capture ── */
  const videoTrack = screenStream.getVideoTracks()[0];
  const { width = 1280, height = 720 } = videoTrack.getSettings();
  mixCanvas.width  = width;
  mixCanvas.height = height;

  /* ── 5. Feed screen stream into the hidden video element ── */
  vidScreen.srcObject = screenStream;
  await new Promise((resolve) => { vidScreen.onloadedmetadata = resolve; });

  /* ── 6. Build audio output (mix screen audio + mic) ── */
  const audioTracks = buildAudioTracks();

  /* ── 7. Compose the stream that MediaRecorder will capture ── */
  let recordStream;
  if (cameraStream) {
    // Canvas mixing: screen drawn + camera bubble overlaid
    const canvasStream = mixCanvas.captureStream(CANVAS_FPS);
    recordStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks,
    ]);
    startCanvasDraw();
  } else {
    // Screen only — skip canvas, use stream directly (lower CPU)
    recordStream = new MediaStream([
      ...screenStream.getVideoTracks(),
      ...audioTracks,
    ]);
  }

  /* ── 8. Handle user hitting browser's "Stop sharing" button ── */
  videoTrack.addEventListener("ended", () => {
    if (recState === STATES.RECORDING) stopRecording();
  });

  /* ── 9. Start MediaRecorder ── */
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(recordStream, {
    mimeType,
    videoBitsPerSecond: 3_000_000,
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(250); // collect data every 250 ms

  /* ── 10. PiP visibility ── */
  $("r-pip").classList.toggle("r-pip--hidden", !cameraStream);

  /* ── 11. Timer ── */
  timerSeconds = 0;
  $("r-timer").textContent = "00:00";
  timerInterval = setInterval(() => {
    timerSeconds++;
    $("r-timer").textContent = formatTime(timerSeconds);
  }, 1000);

  setState(STATES.RECORDING);
}

/* ================================================================== */
/*  Audio mixing                                                        */
/* ================================================================== */
function buildAudioTracks() {
  const screenAudio = screenStream.getAudioTracks();
  const micAudio    = micStream ? micStream.getAudioTracks() : [];

  if (!screenAudio.length && !micAudio.length) return [];

  // If both sources exist, mix them via AudioContext
  if (screenAudio.length && micAudio.length) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(screenAudio)).connect(dest);
    audioCtx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
    return dest.stream.getAudioTracks();
  }

  return screenAudio.length ? screenAudio : micAudio;
}

/* ================================================================== */
/*  Canvas draw loop (screen + camera PiP)                             */
/* ================================================================== */
function startCanvasDraw() {
  function draw() {
    if (recState !== STATES.RECORDING) return;

    // Draw full-screen capture
    if (vidScreen.readyState >= 2) {
      ctx2d.drawImage(vidScreen, 0, 0, mixCanvas.width, mixCanvas.height);
    }

    // Draw camera bubble (bottom-right)
    if (cameraStream && vidCam.readyState >= 2) {
      drawCameraBubble();
    }

    rafId = requestAnimationFrame(draw);
  }
  draw();
}

function drawCameraBubble() {
  const short  = Math.min(mixCanvas.width, mixCanvas.height);
  const size   = Math.round(short * CAM_PIP_RATIO);
  const pad    = CAM_PIP_PAD;
  const x      = mixCanvas.width  - size - pad; // bounding box top-left x
  const y      = mixCanvas.height - size - pad; // bounding box top-left y
  const cx     = x + size / 2;                  // circle centre x
  const cy     = y + size / 2;                  // circle centre y
  const r      = size / 2;

  // 1. Clip to circle
  ctx2d.save();
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
  ctx2d.clip();

  // 2. Mirror the camera feed (natural selfie orientation)
  ctx2d.translate(x + size, y);
  ctx2d.scale(-1, 1);
  ctx2d.drawImage(vidCam, 0, 0, size, size);
  ctx2d.restore();

  // 3. White border ring
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx2d.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx2d.lineWidth   = 5;
  ctx2d.stroke();
}

/* ================================================================== */
/*  Stop recording                                                      */
/* ================================================================== */
function stopRecording() {
  clearInterval(timerInterval);
  timerInterval = null;

  cancelAnimationFrame(rafId);
  rafId = null;

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function onRecordingStop() {
  const mime = mediaRecorder.mimeType || "video/webm";
  recordedBlob = new Blob(chunks, { type: mime });
  chunks = [];

  // Create preview URL
  vidPreview.src = URL.createObjectURL(recordedBlob);

  // Show duration
  $("r-duration").textContent = `Duration: ${formatTime(timerSeconds)}`;

  // Release streams
  screenStream?.getTracks().forEach((t) => t.stop());
  cameraStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {});

  setState(STATES.STOPPED);
}

/* ================================================================== */
/*  Download                                                            */
/* ================================================================== */
function downloadRecording() {
  if (!recordedBlob) return;

  const ext  = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
  const ts   = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const name = `upwrite-${ts}.${ext}`;
  const url  = URL.createObjectURL(recordedBlob);

  const anchor = document.createElement("a");
  anchor.href     = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  // Notify background so popup can show a hint
  notifyBackground(name);

  // Update button state
  const btn = $("btn-download");
  btn.innerHTML = "✓ Downloaded";
  btn.disabled  = true;
}

/* ================================================================== */
/*  Background notification                                             */
/* ================================================================== */
function notifyBackground(filename) {
  try {
    chrome.runtime.sendMessage({
      type: "RECORDING_COMPLETE",
      filename: filename || null,
    });
  } catch (_) {
    // Extension context may not be available (e.g. reloaded) — safe to ignore
  }
}

/* ================================================================== */
/*  Cleanup                                                             */
/* ================================================================== */
function cleanup() {
  clearInterval(timerInterval); timerInterval = null;
  cancelAnimationFrame(rafId);  rafId = null;
  timerSeconds = 0;

  screenStream?.getTracks().forEach((t) => t.stop()); screenStream = null;
  cameraStream?.getTracks().forEach((t) => t.stop()); cameraStream = null;
  micStream?.getTracks().forEach((t) => t.stop());    micStream    = null;
  audioCtx?.close().catch(() => {});                  audioCtx     = null;

  mediaRecorder = null;
  chunks        = [];

  vidScreen.srcObject = null;
  vidCam.srcObject    = null;
}
