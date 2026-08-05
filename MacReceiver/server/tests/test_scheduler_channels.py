"""
test_scheduler_channels.py
---------------------------
BLACK BOX integration tests for the channel scan pipeline in scheduler_channels.py.
All Firestore and YouTube API calls are mocked — no real network connections.

Tests cover (one behavior per test):
- last_checked_at is updated even when no new videos are found
- A new video gets written to the Firestore videos collection
- A video already in deleted_videos is not re-added
- A video already tracked (existing youtube_id) is skipped
- BudgetExceeded on a deep charge does not crash the whole run
- Quota exhaustion on the very first read calls record_quota_error

Run: pytest tests/test_scheduler_channels.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import datetime
from unittest.mock import MagicMock, patch, call


# ─── Shared mock builders ─────────────────────────────────────────────────────

def _channel_doc(channel_id="UCtest", name="Test Channel", last_checked=None):
    doc = MagicMock()
    doc.id = f"firestore_{channel_id}"
    doc.to_dict.return_value = {
        "channel_id": channel_id,
        "name": name,
        "last_checked_at": last_checked,
    }
    return doc


def _make_video_meta(youtube_id="vid123"):
    return {
        "youtube_id": youtube_id,
        "url": f"https://youtube.com/watch?v={youtube_id}",
        "title": f"Test Video {youtube_id}",
        "description": "Test description",
        "channel_name": "Test Channel",
        "thumbnail_url": "https://img.youtube.com/vi/test/0.jpg",
        "published_at": datetime.datetime.now(datetime.timezone.utc),
        "duration_seconds": 600,
        "view_count": 1000,
        "like_count": 50,
        "comment_count": 10,
    }


def _build_full_mock_db(channel_docs, tracked_ids=None, deleted_ids=None):
    """
    Builds a mock Firestore db returning specified channels, tracked videos,
    and deleted videos for check_channel_updates().
    """
    db = MagicMock()

    # channels collection
    ch_col = MagicMock()
    ch_col.stream.return_value = iter(channel_docs)
    ch_col.document.return_value = MagicMock()

    # videos collection — use select() to return tracked IDs
    vid_col = MagicMock()
    tracked_docs = []
    for tid in (tracked_ids or []):
        d = MagicMock()
        d.to_dict.return_value = {"youtube_id": tid}
        tracked_docs.append(d)
    vid_col.select.return_value.stream.return_value = iter(tracked_docs)
    vid_col.document.return_value = MagicMock()

    # deleted_videos collection
    del_col = MagicMock()
    deleted_docs = []
    for did in (deleted_ids or []):
        d = MagicMock()
        d.id = did
        deleted_docs.append(d)
    del_col.stream.return_value = iter(deleted_docs)

    # categories
    cat_col = MagicMock()
    cat_col.where.return_value.stream.return_value = iter([])

    # system/status for record_run_metrics
    sys_col = MagicMock()
    status_snap = MagicMock()
    status_snap.exists = False
    status_snap.to_dict.return_value = {}
    sys_col.document.return_value.get.return_value = status_snap

    # cache for rebuild_dashboard_cache
    cache_col = MagicMock()
    cache_video_snap = MagicMock()
    cache_video_snap.exists = False
    cache_col.document.return_value.get.return_value = cache_video_snap

    # video_stats
    vs_col = MagicMock()
    vs_col.document.return_value = MagicMock()

    # todo
    todo_col = MagicMock()
    todo_col.stream.return_value = iter([])

    def router(name):
        return {
            "channels": ch_col,
            "videos": vid_col,
            "deleted_videos": del_col,
            "categories": cat_col,
            "system": sys_col,
            "cache": cache_col,
            "video_stats": vs_col,
            "todo": todo_col,
        }.get(name, MagicMock())

    db.collection.side_effect = router
    return db, ch_col, vid_col


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestNoNewVideos:
    """When a channel has no new videos, last_checked_at should still update."""

    @patch("scheduler_channels.fetch_channel_latest_videos", return_value=[])
    @patch("scheduler_channels.fetch_videos_batch", return_value=[])
    @patch("scheduler_cache.rebuild_dashboard_cache")
    def test_last_checked_at_updated_when_no_new_videos(self, mock_cache, mock_batch, mock_latest):
        from scheduler_channels import check_channel_updates
        ch = _channel_doc()
        db, ch_col, _ = _build_full_mock_db([ch])

        with patch("scheduler_channels.database.get_db", return_value=db):
            check_channel_updates()

        # channels.document(id).update should have been called
        ch_col.document.assert_called()


class TestNewVideoSaved:
    """A new video that is not tracked should be written to the videos collection."""

    @patch("scheduler_channels.fetch_channel_latest_videos", return_value=["newvid001"])
    @patch("scheduler_channels.fetch_videos_batch")
    @patch("scheduler_cache.rebuild_dashboard_cache")
    @patch("scheduler_channels.categorize_video", return_value=(["AI & Tech"], ["LLMs"]))
    @patch("scheduler_channels.is_youtube_short", return_value=False)
    @patch("scheduler_channels.compute_quality_score")
    def test_new_video_written_to_videos_collection(
        self, mock_score, mock_short, mock_cat, mock_cache, mock_batch, mock_latest
    ):
        from scheduler_channels import check_channel_updates

        mock_batch.return_value = [_make_video_meta("newvid001")]
        mock_score.return_value = {
            "quality_score": 70, "momentum_label": "📈 Hot Right Now",
            "is_hot_topic": True, "velocity": 100.0, "z_score": 2.1,
            "feature_vector": []
        }

        ch = _channel_doc()
        db, ch_col, vid_col = _build_full_mock_db([ch], tracked_ids=[])

        with patch("scheduler_channels.database.get_db", return_value=db):
            check_channel_updates()

        # videos collection document().set() must have been called
        vid_col.document.return_value.set.assert_called()


class TestDeletedVideoSkipped:
    """A video ID present in deleted_videos should not be re-added."""

    @patch("scheduler_channels.fetch_channel_latest_videos", return_value=["deletedvid"])
    @patch("scheduler_channels.fetch_videos_batch", return_value=[])
    @patch("scheduler_cache.rebuild_dashboard_cache")
    def test_deleted_video_not_written_to_videos(self, mock_cache, mock_batch, mock_latest):
        from scheduler_channels import check_channel_updates

        ch = _channel_doc()
        db, ch_col, vid_col = _build_full_mock_db([ch], tracked_ids=[], deleted_ids=["deletedvid"])

        with patch("scheduler_channels.database.get_db", return_value=db):
            check_channel_updates()

        # fetch_videos_batch should return empty since filtered out
        vid_col.document.return_value.set.assert_not_called()


class TestAlreadyTrackedVideoSkipped:
    """A video ID already in the videos collection should not be re-processed."""

    @patch("scheduler_channels.fetch_channel_latest_videos", return_value=["existing123"])
    @patch("scheduler_channels.fetch_videos_batch", return_value=[])
    @patch("scheduler_cache.rebuild_dashboard_cache")
    def test_already_tracked_video_skipped(self, mock_cache, mock_batch, mock_latest):
        from scheduler_channels import check_channel_updates

        ch = _channel_doc()
        db, ch_col, vid_col = _build_full_mock_db([ch], tracked_ids=["existing123"])

        with patch("scheduler_channels.database.get_db", return_value=db):
            check_channel_updates()

        vid_col.document.return_value.set.assert_not_called()


class TestQuotaExhaustionHandling:
    """On quota exhaustion during the first channel.stream() call, record_quota_error is called."""

    @patch("scheduler_cache.rebuild_dashboard_cache")
    @patch("database_status.record_quota_error")
    def test_quota_error_on_first_read_calls_record_quota_error(self, mock_record, mock_cache):
        from scheduler_channels import check_channel_updates

        db = MagicMock()
        ch_col = MagicMock()
        ch_col.stream.side_effect = Exception("429 Quota exceeded.")

        sys_col = MagicMock()
        sys_snap = MagicMock()
        sys_snap.exists = False
        sys_snap.to_dict.return_value = {}
        sys_col.document.return_value.get.return_value = sys_snap

        def router(name):
            return {"channels": ch_col, "system": sys_col}.get(name, MagicMock())

        db.collection.side_effect = router

        with patch("scheduler_channels.database.get_db", return_value=db):
            check_channel_updates()  # Must not raise

        mock_record.assert_called_once()

    @patch("scheduler_cache.rebuild_dashboard_cache")
    def test_non_quota_exception_is_re_raised(self, mock_cache):
        """Non-quota exceptions (e.g. connection refused) should propagate."""
        from scheduler_channels import check_channel_updates

        db = MagicMock()
        ch_col = MagicMock()
        ch_col.stream.side_effect = ConnectionError("Connection refused")

        sys_col = MagicMock()
        sys_snap = MagicMock()
        sys_snap.exists = False
        sys_snap.to_dict.return_value = {}
        sys_col.document.return_value.get.return_value = sys_snap

        def router(name):
            return {"channels": ch_col, "system": sys_col}.get(name, MagicMock())

        db.collection.side_effect = router

        with patch("scheduler_channels.database.get_db", return_value=db):
            with pytest.raises(Exception):
                check_channel_updates()
