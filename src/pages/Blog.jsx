import { Link } from 'react-router-dom';
import { CalendarDays, Clock, ChevronRight, FileText, Target, UserCircle, Bot, TrendingUp, Star, DollarSign, Zap, Wrench } from 'lucide-react';
import { blogPosts } from '../data/blogPosts';
import AdSlot from '../components/AdSlot';

const categoryConfig = {
  'Proposals': { icon: FileText,   bg: 'linear-gradient(135deg, #14532d 0%, #166534 100%)', color: '#86efac' },
  'Tutorial':  { icon: Wrench,     bg: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)', color: '#93c5fd' },
  'Strategy':  { icon: Target,     bg: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 100%)', color: '#fdba74' },
  'Trends':    { icon: TrendingUp, bg: 'linear-gradient(135deg, #4a1d96 0%, #7c3aed 100%)', color: '#c4b5fd' },
  'Profile':   { icon: UserCircle, bg: 'linear-gradient(135deg, #134e4a 0%, #0f766e 100%)', color: '#5eead4' },
  'Beginners': { icon: Star,       bg: 'linear-gradient(135deg, #78350f 0%, #d97706 100%)', color: '#fcd34d' },
  'AI Tools':  { icon: Bot,        bg: 'linear-gradient(135deg, #312e81 0%, #4338ca 100%)', color: '#a5b4fc' },
  'Income':    { icon: DollarSign, bg: 'linear-gradient(135deg, #14532d 0%, #059669 100%)', color: '#6ee7b7' },
  'Career':    { icon: Zap,        bg: 'linear-gradient(135deg, #881337 0%, #be123c 100%)', color: '#fda4af' },
};
const defaultConfig = { icon: FileText, bg: 'linear-gradient(135deg, var(--navy) 0%, #0f2040 100%)', color: '#94a3b8' };

export default function Blog() {
  return (
    <>
      <div className="page-hero">
        <div className="container">
          <div className="tag">Blog</div>
          <h1>Upwork Tips &amp; AI Freelancing Insights</h1>
          <p>Practical advice on writing better proposals, optimizing your profile, and using AI to win more clients on Upwork.</p>
        </div>
      </div>

      <div className="container section">
        <div className="blog-grid">
          {blogPosts.map(post => {
            const cfg = categoryConfig[post.category] || defaultConfig;
            const IconComp = cfg.icon;
            return (
            <article className="blog-card" key={post.id}>
              <div className="blog-card-thumb" style={{ background: cfg.bg }}>
                <IconComp size={48} color={cfg.color} strokeWidth={1.5} />
              </div>
              <div className="blog-card-body">
                <span className="blog-category-badge">{post.category}</span>
                <h3>{post.title}</h3>
                <p>{post.excerpt}</p>
                <div className="blog-meta">
                  <span><CalendarDays size={13} /> {post.date}</span>
                  <span><Clock size={13} /> {post.readTime}</span>
                </div>
                <Link to={`/blog/${post.slug}`} className="blog-read-more">
                  Read article <ChevronRight size={14} />
                </Link>
              </div>
            </article>
            );
          })}
        </div>
      </div>

      <AdSlot type="leaderboard" />
    </>
  );
}
