# Mirror — DDJ Talks Intelligence Dashboard

A YouTube channel monitoring and intelligence dashboard for DDJ Talks.

---

## Live App
**URL**: https://ddjtalks.web.app  
**GitHub Repo**: https://github.com/idhruv07/mirror  
**Active Branch**: `v2-wifi`

---

## Architecture Summary
See [`APP_ARCHITECTURE.md`](./APP_ARCHITECTURE.md) for the full technical flow.

---

## Change Log

| Date | Change | Files Affected |
|------|--------|---------------|
| 2026-07-31 | Implemented Guest View-Only Mode with SHA-256 password hashing. Updated `firestore.rules` to allow public reads exclusively on the `/cache/` collection for unauthenticated guest access while maintaining strict `request.auth != null` write protections. Fixed `limit()` ReferenceError in direct query fallback. | `App.jsx`, `FeedDashboard.jsx`, `firestore.rules`, `firebase.js` |
| 2026-07-31 | Implemented 4-day, <20K views automatic low-performance pruning and blacklisting scheduler; added GET `/api/channels/blacklisted` endpoint; synced `delete_video` API to system blacklist; cleaned up duplicate Feed unsubscribe code; garbage-collected outdated cache chunks (75/75 tests passing) | `scheduler_stats.py`, `scheduler_cache.py`, `scheduler_channels.py`, `main.py`, `App.jsx`, `FeedDashboard.jsx` |
| 2026-07-29 | Integrated local OpenAI Whisper speech-to-text audio transcriber (`local_audio_transcriber.py`) & `validate_transcript_duration_coverage` test enforcing that transcripts must cover at least 75% of a video's total duration (75/75 tests passing) | `local_audio_transcriber.py`, `test_local_audio_transcriber.py`, `main.py`, `APP_ARCHITECTURE.md`, `README.md` |
| 2026-07-29 | Created modular `gemini_transcriber.py` module using PyPI `google-genai` SDK and `yt-dlp` for Google Gemini 2.5 Pro verbatim timestamped audio transcription and AI summaries (71/71 tests passing) | `gemini_transcriber.py`, `test_gemini_transcriber.py`, `APP_ARCHITECTURE.md`, `README.md` |
| 2026-07-29 | Implemented modular `snapshot_optimizer.py` module featuring 10-day retention auto-pruning, 5% delta threshold snapshot filtering, and 7-day embedded history array propagation for zero-read analytics charting (with 8 new unit tests) | `snapshot_optimizer.py`, `scheduler_stats.py`, `test_snapshot_optimizer.py`, `APP_ARCHITECTURE.md`, `README.md` |
| 2026-07-29 | Refactored Machine Learning & Surge prediction algorithms out of `App.jsx` into a dedicated, decoupled `MLPredictor.js` module enforcing strict MVC modular architecture rules | `MLPredictor.js`, `App.jsx`, `APP_ARCHITECTURE.md`, `README.md` |
| 2026-07-29 | Fixed Feed Dashboard sorting to display chronologically (newest first) and synchronized parent App state on manual refresh triggers | `FeedDashboard.jsx`, `README.md` |
| 2026-07-29 | Implemented video duration overlays/displays across all dashboard interfaces (Videos, Feed, Suggestions, To-Do cards, Correlations list) and expanded schemas/models to persist duration | `App.jsx`, `FeedDashboard.jsx`, `TodoDashboard.jsx`, `CorrelationsDashboard.jsx`, `main.py`, `scheduler_cache.py`, `schemas.py`, `test_correlations.py` |
| 2026-07-27 | Fixed ML Topic Modal deletion synchronization with top-level feed state, added multi-selection checkboxes & bulk action bar to main App grid, minimized checkbox dimensions (`14px`), wrapped video titles to next line (`wordBreak: 'break-word'`), and added prominent thumbnail checkbox overlays | `App.jsx`, `FeedDashboard.jsx`, `README.md` |
| 2026-07-27 | Implemented Dynamic Quota Prioritization (`determine_execution_priority`, `get_reads_remaining`) in `database_status.py` and added 6 new unit tests (`test_dynamic_priority.py`, total 58 tests) | `database_status.py`, `tests/test_dynamic_priority.py`, `APP_ARCHITECTURE.md` |
| 2026-07-27 | Implemented bulk video multi-selection & deletion in Feed & ML Topic Modal, single-document blacklist (`system/deleted_videos_blacklist`) for 1-read efficiency, dedicated `VideoDeleter.js` module, and clickable channel links | `VideoDeleter.js`, `FeedDashboard.jsx`, `App.jsx`, `scheduler_channels.py`, `firebase.js`, `APP_ARCHITECTURE.md` |
| 2026-07-27 | Added 52-test backend suite (`tests/`), Firestore 429 quota error handling (`record_quota_error()`), `build_correlations_cache()`, toast notifications, auto-polling scan trigger, and status badges in QuotaModal | `scheduler.yml`, `scheduler_channels.py`, `scheduler_stats.py`, `database_status.py`, `scheduler_cache.py`, `CorrelationsDashboard.jsx`, `FeedDashboard.jsx`, `QuotaModal.jsx`, `tests/*` |
| 2026-07-27 | Modularized `scheduler.py` into step modules, implemented lazy-loading video descriptions, chunked feed cache support, direct GH Actions scan dispatching, and isolated auto-refreshing database status tracking | `scheduler.py`, `scheduler_config.py`, `scheduler_channels.py`, `scheduler_stats.py`, `scheduler_cache.py`, `database_status.py`, `App.jsx`, `FeedDashboard.jsx`, `QuotaModal.jsx` |
| 2026-07-27 | Fixed Firestore 1MB document limit by splitting video cache into chunks of 200 | `scheduler.py`, `App.jsx` |
| 2026-07-27 | Added `rebuild_dashboard_cache()` call to GitHub Actions scheduler to ensure UI updates after every cloud run | `.github/workflows/scheduler.yml` |
| 2026-07-27 | Created `APP_ARCHITECTURE.md` as the permanent source of truth for the project | `APP_ARCHITECTURE.md` |
| 2026-07-27 | Added interactive page jump input to video list and feed | `App.jsx`, `FeedDashboard.jsx` |
| 2026-07-27 | Implemented video deletion with blacklist — deleted videos written to `deleted_videos` Firestore collection and never re-fetched | `App.jsx`, `main.py`, `scheduler.py` |
| 2026-07-19 | Migrated cloud scheduler from local APScheduler to GitHub Actions running every 12 hours | `.github/workflows/scheduler.yml` |

---

## Known Constraints
- **Firestore Free Quota**: 50,000 reads/day. Resets at 12:30 PM IST.
- **Firestore Document Limit**: 1MB per document. Video cache is chunked to work around this.
- **YouTube API Quota**: 10,000 units/day. Each channel scan costs ~1 unit per channel.
- **GitHub Actions**: Scheduler runs twice daily at 00:00 and 12:00 UTC (5:30 AM and 5:30 PM IST).

---

## How to Trigger a Manual Scheduler Run
```python
import urllib.request, json
url = 'https://api.github.com/repos/idhruv07/mirror/actions/workflows/scheduler.yml/dispatches'
headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer <TOKEN>',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Mirror'
}
data = json.dumps({'ref':'main'}).encode('utf-8')
req = urllib.request.Request(url, data=data, headers=headers, method='POST')
with urllib.request.urlopen(req) as r:
    print('Triggered:', r.status)  # Should print 204
```

---

## Outstanding Features / Roadmap
- [ ] Option to archive/soft-delete channels (status: "inactive") instead of hard-delete
- [ ] "Archived Channels" tab in the UI
- [ ] Auto-sync subscriptions from YouTube Data API
- [ ] Fix Correlations tab — currently empty
- [ ] "Scan Channels Now" button should trigger a real-time cloud cache rebuild
