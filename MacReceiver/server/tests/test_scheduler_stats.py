import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import datetime
from unittest.mock import MagicMock, patch

def _make_video_doc(doc_id="f_vid123", youtube_id="vid123", title="Test Title", channel_id="UCtest", published_at=None):
    doc = MagicMock()
    doc.id = doc_id
    doc.to_dict.return_value = {
        "youtube_id": youtube_id,
        "title": title,
        "channel_id": channel_id,
        "published_at": published_at or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "view_count": 1000,
        "like_count": 50,
        "comment_count": 10
    }
    return doc

@patch("database.get_db")
@patch("database_status.determine_execution_priority")
@patch("scheduler_stats.fetch_videos_batch")
@patch("scheduler_cache.rebuild_dashboard_cache")
def test_update_video_stats_normal_flow(mock_rebuild, mock_fetch_batch, mock_priority, mock_get_db):
    # Set up mocks
    db = MagicMock()
    mock_get_db.return_value = db
    
    mock_priority.return_value = {
        "mode": "full",
        "reads_remaining": 30000,
        "run_channels": True,
        "run_stats": True,
        "run_cache": True
    }
    
    # 1 video exists in database
    v_doc = _make_video_doc(youtube_id="vid_normal")
    db.collection.return_value.where.return_value.stream.return_value = iter([v_doc])
    
    # Preloaded todo and velocity mocks
    db.collection.return_value.stream.return_value = iter([])
    
    # Mock YouTube API response returning the video metadata
    mock_fetch_batch.return_value = [{
        "youtube_id": "vid_normal",
        "view_count": 1200,
        "like_count": 60,
        "comment_count": 12
    }]
    
    from scheduler_stats import update_video_stats
    res = update_video_stats()
    
    assert res is not False
    # Verify set and update were called on Firestore collections
    db.collection.return_value.document.return_value.set.assert_called()
    db.collection.return_value.document.return_value.update.assert_called()
    mock_rebuild.assert_called_once()

@patch("database.get_db")
@patch("database_status.determine_execution_priority")
@patch("scheduler_stats.fetch_videos_batch")
@patch("scheduler_cache.rebuild_dashboard_cache")
def test_update_video_stats_removes_unavailable_videos(mock_rebuild, mock_fetch_batch, mock_priority, mock_get_db):
    # Set up mocks
    db = MagicMock()
    mock_get_db.return_value = db
    
    mock_priority.return_value = {
        "mode": "full",
        "reads_remaining": 30000,
        "run_channels": True,
        "run_stats": True,
        "run_cache": True
    }
    
    # 2 videos exist in database: one stays, one is unavailable (deleted from YouTube)
    v_normal = _make_video_doc(doc_id="f_normal", youtube_id="vid_normal")
    v_deleted = _make_video_doc(doc_id="f_deleted", youtube_id="vid_deleted")
    
    # Mock stream for videos
    db.collection.return_value.where.return_value.stream.return_value = iter([v_normal, v_deleted])
    
    # Mock preloaded todo items
    todo_doc = MagicMock()
    todo_doc.id = "t_deleted"
    todo_doc.to_dict.return_value = {"video_id": "f_deleted"}
    
    # Mock specific documents to avoid shared mock collision
    video_doc_mock = MagicMock()
    todo_doc_mock = MagicMock()
    def document_side_effect(doc_id=None):
        if doc_id == "f_deleted":
            return video_doc_mock
        elif doc_id == "t_deleted":
            return todo_doc_mock
        return MagicMock()
    db.collection.return_value.document.side_effect = document_side_effect

    # Mock system/status and todo streams
    db.collection.return_value.stream.side_effect = lambda: iter([todo_doc])
    
    # Mock YouTube API response: only returns 'vid_normal' (meaning 'vid_deleted' is unavailable!)
    mock_fetch_batch.return_value = [{
        "youtube_id": "vid_normal",
        "view_count": 1200,
        "like_count": 60,
        "comment_count": 12
    }]
    
    from scheduler_stats import update_video_stats
    res = update_video_stats()
    
    assert res is not False
    
    # Assert f_deleted was deleted from "videos" collection
    video_doc_mock.delete.assert_called_once()
    
    # Assert linked todo item was deleted from "todo" collection
    todo_doc_mock.delete.assert_called_once()
    
    # Assert rebuild cache was triggered
    mock_rebuild.assert_called_once()
