import { Clock, AlertCircle, KeyRound, Braces, Mail, ExternalLink } from 'lucide-react';

export default function Install() {
  return (
    <>
      <div className="page-hero">
        <div className="container">
          <div className="tag">Installation</div>
          <h1>Get Up and Running in 5 Minutes</h1>
          <p>UpWrite is open-source and distributed as an unpacked Chrome extension — no Chrome Web Store needed. Clone the repo from GitHub or download the zip, then follow the steps below.</p>
        </div>
      </div>

      <div className="container section">
        {/* Step-by-step install */}
        <div className="tag" style={{ display: 'block' }}>Part 1 — Install the Extension</div>
        <h2 style={{ marginBottom: 32 }}>Loading UpWrite into Chrome</h2>
        <div className="install-steps">
          <div className="install-step">
            <h3>Download the Extension</h3>
            <p>Clone or download the repo from <a href="https://github.com/systemifyautomation" target="_blank" rel="noopener noreferrer">github.com/systemifyautomation</a>. Unzip to a permanent folder on your computer — don't delete this folder after loading.</p>
          </div>
          <div className="install-step">
            <h3>Open Chrome Extensions</h3>
            <p>In Chrome, navigate to <code>chrome://extensions</code> and enable <strong>Developer Mode</strong> using the toggle in the top-right corner.</p>
          </div>
          <div className="install-step">
            <h3>Load Unpacked</h3>
            <p>Click <strong>"Load unpacked"</strong> and select the unzipped <code>upwrite/</code> folder. The UpWrite icon will appear in your Chrome toolbar.</p>
          </div>
          <div className="install-step">
            <h3>Pin the Extension</h3>
            <p>Click the puzzle-piece icon in Chrome's toolbar, find UpWrite, and click the pin icon so it's always visible.</p>
          </div>
        </div>

        <hr style={{ margin: '56px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

        {/* n8n setup */}
        <div className="tag" style={{ display: 'block' }}>Part 2 — Set Up Your AI Workflow</div>
        <h2 style={{ marginBottom: 32 }}>Connecting UpWrite to n8n</h2>
        <div className="install-steps">
          <div className="install-step">
            <h3>Create an n8n Account</h3>
            <p>Sign up at <a href="https://n8n.io" target="_blank" rel="noopener noreferrer">n8n.io</a> (cloud) or self-host on your own VPS. Both work. If you'd prefer a fully managed n8n instance, get in touch for the managed service option.</p>
          </div>
          <div className="install-step">
            <h3>Import the Workflow Template</h3>
            <p>Download the UpWrite n8n template from the GitHub repo. In n8n, click <strong>Import from file</strong> and select the template JSON. The workflow is pre-built and ready to configure.</p>
          </div>
          <div className="install-step">
            <h3>Add Your API Key</h3>
            <p>In the AI node of the workflow, add your OpenAI API key (or swap in your preferred model). Activate the workflow by toggling it to <strong>Active</strong>.</p>
          </div>
          <div className="install-step">
            <h3>Paste Your Webhook URL</h3>
            <p>Copy your webhook URL from n8n. Click the UpWrite icon in Chrome, open <strong>Settings</strong>, paste the URL, and save. You're ready to generate proposals.</p>
          </div>
        </div>

        {/* Download CTA */}
        <div className="install-download-box">
          <h3>Get the Source Code</h3>
          <p>UpWrite is fully open source. Star the repo, fork it, or open an issue on GitHub.</p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="https://github.com/systemifyautomation" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ fontSize: '1.05rem', padding: '16px 36px' }}>
              <ExternalLink size={16} /> View on GitHub
            </a>
            <a href="/#contact" className="btn btn-outline" style={{ fontSize: '1.05rem', padding: '16px 36px' }}>
              <Mail size={16} /> Get Managed Setup
            </a>
          </div>
          <p style={{ marginTop: 16, fontSize: '.82rem', color: '#4a6080' }}>
            Requires Chrome 90+ · macOS, Windows, Linux
          </p>
        </div>

        {/* Troubleshooting */}
        <div style={{ marginTop: 64 }}>
          <h2 style={{ marginBottom: 24 }}>Troubleshooting</h2>
          <div className="features-grid">
            {[
            { icon: <Clock size={24} />, title: 'Proposal Times Out', desc: 'Make sure your n8n workflow is Active (not just in Test mode). Check the execution log in n8n for any errors in your AI node.' },
              { icon: <AlertCircle size={24} />, title: "Form Doesn't Fill", desc: 'Navigate to a proposal page (upwork.com/nx/proposals/…). UpWrite only activates on the proposal submission form, not on job listing pages.' },
              { icon: <KeyRound size={24} />, title: 'API Key Errors', desc: 'Verify your OpenAI API key has sufficient credits and that the key is correctly entered in your n8n AI node settings without extra whitespace.' },
              { icon: <Braces size={24} />, title: 'Wrong JSON Format', desc: 'UpWrite expects the webhook to return { "coverLetter": "...", "answers": ["..."] }. Check the Respond to Webhook node output in your n8n workflow.' },
            ].map((t, i) => (
              <div className="feature-card" key={i}>
                <div className="feature-icon">{t.icon}</div>
                <h3>{t.title}</h3>
                <p>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
