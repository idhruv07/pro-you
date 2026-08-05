"""
test_scheduler_cache.py
-----------------------
WHITE BOX unit tests for rebuild_dashboard_cache() and build_correlations_cache()
in scheduler_cache.py. Uses unittest.mock to avoid real Firestore connections.

Tests cover:
- Video list chunking into <=200 per document (one test per case)
- Description truncation at exactly 150 chars (one test per rule)
- chunks_count metadata correctness
- Graceful handling of empty video collection
- Correlations requiring 2+ channels per topic
- Correlations time window, sorting, and video cap

Run: pytest tests/test_scheduler_cache.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from topic_config import TEST_TOPICS

import pytest
import datetime
from unittest.mock import MagicMock, call


# ─── Helpers ────────────────────────────────────────────────────────────────

def _make_video_doc(youtube_id, description="", quality_score=50,
                    channel_id="ch1", channel_name="Channel 1",
                    topic_labels=None, published_at=None, source="channel_monitor"):
    """Returns a MagicMock simulating a Firestore document."""
    doc = MagicMock()
    doc.id = f"doc_{youtube_id}"
    now = datetime.datetime.now(datetime.timezone.utc)
    doc.to_dict.return_value = {
        "youtube_id": youtube_id,
        "title": f"Video {youtube_id}",
        "description": description,
        "quality_score": quality_score,
        "channel_id": channel_id,
        "channel_name": channel_name,
        "topic_labels": topic_labels or [],
        "published_at": (published_at or now).isoformat(),
        "source": source,
        "view_count": 1000,
        "like_count": 50,
    }
    return doc


def _build_mock_db_and_capture(video_docs, todo_docs=None, channel_docs=None):
    """
    Builds a mock Firestore db and returns (db, captured_sets) where
    captured_sets is a dict that will be populated with all .set() call
    arguments keyed by document name after rebuild_dashboard_cache runs.
    This avoids the pitfall of calling db.collection("cache") multiple
    times and getting different mock instances.
    """
    db = MagicMock()

    # --- per-document mocks for cache ---
    doc_mocks = {}
    def get_cache_doc(name):
        if name not in doc_mocks:
            doc_mocks[name] = MagicMock()
        return doc_mocks[name]

    # --- videos collection with order_by chaining ---
    videos_col = MagicMock()
    ordered = MagicMock()
    ordered.stream.return_value = iter(video_docs)
    videos_col.order_by.return_value = ordered
    videos_col.where.return_value = ordered   # for correlations
    ordered.where.return_value = ordered

    # --- count() aggregate ---
    videos_col.count.return_value.get.return_value = [[MagicMock(value=len(video_docs))]]

    # --- todo, categories, channels ---
    todo_col = MagicMock()
    todo_col.stream.return_value = iter(todo_docs or [])
    todo_col.count.return_value.get.return_value = [[MagicMock(value=0)]]

    cats_col = MagicMock()
    cats_col.where.return_value = MagicMock(stream=MagicMock(return_value=iter([])))

    channels_col = MagicMock()
    channels_col.stream.return_value = iter(channel_docs or [])
    channels_col.count.return_value.get.return_value = [[MagicMock(value=0)]]

    video_stats_col = MagicMock()
    video_stats_col.count.return_value.get.return_value = [[MagicMock(value=0)]]

    # --- cache collection with per-document routing ---
    cache_col = MagicMock()
    cache_col.document.side_effect = get_cache_doc

    def collection_router(name):
        return {
            "videos": videos_col,
            "todo": todo_col,
            "categories": cats_col,
            "channels": channels_col,
            "cache": cache_col,
            "video_stats": video_stats_col,
        }.get(name, MagicMock())

    db.collection.side_effect = collection_router
    return db, doc_mocks


# ─── rebuild_dashboard_cache tests ──────────────────────────────────────────

class TestCacheChunking:
    """One test per chunk boundary to verify video list chunking logic."""

    def test_single_chunk_for_100_videos(self):
        """100 videos → chunks_count=1, all in dashboard_summary."""
        from scheduler_cache import rebuild_dashboard_cache
        docs = [_make_video_doc(str(i)) for i in range(100)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        data = doc_mocks["dashboard_summary"].set.call_args[0][0]
        assert data["chunks_count"] == 1
        assert len(data["videos"]) == 100

    def test_two_chunks_for_201_videos(self):
        """201 videos → chunks_count=2, chunk 0 has 200, chunk 1 has 1."""
        from scheduler_cache import rebuild_dashboard_cache
        docs = [_make_video_doc(str(i)) for i in range(201)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        data = doc_mocks["dashboard_summary"].set.call_args[0][0]
        assert data["chunks_count"] == 2
        assert len(data["videos"]) == 200

        chunk1_data = doc_mocks["dashboard_summary_1"].set.call_args[0][0]
        assert len(chunk1_data["videos"]) == 1

    def test_three_chunks_for_401_videos(self):
        """401 videos → chunks_count=3."""
        from scheduler_cache import rebuild_dashboard_cache
        docs = [_make_video_doc(str(i)) for i in range(401)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        data = doc_mocks["dashboard_summary"].set.call_args[0][0]
        assert data["chunks_count"] == 3

    def test_empty_videos_produces_zero_chunks(self):
        """Empty video collection → chunks_count=0, videos=[]."""
        from scheduler_cache import rebuild_dashboard_cache
        db, doc_mocks = _build_mock_db_and_capture([])
        rebuild_dashboard_cache(db)  # Must not raise

        data = doc_mocks["dashboard_summary"].set.call_args[0][0]
        assert data["chunks_count"] == 0
        assert data["videos"] == []


class TestDescriptionTruncation:
    """One test per truncation rule."""

    def test_short_description_not_truncated(self):
        """Descriptions <= 150 chars stored as-is."""
        from scheduler_cache import rebuild_dashboard_cache
        short_desc = "A" * 100
        docs = [_make_video_doc("v1", description=short_desc)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        videos = doc_mocks["dashboard_summary"].set.call_args[0][0]["videos"]
        assert videos[0]["description"] == short_desc

    def test_long_description_truncated_to_150_with_ellipsis(self):
        """Descriptions > 150 chars truncated to 150 + '...' = 153 total."""
        from scheduler_cache import rebuild_dashboard_cache
        long_desc = "B" * 300
        docs = [_make_video_doc("v2", description=long_desc)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        videos = doc_mocks["dashboard_summary"].set.call_args[0][0]["videos"]
        assert len(videos[0]["description"]) == 153
        assert videos[0]["description"].endswith("...")

    def test_exactly_150_chars_not_truncated(self):
        """Exactly 150 chars must NOT have '...' appended."""
        from scheduler_cache import rebuild_dashboard_cache
        exact_desc = "C" * 150
        docs = [_make_video_doc("v3", description=exact_desc)]
        db, doc_mocks = _build_mock_db_and_capture(docs)

        rebuild_dashboard_cache(db)

        videos = doc_mocks["dashboard_summary"].set.call_args[0][0]["videos"]
        assert videos[0]["description"] == exact_desc
        assert not videos[0]["description"].endswith("...")


# ─── build_correlations_cache tests (via test_scheduler_cache for completeness) ─

class TestCorrelationsCacheInCacheModule:
    """
    Mirrors the correlations logic tests here so test_scheduler_cache.py
    provides a single file for all scheduler_cache.py coverage.
    Full standalone suite is in test_correlations.py.
    """

    def _recent_doc(self, vid_id, ch_id, ch_name, topics):
        pub = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
        return _make_video_doc(vid_id, channel_id=ch_id, channel_name=ch_name,
                               topic_labels=topics, published_at=pub)

    def _mock_db_corr(self, video_docs):
        db = MagicMock()
        vid_col = MagicMock()
        vid_col.where.return_value.stream.return_value = iter(video_docs)
        cache_col = MagicMock()
        cache_ref = MagicMock()
        cache_col.document.return_value = cache_ref

        def router(name):
            return {"videos": vid_col, "cache": cache_col}.get(name, MagicMock())
        db.collection.side_effect = router
        return db, cache_ref

    def test_single_channel_topic_excluded(self):
        from scheduler_cache import build_correlations_cache
        docs = [self._recent_doc("v1", "ch1", "A", ["Gaming"]),
                self._recent_doc("v2", "ch1", "A", ["Gaming"])]
        db, ref = self._mock_db_corr(docs)
        build_correlations_cache(db)
        data = ref.set.call_args[0][0]
        assert data["total_topics"] == 0

    def test_two_channel_topic_included(self):
        from scheduler_cache import build_correlations_cache
        docs = [self._recent_doc("v1", "ch1", "A", [TEST_TOPICS["AI_GEN"]]),
                self._recent_doc("v2", "ch2", "B", [TEST_TOPICS["AI_GEN"]])]
        db, ref = self._mock_db_corr(docs)
        build_correlations_cache(db)
        data = ref.set.call_args[0][0]
        assert data["total_topics"] == 1

    def test_empty_videos_returns_empty_correlations(self):
        from scheduler_cache import build_correlations_cache
        db, ref = self._mock_db_corr([])
        build_correlations_cache(db)
        data = ref.set.call_args[0][0]
        assert data["correlations"] == []

    def test_higher_channel_count_sorts_first(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            self._recent_doc("v1", "ch1", "A", [TEST_TOPICS["QUANTUM"], TEST_TOPICS["AI_GEN"]]),
            self._recent_doc("v2", "ch2", "B", [TEST_TOPICS["QUANTUM"], TEST_TOPICS["AI_GEN"]]),
            self._recent_doc("v3", "ch3", "C", [TEST_TOPICS["QUANTUM"]]),
        ]
        db, ref = self._mock_db_corr(docs)
        build_correlations_cache(db)
        corrs = ref.set.call_args[0][0]["correlations"]
        assert corrs[0]["topic"].lower() == TEST_TOPICS["QUANTUM"].lower()

    def test_videos_capped_at_10_per_topic(self):
        from scheduler_cache import build_correlations_cache
        docs = [self._recent_doc(f"v{i}", f"ch{i%2}", f"C{i%2}", [TEST_TOPICS["QUANTUM"]])
                for i in range(20)]
        db, ref = self._mock_db_corr(docs)
        build_correlations_cache(db)
        gaming = ref.set.call_args[0][0]["correlations"][0]
        assert len(gaming["videos"]) <= 10
