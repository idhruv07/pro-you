"""
Database Status Monitoring Module
---------------------------------
This module handles recording and tracking actual Firestore read/write budgets 
and YouTube API usage metrics. It writes status updates to a dedicated Firestore 
document (`system/status`) to provide accurate dashboard statistics.
"""

import datetime
from google.cloud import firestore

def record_run_metrics(db, action_name: str, reads_used: int, writes_used: int, api_units_used: int, status: str = "success"):
    """
    Saves the execution statistics for a scheduler run to the Firestore system/status document.
    """
    if not db:
        return
    
    try:
        status_ref = db.collection("system").document("status")
        now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # Read existing doc first to keep running counts if needed
        existing_doc = status_ref.get()
        existing_data = existing_doc.to_dict() if existing_doc.exists else {}
        
        # Accumulate metrics for today
        today_str = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        last_reset_day = existing_data.get("last_reset_day", today_str)
        
        # Reset counters if date has changed
        if last_reset_day != today_str:
            daily_reads = reads_used
            daily_writes = writes_used
            daily_api = api_units_used
        else:
            daily_reads = existing_data.get("daily_reads", 0) + reads_used
            daily_writes = existing_data.get("daily_writes", 0) + writes_used
            daily_api = existing_data.get("daily_api", 0) + api_units_used
            
        status_ref.set({
            "last_action": action_name,
            "last_run_at": now_str,
            "last_status": status,
            "daily_reads": daily_reads,
            "daily_writes": daily_writes,
            "daily_api": daily_api,
            "last_reset_day": today_str,
            # Limits (Spark free tier reference)
            "daily_reads_limit": 50000,
            "daily_writes_limit": 20000,
            "daily_api_limit": 10000
        }, merge=True)
    except Exception as e:
        print(f"[Database Status] Error writing run metrics: {e}")


def record_quota_error(db, error_message: str):
    """
    Records a Firestore quota exhaustion event to system/status.
    Called when a 429 RESOURCE_EXHAUSTED hits the very first read,
    before the normal finally block would be reached.
    This ensures the frontend always shows the correct status.
    """
    if not db:
        return
    try:
        status_ref = db.collection("system").document("status")
        now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
        status_ref.set({
            "last_action": "check_channel_updates",
            "last_run_at": now_str,
            "last_status": "quota_exceeded",
            "last_error": error_message[:500],  # cap to 500 chars
            "daily_reads": 50000,
            "daily_writes": 20000,
            "daily_reads_limit": 50000,
            "daily_writes_limit": 20000,
            "daily_api_limit": 10000
        }, merge=True)
        print(f"[Database Status] Quota error recorded: {error_message[:120]}")
    except Exception as e:
        print(f"[Database Status] Failed to record quota error: {e}")


def get_reads_remaining(db) -> int:
    """
    Checks Firestore system/status to calculate remaining daily free tier reads.
    Default free tier limit: 50,000 reads/day.
    """
    if not db:
        return 50000

    try:
        status_ref = db.collection("system").document("status")
        doc_snap = status_ref.get()
        if not doc_snap.exists:
            return 50000
        
        data = doc_snap.to_dict()
        today_str = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        last_reset_day = data.get("last_reset_day", "")
        
        if last_reset_day != today_str:
            return 50000
            
        daily_reads = data.get("daily_reads", 0)
        limit = data.get("daily_reads_limit", 50000)
        return max(0, limit - daily_reads)
    except Exception as e:
        err_str = str(e)
        if "Quota exceeded" in err_str or "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
            return 0
        return 50000


def determine_execution_priority(db) -> dict:
    """
    Dynamically decides which scheduler phases to run based on remaining daily reads.
    - High (>15k): Full run (Channels, Stats, Cache)
    - Medium (5k-15k): Uploads & UI Only (Channels, Cache; skip Stats)
    - Low (1k-5k): UI Cache Only (Cache; skip Channels & Stats)
    - Emergency (<1k): Graceful Abort (Protect frontend user quota)
    """
    remaining = get_reads_remaining(db)

    if remaining >= 15000:
        mode = "full"
        run_channels, run_stats, run_cache = True, True, True
    elif remaining >= 5000:
        mode = "medium"
        run_channels, run_stats, run_cache = True, True, True
    elif remaining >= 500:
        mode = "low"
        run_channels, run_stats, run_cache = False, True, True
    else:
        mode = "emergency"
        run_channels, run_stats, run_cache = False, False, False

    return {
        "mode": mode,
        "reads_remaining": remaining,
        "run_channels": run_channels,
        "run_stats": run_stats,
        "run_cache": run_cache,
    }

