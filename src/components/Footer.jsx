import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="logo">Up<span>Write</span></Link>
            <p>AI-powered Upwork proposals for freelancers who want to apply smarter and win more clients.</p>
            <p style={{ marginTop: 12, fontSize: '.82rem', color: '#8898b0' }}>
              A product of{' '}
              <a
                href="https://systemifyautomation.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#6ee56e' }}
              >
                Systemify Automation
              </a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="/#how-it-works">How It Works</a></li>
              <li><a href="/#features">Features</a></li>
              <li><Link to="/install">Installation</Link></li>
              <li><Link to="/changelog">Changelog</Link></li>
            </ul>
          </div>
          <div>
            <h4>Resources</h4>
            <ul>
              <li><Link to="/blog">Blog</Link></li>
              <li><Link to="/faq">FAQ</Link></li>
              <li><a href="https://github.com/systemifyautomation" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} UpWrite by <a href="https://systemifyautomation.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Systemify Automation</a>. All rights reserved.</span>
          <span>Not affiliated with Upwork Inc.</span>
        </div>
      </div>
    </footer>
  );
}
