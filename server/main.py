import os
import logging
from logging.handlers import RotatingFileHandler
from fastapi import FastAPI, Depends, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import List, Any, Optional
import datetime

import schemas, database
from youtube_service import fetch_video_metadata, fetch_channel_metadata
from scheduler import start_scheduler, check_channel_updates, update_video_stats, rebuild_dashboard_cache
from ai_analysis import SYSTEM_CATEGORIES
from contextlib import asynccontextmanager
from firebase_admin import auth

ALLOWED_EMAILS = {
    "idhruvbhardwaj@gmail.com",
    "dhruv.bhardwaj1632@gmail.com",
    "ijyotidb@gmail.com"
}

log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
log_file = os.path.join(os.path.dirname(__file__), 'ddj_talks.log')
file_handler = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=2)
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logger = logging.getLogger("ddj_talks")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Pro-You SaaS Backend Server...")
    start_scheduler()
    yield

app = FastAPI(title="Pro-You SaaS Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_firestore_db():
    db = database.get_db()
    if not db:
        raise HTTPException(status_code=500, detail="Database not initialized")
    return db

def verify_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized: Missing Authorization header")
    token = authorization.split("Bearer ")[1]
    try:
        decoded = auth.verify_id_token(token)
        email = decoded.get("email", "").lower()
        if email not in ALLOWED_EMAILS:
            logger.warning(f"Unauthorized email attempted access: {email}")
            raise HTTPException(status_code=403, detail=f"Access Denied: '{email}' is not authorized.")
        return decoded
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication token")

# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/api")
def read_root():
    return {"message": "Pro-You SaaS API is running"}

@app.get("/api/auth/allowed")
def get_allowed_emails():
    return {"allowed_emails": list(ALLOWED_EMAILS)}

# ─── Categories ───────────────────────────────────────────────────────────────
@app.get("/api/categories")
def read_categories(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Returns all system + user-created categories."""
    # Return system categories (static)
    system = [{"id": f"sys-{c['name']}", "name": c['name'], "color": c['color'],
                "keywords": c['keywords'], "sub_categories": c.get('sub_categories', []),
                "is_system": True} for c in SYSTEM_CATEGORIES]

    # Return user-created categories from Firestore
    user_cats = []
    docs = db.collection('categories').stream()
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        user_cats.append(d)

    return system + user_cats

@app.post("/api/categories")
def create_category(category: schemas.CategoryCreate, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Create a user-defined category."""
    new_doc = db.collection('categories').document()
    data = {
        'name': category.name,
        'color': getattr(category, 'color', '#888888'),
        'keywords': getattr(category, 'keywords', []),
        'sub_categories': [],
        'is_system': False,
        'created_by': user.get('email'),
        'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    new_doc.set(data)
    data['id'] = new_doc.id
    return data

@app.delete("/api/categories/{cat_id}")
def delete_category(cat_id: str, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    doc_ref = db.collection('categories').document(cat_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Category not found")
    cat = doc_ref.get().to_dict()
    if cat.get('is_system'):
        raise HTTPException(status_code=400, detail="Cannot delete system categories")
    doc_ref.delete()
    return {"message": "Category deleted"}

# ─── Videos ───────────────────────────────────────────────────────────────────
@app.get("/api/videos")
def read_videos(category_id: str = None, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """
    Returns compiled videos from the cache chunks to optimize reads.
    Falls back to direct collection query only if cache is unavailable.
    """
    try:
        cache_ref = db.collection('cache')
        summary_doc = cache_ref.document('dashboard_summary').get()
        if summary_doc.exists:
            data = summary_doc.to_dict()
            videos = data.get('videos', [])
            chunks_count = data.get('chunks_count', 1)
            for i in range(1, chunks_count):
                chunk_doc = cache_ref.document(f"dashboard_summary_{i}").get()
                if chunk_doc.exists:
                    videos.extend(chunk_doc.to_dict().get('videos', []))
            
            if category_id:
                videos = [v for v in videos if v.get('category_id') == category_id]
            return videos
    except Exception as e:
        logger.warning(f"Videos cache read failed: {e}. Falling back to direct stream.")

    videos_ref = db.collection('videos')
    if category_id:
        docs = videos_ref.where('category_id', '==', category_id).limit(400).stream()
    else:
        docs = videos_ref.limit(400).stream()

    videos = []
    for doc in docs:
        v = doc.to_dict()
        v['id'] = doc.id
        videos.append(v)
    return videos

@app.get("/api/videos/feed")
def get_feed(
    filter: Optional[str] = None,
    category: Optional[str] = None,
    sub_category: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(verify_user),
    db: Any = Depends(get_firestore_db)
):
    """
    Returns videos from the scheduler-built cache document.
    Cost: 1 read (cache/dashboard_summary) instead of 2,695 reads (full collection scan).
    Cache is refreshed every 8h by the scheduler.
    """
    try:
        cache_doc = db.collection('cache').document('dashboard_summary').get()
        if not cache_doc.exists:
            raise HTTPException(status_code=503, detail="Feed cache not built yet. Wait for next scheduler run.")
        all_videos = cache_doc.to_dict().get('videos', [])
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Cache unavailable: {e}")

    results = []
    for v in all_videos:
        if filter == 'hot' and not v.get('is_hot_topic', False):
            continue
        if filter == 'gaining' and v.get('momentum_label') not in ['📈 Hot Right Now']:
            continue
        if filter == 'new' and v.get('momentum_label') not in ['🆕 Just Posted']:
            continue
        if category and category not in (v.get('topic_labels') or []):
            continue
        if sub_category and sub_category not in (v.get('sub_topic_labels') or []):
            continue
        results.append(v)

    results.sort(key=lambda x: x.get('quality_score', 0), reverse=True)
    return results[:limit]

@app.get("/api/videos/feed/stats")
def get_feed_stats(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """
    Returns summary stats computed from the cache document.
    Cost: 1 read (cache/dashboard_summary) instead of 2,695 reads (full collection scan).
    """
    try:
        cache_doc = db.collection('cache').document('dashboard_summary').get()
        if not cache_doc.exists:
            return {"total_videos": 0, "hot_count": 0, "new_today": 0}
        cache = cache_doc.to_dict()
        videos = cache.get('videos', [])
        meta = cache.get('stats_metadata', {})
    except Exception:
        return {"total_videos": 0, "hot_count": 0, "new_today": 0}

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_24h = now - datetime.timedelta(hours=24)
    hot_count = sum(1 for v in videos if v.get('is_hot_topic'))
    new_today = 0
    for v in videos:
        try:
            created = datetime.datetime.fromisoformat(v.get('created_at', ''))
            if created.tzinfo is None:
                created = created.replace(tzinfo=datetime.timezone.utc)
            if created >= cutoff_24h:
                new_today += 1
        except Exception:
            pass

    return {
        "total_videos": meta.get('total_videos', len(videos)),
        "hot_count": hot_count,
        "new_today": new_today,
        "total_channels": meta.get('total_channels', 0),
        "cache_age": cache.get('last_updated_at', ''),
    }

@app.post("/api/videos")
def create_video(video: schemas.VideoCreate, background_tasks: BackgroundTasks, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    metadata = fetch_video_metadata(video.url)
    if not metadata:
        raise HTTPException(status_code=400, detail="Could not fetch video metadata")

    videos_ref = db.collection('videos')
    query = videos_ref.where('youtube_id', '==', metadata['youtube_id']).stream()
    if any(query):
        raise HTTPException(status_code=400, detail="Video already tracked")

    new_doc = videos_ref.document()
    data = {
        'youtube_id': metadata['youtube_id'],
        'url': metadata['url'],
        'title': metadata['title'],
        'description': metadata.get('description', ''),
        'channel_id': metadata.get('channel_id'),
        'channel_name': metadata['channel_name'],
        'thumbnail_url': metadata['thumbnail_url'],
        'published_at': metadata['published_at'].isoformat() if metadata['published_at'] else None,
        'duration_seconds': metadata.get('duration_seconds', 0),
        'is_short': metadata.get('duration_seconds', 0) <= 60 and metadata.get('duration_seconds', 0) > 0,
        'category_id': str(video.category_id) if video.category_id else None,
        'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'view_count': metadata.get('view_count', 0),
        'like_count': metadata.get('like_count', 0),
        'comment_count': metadata.get('comment_count', 0),
        'quality_score': 0,
        'momentum_label': '📺 Normal',
        'is_hot_topic': False,
        'topic_labels': [],
        'sub_topic_labels': [],
        'ai_summary': None,
        'ai_topic_tags': [],
        'source': 'manual',
        'added_by': user.get('email')
    }
    new_doc.set(data)
    data['id'] = new_doc.id

    stats_ref = db.collection('video_stats').document()
    stats_ref.set({
        'video_id': new_doc.id,
        'youtube_id': metadata['youtube_id'],
        'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'view_count': metadata.get('view_count', 0),
        'like_count': metadata.get('like_count', 0),
        'comment_count': metadata.get('comment_count', 0),
        'delta_views': 0,
        'delta_likes': 0,
        'velocity': 0.0,
        'quality_score_at_time': 0,
        'feature_vector': {},
    })

    background_tasks.add_task(rebuild_dashboard_cache, db)
    return data

# ─── Channels ──────────────────────────────────────────────────────────────────
@app.get("/api/channels")
def read_channels(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """
    Returns all tracked channels.
    Cost: 1 read from cache/channels_summary instead of 605 reads.
    """
    try:
        cache_doc = db.collection('cache').document('channels_summary').get()
        if cache_doc.exists:
            return cache_doc.to_dict().get('channels', [])
    except Exception as e:
        logger.warning(f"Channels cache read failed: {e}. Falling back to direct stream.")

    docs = db.collection('channels').stream()
    channels = []
    for doc in docs:
        c = doc.to_dict()
        c['id'] = doc.id
        channels.append(c)
    return channels

@app.post("/api/channels")
def create_channel(channel: schemas.ChannelCreate, background_tasks: BackgroundTasks, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    metadata = fetch_channel_metadata(channel.url)
    if not metadata:
        raise HTTPException(status_code=400, detail="Could not fetch channel metadata")

    channels_ref = db.collection('channels')
    channel_doc = channels_ref.document(metadata['channel_id'])
    if channel_doc.get().exists:
        raise HTTPException(status_code=400, detail="Channel already tracked")

    # If the channel was previously blacklisted, un-blacklist it
    try:
        db.collection("blacklisted_channels").document(metadata['channel_id']).delete()
    except Exception as e:
        logger.warning(f"Failed to remove from blacklisted_channels: {e}")

    data = {
        'channel_id': metadata['channel_id'],
        'url': metadata['url'],
        'name': metadata['name'],
        'thumbnail_url': metadata['thumbnail_url'],
        'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'last_checked_at': None,
        'added_by': user.get('email')
    }
    channel_doc.set(data)
    data['id'] = channel_doc.id
    background_tasks.add_task(rebuild_dashboard_cache, db)
    return data

@app.delete("/api/videos/{video_id}")
def delete_video(video_id: str, background_tasks: BackgroundTasks, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    doc_ref = db.collection('videos').document(video_id)
    doc_snap = doc_ref.get()
    if not doc_snap.exists:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Save the youtube_id to the deleted_videos collection to blacklist it
    video_data = doc_snap.to_dict()
    youtube_id = video_data.get("youtube_id")
    if youtube_id:
        db.collection("deleted_videos").document(youtube_id).set({
            "deleted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "title": video_data.get("title", ""),
            "channel_name": video_data.get("channel_name", ""),
            "deleted_by": user.get("email")
        })
        # Sync with system/deleted_videos_blacklist document
        try:
            from google.cloud import firestore
            blacklist_ref = db.collection("system").document("deleted_videos_blacklist")
            if blacklist_ref.get().exists:
                blacklist_ref.update({"ids": firestore.ArrayUnion([youtube_id])})
            else:
                blacklist_ref.set({"ids": [youtube_id]})
        except Exception as e:
            logger.error(f"Failed to sync video delete to blacklist doc: {e}")
        
    doc_ref.delete()
    logger.info(f"Video {video_id} (YouTube ID: {youtube_id}) deleted by {user.get('email')}")
    background_tasks.add_task(rebuild_dashboard_cache, db)
    return {"message": "Video deleted successfully"}

@app.get("/api/channels/blacklisted")
def read_blacklisted_channels(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """
    Returns all blacklisted channels.
    """
    docs = db.collection('blacklisted_channels').stream()
    blacklisted = []
    for doc in docs:
        c = doc.to_dict()
        c['id'] = doc.id
        blacklisted.append(c)
    return blacklisted

@app.delete("/api/channels/{channel_id}")
def delete_channel(channel_id: str, background_tasks: BackgroundTasks, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Unsubscribe/delete channel and automatically remove all its videos and todo items."""
    # Find channel doc either by doc.id or by channel_id field
    doc_ref = db.collection('channels').document(channel_id)
    doc_data = doc_ref.get()
    
    yt_channel_id = channel_id
    channel_name = channel_id
    if doc_data.exists:
        c_dict = doc_data.to_dict()
        yt_channel_id = c_dict.get('channel_id', channel_id)
        channel_name = c_dict.get('name', c_dict.get('channel_name', channel_id))
        doc_ref.delete()
    else:
        # Search by channel_id field
        matches = list(db.collection('channels').where('channel_id', '==', channel_id).stream())
        for m in matches:
            c_dict = m.to_dict()
            yt_channel_id = c_dict.get('channel_id', channel_id)
            channel_name = c_dict.get('name', c_dict.get('channel_name', channel_id))
            m.reference.delete()

    # Save to blacklisted_channels collection to prevent re-adding and track on frontend
    try:
        db.collection("blacklisted_channels").document(yt_channel_id).set({
            "channel_id": yt_channel_id,
            "name": channel_name,
            "blacklisted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "blacklisted_by": user.get("email")
        })
    except Exception as e:
        logger.error(f"Failed to blacklist channel {yt_channel_id}: {e}")

    # Cascade delete videos from this channel
    v_docs = list(db.collection('videos').where('channel_id', '==', yt_channel_id).stream())
    for v in v_docs:
        v.reference.delete()

    # Cascade delete todo items from this channel
    t_docs = list(db.collection('todo').where('channel_id', '==', yt_channel_id).stream())
    for t in t_docs:
        t.reference.delete()

    logger.info(f"Unsubscribed channel {yt_channel_id} and removed {len(v_docs)} videos by {user.get('email')}")
    background_tasks.add_task(rebuild_dashboard_cache, db)
    return {"message": "Channel unsubscribed and videos removed successfully", "removed_videos": len(v_docs)}

# ─── Admin / Debug ────────────────────────────────────────────────────────────
@app.post("/api/admin/trigger-check")
def trigger_channel_check(background_tasks: BackgroundTasks, user: dict = Depends(verify_user)):
    """Manually trigger a channel update scan (runs in background)."""
    background_tasks.add_task(check_channel_updates)
    return {"message": "Channel check triggered in background."}

@app.post("/api/admin/trigger-stats")
def trigger_stat_update(background_tasks: BackgroundTasks, user: dict = Depends(verify_user)):
    """Manually trigger a video stat update (runs in background)."""
    background_tasks.add_task(update_video_stats)
    return {"message": "Stat update triggered in background."}

@app.post("/api/admin/trigger-cache")
def trigger_cache_rebuild(background_tasks: BackgroundTasks, user: dict = Depends(verify_user)):
    """Manually trigger a dashboard cache rebuild (runs in background)."""
    background_tasks.add_task(rebuild_dashboard_cache)
    return {"message": "Dashboard cache rebuild triggered in background."}

# ─── To Do / Content Suggestions ─────────────────────────────────────────────

def _content_opportunity_score(v: dict) -> float:
    """
    Ranks a video by its potential as content to create a response/reaction/explainer video.
    Higher score = better opportunity.

    Signals used:
    - quality_score: is it trending/gaining traction right now?
    - comment_count: high comments = discussion, controversy, questions people have
    - engagement_rate: are viewers engaged or passive?
    - is_short: deprioritise shorts
    - age: slightly prefer fresher content (more relevant)
    """
    quality = v.get('quality_score', 0)
    comments = v.get('comment_count', 0)
    likes = v.get('like_count', 0)
    views = max(v.get('view_count', 1), 1)
    is_short = v.get('is_short', False)
    velocity = v.get('velocity', 0)

    # Comment richness: discussion-heavy = more angles to cover
    comment_richness = min(40, (comments / views) * 10000)

    # Engagement rate
    engagement = min(30, ((likes + comments * 3) / views) * 5000)

    # Velocity momentum
    velocity_bonus = min(20, velocity / 100)

    # Quality signal
    quality_bonus = quality * 0.1  # 0-10

    # Penalise shorts for long-form suggestions
    short_penalty = -30 if is_short else 0

    return comment_richness + engagement + velocity_bonus + quality_bonus + short_penalty


@app.get("/api/todo/suggestions")
def get_todo_suggestions(
    limit: int = 30,
    long_form_only: bool = False,
    user: dict = Depends(verify_user),
    db: Any = Depends(get_firestore_db)
):
    """
    Returns up to `limit` videos ranked by content opportunity score.
    - 25 long-form + 5 shorts by default
    - Excludes videos already in the todo list
    - Deduplicates by channel (max 3 per channel for diversity)
    """
    # Fetch videos & todo items (preferably from cache to save ~2,700 reads)
    try:
        cache_doc = db.collection('cache').document('dashboard_summary').get()
        if cache_doc.exists:
            cache_data = cache_doc.to_dict()
            all_videos = cache_data.get('videos', [])
            todo_list = cache_data.get('todo', [])
            todo_video_ids = {t.get('video_id') for t in todo_list if t.get('video_id')}
            videos = [v for v in all_videos if v.get('id') not in todo_video_ids and v.get('youtube_id') not in todo_video_ids]
        else:
            all_docs = list(db.collection('videos').where('source', '==', 'channel_monitor').limit(300).stream())
            todo_docs = list(db.collection('todo').limit(100).stream())
            todo_video_ids = {d.to_dict().get('video_id') for d in todo_docs}
            videos = []
            for doc in all_docs:
                v = doc.to_dict()
                v['id'] = doc.id
                if doc.id not in todo_video_ids:
                    videos.append(v)
    except Exception as e:
        logger.warning(f"Suggestions cache read failed: {e}. Falling back to stream.")
        all_docs = list(db.collection('videos').where('source', '==', 'channel_monitor').limit(300).stream())
        todo_docs = list(db.collection('todo').limit(100).stream())
        todo_video_ids = {d.to_dict().get('video_id') for d in todo_docs}
        videos = []
        for doc in all_docs:
            v = doc.to_dict()
            v['id'] = doc.id
            if doc.id not in todo_video_ids:
                videos.append(v)

    # Separate long-form and shorts
    long_form = [v for v in videos if not v.get('is_short', False)]
    shorts = [v for v in videos if v.get('is_short', False)]

    # Score and sort both lists
    long_form.sort(key=_content_opportunity_score, reverse=True)
    shorts.sort(key=_content_opportunity_score, reverse=True)

    # Enforce channel diversity: max 3 videos per channel
    def pick_diverse(pool, n):
        channel_counts = {}
        result = []
        for v in pool:
            ch = v.get('channel_id', '')
            if channel_counts.get(ch, 0) < 3:
                result.append(v)
                channel_counts[ch] = channel_counts.get(ch, 0) + 1
            if len(result) >= n:
                break
        return result

    if long_form_only:
        selected = pick_diverse(long_form, limit)
    else:
        # 25 long-form + 5 shorts (or fewer if not enough)
        long_picks = pick_diverse(long_form, 25)
        short_picks = pick_diverse(shorts, 5)
        selected = long_picks + short_picks

    # Add opportunity score to response
    for v in selected:
        v['opportunity_score'] = round(_content_opportunity_score(v), 1)

    return selected[:limit]


@app.get("/api/todo")
def get_todo_list(
    status: Optional[str] = None,
    user: dict = Depends(verify_user),
    db: Any = Depends(get_firestore_db)
):
    """Returns saved todo items, optionally filtered by status."""
    ref = db.collection('todo')
    docs = ref.stream() if not status else ref.where('status', '==', status).stream()
    items = []
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        items.append(d)
    # Sort by priority_order then created_at
    items.sort(key=lambda x: (x.get('priority_order', 99), x.get('created_at', '')))
    return items


@app.post("/api/todo")
def add_to_todo(item: schemas.TodoItemCreate, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Save a video to the To Do list."""
    # Check not duplicate
    existing = list(db.collection('todo').where('video_id', '==', item.video_id).stream())
    if existing:
        raise HTTPException(status_code=400, detail="Video already in To Do list")

    # Count existing pending items for priority ordering
    pending_count = len(list(db.collection('todo').where('status', '==', 'pending').stream()))

    new_doc = db.collection('todo').document()
    data = {
        'video_id': item.video_id,
        'youtube_id': item.youtube_id,
        'title': item.title,
        'url': item.url,
        'channel_name': item.channel_name or '',
        'thumbnail_url': item.thumbnail_url or '',
        'topic_labels': item.topic_labels or [],
        'quality_score': item.quality_score or 0,
        'notes': item.notes or '',
        'is_short': item.is_short or False,
        'duration_seconds': item.duration_seconds,
        'status': 'pending',
        'priority_order': pending_count + 1,
        'added_by': user.get('email'),
        'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    new_doc.set(data)
    data['id'] = new_doc.id
    logger.info(f"Todo item added: '{item.title}' by {user.get('email')}")
    return data


@app.patch("/api/todo/{todo_id}")
def update_todo(todo_id: str, update: schemas.TodoItemUpdate, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Update status or notes of a todo item."""
    doc_ref = db.collection('todo').document(todo_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Todo item not found")

    update_data = {'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if update.status is not None:
        update_data['status'] = update.status
    if update.notes is not None:
        update_data['notes'] = update.notes

    doc_ref.update(update_data)
    d = doc_ref.get().to_dict()
    d['id'] = todo_id
    return d


@app.delete("/api/todo/{todo_id}")
def delete_todo(todo_id: str, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Remove a video from the To Do list (accepts either Firestore doc_id or video_id)."""
    doc_ref = db.collection('todo').document(todo_id)
    if doc_ref.get().exists:
        doc_ref.delete()
        return {"message": "Todo item removed"}

    # Fallback: search by video_id if todo_id was passed as a video ID
    v_docs = list(db.collection('todo').where('video_id', '==', todo_id).stream())
    if v_docs:
        for d in v_docs:
            d.reference.delete()
        return {"message": "Todo item removed"}

    raise HTTPException(status_code=404, detail="Todo item not found")


@app.patch("/api/todo/{todo_id}/reorder")
def reorder_todo(todo_id: str, priority_order: int, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Update priority order of a todo item."""
    doc_ref = db.collection('todo').document(todo_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Todo item not found")
    doc_ref.update({'priority_order': priority_order, 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    return {"message": "Reordered"}


# ─── Topic Correlations & Stats ───────────────────────────────────────────────

STOP_WORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
    'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here',
    'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in',
    'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor',
    'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that', 'thats',
    'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll',
    'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt',
    'we', 'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which',
    'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll',
    'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves',
    # YouTube / Common video terms
    'video', 'youtube', 'channel', 'new', 'update', 'vs', 'full', 'episode', 'hindi', 'english', 'tamil', 'telugu',
    'review', 'preview', 'explained', 'reaction', 'react', 'shorts', 'short', 'viral', 'trending', 'tutorial',
    'course', 'learn', 'how', 'to', 'make', 'get', 'best', 'top', 'worst', 'amazing', 'shocking', 'watch', 'now',
    'today', 'tomorrow', 'yesterday', 'daily', 'weekly', 'monthly', 'yearly', 'life', 'vlog', 'vlogs'
}

@app.get("/api/videos/{video_id}/stats")
def get_video_stats(video_id: str, user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """
    Returns the last 20 stat snapshots for a video, ordered by time.
    Cost: max 20 reads (ORDER_BY timestamp DESC LIMIT 20) instead of full scan.
    Previously scanned ALL 21,585 video_stats docs spread across 3,057 executions.
    """
    docs = (
        db.collection('video_stats')
        .where('video_id', '==', video_id)
        .order_by('timestamp', direction='DESCENDING')
        .limit(20)
        .stream()
    )
    stats = []
    for doc in docs:
        d = doc.to_dict()
        stats.append({
            'timestamp': d.get('timestamp'),
            'view_count': d.get('view_count'),
            'like_count': d.get('like_count'),
            'comment_count': d.get('comment_count'),
            'delta_views': d.get('delta_views'),
            'velocity': d.get('velocity'),
            'quality_score': d.get('quality_score_at_time', 0)
        })
    stats.sort(key=lambda x: x.get('timestamp', ''))
    return stats

@app.post("/api/topics/correlations/rebuild")
def rebuild_topic_correlations(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Forces an immediate rebuild of the AI correlations cache doc in Firestore."""
    from scheduler_cache import build_correlations_cache
    build_correlations_cache(db)
    snap = db.collection('cache').document('correlations_summary').get()
    if snap.exists:
        return snap.to_dict().get('correlations', [])
    return []

@app.get("/api/topics/correlations")
def get_topic_correlations(user: dict = Depends(verify_user), db: Any = Depends(get_firestore_db)):
    """Retrieves AI topic correlations from cache/correlations_summary."""
    try:
        snap = db.collection('cache').document('correlations_summary').get()
        if snap.exists:
            return snap.to_dict().get('correlations', [])
    except Exception as e:
        logger.warning(f"Correlations cache read failed: {e}")
        
    from scheduler_cache import build_correlations_cache
    build_correlations_cache(db)
    snap = db.collection('cache').document('correlations_summary').get()
    if snap.exists:
        return snap.to_dict().get('correlations', [])
    return []
    import re
    import math

    videos = []
    try:
        cache_doc = db.collection('cache').document('dashboard_summary').get()
        if cache_doc.exists:
            raw_videos = cache_doc.to_dict().get('videos', [])
            for v in raw_videos:
                pub_str = v.get('published_at') or v.get('created_at')
                if pub_str:
                    try:
                        pub_dt = datetime.datetime.fromisoformat(pub_str)
                        if pub_dt.tzinfo is None:
                            pub_dt = pub_dt.replace(tzinfo=datetime.timezone.utc)
                        v_copy = dict(v)
                        v_copy['_pub_dt'] = pub_dt
                        videos.append(v_copy)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"Correlations cache read failed: {e}. Falling back to Firestore query.")

    if not videos:
        cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)).isoformat()
        docs = db.collection('videos').where('published_at', '>=', cutoff).stream()
        for doc in docs:
            v = doc.to_dict()
            v['id'] = doc.id
            pub_str = v.get('published_at') or v.get('created_at')
            if pub_str:
                try:
                    pub_dt = datetime.datetime.fromisoformat(pub_str)
                    if pub_dt.tzinfo is None:
                        pub_dt = pub_dt.replace(tzinfo=datetime.timezone.utc)
                    v['_pub_dt'] = pub_dt
                    videos.append(v)
                except Exception:
                    pass
                
    ngram_map = {}
    
    for v in videos:
        title = v.get('title') or ''
        clean_title = re.sub(r'[^a-zA-Z0-9\s-]', ' ', title.lower())
        words = [w.strip() for w in clean_title.split() if w.strip()]
        
        # Generate Bigrams
        for i in range(len(words) - 1):
            w1, w2 = words[i], words[i+1]
            if w1 not in STOP_WORDS and w2 not in STOP_WORDS and len(w1) > 1 and len(w2) > 1:
                bigram = f"{w1} {w2}"
                if bigram not in ngram_map:
                    ngram_map[bigram] = []
                ngram_map[bigram].append(v)
                
        # Generate Trigrams
        for i in range(len(words) - 2):
            w1, w2, w3 = words[i], words[i+1], words[i+2]
            if (w1 not in STOP_WORDS and w2 not in STOP_WORDS and w3 not in STOP_WORDS and
                len(w1) > 1 and len(w2) > 1 and len(w3) > 1):
                trigram = f"{w1} {w2} {w3}"
                if trigram not in ngram_map:
                    ngram_map[trigram] = []
                ngram_map[trigram].append(v)

    correlations = []
    
    for ngram, v_list in ngram_map.items():
        seen_ids = set()
        unique_v_list = []
        for v in v_list:
            if v['id'] not in seen_ids:
                seen_ids.add(v['id'])
                unique_v_list.append(v)
                
        channels_set = {v.get('channel_id') for v in unique_v_list if v.get('channel_id')}
        if len(channels_set) < 2:
            continue
            
        unique_v_list.sort(key=lambda x: x['_pub_dt'])
        
        valid_videos = []
        for i in range(len(unique_v_list)):
            v1 = unique_v_list[i]
            in_window_diff_channel = False
            for j in range(len(unique_v_list)):
                if i == j:
                    continue
                v2 = unique_v_list[j]
                if v1.get('channel_id') != v2.get('channel_id'):
                    time_diff = abs((v1['_pub_dt'] - v2['_pub_dt']).total_seconds()) / 3600.0
                    if time_diff <= 48.0:
                        in_window_diff_channel = True
                        break
            if in_window_diff_channel:
                valid_videos.append(v1)
                
        valid_channels = {v.get('channel_id') for v in valid_videos if v.get('channel_id')}
        if len(valid_channels) >= 2:
            total_views = sum(v.get('view_count', 0) for v in valid_videos)
            avg_velocity = sum(v.get('velocity', 0) for v in valid_videos) / len(valid_videos)
            max_quality = max(v.get('quality_score', 0) for v in valid_videos)
            
            views_bonus = math.log10(total_views) * 5 if total_views > 0 else 0
            score = len(valid_channels) * 20 + max_quality * 0.3 + views_bonus + avg_velocity * 0.1
            
            serialized_v = []
            for v in valid_videos:
                serialized_v.append({
                    'id': v['id'],
                    'youtube_id': v.get('youtube_id'),
                    'title': v.get('title'),
                    'url': v.get('url'),
                    'channel_name': v.get('channel_name'),
                    'channel_id': v.get('channel_id'),
                    'thumbnail_url': v.get('thumbnail_url'),
                    'published_at': v.get('published_at'),
                    'view_count': v.get('view_count', 0),
                    'like_count': v.get('like_count', 0),
                    'velocity': v.get('velocity', 0.0),
                    'quality_score': v.get('quality_score', 0),
                    'momentum_label': v.get('momentum_label', '📺 Normal'),
                    'is_short': v.get('is_short', False),
                    'topic_labels': v.get('topic_labels', []),
                    'sub_topic_labels': v.get('sub_topic_labels', [])
                })
                
            correlations.append({
                'topic': ngram.title(),
                'score': round(score, 1),
                'channel_count': len(valid_channels),
                'total_views': total_views,
                'avg_velocity': round(avg_velocity, 1),
                'videos': serialized_v
            })
            
    correlations.sort(key=lambda x: x['score'], reverse=True)
    
    final_correlations = []
    for c in correlations:
        is_dup = False
        for existing in final_correlations:
            c_topic = c['topic'].lower()
            ex_topic = existing['topic'].lower()
            if c_topic in ex_topic or ex_topic in c_topic:
                c_vids = {v['id'] for v in c['videos']}
                ex_vids = {v['id'] for v in existing['videos']}
                intersection = c_vids.intersection(ex_vids)
                if len(intersection) >= min(len(c_vids), len(ex_vids)) * 0.7:
                    if existing['score'] >= c['score']:
                        is_dup = True
                        break
        if not is_dup:
            final_correlations.append(c)
            
    return final_correlations[:30]


@app.post("/api/transcribe")
def transcribe_video_endpoint(payload: dict):
    youtube_id = payload.get("youtube_id")
    if not youtube_id:
        raise HTTPException(status_code=400, detail="youtube_id is required")
    model_size = payload.get("model_size", "base")
    language = payload.get("language")
    from local_audio_transcriber import transcribe_youtube_video_locally
    result = transcribe_youtube_video_locally(youtube_id, model_size=model_size, language=language)
    return result

# ─── Static frontend ──────────────────────────────────────────────────────────
static_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web-ui", "dist")
if os.path.exists(static_path):
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")
else:
    @app.get("/")
    def read_root_fallback():
        return {"message": "Pro-You SaaS API is running. Web UI not built yet."}
