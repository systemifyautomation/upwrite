import { useParams, Link } from 'react-router-dom';
import { Lightbulb, CalendarDays, Clock } from 'lucide-react';
import { blogPosts } from '../data/blogPosts';
import AdSlot from '../components/AdSlot';

function renderBlock(block, i) {
  switch (block.type) {
    case 'p':
      return <p key={i}>{block.text}</p>;
    case 'h2':
      return <h2 key={i}>{block.text}</h2>;
    case 'h3':
      return <h3 key={i}>{block.text}</h3>;
    case 'ul':
      return (
        <ul key={i}>
          {block.items.map((item, j) => <li key={j}>{item}</li>)}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i}>
          {block.items.map((item, j) => <li key={j}>{item}</li>)}
        </ol>
      );
    case 'tip':
      return (
        <div key={i} className="callout callout-tip">
          <p><Lightbulb size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} /><strong>Tip:</strong> {block.text}</p>
        </div>
      );
    default:
      return null;
  }
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = blogPosts.find(p => p.slug === slug);

  if (!post) {
    return (
      <div className="not-found">
        <h1>404</h1>
        <h2>Post not found</h2>
        <p>The blog post you're looking for doesn't exist.</p>
        <Link to="/blog" className="btn btn-primary">← Back to Blog</Link>
      </div>
    );
  }

  // Find prev/next posts
  const idx = blogPosts.indexOf(post);
  const prev = blogPosts[idx + 1] || null;
  const next = blogPosts[idx - 1] || null;

  return (
    <>
      <div className="post-layout">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/blog">Blog</Link>
          <span>/</span>
          <span>{post.title}</span>
        </nav>

        {/* Post header */}
        <header className="post-header">
          <div className="post-meta">
            <span className="category-badge">{post.category}</span>
            <span><CalendarDays size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{post.date}</span>
            <span><Clock size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{post.readTime}</span>
          </div>
          <h1>{post.title}</h1>
          <p style={{ fontSize: '1.1rem', color: 'var(--mid)', marginBottom: 0 }}>{post.excerpt}</p>
        </header>

        <hr className="post-divider" />

        {/* Post content */}
        <div className="post-content">
          {post.content.map((block, i) => renderBlock(block, i))}
        </div>

        {/* Post footer nav */}
        <div className="post-footer">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            {prev ? (
              <Link to={`/blog/${prev.slug}`} style={{ color: 'var(--green)', fontWeight: 700 }}>
                ← {prev.title}
              </Link>
            ) : <span />}
            {next && (
              <Link to={`/blog/${next.slug}`} style={{ color: 'var(--green)', fontWeight: 700 }}>
                {next.title} →
              </Link>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <Link to="/blog" className="btn btn-outline">← All Articles</Link>
          </div>
        </div>
      </div>

      <AdSlot type="leaderboard" />
    </>
  );
}
