import pytest
from gemini_transcriber import generate_gemini_pro_transcript, get_gemini_api_key

class TestGeminiTranscriber:
    def test_fallback_transcript_has_no_hallucinations(self):
        result = generate_gemini_pro_transcript(
            video_title="Trump & Crypto Analysis",
            channel_name="LastWeekTonight",
            description="John Oliver discusses how the Trump family cryptocurrency ventures have expanded.",
            velocity=2035.0,
            api_key=None
        )
        assert "summary" in result
        assert "transcript" in result
        assert "[00:00]" in result["transcript"]
        assert "GEMINI PRO AI AUDIT" not in result["transcript"]

    def test_get_gemini_api_key_returns_string(self):
        assert isinstance(get_gemini_api_key(), str)
