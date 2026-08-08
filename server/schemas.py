from pydantic import BaseModel, HttpUrl
from typing import List, Optional
from datetime import datetime

class CategoryBase(BaseModel):
    name: str

class CategoryCreate(CategoryBase):
    color: Optional[str] = '#888888'
    keywords: Optional[List[str]] = []

class Category(CategoryBase):
    id: str
    created_at: str

    class Config:
        from_attributes = True

class VideoStat(BaseModel):
    id: str
    video_id: str
    view_count: int
    title_at_time: Optional[str] = None
    timestamp: str

    class Config:
        from_attributes = True

class VideoBase(BaseModel):
    url: str

class VideoCreate(VideoBase):
    category_id: Optional[str] = None

class Video(VideoBase):
    id: str
    youtube_id: str
    title: Optional[str] = None
    channel_name: Optional[str] = None
    thumbnail_url: Optional[str] = None
    published_at: Optional[datetime] = None
    category_id: Optional[str] = None
    created_at: str
    stats: List[VideoStat] = []

    class Config:
        from_attributes = True

class ChannelBase(BaseModel):
    url: str

class ChannelCreate(ChannelBase):
    pass

class Channel(ChannelBase):
    id: str
    channel_id: str
    name: Optional[str] = None
    thumbnail_url: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True

class TodoItemCreate(BaseModel):
    video_id: str          # Firestore doc ID of the video
    youtube_id: str
    title: str
    url: str
    channel_name: Optional[str] = None
    thumbnail_url: Optional[str] = None
    topic_labels: Optional[List[str]] = []
    quality_score: Optional[int] = 0
    notes: Optional[str] = ''   # user's angle / content idea notes
    is_short: Optional[bool] = False
    duration_seconds: Optional[int] = None

class TodoItemUpdate(BaseModel):
    status: Optional[str] = None   # 'pending' | 'in_progress' | 'done' | 'skipped'
    notes: Optional[str] = None
