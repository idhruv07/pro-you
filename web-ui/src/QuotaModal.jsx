import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Activity, Clock, Zap, RefreshCw, Layers, CheckCircle2, User, Key, AlertCircle, XCircle, Loader } from 'lucide-react';
import { initFirebase, collection, doc, getDoc, getCountFromServer } from './firebase';

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getTimeUntilPSTReset() {
  const now = new Date();
  
  // Calculate next Midnight Pacific Time (PST/PDT)
  // Pacific time is UTC-7 (PDT) or UTC-8 (PST).
  // Current offset: PDT is UTC-7 (reset at 07:00 UTC)
  const utcNow = new Date(now.toUTCString());
  const nextReset = new Date(utcNow);
  
  nextReset.setUTCHours(7, 0, 0, 0); // 00:00 PDT = 07:00 UTC
  if (utcNow >= nextReset) {
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  }

  const diffMs = nextReset.getTime() - utcNow.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  const resetLocalTime = nextReset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  return {
    hours: diffHours,
    minutes: diffMins,
    formattedCountdown: `${diffHours}h ${diffMins}m`,
    resetLocalTime,
  };
}

export default function QuotaModal({ user, onClose }) {
  const [quotaStats, setQuotaStats] = useState({
    totalQuota: 10000,
    unitsUsed: 0,
    unitsRemaining: 10000,
    channelCount: 0,
    videoCount: 0,
    scanCountToday: 2,
  });
  const [loading, setLoading] = useState(true);
  const [timeInfo, setTimeInfo] = useState(getTimeUntilPSTReset());

  const [systemStatus, setSystemStatus] = useState({
    dailyReads: 0,
    dailyWrites: 0,
    dailyApi: 0,
    lastRunAt: null,
    lastStatus: 'idle',
    lastAction: '',
    lastError: '',
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeInfo(getTimeUntilPSTReset());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // ── Effect 1: Fetch collection counts ONCE when modal opens ─────────────────
  // Uses cache doc (1 read). Fallback uses getCountFromServer (1 read each, no full scan).
  useEffect(() => {
    let active = true;
    async function fetchStaticCounts() {
      try {
        const fb = initFirebase();
        if (!fb?.firestore) return;

        let chCount = 0;
        let vidCount = 0;
        let todoCount = 0;
        let statsCount = 0;
        let loadedFromCache = false;

        // Primary: read counts from cache doc (1 read total)
        try {
          const docSnap = await getDoc(doc(fb.firestore, "cache", "dashboard_summary"));
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.stats_metadata) {
              chCount    = data.stats_metadata.total_channels        || 0;
              vidCount   = data.stats_metadata.total_videos          || 0;
              todoCount  = data.stats_metadata.total_todo            || 0;
              statsCount = data.stats_metadata.total_stats_snapshots || 0;
              loadedFromCache = true;
            }
          }
        } catch (cacheErr) {
          console.warn("Cache doc unavailable, using count() aggregation:", cacheErr);
        }

        // Fallback: use getCountFromServer — 1 read per collection regardless of size
        if (!loadedFromCache) {
          try {
            const [chSnap, vidSnap, todoSnap] = await Promise.all([
              getCountFromServer(collection(fb.firestore, "channels")),
              getCountFromServer(collection(fb.firestore, "videos")),
              getCountFromServer(collection(fb.firestore, "todo")),
            ]);
            chCount   = chSnap.data().count;
            vidCount  = vidSnap.data().count;
            todoCount = todoSnap.data().count;
          } catch (countErr) {
            console.error("getCountFromServer failed:", countErr);
          }
        }

        if (active) {
          setQuotaStats(prev => ({
            ...prev,
            channelCount:    chCount,
            videoCount:      vidCount,
            todoCount:       todoCount,
            statsCount:      statsCount,
            loadedFromCache: loadedFromCache,
          }));
        }
      } catch (err) {
        console.error("fetchStaticCounts error:", err);
      }
    }

    fetchStaticCounts();
    return () => { active = false; };
  }, []); // Runs ONCE on open — no polling

  // ── Effect 2: Poll system/status ONLY (1 read per 30s, stops on quota exceeded) ─
  useEffect(() => {
    let active = true;
    let intervalId = null;

    async function pollLiveStatus() {
      try {
        const fb = initFirebase();
        if (!fb?.firestore) return;

        const statusSnap = await getDoc(doc(fb.firestore, "system", "status"));
        if (!statusSnap.exists()) return;

        const sData   = statusSnap.data();
        const lastStat = sData.last_status || 'idle';
        const realReads  = lastStat === 'quota_exceeded' ? 50000 : (sData.daily_reads  || 0);
        const realWrites = lastStat === 'quota_exceeded' ? 20000 : (sData.daily_writes || 0);
        const realApi    = sData.daily_api   || 0;

        if (active) {
          setSystemStatus({
            dailyReads:  realReads,
            dailyWrites: realWrites,
            dailyApi:    realApi,
            lastRunAt:   sData.last_run_at  || null,
            lastStatus:  lastStat,
            lastAction:  sData.last_action  || '',
            lastError:   sData.last_error   || '',
          });
          setQuotaStats(prev => ({
            ...prev,
            unitsUsed:      realApi,
            unitsRemaining: Math.max(0, prev.totalQuota - realApi),
          }));

          // Stop polling when quota is exhausted — no point making more reads
          if (lastStat === 'quota_exceeded' && intervalId) {
            console.warn("Quota exceeded — stopping QuotaModal polling to preserve reads.");
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err) {
        console.error("pollLiveStatus error:", err);
        const errStr = String(err);
        if (errStr.includes("quota") || errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED")) {
          if (active) {
            setSystemStatus({
              dailyReads:  50000,
              dailyWrites: 20000,
              dailyApi:    10000,
              lastRunAt:   new Date().toISOString(),
              lastStatus:  'quota_exceeded',
              lastAction:  'check_channel_updates',
              lastError:   '429 Resource Exhausted (reads halted to protect quota)',
            });
          }
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    pollLiveStatus(); // Immediate first call
    intervalId = setInterval(pollLiveStatus, 30000); // Poll every 30s (was 15s)

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // Single lifecycle — no deps needed

  const usedPct = Math.min(100, Math.round((quotaStats.unitsUsed / quotaStats.totalQuota) * 100));
  const barColor = usedPct >= 85 ? '#ff3366' : usedPct >= 50 ? '#f97316' : '#22c55e';

  return (
    <div className="thumb-modal-overlay" onClick={onClose}>
      <div className="thumb-modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="thumb-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} style={{ width: 36, height: 36, borderRadius: '50%' }} />
            ) : (
              <User size={24} color="var(--accent)" />
            )}
            <div>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-main)', margin: 0 }}>{user?.displayName || 'Authorized User'}</h4>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user?.email}</span>
            </div>
          </div>
          <button onClick={onClose} className="icon-action-btn" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Active Gemini AI Pro Account Card */}
          <div style={{ background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Key size={15} /> Active Gemini AI Token: <strong>way2go2dhruv</strong>
              </span>
              <span style={{ fontSize: '0.65rem', background: '#a855f7', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 600 }}>Connected</span>
            </div>
          </div>
          
          {/* Quota Gauge Header */}
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Activity size={15} color="var(--accent)" /> Daily YouTube API Quota
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: barColor }}>
                {usedPct}% Used
              </span>
            </div>

            {/* Progress Bar */}
            <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', marginBottom: '0.75rem' }}>
              <div style={{ width: `${usedPct}%`, height: '100%', background: barColor, borderRadius: 10, transition: 'width 0.6s' }} />
            </div>

            {/* Quota Numbers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>USED TODAY</span>
                <strong style={{ color: barColor, fontSize: '1.05rem' }}>{quotaStats.unitsUsed.toLocaleString()}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> / 10,000 units</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>REMAINING</span>
                <strong style={{ color: '#22c55e', fontSize: '1.05rem' }}>{quotaStats.unitsRemaining.toLocaleString()}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> units left</span>
              </div>
            </div>
          </div>

          {/* Reset Timer Box */}
          <div style={{ display: 'flex', gap: '0.75rem', background: 'rgba(0, 240, 255, 0.06)', border: '1px solid rgba(0, 240, 255, 0.2)', borderRadius: '12px', padding: '0.85rem 1rem', alignItems: 'center' }}>
            <Clock size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                DAILY QUOTA RESET
              </span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', margin: '0.1rem 0' }}>
                Resets in <span style={{ color: 'var(--accent)' }}>{timeInfo.formattedCountdown}</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                YouTube API resets daily at Midnight PST ({timeInfo.resetLocalTime})
              </span>
            </div>
          </div>

          {/* Firestore Usage & Tracking Stats */}
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem' }}>
            <h5 style={{ color: 'var(--text-main)', fontSize: '0.8rem', marginTop: 0, marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Layers size={14} color="var(--accent)" /> Firestore Database Status
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>CHANNELS</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{quotaStats.channelCount}</strong>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>VIDEOS</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{quotaStats.videoCount}</strong>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>TO-DO ITEMS</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{quotaStats.todoCount || 0}</strong>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>HISTORICAL SNAPSHOTS</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{quotaStats.statsCount || 0}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.65rem' }}>
              {/* Reads / Writes row */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Reads today: <strong>{systemStatus.dailyReads.toLocaleString()}</strong> / 50,000</span>
                <span>Writes today: <strong>{systemStatus.dailyWrites.toLocaleString()}</strong> / 20,000</span>
              </div>

              {/* Last run status badge + time */}
              {systemStatus.lastRunAt && (() => {
                const s = systemStatus.lastStatus;
                const badgeCfg = {
                  success:        { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: <CheckCircle2 size={11} />, label: '✔ Success' },
                  failed:         { color: '#ff3366', bg: 'rgba(255,51,102,0.12)',  icon: <XCircle size={11} />,     label: '✘ Failed' },
                  quota_exceeded: { color: '#f97316', bg: 'rgba(249,115,22,0.15)',  icon: <AlertCircle size={11} />, label: '⚠ Quota Exceeded' },
                  idle:           { color: '#64748b', bg: 'rgba(100,116,139,0.1)',  icon: <Loader size={11} />,      label: 'Idle' },
                };
                const cfg = badgeCfg[s] || badgeCfg.idle;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Last run:</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                      background: cfg.bg, color: cfg.color,
                      border: `1px solid ${cfg.color}50`,
                      borderRadius: '20px', padding: '0.1rem 0.5rem',
                      fontSize: '0.68rem', fontWeight: 600,
                    }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span style={{ color: 'var(--accent)', fontSize: '0.68rem' }}>
                      {timeAgo(systemStatus.lastRunAt)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                      ({systemStatus.lastAction})
                    </span>
                  </div>
                );
              })()}

              {/* Error message for quota_exceeded */}
              {systemStatus.lastStatus === 'quota_exceeded' && systemStatus.lastError && (
                <div style={{ marginTop: '0.25rem', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.65rem', color: '#f97316', wordBreak: 'break-word' }}>
                  {systemStatus.lastError}
                </div>
              )}
            </div>
          </div>

          {/* Quota Breakdown / Efficiency */}
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <h5 style={{ color: 'var(--text-main)', fontSize: '0.8rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Zap size={14} color="#eab308" /> Quota Efficiency Optimization
            </h5>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={12} color="#22c55e" /> Activities API: <strong>1 unit / channel</strong> (vs 100 units search)
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={12} color="#22c55e" /> {quotaStats.channelCount} channels × 4 scans/day = <strong>{(quotaStats.channelCount * 4).toLocaleString()} units/day</strong> total
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={12} color="#22c55e" /> Batch Video API: <strong>1 unit per 50 videos</strong>
              </li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="thumb-modal-footer">
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Firebase Project: fir-c028b</span>
          <button onClick={onClose} className="primary" style={{ fontSize: '0.8rem' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
