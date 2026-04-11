"""
Search and download audio for Wordplay.

Search: yt-search-python — VideosSearch (no cookies).

Download strategy:
1) Prefer Video + StreamURLFetcher + httpx when innertube returns stream manifests.
2) Fall back to yt-dlp when streamingData is missing/empty (common with YouTube API changes)
   or when signature resolution fails — same stack users expect for reliable production downloads.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yt_dlp
from youtubesearchpython import StreamURLFetcher, Video, VideosSearch

logger = logging.getLogger(__name__)


def _resolve_music_dir() -> Path:
    """
    Writable directory for downloaded audio.

    Vercel serverless (and similar) only allow writes under /tmp; the deploy
    tree at /var/task is read-only, so a sibling ``music_cache/`` would fail at import.
    """
    override = os.environ.get("MUSIC_CACHE_DIR", "").strip()
    if override:
        return Path(override)
    if os.environ.get("VERCEL") == "1":
        return Path(os.environ.get("TMPDIR", "/tmp")) / "wordplay_music_cache"
    return Path(__file__).resolve().parent / "music_cache"


MUSIC_DIR = _resolve_music_dir()
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._\- ()\[\]]+")

_stream_fetcher: StreamURLFetcher | None = None


def _get_stream_fetcher() -> StreamURLFetcher:
    global _stream_fetcher
    if _stream_fetcher is None:
        _stream_fetcher = StreamURLFetcher()
    return _stream_fetcher


def _ffmpeg_bin_dir() -> str | None:
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


def _suffix_for_mime(mime: str) -> str:
    base = (mime or "").lower().split(";")[0].strip()
    if base == "audio/mp4":
        return ".m4a"
    if base == "audio/webm":
        return ".webm"
    if base == "audio/opus" or "opus" in mime.lower():
        return ".opus"
    if base in ("video/mp4", "video/webm"):
        return ".mp4" if "mp4" in base else ".webm"
    return ".bin"


def _format_bitrate(f: dict) -> float:
    for key in ("bitrate", "averageBitrate"):
        v = f.get(key)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return 0.0


def _audio_format_candidates(video: dict) -> list[tuple[int, str, float]]:
    """
    (itag, mimeType, bitrate) sorted by preference: pure audio first, then muxed, by bitrate.
    Includes adaptive audio-only streams and progressive (muxed) streams that contain audio.
    """
    sd = video.get("streamingData") if isinstance(video.get("streamingData"), dict) else None
    if not sd:
        return []

    adaptive = sd.get("adaptiveFormats") or []
    progressive = sd.get("formats") or []

    out: list[tuple[int, str, float, int]] = []  # itag, mime, br, tier (0=audio-only, 1=muxed)

    for f in adaptive:
        mime = f.get("mimeType") or ""
        if "audio" not in mime.lower():
            continue
        itag = f.get("itag")
        if itag is None:
            continue
        out.append((int(itag), mime, _format_bitrate(f), 0))

    for f in progressive:
        mime = (f.get("mimeType") or "").lower()
        itag = f.get("itag")
        if itag is None:
            continue
        # Muxed video+audio (e.g. video/mp4 with mp4a codec)
        if "video" in mime and any(x in mime for x in ("mp4a", "opus", "aac", "vorbis")):
            out.append((int(itag), f.get("mimeType") or mime, _format_bitrate(f), 1))
        elif "audio" in mime:
            out.append((int(itag), f.get("mimeType") or mime, _format_bitrate(f), 0))

    out.sort(key=lambda x: (x[3], -x[2]))  # audio-only first, then higher bitrate
    return [(a, b, c) for a, b, c, _ in out]


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


def _download_via_ytdlp(url: str) -> tuple[Path, str]:
    """Full file download via yt-dlp when innertube streams are unavailable."""
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
            "noplaylist": True,
        }
        if ffmpeg_dir:
            ydl_opts["ffmpeg_location"] = ffmpeg_dir

        if use_postprocessor:
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        else:
            ydl_opts["format"] = "bestaudio/best"

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise RuntimeError("Download produced no metadata.")
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
            matches = [
                p for p in MUSIC_DIR.glob(f"{token}.*")
                if p.suffix.lower() in (".mp3", ".m4a", ".opus", ".webm", ".ogg", ".aac", ".flac")
            ]
            path = matches[0] if matches else path

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
    raise RuntimeError(f"{msg}\nInstall ffmpeg if transcoding failed.")


def download_youtube_audio(url: str) -> tuple[Path, str]:
    """Download audio: try innertube + StreamURLFetcher first, then yt-dlp."""
    if not _allowed_youtube_url(url):
        raise ValueError("Only http(s) YouTube watch URLs are allowed")

    video = Video.get(url.strip())
    if not video or not isinstance(video, dict):
        logger.info("Video.get returned no data; using yt-dlp for %s", url[:80])
        return _download_via_ytdlp(url)

    title = (video.get("title") or "track").strip() or "track"
    candidates = _audio_format_candidates(video)

    if not candidates:
        logger.info("No innertube audio formats for %s; using yt-dlp", url[:80])
        return _download_via_ytdlp(url)

    fetcher = _get_stream_fetcher()
    stream_url: str | None = None
    mime_used = "audio/m4a"
    for itag, mime, _br in candidates[:16]:
        try:
            stream_url = fetcher.get(video, itag)
        except Exception as e:
            logger.debug("StreamURLFetcher failed for itag %s: %s", itag, e)
            stream_url = None
        if stream_url:
            mime_used = mime
            break

    if not stream_url:
        logger.info("StreamURLFetcher could not resolve URL; using yt-dlp for %s", url[:80])
        return _download_via_ytdlp(url)

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
    except Exception as e:
        logger.warning("httpx stream download failed (%s); falling back to yt-dlp", e)
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        return _download_via_ytdlp(url)

    if not out_path.is_file() or out_path.stat().st_size < 1024:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        return _download_via_ytdlp(url)

    safe = _SAFE_NAME.sub("_", title)[:120].strip("._") or "track"
    if not safe.lower().endswith(out_path.suffix.lower()):
        safe = f"{safe}{out_path.suffix}"
    return out_path, safe
