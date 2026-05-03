# Chrome Web Store — Launch Checklist

Work through this top-to-bottom before submitting.

---

## Phase 1 — Pre-submission (technical)

- [ ] **Developer account** — Go to https://chrome.google.com/webstore/devconsole and pay the one-time **$5 USD** registration fee. Requires a Google account.

- [ ] **Verify manifest is clean**
  - `description` field ≤ 132 chars and no prohibited words ✓ (already updated)
  - No `eval()`, no remote scripts, no `innerHTML` from external sources
  - `version` follows semver (e.g., `1.0.0`) ✓

- [ ] **Host privacy policy** — Upload `store/privacy-policy.html` to a publicly accessible URL.  
  Suggested: `https://upwrite.app/privacy` or a GitHub Pages URL.  
  You MUST have this URL before submitting — the dashboard will ask for it.

- [ ] **Update privacy policy contact email** — Open `store/privacy-policy.html` and replace `privacy@upwrite.app` with your real email.

- [ ] **`<all_urls>` justification** — In the Developer Dashboard under *Privacy practices*, you must explain each sensitive permission. For `<all_urls>` paste:  
  > "The extension sends proposal data to a webhook URL entered by the user at runtime. Because this URL is user-defined and cannot be known at install time, a wildcard host permission is required. No request is made to any URL other than the one explicitly configured by the user in the extension settings."

- [ ] **Package the extension** — Run from repo root:
  ```powershell
  .\store\package.ps1
  ```
  This creates `store/upwrite-v1.0.0.zip`.

---

## Phase 2 — Store listing

- [ ] **Listing copy** — Copy text from `store/listing-copy.md` into the dashboard fields.

- [ ] **Screenshots** — Create and upload at least 1 screenshot (1280×800 or 640×400).  
  See `store/visual-assets-brief.md` for the full shot list and tool recommendations.

- [ ] **Small promo tile** — Create the 440×280 promotional image (required for featured placement, strongly recommended for all listings).

- [ ] **Category** — Select **Productivity**.

- [ ] **Language** — English (en).

---

## Phase 3 — Privacy practices tab

The dashboard has a dedicated "Privacy practices" step. Fill it as follows:

| Question | Answer |
|---|---|
| Does the extension collect user data? | **Yes** |
| Data types collected | "Personally identifiable information" → **No**; "Website content" → **Yes** (proposal page DOM) |
| Is data sold to third parties? | **No** |
| Is data used for purposes unrelated to the extension's core functionality? | **No** |
| Is data transferred to third parties? | **Yes** → "The data is sent only to the webhook URL configured by the user." |

---

## Phase 4 — Submit

- [ ] Click **Submit for review**.
- [ ] Initial review typically takes **1–3 business days** for new items.
- [ ] You will receive an email when approved or if changes are requested.

---

## Phase 5 — Post-launch

- [ ] **Monitor reviews** — Check the Developer Dashboard weekly for user reviews and crash reports.
- [ ] **Increment version** — Every update requires bumping `version` in `manifest.json` (e.g., `1.0.1`).
- [ ] **Update the store listing** — Any change to permissions requires re-submitting for review.

---

## Known review risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `<all_urls>` triggers manual review | High | Fill in the justification field exactly as written above in Phase 1 |
| `desktopCapture` flagged | Medium | Explain in privacy practices: used only when user initiates a recording |
| `unlimitedStorage` questioned | Low | Explain: needed to store video blobs in IndexedDB without hitting standard quota |
| Listing rejected for vague description | Low | Current description is specific and accurate ✓ |
