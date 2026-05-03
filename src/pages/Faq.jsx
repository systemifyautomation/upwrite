import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

const faqItems = [
  { q: 'Is UpWrite free?', a: 'Yes — the extension source code is fully open source on GitHub. You can clone it, inspect it, and self-host it at no cost. A paid managed option is also available if you want n8n hosting, workflow setup, and support handled for you.' },
  { q: "Why isn't it on the Chrome Web Store?", a: 'UpWrite is distributed as an unpacked extension loaded directly in Chrome. Because the source is open on GitHub, you can audit every line of code before installing — no black box.' },
  { q: 'Do I need to know how to code to use UpWrite?', a: "If you're comfortable with GitHub and n8n, you can self-host entirely for free. If you'd prefer a no-touch setup, the managed service option handles everything — just reach out." },
  { q: 'What AI model does UpWrite use?', a: "UpWrite doesn't ship with a specific AI model — it sends data to your n8n webhook, where YOU decide which model to use. The sample workflow uses GPT-4o, but you can swap in Claude, Gemini, Mistral, or any model your n8n instance supports." },
  { q: 'Is my Upwork data safe?', a: 'Absolutely. UpWrite sends data directly from your browser to your own n8n webhook URL — there is no UpWrite server in the middle. Your job descriptions and proposals never leave your own infrastructure.' },
  { q: 'Does it work on all Upwork job pages?', a: 'UpWrite activates on any page matching upwork.com/nx/proposals/…. As long as the proposal form is present, the extension will detect the fields and extract the job data.' },
  { q: 'Can I customize the AI prompts?', a: 'Yes — because the AI runs on your own n8n workflow, you have full control over the system prompt. You can instruct the AI to match your tone of voice, include specific portfolio links, or follow a particular cover letter framework.' },
  { q: 'Does UpWrite work with self-hosted n8n?', a: 'Yes. UpWrite just needs a webhook URL that accepts POST requests and returns a JSON response. Whether that webhook is on n8n.cloud or a self-hosted n8n instance on your VPS makes no difference.' },
  { q: 'What happens if the AI takes too long?', a: 'The extension has a configurable timeout. If your AI workflow takes longer than expected, you can increase the timeout in the UpWrite settings popup. For faster responses, consider using GPT-4o-mini or a similar lower-latency model in your workflow.' },
  { q: 'Can I use a different webhook provider besides n8n?', a: 'Technically, yes — any webhook endpoint that accepts the UpWrite JSON payload and returns the expected response format will work. n8n is recommended because the template workflow is pre-built for it, but advanced users can adapt the pattern to any backend.' },
];

export default function Faq() {
  const [open, setOpen] = useState(null);
  const toggle = (i) => setOpen(open === i ? null : i);

  return (
    <>
      <div className="page-hero">
        <div className="container">
          <div className="tag">FAQ</div>
          <h1>Frequently Asked Questions</h1>
          <p>Everything you need to know about UpWrite, n8n setup, AI models, and data privacy.</p>
        </div>
      </div>

      <div className="container section">
        <div className="faq-list">
          {faqItems.map((item, i) => (
            <div className={`faq-item${open === i ? ' open' : ''}`} key={i}>
              <button className="faq-question" onClick={() => toggle(i)}>
                {item.q}
                <span className="faq-icon">+</span>
              </button>
              <div className="faq-answer">
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Still have questions?</p>
          <a
            href="https://github.com/systemifyautomation"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
          >
            Open a GitHub Issue <ChevronRight size={14} />
          </a>
        </div>
      </div>
    </>
  );
}
