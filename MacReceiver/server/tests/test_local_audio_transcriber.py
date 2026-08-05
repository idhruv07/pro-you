import pytest
import os
from local_audio_transcriber import download_youtube_audio, transcribe_youtube_video_locally, validate_transcript_duration_coverage

class TestLocalAudioTranscriber:
    def test_download_audio_invalid_id_returns_none(self):
        result = download_youtube_audio("invalid_id_999999")
        assert result is None or isinstance(result, str)

    def test_transcribe_invalid_id_returns_status_dict(self):
        res = transcribe_youtube_video_locally("invalid_id_999999")
        assert isinstance(res, dict)
        assert "success" in res
        assert "transcript" in res

    def test_26_minute_video_short_transcript_fails_coverage_test(self):
        # 26 minutes = 1560 seconds
        video_duration_seconds = 1560
        short_transcript = "[00:00] John Oliver discusses Trump and crypto."
        
        validation = validate_transcript_duration_coverage(short_transcript, video_duration_seconds)
        assert validation["valid"] is False
        assert validation["coverage_ratio"] < 0.10
        assert "Incomplete transcript" in validation["reason"]

    def test_26_minute_video_full_transcript_passes_coverage_test(self):
        video_duration_seconds = 1560
        full_transcript = "[00:00] Intro...\n[12:30] Midpoint...\n[24:45] Conclusion and wrap up."
        
        validation = validate_transcript_duration_coverage(full_transcript, video_duration_seconds)
        assert validation["valid"] is True
        assert validation["coverage_ratio"] >= 0.75
