"""
Topic & Category Configuration Module
---------------------------------------
Centralized definition of topic filtering rules, n-gram stop words,
broad generic category exclusions, and test topic constants.
"""

# N-gram stop words for fallback keyword correlation extraction
STOP_WORDS = {
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from", "up",
    "about", "into", "over", "after", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "but", "and", "or", "if", "because", "as",
    "until", "while", "this", "that", "these", "those", "my", "your", "his", "her", "its",
    "our", "their", "what", "which", "who", "whom", "how", "why", "when", "where", "new",
    "video", "full", "today", "latest", "update", "part", "vs", "v/s"
}

# Broad generic category terms excluded from correlation topic headlines
BROAD_CATEGORIES = {
    "news & politics", "ai & tech", "finance", "gaming", "health & fitness",
    "entertainment", "education", "business", "music", "lifestyle", "shorts ⚡", "general",
    "news & updates", "latest updates", "breaking news", "daily news", "today news",
    "today update", "full video", "live stream", "special report", "exclusive video",
    "top news", "big update", "important update", "official update", "big news",
    "news update", "updates", "news", "politics", "video", "trending now", "must watch"
}

# Standardized specific test topic constants for test suite isolation
TEST_TOPICS = {
    "AI_GEN": "Generative AI",
    "QUANTUM": "Quantum Computing",
    "CYBER": "Cybersecurity",
    "BIOTECH": "Biotechnology"
}
