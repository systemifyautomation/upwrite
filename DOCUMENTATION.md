# UpWrite – Technical Documentation

**Version:** 1.0.0  
**Type:** Chrome Extension (Manifest V3)  
**Purpose:** Automates Upwork proposal writing by extracting job data from the page, optionally attaching a video or screenshot, sending everything to an n8n webhook (AI backend), and auto-filling the proposal form with the AI-generated response.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Setup & Installation](#2-setup--installation)
3. [Configuration](#3-configuration)
4. [File Structure](#4-file-structure)
5. [Component Reference](#5-component-reference)
   - [manifest.json](#51-manifestjson)
   - [background.js](#52-backgroundjs--service-worker)
   - [content.js](#53-contentjs--content-script)
   - [popup.html / popup.js / popup.css](#54-popuphtml--popupjs--popupcss)
   - [recorder.html / recorder.js / recorder.css](#55-recorderhtml--recorderjs--recordercss)
   - [recorder-overlay.js](#56-recorder-overlayjs)
   - [offscreen.html / offscreen.js](#57-offscreenhtml--offscreenjs)
   - [notification.html](#58-notificationhtml)
6. [Data Structures](#6-data-structures)
   - [chrome.storage Keys](#61-chromestorage-keys)
   - [IndexedDB Schema](#62-indexeddb-schema)
   - [Webhook Payload](#63-webhook-payload-popup--n8n)
   - [Webhook Response](#64-webhook-response-n8n--extension)
   - [Message Passing API](#65-message-passing-api)
7. [Core Workflows](#7-core-workflows)
   - [Generate Proposal (No Video)](#71-generate-proposal-no-video)
   - [Generate Proposal (With Recording)](#72-generate-proposal-with-recording)
   - [Generate Proposal (File Upload / URL)](#73-generate-proposal-with-file-upload-or-url)
   - [Autofill Flow](#74-autofill-flow)
8. [Permissions Reference](#8-permissions-reference)
9. [n8n Webhook Integration](#9-n8n-webhook-integration)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Browser                                                  │
│                                                                  │
│  ┌──────────────┐   messages    ┌──────────────────────────────┐ │
│  │  popup.html  │◄─────────────►│   background.js (SW)        │ │
│  │  popup.js    │               │                              │ │
│  └──────────────┘               │  - Handles all storage I/O  │ │
│         │                       │  - Sends webhook requests    │ │
│  storage.local                  │  - Manages IDB recordings    │ │
│  upwrite_pending ──────────────►│  - Drives autofill           │ │
│                                 │  - Plays chime / notifies    │ │
│  ┌──────────────┐               └────────────┬─────────────────┘ │
│  │  content.js  │◄──────────────scripting────┘                   │
│  │ (Upwork tab) │                                                 │
│  └──────────────┘                                                 │
│                                                                   │
│  ┌──────────────┐   port/msgs   ┌──────────────────────────────┐ │
│  │recorder-     │◄─────────────►│   recorder.html              │ │
│  │overlay.js    │               │   recorder.js                │ │
│  │(Upwork tab)  │               └──────────────────────────────┘ │
│  └──────────────┘                                                 │
│                                                                   │
│  ┌──────────────┐                                                 │
│  │offscreen.html│  (audio chime only)                            │
│  └──────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         │ HTTPS POST (multipart/form-data)
         ▼
   n8n Webhook (AI backend)
```

**Key design decisions:**

- The **popup writes a job record** to `chrome.storage.local` and can safely close; the background service worker processes it independently.
- **Video blobs** are stored in IndexedDB (not `storage.local`) because they can exceed the 10 MB `storage.local` quota.
- **Autofill uses `chrome.scripting.executeScript`** (not message-passing) so it works even on discarded/backgrounded tabs.
- **Manifest V3 restrictions** mean `getDisplayMedia` must be called from an extension page with a user gesture (`recorder.html`), not from the background script.

---

## 2. Setup & Installation

### Prerequisites

| Requirement | Details |
|---|---|
| Chrome / Chromium | Version 116+ (Manifest V3 with offscreen support) |
| n8n instance | Self-hosted or cloud; must be reachable from the browser |
| Upwork account | Active account with access to the proposals UI |

### Load the Extension (Development)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root folder of this repository.
5. The UpWrite icon will appear in the Chrome toolbar.

### Build for Production

The extension has no build step — all files are plain HTML/CSS/JS. To package for the Chrome Web Store:

```powershell
# Zip all files except .git, node_modules, .env
Compress-Archive -Path . -DestinationPath upwrite.zip -CompressionLevel Optimal
```

> **Note:** The `.env` file is never loaded by the extension itself (no Node.js runtime). It is only a local developer reference. Do not include it in any published package.

---

## 3. Configuration

Configuration is stored in `chrome.storage.sync` so it persists across devices when the user is signed into Chrome.

### Setting the Webhook URL

1. Click the UpWrite toolbar icon on any page.
2. Click the **settings gear icon** in the popup header.
3. Paste the full n8n webhook URL into the **Webhook URL** field.
4. Click **Save**.

The URL is stored under the key `webhookUrl` in `chrome.storage.sync`.

### Storage Keys (sync)

| Key | Type | Description |
|---|---|---|
| `webhookUrl` | `string` | Full URL of the n8n webhook endpoint |

---

## 4. File Structure

```
upwrite/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Service worker — central controller
├── content.js              # Content script — DOM extraction & autofill
├── popup.html              # Popup markup
├── popup.js                # Popup logic
├── popup.css               # Popup styles
├── recorder.html           # Screen recorder popup window
├── recorder.js             # Recording engine (MediaRecorder, canvas mix)
├── recorder.css            # Recorder styles
├── recorder-overlay.js     # Injected overlay in the Upwork tab
├── offscreen.html          # Offscreen document (audio chime host)
├── offscreen.js            # Chime synthesis logic
├── notification.html       # Standalone notification window (legacy)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── .env                    # Local developer notes (NOT loaded at runtime)
```

---

## 5. Component Reference

### 5.1 `manifest.json`

The extension manifest. Key fields:

| Field | Value |
|---|---|
| `manifest_version` | `3` |
| `name` | `UpWrite – Upwork Proposal Assistant` |
| `version` | `1.0.0` |
| `background.service_worker` | `background.js` |
| `background.type` | `module` |
| `action.default_popup` | `popup.html` |

**Content script injection** (runs at `document_idle`):

```
https://www.upwork.com/nx/proposals/*
https://www.upwork.com/ab/proposals/*
https://www.upwork.com/proposals/*
```

**Content Security Policy:**

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; media-src blob: 'self'"
}
```

`media-src blob: 'self'` is required to play back recorded video blobs in the popup.

---

### 5.2 `background.js` – Service Worker

The privileged central controller. Runs as an ES module service worker.

#### Initialization

On `chrome.runtime.onInstalled` and SW startup: loads settings, registers alarm listener for the keepalive alarm (`upwrite-keepalive`), and sets up `chrome.storage.onChanged` to watch for `upwrite_pending`.

#### Core Function: `processProposal(job)`

Triggered when `upwrite_pending` is written to `chrome.storage.local`.

```
job = {
  tabId:          number,
  webhookUrl:     string,
  payload:        object,   // see §6.3
  hasVideo:       boolean,
  screenshotMode: "screenshot" | "none"
}
```

Steps:
1. Start keepalive alarm (fires every ~25 s to prevent SW suspension during long fetch).
2. If `hasVideo === true`: read recording blob from IndexedDB.
3. If `screenshotMode === "screenshot"`: call `captureJobTitleScreenshot(tabId)` → `chrome.tabs.captureVisibleTab` → PNG blob.
4. Build `FormData`: field `payload` (JSON string) + optional `video` (blob) + optional `screenshot` (blob).
5. `fetch(webhookUrl, { method: "POST", body: formData })`.
6. `normalizeWebhookResponse(data)` — extract cover letter + questions array.
7. Write `response_{tabId}` and `autofill_{tabId}` to `chrome.storage.local`.
8. Call `autofillInTab(tabId, normalizedPayload)` via `chrome.scripting.executeScript`.
9. Set badge: `✓` (green `#14a800`) on success, `!` (red `#e94560`) on error.
10. Play chime via offscreen document.
11. Show OS notification via `chrome.notifications.create`.
12. Clear keepalive alarm.

#### IDB Helpers

| Function | Description |
|---|---|
| `openSwDB()` | Opens `upwrite-db` v1, ensures `recordings` store exists |
| `getRecordingFromIDB()` | Returns the record at key `"current"` |
| `saveRecordingToIDB(record)` | Writes/overwrites the `"current"` record |
| `deleteRecordingFromIDB()` | Deletes the `"current"` record |

#### Offscreen Document Management

`ensureOffscreenDoc()` — creates `offscreen.html` using `chrome.offscreen.createDocument` with reason `AUDIO_PLAYBACK`. Guards against duplicate creation by checking `chrome.runtime.getContexts`. The document is closed when `offscreen.js` sends `CHIME_DONE` back to the SW.

#### Badge & Notification System

- **Badge:** `chrome.action.setBadgeText` + `chrome.action.setBadgeBackgroundColor`.
- **OS notifications:** `chrome.notifications.create` with `type: "basic"`, extension icon, title, and message.
- `notifTabMap` — `Map<notificationId, tabId>` — so clicking the notification calls `chrome.tabs.update(tabId, { active: true })`.

---

### 5.3 `content.js` – Content Script

Injected into Upwork proposal pages at `document_idle`.

#### `extractProposal()` → `ProposalData`

1. Calls `expandDescription()`: clicks the "more" truncation button if present, waits up to 3 s for `aria-expanded="true"`.
2. Queries DOM using the `SELECTORS` registry (tries each selector in order, takes the first match).
3. Returns a `ProposalData` object (see §6).

#### Selector Registry (`SELECTORS`)

Each key maps to an ordered array of CSS selectors tried in sequence:

| Key | Targets |
|---|---|
| `jobTitle` | `h1`, `[data-test="job-title"]`, `[class*="JobTitle"]` |
| `jobDescription` | `[class*="description"]`, `.job-description`, `[data-test="description"]` |
| `descriptionMoreBtn` | `.air3-truncation-btn`, `[class*="truncation"] button`, `[aria-expanded]` |
| `clientName` | `[data-test="client-name"]`, `[class*="ClientName"]` |
| `budget` | `[data-test="budget"]`, `[class*="Budget"]`, `[class*="rate"]` |
| `coverLetter` | `textarea[id*="cover"]`, `textarea[placeholder*="cover"]`, `textarea` |
| `questions` | `textarea[id*="question"]`, `form textarea:not([id*="cover"])` |
| `questionLabels` | `label[for]`, `[class*="label"]`, `p`, `span` |

#### `autofill(payload)` → `AutofillResult[]`

Writes `payload.coverLetter` into the cover letter textarea and each `payload.questions[i]` into the corresponding question textarea. Uses `simulateInput` to trigger React/Vue synthetic events.

#### `simulateInput(el, value)`

Uses `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value)` to bypass React's controlled-input interception, then dispatches `input`, `change`, and `blur` events.

#### Pending Autofill Fallback

On `visibilitychange` (tab becomes visible after being discarded), checks `chrome.storage.local` for `autofill_{myTabId}` and calls `autofill()` if found.

---

### 5.4 `popup.html` / `popup.js` / `popup.css`

The 360 px-wide action popup. Three mutually exclusive views:

| View ID | Shown when |
|---|---|
| `view-not-upwork` | Active tab is NOT an Upwork proposal URL |
| `view-settings` | User clicks the settings gear icon |
| `view-main` | Active tab IS an Upwork proposal URL |

#### Popup State Object

```js
{
  webhookUrl:      string,   // loaded from chrome.storage.sync
  clientName:      string,   // extracted from page
  proposalData:    object,   // ProposalData from content script
  webhookResponse: object,   // normalized AI response
  videoUrl:        string,   // manually pasted URL (mode: url)
  videoBlob:       Blob,     // recorded or uploaded blob
  videoBlobUrl:    string,   // object URL for <video> preview
  hasVideo:        boolean,
  activeTabId:     number,
}
```

#### Video Mode Selector (`#video-mode-select`)

| Value | Behavior |
|---|---|
| `auto` | Takes a screenshot of the job title area when the proposal is submitted |
| `record` | Opens the recorder overlay in the Upwork tab |
| `upload` | File picker for a local video file; saved to IDB |
| `url` | Free-text URL input; sent as `videoUrl` field in payload |

#### Send Flow (`sendToWebhook`)

1. `doExtract()` — sends `EXTRACT_PROPOSAL` to content script, stores result in `state.proposalData`.
2. `buildPayload()` — assembles the webhook payload object.
3. Writes `upwrite_pending` to `chrome.storage.local` — the background service worker picks this up and processes the request asynchronously.
4. Popup can safely close; the response will appear the next time the popup opens (read from `response_{tabId}`).

#### Response Rendering (`renderResponse`)

Dynamically creates labelled `<textarea>` elements for:
- Cover letter
- Each question answer

All fields are editable in-place. "Copy All" formats them as:

```
## Cover Letter
<text>

## [Question Label]
<text>
```

---

### 5.5 `recorder.html` / `recorder.js` / `recorder.css`

A standalone popup window (520 × 480 px) opened by the background SW when screen recording is requested. Handles `getDisplayMedia` which requires a user-visible extension page.

#### Recorder States

| State | UI |
|---|---|
| `state-idle` | Start button, camera/mic toggles |
| `state-requesting` | Spinner, "Waiting for screen selection…" |
| `state-recording` | Animated REC pill, timer, Stop button |
| `state-stopped` | Duration, "✓ Recording saved", Done / Record Again |

#### Recording Pipeline

```
getDisplayMedia() ──► screen stream
getUserMedia()    ──► camera stream (optional, PiP)
getUserMedia()    ──► mic stream (optional)
                         │
              AudioContext.createMediaStreamSource ──► createMediaStreamDestination
                         │ (mixed audio track)
                         ▼
              canvas stream + audio ──► MediaRecorder (250 ms chunks)
                         │
                    Blob assembly
                         │
                    ArrayBuffer ──► IndexedDB ("upwrite-db" / "recordings" / "current")
                         │
              RECORDING_COMPLETE ──► background.js
```

#### Constants

| Constant | Value | Purpose |
|---|---|---|
| `MAX_RECORDING_BYTES` | `100 MB` | Hard limit; recording rejected if exceeded |
| `CANVAS_FPS` | `30` | Canvas draw interval for camera compositing |
| `CAM_PIP_RATIO` | `0.22` | Camera bubble = 22% of the shorter screen dimension |
| `CAM_PIP_PAD` | `28 px` | Padding from the bottom-right corner |

#### Camera PiP Compositing

When a camera stream is available:
1. A `<canvas>` is sized to the captured screen resolution.
2. A `setInterval` at 30 fps draws the screen video frame onto the canvas.
3. `drawCameraBubble()` clips a circular region in the bottom-right corner, mirrors the camera feed (CSS `scaleX(-1)` equivalent via canvas transform), and draws a white ring border.
4. The canvas's `captureStream(30)` is used as the MediaRecorder source instead of the raw screen stream.

---

### 5.6 `recorder-overlay.js`

Injected into the active Upwork tab by the background SW. Renders a floating control panel (bottom-right of page).

Guards against double-injection:
```js
if (document.getElementById("uw-overlay-root")) return;
```

#### Overlay Phases

| Phase | UI elements |
|---|---|
| `uw-phase-idle` | "Share Screen" button, "Camera Only" button, Cancel, live camera preview |
| `uw-phase-rec` | Blinking red dot, elapsed timer, "Stop Recording" button |

#### Camera-Only Mode

Streams camera + mic directly in the content script:

```
getUserMedia(camera+mic)
      │
 MediaRecorder.start(250ms chunks)
      │
 port("recording-stream").postMessage({ type: "CHUNK", chunk: ArrayBuffer })
      │
 background.js reassembles chunks → saveRecordingToIDB()
```

#### Screen Mode

Delegates entirely to `recorder.html`:

```
overlay sends REQUEST_SCREEN_CAPTURE
      │
background opens recorder.html popup window
      │
recorder.html handles getDisplayMedia + canvas mix + IDB save
      │
RECORDING_COMPLETE relayed: recorder.html → background → overlay → cleanup()
```

---

### 5.7 `offscreen.html` / `offscreen.js`

An offscreen document used exclusively for audio chime playback (the `chrome.offscreen` API requires an HTML page to use `AudioContext`).

#### Chime Synthesis

| Note | Frequency | Duration |
|---|---|---|
| First | 880 Hz | 0.18 s |
| Second | 1318 Hz | 0.40 s |

Both notes use an `OscillatorNode` (sine wave) connected through a `GainNode` with exponential ramp-to-zero. After ~680 ms the offscreen script sends `CHIME_DONE` to the background SW, which closes the document.

---

### 5.8 `notification.html`

A standalone HTML page for in-browser toast notifications (opened as a small window). Reads URL parameters:

| Parameter | Values | Description |
|---|---|---|
| `type` | `success` \| `error` | Controls background color (green / red) |
| `msg` | string | Message text displayed |
| `tabId` | number (optional) | If provided, clicking the notification focuses that tab |

Auto-dismisses after 10 seconds with a fade animation.

> **Note:** The currently active notification path uses `chrome.notifications` (OS-level notifications) via `background.js`. This HTML file is a legacy/alternative approach and may not be actively invoked.

---

## 6. Data Structures

### 6.1 `chrome.storage` Keys

#### `chrome.storage.sync`

| Key | Type | Description |
|---|---|---|
| `webhookUrl` | `string` | n8n webhook endpoint URL |

#### `chrome.storage.local`

| Key | Type | Set by | Read by | Description |
|---|---|---|---|---|
| `upwrite_pending` | `PendingJob` | popup.js | background.js | Triggers `processProposal` when written |
| `upwrite_recording_meta` | `RecordingMeta` | background.js | popup.js | Metadata for the current recording |
| `upwrite_recording_error` | `string` | background.js | popup.js | Error message from a failed recording |
| `upwrite_last_context_capture` | `ContextCapture` | background.js | — | Debug info for last screenshot attempt |
| `response_{tabId}` | `ResponseRecord` | background.js | popup.js | AI response for a specific proposal tab |
| `autofill_{tabId}` | `NormalizedPayload` | background.js | content.js | Autofill data (fallback for discarded tabs) |
| `_ping` | `number` | background.js | — | Keepalive timestamp dummy |

#### Type Definitions

```ts
interface PendingJob {
  tabId:          number;
  webhookUrl:     string;
  payload:        WebhookPayload;
  hasVideo:       boolean;
  screenshotMode: "screenshot" | "none";
}

interface RecordingMeta {
  size:      number;   // bytes
  duration:  number;   // seconds
  mimeType:  string;   // e.g. "video/webm;codecs=vp8,opus"
  timestamp: number;   // Unix ms
}

interface ContextCapture {
  tabId:     number;
  type:      "screenshot" | "none";
  error:     string | null;
  timestamp: number;
}

interface ResponseRecord {
  normalized: NormalizedPayload;
  raw:        unknown;
  timestamp:  number;
  // OR on error:
  error:      string;
}

interface NormalizedPayload {
  coverLetter: string;
  questions:   string[];
}
```

---

### 6.2 IndexedDB Schema

| Property | Value |
|---|---|
| **Database name** | `upwrite-db` |
| **Database version** | `1` |
| **Object store** | `recordings` |
| **Key** | `"current"` (single record, overwritten each recording) |

#### Record Shape

```ts
interface IDBRecordingRecord {
  buffer:    ArrayBuffer;  // raw video bytes
  duration:  number;       // seconds
  mimeType:  string;       // MIME type string
  timestamp: number;       // Unix ms when saved
  size:      number;       // bytes (same as buffer.byteLength)
}
```

The same IDB database is accessed from three different contexts using the same origin:
- `background.js` (service worker)
- `popup.js` (extension popup)
- `recorder.js` (recorder popup window)

---

### 6.3 Webhook Payload (popup → n8n)

Sent as `multipart/form-data`. Always includes a `payload` field (JSON-serialized string). Optional binary fields are appended when available.

#### `payload` field (JSON)

```ts
interface WebhookPayload {
  source:   "upwrite-extension";
  pageUrl:  string;
  job: {
    title:       string;
    description: string;
    clientName:  string;
    budget:      string;
  };
  proposal: {
    coverLetter: {
      placeholder:   string;
      currentValue:  string;
    };
    questions: Array<{
      label:         string;
      placeholder:   string;
      currentValue:  string;
    }>;
  };
  videoUrl: string | null;   // only when mode = "url"
  sentAt:   string;          // ISO 8601
}
```

#### Optional FormData fields

| Field | Type | Condition |
|---|---|---|
| `video` | `Blob` | When `hasVideo === true` and an IDB recording exists |
| `screenshot` | `Blob` (PNG) | When `screenshotMode === "screenshot"` and capture succeeded |
| `context_image_type` | `string` | `"screenshot"`, `"video"`, or `"none"` |
| `context_image_error` | `string` | Error message if screenshot capture failed |

---

### 6.4 Webhook Response (n8n → extension)

The background normalizes several response shapes into a single `NormalizedPayload`:

#### Accepted Response Shapes

```js
// Shape 1: Object with named fields
{
  "coverLetter": "string",          // also: cover_letter, text, output
  "questions": ["string", ...]      // also: answers, questionAnswers
}

// Shape 2: n8n single-element array wrapper (unwrapped automatically)
[{ "coverLetter": "...", "questions": [...] }]

// Shape 3: Flat array (index 0 = cover letter, rest = question answers)
["cover letter text", "answer 1", "answer 2"]

// Shape 4: Nested output object
{ "output": { "coverLetter": "...", "questions": [...] } }
```

All shapes are normalized to:

```ts
interface NormalizedPayload {
  coverLetter: string;
  questions:   string[];
}
```

---

### 6.5 Message Passing API

All messages use `chrome.runtime.sendMessage` unless noted. Responses are returned via the message callback or `sendResponse`.

#### popup ↔ background

| Type | Sender | Payload | Response |
|---|---|---|---|
| `SAVE_SETTINGS` | popup | `{ webhookUrl }` | `{ ok }` |
| `LOAD_SETTINGS` | popup | — | `{ webhookUrl }` |
| `INJECT_RECORDER_OVERLAY` | popup | — | — |
| `DOWNLOAD_RECORDING` | popup | — | — |
| `DELETE_RECORDING` | popup | — | `{ ok }` |
| `GET_RECORDING` | popup | — | `{ buffer, mimeType, duration, size }` |
| `CHECK_TAB_READY` | popup | `{ tabId }` | `{ ready: boolean }` |
| `SEND_WEBHOOK` | popup | `{ url, payload }` | `{ ok, data }` (legacy) |

#### content ↔ background / popup

| Type | Sender | Payload | Response |
|---|---|---|---|
| `EXTRACT_PROPOSAL` | popup→content | — | `{ success, data: ProposalData }` |
| `AUTOFILL_PROPOSAL` | background→content | `NormalizedPayload` | `{ success, results }` |
| `CONTENT_SCRIPT_READY` | content→SW | `{ tabId }` | — |

#### recorder ↔ background ↔ overlay

| Type | Flow | Payload |
|---|---|---|
| `REQUEST_SCREEN_CAPTURE` | overlay → SW | — |
| `RECORDING_STARTED` | recorder → SW → overlay | — |
| `RECORDING_TICK` | recorder → SW → overlay | `{ seconds }` |
| `STOP_RECORDING` | overlay → SW → recorder | — |
| `RECORDING_COMPLETE` | recorder → SW | `{ ok, size?, duration?, mimeType? }` |
| `SCREEN_CAPTURE_CANCELLED` | SW → overlay | — |
| `REMOVE_OVERLAY` | SW → overlay | — |
| `RECORDING_ERROR` | SW → overlay | `{ error }` |

#### Long-lived ports

| Port name | Opened by | Used for |
|---|---|---|
| `recording-stream` | recorder-overlay.js | Streams camera-only recording chunks to background SW for IDB assembly |

**Port message types (recording-stream):**

| Type | Direction | Payload |
|---|---|---|
| `CHUNK` | overlay → SW | `{ type: "CHUNK", chunk: ArrayBuffer }` |
| `RECORDING_DONE` | overlay → SW | `{ type: "RECORDING_DONE", duration, mimeType }` |

#### offscreen ↔ background

| Type | Direction | Payload |
|---|---|---|
| `PLAY_CHIME` | SW → offscreen | `{ target: "offscreen", type: "PLAY_CHIME" }` |
| `CHIME_DONE` | offscreen → SW | `{ type: "CHIME_DONE" }` |

---

## 7. Core Workflows

### 7.1 Generate Proposal (No Video)

```
User opens Upwork proposal page
        │
        ▼
popup.js: initView() detects Upwork URL → shows view-main
        │
User selects video mode = "auto" (default)
        │
User clicks "Generate Proposal"
        │
        ▼
popup.js: sendToWebhook()
  1. doExtract() → content.js EXTRACT_PROPOSAL
  2. content.js: expandDescription() + DOM query → ProposalData
  3. buildPayload() → WebhookPayload
  4. chrome.storage.local.set({ upwrite_pending: { tabId, webhookUrl, payload,
                                  hasVideo: false, screenshotMode: "screenshot" } })
        │
        ▼
background.js: storage.onChanged fires
  1. captureJobTitleScreenshot(tabId) → chrome.tabs.captureVisibleTab → PNG
  2. FormData: { payload: JSON, screenshot: PNG }
  3. fetch(webhookUrl, POST, FormData)
  4. normalizeWebhookResponse(json)
  5. chrome.storage.local.set({ response_{tabId}, autofill_{tabId} })
  6. chrome.scripting.executeScript → autofillInTab()
  7. Badge: ✓  |  Chime  |  OS notification
        │
        ▼
content.js (injected by executeScript): autofill(payload)
  → writes coverLetter + questions into Upwork form
```

---

### 7.2 Generate Proposal (With Recording)

```
User clicks "Record" → selects "Record Screen"
        │
        ▼
popup.js: openRecorder()
  → sendMessage(INJECT_RECORDER_OVERLAY)
  → window.close()
        │
        ▼
background.js: injects recorder-overlay.js into Upwork tab
        │
        ▼
recorder-overlay.js: shows overlay panel (idle phase)
  User clicks "Share Screen"
        │
        ▼
overlay → INJECT_RECORDER_OVERLAY done; overlay sends REQUEST_SCREEN_CAPTURE
        │
        ▼
background.js: chrome.windows.create({ url: "recorder.html", type: "popup" })
        │
        ▼
recorder.js: user clicks "Start Recording"
  → getDisplayMedia() + optional getUserMedia(cam/mic)
  → canvas composite + MediaRecorder
  → RECORDING_STARTED → background → overlay (phase: rec, timer starts)
  → 250ms chunks accumulated
        │
  User clicks "Stop"
        │
        ▼
recorder.js: onRecordingStop()
  → Blob → ArrayBuffer → saveToIDB()
  → sendMessage(RECORDING_COMPLETE { ok, size, duration, mimeType })
        │
        ▼
background.js: saves meta to upwrite_recording_meta
  → sends RECORDING_COMPLETE to overlay → overlay cleanup()
        │
        ▼
User re-opens popup → checkAndShowRecording() shows video preview
User clicks "Generate Proposal"
  → hasVideo: true in upwrite_pending
        │
        ▼
background.js: getRecordingFromIDB() → attaches video blob to FormData
  → POST → autofill (same as §7.1 from step 3)
```

---

### 7.3 Generate Proposal with File Upload or URL

**File Upload:**
```
User selects mode = "upload", picks file
        │
popup.js: FileReader → Blob → saveUploadToIDB(blob)
        │
upwrite_recording_meta written → showRecordedVideo()
        │ (same flow as §7.2 from "User re-opens popup")
```

**URL:**
```
User selects mode = "url", pastes video URL
        │
state.videoUrl set; hasVideo = false
payload.videoUrl = state.videoUrl
        │ (background sends URL in payload JSON, not as binary attachment)
```

---

### 7.4 Autofill Flow

The autofill function is injected directly into the page via `chrome.scripting.executeScript` to guarantee it runs even in backgrounded or discarded tabs.

```js
// Injected self-contained function
function autofillInTab(payload) {
  const coverEl = document.querySelector(/* cover letter selectors */);
  if (coverEl && payload.coverLetter) simulateInput(coverEl, payload.coverLetter);

  const questionEls = document.querySelectorAll(/* question selectors */);
  questionEls.forEach((el, i) => {
    if (payload.questions?.[i]) simulateInput(el, payload.questions[i]);
  });
}

function simulateInput(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, "value"
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur",   { bubbles: true }));
}
```

**Discarded-tab fallback:** If the tab was discarded before `executeScript` could run, `content.js` detects the `visibilitychange` event (fired when the tab becomes active again), reads `autofill_{tabId}` from storage, and calls `autofill()` itself.

---

## 8. Permissions Reference

| Permission | Reason |
|---|---|
| `activeTab` | Query the current tab's URL and inject scripts on demand |
| `storage` | Read/write `chrome.storage.sync` (settings) and `chrome.storage.local` (job queue, responses) |
| `unlimitedStorage` | Allow IndexedDB to store large video blobs without the standard quota limit |
| `scripting` | `chrome.scripting.executeScript` for autofill injection into Upwork tabs |
| `alarms` | Keepalive alarm to prevent SW suspension during long webhook fetches |
| `offscreen` | Create offscreen document for `AudioContext` chime playback |
| `desktopCapture` | (Legacy/fallback) Desktop capture API; primary path uses `getDisplayMedia` |
| `tabs` | `chrome.tabs.captureVisibleTab` (screenshots), `chrome.tabs.update` (focus on notification click), `chrome.tabs.sendMessage` |
| `notifications` | OS-level completion/error notifications |
| `downloads` | `chrome.downloads.download` for the "Download Recording" feature |

**Host permissions:**

| Pattern | Reason |
|---|---|
| `https://www.upwork.com/*` | Content script injection + tab querying on Upwork |
| `<all_urls>` | `fetch()` from the service worker to arbitrary n8n webhook URLs |

---

## 9. n8n Webhook Integration

### What UpWrite Sends

A `multipart/form-data` POST with:

- `payload` — JSON string containing the full `WebhookPayload` (see §6.3)
- `video` *(optional)* — Binary video blob (`video/webm`)
- `screenshot` *(optional)* — PNG image of the job title area
- `context_image_type` — `"screenshot"`, `"video"`, or `"none"`
- `context_image_error` — Non-empty string if screenshot failed

### What UpWrite Expects Back

Any JSON response matching one of the shapes in §6.4. The simplest recommended format:

```json
{
  "coverLetter": "Your AI-generated cover letter text here.",
  "questions": [
    "Answer to the first screening question.",
    "Answer to the second screening question."
  ]
}
```

### Recommended n8n Workflow Structure

```
Webhook (POST) ──► Extract Fields ──► AI Agent / LLM ──► Format Response ──► Respond to Webhook
```

1. **Webhook node:** Accept `multipart/form-data`. Parse the `payload` field from JSON.
2. **Extract fields:** Pull `job.title`, `job.description`, `proposal.coverLetter.placeholder`, `proposal.questions[*].label` from the parsed payload.
3. **AI node (e.g., OpenAI):** Pass job info as context. Request a cover letter and answers for each question.
4. **Format response:** Shape the output to match the `{ coverLetter, questions }` structure.
5. **Respond to Webhook node:** Return the formatted JSON with `Content-Type: application/json`.

### Error Handling

If the webhook returns a non-2xx status or the response cannot be normalized, `background.js` writes `{ error: "...", timestamp }` to `response_{tabId}`, sets the badge to `!` (red), and shows an error notification.

---

## 10. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Popup shows "Go to Upwork" on a proposal page | URL does not match the three content-script patterns | Verify the URL starts with `upwork.com/nx/proposals/`, `/ab/proposals/`, or `/proposals/` |
| "No webhook URL" warning in popup | `webhookUrl` not set | Open settings, paste the n8n URL, and save |
| Proposal generated but form not filled | Content script context invalidated after extension reload | Reload the Upwork tab; the pending autofill in `autofill_{tabId}` will re-run on tab focus |
| Recording saves but video is blank | Canvas compositor issue (no camera, screen stream used directly) | Expected behavior — screen-only recording bypasses canvas; check the video file |
| Badge shows `!` after sending | Webhook returned an error or unreachable | Check the n8n webhook URL, verify n8n is running, check browser DevTools Network tab from the extension's service worker |
| Popup closes before showing response | Expected behavior | Re-open the popup; it reads `response_{tabId}` and renders the response automatically |
| Recording exceeds 100 MB limit | Long recording session | Keep recordings under ~5–10 minutes, or use the URL mode instead |
| Extension icon grayed out | Service worker suspended | Click the extension icon to wake the SW; keepalive alarms reset automatically |
| `chrome.runtime.lastError: Could not establish connection` | Content script not yet injected (tab still loading) | Wait for the page to fully load before clicking "Generate Proposal" |
