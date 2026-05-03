export default function Privacy() {
  return (
    <>
      <div className="page-hero">
        <div className="container">
          <div className="tag">Legal</div>
          <h1>Privacy Policy</h1>
          <p>Last updated: February 10, 2025</p>
        </div>
      </div>

      <div className="container section">
        <div className="prose">
          <p>UpWrite ("the Extension," "we," "us," or "our") is a private Chrome browser extension provided to clients as part of a managed service. This Privacy Policy explains what information the Extension accesses, how it is used, and your rights as a user.</p>

          <h2>1. Information We Collect</h2>
          <p>UpWrite does not collect, store, or transmit any personal information to any server operated by UpWrite. The Extension operates entirely within your browser and communicates only with the webhook URL you configure.</p>
          <p>When you trigger proposal generation, the Extension reads the following data from the Upwork proposal page currently open in your browser:</p>
          <ul>
            <li>Job title</li>
            <li>Job description text</li>
            <li>Client name (if visible on the page)</li>
            <li>Cover letter field placeholder text</li>
            <li>Screening questions (if present on the form)</li>
            <li>Loom video URL (if you have recorded a Loom on the page)</li>
          </ul>
          <p>This data is sent directly from your browser to the webhook URL you have entered in the Extension settings. UpWrite has no visibility into this data transmission.</p>

          <h2>2. Where Your Data Goes</h2>
          <p>The webhook URL you configure is your own — typically an n8n.cloud or self-hosted n8n instance that you control. The data extracted from Upwork travels from your browser to your webhook only. UpWrite does not operate any intermediate servers, proxies, or logging infrastructure.</p>
          <p>Once data reaches your webhook, it is processed according to your workflow configuration (e.g., sent to OpenAI's API). The privacy policies of those third-party services apply to that portion of the data flow. Please review OpenAI's Privacy Policy or the policies of any other AI provider you configure.</p>

          <h2>3. Stored Settings</h2>
          <p>The Extension stores your webhook URL locally in Chrome's <code>chrome.storage.sync</code> storage. This data:</p>
          <ul>
            <li>Is stored only on your local device (and synced across your signed-in Chrome instances via Chrome's built-in sync, if enabled)</li>
            <li>Is never transmitted to or accessible by UpWrite</li>
            <li>Can be cleared at any time by removing the Extension or clearing Chrome's extension storage</li>
          </ul>

          <h2>4. Permissions Used</h2>
          <p>The Extension requests the following Chrome permissions:</p>
          <ul>
            <li><strong>activeTab</strong> — to read the content of the Upwork proposal page currently open</li>
            <li><strong>storage</strong> — to save your webhook URL locally</li>
            <li><strong>Host permission for upwork.com</strong> — to enable the content script on Upwork proposal pages</li>
          </ul>
          <p>No other permissions are requested or used.</p>

          <h2>5. Cookies &amp; Tracking</h2>
          <p>UpWrite does not use cookies, tracking pixels, analytics SDKs, or any form of user tracking. There are no third-party scripts bundled with the Extension.</p>

          <h2>6. Children's Privacy</h2>
          <p>UpWrite is not directed at children under the age of 13. We do not knowingly collect any information from children.</p>

          <h2>7. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. Any changes will be reflected on this page with an updated "Last updated" date. We encourage you to review this page periodically.</p>

          <h2>8. Contact</h2>
          <p>If you have questions about this Privacy Policy, please open an issue on the UpWrite GitHub repository.</p>
        </div>
      </div>
    </>
  );
}
