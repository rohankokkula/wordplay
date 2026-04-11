"""
Search and download audio for Wordplay.

Search: yt-search-python — VideosSearch (no cookies).

Download strategy:
1) Prefer Video + StreamURLFetcher + httpx when innertube returns stream manifests.
   Stream downloads use browser-like headers so googlevideo URLs work from datacenter IPs.
2) Fall back to yt-dlp: try **built-in default clients** first (recent yt-dlp prefers
   ``android_sdkless`` / ``tv`` on server IPs), then explicit fallbacks. Optional
   ``YTDLP_COOKIEFILE`` env points at a cookie file on the server (not committed) if YouTube
   still blocks the datacenter IP.
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timezone
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

# googlevideo / YouTube CDN often 403s streams from servers without Referer / UA.
_STREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}

_stream_fetcher: StreamURLFetcher | None = None


def _get_stream_fetcher() -> StreamURLFetcher:
    global _stream_fetcher
    if _stream_fetcher is None:
        _stream_fetcher = StreamURLFetcher()
    return _stream_fetcher


def _is_youtube_bot_challenge(message: str) -> bool:
    m = message.lower()
    return ("sign in" in m and "bot" in m) or "not a bot" in m


def _is_youtube_format_not_available(message: str) -> bool:
    """YouTube often exposes different format lists per player_client — retry other clients."""
    m = message.lower()
    return "requested format is not available" in m or "format is not available" in m


# Audio-only first, then any muxed stream, then worst — `bestaudio/best` alone often errors with
# “Requested format is not available” when that client exposes no separate audio format.
_YTDLP_FORMAT = "bestaudio/best/worst"


def _apply_optional_ytdlp_cookiefile(opts: dict) -> None:
    """Optional: set ``YTDLP_COOKIEFILE=/path/to/cookies.txt`` on the host if bot walls persist."""
    p = os.environ.get("YTDLP_COOKIEFILE", "").strip()
    if p and Path(p).is_file():
        opts["cookiefile"] = p


def _yt_dlp_youtube_extractor_arg_attempts() -> list[dict | None]:
    """
    Each entry is ``extractor_args`` for yt-dlp, or ``None`` = **omit** the key so yt-dlp
    uses its **current built-in default** client order (changes with releases; includes
    ``android_sdkless`` / ``tv`` on recent builds — important for datacenter IPs).

    Then we try explicit clients. See: https://github.com/yt-dlp/yt-dlp/issues/16225
    """
    return [
        None,
        {"youtube": {"player_client": ["android_sdkless"]}},
        {"youtube": {"player_client": ["android_sdkless", "tv"]}},
        {"youtube": {"player_client": ["tv"]}},
        {"youtube": {"player_client": ["web_safari"]}},
        {"youtube": {"player_client": ["android"]}},
        {"youtube": {"player_client": ["ios"]}},
        {"youtube": {"player_client": ["mweb"]}},
        {"youtube": {"player_client": ["tv_embedded"]}},
        {"youtube": {"player_client": ["android", "web"]}},
        {"youtube": {"player_client": ["web"]}},
    ]


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
    last_err: Exception | None = None

    for extractor_args in _yt_dlp_youtube_extractor_arg_attempts():
        title = "track"
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
            if extractor_args is not None:
                ydl_opts["extractor_args"] = extractor_args
            _apply_optional_ytdlp_cookiefile(ydl_opts)
            if ffmpeg_dir:
                ydl_opts["ffmpeg_location"] = ffmpeg_dir

            if use_postprocessor:
                ydl_opts["format"] = _YTDLP_FORMAT
                ydl_opts["postprocessors"] = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }]
            else:
                ydl_opts["format"] = _YTDLP_FORMAT

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
                if _is_youtube_bot_challenge(str(e)):
                    for p in MUSIC_DIR.glob(f"{token}.*"):
                        try:
                            p.unlink()
                        except OSError:
                            pass
                    break
                if _is_youtube_format_not_available(str(e)):
                    for p in MUSIC_DIR.glob(f"{token}.*"):
                        try:
                            p.unlink()
                        except OSError:
                            pass
                    break
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
    if _is_youtube_bot_challenge(msg):
        raise RuntimeError(msg)
    raise RuntimeError(f"{msg}\nInstall ffmpeg if transcoding failed.") from last_err


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
        with httpx.Client(
            timeout=httpx.Timeout(600.0),
            follow_redirects=True,
            headers=_STREAM_HEADERS,
        ) as client:
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


# ── Health probes (used by GET /health) ─────────────────────────────────

_HEALTH_CACHE_MONO: float = 0.0
_HEALTH_CACHE_PAYLOAD: dict | None = None
_HEALTH_TTL_SEC = 90.0
# “Me at the zoo” — used for /health load probe only when the search hit triggers a bot wall.
_HEALTH_CANONICAL_PROBE_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


def _health_storage_writable() -> tuple[bool, str | None]:
    try:
        probe = MUSIC_DIR / ".health_probe_write"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, None
    except OSError as e:
        return False, str(e)


def _health_ytdlp_extract_probe(url: str) -> tuple[bool, str | None]:
    """
    Same extractor rotation as real downloads — a single `android` client often hits
    “Sign in to confirm…” on datacenter IPs while ios/mweb/tv_embedded may succeed.
    """
    u = url.strip()
    last_err: str | None = None
    for extractor_args in _yt_dlp_youtube_extractor_arg_attempts():
        ydl_opts: dict = {
            "quiet": True,
            "no_warnings": True,
            "no_color": True,
            "noplaylist": True,
            "skip_download": True,
            "format": _YTDLP_FORMAT,
        }
        if extractor_args is not None:
            ydl_opts["extractor_args"] = extractor_args
        _apply_optional_ytdlp_cookiefile(ydl_opts)
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(u, download=False)
        except Exception as e:
            last_err = str(e)
            continue

        if not info:
            last_err = "no metadata"
            continue
        if info.get("url"):
            return True, None
        fmts = info.get("formats")
        if isinstance(fmts, list) and fmts:
            return True, None
        last_err = "no playable formats"

    return False, last_err or "yt-dlp extract failed for all player clients"


def health_probe_load(url: str) -> tuple[bool, str | None]:
    """
    Verify the same paths as a real download (formats + decipherable URL, or yt-dlp extract),
    without writing a full media file.
    """
    u = url.strip()
    if not _allowed_youtube_url(u):
        return False, "invalid url"

    try:
        video = Video.get(u)
        if video and isinstance(video, dict):
            cands = _audio_format_candidates(video)
            if cands:
                fetcher = _get_stream_fetcher()
                for itag, _mime, _br in cands[:12]:
                    try:
                        stream_url = fetcher.get(video, itag)
                        if stream_url and stream_url.startswith("http"):
                            return True, None
                    except Exception:
                        continue

        return _health_ytdlp_extract_probe(u)
    except Exception as e:
        return False, str(e)


def health_check_payload(force_refresh: bool = False) -> dict:
    """
    Run storage + YouTube search + load pipeline checks.
    Results are cached for ~90s to avoid hammering YouTube on frequent probes.
    """
    global _HEALTH_CACHE_MONO, _HEALTH_CACHE_PAYLOAD

    now_m = time.monotonic()
    if (
        not force_refresh
        and _HEALTH_CACHE_PAYLOAD is not None
        and (now_m - _HEALTH_CACHE_MONO) < _HEALTH_TTL_SEC
    ):
        out = dict(_HEALTH_CACHE_PAYLOAD)
        out["cached"] = True
        return out

    storage_ok, storage_err = _health_storage_writable()

    search_ok = False
    search_err: str | None = None
    results: list[dict] = []
    try:
        results = search_youtube("music", limit=1)
        if not results:
            search_err = "empty results"
        else:
            search_ok = True
    except Exception as e:
        search_err = str(e)

    probe_url: str | None = None
    load_ok = False
    load_err: str | None = None
    canonical_fallback_used = False
    if search_ok and results:
        first = results[0]
        probe_url = first.get("link") or first.get("url") or (
            f"https://www.youtube.com/watch?v={first.get('id')}" if first.get("id") else None
        )
        if probe_url:
            load_ok, load_err = health_probe_load(probe_url)
            if (
                not load_ok
                and load_err
                and _is_youtube_bot_challenge(load_err)
            ):
                load_ok, load_err = health_probe_load(_HEALTH_CANONICAL_PROBE_URL)
                canonical_fallback_used = bool(load_ok)
        else:
            load_err = "no url in search result"
    else:
        load_err = "skipped (search did not return a video)"

    status = "ok" if storage_ok and search_ok and load_ok else "degraded"
    payload = {
        "status": status,
        "checks": {
            "storage": {"ok": storage_ok, "error": storage_err},
            "search": {"ok": search_ok, "error": search_err},
            "load": {
                "ok": load_ok,
                "error": load_err,
                "probe_url": probe_url,
                "canonical_fallback_used": canonical_fallback_used,
                "canonical_probe_url": _HEALTH_CANONICAL_PROBE_URL if canonical_fallback_used else None,
            },
        },
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "cache_ttl_seconds": int(_HEALTH_TTL_SEC),
        "cached": False,
    }
    _HEALTH_CACHE_MONO = now_m
    _HEALTH_CACHE_PAYLOAD = payload
    return dict(payload)
