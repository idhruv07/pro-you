"""
test_database_status.py
------------------------
WHITE BOX unit tests for record_run_metrics() and record_quota_error()
in database_status.py. Uses unittest.mock to avoid real Firestore connections.

Tests cover:
- Daily metric accumulation within the same day
- Counter reset when the date changes
- No crash when db is None
- record_quota_error writes the correct status field

Run: pytest tests/test_database_status.py -v
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import datetime
from unittest.mock import MagicMock, patch


def _make_status_doc(daily_reads=0, daily_writes=0, daily_api=0, last_reset_day=None):
    """Returns a mock Firestore document snapshot with the given status data."""
    today = last_reset_day or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {
        "daily_reads": daily_reads,
        "daily_writes": daily_writes,
        "daily_api": daily_api,
        "last_reset_day": today,
    }
    return snap


def _make_db(existing_snap):
    """Returns a mock db that returns existing_snap when status doc is fetched."""
    db = MagicMock()
    status_ref = MagicMock()
    status_ref.get.return_value = existing_snap
    db.collection("system").document("status") == status_ref
    db.collection.return_value.document.return_value = status_ref
    return db, status_ref


class TestRecordRunMetrics:
    """Tests for record_run_metrics() daily accumulation."""

    def test_accumulates_reads_on_same_day(self):
        """Reads should add on top of existing daily_reads when same day."""
        from database_status import record_run_metrics
        snap = _make_status_doc(daily_reads=100, daily_writes=10, daily_api=5)
        db, status_ref = _make_db(snap)

        record_run_metrics(db, "test_action", reads_used=50, writes_used=5, api_units_used=2)

        written = status_ref.set.call_args[0][0]
        assert written["daily_reads"] == 150
        assert written["daily_writes"] == 15
        assert written["daily_api"] == 7

    def test_resets_counters_on_new_day(self):
        """Counters should reset when the run is on a different day."""
        from database_status import record_run_metrics
        yesterday = (datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=1)).isoformat()
        snap = _make_status_doc(daily_reads=9000, daily_writes=500, daily_api=200, last_reset_day=yesterday)
        db, status_ref = _make_db(snap)

        record_run_metrics(db, "reset_action", reads_used=100, writes_used=10, api_units_used=3)

        written = status_ref.set.call_args[0][0]
        assert written["daily_reads"] == 100   # reset, not 9100
        assert written["daily_writes"] == 10
        assert written["daily_api"] == 3

    def test_no_existing_doc_starts_fresh(self):
        """If no existing document, start from the values passed in."""
        from database_status import record_run_metrics
        snap = MagicMock()
        snap.exists = False
        snap.to_dict.return_value = {}
        db, status_ref = _make_db(snap)

        record_run_metrics(db, "first_run", reads_used=200, writes_used=20, api_units_used=10)

        written = status_ref.set.call_args[0][0]
        assert written["daily_reads"] == 200
        assert written["daily_writes"] == 20

    def test_writes_last_action_and_status(self):
        """last_action and last_status fields should be set correctly."""
        from database_status import record_run_metrics
        snap = _make_status_doc()
        db, status_ref = _make_db(snap)

        record_run_metrics(db, "update_video_stats", reads_used=0, writes_used=0, api_units_used=0, status="failed")

        written = status_ref.set.call_args[0][0]
        assert written["last_action"] == "update_video_stats"
        assert written["last_status"] == "failed"

    def test_no_db_does_not_crash(self):
        """Passing db=None should silently return without raising."""
        from database_status import record_run_metrics
        record_run_metrics(None, "test", 100, 10, 5)  # Should not raise

    def test_writes_limit_fields(self):
        """Spark plan limit reference fields should always be written."""
        from database_status import record_run_metrics
        snap = _make_status_doc()
        db, status_ref = _make_db(snap)
        record_run_metrics(db, "check", 0, 0, 0)

        written = status_ref.set.call_args[0][0]
        assert written["daily_reads_limit"] == 50000
        assert written["daily_writes_limit"] == 20000
        assert written["daily_api_limit"] == 10000


class TestRecordQuotaError:
    """Tests for record_quota_error() function."""

    def test_writes_quota_exceeded_status(self):
        """Status should be 'quota_exceeded' when quota error is recorded."""
        from database_status import record_quota_error
        db = MagicMock()
        status_ref = MagicMock()
        db.collection.return_value.document.return_value = status_ref

        record_quota_error(db, "429 Quota exceeded.")

        written = status_ref.set.call_args[0][0]
        assert written["last_status"] == "quota_exceeded"

    def test_error_message_is_stored_and_capped(self):
        """Error message should be stored, capped at 500 characters."""
        from database_status import record_quota_error
        db = MagicMock()
        status_ref = MagicMock()
        db.collection.return_value.document.return_value = status_ref

        long_msg = "E" * 1000
        record_quota_error(db, long_msg)

        written = status_ref.set.call_args[0][0]
        assert len(written["last_error"]) <= 500

    def test_no_db_does_not_crash(self):
        """Passing db=None should silently return without raising."""
        from database_status import record_quota_error
        record_quota_error(None, "error")  # Should not raise

    def test_last_run_at_is_set(self):
        """last_run_at should be written as an ISO datetime string."""
        from database_status import record_quota_error
        db = MagicMock()
        status_ref = MagicMock()
        db.collection.return_value.document.return_value = status_ref

        record_quota_error(db, "quota exceeded")

        written = status_ref.set.call_args[0][0]
        assert "last_run_at" in written
        # Verify it parses as a valid ISO datetime
        datetime.datetime.fromisoformat(written["last_run_at"])
