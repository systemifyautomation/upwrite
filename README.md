# Upright – Upwork Proposal Assistant

> A Chrome extension that extracts Upwork proposal details, optionally records a Loom video, sends everything to your **n8n webhook**, and auto-fills the proposal form with the AI-generated response.

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Proposal Extraction** | Reads job title, description, client name, budget, cover-letter field, and any follow-up questions directly from the Upwork proposal page DOM. |
| 2 | **Loom Video** | One-click launch of the Loom web recorder. Paste the share URL back to include it in the webhook payload. |
| 3 | **n8n Webhook** | POSTs a structured JSON payload to your configured n8n webhook URL. |
| 4 | **AI Auto-fill** | Parses the webhook response (AI-generated cover letter + question answers) and fills the proposal form for you. |

---

## Installation (Developer / Unpacked)

1. Clone or download this repository.
2. Open **Chrome** → `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the root folder of this repo (where `manifest.json` lives).
5. The **Upright** icon appears in your toolbar.

---

## Setup

1. Click the **⚙ Settings** button inside the popup.
2. Enter your **n8n webhook URL** (e.g. `https://your-n8n-instance.com/webhook/upright`).
3. Click **Save**.

---

## Usage

1. Navigate to an **Upwork proposal page** (`upwork.com/nx/proposals/…`).
2. Click the **Upright** toolbar icon.
3. **Step 1 – Extract**: Click *Extract Proposal Data* to pull job + form details.
4. **Step 2 – Loom** *(optional)*: Click *Record with Loom* or paste an existing Loom URL.
5. **Step 3 – Generate**: Click *Send to Webhook*.
6. **Step 4 – Review & Fill**: Edit the AI-generated text if needed, then click *Auto-fill Form*.

---

## Webhook Payload

```json
{
  "source": "upright-extension",
  "pageUrl": "https://www.upwork.com/nx/proposals/job/~01abc.../apply",
  "job": {
    "title": "Build a REST API",
    "description": "We need a Node.js REST API…",
    "clientName": "Acme Corp",
    "budget": "$500 Fixed"
  },
  "proposal": {
    "coverLetter": {
      "placeholder": "Write your cover letter here",
      "currentValue": ""
    },
    "questions": [
      {
        "label": "What relevant experience do you have?",
        "placeholder": "",
        "currentValue": ""
      }
    ]
  },
  "loomUrl": "https://www.loom.com/share/abc123",
  "sentAt": "2025-01-01T00:00:00.000Z"
}
```

## Expected Webhook Response

Your n8n workflow should return JSON in **one of these shapes**:

```json
{
  "coverLetter": "Dear client, …",
  "questions": ["Answer to question 1", "Answer to question 2"]
}
```

Or a flat array (first element = cover letter, rest = question answers):

```json
["Dear client, …", "Answer to question 1"]
```

---

## File Structure

```
upright/
├── manifest.json      Chrome Manifest V3
├── background.js      Service worker – webhook proxy + settings storage
├── content.js         Content script – extracts & auto-fills Upwork proposal page
├── popup.html         Extension popup UI
├── popup.css          Popup styles
├── popup.js           Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Development

No build step required – this is a plain-JS Manifest V3 extension.

After editing any file, go to `chrome://extensions` and click the **↺ Reload** button for the Upright extension.

---

## License

MIT
