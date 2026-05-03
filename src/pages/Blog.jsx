import { Link } from 'react-router-dom';
import { CalendarDays, Clock, ChevronRight } from 'lucide-react';
import { blogPosts } from '../data/blogPosts';
import AdSlot from '../components/AdSlot';

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
          {blogPosts.map(post => (
            <article className="blog-card" key={post.id}>
              <div className="blog-card-thumb">
                <span className="blog-thumb-icon">{post.thumbIcon}</span>
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
          ))}
        </div>
      </div>

      <AdSlot type="leaderboard" />
    </>
  );
}
