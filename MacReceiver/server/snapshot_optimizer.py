"""
Snapshot Optimizer & Retention Module
-------------------------------------
Provides high-efficiency algorithms for historical snapshot management:
1. `should_record_snapshot`: Evaluates if views or velocity changed by >= threshold_pct (5%).
2. `update_video_history_array`: Maintains an embedded 7-day history array inside video dicts.
3. `prune_old_snapshots`: Auto-deletes snapshot docs older than retention_days (10 days).
"""

import datetime
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


def should_record_snapshot(previous_stat: Optional[Dict[str, Any]], new_views: int, new_velocity: float, threshold_pct: float = 5.0) -> bool:
    """
    Determines whether a new snapshot should be recorded.
    Returns True if:
    - No previous snapshot exists.
    - View count changed by >= threshold_pct (e.g. 5%).
    - Velocity changed by >= threshold_pct (e.g. 5%).
    """
    if not previous_stat:
        return True

    prev_views = previous_stat.get("view_count", 0)
    prev_vel = previous_stat.get("velocity", 0.0)

    # If previous views were 0, any positive views trigger a snapshot
    if prev_views <= 0:
        return new_views > 0

    view_change_pct = abs(new_views - prev_views) / prev_views * 100.0

    # Handle velocity change
    if prev_vel <= 0:
        vel_change_pct = 100.0 if new_velocity > 0 else 0.0
    else:
        vel_change_pct = abs(new_velocity - prev_vel) / prev_vel * 100.0

    return view_change_pct >= threshold_pct or vel_change_pct >= threshold_pct


def update_video_history_array(current_history: Optional[List[Dict[str, Any]]], new_views: int, new_velocity: float, timestamp: Optional[str] = None, max_days: int = 7) -> List[Dict[str, Any]]:
    """
    Appends a new point-in-time snapshot to the video's embedded history array
    and prunes entries older than max_days (7 days).
    Format of each entry: { "t": ISO timestamp, "v": view_count, "vel": velocity }
    """
    if current_history is None:
        history = []
    else:
        history = list(current_history)

    now = datetime.datetime.now(datetime.timezone.utc)
    ts_str = timestamp or now.isoformat()

    # Append new point
    history.append({
        "t": ts_str,
        "v": int(new_views),
        "vel": round(float(new_velocity), 2)
    })

    # Cutoff date (max_days ago)
    cutoff = now - datetime.timedelta(days=max_days)

    filtered_history = []
    for entry in history:
        t_val = entry.get("t")
        if not t_val:
            continue
        try:
            # Parse ISO string
            if isinstance(t_val, datetime.datetime):
                entry_dt = t_val
            else:
                entry_dt = datetime.datetime.fromisoformat(str(t_val).replace('Z', '+00:00'))
            
            if entry_dt >= cutoff:
                filtered_history.append(entry)
        except Exception:
            # Keep entry if parsing fails as a safe fallback
            filtered_history.append(entry)

    return filtered_history


def prune_old_snapshots(db=None, retention_days: int = 10) -> int:
    """
    Deletes video_stats documents older than retention_days (10 days).
    Returns the total number of pruned documents.
    """
    if not db:
        import database
        db = database.get_db()
    if not db:
        logger.error("Database not connected. Cannot prune old snapshots.")
        return 0

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = (now - datetime.timedelta(days=retention_days)).isoformat()

    logger.info(f"=== Pruning video_stats older than {retention_days} days (cutoff: {cutoff}) ===")
    
    pruned_count = 0
    try:
        # Stream docs older than cutoff
        old_docs = db.collection("video_stats").where("timestamp", "<", cutoff).stream()
        
        batch = db.batch()
        batch_size = 0
        
        for doc in old_docs:
            batch.delete(doc.reference)
            batch_size += 1
            pruned_count += 1
            
            if batch_size >= 400:
                batch.commit()
                batch = db.batch()
                batch_size = 0
                
        if batch_size > 0:
            batch.commit()

        logger.info(f"Successfully pruned {pruned_count} old video_stats documents.")
    except Exception as e:
        logger.error(f"Error pruning old snapshots: {e}")

    return pruned_count
