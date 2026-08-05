import os
import json
import logging
import datetime
import numpy as np
import requests
import re
try:
    from google import genai
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

def get_youtube_transcript_raw(video_id):
    """Fetches real verbatim YouTube transcript/captions without external libraries."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            return None
        match = re.search(r'ytInitialPlayerResponse\s*=\s*({.+?});', res.text)
        if not match:
            return None
        player_response = json.loads(match.group(1))
        captions = player_response.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
        if not captions:
            return None
            
        track_url = None
        for track in captions:
            if track.get("languageCode") in ["en", "en-US", "en-GB"]:
                track_url = track.get("baseUrl")
                break
        if not track_url:
            track_url = captions[0].get("baseUrl")
            
        if "fmt=" not in track_url:
            track_url += "&fmt=json3"
            
        cap_res = requests.get(track_url, timeout=10)
        if cap_res.status_code != 200:
            return None
            
        data = cap_res.json()
        lines = []
        for ev in data.get("events", []):
            segs = ev.get("segs", [])
            text = "".join([s.get("utf8", "") for s in segs]).strip().replace("\n", " ")
            if text:
                lines.append(text)
        return " ".join(lines)
    except Exception as e:
        logger.warning(f"Failed to fetch transcript for {video_id}: {e}")
        return None

from topic_config import STOP_WORDS, BROAD_CATEGORIES

def build_keyword_fallback_correlations(videos_list):
    """Fallback correlation generator using title bigrams/trigrams & topic labels when AI is unavailable."""
    if not videos_list:
        return []

    ngram_map = {}
    for v in videos_list:
        title = v.get("title") or ""
        clean_title = re.sub(r'[^a-zA-Z0-9\s-]', ' ', title.lower())
        words = [w.strip() for w in clean_title.split() if w.strip()]
        
        # Bigrams
        for i in range(len(words) - 1):
            w1, w2 = words[i], words[i+1]
            if w1 not in STOP_WORDS and w2 not in STOP_WORDS and len(w1) > 2 and len(w2) > 2:
                bg = f"{w1.capitalize()} {w2.capitalize()}"
                if bg.lower() not in BROAD_CATEGORIES and not any(g in bg.lower() for g in ["news", "update", "video"]):
                    ngram_map.setdefault(bg, []).append(v)
                
        # Trigrams
        for i in range(len(words) - 2):
            w1, w2, w3 = words[i], words[i+1], words[i+2]
            if (w1 not in STOP_WORDS and w2 not in STOP_WORDS and w3 not in STOP_WORDS and
                len(w1) > 2 and len(w2) > 2 and len(w3) > 2):
                tg = f"{w1.capitalize()} {w2.capitalize()} {w3.capitalize()}"
                if tg.lower() not in BROAD_CATEGORIES and not any(g in tg.lower() for g in ["news update", "latest news", "breaking news"]):
                    ngram_map.setdefault(tg, []).append(v)
                
        # Explicit subtopic labels (excluding broad categories)
        for label in v.get("topic_labels", []) + v.get("sub_topic_labels", []):
            if label and len(label) > 2 and label.lower().strip() not in BROAD_CATEGORIES:
                ngram_map.setdefault(label.title(), []).append(v)

    results = []
    seen_video_combinations = set()

    for topic_title, v_list in ngram_map.items():
        # Deduplicate videos by ID
        unique_videos = {}
        for v in v_list:
            v_id = v.get("id") or v.get("youtube_id")
            if v_id and v_id not in unique_videos:
                unique_videos[v_id] = v
                
        uv_list = list(unique_videos.values())
        # Always prioritize human-readable channel_name over raw channel_id string
        channel_names = sorted(list({
            (v.get("channel_name") or "").strip() 
            for v in uv_list if v.get("channel_name") and not v.get("channel_name").startswith("UC")
        }))
        if not channel_names:
            channel_names = list({v.get("channel_id") or "Unknown Channel" for v in uv_list})
        
        if len(channel_names) >= 2:
            uv_list.sort(key=lambda x: x.get("quality_score", 0), reverse=True)
            top_videos = uv_list[:10]
            
            combo_key = tuple(sorted([v.get("youtube_id") for v in top_videos]))
            if combo_key in seen_video_combinations:
                continue
            seen_video_combinations.add(combo_key)
            
            total_views = sum(v.get("view_count", 0) for v in top_videos)
            avg_vel = sum(v.get("velocity", 0) for v in top_videos) / max(1, len(top_videos))
            avg_rel_vel = sum(v.get("relative_velocity", v.get("velocity", 0)) for v in top_videos) / max(1, len(top_videos))
            avg_outlier_mult = sum(v.get("outlier_multiplier", 1.0) for v in top_videos) / max(1, len(top_videos))

            # Extract specific talking points from actual video titles in this cluster
            sample_titles = [v.get("title", "") for v in top_videos if v.get("title")][:3]
            specific_angles = []
            for i, t in enumerate(sample_titles):
                specific_angles.append(f"Angle {i+1}: Focus on '{t[:65]}'")
            if not specific_angles:
                specific_angles = [f"Analysis of {topic_title} market impact"]

            ch_str = ", ".join(channel_names[:3])
            top_title_raw = top_videos[0].get("title", "")
            hook = f"Why '{top_title_raw[:55]}' Changes Everything..." if top_title_raw else f"The Truth About {topic_title}: What You Need To Know..."

            # Opportunity score derived from subscriber-adjusted velocity & channel baseline outlier multiplier
            opp_score = min(99, int(50 + len(channel_names) * 7 + min(30, avg_outlier_mult * 8) + min(15, avg_rel_vel / 20.0)))
            demand_sig = "High" if len(channel_names) >= 3 or avg_outlier_mult >= 2.0 or avg_rel_vel >= 100 else "Emerging"

            results.append({
                "topic": topic_title,
                "channel_count": len(channel_names),
                "channels": channel_names,
                "video_count": len(top_videos),
                "total_views": total_views,
                "avg_velocity": int(avg_vel),
                "avg_rel_velocity": round(avg_rel_vel, 1),
                "avg_outlier_multiplier": round(avg_outlier_mult, 2),
                "videos": top_videos,
                "ai_summary": f"Cross-channel coverage on '{topic_title}' driven by {ch_str}.",
                "opportunity_score": opp_score,
                "demand_signal": demand_sig,
                "core_driver": f"Concurrently trending story across {len(channel_names)} channels with {avg_outlier_mult:.1f}x baseline momentum (+{int(avg_vel):,} v/hr).",
                "key_angles": specific_angles,
                "recommended_hook": hook,
                "top_quality_score": top_videos[0].get("quality_score", 0)
            })

    # Sort topics by subscriber-adjusted outlier multiplier, channel breadth, and total reach
    results.sort(key=lambda x: (x["avg_outlier_multiplier"], x["channel_count"], x["total_views"]), reverse=True)
    return results[:15]

def build_ai_correlations(videos_list):
    """
    1. Embed recent videos.
    2. Cluster via cosine similarity.
    3. Generate AI insights for top clusters.
    Returns: list of correlation dicts.
    """
    if not videos_list:
        return []

    if not genai:
        logger.warning("google-genai not installed. Using keyword fallback correlations.")
        return build_keyword_fallback_correlations(videos_list)
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not found in environment. Using keyword fallback correlations.")
        return build_keyword_fallback_correlations(videos_list)

    client = genai.Client(api_key=api_key)

    logger.info(f"Building AI Correlations for {len(videos_list)} videos...")
    
    texts = []
    for v in videos_list:
        topics = ", ".join(v.get("topic_labels", []))
        text = f"Title: {v.get('title', '')}. Topics: {topics}"
        texts.append(text)

    # 1. Embeddings
    try:
        embed_response = client.models.embed_content(
            model="text-embedding-004",
            contents=texts
        )
        embeddings = np.array([e.values for e in embed_response.embeddings])
    except Exception as e:
        logger.error(f"Failed to generate embeddings ({e}). Falling back to keyword correlations.")
        return build_keyword_fallback_correlations(videos_list)

    # 2. Cosine Similarity Clustering
    # Normalize vectors
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings_norm = embeddings / norms
    
    sim_matrix = np.dot(embeddings_norm, embeddings_norm.T)
    
    # Simple DBSCAN-like clustering
    clusters = []
    visited = set()
    threshold = 0.85 # High similarity threshold for exact topics
    
    for i in range(len(videos_list)):
        if i in visited:
            continue
        # Find all videos highly similar to video i
        similar_indices = np.where(sim_matrix[i] >= threshold)[0]
        
        cluster_videos = []
        cluster_channels = set()
        
        for idx in similar_indices:
            visited.add(idx)
            v = videos_list[idx]
            cluster_videos.append(v)
            if v.get("channel_id"):
                cluster_channels.add(v["channel_id"])
                
        # Only keep clusters with multiple channels
        if len(cluster_channels) >= 2:
            clusters.append({
                "videos": sorted(cluster_videos, key=lambda x: x.get("quality_score", 0), reverse=True),
                "channels": list(set([v.get("channel_name", "Unknown") for v in cluster_videos])),
                "channel_count": len(cluster_channels),
                "video_count": len(cluster_videos)
            })

    # Sort clusters by size (most channels, then most videos)
    clusters.sort(key=lambda x: (x["channel_count"], x["video_count"]), reverse=True)
    top_clusters = clusters[:15] # Max 15 clusters
    
    results = []
    
    # 3. AI Analysis
    for c in top_clusters:
        top_videos = c["videos"][:5] # Max 5 videos for context limits
        context_parts = []
        for i, v in enumerate(top_videos):
            t = get_youtube_transcript_raw(v.get("youtube_id"))
            if t:
                # Limit transcript length to ~1000 words per video to save tokens
                t = " ".join(t.split()[:1000])
            else:
                t = v.get("description", "No description available.")
                t = " ".join(t.split()[:500])
            
            # Format rich metadata context for this video
            context_parts.append(
                f"--- Video {i+1} ---\n"
                f"Title: {v.get('title')}\n"
                f"Channel: {v.get('channel_name')}\n"
                f"Views: {v.get('view_count', 0):,}\n"
                f"Velocity: +{int(v.get('velocity', 0))}/hr\n"
                f"Published: {v.get('published_at')}\n"
                f"Transcript/Content:\n{t}\n"
            )
            
        full_context = "\n".join(context_parts)
        
        prompt = (
            "You are a Bloomberg-level media trend intelligence analyst for YouTube. I will provide details and transcripts/descriptions "
            "from multiple videos across different channels that recently covered the same topic.\n\n"
            f"{full_context}\n\n"
            "Analyze these videos and return a JSON object containing:\n"
            "1. 'topic': A clean, concise, 2-4 word overarching topic title (e.g. 'Trump Crypto Venture' or 'Wix AI Collapse'). Do NOT just repeat a single video title.\n"
            "2. 'opportunity_score': Integer from 0 to 100 representing topic audience demand and creator production opportunity.\n"
            "3. 'demand_signal': String 'High', 'Emerging', or 'Moderate'.\n"
            "4. 'core_driver': One sentence explaining why this topic is spiking across channels right now.\n"
            "5. 'key_angles': Array of 3 bullet-point strings representing key angles/talking points creators should include.\n"
            "6. 'recommended_hook': A suggested high-CTR video title hook for a creator making a video on this topic.\n"
            "7. 'trend_analysis': A concise 1-2 paragraph cross-channel trend summary explaining the agreements, differing creator angles, and viewpoints.\n\n"
            "Format the output exactly as this JSON object:\n"
            "{\n"
            "  \"topic\": \"Overarching Trend Title\",\n"
            "  \"opportunity_score\": 88,\n"
            "  \"demand_signal\": \"High\",\n"
            "  \"core_driver\": \"Spike driven by recent breaking news...\",\n"
            "  \"key_angles\": [\"Point 1\", \"Point 2\", \"Point 3\"],\n"
            "  \"recommended_hook\": \"Why X Changes Everything...\",\n"
            "  \"trend_analysis\": \"Analysis text...\"\n"
            "}"
        )
        
        topic_title = None
        ai_summary = None
        opportunity_score = 75
        demand_signal = "High"
        core_driver = ""
        key_angles = []
        recommended_hook = ""
        
        try:
            from google.genai import types
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            raw_text = response.text.strip()
            parsed = json.loads(raw_text)
            topic_title = parsed.get("topic")
            ai_summary = parsed.get("trend_analysis")
            opportunity_score = int(parsed.get("opportunity_score", 75))
            demand_signal = parsed.get("demand_signal", "High")
            core_driver = parsed.get("core_driver", "")
            key_angles = parsed.get("key_angles", [])
            recommended_hook = parsed.get("recommended_hook", "")
        except Exception as e:
            logger.error(f"Gemini generation or parse failed: {e}")
            
        if not topic_title:
            # Fallback to top video's topic label or title
            topic_title = top_videos[0].get("topic_labels", [top_videos[0].get("title")])[0]
        if not ai_summary:
            ai_summary = "AI Trend Summary unavailable due to generation error."
            
        total_views = sum(v.get("view_count", 0) for v in c["videos"])
        # Approximate velocity (views per hour based on 48h window)
        avg_vel = 0
        for v in c["videos"]:
            v_views = v.get("view_count", 0)
            if v_views and v.get("published_at"):
                try:
                    pub_dt = datetime.datetime.fromisoformat(v["published_at"].replace("Z", "+00:00"))
                    now_dt = datetime.datetime.now(datetime.timezone.utc)
                    hrs = max(1, (now_dt - pub_dt).total_seconds() / 3600)
                    avg_vel += (v_views / hrs)
                except Exception:
                    pass
            
        results.append({
            "topic": topic_title,
            "channel_count": c["channel_count"],
            "channels": c["channels"],
            "video_count": c["video_count"],
            "total_views": total_views,
            "avg_velocity": int(avg_vel),
            "videos": top_videos,
            "ai_summary": ai_summary,
            "opportunity_score": opportunity_score,
            "demand_signal": demand_signal,
            "core_driver": core_driver,
            "key_angles": key_angles,
            "recommended_hook": recommended_hook,
            "top_quality_score": top_videos[0].get("quality_score", 0)
        })
        
    return results
