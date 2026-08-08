"""
Scheduler Video Stats Module
-----------------------------
This step-by-step module runs every 12h and updates statistics for videos 
published in the last 2 days. It fetches fresh metadata from the YouTube API, 
calculates view velocity and quality scores, creates historical stat logs, 
and updates linked Todo documents with momentum projections.
"""

import datetime
import logging
import math

import database
from scheduler_config import ReadBudget, READ_BUDGET_PER_RUN, _save_budget_alert
from database_status import record_run_metrics, determine_execution_priority

from youtube_service import fetch_videos_batch
from ai_analysis import compute_quality_score, get_channel_velocity_baseline
from snapshot_optimizer import should_record_snapshot, update_video_history_array, prune_old_snapshots

logger = logging.getLogger(__name__)

def update_video_stats():
    """
    Runs every 12h. Updates stats for videos published in the last 2 days only.
    Optimized for low-reads using preloading and hard budget tracking.
    """
    logger.info("=== Running update_video_stats ===")
    db = database.get_db()
    if not db:
        logger.error("Database not connected.")
        return

    # Check daily priority and remaining reads to enforce dynamic budget and prevent exhaustion
    priority = determine_execution_priority(db)
    logger.info(f"Execution Priority Check: {priority}")
    if not priority["run_stats"]:
        logger.warning(f"Aborting video stats update: dynamic execution priority mode is {priority['mode']} (Remaining: {priority['reads_remaining']})")
        return False

    # Restrict usage to remaining budget, leaving a 100-read buffer
    run_budget_limit = max(0, min(19000, priority["reads_remaining"] - 100))
    if run_budget_limit < 50:
        logger.warning(f"Aborting run: run budget limit ({run_budget_limit}) is too low (Remaining: {priority['reads_remaining']})")
        return False

    budget = ReadBudget(run_budget_limit)
    now = datetime.datetime.now(datetime.timezone.utc)
    videos_ref = db.collection("videos")
    video_stats_ref = db.collection("video_stats")
    HOURS_ELAPSED = 12

    stats_accumulator = {"writes": 0, "api_units": 0}
    status = "success"

    # Import locally to avoid circular dependencies
    from scheduler_cache import rebuild_dashboard_cache

    try:
        # 1. Last 2 days only
        cutoff = (now - datetime.timedelta(days=2)).isoformat()
        budget.charge(700, "videos.where(published_at >= 2d)")
        all_video_docs = list(videos_ref.where("published_at", ">=", cutoff).stream())
        
        # 1.5 Fetch 100 oldest-updated videos to perform automatic garbage collection (GC)
        # of deleted/private YouTube videos, using only single-field index to avoid composite index requirements.
        budget.charge(100, "videos.order_by(last_updated_at) limit 100")
        try:
            older_video_docs = list(
                videos_ref.order_by("last_updated_at", direction=firestore.Query.ASCENDING)
                .limit(100)
                .stream()
            )
            # Merge and deduplicate
            merged_docs = {d.id: d for d in all_video_docs}
            for d in older_video_docs:
                merged_docs[d.id] = d
            all_video_docs = list(merged_docs.values())
        except Exception as gc_err:
            logger.warning(f"Garbage collection preload failed: {gc_err}")

        logger.info(f"Loaded {len(all_video_docs)} total videos for updates (including GC videos). Budget: {budget.used}/{budget.limit}")

        video_map = {}
        for doc in all_video_docs:
            v = doc.to_dict()
            yt_id = v.get("youtube_id")
            if yt_id:
                video_map[yt_id] = (doc.id, v)

        # 2. Pre-load all todo items once
        budget.charge(100, "todo.stream() preload")
        todo_by_video_id = {}
        try:
            for t_doc in db.collection("todo").stream():
                vid_id = t_doc.to_dict().get("video_id")
                if vid_id:
                    todo_by_video_id.setdefault(vid_id, []).append(t_doc)
            logger.info(f"Pre-loaded todo. Budget: {budget.used}/{budget.limit}")
        except Exception as e:
            logger.warning(f"Could not pre-load todo: {e}")

        # 3. Pre-load velocity baselines
        unique_channel_ids = {
            v_data.get("channel_id", "") for _, (_, v_data) in video_map.items()
            if v_data.get("channel_id")
        }
        budget.charge(len(unique_channel_ids) * 5, f"velocity x{len(unique_channel_ids)} channels x5")
        channel_velocity_cache = {}
        for cid in unique_channel_ids:
            channel_velocity_cache[cid] = get_channel_velocity_baseline(cid, db)
        logger.info(f"Velocity loaded for {len(unique_channel_ids)} channels. Budget: {budget.used}/{budget.limit}")

        # 4. YouTube API fetch
        youtube_ids = list(video_map.keys())
        fresh_metadata = fetch_videos_batch(youtube_ids)
        
        # Calculate API units: 1 unit per batch of 50
        stats_accumulator["api_units"] += math.ceil(len(youtube_ids) / 50) if youtube_ids else 0
        
        fresh_map = {m["youtube_id"]: m for m in fresh_metadata}

        # 5. Detect and remove unavailable/deleted videos from Firestore
        missing_youtube_ids = set(youtube_ids) - set(fresh_map.keys())
        if missing_youtube_ids:
            logger.warning(f"Detected {len(missing_youtube_ids)} unavailable/deleted videos on YouTube: {missing_youtube_ids}")
            for m_yt_id in missing_youtube_ids:
                if m_yt_id in video_map:
                    f_id, old_data = video_map[m_yt_id]
                    logger.info(f"Removing unavailable video: {old_data.get('title')} ({m_yt_id}) from Firestore")
                    
                    # Delete video document
                    try:
                        videos_ref.document(f_id).delete()
                        stats_accumulator["writes"] += 1
                    except Exception as del_err:
                        logger.error(f"Error deleting video doc {f_id}: {del_err}")
                    
                    # Delete linked todo document if any
                    if f_id in todo_by_video_id:
                        for t_doc in todo_by_video_id[f_id]:
                            try:
                                db.collection("todo").document(t_doc.id).delete()
                                stats_accumulator["writes"] += 1
                                logger.info(f"Removed linked todo task for deleted video: {f_id}")
                            except Exception as del_todo_err:
                                logger.error(f"Error deleting linked todo {t_doc.id}: {del_todo_err}")
                                
                    # Delete linked video stats snapshots
                    try:
                        stats_docs = db.collection("video_stats").where("video_id", "==", f_id).stream()
                        for sd in stats_docs:
                            db.collection("video_stats").document(sd.id).delete()
                            stats_accumulator["writes"] += 1
                    except Exception as stats_del_err:
                        logger.warning(f"Could not delete stats snapshots for {f_id}: {stats_del_err}")

        # 6. Process each video
        videos_processed = 0
        for yt_id, fresh in fresh_map.items():
            if yt_id not in video_map:
                continue

            budget.charge(2, f"stat+update for {yt_id}")

            firestore_id, old_data = video_map[yt_id]
            channel_id = old_data.get("channel_id", "")
            prev_views = old_data.get("view_count", 0)
            prev_likes = old_data.get("like_count", 0)
            delta_views = max(fresh.get("view_count", 0) - prev_views, 0)
            delta_likes = max(fresh.get("like_count", 0) - prev_likes, 0)
            velocity = delta_views / float(HOURS_ELAPSED)

            try:
                published_at = datetime.datetime.fromisoformat(old_data.get("published_at", now.isoformat()))
            except Exception:
                published_at = now

            quality_result = compute_quality_score(
                view_count=fresh.get("view_count", 0), prev_view_count=prev_views,
                like_count=fresh.get("like_count", 0), comment_count=fresh.get("comment_count", 0),
                published_at=published_at, hours_elapsed=HOURS_ELAPSED,
                channel_velocities=channel_velocity_cache.get(channel_id, [])
            )

            new_views = fresh.get("view_count", 0)
            new_vel = round(velocity, 2)
            prev_stat = {"view_count": prev_views, "velocity": old_data.get("velocity", 0.0)}

            if should_record_snapshot(prev_stat, new_views, new_vel, threshold_pct=5.0):
                video_stats_ref.document().set({
                    "video_id": firestore_id, "youtube_id": yt_id, "channel_id": channel_id,
                    "timestamp": now.isoformat(), "view_count": new_views,
                    "like_count": fresh.get("like_count", 0), "comment_count": fresh.get("comment_count", 0),
                    "delta_views": delta_views, "delta_likes": delta_likes,
                    "velocity": new_vel, "quality_score_at_time": quality_result["quality_score"],
                    "feature_vector": quality_result["feature_vector"],
                })
                stats_accumulator["writes"] += 1

            # Embedded 7-day history array inside the video document
            updated_history = update_video_history_array(
                old_data.get("history"), new_views, new_vel, timestamp=now.isoformat(), max_days=7
            )

            videos_ref.document(firestore_id).update({
                "view_count": new_views, "like_count": fresh.get("like_count", 0),
                "comment_count": fresh.get("comment_count", 0),
                "quality_score": quality_result["quality_score"],
                "momentum_label": quality_result["momentum_label"],
                "is_hot_topic": quality_result["is_hot_topic"],
                "velocity": quality_result["velocity"], "z_score": quality_result["z_score"],
                "feature_vector": quality_result["feature_vector"],
                "history": updated_history,
                "last_updated_at": now.isoformat(),
            })
            stats_accumulator["writes"] += 1

            try:
                todo_docs = todo_by_video_id.get(firestore_id, [])
                if todo_docs:
                    views = fresh.get("view_count", 0)
                    prev_v = max(prev_views, 1)
                    growth_rate = round(((views - prev_v) / prev_v) * 100, 1)
                    projected_24h = views + int(velocity * 24)
                    # Dynamic performance tier categorization with rich varieties
                    if quality_result["is_hot_topic"] or growth_rate >= 15.0 or velocity >= 500:
                        hot_status = "🚀 Viral Surge" if velocity >= 500 else "🔥 High Growth"
                    elif growth_rate >= 5.0 or velocity >= 100:
                        hot_status = "📈 Gaining Momentum"
                    elif quality_result.get("quality_score", 0) >= 70:
                        hot_status = "💎 High Quality Evergreen"
                    elif velocity >= 10:
                        hot_status = "💡 Steady Pace"
                    else:
                        hot_status = "🌱 Baseline Interest"
                    for t_doc in todo_docs:
                        t_doc.reference.update({
                            "view_count": views, "like_count": fresh.get("like_count", 0),
                            "comment_count": fresh.get("comment_count", 0), "velocity": velocity,
                            "delta_12h": delta_views, "growth_rate_12h": growth_rate,
                            "projected_24h": projected_24h, "hot_status": hot_status,
                            "is_hot_topic": quality_result["is_hot_topic"],
                            "quality_score": quality_result["quality_score"],
                            "updated_at": now.isoformat(),
                        })
                        stats_accumulator["writes"] += 1
            except Exception as e:
                logger.warning(f"Error updating todo for {firestore_id}: {e}")

            videos_processed += 1

        logger.info(f"=== Finished update_video_stats. Processed {videos_processed} videos. Budget: {budget.used}/{budget.limit} ===")
        try:
            prune_old_snapshots(db, retention_days=10)
        except Exception as e:
            logger.warning(f"Snapshot pruning error: {e}")
        try:
            prune_low_performance_videos(db)
        except Exception as e:
            logger.warning(f"Low performance video pruning error: {e}")
        try:
            rebuild_dashboard_cache(db)
        except Exception as e:
            logger.error(f"Cache rebuild error: {e}")
        return True

    except ReadBudget.BudgetExceeded as e:
        status = "failed"
        msg = (f"update_video_stats STOPPED early: {e}. "
               f"Reads: {budget.used}/{budget.limit}. Partial results already saved.")
        logger.warning(msg)
        _save_budget_alert(db, "update_video_stats", budget.used, msg)
        try:
            rebuild_dashboard_cache(db)
        except Exception:
            pass
        return False
    except Exception as e:
        err_str = str(e)
        if "Quota exceeded" in err_str or "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
            status = "quota_exceeded"
            logger.error(f"Firestore quota exhausted during video stats: {e}")
            from database_status import record_quota_error
            record_quota_error(db, f"update_video_stats: {err_str}")
            return False
        else:
            raise e
    finally:
        # Record final metrics only if we didn't experience a quota error
        if status != "quota_exceeded":
            record_run_metrics(db, "update_video_stats", budget.used, stats_accumulator["writes"], stats_accumulator["api_units"], status)


def prune_low_performance_videos(db):
    """
    Deletes and blacklists videos from Firestore that are older than 4 days (96 hours) and have less than 20,000 views.
    """
    logger.info("=== Running prune_low_performance_videos ===")
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=4)
    
    videos_ref = db.collection("videos")
    docs = list(videos_ref.stream())
    
    pruned_count = 0
    new_blacklisted_ids = []
    
    for d in docs:
        v = d.to_dict()
        pub_str = v.get("published_at") or v.get("created_at")
        if not pub_str:
            continue
        try:
            if pub_str.endswith("Z"):
                pub_str = pub_str.replace("Z", "+00:00")
            pub_date = datetime.datetime.fromisoformat(pub_str)
        except Exception:
            continue
            
        if pub_date.tzinfo is None:
            pub_date = pub_date.replace(tzinfo=datetime.timezone.utc)
            
        if pub_date < cutoff:
            views = float(v.get("view_count", 0))
            if views < 20000:
                logger.info(f"Pruning and blacklisting low-performance video: {v.get('title')} (Views: {views}, Age: {(now - pub_date).days} days)")
                yid = v.get("youtube_id")
                if yid:
                    new_blacklisted_ids.append(yid)
                    
                try:
                    d.reference.delete()
                    pruned_count += 1
                except Exception as del_err:
                    logger.error(f"Error deleting low-performance video doc {d.id}: {del_err}")
                
                # Cascade delete video stats snapshots
                try:
                    stats = db.collection("video_stats").where("video_id", "==", d.id).stream()
                    for sd in stats:
                        sd.reference.delete()
                except Exception:
                    pass
                
                # Cascade delete linked todo task
                try:
                    todos = db.collection("todo").where("video_id", "==", d.id).stream()
                    for td in todos:
                        td.reference.delete()
                except Exception:
                    pass

    # Batch write new blacklisted IDs to system/deleted_videos_blacklist
    if new_blacklisted_ids:
        try:
            blacklist_ref = db.collection("system").document("deleted_videos_blacklist")
            blacklist_doc = blacklist_ref.get()
            current_ids = set()
            if blacklist_doc.exists:
                current_ids = set(blacklist_doc.to_dict().get("ids", []))
            
            updated_ids = list(current_ids.union(new_blacklisted_ids))
            blacklist_ref.set({"ids": updated_ids}, merge=True)
            logger.info(f"Successfully added {len(new_blacklisted_ids)} pruned videos to deleted_videos_blacklist doc.")
        except Exception as e:
            logger.error(f"Failed to update deleted_videos_blacklist doc: {e}")
            
        # Also write to deleted_videos collection for safety
        try:
            for yid in new_blacklisted_ids:
                db.collection("deleted_videos").document(yid).set({
                    "deleted_at": now.isoformat(),
                    "reason": "low_performance_pruning_4d_20k",
                    "deleted_by": "system_pruner"
                })
            logger.info(f"Successfully wrote {len(new_blacklisted_ids)} pruned video documents to deleted_videos collection.")
        except Exception as e:
            logger.error(f"Failed to write pruned videos to deleted_videos collection: {e}")
                    
    logger.info(f"=== Finished prune_low_performance_videos. Pruned & blacklisted {pruned_count} videos ===")
    return pruned_count
