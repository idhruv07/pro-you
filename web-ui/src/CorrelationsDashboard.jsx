import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  RefreshCw, TrendingUp, BarChart2, Eye, Flame, 
  ExternalLink, Clock, Plus, Check, Play, BookOpen, Database,
  Search, Grid, List, Activity, Sparkles, Layers, ChevronDown, ChevronRight
} from 'lucide-react';
import { initFirebase, doc, getDoc, getDocs, collection, deleteDoc } from './firebase';

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

function formatViews(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return String(n);
}

export default function CorrelationsDashboard({ apiBase, authToken, onSelectVideo }) {
  const [correlations, setCorrelations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingTodoId, setAddingTodoId] = useState(null);
  const [addedTodoIds, setAddedTodoIds] = useState(new Set());
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataSource, setDataSource] = useState('firestore');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('matrix'); // 'matrix' | 'table' | 'grid'
  const [expandedTopics, setExpandedTopics] = useState(new Set());

  async function forceRebuildCorrelations() {
    setRefreshing(true);
    setLoading(true);
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const res = await fetch(`${apiBase || ''}/api/topics/correlations/rebuild`, { 
        method: 'POST',
        headers 
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          setCorrelations(json);
          setLastUpdated(new Date().toISOString());
          setDataSource('api-live');
        }
      } else {
        await fetchCorrelations();
      }
    } catch (err) {
      console.error('Failed to force rebuild correlations:', err);
      await fetchCorrelations();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function fetchCorrelations() {
    setLoading(true);
    try {
      let loaded = false;
      try {
        const fb = initFirebase();
        if (fb?.firestore) {
          const snap = await getDoc(doc(fb.firestore, 'cache', 'correlations_summary'));
          if (snap.exists()) {
            const data = snap.data();
            const corrs = data.correlations || [];
            if (corrs.length > 0) {
              setCorrelations(corrs);
              setLastUpdated(data.last_updated_at || null);
              setDataSource('firestore');
              loaded = true;
            }
          }
        }
      } catch (fsErr) {
        console.warn('Firestore correlations cache miss, falling back to API:', fsErr);
      }

      if (!loaded) {
        try {
          const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
          const res = await fetch(`${apiBase || ''}/api/topics/correlations`, { headers });
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json)) {
              setCorrelations(json);
              setDataSource('api');
            } else {
              setCorrelations([]);
            }
          }
        } catch (apiErr) {
          console.error('API correlations fallback failed:', apiErr);
          setCorrelations([]);
        }
      }
    } catch (err) {
      console.error('Error fetching correlations:', err);
      setCorrelations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const [todoMap, setTodoMap] = useState({}); // video_id -> todo_id

  useEffect(() => {
    fetchCorrelations();
    fetchExistingTodos();
  }, [apiBase, authToken]);

  async function fetchExistingTodos() {
    try {
      let items = [];
      if (apiBase) {
        const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
        const res = await axios.get(`${apiBase}/api/todo`, { headers });
        if (Array.isArray(res.data)) items = res.data;
      }
      if (items.length === 0) {
        const fb = initFirebase();
        if (fb?.firestore) {
          const snap = await getDocs(collection(fb.firestore, 'todo'));
          snap.forEach(d => items.push({ id: d.id, ...d.data() }));
        }
      }
      const newMap = {};
      const newSet = new Set();
      items.forEach(item => {
        const key = item.video_id || item.youtube_id || item.id;
        if (key) {
          newSet.add(key);
          newMap[key] = item.id;
        }
      });
      setAddedTodoIds(newSet);
      setTodoMap(newMap);
    } catch (err) {
      console.warn("Could not fetch existing todo items:", err);
    }
  }

  const handleToggleTodo = async (video) => {
    const videoKey = video.id || video.youtube_id;
    const isAdded = addedTodoIds.has(videoKey) || (video.id && addedTodoIds.has(video.id)) || (video.youtube_id && addedTodoIds.has(video.youtube_id));
    setAddingTodoId(videoKey);

    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      
      if (isAdded) {
        // Remove from To Do
        const targetId = todoMap[videoKey] || videoKey;
        if (apiBase) {
          await axios.delete(`${apiBase}/api/todo/${targetId}`, { headers });
        } else {
          const fb = initFirebase();
          if (fb?.firestore) {
            await deleteDoc(doc(fb.firestore, 'todo', targetId));
          }
        }
        setAddedTodoIds(prev => {
          const next = new Set(prev);
          next.delete(videoKey);
          if (video.id) next.delete(video.id);
          if (video.youtube_id) next.delete(video.youtube_id);
          return next;
        });
      } else {
        // Add to To Do
        let newTodoId = null;
        if (apiBase) {
          const res = await axios.post(`${apiBase}/api/todo`, {
            video_id: video.id,
            youtube_id: video.youtube_id,
            title: video.title,
            url: video.url,
            channel_name: video.channel_name,
            thumbnail_url: video.thumbnail_url,
            topic_labels: video.topic_labels || [],
            quality_score: video.quality_score || 0,
            notes: `Added from Cross-Channel correlation trend: "${video.title}"`,
            is_short: video.is_short || false
          }, { headers });
          newTodoId = res.data?.id;
        }
        setAddedTodoIds(prev => {
          const next = new Set(prev);
          next.add(videoKey);
          if (video.id) next.add(video.id);
          return next;
        });
        if (newTodoId) {
          setTodoMap(prev => ({ ...prev, [videoKey]: newTodoId }));
        }
      }
    } catch (err) {
      console.error('Failed to toggle todo state:', err);
      // Client-side optimistic fallback for guest mode / offline
      setAddedTodoIds(prev => {
        const next = new Set(prev);
        if (isAdded) next.delete(videoKey);
        else next.add(videoKey);
        return next;
      });
    } finally {
      setAddingTodoId(null);
    }
  };

  // Filter correlations based on search query
  const filteredCorrelations = useMemo(() => {
    if (!searchQuery.trim()) return correlations;
    const q = searchQuery.toLowerCase().trim();
    return correlations.filter(c => {
      const matchTopic = (c.topic || '').toLowerCase().includes(q);
      const matchSummary = (c.ai_summary || '').toLowerCase().includes(q);
      const matchVideo = (c.videos || []).some(v => 
        (v.title || '').toLowerCase().includes(q) || 
        (v.channel_name || '').toLowerCase().includes(q)
      );
      return matchTopic || matchSummary || matchVideo;
    });
  }, [correlations, searchQuery]);

  // Aggregate Market Stats for Bloomberg Top Bar
  const stats = useMemo(() => {
    let totalViews = 0;
    let totalVel = 0;
    let topTopic = null;
    let maxVel = 0;
    let highScoreTopic = null;
    let maxScore = 0;
    const allChannels = new Set();

    correlations.forEach(c => {
      totalViews += (c.total_views || 0);
      totalVel += (c.avg_velocity || 0);
      if ((c.avg_velocity || 0) > maxVel) {
        maxVel = c.avg_velocity || 0;
        topTopic = c.topic;
      }
      if ((c.opportunity_score || 0) > maxScore) {
        maxScore = c.opportunity_score || 0;
        highScoreTopic = c.topic;
      }
      (c.channels || []).forEach(ch => allChannels.add(ch));
    });

    return {
      clusterCount: correlations.length,
      totalViews,
      avgVel: correlations.length ? Math.round(totalVel / correlations.length) : 0,
      topTopic: topTopic || 'N/A',
      maxVel,
      highScoreTopic: highScoreTopic || 'N/A',
      maxScore: maxScore || 80,
      uniqueChannels: allChannels.size
    };
  }, [correlations]);

  return (
    <div className="dashboard-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* 🟢 Modern Glassmorphic KPI Ticker Bar */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(13, 16, 28, 0.9) 0%, rgba(20, 24, 42, 0.8) 100%)',
        border: '1px solid rgba(0, 240, 255, 0.25)',
        borderRadius: '16px',
        padding: '1.5rem',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{
                width: '10px', height: '10px', borderRadius: '50%', background: '#10b981',
                boxShadow: '0 0 14px #10b981, 0 0 4px #10b981', display: 'inline-block'
              }} />
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'linear-gradient(90deg, #fff, #a5f3fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Pro-U TOPIC INTELLIGENCE MATRIX 🔗
              </h2>
              <span style={{ fontSize: '0.72rem', background: 'linear-gradient(135deg, rgba(0,240,255,0.15), rgba(112,0,255,0.15))', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.4)', padding: '0.15rem 0.65rem', borderRadius: '20px', fontWeight: 700, letterSpacing: '0.03em' }}>
                {stats.clusterCount} ACTIVE CLUSTERS
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.35rem', margin: 0, opacity: 0.9 }}>
              Cross-Channel algorithmic correlation matrix identifying overlapping stories across 2+ channels in the last 48 hours.
              {lastUpdated && (
                <span style={{ marginLeft: '0.5rem', color: '#00f0ff', fontWeight: 600 }}>
                  • Synced {timeAgo(lastUpdated)}
                </span>
              )}
            </p>
          </div>

          <button 
            onClick={forceRebuildCorrelations} 
            disabled={loading || refreshing} 
            className="primary"
            style={{
              padding: '0.6rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #00f0ff, #7000ff)',
              border: 'none',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(0, 240, 255, 0.3)',
              cursor: 'pointer'
            }}
          >
            <RefreshCw className={refreshing || loading ? 'animate-spin' : ''} size={15} />
            Scan Trends Now
          </button>
        </div>

        {/* Ticker Metrics Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingTop: '1.25rem'
        }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(0,240,255,0.15)', borderRadius: '12px', padding: '0.85rem 1.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>
              TOTAL CROSS-CHANNEL REACH
            </span>
            <strong style={{ fontSize: '1.4rem', color: '#00f0ff', fontFamily: 'monospace, sans-serif', fontWeight: 800 }}>
              {formatViews(stats.totalViews)}
            </strong>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(112,0,255,0.15)', borderRadius: '12px', padding: '0.85rem 1.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>
              AVG CLUSTER MOMENTUM
            </span>
            <strong style={{ fontSize: '1.4rem', color: '#c084fc', fontFamily: 'monospace, sans-serif', fontWeight: 800 }}>
              +{formatViews(stats.avgVel)}/hr
            </strong>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '12px', padding: '0.85rem 1.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>
              📺 ACTIVE CHANNELS COVERAGE
            </span>
            <strong style={{ fontSize: '1.4rem', color: '#f59e0b', fontFamily: 'monospace, sans-serif', fontWeight: 800 }}>
              {stats.uniqueChannels} Channels
            </strong>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(236,72,153,0.15)', borderRadius: '12px', padding: '0.85rem 1.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>
              🎯 TOP OPPORTUNITY TOPIC
            </span>
            <strong style={{ fontSize: '0.92rem', color: '#ec4899', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem', fontWeight: 700 }}>
              {stats.highScoreTopic}
              <span style={{ fontSize: '0.72rem', color: '#fff', background: 'rgba(236,72,153,0.2)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                {stats.maxScore}/100
              </span>
            </strong>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: '12px', padding: '0.85rem 1.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block' }}>
              🔥 HIGHEST ACCELERATION TOPIC
            </span>
            <strong style={{ fontSize: '0.92rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem', fontWeight: 700 }}>
              <Flame size={14} color="#34d399" /> {stats.topTopic}
              {stats.maxVel > 0 && (
                <span style={{ fontSize: '0.72rem', color: '#fff', background: 'linear-gradient(135deg, rgba(16,185,129,0.3), rgba(0,240,255,0.3))', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>
                  +{formatViews(stats.maxVel)}/hr
                </span>
              )}
            </strong>
          </div>
        </div>
      </div>

      {/* 🔍 Search & View Switcher Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: '520px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#00f0ff' }} />
          <input
            type="text"
            placeholder="Search cross-channel topics, channels, or video titles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 1rem 0.65rem 2.4rem',
              borderRadius: '10px',
              border: '1px solid rgba(0, 240, 255, 0.2)',
              background: 'rgba(15, 18, 30, 0.85)',
              color: '#fff',
              fontSize: '0.88rem',
              outline: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
            }}
          />
        </div>

        {/* View Toggle Buttons */}
        <div style={{ display: 'flex', gap: '0.35rem', background: 'rgba(10,12,20,0.8)', padding: '0.3rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setViewMode('matrix')}
            style={{
              background: viewMode === 'matrix' ? 'linear-gradient(135deg, rgba(0,240,255,0.25), rgba(112,0,255,0.25))' : 'none',
              border: viewMode === 'matrix' ? '1px solid #00f0ff' : '1px solid transparent',
              color: viewMode === 'matrix' ? '#fff' : 'var(--text-muted)',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: viewMode === 'matrix' ? '0 0 12px rgba(0,240,255,0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <Grid size={14} color={viewMode === 'matrix' ? '#00f0ff' : 'currentColor'} /> Matrix View
          </button>

          <button
            onClick={() => setViewMode('table')}
            style={{
              background: viewMode === 'table' ? 'linear-gradient(135deg, rgba(112,0,255,0.25), rgba(236,72,153,0.25))' : 'none',
              border: viewMode === 'table' ? '1px solid #c084fc' : '1px solid transparent',
              color: viewMode === 'table' ? '#fff' : 'var(--text-muted)',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: viewMode === 'table' ? '0 0 12px rgba(112,0,255,0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <List size={14} color={viewMode === 'table' ? '#c084fc' : 'currentColor'} /> Terminal Table
          </button>

          <button
            onClick={() => setViewMode('grid')}
            style={{
              background: viewMode === 'grid' ? 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(0,240,255,0.25))' : 'none',
              border: viewMode === 'grid' ? '1px solid #10b981' : '1px solid transparent',
              color: viewMode === 'grid' ? '#fff' : 'var(--text-muted)',
              padding: '0.45rem 0.85rem',
              borderRadius: '7px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: viewMode === 'grid' ? '0 0 12px rgba(16,185,129,0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <Layers size={14} color={viewMode === 'grid' ? '#10b981' : 'currentColor'} /> Heatmap Grid
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6rem 0', gap: '1rem' }}>
          <RefreshCw className="animate-spin" size={32} color="var(--accent)" />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Analyzing recent video titles for topic correlations...</span>
        </div>
      ) : filteredCorrelations.length === 0 ? (
        <div className="empty-state" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <TrendingUp size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '1rem' }} />
          <p style={{ fontWeight: 500, fontSize: '1.05rem' }}>No cross-channel topics found matching query.</p>
        </div>
      ) : viewMode === 'matrix' ? (
        /* 1. Bloomberg Matrix 2-Column Responsive Layout */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
          gap: '1.25rem'
        }}>
          {filteredCorrelations.map((c, idx) => (
            <div 
              key={idx} 
              style={{
                background: 'rgba(12, 12, 18, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '14px',
                padding: '1.25rem',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem'
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.65rem', color: '#00f0ff', background: 'rgba(0,240,255,0.1)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700, fontFamily: 'monospace' }}>
                      #RANK {idx + 1}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                      {c.channel_count} CHANNELS
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700, border: '1px solid rgba(245,158,11,0.3)' }}>
                      🎯 OPPORTUNITY {c.opportunity_score || 80}/100
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#ec4899', background: 'rgba(236,72,153,0.12)', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700 }}>
                      ⚡ {c.demand_signal || 'High'} DEMAND
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff', marginTop: '0.35rem', margin: '0.35rem 0 0 0' }}>
                    {c.topic}
                  </h3>
                </div>

                <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>MOMENTUM</span>
                  <strong style={{ fontSize: '1.15rem', color: '#7000ff' }}>+{formatViews(c.avg_velocity)}/hr</strong>
                </div>
              </div>

              {/* Bloomberg Intelligence Brief: Core Driver, Key Angles & Title Hook */}
              <div style={{
                background: 'rgba(112, 0, 255, 0.05)',
                border: '1px solid rgba(112, 0, 255, 0.2)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
              }}>
                <div style={{ fontSize: '0.72rem', color: '#c084fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Sparkles size={13} color="#c084fc" /> Pro-U Trend Intelligence & Content Strategy Brief
                </div>

                {c.core_driver && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                    <strong>🎯 Core Driver:</strong> {c.core_driver}
                  </div>
                )}

                {c.ai_summary && (
                  <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: '1.45', color: 'var(--text-muted)' }}>
                    {c.ai_summary}
                  </p>
                )}

                {Array.isArray(c.key_angles) && c.key_angles.length > 0 && (
                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase' }}>
                      📌 Essential Creator Talking Points / Angles:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--text-main)', lineHeight: '1.45' }}>
                      {c.key_angles.map((angle, aIdx) => (
                        <li key={aIdx}>{angle}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.recommended_hook && (
                  <div style={{ background: 'rgba(0, 240, 255, 0.08)', border: '1px dashed rgba(0, 240, 255, 0.3)', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem', color: '#00f0ff', fontWeight: 600 }}>
                    🎣 <strong>Suggested Title Hook:</strong> "{c.recommended_hook}"
                  </div>
                )}
              </div>

              {/* Videos Ticker List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {c.videos.map((video) => {
                  const isAdded = addedTodoIds.has(video.id);
                  const isAdding = addingTodoId === video.id;

                  return (
                    <div key={video.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      gap: '0.75rem'
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a 
                          href={video.url} 
                          target="_blank" 
                          rel="noreferrer"
                          style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: '0.84rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={video.title}
                        >
                          {video.title}
                        </a>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{video.channel_name}</span>
                          <span>•</span>
                          <span>{timeAgo(video.published_at)}</span>
                          <span>•</span>
                          <span>{formatViews(video.view_count)} views</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                        {video.velocity > 0 && (
                          <span style={{ fontSize: '0.7rem', color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 600, fontFamily: 'monospace' }}>
                            +{Math.round(video.velocity)}/h
                          </span>
                        )}
                        <button 
                          onClick={() => onSelectVideo(video)}
                          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: '#fff', padding: '0.2rem 0.4rem', cursor: 'pointer', fontSize: '0.7rem' }}
                          title="Stats"
                        >
                          <BarChart2 size={12} />
                        </button>
                        <button 
                          onClick={() => handleToggleTodo(video)}
                          disabled={isAdding}
                          title={isAdded ? "Click to remove from To Do" : "Click to add to To Do"}
                          style={{ background: isAdded ? 'rgba(34,197,94,0.15)' : 'rgba(0,240,255,0.1)', border: isAdded ? '1px solid #22c55e' : '1px solid #00f0ff', borderRadius: '4px', color: isAdded ? '#22c55e' : '#00f0ff', padding: '0.2rem 0.45rem', cursor: isAdding ? 'wait' : 'pointer', fontSize: '0.7rem', fontWeight: 600 }}
                        >
                          {isAdding ? '...' : isAdded ? '✓ Added' : '+ Todo'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === 'table' ? (
        /* 2. Bloomberg Terminal Ticker Table Layout */
        <div style={{ background: 'rgba(10, 10, 16, 0.85)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Rank & Topic Label</th>
                <th style={{ padding: '0.75rem 1rem' }}>Channels</th>
                <th style={{ padding: '0.75rem 1rem' }}>Total Reach</th>
                <th style={{ padding: '0.75rem 1rem' }}>Momentum Pace</th>
                <th style={{ padding: '0.75rem 1rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCorrelations.map((c, idx) => {
                const isExpanded = expandedTopics.has(idx);
                return (
                  <React.Fragment key={idx}>
                    <tr 
                      onClick={() => toggleExpandTopic(idx)}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: isExpanded ? 'rgba(0,240,255,0.03)' : 'transparent' }}
                    >
                      <td style={{ padding: '0.85rem 1rem', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {isExpanded ? <ChevronDown size={15} color="var(--accent)" /> : <ChevronRight size={15} color="var(--text-muted)" />}
                        <span style={{ color: '#00f0ff', fontFamily: 'monospace', fontSize: '0.75rem' }}>#{idx+1}</span>
                        <span>{c.topic}</span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: 'var(--text-main)', fontWeight: 600 }}>
                        {c.channel_count} Channels
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600 }}>
                        {formatViews(c.total_views)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#7000ff', fontFamily: 'monospace', fontWeight: 700 }}>
                        +{formatViews(c.avg_velocity)}/hr
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <button 
                          onClick={(e) => { e.stopPropagation(); toggleExpandTopic(idx); }}
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: '#fff', padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}
                        >
                          {isExpanded ? 'Collapse' : `View (${c.videos.length})`}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Rows */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ background: 'rgba(0,0,0,0.25)', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                            {c.ai_summary && (
                              <div style={{ color: '#c084fc', fontSize: '0.8rem', marginBottom: '0.3rem', fontStyle: 'italic' }}>
                                💡 <strong>AI Summary:</strong> {c.ai_summary}
                              </div>
                            )}
                            {c.videos.map(v => (
                              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.85rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                <div>
                                  <a href={v.url} target="_blank" rel="noreferrer" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: '0.85rem' }}>
                                    {v.title}
                                  </a>
                                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    <span style={{ color: 'var(--accent)' }}>{v.channel_name}</span> • {formatViews(v.view_count)} views • {timeAgo(v.published_at)}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                  <button onClick={() => onSelectVideo(v)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: '#fff', padding: '0.2rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer' }}>
                                    Stats
                                  </button>
                                  {(() => {
                                    const vKey = v.id || v.youtube_id;
                                    const isAdded = addedTodoIds.has(vKey) || (v.id && addedTodoIds.has(v.id)) || (v.youtube_id && addedTodoIds.has(v.youtube_id));
                                    const isAdding = addingTodoId === vKey;
                                    return (
                                      <button 
                                        onClick={() => handleToggleTodo(v)} 
                                        disabled={isAdding}
                                        style={{ background: isAdded ? 'rgba(34,197,94,0.15)' : 'rgba(0,240,255,0.1)', border: isAdded ? '1px solid #22c55e' : '1px solid #00f0ff', borderRadius: '4px', color: isAdded ? '#22c55e' : '#00f0ff', padding: '0.2rem 0.5rem', fontSize: '0.72rem', cursor: isAdding ? 'wait' : 'pointer', fontWeight: 600 }}
                                      >
                                        {isAdding ? '...' : isAdded ? '✓ Added' : '+ Todo'}
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* 3. Heatmap Grid Layout (3 Columns) */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {filteredCorrelations.map((c, idx) => {
            const isExpanded = expandedTopics.has(idx);
            return (
              <div key={idx} style={{
                background: isExpanded ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15,15,22,0.85)',
                border: isExpanded ? '1px solid #00f0ff' : '1px solid rgba(16,185,129,0.3)',
                borderRadius: '12px',
                padding: '1.1rem',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                boxShadow: isExpanded ? '0 8px 32px rgba(0,240,255,0.25)' : '0 4px 20px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease'
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.65rem', color: '#10b981', background: 'rgba(16,185,129,0.15)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 700, fontFamily: 'monospace' }}>
                      #{idx+1} TOPIC
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#7000ff', fontWeight: 700, fontFamily: 'monospace' }}>
                      +{formatViews(c.avg_velocity)}/hr
                    </span>
                  </div>
                  <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', margin: '0.5rem 0 0.25rem 0' }}>
                    {c.topic}
                  </h4>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                    Covered by <strong>{c.channel_count} channels</strong> across {c.videos.length} videos.
                  </p>
                </div>

                {/* Inline Drawer when Expanded */}
                {isExpanded && (
                  <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid rgba(0,240,255,0.2)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {c.ai_summary && (
                      <div style={{ fontSize: '0.78rem', color: '#c084fc', background: 'rgba(112,0,255,0.1)', padding: '0.6rem', borderRadius: '6px', lineHeight: '1.4' }}>
                        ⚡ <strong>AI Summary:</strong> {c.ai_summary}
                      </div>
                    )}
                    {c.videos.map(v => {
                      const vKey = v.id || v.youtube_id;
                      const isAdded = addedTodoIds.has(vKey) || (v.id && addedTodoIds.has(v.id)) || (v.youtube_id && addedTodoIds.has(v.youtube_id));
                      const isAdding = addingTodoId === vKey;
                      return (
                        <div key={v.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <a href={v.url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none' }}>
                            {v.title}
                          </a>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--accent)' }}>{v.channel_name}</span>
                            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <button onClick={() => onSelectVideo(v)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: '#fff', padding: '0.15rem 0.4rem', fontSize: '0.68rem', cursor: 'pointer' }}>
                                Stats
                              </button>
                              <button 
                                onClick={() => handleToggleTodo(v)} 
                                disabled={isAdding} 
                                title={isAdded ? "Click to remove from To Do" : "Click to add to To Do"}
                                style={{ background: isAdded ? 'rgba(34,197,94,0.15)' : 'rgba(0,240,255,0.1)', border: isAdded ? '1px solid #22c55e' : '1px solid #00f0ff', borderRadius: '4px', color: isAdded ? '#22c55e' : '#00f0ff', padding: '0.15rem 0.4rem', fontSize: '0.68rem', fontWeight: 600, cursor: isAdding ? 'wait' : 'pointer' }}
                              >
                                {isAdding ? '...' : isAdded ? '✓ Added' : '+ Todo'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>
                    {formatViews(c.total_views)} Total Views
                  </span>
                  <button 
                    onClick={() => toggleExpandTopic(idx)}
                    style={{ background: isExpanded ? 'rgba(255,51,102,0.15)' : 'rgba(0,240,255,0.1)', border: isExpanded ? '1px solid #ff3366' : '1px solid #00f0ff', borderRadius: '6px', color: isExpanded ? '#ff3366' : '#00f0ff', padding: '0.3rem 0.65rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {isExpanded ? 'Collapse ✕' : 'Explore Trend →'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
