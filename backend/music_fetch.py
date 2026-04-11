"""
Search and download audio for Wordplay.

Search: youtubesearchpython (yt-search-python) — VideosSearch, no API key.
Download: Video.get + StreamURLFetcher (same library) for direct stream URLs, then httpx.
  StreamURLFetcher uses yt-dlp internally for signature / n-parameter decipher only — we do not
  invoke YoutubeDL for extraction or postprocessing.

Paste-a-URL flows send a normalized watch URL to POST /api/music/download; validation matches
the frontend (http(s) YouTube hosts only).
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
from youtubesearchpython import StreamURLFetcher, Video, VideosSearch

logger = logging.getLogger(__name__)

MUSIC_DIR = Path(__file__).resolve().parent / "music_cache"
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._\- ()\[\]]+")

_stream_fetcher: StreamURLFetcher | None = None


def _get_stream_fetcher() -> StreamURLFetcher:
    """Library recommends a single StreamURLFetcher instance."""
    global _stream_fetcher
    if _stream_fetcher is None:
        _stream_fetcher = StreamURLFetcher()
    return _stream_fetcher


def _suffix_for_mime(mime: str) -> str:
    base = (mime or "").lower().split(";")[0].strip()
    if base == "audio/mp4":
        return ".m4a"
    if base == "audio/webm":
        return ".webm"
    if base == "audio/opus" or "opus" in mime.lower():
        return ".opus"
    return ".bin"


def _audio_format_candidates(video: dict) -> list[tuple[int, str, float]]:
    """(itag, mimeType, bitrate) sorted by bitrate descending."""
    sd = video.get("streamingData") or {}
    adaptive = sd.get("adaptiveFormats") or []
    out: list[tuple[int, str, float]] = []
    for f in adaptive:
        mime = f.get("mimeType") or ""
        if "audio" not in mime.lower():
            continue
        itag = f.get("itag")
        if itag is None:
            continue
        br = float(f.get("bitrate") or 0)
        out.append((int(itag), mime, br))
    out.sort(key=lambda x: -x[2])
    return out


def search_youtube(query: str, limit: int = 8) -> list[dict]:
    """Search YouTube via youtubesearchpython (no API key, no cookies)."""
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


def download_youtube_audio(url: str) -> tuple[Path, str]:
    """Resolve best audio stream via Video + StreamURLFetcher, download with httpx."""
    if not _allowed_youtube_url(url):
        raise ValueError("Only http(s) YouTube watch URLs are allowed")

    video = Video.get(url.strip())
    if not video or not isinstance(video, dict):
        raise ValueError("Video unavailable, private, or invalid URL")

    title = (video.get("title") or "track").strip() or "track"
    candidates = _audio_format_candidates(video)
    if not candidates:
        raise RuntimeError("No audio streams reported for this video.")

    fetcher = _get_stream_fetcher()
    stream_url: str | None = None
    mime_used = "audio/m4a"
    for itag, mime, _br in candidates[:12]:
        try:
            stream_url = fetcher.get(video, itag)
        except Exception as e:
            logger.debug("StreamURLFetcher failed for itag %s: %s", itag, e)
            stream_url = None
        if stream_url:
            mime_used = mime
            break

    if not stream_url:
        raise RuntimeError(
            "Could not resolve a playable audio URL (YouTube may have changed formats; "
            "ensure yt-dlp is installed for signature support)."
        )

    token = uuid.uuid4().hex[:16]
    suffix = _suffix_for_mime(mime_used)
    out_path = MUSIC_DIR / f"{token}{suffix}"

    try:
        with httpx.Client(timeout=httpx.Timeout(600.0), follow_redirects=True) as client:
            with client.stream("GET", stream_url) as resp:
                resp.raise_for_status()
                with open(out_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=256 * 1024):
                        f.write(chunk)
    except Exception:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    if not out_path.is_file() or out_path.stat().st_size < 1024:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise RuntimeError("Download produced an empty or truncated file.")

    safe = _SAFE_NAME.sub("_", title)[:120].strip("._") or "track"
    if not safe.lower().endswith(out_path.suffix.lower()):
        safe = f"{safe}{out_path.suffix}"
    return out_path, safe
