import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header>
      <nav className="container">
        <Link to="/" className="logo">Up<span>Write</span></Link>
        <ul>
          <li><a href="/#how-it-works">How It Works</a></li>
          <li><a href="/#features">Features</a></li>
          <li><a href="/#install">Install</a></li>
          <li><a href="/#faq">FAQ</a></li>
          <li><Link to="/blog">Blog</Link></li>
        </ul>
        <div className="nav-cta">
          <a href="/#contact" className="btn btn-primary btn-sm">
            <Mail size={14} /> Get in Touch
          </a>
          <button
            className="hamburger"
            aria-label="Toggle menu"
            onClick={() => setMobileOpen(o => !o)}
          >
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>
      <nav className={`mobile-nav${mobileOpen ? ' open' : ''}`}>
        <a href="/#how-it-works" onClick={() => setMobileOpen(false)}>How It Works</a>
        <a href="/#features" onClick={() => setMobileOpen(false)}>Features</a>
        <a href="/#install" onClick={() => setMobileOpen(false)}>Install</a>
        <a href="/#faq" onClick={() => setMobileOpen(false)}>FAQ</a>
        <Link to="/blog" onClick={() => setMobileOpen(false)}>Blog</Link>
      </nav>
    </header>
  );
}
