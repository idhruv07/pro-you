"""
Scheduler Channels Scan Module
-------------------------------
This step-by-step module streams the monitored YouTube channels, fetches
new videos published since last_checked_at using the YouTube API, applies
category classification, computes quality scores, writes new videos and
their statistics to Firestore, and respects the deleted videos blacklist.
"""

import datetime
import logging
import threading
import concurrent.futures
from typing import Set

db_write_lock = threading.Lock()

import database
from scheduler_config import ReadBudget, READ_BUDGET_PER_RUN, _save_budget_alert
from database_status import record_run_metrics, determine_execution_priority

from youtube_service import (
    fetch_channel_latest_videos,
    fetch_videos_batch,
)
from ai_analysis import (
    categorize_video,
    compute_quality_score,
    is_youtube_short,
)

logger = logging.getLogger(__name__)

def _get_custom_categories(db) -> list:
    """Fetch user-created categories from Firestore."""
    try:
        return [d.to_dict() for d in db.collection("categories").where("is_system", "==", False).stream()]
    except Exception:
        return []

def process_single_channel(doc, db, now, lookback, tracked_youtube_ids: Set[str], custom_categories, stats_accumulator):
    """Process a single channel. No velocity baseline called here — new videos have no history."""
    channel = doc.to_dict()
    channel_firestore_id = doc.id
    channel_id = channel.get("channel_id")
    channel_name = channel.get("name", "Unknown")

    if not channel_id:
        return

    try:
        last_checked_str = channel.get("last_checked_at")
        if last_checked_str:
            try:
                published_after = datetime.datetime.fromisoformat(last_checked_str)
                if published_after.tzinfo is None:
                    published_after = published_after.replace(tzinfo=datetime.timezone.utc)
            except Exception:
                published_after = lookback
        else:
            published_after = lookback

        new_video_ids = fetch_channel_latest_videos(channel_id, published_after)
        # Track 1 YouTube API Unit consumed for checking latest videos
        stats_accumulator["api_units"] += 1

        if not new_video_ids:
            db.collection("channels").document(channel_firestore_id).update({"last_checked_at": now.isoformat()})
            stats_accumulator["writes"] += 1
            return

        filtered_ids = [vid for vid in new_video_ids if vid not in tracked_youtube_ids]
        if not filtered_ids:
            db.collection("channels").document(channel_firestore_id).update({"last_checked_at": now.isoformat()})
            stats_accumulator["writes"] += 1
            return

        videos_metadata = fetch_videos_batch(filtered_ids)
        stats_accumulator["api_units"] += 1  # 1 YouTube API Unit for batch fetch
        
        videos_ref = db.collection("videos")
        video_stats_ref = db.collection("video_stats")

        for meta in videos_metadata:
            youtube_id = meta["youtube_id"]
            
            # Check and reserve the youtube_id atomically
            with db_write_lock:
                if youtube_id in tracked_youtube_ids:
                    continue
                tracked_youtube_ids.add(youtube_id)

            topic_labels, sub_topic_labels = categorize_video(
                meta.get("title", ""), meta.get("description", ""), custom_categories=custom_categories
            )
            short = is_youtube_short(meta.get("title", ""), meta.get("description", ""), meta.get("duration_seconds", 0))
            published_at = meta.get("published_at") or now
            quality_result = compute_quality_score(
                view_count=meta.get("view_count", 0), prev_view_count=0,
                like_count=meta.get("like_count", 0), comment_count=meta.get("comment_count", 0),
                published_at=published_at, hours_elapsed=12, channel_velocities=[]
            )

            new_video_ref = videos_ref.document()
            video_data = {
                "youtube_id": youtube_id, "url": meta["url"],
                "title": meta.get("title"), "description": meta.get("description", ""),
                "channel_id": channel_id, "channel_firestore_id": channel_firestore_id,
                "channel_name": meta.get("channel_name") or channel_name,
                "thumbnail_url": meta.get("thumbnail_url"),
                "published_at": published_at.isoformat() if hasattr(published_at, "isoformat") else str(published_at),
                "duration_seconds": meta.get("duration_seconds", 0), "is_short": short,
                "view_count": meta.get("view_count", 0), "like_count": meta.get("like_count", 0),
                "comment_count": meta.get("comment_count", 0),
                "quality_score": quality_result["quality_score"],
                "momentum_label": quality_result["momentum_label"],
                "is_hot_topic": quality_result["is_hot_topic"],
                "velocity": quality_result["velocity"], "z_score": quality_result["z_score"],
                "feature_vector": quality_result["feature_vector"],
                "topic_labels": topic_labels, "sub_topic_labels": sub_topic_labels,
                "ai_summary": None, "ai_topic_tags": [], "source": "channel_monitor",
                "created_at": now.isoformat(), "last_updated_at": now.isoformat(),
            }
            
            with db_write_lock:
                new_video_ref.set(video_data)
                video_stats_ref.document().set({
                    "video_id": new_video_ref.id, "youtube_id": youtube_id, "channel_id": channel_id,
                    "timestamp": now.isoformat(), "view_count": meta.get("view_count", 0),
                    "like_count": meta.get("like_count", 0), "comment_count": meta.get("comment_count", 0),
                    "delta_views": 0, "delta_likes": 0, "velocity": 0.0,
                    "quality_score_at_time": quality_result["quality_score"],
                    "feature_vector": quality_result["feature_vector"],
                })
                stats_accumulator["writes"] += 2
                logger.info(f"New video saved: {meta.get('title')} [{youtube_id}]")

        db.collection("channels").document(channel_firestore_id).update({"last_checked_at": now.isoformat()})
        stats_accumulator["writes"] += 1

    except Exception as e:
        logger.error(f"Error processing channel {channel_name} ({channel_id}): {e}")


def check_channel_updates():
    """Runs every 12h. Hard budget: stops at READ_BUDGET_PER_RUN, saves alert."""
    logger.info("=== Running check_channel_updates ===")
    db = database.get_db()
    if not db:
        logger.error("Database not connected.")
        return

    # Check daily priority and remaining reads to enforce dynamic budget and prevent exhaustion
    priority = determine_execution_priority(db)
    logger.info(f"Execution Priority Check: {priority}")
    if not priority["run_channels"]:
        logger.warning(f"Aborting channel updates check: dynamic execution priority mode is {priority['mode']} (Remaining: {priority['reads_remaining']})")
        return False

    # Restrict one-time usage to 19K, leaving a 1K buffer for frontend user reads
    run_budget_limit = max(0, min(19000, priority["reads_remaining"] - 1000))
    if run_budget_limit < 500:
        logger.warning(f"Aborting run: run budget limit ({run_budget_limit}) is too low (Remaining: {priority['reads_remaining']})")
        return False

    budget = ReadBudget(run_budget_limit)
    now = datetime.datetime.now(datetime.timezone.utc)
    lookback = now - datetime.timedelta(hours=48)

    stats_accumulator = {"writes": 0, "api_units": 0}
    status = "success"

    # Import locally to avoid circular dependencies
    from scheduler_cache import rebuild_dashboard_cache
    from database_status import record_quota_error

    try:
        budget.charge(700, "channels.stream()")
        raw_channel_docs = list(db.collection("channels").stream())
        
        # Load blacklisted channel IDs to enforce blacklist filter
        blacklisted_channel_ids = set()
        try:
            budget.charge(25, "blacklisted_channels.stream()")
            bl_docs = db.collection("blacklisted_channels").stream()
            blacklisted_channel_ids = {d.id for d in bl_docs}
        except Exception as bl_err:
            logger.warning(f"Could not load blacklisted_channels collection: {bl_err}")

        # Filter out blacklisted channels
        channel_docs = [
            doc for doc in raw_channel_docs 
            if doc.id not in blacklisted_channel_ids and doc.to_dict().get("channel_id") not in blacklisted_channel_ids
        ]
        logger.info(f"Loaded {len(raw_channel_docs)} raw channels ({len(channel_docs)} active after removing {len(blacklisted_channel_ids)} blacklisted channels). Budget: {budget.used}/{budget.limit}")

        budget.charge(min(9000, budget.limit - budget.used - 200), "videos.select(youtube_id)")
        try:
            videos_docs = db.collection("videos").select(["youtube_id"]).stream()
            tracked_youtube_ids = {
                d.to_dict().get("youtube_id") for d in videos_docs
                if d.to_dict().get("youtube_id")
            }
        except Exception as e:
            err_str = str(e)
            if "Quota exceeded" in err_str or "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
                raise e
            logger.warning(f"select() failed: {e}. Falling back to full stream.")
            videos_docs = db.collection("videos").stream()
            tracked_youtube_ids = {
                d.to_dict().get("youtube_id") for d in videos_docs
                if d.to_dict().get("youtube_id")
            }
        logger.info(f"Loaded {len(tracked_youtube_ids)} video IDs. Budget: {budget.used}/{budget.limit}")

        try:
            budget.charge(1, "system/deleted_videos_blacklist")
            blacklist_doc = db.collection("system").document("deleted_videos_blacklist").get()
            
            # Load from single document blacklist
            b_ids = []
            if blacklist_doc.exists:
                b_ids = blacklist_doc.to_dict().get("ids", [])
                for b_id in b_ids:
                    tracked_youtube_ids.add(b_id)
            
            # Load from deleted_videos collection
            collection_ids = 0
            try:
                deleted_docs = db.collection("deleted_videos").stream()
                for d in deleted_docs:
                    tracked_youtube_ids.add(d.id)
                    collection_ids += 1
            except Exception as coll_err:
                logger.warning(f"Could not load deleted_videos collection: {coll_err}")
                
            logger.info(f"Loaded {len(b_ids)} IDs from doc blacklist and {collection_ids} IDs from deleted_videos collection. Combined tracked count: {len(tracked_youtube_ids)}")
        except Exception as e:
            err_str = str(e)
            if "Quota exceeded" in err_str or "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
                raise e
            logger.warning(f"Failed to load deleted_videos blacklist: {e}")

        budget.charge(25, "custom_categories")
        custom_categories = _get_custom_categories(db)

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            futures = [
                executor.submit(process_single_channel, doc, db, now, lookback, tracked_youtube_ids, custom_categories, stats_accumulator)
                for doc in channel_docs
            ]
            concurrent.futures.wait(futures)

        logger.info(f"=== Finished check_channel_updates. Budget: {budget.used}/{budget.limit} ===")
        try:
            rebuild_dashboard_cache(db)
        except Exception as e:
            logger.error(f"Cache rebuild error: {e}")
        return True

    except ReadBudget.BudgetExceeded as e:
        status = "failed"
        msg = (f"check_channel_updates STOPPED early: {e}. "
               f"Reads: {budget.used}/{budget.limit}. Partial results already saved.")
        logger.warning(msg)
        _save_budget_alert(db, "check_channel_updates", budget.used, msg)
        try:
            rebuild_dashboard_cache(db)
        except Exception:
            pass
        return False
    except Exception as e:
        err_str = str(e)
        if "Quota exceeded" in err_str or "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
            status = "quota_exceeded"
            logger.error(f"Firestore quota exhausted during scan: {e}")
            record_quota_error(db, f"check_channel_updates: {err_str}")
            return False
        else:
            raise e
    finally:
        # Record final metrics only if we didn't experience a quota error
        if status != "quota_exceeded":
            record_run_metrics(db, "check_channel_updates", budget.used, stats_accumulator["writes"], stats_accumulator["api_units"], status)
