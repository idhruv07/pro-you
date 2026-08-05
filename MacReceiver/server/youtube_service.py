import os
import re
import datetime
import isodate
from typing import Dict, Any, Optional, List
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from dotenv import load_dotenv
import logging

load_dotenv()
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")

logger = logging.getLogger(__name__)

if not YOUTUBE_API_KEY:
    logger.warning("YOUTUBE_API_KEY is not set in .env! YouTube service will fail.")

def get_youtube_client():
    return build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)

def extract_video_id(url: str) -> Optional[str]:
    pattern = r'(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})'
    match = re.search(pattern, url)
    if match:
        return match.group(1)
    return None

def extract_channel_id_or_username(url: str) -> Optional[tuple]:
    """Returns (type, value) where type is 'id' or 'forUsername' or 'custom'"""
    if '/channel/' in url:
        return 'id', url.split('/channel/')[1].split('/')[0].split('?')[0]
    elif '/user/' in url:
        return 'forUsername', url.split('/user/')[1].split('/')[0].split('?')[0]
    elif '/c/' in url:
        return 'custom', url.split('/c/')[1].split('/')[0].split('?')[0]
    elif '/@' in url:
        return 'custom', url.split('/@')[1].split('/')[0].split('?')[0]
    return None, None

def parse_duration_seconds(iso_duration: str) -> int:
    """Convert ISO 8601 duration (PT4M13S) to total seconds."""
    try:
        return int(isodate.parse_duration(iso_duration).total_seconds())
    except Exception:
        return 0

def fetch_video_metadata(url: str) -> Optional[Dict[str, Any]]:
    """Fetches metadata for a single YouTube video (cost: 1 unit)."""
    video_id = extract_video_id(url)
    if not video_id:
        logger.error(f"Could not extract video ID from url: {url}")
        return None

    try:
        youtube = get_youtube_client()
        response = youtube.videos().list(
            part="snippet,statistics,contentDetails",
            id=video_id
        ).execute()

        if not response.get('items'):
            logger.warning(f"No video found for ID: {video_id}")
            return None

        item = response['items'][0]
        snippet = item['snippet']
        stats = item.get('statistics', {})
        content_details = item.get('contentDetails', {})

        published_at_str = snippet.get('publishedAt')
        published_at = None
        if published_at_str:
            try:
                published_at = datetime.datetime.strptime(
                    published_at_str.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z"
                ).replace(tzinfo=None)
            except Exception as e:
                logger.error(f"Error parsing date {published_at_str}: {e}")

        thumbnails = snippet.get('thumbnails', {})
        thumbnail_url = (thumbnails.get('maxres') or thumbnails.get('high') or
                         thumbnails.get('medium') or thumbnails.get('default') or {}).get('url')

        duration_seconds = parse_duration_seconds(content_details.get('duration', 'PT0S'))

        logger.info(f"Successfully fetched metadata for video {video_id}")
        return {
            'youtube_id': video_id,
            'url': f"https://www.youtube.com/watch?v={video_id}",
            'title': snippet.get('title'),
            'description': snippet.get('description', '')[:1000],
            'channel_id': snippet.get('channelId'),
            'channel_name': snippet.get('channelTitle'),
            'thumbnail_url': thumbnail_url,
            'published_at': published_at,
            'view_count': int(stats.get('viewCount', 0)),
            'like_count': int(stats.get('likeCount', 0)),
            'comment_count': int(stats.get('commentCount', 0)),
            'duration_seconds': duration_seconds,
        }

    except HttpError as e:
        logger.error(f"YouTube API HttpError fetching video {video_id}: {e.resp.status} - {e.content}")
        return None
    except Exception as e:
        logger.error(f"Error fetching metadata for {url}: {e}")
        return None


def fetch_videos_batch(video_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Fetches full metadata for up to 50 video IDs in a single API call.
    Cost: 1 unit per call (regardless of number of IDs, up to 50).
    """
    if not video_ids:
        return []

    results = []
    # YouTube API allows max 50 IDs per call
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i+50]
        try:
            youtube = get_youtube_client()
            response = youtube.videos().list(
                part="snippet,statistics,contentDetails",
                id=",".join(batch)
            ).execute()

            for item in response.get('items', []):
                snippet = item['snippet']
                stats = item.get('statistics', {})
                content_details = item.get('contentDetails', {})

                published_at_str = snippet.get('publishedAt')
                published_at = None
                if published_at_str:
                    try:
                        published_at = datetime.datetime.strptime(
                            published_at_str.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z"
                        )
                    except Exception:
                        pass

                thumbnails = snippet.get('thumbnails', {})
                thumbnail_url = (thumbnails.get('maxres') or thumbnails.get('high') or
                                 thumbnails.get('medium') or thumbnails.get('default') or {}).get('url')

                duration_seconds = parse_duration_seconds(content_details.get('duration', 'PT0S'))

                results.append({
                    'youtube_id': item['id'],
                    'url': f"https://www.youtube.com/watch?v={item['id']}",
                    'title': snippet.get('title'),
                    'description': snippet.get('description', '')[:1000],
                    'channel_id': snippet.get('channelId'),
                    'channel_name': snippet.get('channelTitle'),
                    'thumbnail_url': thumbnail_url,
                    'published_at': published_at,
                    'view_count': int(stats.get('viewCount', 0)),
                    'like_count': int(stats.get('likeCount', 0)),
                    'comment_count': int(stats.get('commentCount', 0)),
                    'duration_seconds': duration_seconds,
                })
        except HttpError as e:
            logger.error(f"Batch video fetch error: {e.resp.status} - {e.content}")
        except Exception as e:
            logger.error(f"Batch video fetch error: {e}")

    return results


def fetch_channel_latest_videos(channel_id: str, published_after: Optional[datetime.datetime] = None) -> List[str]:
    """
    Uses YouTube activities API (cost: 1 unit per channel) to find recent video uploads.
    Fetches the latest activities and filters by published_after if provided.
    Cost: 1 unit per call.
    """
    try:
        youtube = get_youtube_client()

        if published_after and published_after.tzinfo is None:
            published_after = published_after.replace(tzinfo=datetime.timezone.utc)

        video_ids = []

        params = {
            "part": "snippet,contentDetails",
            "channelId": channel_id,
            "maxResults": 15,
        }

        response = youtube.activities().list(**params).execute()

        for item in response.get('items', []):
            snippet = item.get('snippet', {})
            content_details = item.get('contentDetails', {})

            if snippet.get('type') == 'upload' and 'upload' in content_details:
                vid_id = content_details['upload'].get('videoId')
                if not vid_id:
                    continue

                # Filter by published_after if requested
                pub_str = snippet.get('publishedAt')
                if published_after and pub_str:
                    try:
                        pub_dt = datetime.datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
                        if pub_dt < published_after:
                            continue
                    except Exception:
                        pass

                video_ids.append(vid_id)

        logger.info(f"Channel {channel_id}: found {len(video_ids)} videos via activities API")
        return video_ids

    except HttpError as e:
        logger.error(f"Activities API error for channel {channel_id}: {e.resp.status} - {e.content}")
        return []
    except Exception as e:
        logger.error(f"Error fetching channel activities for {channel_id}: {e}")
        return []


def fetch_channel_metadata(url: str) -> Optional[Dict[str, Any]]:
    """Fetches basic metadata for a YouTube channel (cost: 1 unit)."""
    ident_type, ident_val = extract_channel_id_or_username(url)
    if not ident_val:
        logger.error(f"Could not extract channel info from url: {url}")
        return None

    try:
        youtube = get_youtube_client()
        request_params = {"part": "snippet,statistics"}

        if ident_type == 'id':
            request_params['id'] = ident_val
        elif ident_type == 'forUsername':
            request_params['forUsername'] = ident_val
        else:
            # Custom URL — resolve via search (100 units, used only once at import time)
            logger.info(f"Searching for custom channel: {ident_val}")
            search_res = youtube.search().list(
                part="snippet", q=ident_val, type="channel", maxResults=1
            ).execute()
            if not search_res.get('items'):
                logger.warning(f"Could not find channel for custom name: {ident_val}")
                return None
            channel_id = search_res['items'][0]['snippet']['channelId']
            request_params['id'] = channel_id

        response = youtube.channels().list(**request_params).execute()

        if not response.get('items'):
            logger.warning(f"No channel found for: {url}")
            return None

        item = response['items'][0]
        snippet = item['snippet']
        thumbnail_url = snippet.get('thumbnails', {}).get('high', {}).get('url')

        logger.info(f"Successfully fetched metadata for channel {item['id']}")
        return {
            'channel_id': item['id'],
            'url': f"https://www.youtube.com/channel/{item['id']}",
            'name': snippet.get('title'),
            'thumbnail_url': thumbnail_url
        }
    except HttpError as e:
        logger.error(f"YouTube API HttpError fetching channel {url}: {e.resp.status} - {e.content}")
        return None
    except Exception as e:
        logger.error(f"Error fetching channel metadata for {url}: {e}")
        return None
