import datetime
import pytest
from snapshot_optimizer import (
    should_record_snapshot,
    update_video_history_array,
    prune_old_snapshots
)

class TestShouldRecordSnapshot:
    def test_no_previous_stat_returns_true(self):
        assert should_record_snapshot(None, new_views=100, new_velocity=10.0, threshold_pct=5.0) is True

    def test_view_change_below_threshold_returns_false(self):
        prev = {"view_count": 100, "velocity": 10.0}
        # 2% change in views (102 vs 100) and 2% change in velocity (10.2 vs 10.0) -> <= 5%
        assert should_record_snapshot(prev, new_views=102, new_velocity=10.2, threshold_pct=5.0) is False

    def test_view_change_above_threshold_returns_true(self):
        prev = {"view_count": 100, "velocity": 10.0}
        # 10% change in views (110 vs 100) -> > 5%
        assert should_record_snapshot(prev, new_views=110, new_velocity=10.0, threshold_pct=5.0) is True

    def test_velocity_change_above_threshold_returns_true(self):
        prev = {"view_count": 100, "velocity": 10.0}
        # 20% change in velocity (12.0 vs 10.0) -> > 5%
        assert should_record_snapshot(prev, new_views=100, new_velocity=12.0, threshold_pct=5.0) is True

    def test_zero_previous_views_positive_new_views_returns_true(self):
        prev = {"view_count": 0, "velocity": 0.0}
        assert should_record_snapshot(prev, new_views=50, new_velocity=5.0, threshold_pct=5.0) is True


class TestUpdateVideoHistoryArray:
    def test_appends_new_entry_to_empty_history(self):
        recent_ts = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).isoformat()
        history = update_video_history_array(None, new_views=500, new_velocity=25.0, timestamp=recent_ts, max_days=7)
        assert len(history) == 1
        assert history[0]["v"] == 500
        assert history[0]["vel"] == 25.0
        assert history[0]["t"] == recent_ts

    def test_prunes_entries_older_than_max_days(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        old_time = (now - datetime.timedelta(days=10)).isoformat()
        recent_time = (now - datetime.timedelta(days=2)).isoformat()

        initial = [
            {"t": old_time, "v": 100, "vel": 5.0},
            {"t": recent_time, "v": 200, "vel": 10.0}
        ]

        history = update_video_history_array(initial, new_views=300, new_velocity=15.0, max_days=7)
        # Old time (10 days ago) should be pruned
        assert len(history) == 2
        assert history[0]["v"] == 200
        assert history[1]["v"] == 300


class TestPruneOldSnapshotsMock:
    def test_no_db_returns_zero(self):
        assert prune_old_snapshots(db=None, retention_days=10) == 0
