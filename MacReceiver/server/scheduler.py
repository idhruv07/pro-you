"""
Scheduler Orchestrator Module
-----------------------------
This orchestrator imports the modular workflow files and schedules the background
jobs (APScheduler) for channel checks, video stats updates, and cache building.
"""

from apscheduler.schedulers.background import BackgroundScheduler
import datetime
import logging

# Import modularized functions
from scheduler_channels import check_channel_updates
from scheduler_stats import update_video_stats
from scheduler_cache import rebuild_dashboard_cache

logger = logging.getLogger(__name__)

def start_scheduler():
    """Initializes and starts the 24/7 background scheduler worker."""
    scheduler = BackgroundScheduler()
    # Runs the channel scanner every 12 hours (starts immediately)
    scheduler.add_job(
        check_channel_updates, 
        "interval", 
        hours=12, 
        next_run_time=datetime.datetime.now()
    )
    # Runs the stats tracker every 12 hours (offset by 30 minutes to balance quota usage)
    scheduler.add_job(
        update_video_stats, 
        "interval", 
        hours=12, 
        next_run_time=datetime.datetime.now() + datetime.timedelta(minutes=30)
    )
    scheduler.start()
    logger.info("APScheduler initialized 24/7 background worker.")
