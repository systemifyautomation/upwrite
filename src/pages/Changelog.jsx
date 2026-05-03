const releases = [
  {
    version: 'v1.2.0',
    date: '2025-04-15',
    title: 'Multi-Question Support & Loom Integration',
    changes: [
      'Added support for detecting and filling up to 10 follow-up screening questions',
      'Integrated Loom URL detection — automatically includes your Loom video URL in the AI payload',
      'Improved proposal form field detection for Upwork\'s latest DOM structure',
      'Added loading spinner while waiting for AI response',
      'Fixed edge case where cover letter field was not detected on some job pages',
    ],
  },
  {
    version: 'v1.1.2',
    date: '2025-03-28',
    title: 'Stability & Performance Improvements',
    changes: [
      'Increased default webhook timeout from 15s to 30s',
      'Added configurable timeout setting in the popup (5s–60s range)',
      'Fixed settings not persisting after Chrome restart on some systems',
      'Improved error messages — now shows specific failure reason in the popup',
      'Reduced extension bundle size by 18%',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2025-03-10',
    title: 'Settings Popup & Webhook Validation',
    changes: [
      'Added full Settings popup with webhook URL input and save functionality',
      'Added webhook URL validation — alerts user if URL format is invalid before sending',
      'Added "Test Connection" button in settings to verify the webhook is reachable',
      'Cover letter field now auto-resizes after fill to show full content',
      'Added keyboard shortcut Alt+U to trigger proposal generation',
    ],
  },
  {
    version: 'v1.0.1',
    date: '2025-02-22',
    title: 'Bug Fixes',
    changes: [
      'Fixed proposal generation failing when job description contained special characters',
      'Fixed cover letter fill not triggering Upwork\'s character counter update',
      'Corrected manifest.json permissions — removed unused host permissions',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2025-02-10',
    title: 'Initial Release',
    changes: [
      'Chrome extension that activates on Upwork proposal pages',
      'Extracts job title, description, client name, and cover letter field',
      'Sends extracted data to a user-configured n8n webhook via POST request',
      'Receives AI-generated cover letter and auto-fills the Upwork form',
      'Basic settings popup for webhook URL configuration',
    ],
  },
];

export default function Changelog() {
  return (
    <>
      <div className="page-hero">
        <div className="container">
          <div className="tag">Changelog</div>
          <h1>What's New in UpWrite</h1>
          <p>Every release, improvement, and bug fix — in one place.</p>
        </div>
      </div>

      <div className="container section">
        <div className="changelog-list">
          {releases.map((r, i) => (
            <div className="changelog-item" key={i}>
              <div className="changelog-version">{r.version}</div>
              <div className="changelog-date">{r.date}</div>
              <h3>{r.title}</h3>
              <ul>
                {r.changes.map((c, j) => <li key={j}>{c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
