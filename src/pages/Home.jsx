import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  FileText, HelpCircle, Video, Webhook, MousePointerClick, ShieldCheck,
  Lock, Target, Mail, ChevronRight, ArrowDown, ExternalLink, MessageCircle, Send, UserCircle, CircleCheck, Users, Crown
} from 'lucide-react';
import AdSlot from '../components/AdSlot';

const faqs = [
  {
    q: 'Is UpWrite free?',
    a: 'The extension source code is fully open source on GitHub — you can clone it, inspect it, and self-host it for free. If you want a fully managed setup (n8n hosting, workflow configuration, and ongoing support), that is available as a paid service.',
  },
  {
    q: "Why isn't it on the Chrome Web Store?",
    a: 'UpWrite is distributed as an unpacked extension so you can load it directly in Chrome without a store review. Because the source code is open on GitHub, you can audit every line before installing it.',
  },
  {
    q: 'Do I need to know how to code to use UpWrite?',
    a: 'If you are comfortable with GitHub and n8n you can self-host for free. If you prefer a no-touch setup, the managed service option handles everything for you.',
  },
  {
    q: 'What AI model does UpWrite use?',
    a: "UpWrite doesn't ship with a specific AI model — it sends data to your n8n webhook, where YOU decide which model to use. The sample workflow uses GPT-4o, but you can swap in Claude, Gemini, Mistral, or any model your n8n instance supports.",
  },
  {
    q: 'Is my Upwork data safe?',
    a: 'Absolutely. UpWrite sends data directly from your browser to your own n8n webhook URL — there is no UpWrite server in the middle. Your job descriptions and proposals never leave your own infrastructure.',
  },
  {
    q: 'Does it work on all Upwork job pages?',
    a: 'UpWrite activates on any page matching upwork.com/nx/proposals/…. As long as the proposal form is present, the extension will detect the fields and extract the job data.',
  },
];

export default function Home() {
  const [openFaq, setOpenFaq] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', upwork: '' });
  const [formStatus, setFormStatus] = useState('idle'); // idle | loading | success | error
  const [formSource, setFormSource] = useState('direct');

  const goToContact = (source) => {
    setFormSource(source);
    const el = document.getElementById('contact');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const handleContact = async (e) => {
    e.preventDefault();
    setFormStatus('loading');
    try {
      let ip = 'unknown';
      let country = 'unknown';
      try {
        const geo = await fetch('https://ipapi.co/json/');
        if (geo.ok) {
          const geoData = await geo.json();
          ip = geoData.ip || 'unknown';
          country = geoData.country_name || 'unknown';
        }
      } catch { /* geo lookup failed — continue without it */ }

      const res = await fetch(import.meta.env.VITE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          upworkProfile: form.upwork,
          source: formSource,
          ip,
          country,
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      setFormStatus('success');
      setForm({ name: '', email: '', upwork: '' });
    } catch {
      setFormStatus('error');
    }
  };

  // Scroll to hash on mount (handles /#section navigation from other pages)
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, []);

  // Scroll-reveal
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
      }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const toggleFaq = (i) => setOpenFaq(openFaq === i ? null : i);

  return (
    <>
      {/* HERO */}
      <section id="hero">
        <div className="container">
          <div className="hero-grid">
            <div className="hero-content">
              <div className="eyebrow"><Bot size={14} /> Auto-Generated Proposals</div>
              <h1>Win More Upwork Jobs by Being the <em>1st to Apply</em> While Maintaining Personalization</h1>
              <p>UpWrite is an open-source Chrome extension that reads your Upwork job listing and auto-generates a tailored cover letter and question answers — so you can focus on the work, not the paperwork.</p>
              <div className="hero-actions">
                <a href="https://github.com/systemifyautomation" target="_blank" rel="noopener noreferrer" className="btn btn-primary"><ExternalLink size={16} /> View on GitHub</a>
                <a href="#how-it-works" className="btn btn-outline btn-outline-light">See How It Works <ChevronRight size={16} /></a>
              </div>
              <p className="hero-note">
                <Lock size={14} /> Open source &amp; self-hostable. No Chrome Web Store required. Runs locally on your machine.
              </p>
            </div>
            <div className="hero-visual">
              <div className="browser-mockup">
                <div className="browser-bar">
                  <div className="browser-dots"><span></span><span></span><span></span></div>
                  <div className="browser-url">upwork.com/nx/proposals/job/~01abc…</div>
                </div>
                <div className="browser-body">
                  <div className="mock-field">
                    <strong>Job Title</strong>
                    We're looking for an expert on React &amp; Node.js SaaS development
                  </div>
                  <div className="mock-field">
                    <strong>Cover Letter</strong>
                    <div className="mock-ai-badge"><Bot size={11} /> AI-Generated</div>
                    <div className="mock-text-line medium"></div>
                    <div className="mock-text-line"></div>
                    <div className="mock-text-line short"></div>
                    <div className="mock-text-line medium"></div>
                    <div className="mock-text-line"></div>
                  </div>
                  <div className="mock-field">
                    <strong>Follow-up Q: Describe your recent similar experience</strong>
                    <div className="mock-text-line medium"></div>
                    <div className="mock-text-line short"></div>
                  </div>
                  <div className="mock-btn-row">
                    <div className="mock-btn green">Auto-Fill ✓</div>
                    <div className="mock-btn ghost">Settings</div>
                  </div>
                </div>
              </div>
              <div className="floating-badge badge-tl">
                <Bot size={16} /> Hands-free proposals
              </div>
              <div className="floating-badge badge-br">
                <Target size={16} /> Tailored to each job
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AD SLOT — Leaderboard */}
      <AdSlot type="leaderboard" />

      {/* STATS */}
      <section id="stats">
        <div className="container">
          <div className="stats-grid reveal">
            <div className="stat-item">
              <h3>Open</h3>
              <p>Fully open-source — inspect, fork, and customize freely</p>
            </div>
            <div className="stat-item">
              <h3>Private</h3>
              <p>Your data never leaves your own infrastructure</p>
            </div>
            <div className="stat-item">
              <h3>Flexible</h3>
              <p>Self-host free or get a fully managed setup</p>
            </div>
            <div className="stat-item">
              <h3>TOS-Compliant</h3>
              <p>Built and actively maintained to stay within Upwork's Terms of Service</p>
            </div>
          </div>
        </div>
      </section>

      {/* TOS BANNER */}
      <div className="tos-banner">
        <div className="container">
          <div className="tos-banner-inner reveal">
            <ShieldCheck size={20} />
            <span>
              UpWrite is designed and actively maintained to comply with{' '}
              <a href="https://www.upwork.com/legal#terms" target="_blank" rel="noopener noreferrer">
                Upwork's Terms of Service
              </a>
              . We monitor TOS updates and adjust the tool accordingly so you can use it with confidence.
            </span>
          </div>
        </div>
      </div>

      {/* PROFILE SETUP NOTICE */}
      <section className="section">
        <div className="container">
          <div className="setup-notice reveal">
            <div className="setup-notice-icon"><UserCircle size={36} /></div>
            <div className="setup-notice-body">
              <h2>Before You Start: Add Your Freelancer Profile</h2>
              <p>
                UpWrite generates proposals based on <strong>your</strong> background, skills, and experience.
                Before using the extension, you need to fill in your profile inside the n8n workflow —
                things like your name, niche, past projects, key skills, and tone of voice.
              </p>
              <p>
                Without this, the AI has nothing real to work with and will produce generic,
                hollow proposals that may contain inaccuracies about you. The quality of every
                proposal is directly tied to the quality of the profile you provide.
              </p>
              <div className="setup-checklist">
                <div className="setup-check"><CircleCheck size={16} /> Your name and professional title</div>
                <div className="setup-check"><CircleCheck size={16} /> Your niche and core skills</div>
                <div className="setup-check"><CircleCheck size={16} /> 2–3 past project examples</div>
                <div className="setup-check"><CircleCheck size={16} /> Your preferred tone and style</div>
                <div className="setup-check"><CircleCheck size={16} /> Any links you want included (portfolio, LinkedIn, etc.)</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="section section-alt">
        <div className="container">
          <div className="tag">How It Works</div>
          <h2>From Job Listing to Winning Proposal<br />in 4 Simple Steps</h2>
          <div className="steps-grid">
            {[
              { title: 'Open a Proposal', desc: 'Navigate to any Upwork job and click "Submit a Proposal." UpWrite activates automatically on the proposal page.' },
              { title: 'Click "Generate Proposal"', desc: 'Hit the UpWrite button that appears on the proposal form. It reads the job details and sends them to your AI workflow.' },
              { title: 'Fill Other Details & Wait', desc: 'Complete any remaining fields while the AI works. In seconds your cover letter and question answers are ready.' },
              { title: 'Done', desc: 'UpWrite populates every field automatically. Review, make any tweaks, and hit submit.' },
            ].map((step, i) => (
              <div className="step-card reveal" key={i}>
                <div className="step-num">{i + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AD SLOT — Rectangle */}
      <AdSlot type="rectangle" center />

      {/* FEATURES */}
      <section id="features" className="section">
        <div className="container">
          <div className="tag">Features</div>
          <h2>Everything You Need to Land More Clients</h2>
          <div className="features-grid">
            {[
              { icon: <FileText size={24} />, title: 'AI Cover Letters', desc: 'Every cover letter is generated fresh for each job — mentioning the client name, project specifics, and your relevant experience automatically.' },
              { icon: <HelpCircle size={24} />, title: 'Auto-Answer Questions', desc: 'Upwork job posts often include 1–5 follow-up questions. UpWrite reads each question and generates a precise, confident answer via your AI workflow.' },
              { icon: <Video size={24} />, title: 'Loom Video Integration', desc: 'Optionally record a short Loom introduction video. The extension captures the Loom URL and includes it in the data sent to your AI, for richer proposals.' },
              { icon: <Webhook size={24} />, title: 'Your Own n8n Webhook', desc: 'You control the AI. Paste your personal n8n webhook URL in the settings popup. No third-party server stores your data — everything stays in your stack.' },
              { icon: <MousePointerClick size={24} />, title: 'One-Click Auto-Fill', desc: 'The AI response is mapped directly into the Upwork form fields — cover letter, question answers, and more — with a single click.' },
              { icon: <ShieldCheck size={24} />, title: 'Open Source & Self-Hosted', desc: "The full source code is on GitHub. Clone it, audit it, fork it. Your job data and proposals go directly from your browser to your own n8n instance — no third-party server ever sees your data." },
            ].map((f, i) => (
              <div className="feature-card reveal" key={i}>
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DIY vs DFY */}
      <section className="section section-alt">
        <div className="container">
          <div className="tag" style={{ textAlign: 'center', display: 'block' }}>How to Get UpWrite</div>
          <h2 style={{ textAlign: 'center' }}>Two Ways to Use UpWrite</h2>
          <p style={{ textAlign: 'center', maxWidth: 540, margin: '0 auto 48px', color: 'var(--muted)' }}>
            Whether you want full control or a hands-off setup, there's an option for you.
          </p>
          <div className="diy-dfy-grid">
            <div className="diy-dfy-card reveal">
              <div className="diy-dfy-badge">DIY</div>
              <h3>Self-Hosted</h3>
              <p className="diy-dfy-sub">Free &amp; open source</p>
              <ul className="diy-dfy-list">
                <li><CircleCheck size={15} /> Clone the repo from GitHub</li>
                <li><CircleCheck size={15} /> Load the extension unpacked in Chrome</li>
                <li><CircleCheck size={15} /> Set up your own n8n instance (cloud or VPS)</li>
                <li><CircleCheck size={15} /> Import the workflow template and configure your AI</li>
                <li><CircleCheck size={15} /> Full control over prompts, models, and data</li>
              </ul>
              <a
                href="https://github.com/systemifyautomation"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{ marginTop: 'auto', justifyContent: 'center' }}
              >
                <ExternalLink size={15} /> View on GitHub
              </a>
            </div>
            <div className="diy-dfy-card diy-dfy-card--featured reveal">
              <div className="diy-dfy-badge diy-dfy-badge--green">DFY</div>
              <h3>Done For You</h3>
              <p className="diy-dfy-sub">Setup fee + monthly support</p>
              <ul className="diy-dfy-list">
                <li><CircleCheck size={15} /> I install and configure everything for you</li>
                <li><CircleCheck size={15} /> Dedicated n8n instance — fully hosted and managed</li>
                <li><CircleCheck size={15} /> AI workflow tuned to your profile and niche</li>
                <li><CircleCheck size={15} /> Ongoing maintenance, updates, and support</li>
                <li><CircleCheck size={15} /> No technical knowledge required</li>
              </ul>
              <button
                type="button"
                onClick={() => goToContact('dfy-section')}
                className="btn btn-primary"
                style={{ marginTop: 'auto', justifyContent: 'center' }}
              >
                <Mail size={15} /> Get Early Access
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="section">
        <div className="container">
          <div className="tag" style={{ textAlign: 'center', display: 'block' }}>Pricing</div>
          <h2 style={{ textAlign: 'center' }}>Simple, Transparent Pricing</h2>
          <p style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 48px', color: 'var(--muted)' }}>
            Start free and self-host, or let us handle everything end-to-end.
          </p>
          <div className="pricing-grid">

            {/* Tier 1 */}
            <div className="pricing-card reveal">
              <div className="pricing-icon"><ExternalLink size={22} /></div>
              <h3>Free Forever</h3>
              <div className="pricing-price">$0</div>
              <p className="pricing-desc">Self-hosted. Full source code on GitHub. You own everything.</p>
              <ul className="pricing-features">
                <li><CircleCheck size={14} /> Open-source extension</li>
                <li><CircleCheck size={14} /> Bring your own n8n instance</li>
                <li><CircleCheck size={14} /> Bring your own AI API key</li>
                <li><CircleCheck size={14} /> Full control over prompts &amp; data</li>
                <li><CircleCheck size={14} /> Community support via GitHub</li>
              </ul>
              <a
                href="https://github.com/systemifyautomation"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{ justifyContent: 'center', marginTop: 'auto' }}
              >
                View on GitHub
              </a>
            </div>

            {/* Tier 2 */}
            <div className="pricing-card reveal">
              <div className="pricing-icon"><Users size={22} /></div>
              <h3>Full Setup &amp; Handover</h3>
              <div className="pricing-price">$3,000 <span>one-time</span></div>
              <p className="pricing-desc">We set everything up and hand it over to you — plus access to our public Skool community.</p>
              <ul className="pricing-features">
                <li><CircleCheck size={14} /> Full installation &amp; configuration</li>
                <li><CircleCheck size={14} /> n8n workflow tuned to your profile</li>
                <li><CircleCheck size={14} /> AI prompts customized for your niche</li>
                <li><CircleCheck size={14} /> Complete handover with documentation</li>
                <li><CircleCheck size={14} /> Access to the public Skool community</li>
              </ul>
              <button
                type="button"
                onClick={() => goToContact('pricing-setup')}
                className="btn btn-outline"
                style={{ justifyContent: 'center', marginTop: 'auto' }}
              >
                <Mail size={14} /> Get in Touch
              </button>
            </div>

            {/* Tier 3 */}
            <div className="pricing-card pricing-card--featured reveal">
              <div className="pricing-label">Most Complete</div>
              <div className="pricing-icon pricing-icon--white"><Crown size={22} /></div>
              <h3>Full Service &amp; Mentorship</h3>
              <div className="pricing-price">Let's Talk</div>
              <p className="pricing-desc">Everything done for you, ongoing — plus access to an exclusive community and direct mentorship.</p>
              <ul className="pricing-features">
                <li><CircleCheck size={14} /> Everything in Full Setup</li>
                <li><CircleCheck size={14} /> Ongoing maintenance &amp; updates</li>
                <li><CircleCheck size={14} /> Upwork TOS compliance monitoring</li>
                <li><CircleCheck size={14} /> Projects we land — available to you first</li>
                <li><CircleCheck size={14} /> Selective private Skool community</li>
                <li><CircleCheck size={14} /> 1-on-1 calls: tips, guidance &amp; mentorship</li>
              </ul>
              <button
                type="button"
                onClick={() => goToContact('pricing-mentorship')}
                className="btn btn-primary"
                style={{ justifyContent: 'center', marginTop: 'auto' }}
              >
                <Mail size={14} /> Apply for Access
              </button>
            </div>

          </div>
        </div>
      </section>

      {/* FOUNDER */}
      <section id="founder" className="section section-alt">
        <div className="container">
          <div className="tag">Built by a Freelancer</div>
          <h2>Made for Upwork, by an Upwork Freelancer</h2>
          <div className="founder-card reveal">
            <div className="founder-avatar">YA</div>
            <div className="founder-info">
              <h3>Yassir Amhot</h3>
              <p>UpWrite was built and is actively used by Yassir Amhot — a freelancer on Upwork. The extension was created out of a real need to write better, more personalized proposals without spending 30 minutes on each one. Every feature reflects direct experience winning jobs on the platform.</p>
              <a
                href="https://upwork.com/freelancers/yassiram"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline"
                style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <ExternalLink size={15} /> View Upwork Profile
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* INSTALL */}
      <section id="install" className="section">
        <div className="container">
          <div className="tag" style={{ display: 'block', textAlign: 'center' }}>Installation</div>
          <h2 className="section-header" style={{ textAlign: 'center', marginTop: 0 }}>Get Up and Running in 5 Minutes</h2>
          <p className="section-sub">UpWrite is distributed as an unpacked Chrome extension — no Chrome Web Store needed.</p>
          <div className="install-steps reveal">
            <div className="install-step">
              <h3>Download the Extension</h3>
              <p>Click the button below to download the <code>.zip</code> file and unzip it to a folder on your computer.</p>
            </div>
            <div className="install-step">
              <h3>Open Chrome Extensions</h3>
              <p>In Chrome, navigate to <code>chrome://extensions</code> and enable <strong>Developer Mode</strong> using the toggle in the top-right corner.</p>
            </div>
            <div className="install-step">
              <h3>Load Unpacked</h3>
              <p>Click <strong>"Load unpacked"</strong> and select the unzipped <code>upwrite/</code> folder. The UpWrite icon will appear in your toolbar.</p>
            </div>
            <div className="install-step">
              <h3>Enter Your Webhook URL</h3>
              <p>Click the UpWrite toolbar icon, go to <strong>Settings</strong>, and paste your n8n webhook URL. Save — you're ready to go!</p>
            </div>
          </div>
          <div className="install-download-box reveal">
            <h3>Ready to Get Started?</h3>
            <p>The source code is freely available on GitHub. Need a managed setup? Get in touch.</p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="https://github.com/systemifyautomation" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ fontSize: '1.05rem', padding: '16px 36px' }}>
                <ExternalLink size={16} /> View on GitHub
              </a>
              <button type="button" onClick={() => goToContact('install-section')} className="btn btn-outline" style={{ fontSize: '1.05rem', padding: '16px 36px' }}>
                <Mail size={16} /> Get Managed Setup
              </button>
            </div>
            <p style={{ marginTop: '16px', fontSize: '.82rem', color: '#4a6080' }}>
              Requires Chrome 90+ · macOS, Windows, Linux
            </p>
          </div>
        </div>
      </section>

      {/* AD SLOT — Banner */}
      <AdSlot type="banner" center />

      {/* FAQ */}
      <section id="faq" className="section section-alt">
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="tag">FAQ</div>
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list" id="faq-list">
            {faqs.map((item, i) => (
              <div className={`faq-item${openFaq === i ? ' open' : ''}`} key={i}>
                <button className="faq-question" onClick={() => toggleFaq(i)}>
                  {item.q}
                  <span className="faq-icon">+</span>
                </button>
                <div className="faq-answer">
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="section">
        <div className="container">
          <div className="tag" style={{ display: 'block', textAlign: 'center' }}>Get in Touch</div>
          <h2 style={{ textAlign: 'center', marginTop: 0 }}>Get Early Access</h2>
          <p style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 48px', color: 'var(--muted)' }}>
            Leave your details and I'll get back to you to discuss setup and managed hosting.
          </p>
          <div className="contact-grid">
            <form className="contact-form reveal" onSubmit={handleContact}>
              <div className="form-group">
                <label htmlFor="c-name">Your Name</label>
                <input
                  id="c-name" type="text" placeholder="Jane Smith" required
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="c-email">Email Address</label>
                <input
                  id="c-email" type="email" placeholder="jane@example.com" required
                  value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="c-upwork">Upwork Profile URL</label>
                <input
                  id="c-upwork" type="url" placeholder="https://upwork.com/freelancers/yourprofile" required
                  value={form.upwork} onChange={e => setForm(f => ({ ...f, upwork: e.target.value }))}
                />
              </div>
              {formStatus === 'success' && (
                <p style={{ color: 'var(--green-dk)', fontWeight: 600, textAlign: 'center' }}>
                  Request sent! I'll be in touch soon.
                </p>
              )}
              {formStatus === 'error' && (
                <p style={{ color: '#dc2626', fontWeight: 600, textAlign: 'center' }}>
                  Something went wrong. Please try emailing directly.
                </p>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={formStatus === 'loading' || formStatus === 'success'}
              >
                <Send size={16} />
                {formStatus === 'loading' ? 'Sending…' : 'Get Early Access'}
              </button>
            </form>
            <div className="contact-aside reveal">
              <div className="contact-method">
                <MessageCircle size={22} />
                <div>
                  <strong>WhatsApp</strong>
                  <a href="https://wa.me/16467776492" target="_blank" rel="noopener noreferrer">+1 (646) 777-6492</a>
                </div>
              </div>
              <div className="contact-method">
                <Mail size={22} />
                <div>
                  <strong>Email</strong>
                  <a href="mailto:yassir@systemifyautomation.com">yassir@systemifyautomation.com</a>
                </div>
              </div>
              <div className="contact-method">
                <ExternalLink size={22} />
                <div>
                  <strong>Upwork</strong>
                  <a href="https://upwork.com/freelancers/yassiram" target="_blank" rel="noopener noreferrer">upwork.com/freelancers/yassiram</a>
                </div>
              </div>
              <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: 8 }}>
                UpWrite is a product of{' '}
                <a href="https://systemifyautomation.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green-dk)' }}>
                  Systemify Automation
                </a>
                . Setup and monthly n8n hosting are fully handled for you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AD SLOT — Leaderboard footer */}
      <AdSlot type="leaderboard" />

      {/* BLOG CTA */}
      <section className="section">
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="tag">From the Blog</div>
          <h2>Tips to Win More Upwork Jobs</h2>
          <p style={{ maxWidth: 520, margin: '16px auto 32px', color: 'var(--muted)' }}>
            Proposals, pricing, profile optimization, and AI tools — everything you need to grow your freelance business.
          </p>
          <Link to="/blog" className="btn btn-primary">Read the Blog <ChevronRight size={16} /></Link>
        </div>
      </section>
    </>
  );
}
