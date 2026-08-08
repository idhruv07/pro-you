import React, { useState } from 'react';
import { FileText, Trash2, ExternalLink, Calendar, Tag, ChevronDown, ChevronUp, Copy, Check, Sparkles } from 'lucide-react';

export default function TranscriptsDashboard({ transcripts = [], onDeleteTranscript, onClearAllTranscripts, onReTranscribeVideo }) {
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalItem, setModalItem] = useState(null);
  const [retranscribingId, setRetranscribingId] = useState(null);

  const filteredTranscripts = transcripts.filter(t => {
    const term = searchTerm.toLowerCase();
    return (
      (t.title || '').toLowerCase().includes(term) ||
      (t.channel_name || '').toLowerCase().includes(term) ||
      (t.summary || '').toLowerCase().includes(term) ||
      (t.transcript || '').toLowerCase().includes(term) ||
      (t.topics || []).some(tp => tp.toLowerCase().includes(term))
    );
  });

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <FileText style={{ color: '#a855f7' }} size={24} /> Transcribed Videos ({transcripts.length})
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
            Powered by <strong>OpenAI Whisper & Gemini 2.5 Pro AI</strong>. Verbatim audio speech-to-text transcripts.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {transcripts.length > 0 && onClearAllTranscripts && (
            <button
              onClick={() => {
                if (window.confirm("Clear all saved transcripts from your browser?")) {
                  onClearAllTranscripts();
                }
              }}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
                borderRadius: '8px',
                padding: '0.45rem 0.8rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <Trash2 size={14} /> Clear All Saved
            </button>
          )}

          <input
            type="text"
            placeholder="🔍 Search in transcripts or topics..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              padding: '0.5rem 1rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.85rem',
              width: '260px',
              maxWidth: '100%'
            }}
          />
        </div>
      </div>

      {filteredTranscripts.length === 0 ? (
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed var(--border)',
          borderRadius: '12px',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <Sparkles size={40} style={{ color: '#a855f7', opacity: 0.7, marginBottom: '1rem' }} />
          <h3>No Transcribed Videos Yet</h3>
          <p style={{ fontSize: '0.85rem', maxWidth: '500px', margin: '0.5rem auto 0 auto' }}>
            Click the <strong>🎙️ Transcribe with Gemini Pro</strong> button on any video card in the Feed or Videos tab to automatically transcribe and analyze it here!
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
          {filteredTranscripts.map(item => {
            const isExpanded = expandedId === item.id;
            const ytId = item.youtube_id || (item.url ? item.url.split('v=')[1]?.split('&')[0] : null);
            const highResThumb = item.thumbnail_url || (ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : '');

            return (
              <div key={item.id} style={{
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: '12px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
              }}>
                {/* Header Image */}
                <div style={{ position: 'relative', height: '180px', overflow: 'hidden' }}>
                  {highResThumb ? (
                    <img src={highResThumb} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center' }}>
                      <FileText size={36} style={{ color: '#a855f7' }} />
                    </div>
                  )}
                  <div style={{
                    position: 'absolute',
                    top: '0.5rem',
                    right: '0.5rem',
                    background: 'rgba(0,0,0,0.85)',
                    color: '#a855f7',
                    border: '1px solid rgba(168, 85, 247, 0.5)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '20px',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}>
                    <Sparkles size={12} /> Gemini Pro AI
                  </div>
                </div>

                {/* Card Content */}
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.4rem 0', lineHeight: '1.3' }}>
                    <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#fff', textDecoration: 'none' }}>
                      {item.title} <ExternalLink size={12} style={{ opacity: 0.6 }} />
                    </a>
                  </h3>

                  <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginBottom: '0.6rem' }}>
                    {item.channel_name}
                  </div>

                  {/* Topic Badges */}
                  {Array.isArray(item.topics) && item.topics.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                      {item.topics.map((t, idx) => (
                        <span key={idx} style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Gemini Pro Executive Summary */}
                  <div style={{
                    background: 'rgba(168, 85, 247, 0.08)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    fontSize: '0.78rem',
                    lineHeight: '1.45',
                    color: '#e9d5ff',
                    marginBottom: '0.75rem'
                  }}>
                    <div style={{ fontWeight: 600, color: '#c084fc', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Sparkles size={13} /> Gemini Pro Executive Summary:
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>
                      {item.summary || 'Transcript processing complete. Full transcript available below.'}
                    </div>
                  </div>

                  {/* Full Transcript Collapse */}
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent)',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: 0
                        }}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isExpanded ? 'Hide Full Transcript' : 'View Full Transcript'}
                      </button>

                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          onClick={() => setModalItem(item)}
                          title="Open transcript in full modal view"
                          style={{
                            background: 'rgba(168,85,247,0.15)',
                            border: '1px solid rgba(168,85,247,0.4)',
                            color: '#c084fc',
                            borderRadius: '4px',
                            padding: '0.25rem 0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.2rem'
                          }}
                        >
                          <ExternalLink size={12} /> Full View
                        </button>

                        <button
                          onClick={() => handleCopy(item.id, item.transcript || item.summary)}
                          title="Copy transcript to clipboard"
                          style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--border)',
                            color: '#fff',
                            borderRadius: '4px',
                            padding: '0.25rem 0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.2rem'
                          }}
                        >
                          {copiedId === item.id ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                          {copiedId === item.id ? 'Copied!' : 'Copy'}
                        </button>

                        <button
                          onClick={() => onDeleteTranscript(item.id)}
                          title="Delete transcribed video"
                          style={{
                            background: 'rgba(255,51,102,0.1)',
                            border: '1px solid rgba(255,51,102,0.3)',
                            color: '#ff3366',
                            borderRadius: '4px',
                            padding: '0.25rem 0.4rem',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{
                        marginTop: '0.75rem',
                        background: 'rgba(0,0,0,0.7)',
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        borderRadius: '8px',
                        padding: '0.85rem',
                        maxHeight: '360px',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        fontSize: '0.78rem',
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        color: '#e2e8f0',
                        fontFamily: 'monospace',
                        userSelect: 'text',
                        WebkitOverflowScrolling: 'touch'
                      }}>
                        {item.transcript || 'No detailed transcript text provided.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Transcript Modal */}
      {modalItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1.5rem'
        }} onClick={() => setModalItem(null)}>
          <div style={{
            background: '#0d0d15',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: '16px',
            width: '850px',
            maxWidth: '95vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
            overflow: 'hidden',
            animation: 'fadeIn 0.2s ease'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '1rem',
              background: 'rgba(168, 85, 247, 0.08)'
            }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                  <Sparkles size={14} /> Full AI Transcript Analysis • {modalItem.channel_name}
                </div>
                <h2 style={{ fontSize: '1.1rem', margin: 0, color: '#fff', lineHeight: '1.3' }}>
                  {modalItem.title}
                </h2>
              </div>
              <button
                onClick={() => setModalItem(null)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Content with Scroll */}
            <div style={{
              padding: '1.5rem',
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              WebkitOverflowScrolling: 'touch'
            }}>
              {/* Summary Block */}
              <div style={{
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: '10px',
                padding: '1rem',
                fontSize: '0.85rem',
                lineHeight: '1.5',
                color: '#e9d5ff'
              }}>
                <strong style={{ color: '#c084fc', display: 'block', marginBottom: '0.5rem' }}>
                  🤖 Gemini Pro Executive Summary
                </strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{modalItem.summary}</div>
              </div>

              {/* Full Transcript Text Area */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1' }}>Full Timestamped Transcript</h4>
                  <button
                    onClick={() => handleCopy(modalItem.id, modalItem.transcript || modalItem.summary)}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid var(--border)',
                      color: '#fff',
                      borderRadius: '6px',
                      padding: '0.3rem 0.75rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    {copiedId === modalItem.id ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    {copiedId === modalItem.id ? 'Copied to Clipboard!' : 'Copy Full Text'}
                  </button>
                </div>

                <div style={{
                  background: 'rgba(0,0,0,0.8)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '1.25rem',
                  fontSize: '0.85rem',
                  lineHeight: '1.7',
                  color: '#e2e8f0',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  userSelect: 'text',
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {modalItem.transcript || 'No transcript text available.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
