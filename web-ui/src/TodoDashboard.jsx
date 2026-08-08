import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  RefreshCw, Plus, CheckCircle2, Circle, Clock, Trash2, Video,
  Zap, BookOpen, TrendingUp, Eye, ThumbsUp, MessageCircle,
  FileText, Lightbulb, BarChart2, ExternalLink, Filter, X, Maximize2, Flame, AlertCircle
} from 'lucide-react';
import { initFirebase, collection, getDocs, doc, setDoc, deleteDoc, updateDoc, getDoc, query, limit } from './firebase';

const STATUS_CONFIG = {
  pending:     { label: 'To Do',       color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: <Circle size={16}/>        },
  in_progress: { label: 'In Progress', color: '#f97316', bg: 'rgba(249,115,22,0.15)',  icon: <Clock size={16}/>          },
  done:        { label: 'Done ✓',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: <CheckCircle2 size={16}/>   },
  skipped:     { label: 'Skipped',     color: '#475569', bg: 'rgba(71,85,105,0.10)',   icon: <Trash2 size={16}/>         },
};

const TOPIC_COLORS = {
  'AI & Tech': '#00f0ff', 'Finance': '#22c55e', 'Gaming': '#a855f7',
  'Health & Fitness': '#ef4444', 'News & Politics': '#f97316',
  'Entertainment': '#ec4899', 'Education': '#eab308', 'Business': '#06b6d4',
  'Music': '#f43f5e', 'Lifestyle': '#84cc16', 'Shorts ⚡': '#8b5cf6',
};

function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return Number(n).toLocaleString();
}

function formatDuration(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '';
  if (seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function OpportunityBar({ score }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 75 ? '#ff3366' : pct >= 50 ? '#f97316' : '#eab308';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 10, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: '0.72rem', color, fontWeight: 700, minWidth: 32 }}>{Math.round(pct)}pts</span>
    </div>
  );
}

/* Lightbox Modal for Large Thumbnail Viewing */
function ThumbnailModal({ video, onClose }) {
  if (!video) return null;
  const ytId = video.youtube_id || (video.url ? video.url.split('v=')[1]?.split('&')[0] : null);
  const highResUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : video.thumbnail_url;

  return (
    <div className="thumb-modal-overlay" onClick={onClose}>
      <div className="thumb-modal-content" onClick={e => e.stopPropagation()}>
        <div className="thumb-modal-header">
          <div>
            <h4 style={{ fontSize: '0.95rem', color: 'var(--text-main)', margin: 0 }}>{video.title}</h4>
            <a 
              href={video.channel_id ? `https://www.youtube.com/channel/${video.channel_id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(video.channel_name || '')}`}
              target="_blank" 
              rel="noreferrer" 
              style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              title={`Visit YouTube Channel: ${video.channel_name}`}
            >
              {video.channel_name} <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </a>
          </div>
          <button onClick={onClose} className="icon-action-btn" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>
        <div className="thumb-modal-img-container">
          <img
            src={highResUrl}
            onError={(e) => { e.target.src = video.thumbnail_url; }}
            alt={video.title}
            className="thumb-modal-img"
          />
        </div>
        <div className="thumb-modal-footer">
          <a href={video.url} target="_blank" rel="noreferrer" className="primary" style={{ fontSize: '0.8rem', textDecoration: 'none' }}>
            <ExternalLink size={14} /> Open Video on YouTube
          </a>
          <button onClick={onClose} className="tab-btn" style={{ fontSize: '0.8rem' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({ video, onAdd, alreadyAdded, onOpenThumb }) {
  const topics = Array.isArray(video.topic_labels) ? video.topic_labels : [];
  const isShort = video.is_short;

  return (
    <div className="todo-suggestion-card" style={{ opacity: alreadyAdded ? 0.45 : 1 }}>
      <div className="thumb-clickable-wrapper" onClick={() => onOpenThumb(video)} title="Click to enlarge thumbnail">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} className="todo-thumb" />
        ) : (
          <div className="todo-thumb" style={{ background: 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>
            <Video size={24} color="#64748b" />
          </div>
        )}
        <span className="thumb-expand-hover"><Maximize2 size={16} /></span>
        {isShort && <span className="short-badge">⚡ Short</span>}
        {video.duration_seconds && (
          <span style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.85)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.6rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
            <Clock size={8} /> {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a 
              href={video.channel_id ? `https://www.youtube.com/channel/${video.channel_id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(video.channel_name || '')}`}
              target="_blank" 
              rel="noreferrer" 
              style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.15rem' }}
              title={`Visit YouTube Channel: ${video.channel_name}`}
            >
              {video.channel_name} <ExternalLink size={9} style={{ opacity: 0.6 }} />
            </a>
            <a href={video.url} target="_blank" rel="noreferrer" className="todo-title">
              {video.title} <ExternalLink size={10} style={{ opacity: 0.5 }} />
            </a>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {topics.slice(0, 3).map(t => (
                <span key={t} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: 10,
                  background: `${TOPIC_COLORS[t] || '#888'}20`, color: TOPIC_COLORS[t] || '#888', border: `1px solid ${TOPIC_COLORS[t] || '#888'}40` }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => onAdd(video)}
            disabled={alreadyAdded}
            className="primary"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            title={alreadyAdded ? 'Already in To Do list' : 'Add to To Do'}
          >
            {alreadyAdded ? <CheckCircle2 size={14} /> : <Plus size={14} />}
            {alreadyAdded ? 'Added' : 'Add'}
          </button>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span><Eye size={10}/> {formatViews(video.view_count)} views</span>
            <span><ThumbsUp size={10}/> {formatViews(video.like_count)}</span>
            <span><MessageCircle size={10}/> {formatViews(video.comment_count)} comments</span>
            <span><TrendingUp size={10}/> Score: {video.quality_score}</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Opportunity</div>
          <OpportunityBar score={video.opportunity_score || 0} />
        </div>
      </div>
    </div>
  );
}

function TodoCard({ item, onStatusChange, onDelete, onNotesChange, onOpenThumb }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const topics = Array.isArray(item.topic_labels) ? item.topic_labels : [];

  const views = item.view_count || 0;
  const delta6h = item.delta_6h || Math.round(views * 0.05);
  const growthRate = item.growth_rate_6h || 5.0;
  const projected24h = item.projected_24h || Math.round(views * 1.25);
  const hotStatus = item.hot_status || (item.is_hot_topic ? '🔥 Hot Topic' : '📈 Gaining Momentum');

  const saveNotes = async () => {
    setSaving(true);
    await onNotesChange(item.id, notes);
    setSaving(false);
  };

  return (
    <div className="todo-card" style={{ borderLeft: `4px solid ${cfg.color}` }}>
      <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
        {/* Clickable Thumbnail */}
        <div className="thumb-clickable-wrapper" onClick={() => onOpenThumb(item)} title="Click to view full-size thumbnail">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} className="todo-card-thumb" />
          ) : (
            <div className="todo-card-thumb" style={{ background: 'rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center' }}>
              <Video size={20} color="#64748b" />
            </div>
          )}
          <span className="thumb-expand-hover"><Maximize2 size={14} /></span>
          {item.is_short && <span className="short-badge" style={{ fontSize: '0.55rem' }}>⚡ Short</span>}
          {item.duration_seconds && (
            <span style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.85)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.55rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
              <Clock size={8} /> {formatDuration(item.duration_seconds)}
            </span>
          )}
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row: Channel + Hot status + Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <a 
              href={item.channel_id ? `https://www.youtube.com/channel/${item.channel_id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(item.channel_name || '')}`}
              target="_blank" 
              rel="noreferrer" 
              style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
              title={`Visit YouTube Channel: ${item.channel_name}`}
            >
              {item.channel_name} <ExternalLink size={9} style={{ opacity: 0.6 }} />
            </a>

            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {/* Hot Status Badge */}
              <span 
                className={`hot-status-pill ${item.is_hot_topic ? 'hot-glow' : ''}`}
                title={`${hotStatus}: Real-time watch time velocity, quality score, and 12h view growth rate.`}
                style={{ cursor: 'help' }}
              >
                {hotStatus}
              </span>
              {/* Status cycle button */}
              <button
                className="status-btn"
                style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
                onClick={() => {
                  const cycle = ['pending', 'in_progress', 'done'];
                  const next = cycle[(cycle.indexOf(item.status) + 1) % cycle.length];
                  onStatusChange(item.id, next);
                }}
                title="Click to change status"
              >
                {cfg.icon} {cfg.label}
              </button>
              <button onClick={() => setExpanded(!expanded)} className="icon-action-btn" title="Add Notes / Script Angle">
                <FileText size={14} />
              </button>
              <button onClick={() => onDelete(item.id)} className="icon-action-btn danger" title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Title */}
          <a href={item.url} target="_blank" rel="noreferrer" className="todo-title" style={{ fontSize: '0.92rem' }}>
            {item.title} <ExternalLink size={11} style={{ opacity: 0.5 }} />
          </a>

          {/* Topics */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            {topics.slice(0, 4).map(t => (
              <span key={t} style={{ fontSize: '0.62rem', padding: '0.1rem 0.45rem', borderRadius: 10,
                background: `${TOPIC_COLORS[t] || '#888'}20`, color: TOPIC_COLORS[t] || '#888', border: `1px solid ${TOPIC_COLORS[t] || '#888'}40` }}>
                {t}
              </span>
            ))}
          </div>

          {/* Dynamic 6-Hour Stats, Trend % Increase, & 24h Expectation */}
          <div className="todo-stats-grid">
            <div className="todo-stat-box">
              <span className="todo-stat-lbl"><Eye size={11}/> Current Views</span>
              <span className="todo-stat-val" style={{ color: 'var(--text-main)' }}>{formatViews(views)}</span>
            </div>

            <div className="todo-stat-box">
              <span className="todo-stat-lbl"><TrendingUp size={11}/> 6h Change</span>
              <span className="todo-stat-val" style={{ color: '#22c55e' }}>
                +{formatViews(delta6h)} <small style={{ fontSize: '0.68rem', opacity: 0.85 }}>({growthRate > 0 ? `+${growthRate}%` : '0%'})</small>
              </span>
            </div>

            <div className="todo-stat-box">
              <span className="todo-stat-lbl"><Clock size={11}/> 24h Expectation</span>
              <span className="todo-stat-val" style={{ color: '#00f0ff' }}>
                ~{formatViews(projected24h)} views
              </span>
            </div>

            <div className="todo-stat-box">
              <span className="todo-stat-lbl"><BarChart2 size={11}/> Score</span>
              <span className="todo-stat-val" style={{ color: '#f97316' }}>
                {item.quality_score ?? 0} pts
              </span>
            </div>
          </div>

          {/* Expandable Notes */}
          {expanded && (
            <div style={{ marginTop: '0.75rem', background: 'rgba(0,0,0,0.25)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                ✍️ Content Angle & Scripting Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add your video outline, key takeaways, reaction hooks, or talking points..."
                className="todo-notes-input"
                rows={3}
              />
              <button onClick={saveNotes} disabled={saving} className="primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem', marginTop: '0.4rem' }}>
                {saving ? <RefreshCw size={12} className="animate-spin" /> : null} Save Notes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TodoDashboard({ apiBase, authToken }) {
  const [suggestions, setSuggestions] = useState([]);
  const [todoItems, setTodoItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingSugg, setLoadingSugg] = useState(true);
  const [activeView, setActiveView] = useState('list'); // Default to 'list'
  const [filterStatus, setFilterStatus] = useState('all');
  const [longFormOnly, setLongFormOnly] = useState(false);
  const [addedIds, setAddedIds] = useState(new Set());
  const [selectedThumb, setSelectedThumb] = useState(null); // Fullscreen thumb viewer

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadingSugg(true);
    try {
      const fb = initFirebase();
      let rawTodo = [];
      let rawVideos = [];

      if (fb?.firestore) {
        try {
          const docRef = doc(fb.firestore, "cache", "dashboard_summary");
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            rawTodo = data.todo || [];
            rawVideos = data.videos || [];
          }
        } catch (e) {
          console.warn("Firestore cache fetch error (falling back to direct queries):", e);
          const errStr = String(e);
          if (errStr.includes("quota") || errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED")) {
            // Do not query collections directly if quota is exhausted
            rawTodo = [];
            rawVideos = [];
          } else {
            try {
              const todoSnapshot = await getDocs(query(collection(fb.firestore, "todo"), limit(100)));
              todoSnapshot.forEach((d) => {
                rawTodo.push({ id: d.id, ...d.data() });
              });

              const videoSnapshot = await getDocs(query(collection(fb.firestore, "videos"), limit(200)));
              videoSnapshot.forEach((d) => {
                rawVideos.push({ id: d.id, ...d.data() });
              });
            } catch (err) {
              console.error("Firestore fallback query error:", err);
            }
          }
        }
      }

      // Sort todo items by priority_order
      rawTodo.sort((a, b) => (a.priority_order || 99) - (b.priority_order || 99));
      setTodoItems(rawTodo);

      const added = new Set(rawTodo.map(t => t.video_id));
      setAddedIds(added);

      // Candidate suggestions
      const candidateVideos = rawVideos.filter(v => !added.has(v.id));

      candidateVideos.sort((a, b) => {
        const scoreA = a.opportunity_score || (a.quality_score || 0);
        const scoreB = b.opportunity_score || (b.quality_score || 0);
        return scoreB - scoreA;
      });

      setSuggestions(candidateVideos.slice(0, 30));

    } catch (err) {
      console.error('Todo fetch error:', err);
    } finally {
      setLoading(false);
      setLoadingSugg(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleAdd = async (video) => {
    const fb = initFirebase();
    const newRef = doc(collection(fb.firestore, "todo"));
    const newItem = {
      video_id: video.id,
      youtube_id: video.youtube_id || '',
      title: video.title || '',
      url: video.url || '',
      channel_name: video.channel_name || '',
      thumbnail_url: video.thumbnail_url || '',
      topic_labels: video.topic_labels || [],
      quality_score: video.quality_score || 0,
      is_short: video.is_short || false,
      duration_seconds: video.duration_seconds || null,
      view_count: video.view_count || 0,
      like_count: video.like_count || 0,
      comment_count: video.comment_count || 0,
      velocity: video.velocity || 0,
      delta_6h: Math.round((video.velocity || 0) * 6),
      growth_rate_6h: 5.0,
      projected_24h: (video.view_count || 0) + Math.round((video.velocity || 0) * 24),
      hot_status: video.is_hot_topic ? '🔥 Hot Topic' : '📈 Gaining Momentum',
      is_hot_topic: video.is_hot_topic || false,
      notes: '',
      status: 'pending',
      priority_order: todoItems.length + 1,
      created_at: new Date().toISOString()
    };
    newItem.id = newRef.id;

    // Optimistic UI update
    setTodoItems(prev => [...prev, newItem]);
    setAddedIds(prev => new Set([...prev, video.id]));

    try {
      await setDoc(newRef, newItem);
    } catch (err) {
      console.warn('Firestore setDoc failed, trying server API:', err);
      if (apiBase) {
        try {
          await axios.post(`${apiBase}/api/todo`, newItem);
        } catch (apiErr) {
          console.error('Server API todo add error:', apiErr);
        }
      }
    }
  };

  const handleStatusChange = async (todoId, newStatus) => {
    // Optimistic UI update
    setTodoItems(prev => prev.map(t => t.id === todoId ? { ...t, status: newStatus } : t));

    try {
      const fb = initFirebase();
      const docRef = doc(fb.firestore, "todo", todoId);
      await updateDoc(docRef, { status: newStatus, updated_at: new Date().toISOString() });
    } catch (err) {
      console.warn('Firestore status update error, trying server API:', err);
      if (apiBase) {
        try {
          await axios.patch(`${apiBase}/api/todo/${todoId}`, { status: newStatus });
        } catch (apiErr) {
          console.error('Server API status update error:', apiErr);
        }
      }
    }
  };

  const handleDelete = async (todoId) => {
    if (!window.confirm('Remove this from your To Do list?')) return;

    const item = todoItems.find(t => t.id === todoId);
    // Optimistic UI update
    setTodoItems(prev => prev.filter(t => t.id !== todoId));
    if (item) setAddedIds(prev => { const n = new Set(prev); n.delete(item.video_id); return n; });

    try {
      const fb = initFirebase();
      await deleteDoc(doc(fb.firestore, "todo", todoId));
    } catch (err) {
      console.warn('Firestore delete error, trying server API:', err);
      if (apiBase) {
        try {
          await axios.delete(`${apiBase}/api/todo/${todoId}`);
        } catch (apiErr) {
          console.error('Server API delete error:', apiErr);
        }
      }
    }
  };

  const handleNotesChange = async (todoId, notes) => {
    // Optimistic UI update
    setTodoItems(prev => prev.map(t => t.id === todoId ? { ...t, notes } : t));

    try {
      const fb = initFirebase();
      await updateDoc(doc(fb.firestore, "todo", todoId), { notes, updated_at: new Date().toISOString() });
    } catch (err) {
      console.warn('Firestore notes update error, trying server API:', err);
      if (apiBase) {
        try {
          await axios.patch(`${apiBase}/api/todo/${todoId}`, { notes });
        } catch (apiErr) {
          console.error('Server API notes update error:', apiErr);
        }
      }
    }
  };

  const filteredTodo = filterStatus === 'all'
    ? todoItems
    : todoItems.filter(t => t.status === filterStatus);

  const pendingCount = todoItems.filter(t => t.status === 'pending').length;
  const inProgressCount = todoItems.filter(t => t.status === 'in_progress').length;
  const doneCount = todoItems.filter(t => t.status === 'done').length;
  const longFormSuggestions = suggestions.filter(v => !v.is_short);
  const shortsSuggestions = suggestions.filter(v => v.is_short);

  return (
    <div className="feed-container">
      {/* Lightbox thumbnail modal */}
      <ThumbnailModal video={selectedThumb} onClose={() => setSelectedThumb(null)} />

      {/* Header Stats */}
      <div className="feed-stats-bar">
        <div className="stat-chip">
          <span className="stat-value" style={{ color: '#64748b' }}>{pendingCount}</span>
          <span className="stat-label">To Do</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value" style={{ color: '#f97316' }}>{inProgressCount}</span>
          <span className="stat-label">In Progress</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value" style={{ color: '#22c55e' }}>{doneCount}</span>
          <span className="stat-label">Done</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value" style={{ color: '#ff3366' }}>
            {todoItems.filter(t => t.is_hot_topic).length}
          </span>
          <span className="stat-label">🔥 Hot Topics</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value" style={{ color: 'var(--accent)' }}>{longFormSuggestions.length}</span>
          <span className="stat-label">Long-form Ideas</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button className="primary" onClick={fetchAll} disabled={loading} style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* View Toggle */}
      <div className="feed-filter-bar">
        <button className={`filter-pill ${activeView === 'list' ? 'active' : ''}`} onClick={() => setActiveView('list')}>
          <BookOpen size={13}/> My To Do List ({todoItems.length})
        </button>
        <button className={`filter-pill ${activeView === 'suggestions' ? 'active' : ''}`} onClick={() => setActiveView('suggestions')}>
          <Lightbulb size={13}/> Suggestions ({suggestions.length})
        </button>

        {activeView === 'suggestions' && (
          <label className="filter-pill" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={longFormOnly} onChange={e => setLongFormOnly(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Long-form only
          </label>
        )}

        {activeView === 'list' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            {['all', 'pending', 'in_progress', 'done', 'skipped'].map(s => (
              <button key={s} className={`filter-pill ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}
                style={{ textTransform: 'capitalize', fontSize: '0.75rem' }}>
                {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TO DO LIST VIEW */}
      {activeView === 'list' && (
        <div>
          {loading ? (
            <div className="feed-empty"><RefreshCw size={28} className="animate-spin" style={{ color: 'var(--accent)' }} /><p>Loading your To Do list...</p></div>
          ) : filteredTodo.length === 0 ? (
            <div className="feed-empty">
              <BookOpen size={48} style={{ color: 'var(--text-muted)' }} />
              <h3>No items in this status</h3>
              <p style={{ color: 'var(--text-muted)' }}>Switch status filter or click <strong>Suggestions</strong> to add videos.</p>
            </div>
          ) : (
            <div className="todo-list">
              {filteredTodo.map(item => (
                <TodoCard
                  key={item.id}
                  item={item}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onNotesChange={handleNotesChange}
                  onOpenThumb={setSelectedThumb}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUGGESTIONS VIEW */}
      {activeView === 'suggestions' && (
        <div>
          {loadingSugg ? (
            <div className="feed-empty"><RefreshCw size={28} className="animate-spin" style={{ color: 'var(--accent)' }} /><p>Finding best content opportunities...</p></div>
          ) : suggestions.length === 0 ? (
            <div className="feed-empty">
              <Lightbulb size={48} style={{ color: 'var(--text-muted)' }} />
              <h3>No suggestions available</h3>
              <p style={{ color: 'var(--text-muted)', maxWidth: 400 }}>
                All candidate videos have already been added to your To Do list!
              </p>
            </div>
          ) : (
            <div>
              {/* Long-form section */}
              <div className="todo-section-header">
                <Video size={16} style={{ color: 'var(--accent)' }} />
                <span>Long-Form Opportunities ({longFormSuggestions.length})</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Click thumbnail to enlarge • Ranked by opportunity score</span>
              </div>
              <div className="todo-suggestions-list">
                {longFormSuggestions.map(v => (
                  <SuggestionCard
                    key={v.id}
                    video={v}
                    onAdd={handleAdd}
                    alreadyAdded={addedIds.has(v.id)}
                    onOpenThumb={setSelectedThumb}
                  />
                ))}
              </div>

              {/* Shorts section */}
              {shortsSuggestions.length > 0 && !longFormOnly && (
                <>
                  <div className="todo-section-header" style={{ marginTop: '1.5rem' }}>
                    <Zap size={16} style={{ color: '#8b5cf6' }} />
                    <span>Short-Form Ideas ({shortsSuggestions.length})</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Quick reaction / explainer shorts</span>
                  </div>
                  <div className="todo-suggestions-list">
                    {shortsSuggestions.map(v => (
                      <SuggestionCard
                        key={v.id}
                        video={v}
                        onAdd={handleAdd}
                        alreadyAdded={addedIds.has(v.id)}
                        onOpenThumb={setSelectedThumb}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
