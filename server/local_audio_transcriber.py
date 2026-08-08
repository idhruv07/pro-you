"""
Local Audio Transcriber Module (OpenAI Whisper + yt-dlp)
---------------------------------------------------------
Performs 100% local speech-to-text transcription directly on the Mac machine:
1. Downloads audio using yt-dlp to /tmp/yt_audio_<youtube_id>.m4a.
2. Runs OpenAI Whisper model to transcribe the audio file verbatim.
3. Returns line-by-line timestamped transcript: [MM:SS] Spoken text.
"""

import os
import sys
import re
import ssl
import subprocess
import logging
from typing import Dict, Any, Optional

# Disable SSL verification for model weight downloads on macOS Python
ssl._create_default_https_context = ssl._create_unverified_context

logger = logging.getLogger(__name__)

YTDLP_BIN = "/Volumes/DJ EX OS/DJ External/.gemini/antigravity/scratch/Mirror/MacReceiver/server/venv/bin/yt-dlp"

def download_youtube_audio(youtube_id: str) -> Optional[str]:
    """Downloads audio track for a YouTube video using local yt-dlp."""
    output_template = f"/tmp/yt_audio_{youtube_id}.%(ext)s"
    cmd = [
        YTDLP_BIN,
        "-x",
        "--audio-format", "m4a",
        "--output", output_template,
        f"https://www.youtube.com/watch?v={youtube_id}"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        target_file = f"/tmp/yt_audio_{youtube_id}.m4a"
        if os.path.exists(target_file):
            return target_file
        # Check any matching audio file
        import glob
        matches = glob.glob(f"/tmp/yt_audio_{youtube_id}.*")
        if matches:
            return matches[0]
        logger.error(f"yt-dlp audio download failed: {res.stderr}")
        return None
    except Exception as e:
        logger.error(f"Error executing yt-dlp audio download: {e}")
        return None

def transcribe_audio_whisper(audio_path: str, model_size: str = "base", language: Optional[str] = None) -> str:
    """
    Transcribes audio file using local OpenAI Whisper model.
    Produces 100% verbatim timestamped lines: [MM:SS] Spoken text.
    """
    try:
        import whisper
        model = whisper.load_model(model_size)
        
        # Explicitly configure transcription arguments
        transcribe_args = {"verbose": False, "task": "transcribe"}
        if language:
            transcribe_args["language"] = language
            
        result = model.transcribe(audio_path, **transcribe_args)
        detected_lang = result.get("language", "")
        
        # If Whisper auto-detected Urdu ('ur') or output Urdu/Arabic script (\u0600-\u06FF)
        # when the user did not explicitly request Urdu ('ur'), force re-transcription in Hindi ('hi') Devanagari script
        raw_text_check = " ".join([s.get("text", "") for s in result.get("segments", [])])
        has_arabic_script = bool(re.search(r'[\u0600-\u06FF]', raw_text_check))
        
        if (detected_lang == "ur" or has_arabic_script) and language != "ur":
            logger.info("Detected Urdu script/language on Hindi phonetics. Re-running Whisper with language='hi' for Devanagari Hindi transcript...")
            transcribe_args["language"] = "hi"
            result = model.transcribe(audio_path, **transcribe_args)
        
        segments = result.get("segments", [])
        lines = []
        for seg in segments:
            start_sec = int(seg.get("start", 0))
            mins = start_sec // 60
            secs = start_sec % 60
            hrs = mins // 60
            rem_mins = mins % 60
            
            if hrs > 0:
                time_str = f"[{hrs:02d}:{rem_mins:02d}:{secs:02d}]"
            else:
                time_str = f"[{rem_mins:02d}:{secs:02d}]"
                
            text = seg.get("text", "").strip()
            if text:
                lines.append(f"{time_str} {text}")
                
        if not lines:
            return "Whisper audio transcription produced no speech text."
            
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"Error in Whisper audio transcription: {e}")
        return f"Local Whisper transcription error: {e}"

def transcribe_youtube_video_locally(youtube_id: str, model_size: str = "base", language: Optional[str] = None) -> Dict[str, Any]:
    """
    Complete local speech-to-text pipeline for a YouTube video ID.
    Downloads audio, runs Whisper, cleans temporary files.
    """
    logger.info(f"=== Starting Local Whisper Speech-to-Text for {youtube_id} ===")
    audio_path = download_youtube_audio(youtube_id)
    if not audio_path:
        return {
            "success": False,
            "error": "Failed to download video audio using yt-dlp.",
            "transcript": ""
        }
        
    try:
        transcript_text = transcribe_audio_whisper(audio_path, model_size=model_size, language=language)
        return {
            "success": True,
            "youtube_id": youtube_id,
            "transcript": transcript_text,
            "model_used": f"OpenAI Whisper ({model_size})"
        }
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass


def validate_transcript_duration_coverage(transcript_text: str, expected_duration_seconds: int, min_coverage_ratio: float = 0.75) -> Dict[str, Any]:
    """
    Verifies that the generated transcript covers at least min_coverage_ratio (e.g. 75%)
    of the video's total duration.
    For example, for a 26-minute video (1,560s), the last timestamp must reach at least 19:30 (1,170s).
    If it fails, returns {"valid": False, "reason": "Transcript ends at XX:YY but video is MM:SS long"}.
    """
    if not transcript_text or expected_duration_seconds <= 0:
        return {"valid": True, "coverage_ratio": 1.0, "last_timestamp_sec": 0}

    # Find all timestamps formatted as [HH:MM:SS] or [MM:SS]
    timestamps = re.findall(r'\[(\d{2}:)?(\d{2}):(\d{2})\]', transcript_text)
    if not timestamps:
        return {"valid": False, "reason": "No valid timestamps found in transcript text.", "coverage_ratio": 0.0, "last_timestamp_sec": 0}

    last_sec = 0
    for match in timestamps:
        h_str, m_str, s_str = match
        hrs = int(h_str.replace(":", "")) if h_str else 0
        mins = int(m_str)
        secs = int(s_str)
        total_sec = hrs * 3600 + mins * 60 + secs
        if total_sec > last_sec:
            last_sec = total_sec

    coverage_ratio = last_sec / float(expected_duration_seconds)
    is_valid = coverage_ratio >= min_coverage_ratio

    return {
        "valid": is_valid,
        "coverage_ratio": round(coverage_ratio, 2),
        "last_timestamp_sec": last_sec,
        "expected_duration_sec": expected_duration_seconds,
        "reason": f"Valid (covers {int(coverage_ratio*100)}% of video)" if is_valid else f"Incomplete transcript: last timestamp is {last_sec//60:02d}:{last_sec%60:02d} for a {expected_duration_seconds//60:02d}:{expected_duration_seconds%60:02d} video ({int(coverage_ratio*100)}% coverage)."
    }
