"""
Unit tests for Dynamic Quota Prioritization in database_status.py
"""

from unittest.mock import MagicMock
import datetime
from database_status import get_reads_remaining, determine_execution_priority

def test_reads_remaining_fresh_day():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "daily_reads": 10000,
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap
    
    remaining = get_reads_remaining(db)
    assert remaining == 40000

def test_reads_remaining_new_day_resets():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": "2020-01-01",
        "daily_reads": 45000,
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap
    
    remaining = get_reads_remaining(db)
    assert remaining == 50000

def test_determine_priority_full_mode():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "daily_reads": 10000,
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap

    p = determine_execution_priority(db)
    assert p["mode"] == "full"
    assert p["run_channels"] is True
    assert p["run_stats"] is True
    assert p["run_cache"] is True

def test_determine_priority_medium_mode():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "daily_reads": 40000, # 10,000 left -> medium mode
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap

    p = determine_execution_priority(db)
    assert p["mode"] == "medium"
    assert p["run_channels"] is True
    assert p["run_stats"] is True
    assert p["run_cache"] is True

def test_determine_priority_low_mode():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "daily_reads": 47000, # 3,000 left -> low mode
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap

    p = determine_execution_priority(db)
    assert p["mode"] == "low"
    assert p["run_channels"] is False
    assert p["run_stats"] is True
    assert p["run_cache"] is True

def test_determine_priority_emergency_mode():
    db = MagicMock()
    doc_snap = MagicMock()
    doc_snap.exists = True
    doc_snap.to_dict.return_value = {
        "last_reset_day": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
        "daily_reads": 49800, # 200 left -> emergency mode (<500 left)
        "daily_reads_limit": 50000
    }
    db.collection().document().get.return_value = doc_snap

    p = determine_execution_priority(db)
    assert p["mode"] == "emergency"
    assert p["run_channels"] is False
    assert p["run_stats"] is False
    assert p["run_cache"] is False
