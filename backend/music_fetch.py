"""
Search and download audio for Wordplay.

Search: youtubesearchpython (no API key, no cookies).
Download: yt-dlp (robust, handles format negotiation + ffmpeg conversion).
Requires ffmpeg for MP3 conversion (brew install ffmpeg).

Only YouTube watch URLs are accepted for download (SSRF-safe).
"""

from __future__ import annotations

import logging
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp

logger = logging.getLogger(__name__)

MUSIC_DIR = Path(__file__).resolve().parent / "music_cache"
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._\- ()\[\]]+")


def _ffmpeg_bin_dir() -> str | None:
    """Find ffmpeg directory for yt-dlp."""
    import os
    env = os.environ.get("FFMPEG_LOCATION", "").strip()
    if env:
        p = Path(env)
        if p.is_file():
            return str(p.parent)
        if p.is_dir() and (p / "ffmpeg").exists():
            return str(p)
    which = shutil.which("ffmpeg")
    if which:
        return str(Path(which).resolve().parent)
    for d in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
        if (Path(d) / "ffmpeg").exists():
            return d
    return None


def search_youtube(query: str, limit: int = 8) -> list[dict]:
    """Search YouTube via youtubesearchpython (no API key, no cookies)."""
    from youtubesearchpython import VideosSearch

    q = query.strip()
    if len(q) < 2:
        return []
    limit = max(1, min(limit, 15))

    search = VideosSearch(q, limit=limit)
    data = search.result()
    entries = data.get("result") or []

    out: list[dict] = []
    for e in entries:
        vid = e.get("id")
        if not vid:
            continue
        title = (e.get("title") or "Unknown").strip() or "Unknown"
        url = e.get("link") or f"https://www.youtube.com/watch?v={vid}"

        dur_str = e.get("duration")
        duration = None
        if dur_str:
            parts = dur_str.split(":")
            try:
                if len(parts) == 2:
                    duration = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    duration = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            except ValueError:
                pass

        thumbnails = e.get("thumbnails") or []
        thumb = thumbnails[0]["url"] if thumbnails else f"https://img.youtube.com/vi/{vid}/mqdefault.jpg"

        out.append({
            "id": vid,
            "title": title,
            "duration": duration,
            "url": url,
            "thumbnail": thumb,
        })
    return out


def _allowed_youtube_url(url: str) -> bool:
    try:
        p = urlparse(url.strip())
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    host = (p.netloc or "").lower()
    if host == "youtu.be":
        return True
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com"):
        return True
    if host.endswith(".youtube.com"):
        return True
    return False


def _pick_audio_file(token: str) -> Path | None:
    matches = list(MUSIC_DIR.glob(f"{token}.*"))
    audio = [
        p for p in matches
        if p.suffix.lower() in (".mp3", ".m4a", ".opus", ".webm", ".ogg", ".aac", ".flac")
    ]
    return audio[0] if audio else None


def download_youtube_audio(url: str) -> tuple[Path, str]:
    """Download audio from YouTube. Returns (file_path, safe_filename)."""
    if not _allowed_youtube_url(url):
        raise ValueError("Only http(s) YouTube watch URLs are allowed")

    ffmpeg_dir = _ffmpeg_bin_dir()
    title = "track"
    last_err: Exception | None = None

    for use_postprocessor in (True, False):
        token = uuid.uuid4().hex[:16]
        out_template = str(MUSIC_DIR / f"{token}.%(ext)s")
        ydl_opts: dict = {
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "no_color": True,
        }
        if ffmpeg_dir:
            ydl_opts["ffmpeg_location"] = ffmpeg_dir

        if use_postprocessor:
            ydl_opts["format"] = "bestaudio*/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        else:
            ydl_opts["format"] = "bestaudio*/best"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise RuntimeError("Download produced no video metadata.")
                title = (info.get("title") or "track").strip() or "track"
        except Exception as e:
            last_err = e
            err_s = str(e).lower()
            if use_postprocessor and ("ffmpeg" in err_s or "ffprobe" in err_s):
                for p in MUSIC_DIR.glob(f"{token}.*"):
                    try:
                        p.unlink()
                    except OSError:
                        pass
                continue
            raise RuntimeError(str(e)) from e

        path = MUSIC_DIR / f"{token}.mp3"
        if not path.is_file():
            path = _pick_audio_file(token) or path
        if not path.is_file():
            if use_postprocessor:
                for p in MUSIC_DIR.glob(f"{token}.*"):
                    try:
                        p.unlink()
                    except OSError:
                        pass
                continue
            raise RuntimeError("Download finished but no audio file was produced.")

        safe = _SAFE_NAME.sub("_", title)[:120].strip("._") or "track"
        if not safe.lower().endswith(path.suffix.lower()):
            safe = f"{safe}{path.suffix}"
        return path, safe

    msg = str(last_err) if last_err else "unknown error"
    raise RuntimeError(f"{msg}\nInstall ffmpeg: brew install ffmpeg")
