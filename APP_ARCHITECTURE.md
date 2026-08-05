# DDJ Talks - Mirror App Architecture

**GitHub Repo**: https://github.com/idhruv07/mirror  
**Active Branch**: `v2-wifi`  
**Live URL**: https://ddjtalks.web.app  
**Change Log & Roadmap**: See `README.md`

## System Overview
The application is a YouTube Channel Monitor and Intelligence Dashboard. It tracks specific YouTube channels, automatically fetches new videos, analyzes trends, and provides a daily dashboard for the user.

## Core Components

### 1. Frontend (Web UI)
- **Framework**: React (Vite)
- **Hosting**: Firebase Hosting (`ddjtalks.web.app`)
- **Key Files**:
  - `src/App.jsx`: Main dashboard, Video list, Cache fetching, Client-side filtering, Interactive ML Topic Details Modal with multi-select deletion, clickable channel links, and video duration overlays.
  - `src/FeedDashboard.jsx`: YouTube Feed timeline view with multi-select checkboxes, floating bulk action bar, select all page controls, clickable channel links, and video duration overlays.
  - `src/utils/VideoDeleter.js`: Dedicated deletion module handling single-document blacklist updates (`system/deleted_videos_blacklist`), batch video doc deletion, and local storage zero-latency hiding.
  - `src/utils/MLPredictor.js`: Modular Machine Learning, AI Semantic Classifier, TF-IDF Keyphrase Extraction, and Surge Index prediction engine.
  - `src/CorrelationsDashboard.jsx`: Reads topic correlations from Firestore `cache/correlations_summary` with local API fallback, displaying video duration info.
  - `src/TranscriptsDashboard.jsx`: AI transcript dashboard with full-screen modal transcript viewer, rich timestamped chapter breakdowns, custom scroll containers, and single-click copy/delete controls.
  - `src/QuotaModal.jsx`: Displays Firestore and YouTube API quota usage with color-coded status badges and human-readable time-ago labels.
- **Data Flow**: To save Firebase read quotas, the frontend DOES NOT query raw collections directly on load. Instead, it queries the compiled `cache/dashboard_summary` document (which includes video metadata like `duration_seconds`). If `chunks_count` is greater than 1, it concurrently fetches additional chunk documents (`dashboard_summary_1`, `dashboard_summary_2`, etc.) and merges the video lists.

### 2. Backend (Cloud Scheduler)
- **Framework**: Python (APScheduler)
- **Execution Environment**: GitHub Actions (`.github/workflows/scheduler.yml`) runs every 12 hours.
- **Key Files**:
  - `server/scheduler.py`: Entrypoint orchestrator that re-exports step functions and schedules execution.
  - `server/scheduler_config.py`: Defines the `ReadBudget` class, budget limits, and alert utilities.
  - `server/scheduler_channels.py`: Workflow step that scans monitored channels for new uploads, fetching the blacklist from single document `system/deleted_videos_blacklist` (1 Read).
  - `server/snapshot_optimizer.py`: High-efficiency snapshot management module. Implements 10-day retention auto-pruning, 5% delta threshold filtering to save 70% of Firestore writes, and 7-day embedded history array propagation for zero-read analytics charting.
  - `server/gemini_transcriber.py`: Google Gemini 2.5 Pro transcription module using PyPI `google-genai` SDK for true, verbatim timestamped audio transcriptions & AI summaries.
  - `server/local_audio_transcriber.py`: OpenAI Whisper local speech-to-text audio transcriber module. Downloads `.m4a` audio via `yt-dlp` and runs OpenAI Whisper locally on Mac CPU for 100% real, verbatim, second-by-second audio transcripts. Includes `validate_transcript_duration_coverage` to reject short/truncated transcripts that fail to cover at least 75% of the video's actual duration.
  - `server/tests/`: 75 unit and integration tests covering budgets, cache chunking, status recording, channel processing, correlations, dynamic quota prioritization, snapshot optimization, Gemini transcription, and local OpenAI Whisper duration coverage.

### 3. Database (Firebase Firestore)
- **Collections & Documents**:
  - `videos`: Raw video metadata (including `duration_seconds`).
  - `channels`: Tracked YouTube channels.
  - `todo`: To Do items and content suggestions (including `duration_seconds` for added entries).
  - `system/deleted_videos_blacklist`: Single document containing an array `ids` of deleted YouTube IDs. Read by the scheduler in 1 read operation to prevent re-fetching deleted videos.
  - `cache`: Contains `dashboard_summary`, `dashboard_summary_i` (video chunks including `duration_seconds`), `correlations_summary` (including `duration_seconds`), and `channels_summary`. This is what the frontend actually reads. **SECURITY:** This collection is publicly readable (`allow read: if true;`) to enable Guest View-Only mode without requiring Firebase Authentication, while writes remain strictly restricted.
  - `system`: Contains `status` document containing actual read/write/API limits and today's usage logs.
- **Quota Limits**: Free Spark Plan limits reads to 50,000/day. The quota resets at **Midnight Pacific Time** (12:30 PM IST).

## Critical Workflows

### Adding a Video / Channel
1. Frontend adds directly to the Firestore collection.
2. Frontend triggers a local state update to reflect immediately.
3. Next cloud scheduler run will pick up the channel and monitor it.

### Deleting Video(s) (Bulk or Single)
1. Frontend calls `deleteVideosBulk(firestore, videos)` in `src/utils/VideoDeleter.js`.
2. Adds video IDs to `localStorage` `ddj_deleted_youtube_ids` for instant visual hiding.
3. Appends video `youtube_id`s to `system/deleted_videos_blacklist` document using a single `arrayUnion` operation (1 Write).
4. Batch deletes corresponding video documents from the `videos` collection.
5. The Cloud Scheduler reads `system/deleted_videos_blacklist` in 1 Read and avoids inserting blacklisted videos back into the database.

### Low-Performance Video Pruning & Blacklisting
1. The stats updates scheduler runs `prune_low_performance_videos(db)` during stats tracking.
2. Identifies all videos in Firestore that are older than **4 days** and have **less than 20,000 views**.
3. Deletes them from the database along with associated history/todos, and appends their YouTube IDs to the `system/deleted_videos_blacklist` document and `deleted_videos` collection to permanently blacklist them from being imported by subsequent scans.

## Rules for AI Agent
1. **READ FIRST**: Always read this `APP_ARCHITECTURE.md` file before proposing any changes to the Mirror project.
2. **UPDATE THIS FILE**: Whenever a new feature, database collection, workflow, or critical bug fix is implemented, update this file immediately — do NOT wait for the user to ask.
3. **UPDATE README.md**: Always update the `README.md` change log table when changes are made.
4. **RESPECT CACHE**: Any script or backend process that modifies `videos`, `channels`, or `todo` MUST call `rebuild_dashboard_cache(db)` which splits the video list into chunks of 200, or the UI will not reflect the changes.
5. **NEVER WRITE ALL VIDEOS TO ONE DOCUMENT**: Firestore has a hard 1MB per document limit. The video cache is always split into chunks of 200 across `dashboard_summary`, `dashboard_summary_1`, `dashboard_summary_2`, etc.
6. **NO CODING IN MAIN PYTHON FILE**: Do not implement new feature logic directly inside `main.py` or main entrypoint scripts. Define functions externally in step-specific files/modules, call them from the main script, and check if they are utilized or needed elsewhere in the project.
7. **KEEP MODULAR STRUCTURE**: Maintain clean separation of concerns and keep step-by-step scheduler workflows separated across designated task files.
8. **FUNCTION REUSABILITY**: Standardize on reusable, decoupled functions rather than inline scripts or duplicate database calls.
9. **ALWAYS WRITE TEST CASES**: Every new function, module, or feature implementation MUST be accompanied by test cases written at the same time — never implement code without tests. Tests are not optional or a follow-up.
10. **MAINTAIN A TEST MODULE**: All test cases MUST be added to the `MacReceiver/server/tests/` directory. The test module is a living document — update it whenever new functions are added, modified, or removed. Test file names must follow the pattern `test_<module_name>.py` and group related tests together for easy discovery.
11. **RUN TESTS BEFORE EVERY BUILD/DEPLOY**: Before running `npm run build`, `firebase deploy`, or pushing to Git after code changes, ALWAYS run `python -m pytest tests/ -v --tb=short` first. Do not proceed with the build if any test fails — fix the test or the code first.
12. **KEEP TEST CASES MODULAR**: Each test case must test exactly ONE behavior and have a clear, descriptive name (e.g., `test_budget_charge_exceeds_limit_raises`). Never put multiple assertions for unrelated behaviors in one test function. This makes it easy to identify exactly which behavior broke and correct only that test or function.
13. **BUILD PLAN TRACKING**: Always read `/Volumes/DJ EX OS/DJ External/.gemini/antigravity/brain/7fa37b54-405d-4c3c-94f4-c341a7810fe1/Mirror ai antigravity build plan .md` before starting any phase below, and check off completed items in that file when a phase finishes.

