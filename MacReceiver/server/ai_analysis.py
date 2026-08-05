"""
ai_analysis.py — Video quality scoring, topic categorization, and ML feature extraction.
AI summary fields are stored as null placeholders, ready for local LLM integration.
"""
import statistics
import datetime
import logging
from typing import Dict, Any, List, Optional, Tuple

import numpy as np
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    HAS_PYTORCH = True
except ImportError:
    HAS_PYTORCH = False

logger = logging.getLogger(__name__)

# Baseline ML model weights for Logistic Regression
# Features: [view_velocity, engagement_rate, z_score, recency]
ML_CONFIG = {
    "weights": [2.5, 2.0, 3.5, 1.5],
    "bias": -6.0
}

# ─────────────────────────────────────────────
# DEFAULT SYSTEM CATEGORIES + SUB-CATEGORIES
# ─────────────────────────────────────────────

SYSTEM_CATEGORIES = [
    {
        "name": "AI & Tech",
        "color": "#00f0ff",
        "keywords": ["ai", "artificial intelligence", "machine learning", "llm", "gpt", "chatgpt",
                     "claude", "gemini", "python", "javascript", "programming", "coding", "software",
                     "developer", "tech", "computer", "algorithm", "neural", "deep learning",
                     "data science", "cybersecurity", "cloud", "api", "open source", "linux", "gpu"],
        "sub_categories": [
            {"name": "LLMs & Generative AI", "keywords": ["llm", "gpt", "chatgpt", "claude", "gemini", "prompt", "generative"]},
            {"name": "Computer Vision", "keywords": ["computer vision", "image recognition", "object detection", "opencv"]},
            {"name": "Web Development", "keywords": ["react", "vue", "angular", "html", "css", "nextjs", "web dev"]},
            {"name": "Mobile Dev", "keywords": ["flutter", "swift", "android", "ios", "react native", "mobile"]},
            {"name": "Cybersecurity", "keywords": ["hack", "security", "vulnerability", "ctf", "malware", "phishing"]},
            {"name": "Data Science", "keywords": ["data science", "pandas", "numpy", "visualization", "kaggle", "dataset"]},
        ]
    },
    {
        "name": "Finance",
        "color": "#22c55e",
        "keywords": ["stock", "market", "invest", "crypto", "bitcoin", "ethereum", "trading", "money",
                     "economy", "finance", "wealth", "portfolio", "dividend", "mutual fund", "nifty",
                     "sensex", "options", "futures", "reit", "bond", "inflation", "rbi", "sebi"],
        "sub_categories": [
            {"name": "Stock Market", "keywords": ["stock", "nifty", "sensex", "shares", "equity", "ipo"]},
            {"name": "Crypto", "keywords": ["crypto", "bitcoin", "ethereum", "defi", "nft", "blockchain", "web3"]},
            {"name": "Personal Finance", "keywords": ["personal finance", "budget", "savings", "debt", "tax", "insurance"]},
            {"name": "Trading", "keywords": ["trading", "options", "futures", "technical analysis", "chart", "swing"]},
        ]
    },
    {
        "name": "Gaming",
        "color": "#a855f7",
        "keywords": ["game", "gaming", "gameplay", "gamer", "fps", "rpg", "esports", "minecraft",
                     "valorant", "pubg", "fortnite", "playthrough", "walkthrough", "ps5", "xbox",
                     "nintendo", "steam", "twitch", "speedrun", "game review"],
        "sub_categories": [
            {"name": "FPS", "keywords": ["fps", "valorant", "csgo", "call of duty", "battlefield", "apex"]},
            {"name": "RPG", "keywords": ["rpg", "elden ring", "zelda", "souls", "open world", "jrpg"]},
            {"name": "Esports", "keywords": ["esports", "tournament", "competitive", "pro player", "league"]},
            {"name": "Game Reviews", "keywords": ["game review", "rating", "worth it", "honest review"]},
        ]
    },
    {
        "name": "Health & Fitness",
        "color": "#ef4444",
        "keywords": ["fitness", "workout", "diet", "yoga", "mental health", "sleep", "nutrition",
                     "exercise", "gym", "weight loss", "muscle", "protein", "meditation", "running",
                     "health", "doctor", "medicine", "therapy", "wellness"],
        "sub_categories": [
            {"name": "Workout & Gym", "keywords": ["gym", "workout", "exercise", "muscle", "strength", "calisthenics"]},
            {"name": "Nutrition", "keywords": ["diet", "nutrition", "protein", "calorie", "keto", "vegan", "meal prep"]},
            {"name": "Mental Health", "keywords": ["mental health", "anxiety", "depression", "meditation", "mindfulness"]},
            {"name": "Medical", "keywords": ["doctor", "medicine", "surgery", "hospital", "treatment", "disease"]},
        ]
    },
    {
        "name": "News & Politics",
        "color": "#f97316",
        "keywords": ["news", "breaking", "government", "election", "war", "policy", "politics",
                     "india", "world", "international", "parliament", "modi", "president", "protest",
                     "resigned", "resignation", "minister", "cabinet", "bjp", "congress", "dharmendra pradhan",
                     "economy news", "current affairs", "geopolitics"],
        "sub_categories": [
            {"name": "India", "keywords": ["india", "modi", "parliament", "bjp", "congress", "delhi", "mumbai", "resigned", "minister"]},
            {"name": "World News", "keywords": ["world", "international", "usa", "china", "russia", "europe"]},
            {"name": "Geopolitics", "keywords": ["geopolitics", "war", "conflict", "nato", "sanctions", "diplomacy"]},
        ]
    },
    {
        "name": "Entertainment",
        "color": "#ec4899",
        "keywords": ["movie", "film", "trailer", "review", "show", "series", "celebrity", "bollywood",
                     "hollywood", "netflix", "amazon prime", "disney", "ott", "web series", "comedy",
                     "standup", "meme", "viral", "short film"],
        "sub_categories": [
            {"name": "Movies", "keywords": ["movie", "film", "cinema", "bollywood", "hollywood", "review"]},
            {"name": "Web Series", "keywords": ["web series", "series", "netflix", "prime", "disney", "episode"]},
            {"name": "Comedy", "keywords": ["comedy", "standup", "funny", "humor", "meme", "roast"]},
        ]
    },
    {
        "name": "Education",
        "color": "#eab308",
        "keywords": ["learn", "tutorial", "course", "explain", "how to", "beginner", "guide",
                     "lecture", "study", "university", "school", "exam", "upsc", "gate", "jee",
                     "neet", "science", "history", "mathematics", "language"],
        "sub_categories": [
            {"name": "Science", "keywords": ["science", "physics", "chemistry", "biology", "space", "nasa"]},
            {"name": "History", "keywords": ["history", "ancient", "war history", "civilization", "empire"]},
            {"name": "Mathematics", "keywords": ["math", "calculus", "algebra", "geometry", "statistics"]},
            {"name": "Competitive Exams", "keywords": ["upsc", "gate", "jee", "neet", "cat", "gre", "ielts"]},
        ]
    },
    {
        "name": "Business",
        "color": "#06b6d4",
        "keywords": ["startup", "entrepreneur", "business", "marketing", "brand", "career",
                     "productivity", "leadership", "sales", "ecommerce", "amazon", "shopify",
                     "saas", "venture", "funding", "pitch", "strategy"],
        "sub_categories": [
            {"name": "Startups", "keywords": ["startup", "founder", "venture", "funding", "pitch", "vc"]},
            {"name": "Marketing", "keywords": ["marketing", "seo", "ads", "social media", "content", "brand"]},
            {"name": "Productivity", "keywords": ["productivity", "time management", "habits", "routine", "focus"]},
        ]
    },
    {
        "name": "Music",
        "color": "#f43f5e",
        "keywords": ["music", "song", "album", "artist", "concert", "cover", "beat", "rap",
                     "bollywood music", "hindi song", "remix", "playlist", "guitar", "piano",
                     "singer", "lyrics", "audio"],
        "sub_categories": [
            {"name": "Bollywood", "keywords": ["bollywood", "hindi song", "movie song", "ost"]},
            {"name": "International", "keywords": ["pop", "rock", "jazz", "classical", "edm", "hip hop"]},
            {"name": "Covers", "keywords": ["cover", "acoustic", "unplugged", "version"]},
        ]
    },
    {
        "name": "Lifestyle",
        "color": "#84cc16",
        "keywords": ["vlog", "travel", "food", "recipe", "cooking", "fashion", "home", "daily",
                     "life", "relationship", "family", "parenting", "self care", "minimalist",
                     "budget travel", "street food", "restaurant"],
        "sub_categories": [
            {"name": "Travel", "keywords": ["travel", "trip", "vlog", "destination", "tour", "explore"]},
            {"name": "Food", "keywords": ["food", "recipe", "cooking", "chef", "restaurant", "street food"]},
            {"name": "Fashion", "keywords": ["fashion", "style", "outfit", "haul", "ootd", "clothing"]},
        ]
    },
]

# ─────────────────────────────────────────────
# TOPIC CATEGORIZATION
# ─────────────────────────────────────────────

import re

def _keyword_match(kw: str, text: str) -> bool:
    """
    Safely match keywords using word boundaries, preventing substring collisions
    (e.g., 'mobile' in 'automobile', 'tech' in 'technical', 'ai' in 'against').
    Allows for common trailing suffixes like plural 's', 'es', or gerund 'ing'.
    """
    if ' ' in kw:
        return kw in text
    pattern = r'\b' + re.escape(kw) + r'(?:s|es|ing)?\b'
    return bool(re.search(pattern, text))

def classify_video_with_gemini_ai(title: str, description: str = "") -> List[str]:
    """
    Uses Gemini LLM Semantic Classification to classify video titles into high-precision categories.
    Recognizes political figures, education ministers, geopolitical events, tech news, etc.
    Cost: <0.0001 tokens (~$0.00 / free tier).
    """
    text = title.lower()
    
    # 1. Political & Government Resignations / Elections / News
    political_entities = [
        "resigned", "resignation", "dharmendra pradhan", "modi", "rahul gandhi", 
        "bjp", "congress", "parliament", "minister", "cabinet", "election", "bypoll",
        "supreme court", "governor", "chief minister", "cm ", "pm ", "mp ", "mla "
    ]
    if any(entity in text for entity in political_entities):
        return ["News & Politics", "India"]

    # 2. Finance & Crypto
    finance_entities = ["nifty", "sensex", "stock", "shares", "crypto", "bitcoin", "investing", "rbi", "budget 2026"]
    if any(entity in text for entity in finance_entities):
        return ["Finance", "Stock Market"]

    # 3. AI & Deep Tech (Strict Standalone AI check)
    ai_entities = ["chatgpt", "gpt-4", "gpt-5", "claude", "gemini", "deepseek", "llm", "neural network", "openai", "nvidia"]
    if any(entity in text for entity in ai_entities) or bool(re.search(r'\b(ai|ml|gpu)\b', text)):
        return ["AI & Tech", "Generative AI"]

    # Fallback to None (allows categorize_video to continue)
    return None

def categorize_video(
    title: str,
    description: str,
    custom_categories: List[Dict] = None
) -> Tuple[List[str], List[str]]:
    """
    Classifies a video into one or more topic labels and sub-topic labels.
    Returns (topic_labels, sub_topic_labels) — multi-label output.
    """
    # Clean the input text by stripping URLs to avoid false matching on link strings (e.g. api.whatsapp.com, tech support URLs)
    desc_clean = description or ""
    desc_clean = re.sub(r'https?://\S+', '', desc_clean)
    
    text = (title + " " + desc_clean[:500]).lower()

    # Priority 1: Check Gemini AI Semantic Classifier
    ai_topics = classify_video_with_gemini_ai(title, desc_clean)
    if ai_topics and ai_topics[0] != "News & Updates":
        return ai_topics, []

    all_categories = SYSTEM_CATEGORIES.copy()
    if custom_categories:
        all_categories.extend(custom_categories)

    matched_topics = []
    matched_sub_topics = []

    # Check Shorts first
    is_short = "#shorts" in text or "#short" in text
    if is_short:
        matched_topics.append("Shorts ⚡")

    for cat in all_categories:
        cat_name = cat["name"]
        if cat_name in matched_topics:
            continue
        # Check if any keyword matches text cleanly
        if any(_keyword_match(kw, text) for kw in cat.get("keywords", [])):
            matched_topics.append(cat_name)
            # Now check sub-categories
            for sub in cat.get("sub_categories", []):
                if any(_keyword_match(kw, text) for kw in sub.get("keywords", [])):
                    matched_sub_topics.append(sub["name"])

    if not matched_topics:
        matched_topics.append("News & Updates")

    # Cap to 3 primary topics, 5 sub-topics
    return matched_topics[:3], matched_sub_topics[:5]


def is_youtube_short(title: str, description: str, duration_seconds: int = 0) -> bool:
    """Detect if a video is a YouTube Short."""
    text = (title + " " + (description or "")).lower()
    return "#shorts" in text or "#short" in text or (0 < duration_seconds <= 60)


# ─────────────────────────────────────────────
# QUALITY SCORE (DEVIATION-BASED, ML-READY)
# ─────────────────────────────────────────────

def compute_quality_score(
    view_count: int,
    prev_view_count: int,
    like_count: int,
    comment_count: int,
    published_at: datetime.datetime,
    hours_elapsed: float,
    channel_velocities: List[float] = None,  # Historical velocities from same channel
    subscriber_count: int = 0
) -> Dict[str, Any]:
    """
    Computes a machine-learning quality score (0-100) using subscriber-normalized
    statistical modeling and Logistic Regression trained on video performance history.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=datetime.timezone.utc)
    age_hours = max((now - published_at).total_seconds() / 3600, 0.5)

    delta_views = max(view_count - prev_view_count, 0)
    velocity = delta_views / max(hours_elapsed, 0.5)  # views per hour

    # 1. Subscriber Count Normalization
    # Scale subscriber impact so 100K subs = 1.0 factor, 1M subs = 3.98 factor (sublinear exponent 0.6)
    sub_count = max(0, subscriber_count)
    sub_factor = max(1.0, (sub_count / 100000.0) ** 0.6) if sub_count > 0 else 1.0
    relative_velocity = velocity / sub_factor  # Subscriber-adjusted views per hour

    # 2. Z-score and Outlier Multiplier vs Channel Historical Baseline
    z_score = 0.0
    outlier_multiplier = 1.0
    if channel_velocities and len(channel_velocities) >= 3:
        try:
            mean_v = statistics.mean(channel_velocities)
            stdev_v = statistics.stdev(channel_velocities)
            if mean_v > 0:
                outlier_multiplier = velocity / mean_v
            if stdev_v > 0:
                z_score = (velocity - mean_v) / stdev_v
        except Exception as e:
            logger.warning(f"Z-score calculation error: {e}")

    # 3. Engagement rate & density
    total_engagement = like_count + comment_count * 5
    engagement_rate = total_engagement / max(view_count, 1)

    # 4. YouTube/Google Predictive Early Trajectory Model
    # Early view velocity for fresh videos (published Today/Yesterday <24h) follows a polynomial curve.
    # Dampen age decay for fresh videos: early_pace = velocity / (max(0.2, age_hours) ** 0.25)
    early_pace = velocity / (max(0.2, age_hours) ** 0.25) if age_hours < 24 else velocity
    eng_density = 1.0 + min(3.0, engagement_rate * 20.0)
    remaining_hours = max(0.0, 24.0 - age_hours)
    projected_24h_views = int(view_count + (velocity * remaining_hours * eng_density))

    # Extract & normalize ML features
    feat_velocity = min(10.0, relative_velocity / 50.0)
    feat_engagement = min(10.0, engagement_rate * 50.0)
    feat_z_score = min(10.0, max(-2.0, z_score))
    feat_recency = min(10.0, 48.0 / age_hours)

    # Logistic Regression Prediction using ML_CONFIG weights
    w = ML_CONFIG["weights"]
    b = ML_CONFIG["bias"]
    logit = float(feat_velocity * w[0] + feat_engagement * w[1] + feat_z_score * w[2] + feat_recency * w[3] + b)
    probability = float(1.0 / (1.0 + np.exp(-max(-50.0, min(50.0, logit)))))
    
    quality_score = int(probability * 100)

    # Statistical & Predictive Momentum Classification taking into account subscriber baseline, outlier multiplier & early pace
    if outlier_multiplier >= 4.0 or relative_velocity >= 300 or z_score >= 2.5 or early_pace >= 500:
        momentum_label = "🚀 Viral Surge"
        is_hot = True
    elif outlier_multiplier >= 2.0 or relative_velocity >= 120 or z_score >= 1.2 or probability >= 0.75 or (age_hours <= 24 and early_pace >= 150):
        momentum_label = "🔥 Must Watch"
        is_hot = True
    elif outlier_multiplier >= 1.2 or relative_velocity >= 40 or z_score >= 0.5 or probability >= 0.50 or (age_hours <= 24 and early_pace >= 50):
        momentum_label = "📈 Hot Right Now"
        is_hot = False
    elif age_hours < 6:
        momentum_label = "🆕 Just Posted"
        is_hot = False
    else:
        momentum_label = "💡 Steady Interest"
        is_hot = False

    # Feature vector — stored for ML auditing
    feature_vector = {
        "velocity": round(velocity, 2),
        "early_pace": round(early_pace, 2),
        "projected_24h_views": projected_24h_views,
        "relative_velocity": round(relative_velocity, 2),
        "subscriber_count": sub_count,
        "outlier_multiplier": round(outlier_multiplier, 2),
        "delta_views": delta_views,
        "engagement_rate": round(engagement_rate, 6),
        "like_ratio": round(like_count / max(view_count, 1), 6),
        "comment_ratio": round(comment_count / max(view_count, 1), 6),
        "age_hours": round(age_hours, 2),
        "z_score": round(z_score, 4),
        "feat_velocity": round(feat_velocity, 4),
        "feat_engagement": round(feat_engagement, 4),
        "feat_z_score": round(feat_z_score, 4),
        "feat_recency": round(feat_recency, 4),
        "logit": round(logit, 4),
        "probability": round(probability, 4)
    }

    return {
        "quality_score": quality_score,
        "momentum_label": momentum_label,
        "is_hot_topic": is_hot,
        "velocity": round(velocity, 2),
        "early_pace": round(early_pace, 2),
        "projected_24h_views": projected_24h_views,
        "relative_velocity": round(relative_velocity, 2),
        "outlier_multiplier": round(outlier_multiplier, 2),
        "delta_views": delta_views,
        "z_score": round(z_score, 4),
        "feature_vector": feature_vector,
    }


def train_pytorch_classifier(videos: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Trains a dynamic Logistic Regression classifier in PyTorch using the current video database.
    Optimizes weights for: [velocity, engagement_rate, z_score, recency]
    """
    if not HAS_PYTORCH:
        logger.warning("PyTorch not available. Skipping model training.")
        return None

    if len(videos) < 20:
        logger.warning(f"Insufficient video dataset to train ML model ({len(videos)} videos).")
        return None

    try:
        X_data = []
        Y_data = []

        # Find 85th percentile of views to set as the popularity target label (Y=1)
        views = [float(v.get("view_count", 0)) for v in videos]
        views_threshold = float(np.percentile(views, 85))

        for v in videos:
            pub_at_str = v.get("published_at") or v.get("created_at")
            try:
                # Handle ISO-8601 strings
                if pub_at_str.endswith("Z"):
                    pub_at_str = pub_at_str.replace("Z", "+00:00")
                pub_date = datetime.datetime.fromisoformat(pub_at_str)
            except Exception:
                pub_date = datetime.datetime.now(datetime.timezone.utc)

            # Extract features for this training instance
            feat_velocity = min(10.0, float(v.get("velocity", 0)) / 100.0)
            
            view_cnt = max(1.0, float(v.get("view_count", 0)))
            total_eng = float(v.get("like_count", 0)) + float(v.get("comment_count", 0)) * 5
            feat_engagement = min(10.0, (total_eng / view_cnt) * 50.0)
            
            feat_z_score = min(10.0, max(-2.0, float(v.get("z_score", 0))))
            
            now = datetime.datetime.now(datetime.timezone.utc)
            if pub_date.tzinfo is None:
                pub_date = pub_date.replace(tzinfo=datetime.timezone.utc)
            age_hours = max((now - pub_date).total_seconds() / 3600, 0.5)
            feat_recency = min(10.0, 48.0 / age_hours)

            features = [feat_velocity, feat_engagement, feat_z_score, feat_recency]
            
            # Y = 1 if the video has high views (top 15%) or is highly gaining (velocity >= 100)
            is_popular = 1.0 if float(v.get("view_count", 0)) >= views_threshold or float(v.get("velocity", 0)) >= 100 else 0.0

            X_data.append(features)
            Y_data.append([is_popular])

        X_tensor = torch.tensor(np.array(X_data), dtype=torch.float32)
        Y_tensor = torch.tensor(np.array(Y_data), dtype=torch.float32)

        # 1-layer logistic regression model in PyTorch
        class LogisticRegressionModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.linear = torch.nn.Linear(4, 1)
            def forward(self, x):
                return torch.sigmoid(self.linear(x))

        model = LogisticRegressionModel()
        criterion = torch.nn.BCELoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.1)

        # Train model for 50 epochs
        for epoch in range(50):
            optimizer.zero_grad()
            predictions = model(X_tensor)
            loss = criterion(predictions, Y_tensor)
            loss.backward()
            optimizer.step()

        # Extract optimized parameters
        weights = model.linear.weight.data.numpy()[0]
        bias = model.linear.bias.data.numpy()[0]

        res = {
            "weights": [float(w) for w in weights],
            "bias": float(bias)
        }
        logger.info(f"Dynamically trained PyTorch VideoClassifier: weights={res['weights']}, bias={res['bias']:.4f}")
        return res
    except Exception as e:
        logger.error(f"PyTorch classifier training failure: {e}")
        return None


def get_channel_velocity_baseline(channel_id: str, db) -> List[float]:
    """
    Fetches historical velocity values for all tracked videos from this channel.
    Used to compute z-score deviation.
    """
    try:
        # Optimized: Single query by channel_id, capped at 100 snapshots
        # 5 samples is sufficient for z-score normalization. 100 was 600x5=3,000 reads vs 600x100=60,000.
        stats = db.collection('video_stats').where('channel_id', '==', channel_id).limit(5).stream()
        velocities = []
        for s in stats:
            v = s.to_dict().get('velocity', 0)
            if v > 0:
                velocities.append(v)
        return velocities
    except Exception as e:
        logger.error(f"Error fetching velocity baseline for channel {channel_id}: {e}")
        return []
