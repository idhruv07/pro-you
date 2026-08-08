"""
test_correlations.py
---------------------
BLACK BOX integration tests for the build_correlations_cache() function.
Verifies end-to-end correctness of cross-channel topic grouping logic.

Tests cover (one behavior per test):
- Topics with only 1 channel are excluded from output
- Topics with 2+ channels are included
- Empty input produces empty output without crashing
- Multiple topics are sorted by channel_count descending
- Videos per topic are capped at 10
- Output document structure matches expected schema

Run: pytest tests/test_correlations.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from topic_config import TEST_TOPICS

import pytest
import datetime
from unittest.mock import MagicMock


# ─── Shared helpers ──────────────────────────────────────────────────────────

def _video_doc(vid_id, channel_id, channel_name, topics, hours_ago=1, quality=50, duration=300):
    """Creates a mock Firestore video document published hours_ago hours ago."""
    pub = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_ago)
    doc = MagicMock()
    doc.id = f"doc_{vid_id}"
    doc.to_dict.return_value = {
        "youtube_id": vid_id,
        "title": f"Video {vid_id}",
        "url": f"https://yt.be/{vid_id}",
        "channel_id": channel_id,
        "channel_name": channel_name,
        "topic_labels": topics,
        "published_at": pub.isoformat(),
        "view_count": 1000,
        "quality_score": quality,
        "momentum_label": "📺 Normal",
        "is_short": False,
        "thumbnail_url": None,
        "duration_seconds": duration,
    }
    return doc


def _mock_db_for_correlations(video_docs):
    """
    Returns a mock db whose videos.where().stream() returns the given docs.
    Also mocks cache.document().set() for capturing output.
    """
    db = MagicMock()
    vid_col = MagicMock()
    vid_col.where.return_value.stream.return_value = iter(video_docs)

    cache_col = MagicMock()
    cache_doc_ref = MagicMock()
    cache_col.document.return_value = cache_doc_ref

    def router(name):
        return {"videos": vid_col, "cache": cache_col}.get(name, MagicMock())

    db.collection.side_effect = router
    return db, cache_doc_ref


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestCorrelationsExclusion:
    """Topics covered by only one channel must be excluded."""

    def test_single_channel_topic_excluded(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "Alpha", ["Finance"]),
            _video_doc("v2", "ch1", "Alpha", ["Finance"]),  # same channel twice
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["total_topics"] == 0

    def test_no_topics_on_video_excluded(self):
        """Videos with empty topic_labels should not create correlations."""
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "Alpha", []),
            _video_doc("v2", "ch2", "Beta", []),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["total_topics"] == 0


class TestCorrelationsInclusion:
    """Topics covered by 2+ distinct channels must be included."""

    def test_two_channel_topic_included(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "Alpha", [TEST_TOPICS["AI_GEN"]]),
            _video_doc("v2", "ch2", "Beta", [TEST_TOPICS["AI_GEN"]]),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["total_topics"] == 1
        assert data["correlations"][0]["topic"].lower() == TEST_TOPICS["AI_GEN"].lower()

    def test_three_channel_topic_has_correct_count(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "Alpha", [TEST_TOPICS["QUANTUM"]]),
            _video_doc("v2", "ch2", "Beta",  [TEST_TOPICS["QUANTUM"]]),
            _video_doc("v3", "ch3", "Gamma", [TEST_TOPICS["QUANTUM"]]),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["correlations"][0]["channel_count"] == 3


class TestCorrelationsEmpty:
    """Empty video collection must not crash and must produce empty output."""

    def test_empty_input_no_crash(self):
        from scheduler_cache import build_correlations_cache
        db, cache_ref = _mock_db_for_correlations([])
        build_correlations_cache(db)  # must not raise

    def test_empty_input_total_topics_zero(self):
        from scheduler_cache import build_correlations_cache
        db, cache_ref = _mock_db_for_correlations([])
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["total_topics"] == 0

    def test_empty_input_correlations_list_is_empty(self):
        from scheduler_cache import build_correlations_cache
        db, cache_ref = _mock_db_for_correlations([])
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert data["correlations"] == []


class TestCorrelationsSorting:
    """Topics with more channels should appear first in output."""

    def test_higher_channel_count_sorts_first(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "A", [TEST_TOPICS["QUANTUM"]]),
            _video_doc("v2", "ch2", "B", [TEST_TOPICS["QUANTUM"]]),
            _video_doc("v3", "ch3", "C", [TEST_TOPICS["QUANTUM"]]),  # Quantum: 3 channels
            _video_doc("v4", "ch1", "A", [TEST_TOPICS["AI_GEN"]]),
            _video_doc("v5", "ch2", "B", [TEST_TOPICS["AI_GEN"]]), # AI Gen: 2 channels
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        corrs = cache_ref.set.call_args[0][0]["correlations"]
        assert corrs[0]["topic"].lower() == TEST_TOPICS["QUANTUM"].lower()
        assert corrs[0]["channel_count"] == 3


class TestCorrelationsOutputSchema:
    """Output document must contain all required fields."""

    def test_output_has_window_hours_field(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "A", ["Gaming"]),
            _video_doc("v2", "ch2", "B", ["Gaming"]),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert "window_hours" in data
        assert data["window_hours"] == 48

    def test_output_has_last_updated_at_field(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "A", ["Quantum Computing"]),
            _video_doc("v2", "ch2", "B", ["Quantum Computing"]),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        data = cache_ref.set.call_args[0][0]
        assert "last_updated_at" in data

    def test_correlation_entry_has_required_fields(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "A", ["Quantum Computing"]),
            _video_doc("v2", "ch2", "B", ["Quantum Computing"]),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        entry = cache_ref.set.call_args[0][0]["correlations"][0]
        for field in ["topic", "channel_count", "channels", "video_count", "videos"]:
            assert field in entry, f"Missing field: {field}"

    def test_correlation_video_has_duration_seconds(self):
        from scheduler_cache import build_correlations_cache
        docs = [
            _video_doc("v1", "ch1", "A", ["Quantum Computing"], duration=420),
            _video_doc("v2", "ch2", "B", ["Quantum Computing"], duration=600),
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        videos = cache_ref.set.call_args[0][0]["correlations"][0]["videos"]
        assert videos[0]["duration_seconds"] in [420, 600]
        assert videos[1]["duration_seconds"] in [420, 600]


class TestCorrelationsVideoCap:
    """Videos per topic must be capped at 10 in the output."""

    def test_videos_capped_at_10_per_topic(self):
        from scheduler_cache import build_correlations_cache
        # 20 videos across 2 channels on same topic
        docs = [
            _video_doc(f"v{i}", f"ch{i % 2}", f"Chan {i % 2}", ["Quantum Computing"])
            for i in range(20)
        ]
        db, cache_ref = _mock_db_for_correlations(docs)
        build_correlations_cache(db)
        entry = cache_ref.set.call_args[0][0]["correlations"][0]
        assert len(entry["videos"]) <= 10
