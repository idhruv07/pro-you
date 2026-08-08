import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  PlaySquare, Plus, RefreshCw, BarChart2, Tv, Video as VideoIcon, 
  LogOut, ShieldAlert, Key, UserCheck, Lock, Trash2, Download, Rss, BookOpen,
  Calendar, Eye, ThumbsUp, Maximize2, Clock, X, ExternalLink, TrendingUp, Tag, UserMinus, Sparkles,
  Search, Square, CheckSquare
} from 'lucide-react';
import { 
  initFirebase, signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider,
  collection, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc, query, where, limit
} from './firebase';
import FeedDashboard, { parseVideoDate, getLocalDateString } from './FeedDashboard';
import TodoDashboard from './TodoDashboard';
import QuotaModal from './QuotaModal';
import CorrelationsDashboard from './CorrelationsDashboard';
import VideoStatsModal from './VideoStatsModal';
import TranscriptsDashboard from './TranscriptsDashboard';
import { deleteVideosBulk, filterDeletedVideos, getYoutubeId } from './utils/VideoDeleter';
import { saveTranscribedVideo, removeTranscribedVideo, fetchLocalWhisperTranscript } from './utils/TranscriptGenerator';
import { FileText } from 'lucide-react';
import './index.css';

import { 
  getSurgeBreakdown, computeSurgeScore, formatDuration, 
  classifyVideoWithAI, computeMLPredictions 
} from './utils/MLPredictor';

const API_BASE = window.location.origin.includes('5173') ? 'http://localhost:8080' : '';

const PRIMARY_ADMIN_EMAIL = "dhruv.bhardwaj1632@gmail.com";

const ALLOWED_EMAILS = [
  "idhruvbhardwaj@gmail.com",
  "dhruv.bhardwaj1632@gmail.com",
  "ijyotidb@gmail.com"
];

const PRE_SEEDED_BLACKLIST = [
  { channel_id: "UC1nhPVQRCW_yjFQfrUM6MaQ", id: "UC1nhPVQRCW_yjFQfrUM6MaQ", name: "车哥测评" },
  { channel_id: "UC3HKlZ_7gxRgef9SCxu54Lw", id: "UC3HKlZ_7gxRgef9SCxu54Lw", name: "Bookmap" },
  { channel_id: "UC7b2A4OTNe5es8aJoAVRDfQ", id: "UC7b2A4OTNe5es8aJoAVRDfQ", name: "KaanPhod Music" },
  { channel_id: "UCDPk9MG2RexnOMGTD-YnSnA", id: "UCDPk9MG2RexnOMGTD-YnSnA", name: "Nat Geo Animals" },
  { channel_id: "UCDXv3XxJ2RsaYqbGgX135Wg", id: "UCDXv3XxJ2RsaYqbGgX135Wg", name: "Aaron Rheins" },
  { channel_id: "UCF09HPp8qsoji3fc2gPIuoQ", id: "UCF09HPp8qsoji3fc2gPIuoQ", name: "Monkey Magic ((Casual))" },
  { channel_id: "UCFa1Wr-QkRTmyhWDhuFwceA", id: "UCFa1Wr-QkRTmyhWDhuFwceA", name: "Cinema Recaps" },
  { channel_id: "UCJWUaIkJrVM02xJp5_OiQGg", id: "UCJWUaIkJrVM02xJp5_OiQGg", name: "Green plants" },
  { channel_id: "UCNU6wftNOiq-jNUHm4VExTg", id: "UCNU6wftNOiq-jNUHm4VExTg", name: "Homedit ®" },
  { channel_id: "UCNr9dFN7KPxU3aERWmvbR7w", id: "UCNr9dFN7KPxU3aERWmvbR7w", name: "Reacting with Ben" },
  { channel_id: "UCQ553Rv2sTyStBwNhArLHYA", id: "UCQ553Rv2sTyStBwNhArLHYA", name: "Stupid Raisins" },
  { channel_id: "UCQprMsG-raCIMlBudm20iLQ", id: "UCQprMsG-raCIMlBudm20iLQ", name: "FOSSASIA" },
  { channel_id: "UCTAgbu2l6_rBKdbTvEodEDw", id: "UCTAgbu2l6_rBKdbTvEodEDw", name: "Nerdist" },
  { channel_id: "UCTyuUxbflOZ0nESSnJBMpbg", id: "UCTyuUxbflOZ0nESSnJBMpbg", name: "Nick Kendall" },
  { channel_id: "UCbIClfnuj--IWCWE8KYfGLQ", id: "UCbIClfnuj--IWCWE8KYfGLQ", name: "BM Maniya-NZ Vlogs" },
  { channel_id: "UCf8SRqLSd_Tl5zpvfgS6WBw", id: "UCf8SRqLSd_Tl5zpvfgS6WBw", name: "Travel Hacking Tips WITHOUT Juggling Credit Cards" },
  { channel_id: "UCgubZxryzxP5IwMinVnfgwQ", id: "UCgubZxryzxP5IwMinVnfgwQ", name: "Yunus Fitness | Calisthenics & Parkour" }
];

function App() {
  const [firebaseInstance, setFirebaseInstance] = useState(null);
  const [user, setUser] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isGuest, setIsGuest] = useState(() => sessionStorage.getItem('is_guest_mode') === 'true');
  const [guestPassInput, setGuestPassInput] = useState('');
  const [guestError, setGuestError] = useState('');
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  const GUEST_PASS_HASH = "9c5a213d03d2aad9633d5fd84b958ac65d6fe80df4889e07640595a02533c26c";

  const handleGuestLogin = async (pass) => {
    const trimmed = (pass || '').trim();
    if (!trimmed) {
      setGuestError('❌ Please enter the Guest password.');
      return;
    }
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(trimmed);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (hexHash === GUEST_PASS_HASH) {
        sessionStorage.setItem('is_guest_mode', 'true');
        setIsGuest(true);
        setIsAuthorized(true);
        setUser({
          email: 'guest@viewonly.local',
          displayName: 'Guest (View Only)',
          isGuest: true
        });
        setGuestError('');
        const fb = firebaseInstance || initFirebase();
        if (fb) {
          fetchData(fb);
        }
      } else {
        setGuestError('❌ Invalid Guest Password');
      }
    } catch (e) {
      console.error("Hash calculation error:", e);
      setGuestError('❌ Error verifying password');
    }
  };
  const [selectedThumb, setSelectedThumb] = useState(null);
  const [selectedChartVideo, setSelectedChartVideo] = useState(null);
  const [activeMLTopicModal, setActiveMLTopicModal] = useState(null);
  const [filterDate, setFilterDate] = useState('all');
  const [filterViews, setFilterViews] = useState('all');
  const [filterVelocity, setFilterVelocity] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterGenre, setFilterGenre] = useState('all');
  const [filterML, setFilterML] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('surge'); // 'surge' | 'quality' | 'velocity' | 'views' | 'date'
  const [currentPage, setCurrentPage] = useState(1);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInputVal, setPageInputVal] = useState('');

  // Reset pagination to page 1 whenever any filter or sorting changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterDate, filterViews, filterVelocity, filterType, filterGenre, filterML, sortBy]);
  
  const [activeTab, setActiveTab] = useState('feed');
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [blacklistedChannels, setBlacklistedChannels] = useState(PRE_SEEDED_BLACKLIST);
  const [transcripts, setTranscripts] = useState(() => {
    try {
      const saved = localStorage.getItem('ddj_transcribed_videos');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [loadingTranscribeId, setLoadingTranscribeId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const mlPredictions = useMemo(() => computeMLPredictions(videos), [videos]);

  const handleOpenThumbModal = async (video) => {
    const ytId = video.youtube_id || (video.url ? video.url.split('v=')[1]?.split('&')[0] : null);
    const highResUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : video.thumbnail_url;
    
    // Set initial state with current preview description
    setSelectedThumb({
      url: highResUrl,
      title: video.title,
      channel: video.channel_name,
      videoUrl: video.url,
      description: video.description || ''
    });

    // If description is truncated, load the full description on-demand
    if (video.description && video.description.endsWith('...') && firebaseInstance?.firestore && video.id) {
      try {
        const docRef = doc(firebaseInstance.firestore, 'videos', video.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const fullDesc = docSnap.data().description;
          setSelectedThumb(prev => prev ? { ...prev, description: fullDesc || prev.description } : null);
        }
      } catch (err) {
        console.error("Failed to load full description on-demand:", err);
      }
    }
  };

  // Initialize Firebase instance
  useEffect(() => {
    try {
      const fb = initFirebase();
      if (fb) {
        setFirebaseInstance(fb);

        // Check if previously logged in as guest
        if (sessionStorage.getItem('is_guest_mode') === 'true') {
          setIsGuest(true);
          setIsAuthorized(true);
          setUser({
            email: 'guest@viewonly.local',
            displayName: 'Guest (View Only)',
            isGuest: true
          });
          fetchData(fb);
          setAuthLoading(false);
          return;
        }

        const unsubscribe = onAuthStateChanged(fb.auth, async (currentUser) => {
          if (currentUser) {
            const email = currentUser.email.toLowerCase();
            const allowed = ALLOWED_EMAILS.includes(email);
            setIsAuthorized(allowed);
            setUser(currentUser);

            if (allowed) {
              try {
                const token = await currentUser.getIdToken();
                axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
              } catch (e) {
                console.error("Token error:", e);
              }
              fetchData(fb);
            }
          } else if (sessionStorage.getItem('is_guest_mode') !== 'true') {
            setUser(null);
            setIsAuthorized(false);
            setGoogleAccessToken('');
            delete axios.defaults.headers.common['Authorization'];
          }
          setAuthLoading(false);
        });
        return () => unsubscribe();
      } else {
        setAuthLoading(false);
      }
    } catch (err) {
      console.error("Firebase init error:", err);
      setErrorMsg("Initialization error: " + err.message);
      setAuthLoading(false);
    }
  }, []);

  const handleGoogleSignIn = async () => {
    if (!firebaseInstance) return;
    try {
      setAuthLoading(true);
      setErrorMsg('');
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
      const result = await signInWithPopup(firebaseInstance.auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleAccessToken(credential.accessToken);
        localStorage.setItem('YT_ACCESS_TOKEN', credential.accessToken);
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setErrorMsg("Google Sign-In failed: " + err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    if (firebaseInstance && !isGuest) {
      signOut(firebaseInstance.auth);
    }
    sessionStorage.removeItem('is_guest_mode');
    setIsGuest(false);
    setUser(null);
    setIsAuthorized(false);
    setGoogleAccessToken('');
    localStorage.removeItem('YT_ACCESS_TOKEN');
  };

  // ── 30-Minute Auto Logout on Inactivity ──────────────────────
  useEffect(() => {
    if (!user || !isAuthorized) return;

    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
    let timeoutId;

    const resetInactivityTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        console.warn("Session timed out after 30 minutes of inactivity. Redirecting to login page...");
        handleSignOut();
      }, INACTIVITY_LIMIT_MS);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    activityEvents.forEach(evt => window.addEventListener(evt, resetInactivityTimer, { passive: true }));

    resetInactivityTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach(evt => window.removeEventListener(evt, resetInactivityTimer));
    };
  }, [user, isAuthorized]);

  const fetchData = async (fb = firebaseInstance) => {
    const mergeBlacklist = (list) => {
      const merged = [...PRE_SEEDED_BLACKLIST];
      (list || []).forEach(item => {
        const id = item.channel_id || item.id;
        if (id && !merged.some(m => m.channel_id === id || m.id === id)) {
          merged.push(item);
        }
      });
      return merged;
    };

    let fetchedFromApi = false;
    let rawVideos = [];
    let rawChannels = [];

    if (API_BASE) {
      try {
        const [vidRes, chanRes, catRes, blackRes] = await Promise.all([
          axios.get(`${API_BASE}/api/videos`),
          axios.get(`${API_BASE}/api/channels`),
          axios.get(`${API_BASE}/api/categories`),
          axios.get(`${API_BASE}/api/channels/blacklisted`).catch(() => ({ data: [] }))
        ]);
        rawVideos = Array.isArray(vidRes.data) ? vidRes.data : [];
        rawChannels = Array.isArray(chanRes.data) ? chanRes.data : [];
        setCategories(Array.isArray(catRes.data) ? catRes.data : []);
        
        const apiBlacklist = Array.isArray(blackRes?.data) ? blackRes.data : [];
        setBlacklistedChannels(mergeBlacklist(apiBlacklist));
        
        fetchedFromApi = true;
      } catch (error) {
        console.warn("FastAPI fetch failed, falling back to direct Firestore:", error);
      }
    }

    if (!fetchedFromApi && fb?.firestore) {
      try {
        // Load videos from dashboard cache document
        const summaryDoc = await getDoc(doc(fb.firestore, 'cache', 'dashboard_summary'));
        if (summaryDoc.exists()) {
          const data = summaryDoc.data();
          rawVideos = data.videos || [];
          
          const chunksCount = data.chunks_count || 1;
          if (chunksCount > 1) {
            const chunkPromises = [];
            for (let i = 1; i < chunksCount; i++) {
              chunkPromises.push(getDoc(doc(fb.firestore, 'cache', `dashboard_summary_${i}`)));
            }
            const chunkDocs = await Promise.all(chunkPromises);
            chunkDocs.forEach(cDoc => {
              if (cDoc.exists() && cDoc.data().videos) {
                rawVideos = rawVideos.concat(cDoc.data().videos);
              }
            });
          }
        } else {
          // Fallback to direct collection query (limit to 400 docs to guard quota)
          const vSnap = await getDocs(query(collection(fb.firestore, 'videos'), limit(400)));
          rawVideos = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        let rawBlacklist = [];
        // First try to fetch blacklisted channels directly from the collection for real-time accuracy
        try {
          const bSnap = await getDocs(collection(fb.firestore, 'blacklisted_channels'));
          rawBlacklist = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
          console.warn("Direct blacklist query failed, falling back to cache:", e);
        }

        // Load channels from channels cache document
        const channelsDoc = await getDoc(doc(fb.firestore, 'cache', 'channels_summary'));
        if (channelsDoc.exists()) {
          const data = channelsDoc.data();
          rawChannels = data.channels || [];
          if (rawBlacklist.length === 0) {
            rawBlacklist = data.blacklisted_channels || [];
          }
        } else {
          // Fallback to direct collection query (limit to 150 docs to guard quota)
          const cSnap = await getDocs(query(collection(fb.firestore, 'channels'), limit(150)));
          rawChannels = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          if (rawBlacklist.length === 0) {
            try {
              const bSnap = await getDocs(query(collection(fb.firestore, 'blacklisted_channels'), limit(150)));
              rawBlacklist = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
              console.error("Direct blacklist query failed:", e);
            }
          }
        }
        setBlacklistedChannels(mergeBlacklist(rawBlacklist));
      } catch (err) {
        console.error("Direct Firestore cache fetch error:", err);
        const errStr = String(err);
        if (errStr.includes("quota") || errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED")) {
          // Do not attempt direct query scans when quota is exhausted
          rawVideos = [];
          rawChannels = [];
          setBlacklistedChannels(PRE_SEEDED_BLACKLIST);
        } else {
          try {
            const vSnap = await getDocs(query(collection(fb.firestore, 'videos'), limit(400)));
            rawVideos = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            const cSnap = await getDocs(query(collection(fb.firestore, 'channels'), limit(150)));
            rawChannels = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const bSnap = await getDocs(query(collection(fb.firestore, 'blacklisted_channels'), limit(150)));
            const rawBlacklist = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setBlacklistedChannels(mergeBlacklist(rawBlacklist));
          } catch (e) {
            console.error("Direct Firestore fallback fetch error:", e);
          }
        }
      }
      
      // Trigger background sync if there are pending unsubscribed channels in local blacklist
      try {
        const blacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
        if (blacklist.length > 0) {
          syncLocalBlacklistWithFirestore(fb).catch(console.error);
        }
      } catch (e) {}
    }

    // Apply local storage blacklist + remote Firestore blacklist safety filter
    try {
      const localBlacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
      const combinedBlacklist = [...(blacklistedChannels || []), ...localBlacklist];
      if (combinedBlacklist.length > 0) {
        rawVideos = rawVideos.filter(v => 
          !combinedBlacklist.some(item => 
            (item.id && v.channel_id === item.id) || 
            (item.channel_id && v.channel_id === item.channel_id) ||
            (item.name && v.channel_name && v.channel_name.toLowerCase() === item.name.toLowerCase())
          )
        );
        rawChannels = rawChannels.filter(c => 
          !combinedBlacklist.some(item => 
            (item.id && c.channel_id === item.id) || 
            (item.channel_id && c.channel_id === item.channel_id) ||
            (item.name && c.channel_name && c.channel_name.toLowerCase() === item.name.toLowerCase()) ||
            (item.name && c.name && c.name.toLowerCase() === item.name.toLowerCase())
          )
        );
      }
    } catch (e) {
      console.error("Failed to apply blacklist filter:", e);
    }

    rawVideos = filterDeletedVideos(rawVideos);
    setVideos(rawVideos);
    setChannels(rawChannels);
  };

  // Bulk selection & deletion state for App "All Videos" grid
  const [selectedAppVideos, setSelectedAppVideos] = useState(new Set());
  const [isAppDeleting, setIsAppDeleting] = useState(false);
  const [feedRefreshTrigger, setFeedRefreshTrigger] = useState(0);

  const toggleAppSelectVideo = (video) => {
    const key = getYoutubeId(video);
    if (!key) return;
    setSelectedAppVideos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAppBulkDelete = async () => {
    if (selectedAppVideos.size === 0) return;

    let confirmMsg = `Are you sure you want to permanently delete and blacklist ${selectedAppVideos.size} selected video(s)?`;
    if (paginatedVideos.length > 0 && selectedAppVideos.size === paginatedVideos.length && isAppAllPageSelected) {
      confirmMsg = `Are you sure you want to permanently delete and blacklist ONLY the ${selectedAppVideos.size} video(s) visible on the CURRENT PAGE?\n\n(No other videos or search results outside this page will be deleted).`;
    } else if (searchQuery && selectedAppVideos.size === safeVideos.length) {
      confirmMsg = `Are you sure you want to permanently delete and blacklist all ${selectedAppVideos.size} video(s) matching search "${searchQuery}" across all pages?`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsAppDeleting(true);
    try {
      const fb = firebaseInstance || initFirebase();
      const vidsToDelete = videos.filter(v => {
        const yid = getYoutubeId(v);
        return yid && selectedAppVideos.has(yid);
      });

      const res = await deleteVideosBulk(fb?.firestore, vidsToDelete);
      setIsAppDeleting(false);

      // Always update local UI state immediately for responsive feedback
      setVideos(prev => prev.filter(v => {
        const yid = getYoutubeId(v);
        return !yid || !selectedAppVideos.has(yid);
      }));
      setSelectedAppVideos(new Set());
      setFeedRefreshTrigger(prev => prev + 1);

      if (API_BASE) {
        try { await axios.post(`${API_BASE}/api/admin/trigger-cache`); } catch (e) {}
      }

      if (!res.success) {
        alert("⚠️ Cloud database quota limit exceeded. Videos have been successfully blacklisted locally for this session.");
      }
    } catch (err) {
      setIsAppDeleting(false);
      console.error("Bulk delete error:", err);
    }
  };

  const handleAddVideo = async (e) => {
    e.preventDefault();
    if (!newUrl) return;
    setLoading(true);
    try {
      if (API_BASE) {
        await axios.post(`${API_BASE}/api/videos`, { url: newUrl });
      } else if (firebaseInstance?.firestore) {
        // Direct add via Firestore & YouTube OEmbed
        const res = await axios.get(`https://noembed.com/embed?url=${encodeURIComponent(newUrl)}`);
        await addDoc(collection(firebaseInstance.firestore, 'videos'), {
          url: newUrl,
          title: res.data.title || newUrl,
          channel_name: res.data.author_name || 'YouTube',
          thumbnail_url: res.data.thumbnail_url || '',
          created_at: new Date().toISOString(),
          view_count: 0,
          added_by: user?.email
        });
      }
      setNewUrl('');
      fetchData();
    } catch (error) {
      console.error("Failed to add video:", error);
      alert(error.response?.data?.detail || "Failed to add video.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (e) => {
    e.preventDefault();
    if (isGuest) { alert("⚠️ Guest mode is view-only. Action disabled."); return; }
    if (!newUrl) return;
    setLoading(true);
    try {
      if (API_BASE) {
        await axios.post(`${API_BASE}/api/channels`, { url: newUrl });
      } else if (firebaseInstance?.firestore) {
        await addDoc(collection(firebaseInstance.firestore, 'channels'), {
          url: newUrl,
          name: newUrl.split('/').pop() || 'Channel',
          created_at: new Date().toISOString(),
          added_by: user?.email
        });
      }
      setNewUrl('');
      fetchData();
    } catch (error) {
      console.error("Failed to add channel:", error);
      alert(error.response?.data?.detail || "Failed to add channel.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVideo = async (id) => {
    if (isGuest) { alert("⚠️ Guest mode is view-only. Action disabled."); return; }
    if (!window.confirm("Are you sure you want to remove this video?")) return;
    
    const video = videos.find(v => v.id === id) || { id };

    // Filter local state instantly so the video disappears immediately
    setVideos(prev => prev.filter(v => v.id !== id));
    sessionStorage.removeItem('ddj_feed_session_cache');

    try {
      // Use deleteVideosBulk utility to update localStorage, system/deleted_videos_blacklist, and videos collection
      await deleteVideosBulk(firebaseInstance?.firestore, [video]);
      if (API_BASE) {
        try { await axios.delete(`${API_BASE}/api/videos/${id}`); } catch (e) {}
      }
      fetchData();
    } catch (error) {
      console.error("Failed to delete video:", error);
      alert("Failed to remove video.");
    }
  };

  const handleDeleteChannel = async (id) => {
    if (isGuest) { alert("⚠️ Guest mode is view-only. Action disabled."); return; }
    if (!window.confirm("Are you sure you want to remove this channel and all its videos?")) return;
    try {
      // Find the channel in local state to get its channel_id and name
      const chan = channels.find(c => c.id === id || c.channel_id === id);
      const ytChannelId = chan?.channel_id || id;
      const channelName = chan?.channel_name || chan?.name || "";

      if (firebaseInstance?.firestore) {
        // Delete channel doc
        await deleteDoc(doc(firebaseInstance.firestore, 'channels', id));
        
        // Delete videos belonging to this channel
        const vQ = query(collection(firebaseInstance.firestore, 'videos'), where('channel_id', '==', ytChannelId));
        const vSnap = await getDocs(vQ);
        const deletePromises = vSnap.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);

        // Add to blacklisted_channels to prevent re-importing
        try {
          await setDoc(doc(firebaseInstance.firestore, 'blacklisted_channels', ytChannelId), {
            channel_id: ytChannelId,
            name: channelName,
            blacklisted_at: new Date().toISOString(),
            blacklisted_by: user?.email || 'client_action'
          });
        } catch (e) {
          console.error("Failed to write to blacklisted_channels:", e);
        }
      }

      if (API_BASE) {
        try {
          await axios.delete(`${API_BASE}/api/channels/${id}`);
        } catch (e) {
          console.error("Backend delete channel failed:", e);
        }
      }

      // Filter local state instantly
      const filteredVideos = videos.filter(v => v.channel_id !== ytChannelId && v.channel_name !== channelName);
      const filteredChannels = channels.filter(c => c.id !== id && c.channel_id !== ytChannelId);
      setVideos(filteredVideos);
      setChannels(filteredChannels);

      const cid = ytChannelId || id;
      if (cid) {
        setBlacklistedChannels(prev => {
          const updated = [...prev];
          if (!updated.some(c => c.channel_id === cid || c.id === cid)) {
            updated.push({ channel_id: cid, id: cid, name: channelName });
          }
          return updated;
        });
      }

      // Save to local blacklist (so it filters out even if Firestore is quota-limited/offline)
      try {
        const blacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
        if (!blacklist.some(item => (ytChannelId && item.id === ytChannelId) || (channelName && item.name === channelName))) {
          blacklist.push({ id: ytChannelId, name: channelName });
          localStorage.setItem('ddj_unsubscribed_channels', JSON.stringify(blacklist));
        }
      } catch (e) {
        console.error("Failed to update local blacklist:", e);
      }

      // Rewrite cache in Firestore directly
      if (firebaseInstance?.firestore) {
        try {
          const summaryRef = doc(firebaseInstance.firestore, 'cache', 'dashboard_summary');
          const summaryDoc = await getDoc(summaryRef);
          if (summaryDoc.exists()) {
            const data = summaryDoc.data();
            const cacheVids = (data.videos || []).filter(v => v.channel_id !== ytChannelId && v.channel_name !== channelName);
            await setDoc(summaryRef, { ...data, videos: cacheVids });
          }

          const channelsRef = doc(firebaseInstance.firestore, 'cache', 'channels_summary');
          const channelsDoc = await getDoc(channelsRef);
          if (channelsDoc.exists()) {
            const data = channelsDoc.data();
            const cacheChans = (data.channels || []).filter(c => c.id !== id && c.channel_id !== ytChannelId);
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
      
      // Clear Feed session cache to force reload on tab switch
      sessionStorage.removeItem('ddj_feed_session_cache');
    } catch (error) {
      console.error("Failed to remove channel:", error);
      alert("Failed to remove channel.");
    }
  };

  const handleUnsubscribeFromVideo = async (channelName, channelId) => {
    if (isGuest) { alert("⚠️ Guest mode is view-only. Action disabled."); return; }
    if (!window.confirm(`Are you sure you want to unsubscribe from "${channelName}" and remove its videos?`)) return;
    try {
      if (firebaseInstance?.firestore) {
        // Find channel document to delete
        let channelDocId = null;
        if (channelId) {
          const cQ = query(collection(firebaseInstance.firestore, 'channels'), where('channel_id', '==', channelId));
          const cSnap = await getDocs(cQ);
          for (const d of cSnap.docs) {
            channelDocId = d.id;
            await deleteDoc(d.ref);
          }
          await setDoc(doc(firebaseInstance.firestore, 'blacklisted_channels', channelId), {
            channel_id: channelId,
            name: channelName || channelId,
            blacklisted_at: new Date().toISOString()
          });
        } else if (channelName) {
          const cQ = query(collection(firebaseInstance.firestore, 'channels'), where('channel_name', '==', channelName));
          const cSnap = await getDocs(cQ);
          for (const d of cSnap.docs) {
            channelDocId = d.id;
            await deleteDoc(d.ref);
          }
          await setDoc(doc(firebaseInstance.firestore, 'blacklisted_channels', channelName), {
            channel_id: null,
            name: channelName,
            blacklisted_at: new Date().toISOString()
          });
        }

        // Delete videos
        if (channelId) {
          const vQ = query(collection(firebaseInstance.firestore, 'videos'), where('channel_id', '==', channelId));
          const vSnap = await getDocs(vQ);
          const deletePromises = vSnap.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
        } else if (channelName) {
          const vQ = query(collection(firebaseInstance.firestore, 'videos'), where('channel_name', '==', channelName));
          const vSnap = await getDocs(vQ);
          const deletePromises = vSnap.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
        }
      }

      // If channelId is not present, find it from local channels state
      const targetId = channelId || channels.find(c => c.channel_name === channelName || c.name === channelName)?.channel_id;

      if (API_BASE && targetId) {
        try {
          await axios.delete(`${API_BASE}/api/channels/${targetId}`);
        } catch (e) {
          console.error("Backend delete channel failed:", e);
        }
      }

      // Filter local state instantly
      const filteredVideos = videos.filter(v => v.channel_name !== channelName && v.channel_id !== channelId);
      const filteredChannels = channels.filter(c => c.channel_name !== channelName && c.channel_id !== channelId);
      setVideos(filteredVideos);
      setChannels(filteredChannels);

      const cid = channelId || targetId;
      if (cid) {
        setBlacklistedChannels(prev => {
          const updated = [...prev];
          if (!updated.some(c => c.channel_id === cid || c.id === cid)) {
            updated.push({ channel_id: cid, id: cid, name: channelName });
          }
          return updated;
        });
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

      // Rewrite cache in Firestore directly
      if (firebaseInstance?.firestore) {
        try {
          const summaryRef = doc(firebaseInstance.firestore, 'cache', 'dashboard_summary');
          const summaryDoc = await getDoc(summaryRef);
          if (summaryDoc.exists()) {
            const data = summaryDoc.data();
            const cacheVids = (data.videos || []).filter(v => v.channel_name !== channelName && v.channel_id !== channelId);
            await setDoc(summaryRef, { ...data, videos: cacheVids });
          }

          const channelsRef = doc(firebaseInstance.firestore, 'cache', 'channels_summary');
          const channelsDoc = await getDoc(channelsRef);
          if (channelsDoc.exists()) {
            const data = channelsDoc.data();
            const cacheChans = (data.channels || []).filter(c => c.channel_name !== channelName && c.channel_id !== channelId);
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

      // Clear Feed session cache to force reload on tab switch
      sessionStorage.removeItem('ddj_feed_session_cache');
    } catch (error) {
      console.error("Unsubscribe error:", error);
      alert("Failed to unsubscribe channel.");
    }
  };

  const handleRestoreChannel = async (channelId, channelName) => {
    try {
      // 1. Remove from localStorage blacklist
      let blacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
      blacklist = blacklist.filter(item => 
        !(channelId && item.id === channelId) && 
        !(channelName && item.name === channelName)
      );
      localStorage.setItem('ddj_unsubscribed_channels', JSON.stringify(blacklist));

      // 2. Remove from Firestore blacklisted_channels collection if available
      if (firebaseInstance?.firestore) {
        try {
          if (channelId) {
            await deleteDoc(doc(firebaseInstance.firestore, 'blacklisted_channels', channelId));
          } else if (channelName) {
            await deleteDoc(doc(firebaseInstance.firestore, 'blacklisted_channels', channelName));
          }
        } catch (e) {
          console.error("Failed to delete from Firestore blacklisted_channels:", e);
        }
      }

      // 3. Clear Feed session cache
      sessionStorage.removeItem('ddj_feed_session_cache');

      // 3. Re-subscribe on backend if available
      if (API_BASE && channelId) {
        try {
          await axios.post(`${API_BASE}/api/channels`, { url: `https://www.youtube.com/channel/${channelId}` });
        } catch (e) {
          console.error("Backend subscribe channel failed:", e);
        }
      }

      alert(`"${channelName}" has been successfully restored! Videos will reappear when data is refreshed.`);
      fetchData();
    } catch (err) {
      console.error("Error restoring channel:", err);
    }
  };

  const syncLocalBlacklistWithFirestore = async (fb = firebaseInstance) => {
    if (!fb?.firestore) return;
    try {
      const blacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
      if (blacklist.length === 0) return;

      console.log(`Syncing local blacklist (${blacklist.length} channels) to Firestore...`);

      for (const item of blacklist) {
        const { id: channelId, name: channelName } = item;
        
        if (channelId) {
          const cQ = query(collection(fb.firestore, 'channels'), where('channel_id', '==', channelId));
          const cSnap = await getDocs(cQ);
          for (const d of cSnap.docs) {
            await deleteDoc(d.ref);
          }
          await setDoc(doc(fb.firestore, 'blacklisted_channels', channelId), {
            channel_id: channelId,
            name: channelName || channelId,
            blacklisted_at: new Date().toISOString()
          });
        } else if (channelName) {
          const cQ = query(collection(fb.firestore, 'channels'), where('channel_name', '==', channelName));
          const cSnap = await getDocs(cQ);
          for (const d of cSnap.docs) {
            await deleteDoc(d.ref);
          }
          await setDoc(doc(fb.firestore, 'blacklisted_channels', channelName), {
            channel_id: null,
            name: channelName,
            blacklisted_at: new Date().toISOString()
          });
        }

        if (channelId) {
          const vQ = query(collection(fb.firestore, 'videos'), where('channel_id', '==', channelId));
          const vSnap = await getDocs(vQ);
          const deletePromises = vSnap.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
        } else if (channelName) {
          const vQ = query(collection(fb.firestore, 'videos'), where('channel_name', '==', channelName));
          const vSnap = await getDocs(vQ);
          const deletePromises = vSnap.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
        }

        if (channelName) {
          const tQ = query(collection(fb.firestore, 'todo'), where('channel_name', '==', channelName));
          const tSnap = await getDocs(tQ);
          for (const d of tSnap.docs) {
            await deleteDoc(d.ref);
          }
        }
      }

      const summaryRef = doc(fb.firestore, 'cache', 'dashboard_summary');
      const summaryDoc = await getDoc(summaryRef);
      if (summaryDoc.exists()) {
        const data = summaryDoc.data();
        let cacheVids = data.videos || [];
        for (const item of blacklist) {
          cacheVids = cacheVids.filter(v => 
            v.channel_id !== item.id && 
            (!v.channel_name || v.channel_name.toLowerCase() !== item.name?.toLowerCase())
          );
        }
        await setDoc(summaryRef, { ...data, videos: cacheVids });
      }

      const channelsRef = doc(fb.firestore, 'cache', 'channels_summary');
      const channelsDoc = await getDoc(channelsRef);
      if (channelsDoc.exists()) {
        const data = channelsDoc.data();
        let cacheChans = data.channels || [];
        for (const item of blacklist) {
          cacheChans = cacheChans.filter(c => 
            c.channel_id !== item.id && 
            (!c.channel_name || c.channel_name.toLowerCase() !== item.name?.toLowerCase()) &&
            (!c.name || c.name.toLowerCase() !== item.name?.toLowerCase())
          );
        }
        await setDoc(channelsRef, { 
          ...data,
          channels: cacheChans,
          channels_count: cacheChans.length
        });
      }

      console.log("Firestore sync for blacklisted channels completed successfully!");
      localStorage.removeItem('ddj_unsubscribed_channels');
    } catch (syncErr) {
      console.warn("Could not sync local blacklist to Firestore (quota likely still exceeded):", syncErr);
    }
  };

  const handleImportSubscriptions = async () => {
    if (!firebaseInstance) return;
    setImporting(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
      const result = await signInWithPopup(firebaseInstance.auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (!token) {
        alert("Could not obtain YouTube permission from Google.");
        setImporting(false);
        return;
      }

      // Fetch ALL subscriptions using pagination (nextPageToken)
      let allItems = [];
      let pageToken = '';

      do {
        const url = `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        const items = res.data.items || [];
        allItems.push(...items);
        pageToken = res.data.nextPageToken || '';
      } while (pageToken);
      
      if (allItems.length === 0) {
        alert("No YouTube subscriptions found for this account.");
        setImporting(false);
        return;
      }

      // Fetch blacklist to skip previously unsubscribed/blacklisted channels
      let blacklistedIds = new Set();
      if (firebaseInstance?.firestore) {
        try {
          const snap = await getDocs(collection(firebaseInstance.firestore, 'blacklisted_channels'));
          snap.docs.forEach(doc => blacklistedIds.add(doc.id));
        } catch (e) {
          console.warn("Could not fetch blacklisted channels:", e);
        }
      }

      let addedCount = 0;
      let lastError = null;
      for (const item of allItems) {
        const channelId = item.snippet.resourceId.channelId;
        const channelUrl = `https://www.youtube.com/channel/${channelId}`;
        const channelName = item.snippet.title;
        const thumbnail = item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url;

        if (blacklistedIds.has(channelId)) {
          console.log(`Skipping blacklisted channel during import: ${channelName} (${channelId})`);
          continue;
        }

        try {
          if (API_BASE) {
            await axios.post(`${API_BASE}/api/channels`, { url: channelUrl });
          } else if (firebaseInstance?.firestore) {
            await setDoc(doc(firebaseInstance.firestore, 'channels', channelId), {
              channel_id: channelId,
              url: channelUrl,
              name: channelName,
              thumbnail_url: thumbnail || '',
              created_at: new Date().toISOString(),
              added_by: user?.email || ''
            });
          }
          addedCount++;
        } catch (e) {
          console.error(`Failed to save channel ${channelName}:`, e);
          lastError = e.message || String(e);
        }
      }

      if (addedCount === 0 && lastError) {
        alert(`Could not save subscriptions to Database: ${lastError}`);
      } else {
        alert(`Imported ${addedCount} out of ${allItems.length} YouTube subscriptions!`);
      }
      fetchData();
    } catch (err) {
      console.error("Error importing subscriptions:", err);
      const apiErr = err.response?.data?.error?.message;
      alert("Could not import subscriptions: " + (apiErr || err.message));
    } finally {
      setImporting(false);
    }
  };

  const safeVideos = useMemo(() => {
    let result = Array.isArray(videos) ? videos : [];
    const now = new Date();
    const todayLocalStr = getLocalDateString(now);
    const yesterdayLocalStr = getLocalDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (filterDate === 'today') {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        return getLocalDateString(d) === todayLocalStr || d >= cutoff24h;
      });
    } else if (filterDate === 'yesterday') {
      result = result.filter(v => {
        const d = parseVideoDate(v.published_at || v.created_at);
        return getLocalDateString(d) === yesterdayLocalStr || (d >= cutoff48h && d < cutoff24h);
      });
    } else if (filterDate === 'week') {
      result = result.filter(v => parseVideoDate(v.published_at || v.created_at) >= weekStart);
    }

    if (filterViews === '1m') {
      result = result.filter(v => (v.view_count || 0) >= 1000000);
    } else if (filterViews === '100k') {
      result = result.filter(v => (v.view_count || 0) >= 100000);
    } else if (filterViews === '10k') {
      result = result.filter(v => (v.view_count || 0) >= 10000);
    }

    if (filterVelocity === 'high') {
      result = result.filter(v => (v.velocity || 0) >= 1000);
    } else if (filterVelocity === 'gaining') {
      result = result.filter(v => (v.velocity || 0) >= 100 && (v.velocity || 0) < 1000);
    }

    if (filterType === 'long') {
      result = result.filter(v => !v.is_short);
    } else if (filterType === 'shorts') {
      result = result.filter(v => v.is_short);
    }

    if (filterGenre !== 'all') {
      result = result.filter(v => (v.topic_labels || []).includes(filterGenre));
    }

    if (filterML) {
      result = result.filter(v => mlPredictions.has(v.id));
    }

    if (searchQuery && searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(v => 
        (v.title && v.title.toLowerCase().includes(q)) ||
        (v.channel_name && v.channel_name.toLowerCase().includes(q)) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        (v.topic_labels && v.topic_labels.some(t => t.toLowerCase().includes(q)))
      );
    }

    // Sort videos
    result.sort((a, b) => {
      if (sortBy === 'surge') {
        return (getSurgeBreakdown(b).rawTotal || 0) - (getSurgeBreakdown(a).rawTotal || 0);
      }
      if (sortBy === 'velocity') {
        return (b.velocity || 0) - (a.velocity || 0);
      }
      if (sortBy === 'views') {
        return (b.view_count || 0) - (a.view_count || 0);
      }
      if (sortBy === 'date') {
        return parseVideoDate(b.published_at || b.created_at) - parseVideoDate(a.published_at || a.created_at);
      }
      // Default: quality score
      return (b.quality_score || 0) - (a.quality_score || 0);
    });

    return result;
  }, [videos, filterDate, filterViews, filterVelocity, filterType, filterGenre, filterML, searchQuery, sortBy]);

  const ITEMS_PER_PAGE = 24;
  const totalPages = Math.ceil(safeVideos.length / ITEMS_PER_PAGE);
  const paginatedVideos = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return safeVideos.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [safeVideos, currentPage]);

  // Adjust out-of-bounds page numbers when items are deleted
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const isAppAllPageSelected = paginatedVideos.length > 0 && paginatedVideos.every(v => {
    const yid = getYoutubeId(v);
    return yid && selectedAppVideos.has(yid);
  });

  const isAppAllFilteredSelected = safeVideos.length > 0 && safeVideos.every(v => {
    const yid = getYoutubeId(v);
    return yid && selectedAppVideos.has(yid);
  });

  const toggleAppSelectAllPage = () => {
    if (isAppAllPageSelected) {
      setSelectedAppVideos(prev => {
        const next = new Set(prev);
        paginatedVideos.forEach(v => {
          const yid = getYoutubeId(v);
          if (yid) next.delete(yid);
        });
        return next;
      });
    } else {
      const pageKeys = paginatedVideos.map(v => getYoutubeId(v)).filter(Boolean);
      setSelectedAppVideos(new Set(pageKeys));
    }
  };

  const toggleAppSelectAllFiltered = () => {
    if (isAppAllFilteredSelected) {
      setSelectedAppVideos(prev => {
        const next = new Set(prev);
        safeVideos.forEach(v => {
          const yid = getYoutubeId(v);
          if (yid) next.delete(yid);
        });
        return next;
      });
    } else {
      setSelectedAppVideos(prev => {
        const next = new Set(prev);
        safeVideos.forEach(v => {
          const yid = getYoutubeId(v);
          if (yid) next.add(yid);
        });
        return next;
      });
    }
  };

  const availableGenres = useMemo(() => {
    const set = new Set();
    (Array.isArray(videos) ? videos : []).forEach(v => {
      (v.topic_labels || []).forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }, [videos]);

  const safeChannels = Array.isArray(channels) ? channels : [];

  // Screen 1: Loading Auth State
  if (authLoading) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <RefreshCw size={40} className="animate-spin text-accent" />
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Authenticating...</p>
        </div>
      </div>
    );
  }

  // Screen 2: Sign In with Google Required
  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <Lock size={48} className="auth-icon text-accent" />
          <h1>DDJ Talks 2 Authentication</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 1.5rem' }}>
            Sign in with your authorized Google Account to access the analytics dashboard.
          </p>

          {errorMsg && <div className="error-badge">{errorMsg}</div>}

          <button onClick={handleGoogleSignIn} className="primary google-btn" style={{ justifyContent: 'center', width: '100%', padding: '0.8rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: '8px' }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Sign In with Google
          </button>

          {/* Guest Access Option */}
          <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
              🔑 Or enter Guest Password (View Only):
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleGuestLogin(guestPassInput); }} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="password"
                placeholder="Guest Password"
                value={guestPassInput}
                onChange={(e) => setGuestPassInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.3)',
                  color: 'white',
                  fontSize: '0.85rem'
                }}
              />
              <button
                type="submit"
                className="secondary"
                style={{ padding: '0.6rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Enter Guest
              </button>
            </form>
            {guestError && <div style={{ color: '#ff3366', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 500 }}>{guestError}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Screen 3: Signed In but Email NOT Whitelisted
  if (!isAuthorized) {
    return (
      <div className="auth-container">
        <div className="auth-box border-danger">
          <ShieldAlert size={48} color="#ff3366" />
          <h1 style={{ color: '#ff3366', margin: '0.5rem 0' }}>Access Restricted</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Account <strong>{user.email}</strong> is not authorized to access Pro-You SaaS Platform.
          </p>
          <div className="allowed-list" style={{ margin: '1.5rem 0', textAlign: 'left', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px' }}>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>AUTHORIZED ACCOUNTS:</h4>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {ALLOWED_EMAILS.map((email) => (
                <li key={email} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', margin: '0.25rem 0' }}>
                  <UserCheck size={14} color="var(--accent)" /> {email}
                </li>
              ))}
            </ul>
          </div>
          <button onClick={handleSignOut} className="primary" style={{ width: '100%', justifyContent: 'center' }}>
            <LogOut size={16} /> Sign In with Different Account
          </button>

          {/* Guest Access Option on Restricted Screen */}
          <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
              🔑 Or enter Guest Password (View Only):
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleGuestLogin(guestPassInput); }} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="password"
                placeholder="Guest Password"
                value={guestPassInput}
                onChange={(e) => setGuestPassInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.3)',
                  color: 'white',
                  fontSize: '0.85rem'
                }}
              />
              <button
                type="submit"
                className="secondary"
                style={{ padding: '0.6rem 1rem', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Enter Guest
              </button>
            </form>
            {guestError && <div style={{ color: '#ff3366', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 500 }}>{guestError}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Main Dashboard View (Authenticated & Authorized)
  return (
    <div>
      <header className="dashboard-header">
        <h1 
          onClick={() => setActiveTab('feed')}
          style={{ cursor: 'pointer' }}
          title="Click to go to Main Dashboard"
        >
          DDJ Talks 2
        </h1>
        
        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'feed' ? 'active' : ''}`} onClick={() => setActiveTab('feed')} style={activeTab === 'feed' ? { color: '#ff3366', borderBottomColor: '#ff3366' } : {}}>
            <Rss size={18} /> Dashboard
          </button>
          <button className={`tab-btn ${activeTab === 'correlations' ? 'active' : ''}`} onClick={() => setActiveTab('correlations')} style={activeTab === 'correlations' ? { color: '#00f0ff', borderBottomColor: '#00f0ff' } : {}}>
            <TrendingUp size={18} /> Correlations
          </button>
          <button className={`tab-btn ${activeTab === 'videos' ? 'active' : ''}`} onClick={() => setActiveTab('videos')}>
            <VideoIcon size={18} /> Videos
          </button>
          <button className={`tab-btn ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>
            <Tv size={18} /> Channels
          </button>
          <button className={`tab-btn ${activeTab === 'transcripts' ? 'active' : ''}`} onClick={() => setActiveTab('transcripts')} style={activeTab === 'transcripts' ? { color: '#a855f7', borderBottomColor: '#a855f7' } : {}}>
            <FileText size={18} /> Transcripts ({transcripts.length})
          </button>
          <button className={`tab-btn ${activeTab === 'todo' ? 'active' : ''}`} onClick={() => setActiveTab('todo')} style={activeTab === 'todo' ? { color: '#eab308', borderBottomColor: '#eab308' } : {}}>
            <BookOpen size={18} /> To Do
          </button>
        </div>

        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            onClick={() => setShowQuotaModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.3rem 0.6rem', borderRadius: '20px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
            title="Click to view Daily 10K YouTube API Quota Status & Reset Timer"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} style={{ width: 28, height: 28, borderRadius: '50%' }} />
            ) : (
              <UserCheck size={20} color="var(--accent)" />
            )}
            <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 500 }}>{user.email}</span>
            {isGuest ? (
              <span style={{ fontSize: '0.68rem', color: '#eab308', background: 'rgba(234,179,8,0.15)', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600, border: '1px solid rgba(234,179,8,0.35)' }}>
                👀 Guest (View Only)
              </span>
            ) : user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() ? (
              <span style={{ fontSize: '0.68rem', color: '#ff3366', background: 'rgba(255,51,102,0.15)', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600, border: '1px solid rgba(255,51,102,0.3)' }}>
                👑 Admin (Full Access)
              </span>
            ) : (
              <span style={{ fontSize: '0.68rem', color: '#00f0ff', background: 'rgba(0,240,255,0.15)', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600, border: '1px solid rgba(0,240,255,0.3)' }}>
                👁️ Viewer (Analytics Only)
              </span>
            )}
            <span style={{ fontSize: '0.68rem', color: 'var(--accent)', background: 'var(--accent-glow)', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600 }}>
              ⚡ 10K Quota
            </span>
            <span 
              style={{ fontSize: '0.68rem', color: '#c084fc', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.35)', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              title="Account Token: way2go2dhruv"
            >
              <Key size={10} /> way2go2dhruv
            </span>
          </div>
          <button onClick={handleSignOut} className="tab-btn" title="Sign Out" style={{ padding: '0.25rem' }}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Quota Modal */}
      {showQuotaModal && (
        <QuotaModal user={user} onClose={() => setShowQuotaModal(false)} />
      )}

      {/* Feed Tab */}
      {activeTab === 'feed' && (
        <FeedDashboard 
          apiBase={API_BASE} 
          authToken={axios.defaults.headers.common['Authorization']?.replace('Bearer ', '') || ''} 
          onSelectVideo={setSelectedChartVideo}
          refreshTrigger={feedRefreshTrigger}
          videos={videos}
          categories={categories}
          loading={loading}
          setVideos={setVideos}
          blacklistedChannels={blacklistedChannels}
          onUnsubscribeChannel={handleUnsubscribeFromVideo}
          isGuest={isGuest}
        />
      )}

      {/* Correlations Tab */}
      {activeTab === 'correlations' && (
        <CorrelationsDashboard 
          apiBase={API_BASE} 
          authToken={axios.defaults.headers.common['Authorization']?.replace('Bearer ', '') || ''} 
          onSelectVideo={setSelectedChartVideo}
          isGuest={isGuest}
        />
      )}

      {/* To Do Tab */}
      {activeTab === 'todo' && (
        <TodoDashboard apiBase={API_BASE} user={user} isPrimaryAdmin={!isGuest && user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()} isGuest={isGuest} />
      )}

      {/* Transcripts Tab */}
      {activeTab === 'transcripts' && (
        <TranscriptsDashboard
          transcripts={transcripts}
          onDeleteTranscript={(id) => {
            setTranscripts(removeTranscribedVideo(id, transcripts));
          }}
          onClearAllTranscripts={() => {
            setTranscripts([]);
            localStorage.removeItem('ddj_transcribed_videos');
          }}
        />
      )}

      {/* Videos / Channels Tab */}
      {activeTab !== 'feed' && activeTab !== 'todo' && activeTab !== 'correlations' && activeTab !== 'transcripts' && (
      <div className="dashboard-content">
        {/* Add Channel / Video form (Admin only can add/import, Viewers get read-only notification) */}
        {!isGuest && user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() ? (
          <div className="add-form" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input 
              type="url" 
              placeholder={`Paste YouTube ${activeTab === 'videos' ? 'Video' : 'Channel'} URL here...`}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              required
              style={{ flex: 1, minWidth: '300px' }}
            />
            <button type="button" className="primary" disabled={loading} onClick={activeTab === 'videos' ? handleAddVideo : handleAddChannel}>
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
              Add {activeTab === 'videos' ? 'Video' : 'Channel'}
            </button>

            {activeTab === 'channels' && (
              <button type="button" className="primary" disabled={importing} onClick={handleImportSubscriptions} style={{ borderColor: 'var(--accent-secondary)', color: 'var(--accent-secondary)' }}>
                {importing ? <RefreshCw className="animate-spin" size={18} /> : <Download size={18} />}
                Import My YouTube Subscriptions
              </button>
            )}
          </div>
        ) : (
          <div style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.2)', padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            🔒 Logged in as <strong>{user?.email || 'Guest User'}</strong> (Analytics & Viewing Mode). Subscription imports and channel management are reserved for the Primary Admin (<strong>{PRIMARY_ADMIN_EMAIL}</strong>).
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2>Tracked {activeTab === 'videos' ? 'Videos' : 'Channels'} ({activeTab === 'videos' ? safeVideos.length : safeChannels.length})</h2>
        </div>

        {activeTab === 'videos' && (
          <>
            {/* Advanced Videos Filters */}
            <div className="feed-filter-bar" style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', alignItems: 'center' }}>
              {/* Video Title / Channel Name Search Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 240px', minWidth: '180px', position: 'relative' }}>
                <Search size={14} style={{ color: 'var(--text-muted)', position: 'absolute', left: '0.65rem' }} />
                <input
                  type="text"
                  placeholder="Search title, channel, topic..."
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
                    outline: 'none'
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
                      fontSize: '0.75rem',
                      padding: '0.2rem'
                    }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} value={filterDate} onChange={e => setFilterDate(e.target.value)}>
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">Past 7 Days</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Eye size={14} style={{ color: 'var(--text-muted)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} value={filterViews} onChange={e => setFilterViews(e.target.value)}>
                  <option value="all">All Views</option>
                  <option value="1m">&gt; 1M views</option>
                  <option value="100k">&gt; 100K views</option>
                  <option value="10k">&gt; 10K views</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={14} style={{ color: 'var(--text-muted)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} value={filterVelocity} onChange={e => setFilterVelocity(e.target.value)}>
                  <option value="all">All Momentum</option>
                  <option value="high">🔥 High Velocity (&gt;1000/hr)</option>
                  <option value="gaining">📈 Gaining (&gt;100/hr)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <PlaySquare size={14} style={{ color: 'var(--text-muted)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="long">🎥 Long-Form</option>
                  <option value="shorts">⚡ Shorts</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Tag size={14} style={{ color: 'var(--text-muted)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }} value={filterGenre} onChange={e => setFilterGenre(e.target.value)}>
                  <option value="all">All Genres ({availableGenres.length})</option>
                  {availableGenres.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button 
                  type="button"
                  onClick={() => setFilterML(!filterML)}
                  className="filter-pill"
                  style={{
                    background: filterML ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: filterML ? '#00f0ff' : 'var(--text-muted)',
                    border: `1px solid ${filterML ? '#00f0ff' : 'var(--border)'}`,
                    fontSize: '0.8rem',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                  title="Filter videos predicted by Google ML Topic Surge Acceleration Model (0 Reads)"
                >
                  🤖 ML Surge Predicted ({mlPredictions.size}) {filterML ? '✓' : ''}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                <BarChart2 size={14} style={{ color: 'var(--accent)' }} />
                <select className="category-select" style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderColor: 'var(--accent)', color: 'var(--accent)' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="surge">🚀 Sort by Viral Surge</option>
                  <option value="quality">⭐ Sort by Quality Score</option>
                  <option value="velocity">🔥 Sort by View Velocity</option>
                  <option value="views">👁️ Sort by Total Views</option>
                  <option value="date">🕒 Sort by Release Date</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              {safeVideos.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={toggleAppSelectAllFiltered}
                    className="filter-pill"
                    style={{
                      background: isAppAllFilteredSelected ? 'rgba(168,85,247,0.25)' : 'rgba(255, 255, 255, 0.05)',
                      borderColor: isAppAllFilteredSelected ? '#a855f7' : 'var(--border)',
                      color: isAppAllFilteredSelected ? '#c084fc' : '#fff',
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                    title="Select all videos matching current search/filter across all pages"
                  >
                    {isAppAllFilteredSelected ? <CheckSquare size={13} color="#c084fc" /> : <Square size={13} />}
                    {isAppAllFilteredSelected ? `Deselect All (${safeVideos.length})` : `Select All (${safeVideos.length})`}
                  </button>

                  <button
                    type="button"
                    onClick={toggleAppSelectAllPage}
                    className="filter-pill"
                    style={{
                      background: isAppAllPageSelected ? 'rgba(168,85,247,0.25)' : 'rgba(255, 255, 255, 0.05)',
                      borderColor: isAppAllPageSelected ? '#a855f7' : 'var(--border)',
                      color: isAppAllPageSelected ? '#c084fc' : '#fff',
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                    title="Select only videos on current page"
                  >
                    {isAppAllPageSelected ? <CheckSquare size={13} color="#c084fc" /> : <Square size={13} />}
                    {isAppAllPageSelected ? 'Deselect Page' : `Select Page (${paginatedVideos.length})`}
                  </button>
                </>
              )}
            </div>

            <div className="grid">
              {safeVideos.length === 0 ? (
                <div className="empty-state">No videos matching filters. Try adjusting filter options above!</div>
              ) : (
                paginatedVideos.map(video => {
                  const publishedDate = video.published_at ? new Date(video.published_at) : null;
                  const daysAgo = publishedDate ? Math.max(1, Math.round((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24))) : 1;
                  const formattedPublish = publishedDate ? publishedDate.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Unknown Date';
                  const surgeInfo = getSurgeBreakdown(video);
                  const vel = Math.round(video.velocity || 0);
                  const ytId = getYoutubeId(video);
                  const highResUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg` : video.thumbnail_url;
                  const isSelected = ytId && selectedAppVideos.has(ytId);

                  return (
                    <div key={video.id} className="card" style={{
                      border: isSelected ? '1px solid #a855f7' : undefined,
                      background: isSelected ? 'rgba(168, 85, 247, 0.05)' : undefined
                    }}>
                      <div 
                        className="thumbnail-container" 
                        style={{ cursor: 'zoom-in', position: 'relative' }}
                        onClick={() => handleOpenThumbModal(video)}
                      >
                        {/* Checkbox Overlay on Thumbnail */}
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleAppSelectVideo(video);
                          }}
                          style={{
                            position: 'absolute', top: '0.4rem', left: '0.4rem', zIndex: 30,
                            background: 'rgba(0,0,0,0.8)', padding: '0.25rem', borderRadius: '5px',
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
                        {video.thumbnail_url ? (
                          <img src={video.thumbnail_url} alt={video.title} className="thumbnail" />
                        ) : (
                          <div className="thumbnail" style={{ background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center' }}>
                            <PlaySquare size={32} color="var(--text-muted)" />
                          </div>
                        )}
                        <span style={{ position: 'absolute', bottom: '0.4rem', right: '0.4rem', background: 'rgba(0,0,0,0.7)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#fff' }}>
                          <Maximize2 size={10} /> View Thumb
                        </span>
                        {video.duration_seconds && (
                          <span style={{ position: 'absolute', bottom: '0.4rem', left: '0.4rem', background: 'rgba(0,0,0,0.85)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <Clock size={10} /> {formatDuration(video.duration_seconds)}
                          </span>
                        )}
                        {video.is_short ? (
                          <span className="short-badge" style={{ position: 'absolute', top: '0.4rem', left: '2.4rem', background: '#8b5cf6', color: '#fff', fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>⚡ Short</span>
                        ) : (
                          <span className="short-badge" style={{ position: 'absolute', top: '0.4rem', left: '2.4rem', background: '#00f0ff', color: '#000', fontSize: '0.65rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>🎥 Long</span>
                        )}

                        {/* Hover Description Overlay */}
                        {video.description && (
                          <div className="desc-overlay">
                            <div className="desc-overlay-title">📝 Video Description</div>
                            <div className="desc-overlay-text">{video.description}</div>
                          </div>
                        )}
                      </div>
                      <div className="card-content">
                        <h3 className="card-title" style={{ fontSize: '0.95rem', fontWeight: 600, height: '2.4rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          <a href={video.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-main)', textDecoration: 'none' }}>{video.title || video.url}</a>
                        </h3>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                          <a 
                            href={video.channel_id ? `https://www.youtube.com/channel/${video.channel_id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(video.channel_name || '')}`}
                            target="_blank" 
                            rel="noreferrer" 
                            className="card-subtitle" 
                            style={{ fontSize: '0.8rem', color: 'var(--accent)', margin: 0, fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                            title={`Visit YouTube Channel: ${video.channel_name}`}
                          >
                            {video.channel_name} <ExternalLink size={10} style={{ opacity: 0.6 }} />
                          </a>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnsubscribeFromVideo(video.channel_name, video.channel_id);
                            }}
                            title={`Unsubscribe from "${video.channel_name}" and remove its videos`}
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
                            <UserMinus size={11} /> Unsub
                          </button>
                        </div>
                        
                        {Array.isArray(video.topic_labels) && video.topic_labels.length > 0 && (
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                            {video.topic_labels.map((topic, idx) => (
                              <span key={idx} style={{ background: 'rgba(0, 240, 255, 0.08)', color: 'var(--accent)', fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '4px', border: '1px solid rgba(0, 240, 255, 0.2)' }}>
                                #{topic}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Transparent ML Signal Reasoning Badge */}
                        {(() => {
                          const pred = mlPredictions.get(video.id);
                          if (!pred) return null;
                          return (
                            <div 
                              onClick={() => setActiveMLTopicModal(pred)}
                              title="Click to view all channels and videos covering this topic"
                              style={{ 
                                marginTop: '0.4rem', 
                                background: 'rgba(112, 0, 255, 0.12)', 
                                border: '1px solid rgba(112, 0, 255, 0.35)', 
                                borderRadius: '6px', 
                                padding: '0.35rem 0.5rem', 
                                fontSize: '0.68rem', 
                                color: '#a855f7',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>🤖 {pred.term}</span>
                                <span style={{ background: '#a855f7', color: '#fff', padding: '0.05rem 0.35rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 600 }}>{pred.confidence}% Conf</span>
                              </div>
                              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: '1.25' }}>
                                Active across <strong>{pred.channelCount} channel(s)</strong> [{pred.channelsList}] with <strong>+{pred.avgVelocity.toLocaleString()} v/hr</strong> momentum
                              </div>
                              <div style={{ marginTop: '0.2rem', color: '#c084fc', fontWeight: 600, fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <Sparkles size={10} /> Click to view all {pred.channelCount} channel(s) & video links &rarr;
                              </div>
                            </div>
                          );
                        })()}
                        
                        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                          <span 
                            title={`📅 Publication Timestamp:\nPublished on ${formattedPublish}\n(${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago)`}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'help' }}
                          >
                            <Calendar size={12} /> {formattedPublish}
                          </span>
                          <span 
                            title={`👍 Engagement & Likes:\n${(video.like_count || 0).toLocaleString()} total likes\nEngagement Ratio: ${((video.like_count || 0) / Math.max(1, video.view_count || 1) * 100).toFixed(2)}% like-to-view ratio`}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'help' }}
                          >
                            <ThumbsUp size={12} /> {video.like_count ? (video.like_count).toLocaleString() : '0'} likes
                          </span>
                          <span 
                            onClick={() => setSelectedChartVideo(video)}
                            title={surgeInfo.tooltip}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: surgeInfo.rawTotal >= 70 ? '#ff3366' : 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                          >
                            <TrendingUp size={12} /> 🚀 Surge: {surgeInfo.score} pts
                          </span>
                          <span 
                            title={`🔥 View Velocity Pace (+${vel.toLocaleString()} views/hr):\nReal-time hourly view accumulation speed.\n• >1,000 v/hr: Viral Explosion Rate 🚀\n• 100-999 v/hr: High Growth Pace 🔥\n• <100 v/hr: Steady Pace 📈`}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: vel >= 100 ? '#f97316' : 'var(--text-muted)', cursor: 'help', fontWeight: 600 }}
                          >
                            <Clock size={12} /> 🔥 Pace: {vel > 0 ? `+${vel.toLocaleString()} v/hr` : 'Stable'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                          <div className="card-stats" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <BarChart2 size={14} />
                            {(video.view_count || 0).toLocaleString()} views
                          </div>

                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              onClick={async () => {
                                if (transcripts.some(t => t.id === video.id)) {
                                  setActiveTab('transcripts');
                                  return;
                                }
                                setLoadingTranscribeId(video.id);
                                try {
                                  let fullVideo = video;
                                  if ((!video.description || video.description.endsWith('...')) && firebaseInstance?.firestore) {
                                    try {
                                      const vDoc = await getDoc(doc(firebaseInstance.firestore, 'videos', video.id));
                                      if (vDoc.exists()) {
                                        fullVideo = { ...video, ...vDoc.data() };
                                      }
                                    } catch (e) {
                                      console.error("Could not fetch full video doc:", e);
                                    }
                                  }

                                  // Attempt local Mac server OpenAI Whisper Speech-to-Text API
                                  let whisperTranscript = null;
                                  try {
                                    const ytId = fullVideo.youtube_id || fullVideo.id;
                                    whisperTranscript = await fetchLocalWhisperTranscript(ytId, API_BASE);
                                  } catch (wErr) {
                                    console.warn("Local Whisper transcription unavailable, using fallback:", wErr);
                                  }

                                  setTranscripts(saveTranscribedVideo(fullVideo, transcripts, whisperTranscript));
                                  setActiveTab('transcripts');
                                } catch (err) {
                                  console.error("Transcription error fallback:", err);
                                  setTranscripts(saveTranscribedVideo(video, transcripts));
                                  setActiveTab('transcripts');
                                } finally {
                                  setLoadingTranscribeId(null);
                                }
                              }}
                              disabled={loadingTranscribeId === video.id}
                              className="filter-pill"
                              style={{
                                background: transcripts.some(t => t.id === video.id) ? 'rgba(168,85,247,0.25)' : 'rgba(168,85,247,0.1)',
                                border: '1px solid rgba(168,85,247,0.4)',
                                color: '#c084fc',
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                cursor: loadingTranscribeId === video.id ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                opacity: loadingTranscribeId === video.id ? 0.7 : 1
                              }}
                              title="Transcribe video locally using OpenAI Whisper on Mac"
                            >
                              <FileText size={12} /> {
                                loadingTranscribeId === video.id
                                  ? '⏳ Transcribing on Mac...'
                                  : transcripts.some(t => t.id === video.id)
                                    ? '✓ Transcribed'
                                    : '🎙️ Transcribe'
                              }
                            </button>

                            <button onClick={() => handleDeleteVideo(video.id)} className="icon-btn danger" title="Remove Video" style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: '0.25rem' }}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
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

        {activeTab === 'channels' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                📺 Active Subscribed Channels ({safeChannels.length})
              </h2>
              <div className="grid">
                {safeChannels.length === 0 ? (
                  <div className="empty-state" style={{ width: '100%' }}>
                    No active channels tracked yet. Paste a YouTube Channel URL above, or click "Import My YouTube Subscriptions"!
                  </div>
                ) : (
                  safeChannels.map(channel => (
                    <div key={channel.id} className="card" style={{ display: 'flex', alignItems: 'center', padding: '1.25rem', gap: '1rem', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {channel.thumbnail_url ? (
                          <img src={channel.thumbnail_url} alt={channel.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,240,255,0.1)', display: 'grid', placeItems: 'center' }}>
                            <Tv size={28} color="var(--accent)" />
                          </div>
                        )}
                        <div>
                          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{channel.name || 'Unknown Channel'}</h3>
                          <a href={channel.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.85rem', textDecoration: 'none' }}>
                            Visit Channel &rarr;
                          </a>
                        </div>
                      </div>

                      <button onClick={() => handleDeleteChannel(channel.id, channel.name || channel.channel_name, channel.channel_id)} title="Remove Channel" style={{ background: 'none', border: 'none', color: '#ff3366', cursor: 'pointer', padding: '0.5rem' }}>
                        <Trash2 size={20} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Blacklisted / Unsubscribed Offline Channels */}
            {(() => {
              const localBlacklist = JSON.parse(localStorage.getItem('ddj_unsubscribed_channels') || '[]');
              
              // Merge local blacklist and blacklistedChannels state, keeping unique items
              const seen = new Set();
              const combinedList = [];
              
              localBlacklist.forEach(chan => {
                const key = chan.id || chan.name;
                if (key && !seen.has(key)) {
                  seen.add(key);
                  combinedList.push({
                    id: chan.id || null,
                    name: chan.name || 'Unknown Channel',
                    isPending: true
                  });
                }
              });

              (blacklistedChannels || []).forEach(chan => {
                const key = chan.channel_id || chan.name || chan.id;
                if (key && !seen.has(key)) {
                  seen.add(key);
                  combinedList.push({
                    id: chan.channel_id || chan.id || null,
                    name: chan.name || 'Unknown Channel',
                    isPending: false
                  });
                }
              });

              if (combinedList.length === 0) return null;
              return (
                <div style={{ width: '100%' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>🚫 Unsubscribed / Blacklisted Channels ({combinedList.length})</span>
                  </h2>
                  <div className="grid">
                    {combinedList.map(chan => (
                      <div key={chan.id || chan.name} className="card" style={{ display: 'flex', alignItems: 'center', padding: '1.25rem', gap: '1rem', justifyContent: 'space-between', opacity: 0.75 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', display: 'grid', placeItems: 'center' }}>
                            <UserMinus size={28} color="#ef4444" />
                          </div>
                          <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{chan.name}</h3>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {chan.id ? `ID: ${chan.id}` : 'Name matching'}
                              {chan.isPending && <span style={{ marginLeft: '0.5rem', color: '#ff3366', fontWeight: 600 }}>(Sync pending)</span>}
                            </span>
                          </div>
                        </div>

                        <button 
                          onClick={() => handleRestoreChannel(chan.id, chan.name)} 
                          className="primary-btn" 
                          style={{ 
                            fontSize: '0.8rem', 
                            padding: '0.35rem 0.75rem', 
                            background: 'rgba(0, 240, 255, 0.1)', 
                            border: '1px solid #00f0ff',
                            color: '#00f0ff',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          Restore Channel
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
      )}

      {/* Lightbox Thumbnail Modal */}
      {selectedThumb && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: '1.5rem' }} onClick={() => setSelectedThumb(null)}>
          <div className="modal-content" style={{ position: 'relative', background: '#0e1520', borderRadius: '12px', border: '1px solid var(--border)', maxWidth: '900px', width: '100%', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedThumb(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', color: '#fff', cursor: 'pointer', padding: '0.4rem', display: 'flex', alignItems: 'center' }}>
              <X size={20} />
            </button>
            <img src={selectedThumb.url} alt={selectedThumb.title} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }} />
            <div style={{ padding: '1.5rem' }}>
              <span className="feed-channel" style={{ fontSize: '0.9rem', color: 'var(--accent)', display: 'block', marginBottom: '0.5rem' }}>{selectedThumb.channel}</span>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.75rem' }}>{selectedThumb.title}</h3>
              
              <a href={selectedThumb.videoUrl} target="_blank" rel="noreferrer" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: '#00f0ff', fontSize: '0.9rem', fontWeight: 500, marginBottom: selectedThumb.description ? '1.25rem' : 0 }}>
                Watch on YouTube <ExternalLink size={14} />
              </a>

              {selectedThumb.description && (
                <div style={{ 
                  marginTop: '0.5rem', 
                  maxHeight: '180px', 
                  overflowY: 'auto', 
                  fontSize: '0.82rem', 
                  color: 'var(--text-muted)', 
                  lineHeight: '1.5',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border)',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap'
                }}>
                  <div style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem' }}>
                    📝 Video Description
                  </div>
                  {selectedThumb.description}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video Historical Growth Chart Modal */}
      {selectedChartVideo && (
        <VideoStatsModal 
          video={selectedChartVideo} 
          apiBase={API_BASE} 
          onClose={() => setSelectedChartVideo(null)} 
        />
      )}

      {/* Interactive ML Topic Details Modal */}
      {activeMLTopicModal && (
        <MLTopicModal 
          activeMLTopicModal={activeMLTopicModal} 
          onClose={() => setActiveMLTopicModal(null)} 
          onDeleteSuccess={(deletedKeys) => {
            setVideos(prev => prev.filter(v => {
              const yid = getYoutubeId(v);
              return !yid || !deletedKeys.has(yid);
            }));
            setFeedRefreshTrigger(prev => prev + 1);
          }}
        />
      )}
      {/* Floating Bulk Action Bar for Videos Tab */}
      {selectedAppVideos.size > 0 && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9990, background: '#18122B', border: '1px solid #a855f7',
          borderRadius: '12px', padding: '0.65rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
          boxShadow: '0 8px 32px rgba(168,85,247,0.3)', backdropFilter: 'blur(12px)',
        }}>
          <span style={{ color: '#fff', fontSize: '0.88rem', fontWeight: 600 }}>
            {selectedAppVideos.size} video(s) selected
          </span>
          <button
            onClick={toggleAppSelectAllFiltered}
            style={{ background: 'rgba(168,85,247,0.2)', border: '1px solid #a855f7', color: '#c084fc', padding: '0.35rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {isAppAllFilteredSelected ? `Deselect All (${safeVideos.length})` : `Select All Searched (${safeVideos.length})`}
          </button>
          <button
            onClick={toggleAppSelectAllPage}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', padding: '0.35rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {isAppAllPageSelected ? 'Deselect Page' : 'Select Page'}
          </button>
          <button
            onClick={handleAppBulkDelete}
            disabled={isAppDeleting}
            style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '0.35rem 0.85rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: isAppDeleting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Trash2 size={14} /> {isAppDeleting ? 'Deleting...' : 'Delete & Blacklist'}
          </button>
          <button
            onClick={() => setSelectedAppVideos(new Set())}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function MLTopicModal({ activeMLTopicModal, onClose, onDeleteSuccess, onRefreshFeed }) {
  const [selectedVids, setSelectedVids] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [matchingVideos, setMatchingVideos] = useState(activeMLTopicModal?.matchingVideos || []);

  useEffect(() => {
    setMatchingVideos(activeMLTopicModal?.matchingVideos || []);
    setSelectedVids(new Set());
  }, [activeMLTopicModal]);

  if (!activeMLTopicModal) return null;

  const toggleSelect = (vid) => {
    const key = getYoutubeId(vid);
    if (!key) return;
    setSelectedVids(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isAllSelected = matchingVideos.length > 0 && matchingVideos.every(v => {
    const yid = getYoutubeId(v);
    return yid && selectedVids.has(yid);
  });

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedVids(new Set());
    } else {
      setSelectedVids(new Set(matchingVideos.map(v => getYoutubeId(v)).filter(Boolean)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedVids.size === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete and blacklist ${selectedVids.size} video(s)?`)) return;

    setIsDeleting(true);
    try {
      const fb = initFirebase();
      const vidsToDelete = matchingVideos.filter(v => {
        const yid = getYoutubeId(v);
        return yid && selectedVids.has(yid);
      });
      const res = await deleteVideosBulk(fb?.firestore, vidsToDelete);
      setIsDeleting(false);

      // Always filter state and trigger callbacks immediately for local persistence consistency
      const deletedKeys = new Set(vidsToDelete.map(v => getYoutubeId(v)).filter(Boolean));
      const remaining = matchingVideos.filter(v => {
        const yid = getYoutubeId(v);
        return !yid || !deletedKeys.has(yid);
      });
      setMatchingVideos(remaining);
      setSelectedVids(new Set());
      if (onDeleteSuccess) onDeleteSuccess(deletedKeys);
      if (onRefreshFeed) onRefreshFeed();

      if (!res.success) {
        alert("⚠️ Cloud database quota limit exceeded. Videos have been successfully blacklisted locally for this session.");
      }
    } catch (e) {
      setIsDeleting(false);
      console.error("Modal delete error:", e);
    }
  };

  return (
    <div 
      className="modal-overlay" 
      style={{ 
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', 
        display: 'grid', placeItems: 'center', zIndex: 2000, padding: '1.5rem' 
      }} 
      onClick={onClose}
    >
      <div 
        className="modal-content" 
        style={{ 
          position: 'relative', background: '#0d131d', borderRadius: '16px', 
          border: '1px solid rgba(168, 85, 247, 0.4)', maxWidth: '650px', 
          width: '100%', padding: '1.75rem', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 0 35px rgba(168, 85, 247, 0.3)'
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <span style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.4)', fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '6px', fontWeight: 600, display: 'inline-block', marginBottom: '0.5rem' }}>
              🤖 Google Gemini AI Token [way2go2dhruv]
            </span>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              Topic: #{activeMLTopicModal.term}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.3rem', margin: 0 }}>
              Active across <strong>{activeMLTopicModal.channelCount} channel(s)</strong> • Total Momentum: <strong style={{ color: '#f97316' }}>+{activeMLTopicModal.avgVelocity.toLocaleString()} views/hr</strong>
            </p>
          </div>
          <button 
            onClick={onClose} 
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '50%', color: '#fff', cursor: 'pointer', padding: '0.4rem', display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Sparkles size={14} /> Matching Videos & Channels ({matchingVideos.length}):
          </div>
          {matchingVideos.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                onClick={toggleSelectAll}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', borderRadius: '6px', padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                {isAllSelected ? 'Deselect All' : 'Select All'}
              </button>
              {selectedVids.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, cursor: isDeleting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Trash2 size={12} /> {isDeleting ? 'Deleting...' : `Delete (${selectedVids.size})`}
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {matchingVideos.map((v, idx) => {
            const key = getYoutubeId(v) || idx;
            const isSelected = selectedVids.has(key);
            const channelUrl = v.channel_id 
              ? `https://www.youtube.com/channel/${v.channel_id}` 
              : `https://www.youtube.com/results?search_query=${encodeURIComponent(v.channel_name || '')}`;

            return (
              <div 
                key={key} 
                style={{ 
                  background: isSelected ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255, 255, 255, 0.03)', 
                  border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.08)', 
                  borderRadius: '10px', 
                  padding: '0.7rem 0.85rem',
                  display: 'flex',
                  gap: '0.65rem',
                  alignItems: 'flex-start'
                }}
              >
                <div style={{ width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '0.25rem' }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(v)}
                    style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#a855f7', margin: 0, padding: 0 }}
                    title="Select for deletion"
                  />
                </div>
                {v.thumbnail_url && (
                  <img src={v.thumbnail_url} alt="" style={{ width: '72px', height: '42px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <a 
                    href={v.url} 
                    target="_blank" 
                    rel="noreferrer" 
                    style={{ color: '#fff', fontSize: '0.84rem', fontWeight: 600, textDecoration: 'none', display: 'block', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35' }}
                  >
                    {v.title}
                  </a>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent)', marginTop: '0.15rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <a
                      href={channelUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                      title={`Visit ${v.channel_name} on YouTube`}
                    >
                      {v.channel_name} <ExternalLink size={10} style={{ opacity: 0.6 }} />
                    </a>
                    <span style={{ color: '#f97316', fontWeight: 600 }}>+{(v.velocity || 0).toLocaleString()} v/hr</span>
                  </div>
                </div>
                <a 
                  href={v.url} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="primary-btn" 
                  style={{ padding: '0.3rem 0.55rem', fontSize: '0.72rem', textDecoration: 'none', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0, marginTop: '0.1rem' }}
                >
                  Open <ExternalLink size={11} />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;
