"""
Scheduler Cache Rebuild Module
------------------------------
This step-by-step module compiles videos, todo tasks, and categories into 
a series of chunked documents in the Firestore `cache` collection. To bypass 
Firestore's 1MB size limit and accelerate frontend loading times, it:
1. Truncates description texts to a short preview.
2. Slices the compiled videos list into chunks of 200 videos.
3. Writes the chunks across multiple cache documents.
"""

import datetime
import logging
import database

logger = logging.getLogger(__name__)

def rebuild_dashboard_cache(db=None):
    """Compiles videos, todo, categories into cache docs to reduce frontend reads by 99%."""
    if not db:
        db = database.get_db()
    if not db:
        logger.error("No database connected. Cannot rebuild cache.")
        return
    try:
        logger.info("=== Rebuilding Dashboard Cache ===")
        import ai_analysis
        
        # Load existing ML config if present
        try:
            ml_doc = db.collection("system").document("ml_model_config").get()
            if ml_doc.exists:
                config = ml_doc.to_dict()
                if "weights" in config and "bias" in config:
                    ai_analysis.ML_CONFIG = config
                    logger.info("Loaded custom ML weights from Firestore config.")
        except Exception as e:
            logger.warning(f"Could not load ML config from Firestore: {e}")
        
        # Stream all videos dynamically ordered by quality score
        videos_docs = db.collection("videos").order_by("quality_score", direction="DESCENDING").stream()
        videos_list = []
        for d in videos_docs:
            v = d.to_dict()
            if v.get("source") == "channel_monitor" or not v.get("source"):
                v["id"] = d.id
                
                # LAZY LOADING OPTIMIZATION: Truncate descriptions in the cache doc to save 90% of file size
                desc = v.get("description", "")
                if len(desc) > 150:
                    v["description"] = desc[:150] + "..."
                else:
                    v["description"] = desc
                    
                videos_list.append(v)
                if len(videos_list) >= 3200:
                    break

        # Train PyTorch classifier on current dataset
        try:
            trained = ai_analysis.train_pytorch_classifier(videos_list)
            if trained:
                ai_analysis.ML_CONFIG = trained
                db.collection("system").document("ml_model_config").set(trained)
                logger.info("Successfully updated ML model config in Firestore.")
                
                # Re-evaluate all quality scores with the fresh ML model
                for v in videos_list:
                    pub_at_str = v.get("published_at") or v.get("created_at")
                    try:
                        if pub_at_str.endswith("Z"):
                            pub_at_str = pub_at_str.replace("Z", "+00:00")
                        pub_date = datetime.datetime.fromisoformat(pub_at_str)
                    except Exception:
                        pub_date = datetime.datetime.now(datetime.timezone.utc)
                        
                    res = ai_analysis.compute_quality_score(
                        view_count=float(v.get("view_count", 0)),
                        prev_view_count=float(v.get("prev_view_count", 0) or v.get("view_count", 0) * 0.9),
                        like_count=float(v.get("like_count", 0)),
                        comment_count=float(v.get("comment_count", 0)),
                        published_at=pub_date,
                        hours_elapsed=12.0,
                        channel_velocities=[v.get("velocity", 0)] * 3
                    )
                    v["quality_score"] = res["quality_score"]
                    v["momentum_label"] = res["momentum_label"]
                    v["is_hot_topic"] = res["is_hot_topic"]
                
                # Re-sort list by new quality score
                videos_list.sort(key=lambda x: x.get("quality_score", 0), reverse=True)
        except Exception as e:
            logger.error(f"Failed dynamic PyTorch training & re-evaluation: {e}")

        todo_list = []
        for d in db.collection("todo").stream():
            t = d.to_dict()
            t["id"] = d.id
            todo_list.append(t)
        todo_list.sort(key=lambda x: x.get("priority_order", 99))

        categories_list = []
        for d in db.collection("categories").stream():
            c = d.to_dict()
            c["id"] = d.id
            categories_list.append(c)

        try:
            stats_count = db.collection("video_stats").count().get()[0][0].value
        except Exception:
            stats_count = 0
        try:
            total_videos = db.collection("videos").count().get()[0][0].value
        except Exception:
            total_videos = len(videos_list)
        try:
            total_channels = db.collection("channels").count().get()[0][0].value
        except Exception:
            total_channels = 0

        # Chunk the video list into chunks of 200
        chunk_size = 200
        video_chunks = [videos_list[i:i + chunk_size] for i in range(0, len(videos_list), chunk_size)]

        now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
        db.collection("cache").document("dashboard_summary").set({
            "videos": video_chunks[0] if video_chunks else [],
            "todo": todo_list, "categories": categories_list,
            "stats_metadata": {
                "total_videos": total_videos, "total_todo": len(todo_list),
                "total_categories": len(categories_list), "total_channels": total_channels,
                "total_stats_snapshots": stats_count,
            },
            "chunks_count": len(video_chunks),
            "last_updated_at": now_str
        })

        # Save additional chunks as dashboard_summary_1, etc.
        for i in range(1, len(video_chunks)):
            db.collection("cache").document(f"dashboard_summary_{i}").set({
                "videos": video_chunks[i]
            })

        # Clean up any outdated/stale chunks from previous cache builds
        try:
            chunks_count = len(video_chunks)
            cache_docs = db.collection("cache").stream()
            for cd in cache_docs:
                if cd.id.startswith("dashboard_summary_"):
                    try:
                        suffix = cd.id.replace("dashboard_summary_", "")
                        idx = int(suffix)
                        if idx >= chunks_count:
                            logger.info(f"Deleting outdated cache chunk: {cd.id}")
                            cd.reference.delete()
                    except ValueError:
                        pass
        except Exception as cleanup_err:
            logger.error(f"Failed to clean up outdated cache chunks: {cleanup_err}")

        channels_list = []
        for d in db.collection("channels").stream():
            c = d.to_dict()
            c["id"] = d.id
            channels_list.append(c)
        channels_list.sort(key=lambda x: x.get("name", "").lower())
        
        blacklisted_list = []
        try:
            for d in db.collection("blacklisted_channels").stream():
                b = d.to_dict()
                b["id"] = d.id
                blacklisted_list.append(b)
        except Exception as e:
            logger.error(f"Error streaming blacklisted channels for cache: {e}")

        db.collection("cache").document("channels_summary").set({
            "channels": channels_list, 
            "channels_count": len(channels_list), 
            "blacklisted_channels": blacklisted_list,
            "last_updated_at": now_str
        })
        logger.info(f"Cache rebuilt: {len(videos_list)} videos, {len(todo_list)} todo, {len(channels_list)} channels.")
    except Exception as e:
        logger.error(f"Error rebuilding dashboard cache: {e}")


def build_correlations_cache(db=None):
    """
    Computes cross-channel topic correlations from the videos collection using AI & ML.
    Finds semantic clusters of videos within the last 48h using Google Gemini Embeddings.
    Fetches transcripts and generates an AI Trend Analysis.
    Writes the result to cache/correlations_summary for the frontend to read.
    """
    if not db:
        db = database.get_db()
    if not db:
        logger.error("No database connected. Cannot build correlations cache.")
        return

    try:
        logger.info("=== Building AI Correlations Cache ===")
        now = datetime.datetime.now(datetime.timezone.utc)
        cutoff_48h = (now - datetime.timedelta(hours=48)).isoformat()

        # Stream only recent videos (last 48h) to minimize reads
        recent_docs = db.collection("videos").where("published_at", ">=", cutoff_48h).stream()
        
        videos_list = []
        for doc in recent_docs:
            v = doc.to_dict()
            v["id"] = doc.id
            videos_list.append(v)
            
        try:
            from scheduler_correlations import build_ai_correlations
            correlations = build_ai_correlations(videos_list)
        except Exception as ai_err:
            logger.error(f"Failed to build AI correlations: {ai_err}")
            correlations = []

        now_str = now.isoformat()
        db.collection("cache").document("correlations_summary").set({
            "correlations": correlations,
            "total_topics": len(correlations),
            "window_hours": 48,
            "last_updated_at": now_str,
        })

        logger.info(f"AI Correlations cache built: {len(correlations)} cross-channel clusters analyzed.")
    except Exception as e:
        logger.error(f"Error building correlations cache: {e}")
