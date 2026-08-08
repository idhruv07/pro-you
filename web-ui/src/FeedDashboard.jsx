import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { RefreshCw, Flame, TrendingUp, Lightbulb, Tv, Filter, BarChart2, Clock, Eye, ThumbsUp, MessageCircle, Zap, Play, ExternalLink, UserMinus, Calendar, CheckCircle2, XCircle, AlertTriangle, Trash2, CheckSquare, Square, Maximize2, Search, Sparkles } from 'lucide-react';
import { initFirebase, collection, getDocs, deleteDoc, doc, query, where, getDoc, limit, setDoc } from './firebase';
import { deleteVideosBulk, filterDeletedVideos, getYoutubeId } from './utils/VideoDeleter';

const MOMENTUM_CONFIG = {
  '🚀 Viral Surge':            { color: '#ff3366', bg: 'rgba(255,51,102,0.2)', icon: <Flame size={12}/>, glow: '0 0 12px rgba(255,51,102,0.5)', hint: '⚡ Viral Surge: Accumulating >500 views/hr at extraordinary velocity.' },
  '🔥 Must Watch':            { color: '#ff3366', bg: 'rgba(255,51,102,0.15)', icon: <Flame size={12}/>, glow: '0 0 12px rgba(255,51,102,0.5)', hint: '🔥 Must Watch: High viral score and rapid viewer growth.' },
  '🔥 High Growth':           { color: '#f97316', bg: 'rgba(249,115,22,0.18)', icon: <TrendingUp size={12}/>, glow: '0 0 10px rgba(249,115,22,0.4)', hint: '🔥 High Growth: >15% view gain over 12 hours.' },
  '📈 Hot Right Now':         { color: '#f97316', bg: 'rgba(249,115,22,0.15)', icon: <TrendingUp size={12}/>, glow: '0 0 12px rgba(249,115,22,0.4)', hint: '📈 Hot Right Now: Rapidly rising view acceleration.' },
  '📈 Gaining Momentum':       { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: <TrendingUp size={12}/>, glow: 'none', hint: '📈 Gaining Momentum: Steady 5-15% view gain over 12 hours.' },
  '💎 High Quality Evergreen':{ color: '#a855f7', bg: 'rgba(168,85,247,0.15)', icon: <Sparkles size={12}/>, glow: '0 0 10px rgba(168,85,247,0.3)', hint: '💎 High Quality Evergreen: Quality score >=70 pts with consistent viewer retention.' },
  '💡 Steady Pace':           { color: '#eab308', bg: 'rgba(234,179,8,0.15)', icon: <Lightbulb size={12}/>, glow: 'none', hint: '💡 Steady Pace: Consistent view accumulation (10-100 v/hr) without sudden viral spikes.' },
  '💡 Steady Interest':       { color: '#eab308', bg: 'rgba(234,179,8,0.15)', icon: <Lightbulb size={12}/>, glow: 'none', hint: '💡 Steady Interest: Organic, baseline viewer demand with steady ongoing watch time.' },
  '🌱 Baseline Interest':     { color: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: <CheckCircle2 size={12}/>, glow: 'none', hint: '🌱 Baseline Interest: Stable subscriber viewing (<10 v/hr).' },
  '🆕 Just Posted':           { color: '#22c55e', bg: 'rgba(34,197,94,0.15)', icon: <Zap size={12}/>, glow: 'none', hint: '🆕 Just Posted: Published in the last 24 hours.' },
  '📺 Normal':                { color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: <Tv size={12}/>, glow: 'none', hint: '📺 Normal: Standard ongoing viewing rate.' },
};

const TOPIC_COLORS = {
  'AI & Tech': '#00f0ff', 'Finance': '#22c55e', 'Gaming': '#a855f7',
  'Health & Fitness': '#ef4444', 'News & Politics': '#f97316', 'Entertainment': '#ec4899',
  'Education': '#eab308', 'Business': '#06b6d4', 'Music': '#f43f5e',
  'Lifestyle': '#84cc16', 'Shorts ⚡': '#8b5cf6',
};

export function parseVideoDate(val) {
  if (!val) return new Date(0);
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  if (typeof val === 'number') return new Date(val);
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function timeAgo(dateVal) {
  if (!dateVal) return '';
  const d = parseVideoDate(dateVal);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

export function getLocalDateString(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeStatsFromVideos(videoList = []) {
  if (!Array.isArray(videoList) || videoList.length === 0) {
    return { total_videos: 0, viral_surge: 0, hot_count: 0, high_growth: 0, new_today: 0, active_channels: 0, evergreen_count: 0 };
  }

  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let viralSurge = 0;
  let hotCount = 0;
  let highGrowth = 0;
  let newToday = 0;
  let evergreenCount = 0;
  const channelSet = new Set();

  videoList.forEach(v => {
    if (v.channel_id || v.channel_name) {
      channelSet.add(v.channel_id || v.channel_name);
    }
    
    const vel = v.velocity || 0;
    const qScore = v.quality_score || 0;
    const mLabel = v.momentum_label || '';

    // 🚀 1. Viral Surge (Strict top tier: >500 v/hr or explicit viral label)
    if (vel >= 500 || mLabel.includes('Viral Surge') || v.is_hot_topic) {
      viralSurge++;
    }

    // 🔥 2. Must Watch (High momentum: 150-500 v/hr or High Growth label)
    if (vel >= 150 || mLabel.includes('High Growth')) {
      hotCount++;
    }

    // 📈 3. Gaining Momentum (50-150 v/hr)
    if (vel >= 50 && vel < 150) {
      highGrowth++;
    }

    // 💎 4. Evergreen (Top retention quality >= 85 pts)
    if (qScore >= 85) {
      evergreenCount++;
    }

    const created = parseVideoDate(v.published_at || v.created_at);
    if (created && created >= cutoff24h) {
      newToday++;
    }
  });

  return {
    total_videos: videoList.length,
    viral_surge: viralSurge,
    hot_count: hotCount,
    high_growth: highGrowth,
    new_today: newToday,
    active_channels: channelSet.size,
    evergreen_count: evergreenCount
  };
}

function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return String(n);
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

function VideoCard({ video, onSelectVideo, cfg: propCfg, momentum: propMomentum, isSelected, onToggleSelect, onUnsubscribeChannel }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const momentum = propMomentum || video.momentum_label || '📺 Normal';
  const cfg = propCfg || MOMENTUM_CONFIG[momentum] || MOMENTUM_CONFIG['📺 Normal'] || { glow: 'none', color: '#888', icon: '📺' };
  const isShort = video.duration_seconds && video.duration_seconds < 90;
  const channelUrl = video.channel_id ? `https://www.youtube.com/channel/${video.channel_id}` : '#';
  const topics = video.topic_labels || [];
  const subTopics = video.sub_topics || [];
  const velocity = video.velocity || 0;
  const ytId = getYoutubeId(video) || video.youtube_id || video.id;
  const watchUrl = video.url || (ytId ? `https://www.youtube.com/watch?v=${ytId}` : '#');

  return (
    <div className="card" style={{ 
      boxShadow: (cfg && cfg.glow && cfg.glow !== 'none') ? cfg.glow : undefined,
      border: isSelected ? '1px solid var(--accent, #a855f7)' : undefined,
      background: isSelected ? 'rgba(168, 85, 247, 0.05)' : undefined
    }}>
      {/* Thumbnail or Inline YouTube Player */}
      <div 
        className="thumbnail-container" 
        style={{ cursor: 'pointer', position: 'relative', minHeight: '180px', background: '#000', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}
      >
        {/* Visible Checkbox Overlay on Thumbnail */}
        <div 
          onClick={(e) => {
            e.stopPropagation();
            if (onToggleSelect) onToggleSelect(video);
          }}
          style={{
            position: 'absolute', top: '0.4rem', left: '0.4rem', zIndex: 35,
            background: 'rgba(0,0,0,0.85)', padding: '0.25rem', borderRadius: '5px',
            display: 'flex', alignItems: 'center', cursor: 'pointer',
            border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.3)'
          }}
          title="Select for bulk deletion"
        >
          <input
            type="checkbox"
            checked={!!isSelected}
            readOnly
            style={{ width: '15px', height: '15px', accentColor: '#a855f7', margin: 0, pointerEvents: 'none' }}
          />
        </div>

        {isPlaying ? (
          <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '180px' }}>
            {ytId ? (
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&enablejsapi=1`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                allowFullScreen
                style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, border: 'none', zIndex: 25 }}
              />
            ) : (
              <div style={{ padding: '2rem 1rem', textDecoration: 'none', color: '#fff', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', height: '100%', background: '#111' }}>
                <p style={{ fontSize: '0.8rem', color: '#ef4444', margin: 0 }}>Playback Unavailable</p>
                <a href={watchUrl} target="_blank" rel="noreferrer" style={{ background: '#ef4444', color: '#fff', padding: '0.3rem 0.8rem', borderRadius: '4px', fontSize: '0.75rem', textDecoration: 'none', fontWeight: 600 }}>
                  Open on YouTube.com <ExternalLink size={12} />
                </a>
              </div>
            )}
            <div style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', zIndex: 35, display: 'flex', gap: '0.3rem' }}>
              <a
                href={watchUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'rgba(0, 0, 0, 0.8)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.7rem',
                  textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem'
                }}
                title="Open on YouTube.com if embedding is blocked"
              >
                YouTube <ExternalLink size={10} />
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlaying(false);
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.9)', color: '#fff', border: 'none',
                  borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.7rem',
                  cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem'
                }}
                title="Close player and show thumbnail"
              >
                ✕ Close
              </button>
            </div>
          </div>
        ) : (
          <div onClick={() => setIsPlaying(true)} style={{ width: '100%', height: '100%', position: 'relative' }}>
            {video.thumbnail_url ? (
              <img
                src={video.thumbnail_url}
                alt={video.title}
                className="thumbnail"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div className="thumbnail" style={{ background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', minHeight: '180px' }}>
                <Play size={36} color="#ef4444" />
              </div>
            )}

            {/* Play Button Overlay */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'rgba(239, 68, 68, 0.9)', borderRadius: '50%', width: '48px', height: '48px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              transition: 'transform 0.2s ease', zIndex: 20
            }}>
              <Play size={24} color="#fff" style={{ marginLeft: '3px' }} />
            </div>

            <span 
              onClick={(e) => {
                e.stopPropagation();
                onSelectVideo(video);
              }}
              style={{ position: 'absolute', bottom: '0.4rem', right: '0.4rem', background: 'rgba(0,0,0,0.85)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#fff', zIndex: 20 }}
              title="View Analytics Chart"
            >
              <Maximize2 size={10} /> View Analytics
            </span>

            {video.duration_seconds && (
              <span style={{ position: 'absolute', bottom: '0.4rem', left: '0.4rem', background: 'rgba(0,0,0,0.85)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.2rem', zIndex: 20 }}>
                <Clock size={10} /> {formatDuration(video.duration_seconds)}
              </span>
            )}

            {isShort ? (
              <span className="short-badge" style={{ position: 'absolute', top: '0.4rem', left: '2.4rem', background: '#8b5cf6', color: '#fff', fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600, zIndex: 20 }}>⚡ Short</span>
            ) : (
              <span className="short-badge" style={{ position: 'absolute', top: '0.4rem', left: '2.4rem', background: '#00f0ff', color: '#000', fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600, zIndex: 20 }}>🎥 Long</span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="card-content" style={{ display: 'flex', flexDirection: 'column', gap: '0.50rem' }}>
        {/* Title & Direct YouTube Link */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.4rem' }}>
          <h3 
            className="card-title" 
            onClick={() => setIsPlaying(true)}
            style={{ fontSize: '0.95rem', fontWeight: 600, height: '2.4rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', margin: 0, cursor: 'pointer' }}
            title="Click to play video inline"
          >
            {video.title}
          </h3>
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '0.1rem' }}
            title="Open video on YouTube.com (new tab)"
          >
            <ExternalLink size={14} />
          </a>
        </div>

        {/* Channel row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a 
            href={channelUrl} 
            target="_blank" 
            rel="noreferrer" 
            className="feed-channel" 
            style={{ textDecoration: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: 'var(--accent)', fontWeight: 500, fontSize: '0.8rem' }}
            title={`Visit YouTube Channel: ${video.channel_name}`}
          >
            {video.channel_name} <ExternalLink size={10} style={{ opacity: 0.6 }} />
          </a>
          <button
            onClick={() => onUnsubscribeChannel(video.channel_id, video.channel_name)}
            className="unsubscribe-btn"
            title={`Unsubscribe from ${video.channel_name}`}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#ef4444',
              fontSize: '0.68rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              fontWeight: 600
            }}
          >
            <UserMinus size={11} /> Unsubscribe
          </button>
        </div>

        {/* Publish Time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: 'var(--text-muted)' }} title={video.published_at ? parseVideoDate(video.published_at).toLocaleString() : ''}>
          <Clock size={11}/> {video.published_at ? parseVideoDate(video.published_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : ''} ({timeAgo(video.published_at || video.created_at)})
        </div>

        {/* Momentum & Topic Badges */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span 
            className="momentum-badge" 
            title={cfg.hint || `${momentum}: Organic viewer demand & steady watch time.`}
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`, fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', cursor: 'help' }}
          >
            {cfg.icon} {momentum}
          </span>
          {topics.map(t => (
            <span key={t} className="topic-pill" style={{ background: `${TOPIC_COLORS[t] || '#888'}20`, color: TOPIC_COLORS[t] || '#888', borderColor: `${TOPIC_COLORS[t] || '#888'}40`, fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
              {t}
            </span>
          ))}
          {subTopics.slice(0, 1).map(s => (
            <span key={s} className="subtopic-pill" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{s}</span>
          ))}
        </div>

        {/* AI Summary */}
        {video.ai_summary ? (
          <p className="feed-summary" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.2rem 0', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{video.ai_summary}</p>
        ) : (
          <p className="feed-summary pending" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.2rem 0', opacity: 0.6 }}>💬 AI summary pending local LLM integration</p>
        )}

        {/* Stats Row with Predictive Trajectory & Outlier Surge Metrics */}
        <div className="feed-stats-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.4rem', marginTop: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.2rem' }}>
          <span title="Views" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600 }}><Eye size={12}/> {formatViews(video.view_count)}</span>
          <span title="Likes" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}><ThumbsUp size={12}/> {formatViews(video.like_count)}</span>
          {(video.velocity > 0 || video.early_pace > 0) && (
            <span 
              onClick={() => onSelectVideo(video)}
              style={{ color: '#38bdf8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600, background: 'rgba(56,189,248,0.1)', padding: '0.1rem 0.3rem', borderRadius: '4px' }} 
              title={`Velocity Pace: +${Math.round(video.velocity || video.early_pace).toLocaleString()} views/hour\nClick to view growth trajectory`}
            >
              <TrendingUp size={11}/> +{Math.round(video.velocity || video.early_pace).toLocaleString()}/hr
            </span>
          )}
          {video.outlier_multiplier > 1.1 && (
            <span 
              style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '0.1rem 0.3rem', borderRadius: '4px', fontWeight: 600 }} 
              title={`Outlier Surge: ${video.outlier_multiplier.toFixed(1)}x higher than channel baseline!`}
            >
              ⚡ {video.outlier_multiplier.toFixed(1)}x
            </span>
          )}
          {video.projected_24h_views > (video.view_count || 0) && (
            <span 
              style={{ color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '0.1rem 0.3rem', borderRadius: '4px', fontWeight: 600 }} 
              title={`Predictive Trajectory: Projected to reach ~${formatViews(video.projected_24h_views)} views in first 24h!`}
            >
              🔮 ~{formatViews(video.projected_24h_views)} 24h
            </span>
          )}
          <span 
            onClick={() => onSelectVideo(video)}
            title="Click to view historical growth chart" 
            style={{ color: cfg.color, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600 }}
          >
            <BarChart2 size={12}/> {video.quality_score ?? 0}pts
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FeedDashboard({ 
  apiBase, 
  authToken, 
  onSelectVideo, 
  refreshTrigger,
  videos = [],
  categories: parentCategories = [],
  loading: parentLoading = false,
  setVideos,
  blacklistedChannels = [],
  onUnsubscribeChannel,
  isGuest = false
}) {
  const getCombinedBlacklist = useCallback(() => {
    try {
      const local = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
      return [...(blacklistedChannels || []), ...local];
    } catch (e) {
      return blacklistedChannels || [];
    }
  }, [blacklistedChannels]);

  const [allVideos, setAllVideos] = useState([]);
  const [filteredVideos, setFilteredVideos] = useState([]);
  const [stats, setStats] = useState({ total_videos: 0, hot_count: 0, new_today: 0 });
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInputVal, setPageInputVal] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [filterMomentum, setFilterMomentum] = useState('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDay, setFilterDay] = useState('all'); // 'all' | 'today' | 'yesterday' | 'week' | 'custom'
  const [customDate, setCustomDate] = useState('');
  const [sortOption, setSortOption] = useState('pace'); // 'pace' | 'surge' | 'projected' | 'quality' | 'newest'
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  
  // Bulk selection & deletion state
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync with parent props
  useEffect(() => {
    if (videos && videos.length > 0) {
      const cleanVids = filterDeletedVideos(videos);
      const sortedParentVids = [...cleanVids].sort((a, b) => {
        const dateA = parseVideoDate(a.published_at || a.created_at);
        const dateB = parseVideoDate(b.published_at || b.created_at);
        return dateB - dateA;
      });
      setAllVideos(sortedParentVids);
      setStats(computeStatsFromVideos(sortedParentVids));
      if (parentCategories && parentCategories.length > 0) {
        setCategories(parentCategories);
      }
      setLoading(false);
    }
  }, [videos, parentCategories]);

  const fetchFeed = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && videos && videos.length > 0) {
      const cleanVids = filterDeletedVideos(videos);
      const sortedParentVids = [...cleanVids].sort((a, b) => {
        const dateA = parseVideoDate(a.published_at || a.created_at);
        const dateB = parseVideoDate(b.published_at || b.created_at);
        return dateB - dateA;
      });
      setAllVideos(sortedParentVids);
      setStats(computeStatsFromVideos(sortedParentVids));
      if (parentCategories && parentCategories.length > 0) {
        setCategories(parentCategories);
      }
      setLoading(false);
      return;
    }
    // 1. Check Session Storage cache unless manual refresh was clicked
    if (!forceRefresh) {
      try {
        const cached = sessionStorage.getItem('ddj_feed_session_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < 30 * 60 * 1000 && parsed.videos?.length > 0) {
            console.log("Serving Feed from session cache (0 network requests)");
            
            // Apply blacklist safety filter to cached videos
            let cachedVids = parsed.videos || [];
            const combinedBlacklist = getCombinedBlacklist();
            if (combinedBlacklist.length > 0) {
              cachedVids = cachedVids.filter(v => 
                !combinedBlacklist.some(item => 
                  (item.id && v.channel_id === item.id) || 
                  (item.channel_id && v.channel_id === item.channel_id) ||
                  (item.name && v.channel_name && v.channel_name.toLowerCase() === item.name.toLowerCase())
                )
              );
            }
            cachedVids = filterDeletedVideos(cachedVids);

            cachedVids.sort((a, b) => {
              const dateA = parseVideoDate(a.published_at || a.created_at);
              const dateB = parseVideoDate(b.published_at || b.created_at);
              return dateB - dateA;
            });

            setAllVideos(cachedVids);
            setStats(computeStatsFromVideos(cachedVids));
            setCategories(parsed.categories || []);
            setLastRefresh(new Date(parsed.timestamp));
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.warn("Session cache read error:", e);
      }
    }

    setLoading(true);
    try {
      const fb = initFirebase();
      let rawVideos = [];
      let categories_list = [];

      if (fb?.firestore) {
        try {
          const docRef = doc(fb.firestore, "cache", "dashboard_summary");
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            rawVideos = data.videos || [];
            categories_list = data.categories || [];
            
            const chunksCount = data.chunks_count || 1;
            if (chunksCount > 1) {
              const chunkPromises = [];
              for (let i = 1; i < chunksCount; i++) {
                chunkPromises.push(getDoc(doc(fb.firestore, "cache", `dashboard_summary_${i}`)));
              }
              const chunkDocs = await Promise.all(chunkPromises);
              chunkDocs.forEach(cDoc => {
                if (cDoc.exists() && cDoc.data().videos) {
                  rawVideos = rawVideos.concat(cDoc.data().videos);
                }
              });
            }
            console.log(`Loaded feed from chunked cache (${rawVideos.length} videos)`);
          }
        } catch (e) {
          const errStr = String(e);
          if (!errStr.includes("quota") && !errStr.includes("429") && !errStr.includes("RESOURCE_EXHAUSTED")) {
            // Emergency fallback with a very small limit to guard reads
            const querySnapshot = await getDocs(query(collection(fb.firestore, "videos"), limit(50)));
            querySnapshot.forEach((doc) => {
              rawVideos.push({ id: doc.id, ...doc.data() });
            });
          } else {
            console.warn("Quota exceeded — skipping Firestore fallback in Feed.");
          }
        }
      }

      // Fallback to API if firestore empty or unaccessible
      if (rawVideos.length === 0 && apiBase) {
        const headers = { Authorization: `Bearer ${authToken}` };
        const res = await axios.get(`${apiBase}/api/videos`, { headers });
        rawVideos = Array.isArray(res.data) ? res.data : [];
      }

      // Apply channel blacklist & deleted videos filter
      try {
        const combinedBlacklist = getCombinedBlacklist();
        if (combinedBlacklist.length > 0) {
          rawVideos = rawVideos.filter(v => 
            !combinedBlacklist.some(item => 
              (item.id && v.channel_id === item.id) || 
              (item.channel_id && v.channel_id === item.channel_id) ||
              (item.name && v.channel_name && v.channel_name.toLowerCase() === item.name.toLowerCase())
            )
          );
        }
        rawVideos = filterDeletedVideos(rawVideos);
      } catch (e) {
        console.error("Failed to apply blacklist filter:", e);
      }

      // Sort by published_at descending (newest first) for a true chronological timeline feed
      rawVideos.sort((a, b) => {
        const dateA = parseVideoDate(a.published_at || a.created_at);
        const dateB = parseVideoDate(b.published_at || b.created_at);
        return dateB - dateA;
      });
      setAllVideos(rawVideos);
      if (setVideos) {
        setVideos(rawVideos);
      }

      // Compute stats
      const computedStats = computeStatsFromVideos(rawVideos);
      setStats(computedStats);

      // Extract unique categories
      const catSet = new Set();
      rawVideos.forEach(v => {
        (v.topic_labels || []).forEach(t => catSet.add(t));
      });
      const computedCategories = Array.from(catSet).map(name => ({ id: name, name }));
      setCategories(computedCategories);

      const refreshTime = new Date();
      setLastRefresh(refreshTime);

      // Save to Session Storage
      try {
        sessionStorage.setItem('ddj_feed_session_cache', JSON.stringify({
          timestamp: refreshTime.getTime(),
          videos: rawVideos,
          stats: computedStats,
          categories: computedCategories
        }));
      } catch (e) {
        console.warn("Could not save to sessionStorage:", e);
      }
    } catch (err) {
      console.error('Feed fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed, refreshTrigger]);

  // Apply multi-filters and sorting locally for instant sub-millisecond response
  useEffect(() => {
    let result = [...allVideos];

    // 0. Search Filter
    if (searchQuery && searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(v => 
        (v.title && v.title.toLowerCase().includes(q)) ||
        (v.channel_name && v.channel_name.toLowerCase().includes(q)) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        (v.topic_labels && v.topic_labels.some(t => t.toLowerCase().includes(q)))
      );
    }

    // 1. Momentum Filter (Predictive & Statistical classification)
    if (filterMomentum === 'hot') {
      result = result.filter(v => 
        v.is_hot_topic || 
        (v.velocity || 0) >= 150 || 
        (v.early_pace || 0) >= 150 || 
        (v.outlier_multiplier || 1.0) >= 2.0 || 
        (v.momentum_label && (v.momentum_label.includes('Surge') || v.momentum_label.includes('Must Watch')))
      );
    } else if (filterMomentum === 'gaining') {
      result = result.filter(v => 
        ((v.velocity || 0) >= 40 || (v.early_pace || 0) >= 40 || (v.outlier_multiplier || 1.0) >= 1.2) &&
        !(v.velocity >= 500 || (v.outlier_multiplier || 1.0) >= 4.0)
      );
    } else if (filterMomentum === 'new') {
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      result = result.filter(v => parseVideoDate(v.published_at || v.created_at) >= cutoff24h);
    }

    // 2. Category Filter
    if (filterCategory) {
      result = result.filter(v => (v.topic_labels || []).includes(filterCategory));
    }

    // 3. Day-Wise Filter (Refined for Today/Yesterday early trajectory)
    const now = new Date();
    const todayLocalStr = getLocalDateString(now);
    const yesterdayLocalStr = getLocalDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (filterDay === 'today') {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        if (!d || d.getTime() === 0) return false;
        return getLocalDateString(d) === todayLocalStr || d >= cutoff24h;
      });
    } else if (filterDay === 'yesterday') {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        if (!d || d.getTime() === 0) return false;
        return getLocalDateString(d) === yesterdayLocalStr || (d >= cutoff48h && d < cutoff24h);
      });
    } else if (filterDay === 'week') {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        if (!d || d.getTime() === 0) return false;
        return d >= weekStart;
      });
    } else if (filterDay === 'custom' && customDate) {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        if (!d || d.getTime() === 0) return false;
        return getLocalDateString(d) === customDate;
      });
    }

    // 4. Multi-Sorting Execution
    result.sort((a, b) => {
      if (sortOption === 'pace') {
        const paceA = a.velocity || a.early_pace || 0;
        const paceB = b.velocity || b.early_pace || 0;
        return paceB - paceA;
      } else if (sortOption === 'surge') {
        const surgeA = a.outlier_multiplier || 1.0;
        const surgeB = b.outlier_multiplier || 1.0;
        return surgeB - surgeA;
      } else if (sortOption === 'projected') {
        const projA = a.projected_24h_views || a.view_count || 0;
        const projB = b.projected_24h_views || b.view_count || 0;
        return projB - projA;
      } else if (sortOption === 'quality') {
        return (b.quality_score || 0) - (a.quality_score || 0);
      } else if (sortOption === 'newest') {
        const dateA = parseVideoDate(a.published_at || a.created_at);
        const dateB = parseVideoDate(b.published_at || b.created_at);
        return dateB - dateA;
      }
      return 0;
    });

    setFilteredVideos(result);
    setStats(computeStatsFromVideos(result));
  }, [allVideos, filterMomentum, filterCategory, filterDay, customDate, sortOption, searchQuery]);

  const ITEMS_PER_PAGE = 24;
  const totalPages = Math.ceil(filteredVideos.length / ITEMS_PER_PAGE);

  // Reset pagination to page 1 whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterMomentum, filterCategory, filterDay, customDate, searchQuery]);

  // Adjust out-of-bounds page numbers when items are deleted
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedVideos = React.useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredVideos.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [filteredVideos, currentPage]);

  const handleUnsubscribeChannel = async (channelId, channelName) => {
    if (onUnsubscribeChannel) {
      await onUnsubscribeChannel(channelName, channelId);
      const updatedVids = allVideos.filter(v => v.channel_id !== channelId && v.channel_name !== channelName);
      setAllVideos(updatedVids);
      if (setVideos) {
        setVideos(updatedVids);
      }
      return;
    }

    if (!window.confirm(`Unsubscribe from "${channelName}"?\n\nThis will remove the channel and all its videos from your feed automatically with 0 extra steps.`)) {
      return;
    }

    try {
      const fb = initFirebase();
      if (fb?.firestore) {
        // Delete channel
        const channelQuery = query(collection(fb.firestore, "channels"), where("channel_id", "==", channelId));
        const channelDocs = await getDocs(channelQuery);
        for (const d of channelDocs.docs) {
          await deleteDoc(d.ref);
        }

        // Delete videos
        const videoQuery = query(collection(fb.firestore, "videos"), where("channel_id", "==", channelId));
        const videoDocs = await getDocs(videoQuery);
        const deletePromises = videoDocs.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);

        // Delete todo
        const todoQuery = query(collection(fb.firestore, "todo"), where("channel_name", "==", channelName));
        const todoDocs = await getDocs(todoQuery);
        for (const d of todoDocs.docs) {
          await deleteDoc(d.ref);
        }

        // Add to blacklisted_channels to prevent re-importing
        try {
          await setDoc(doc(fb.firestore, "blacklisted_channels", channelId), {
            channel_id: channelId,
            name: channelName,
            blacklisted_at: new Date().toISOString(),
            blacklisted_by: "client_action"
          });
        } catch (e) {
          console.error("Failed to write to blacklisted_channels:", e);
        }
      }

      if (apiBase) {
        try {
          const headers = { Authorization: `Bearer ${authToken}` };
          await axios.delete(`${apiBase}/api/channels/${channelId}`, { headers });
        } catch (e) {}
      }

      // Filter local state instantly
      const updatedVids = allVideos.filter(v => v.channel_id !== channelId && v.channel_name !== channelName);
      setAllVideos(updatedVids);
      if (setVideos) {
        setVideos(updatedVids);
      }

      // Save to local blacklist (so it filters out even if Firestore is quota-limited/offline)
      try {
        const blacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
        if (!blacklist.some(item => (channelId && item.id === channelId) || (channelName && item.name === channelName))) {
          blacklist.push({ id: channelId, name: channelName });
          localStorage.setItem('ddj_unsubscribed_channels', JSON.stringify(blacklist));
        }
      } catch (e) {
        console.error("Failed to update local blacklist:", e);
      }

      // Clear session storage cache
      sessionStorage.removeItem('ddj_feed_session_cache');

      // Rewrite cache in Firestore directly
      if (fb?.firestore) {
        try {
          const summaryRef = doc(fb.firestore, 'cache', 'dashboard_summary');
          const summaryDoc = await getDoc(summaryRef);
          if (summaryDoc.exists()) {
            const data = summaryDoc.data();
            const cacheVids = (data.videos || []).filter(v => v.channel_id !== channelId && v.channel_name !== channelName);
            await setDoc(summaryRef, { ...data, videos: cacheVids });
          }

          const channelsRef = doc(fb.firestore, 'cache', 'channels_summary');
          const channelsDoc = await getDoc(channelsRef);
          if (channelsDoc.exists()) {
            const data = channelsDoc.data();
            const cacheChans = (data.channels || []).filter(c => c.channel_id !== channelId && c.channel_name !== channelName);
            await setDoc(channelsRef, { 
              ...data,
              channels: cacheChans,
              channels_count: cacheChans.length
            });
          }
        } catch (cacheErr) {
          console.error("Failed to update Firestore cache documents:", cacheErr);
        }
      }
    } catch (err) {
      console.error('Error unsubscribing channel:', err);
      const updatedVids = allVideos.filter(v => v.channel_id !== channelId && v.channel_name !== channelName);
      setAllVideos(updatedVids);
      if (setVideos) {
        setVideos(updatedVids);
      }
      sessionStorage.removeItem('ddj_feed_session_cache');
    }
  };

  const triggerScan = async () => {
    setTriggering(true);

    const STORED_PAT = import.meta.env.VITE_GITHUB_PAT || "";
    const ADMIN_PASS_HASH = "9c5a213d03d2aad9633d5fd84b958ac65d6fe80df4889e07640595a02533c26c";

    const authPass = prompt("🔑 Enter admin password to trigger scan:");
    if (!authPass) {
      setTriggering(false);
      return;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(authPass.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hexHash !== ADMIN_PASS_HASH) {
      setToast({ type: 'error', message: '❌ Invalid admin password.' });
      setTriggering(false);
      return;
    }
    
    // 1. Try local FastAPI server if active
    if (apiBase) {
      try {
        const headers = { Authorization: `Bearer ${authToken}` };
        await axios.post(`${apiBase}/api/admin/trigger-check`, {}, { headers });
        alert('Local scanning check triggered successfully!');
        setTimeout(() => {
          fetchFeed();
          setTriggering(false);
        }, 3000);
        return;
      } catch (err) {
        console.warn("Local trigger failed, attempting direct GitHub Action dispatch:", err);
      }
    }

    // 2. Production fallback: Direct GitHub Actions dispatch
    const pat = STORED_PAT || prompt("🔑 Enter GitHub Personal Access Token (with workflow permission) to trigger remote scan:");
    if (!pat) {
      setToast({ type: 'error', message: '❌ GitHub Token required for remote scan trigger.' });
      setTriggering(false);
      return;
    }

    try {
      const response = await fetch("https://api.github.com/repos/idhruv07/pro-you/actions/workflows/scheduler.yml/dispatches", {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${pat}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({ ref: "main" })
      });

      if (response.status === 204) {
        // Show toast and begin auto-polling Firestore for feed updates
        setToast({ type: 'success', message: '✅ Cloud scan triggered! Feed will auto-refresh in 1–2 minutes.' });
        startScanPoller();
      } else {
        const errText = await response.text();
        throw new Error(`Status ${response.status}: ${errText}`);
      }
    } catch (err) {
      console.error("GitHub dispatch failed:", err);
      setToast({ type: 'error', message: `❌ Failed to trigger scan: ${err.message || err}. Token cleared.` });
      localStorage.removeItem('github_pat');
    } finally {
      setTriggering(false);
    }
  };

  // ─── Toast state ─────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    if (toast) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 6000);
    }
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  // ─── Scan Poller: auto-refresh when Firestore cache_updated_at changes ───
  const scanPollRef = useRef(null);
  const pollCountRef = useRef(0);
  const lastCacheTimeRef = useRef(null);

  const startScanPoller = useCallback(() => {
    pollCountRef.current = 0;
    clearInterval(scanPollRef.current);
    scanPollRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      // Stop after 18 tries = 3 minutes
      if (pollCountRef.current > 18) {
        clearInterval(scanPollRef.current);
        setToast({ type: 'warning', message: '⚠️ Scan is taking longer than expected. Refresh manually.' });
        return;
      }
      try {
        const fb = initFirebase();
        if (!fb?.firestore) return;
        const cacheSnap = await getDoc(doc(fb.firestore, 'cache', 'dashboard_summary'));
        if (cacheSnap.exists()) {
          const newTime = cacheSnap.data()?.last_updated_at;
          if (lastCacheTimeRef.current && newTime && newTime !== lastCacheTimeRef.current) {
            // Cache refreshed — auto-pull new feed
            clearInterval(scanPollRef.current);
            setToast({ type: 'success', message: '🔄 New content detected! Feed refreshed.' });
            fetchFeed(true);
          }
          if (!lastCacheTimeRef.current) lastCacheTimeRef.current = newTime;
        }
      } catch (e) {
        // Swallow — polling should never crash the UI
      }
    }, 10000); // poll every 10s
  }, [fetchFeed]);

  // Capture baseline cache timestamp on load
  useEffect(() => {
    async function captureBaseline() {
      try {
        const fb = initFirebase();
        if (!fb?.firestore) return;
        const snap = await getDoc(doc(fb.firestore, 'cache', 'dashboard_summary'));
        if (snap.exists()) lastCacheTimeRef.current = snap.data()?.last_updated_at || null;
      } catch (_) {}
    }
    captureBaseline();
    return () => clearInterval(scanPollRef.current);
  }, []);

  // Selection & Bulk Deletion handlers
  const toggleSelectVideo = useCallback((video) => {
    const key = getYoutubeId(video);
    if (!key) return;
    setSelectedVideos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleBulkDelete = async () => {
    if (isGuest) {
      alert("⚠️ Guest mode is view-only. Action disabled.");
      return;
    }
    if (selectedVideos.size === 0) return;

    let confirmMsg = `Are you sure you want to permanently delete and blacklist ${selectedVideos.size} selected video(s)?`;
    if (paginatedVideos.length > 0 && selectedVideos.size === paginatedVideos.length && isAllPageSelected) {
      confirmMsg = `Are you sure you want to permanently delete and blacklist ONLY the ${selectedVideos.size} video(s) visible on the CURRENT PAGE?\n\n(No other videos or search results outside this page will be deleted).`;
    } else if (selectedVideos.size === filteredVideos.length) {
      confirmMsg = `Are you sure you want to permanently delete and blacklist all ${selectedVideos.size} video(s) matching current search/filters across all pages?`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(true);
    try {
      const fb = initFirebase();
      const vidsToDelete = allVideos.filter(v => {
        const yid = getYoutubeId(v);
        return yid && selectedVideos.has(yid);
      });

      const res = await deleteVideosBulk(fb?.firestore, vidsToDelete);
      setIsDeleting(false);

      // Always filter state immediately for local storage blacklist consistency
      const remaining = allVideos.filter(v => {
        const yid = getYoutubeId(v);
        return !yid || !selectedVideos.has(yid);
      });
      setAllVideos(remaining);
      if (setVideos) {
        setVideos(remaining);
      }
      setSelectedVideos(new Set());
      sessionStorage.removeItem('ddj_feed_session_cache');

      if (apiBase) {
        try { await axios.post(`${apiBase}/api/admin/trigger-cache`); } catch (e) {}
      }

      if (res.success) {
        setToast({ type: 'success', message: `🗑️ Successfully deleted and blacklisted ${res.count} video(s)` });
      } else {
        setToast({ 
          type: 'warning', 
          message: `⚠️ Cloud database quota limit exceeded. Videos have been blacklisted locally for this session.` 
        });
      }
    } catch (err) {
      setIsDeleting(false);
      setToast({ type: 'error', message: `❌ Deletion failed: ${err.message || err}` });
    }
  };

  const isAllPageSelected = paginatedVideos.length > 0 && paginatedVideos.every(v => {
    const yid = getYoutubeId(v);
    return yid && selectedVideos.has(yid);
  });

  const isAllFilteredSelected = filteredVideos.length > 0 && filteredVideos.every(v => {
    const yid = getYoutubeId(v);
    return yid && selectedVideos.has(yid);
  });

  const toggleSelectAllPage = () => {
    const pageKeys = paginatedVideos.map(v => getYoutubeId(v)).filter(Boolean);
    if (isAllPageSelected) {
      setSelectedVideos(prev => {
        const next = new Set(prev);
        pageKeys.forEach(k => next.delete(k));
        return next;
      });
    } else {
      // Select ONLY current page videos
      setSelectedVideos(new Set(pageKeys));
    }
  };

  const toggleSelectAllFiltered = () => {
    const filteredKeys = filteredVideos.map(v => getYoutubeId(v)).filter(Boolean);
    setSelectedVideos(prev => {
      const next = new Set(prev);
      if (isAllFilteredSelected) {
        filteredKeys.forEach(k => next.delete(k));
      } else {
        filteredKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  return (
    <div className="feed-container" style={{ position: 'relative' }}>
      {/* ── Floating Bulk Action Bar ───────────────────────────────── */}
      {selectedVideos.size > 0 && (
        <div style={{
          position: 'fixed', top: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9990, background: '#18122B', border: '1px solid #a855f7',
          borderRadius: '12px', padding: '0.65rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
          boxShadow: '0 8px 32px rgba(168,85,247,0.3)', backdropFilter: 'blur(12px)',
          animation: 'fadeInUp 0.25s ease'
        }}>
          <span style={{ color: '#fff', fontSize: '0.88rem', fontWeight: 600 }}>
            {selectedVideos.size} video(s) selected
          </span>
          <button
            onClick={toggleSelectAllFiltered}
            style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid #a855f7', color: '#c084fc', padding: '0.35rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {isAllFilteredSelected ? `Deselect All (${filteredVideos.length})` : `Select All Searched (${filteredVideos.length})`}
          </button>
          <button
            onClick={toggleSelectAllPage}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', padding: '0.35rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {isAllPageSelected ? 'Deselect Page' : 'Select Page'}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={isDeleting}
            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '0.35rem 0.85rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: isDeleting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Trash2 size={14} /> {isDeleting ? 'Deleting...' : 'Delete & Blacklist'}
          </button>
          <button
            onClick={() => setSelectedVideos(new Set())}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Toast Notification ───────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, minWidth: 320, maxWidth: 520,
          background: toast.type === 'success' ? 'rgba(34,197,94,0.15)' :
                      toast.type === 'error'   ? 'rgba(255,51,102,0.15)' : 'rgba(234,179,8,0.12)',
          border: `1px solid ${toast.type === 'success' ? '#22c55e' : toast.type === 'error' ? '#ff3366' : '#eab308'}`,
          borderRadius: '12px', padding: '0.85rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'fadeInUp 0.3s ease',
          color: 'var(--text-main)', fontSize: '0.88rem', fontWeight: 500,
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} color="#22c55e" /> :
           toast.type === 'error'   ? <XCircle size={18} color="#ff3366" /> :
           <AlertTriangle size={18} color="#eab308" />}
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem 0.25rem', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {/* Stats Bar */}
      <div className="feed-stats-bar" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.65rem 1rem', background: 'rgba(15,18,30,0.85)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="stat-chip" title="Videos published within the last 24 hours">
          <span className="stat-value" style={{ color: '#22c55e', fontWeight: 800 }}>{stats.new_today ?? 0}</span>
          <span className="stat-label">New Today</span>
        </div>
        <div className="stat-chip" title="Viral surge videos accumulating >500 views/hr">
          <span className="stat-value" style={{ color: '#00f0ff', fontWeight: 800 }}>{stats.viral_surge ?? 0}</span>
          <span className="stat-label">🚀 Viral Surge</span>
        </div>
        <div className="stat-chip" title="High momentum videos accumulating 150-500 views/hr">
          <span className="stat-value" style={{ color: '#ff3366', fontWeight: 800 }}>{stats.hot_count ?? 0}</span>
          <span className="stat-label">🔥 Must Watch</span>
        </div>
        <div className="stat-chip" title="Gaining momentum (50-150 views/hr)">
          <span className="stat-value" style={{ color: '#f59e0b', fontWeight: 800 }}>{stats.high_growth ?? 0}</span>
          <span className="stat-label">📈 Gaining</span>
        </div>
        <div className="stat-chip" title="Top retention quality score (>= 85 pts)">
          <span className="stat-value" style={{ color: '#a855f7', fontWeight: 800 }}>{stats.evergreen_count ?? 0}</span>
          <span className="stat-label">💎 Evergreen</span>
        </div>
        <div className="stat-chip" title="Unique channels producing tracked content">
          <span className="stat-value" style={{ color: '#94a3b8', fontWeight: 800 }}>{stats.active_channels ?? 0}</span>
          <span className="stat-label">📺 Channels</span>
        </div>
        <div className="stat-chip" title="Total videos indexed in current database">
          <span className="stat-value" style={{ color: '#38bdf8', fontWeight: 800 }}>{stats.total_videos ?? 0}</span>
          <span className="stat-label">Total Tracked</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {filteredVideos.length > 0 && (
            <>
              <button
                onClick={toggleSelectAllFiltered}
                className="filter-pill"
                style={{ background: isAllFilteredSelected ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)', borderColor: isAllFilteredSelected ? '#a855f7' : undefined, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="Select all videos matching current search/filter across all pages"
              >
                {isAllFilteredSelected ? <CheckSquare size={13} color="#c084fc" /> : <Square size={13} />}
                {isAllFilteredSelected ? `Deselect All (${filteredVideos.length})` : `Select All (${filteredVideos.length})`}
              </button>
              <button
                onClick={toggleSelectAllPage}
                className="filter-pill"
                style={{ background: isAllPageSelected ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)', borderColor: isAllPageSelected ? '#a855f7' : undefined, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="Select only videos on current page"
              >
                {isAllPageSelected ? <CheckSquare size={13} color="#c084fc" /> : <Square size={13} />}
                {isAllPageSelected ? 'Deselect Page' : 'Select Page'}
              </button>
            </>
          )}
          {lastRefresh && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <Clock size={11}/> Refreshed {timeAgo(lastRefresh.toISOString())}
            </span>
          )}
          <button className="tab-btn" onClick={() => fetchFeed(true)} disabled={loading} title="Force Refresh Feed">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="primary" onClick={triggerScan} disabled={triggering} style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}>
            {triggering ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
            Scan Channels Now
          </button>
        </div>
      </div>

      {/* Filter Bar (Row 1: Search, Momentum & Category) */}
      <div className="feed-filter-bar" style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search input field */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 240px', minWidth: '180px', position: 'relative' }}>
          <Search size={14} style={{ color: 'var(--text-muted)', position: 'absolute', left: '0.65rem' }} />
          <input
            type="text"
            placeholder="Search feed title, channel, topic..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              fontSize: '0.8rem',
              padding: '0.28rem 0.5rem 0.28rem 1.85rem',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-main)',
              width: '100%',
              fontFamily: 'var(--font-main)'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '0.5rem',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                padding: '0.1rem 0.25rem'
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <Filter size={15} style={{ color: 'var(--text-muted)' }} />
        {[
          { key: 'all', label: 'All Momentum' },
          { key: 'hot', label: '🔥 Must Watch' },
          { key: 'gaining', label: '📈 Hot Right Now' },
          { key: 'new', label: '🆕 Just Posted' },
        ].map(f => (
          <button
            key={f.key}
            className={`filter-pill ${filterMomentum === f.key ? 'active' : ''}`}
            onClick={() => setFilterMomentum(f.key)}
          >
            {f.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            className="category-select"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter Bar (Row 2: Day-Wise, Calendar & Multi-Sort) */}
      <div className="feed-filter-bar" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Calendar size={15} style={{ color: 'var(--text-muted)' }} />
        {[
          { key: 'all', label: 'All Dates' },
          { key: 'today', label: 'Today' },
          { key: 'yesterday', label: 'Yesterday' },
          { key: 'week', label: 'Past 7 Days' },
          { key: 'custom', label: 'Select Date' },
        ].map(f => (
          <button
            key={f.key}
            className={`filter-pill ${filterDay === f.key ? 'active' : ''}`}
            onClick={() => {
              setFilterDay(f.key);
              if (f.key !== 'custom') setCustomDate('');
            }}
          >
            {f.label}
          </button>
        ))}

        {filterDay === 'custom' && (
          <input
            type="date"
            className="category-select"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
            value={customDate}
            onChange={e => setCustomDate(e.target.value)}
          />
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sort By:</span>
          <select
            className="category-select"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', borderColor: '#a855f7', background: 'rgba(168,85,247,0.1)' }}
            value={sortOption}
            onChange={e => setSortOption(e.target.value)}
          >
            <option value="pace">🚀 Velocity Pace (v/hr)</option>
            <option value="surge">⚡ Outlier Surge (x Baseline)</option>
            <option value="projected">🔮 Projected 24h Impact</option>
            <option value="quality">📊 Quality Score (0-100)</option>
            <option value="newest">📅 Upload Date (Newest)</option>
          </select>
        </div>
      </div>

      {/* Video Feed */}
      {loading ? (
        <div className="feed-empty">
          <RefreshCw size={32} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <p>Loading intelligence feed...</p>
        </div>
      ) : filteredVideos.length === 0 ? (
        <div className="feed-empty">
          <Tv size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3>No videos matching filters</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400 }}>
            Try resetting category, momentum, or day-wise date filters.
          </p>
        </div>
      ) : (
        <>
          <div className="grid">
            {paginatedVideos.map(video => (
              <VideoCard 
                key={video.id || video.youtube_id} 
                video={video} 
                onUnsubscribeChannel={handleUnsubscribeChannel} 
                onSelectVideo={onSelectVideo}
                isSelected={(() => {
                  const yid = getYoutubeId(video);
                  return yid && selectedVideos.has(yid);
                })()}
                onToggleSelect={toggleSelectVideo}
              />
            ))}
          </div>

          {/* Sleek Glassmorphic Pagination Controls */}
          {totalPages > 1 && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: '1.5rem', 
              marginTop: '2.5rem', 
              padding: '0.85rem 1.5rem',
              background: 'rgba(255, 255, 255, 0.02)',
              backdropFilter: 'blur(12px)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              width: 'fit-content',
              margin: '2.5rem auto 0 auto'
            }}>
              <button
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage(prev => Math.max(1, prev - 1));
                  window.scrollTo({ top: 250, behavior: 'smooth' });
                }}
                className="filter-pill"
                style={{
                  opacity: currentPage === 1 ? 0.35 : 1,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  borderRadius: '6px',
                  fontWeight: 500
                }}
              >
                &larr; Previous
              </button>
              
              {isEditingPage ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Page</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={pageInputVal}
                    onChange={e => setPageInputVal(e.target.value)}
                    onBlur={() => {
                      const val = parseInt(pageInputVal, 10);
                      if (!isNaN(val) && val >= 1 && val <= totalPages) {
                        setCurrentPage(val);
                        window.scrollTo({ top: 250, behavior: 'smooth' });
                      }
                      setIsEditingPage(false);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = parseInt(pageInputVal, 10);
                        if (!isNaN(val) && val >= 1 && val <= totalPages) {
                          setCurrentPage(val);
                          window.scrollTo({ top: 250, behavior: 'smooth' });
                        }
                        setIsEditingPage(false);
                      } else if (e.key === 'Escape') {
                        setIsEditingPage(false);
                      }
                    }}
                    autoFocus
                    style={{
                      width: '3.5rem',
                      padding: '0.15rem 0.35rem',
                      fontSize: '0.85rem',
                      background: '#0e1520',
                      border: '1px solid var(--accent)',
                      borderRadius: '4px',
                      color: 'var(--text-main)',
                      textAlign: 'center',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>of {totalPages}</span>
                </div>
              ) : (
                <span 
                  onClick={() => {
                    setPageInputVal(currentPage.toString());
                    setIsEditingPage(true);
                  }}
                  title="Click to jump to a specific page"
                  style={{ 
                    fontSize: '0.85rem', 
                    color: 'var(--text-muted)', 
                    fontWeight: 500, 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    userSelect: 'none',
                    borderBottom: '1px dashed rgba(255,255,255,0.15)',
                    paddingBottom: '2px'
                  }}
                >
                  Page <strong style={{ color: 'var(--accent)' }}>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>
              )}

              <button
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage(prev => Math.min(totalPages, prev + 1));
                  window.scrollTo({ top: 250, behavior: 'smooth' });
                }}
                className="filter-pill"
                style={{
                  opacity: currentPage === totalPages ? 0.35 : 1,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  borderRadius: '6px',
                  fontWeight: 500
                }}
              >
                Next &rarr;
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
