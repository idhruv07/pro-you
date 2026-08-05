"""
conftest.py
-----------
pytest configuration file — runs before any test module is imported.

Problem: scheduler_channels.py, scheduler_cache.py, and database_status.py
import `database` which imports `firebase_admin`, and `youtube_service` which
imports `googleapiclient.errors`. These packages are only installed on the
cloud runner (GitHub Actions), not necessarily locally.

Solution: Stub out all cloud/external SDK modules at the sys.modules level
BEFORE pytest collects and imports any test module. This means tests
can import the actual scheduler modules without needing Firebase or
Google API client installed.

This is the standard pytest pattern for mocking C-extension / cloud SDKs.
"""

import sys
from unittest.mock import MagicMock


def _make_module_tree(*dotted_names):
    """
    For each 'a.b.c' path, ensure sys.modules has entries for a, a.b, a.b.c
    all as MagicMock instances, with proper parent-child attribute links.
    """
    for name in dotted_names:
        parts = name.split(".")
        for i in range(1, len(parts) + 1):
            key = ".".join(parts[:i])
            if key not in sys.modules:
                mock = MagicMock()
                mock.__name__ = key
                mock.__package__ = ".".join(parts[:i - 1]) if i > 1 else key
                sys.modules[key] = mock
            # Link child as attribute on parent
            if i > 1:
                parent_key = ".".join(parts[:i - 1])
                child_attr = parts[i - 1]
                setattr(sys.modules[parent_key], child_attr, sys.modules[key])


# ── Stub all external cloud/SDK packages ────────────────────────────────────
_make_module_tree(
    "firebase_admin",
    "firebase_admin.credentials",
    "firebase_admin.firestore",
    "google",
    "google.cloud",
    "google.cloud.firestore",
    "google.cloud.firestore_v1",
    "google.api_core",
    "google.api_core.exceptions",
    "google.api_core.gapic_v1",
    "google.auth",
    "google.genai",
    "googleapiclient",
    "googleapiclient.discovery",
    "googleapiclient.errors",
    "grpc",
    "isodate",
)

# ── Configure google.genai Mock Client for AI Embeddings & Summaries ─────────
class MockEmbedding:
    def __init__(self, values):
        self.values = values

class MockEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings

class MockGenerateResponse:
    def __init__(self, text):
        self.text = text

class MockModels:
    def embed_content(self, model, contents, **kwargs):
        # Generate semantic-like vectors for tests
        embeddings_list = []
        for text in contents:
            text_str = str(text)
            # Default vector
            vec = [0.1, 0.1, 0.1]
            if "AI & Tech" in text_str:
                vec = [1.0, 0.0, 0.0]
            elif "Gaming" in text_str:
                vec = [0.0, 1.0, 0.0]
            elif "Finance" in text_str:
                vec = [0.0, 0.0, 1.0]
            elif "News & Politics" in text_str:
                vec = [0.5, 0.5, 0.0]
            embeddings_list.append(MockEmbedding(vec))
        return MockEmbedResponse(embeddings_list)

    def generate_content(self, model, contents, **kwargs):
        # Return mock JSON matching the expectations of gemini_transcriber
        return MockGenerateResponse('{"summary": "• Mock Summary Bullet 1", "transcript": "[00:00] Trump & Crypto Analysis [00:00] Mock verbatim transcription line."}')

class MockGenaiClient:
    def __init__(self, api_key=None, **kwargs):
        self.models = MockModels()

# Set the mocked client on the stubbed module
sys.modules["google.genai"] = sys.modules.get("google.genai", MagicMock())
sys.modules["google.genai"].Client = MockGenaiClient

# ── Stub the database module so get_db() returns None by default ─────────────
# Individual tests that need a specific mock db patch it themselves.
_db_stub = MagicMock()
_db_stub.get_db.return_value = None
sys.modules["database"] = _db_stub
