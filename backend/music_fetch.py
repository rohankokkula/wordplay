"""
Search and download audio for Wordplay (wordplay-backend).

Requires: yt-dlp; ffmpeg strongly recommended (brew install ffmpeg).
Set FFMPEG_LOCATION to the directory containing ffmpeg/ffprobe if not on PATH.

YouTube "Sign in to confirm you're not a bot" on servers: export Netscape cookies and either set
YT_DLP_COOKIES_FILE to that file's path, or set YT_DLP_COOKIES_B64 to the base64 of the file
(Railway-friendly — avoids shell multiline issues). See yt-dlp wiki: passing cookies.

TLS: If you see SSL: CERTIFICATE_VERIFY_FAILED, point Python at your CA bundle:
  SSL_CERT_FILE=/path/to/bundle.pem
or for dev only: SOBEROHAN_INSECURE_SSL=1 (see ssl_compat.py).

Only YouTube watch URLs are accepted for download (SSRF-safe).

You are responsible for complying with copyright and platform terms when using this.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp

from ssl_compat import yt_dlp_tls_opts

logger = logging.getLogger(__name__)

MUSIC_DIR = Path(__file__).resolve().parent / "music_cache"
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

# Safe filename for Content-Disposition / File() in browser
_SAFE_NAME = re.compile(r"[^a-zA-Z0-9._\- ()\[\]]+")


def _ffmpeg_bin_dir() -> str | None:
    """Directory passed to yt-dlp as ffmpeg_location (must contain ffmpeg + ffprobe)."""
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


# Cached path after materializing YT_DLP_COOKIES_B64 (avoid rewriting every request).
_b64_cookie_path: str | None = None
# True after a failed decode when YT_DLP_COOKIES_B64 was non-empty (for /health).
_b64_decode_failed: bool = False


def _materialize_cookies_from_b64() -> str | None:
    """Decode YT_DLP_COOKIES_B64 into music_cache/.youtube_cookies.txt."""
    global _b64_cookie_path, _b64_decode_failed
    if _b64_cookie_path and Path(_b64_cookie_path).is_file():
        return _b64_cookie_path
    raw = os.environ.get("YT_DLP_COOKIES_B64", "").strip()
    if not raw:
        _b64_decode_failed = False
        return None
    compact = re.sub(r"\s+", "", raw)
    try:
        pad = (-len(compact)) % 4
        if pad:
            compact += "=" * pad
        # validate=False: pasted secrets / some platforms add stray bytes; still reject tiny garbage via len check below
        data = base64.b64decode(compact, validate=False)
    except Exception as e:
        _b64_decode_failed = True
        logger.warning("YT_DLP_COOKIES_B64 is set but base64 decode failed: %s", e)
        return None
    if len(data) < 20:
        _b64_decode_failed = True
        logger.warning(
            "YT_DLP_COOKIES_B64 decoded to only %s bytes (expected a full Netscape cookies file)",
            len(data),
        )
        return None
    out = MUSIC_DIR / ".youtube_cookies.txt"
    try:
        out.write_bytes(data)
    except OSError as e:
        _b64_decode_failed = True
        logger.warning("Could not write cookie file to %s: %s", out, e)
        return None
    _b64_decode_failed = False
    _b64_cookie_path = str(out)
    return _b64_cookie_path


def _yt_dlp_cookies_from_browser() -> str | None:
    """
    Env YT_DLP_COOKIES_FROM_BROWSER: browser name for yt-dlp --cookies-from-browser.
    E.g. "chrome", "firefox", "safari", "edge", "brave".
    Best for local dev where you're logged into YouTube in that browser.
    """
    return os.environ.get("YT_DLP_COOKIES_FROM_BROWSER", "").strip() or None


def _yt_dlp_cookiefile() -> str | None:
    """Netscape cookies.txt for YouTube when the host IP is challenged (common on cloud VMs)."""
    raw = (
        os.environ.get("YT_DLP_COOKIES_FILE", "").strip()
        or os.environ.get("YOUTUBE_COOKIES_FILE", "").strip()
    )
    if raw:
        path = Path(raw)
        if path.is_file():
            return str(path)
        logger.warning(
            "YT_DLP_COOKIES_FILE is set but file is missing or not readable: %s",
            raw,
        )
    return _materialize_cookies_from_b64()


def _youtube_extractor_args() -> dict:
    """
    Optional override for YouTube player clients (bot / format issues).

    Env YT_DLP_YOUTUBE_PLAYER_CLIENTS: comma-separated, e.g.
    tv_downgraded,web_safari,android_vr,mweb
    If unset, yt-dlp uses its own defaults (with cookies it usually picks tv_downgraded,web_safari).
    """
    raw = os.environ.get("YT_DLP_YOUTUBE_PLAYER_CLIENTS", "").strip()
    if not raw:
        return {}
    clients = [c.strip() for c in raw.split(",") if c.strip()]
    if not clients:
        return {}
    return {"youtube": {"player_client": clients}}


def _apply_cookie_opts(opts: dict) -> dict:
    """Inject cookie authentication into yt-dlp opts (browser > file > b64)."""
    browser = _yt_dlp_cookies_from_browser()
    if browser:
        opts["cookiesfrombrowser"] = (browser,)
        return opts
    ck = _yt_dlp_cookiefile()
    if ck:
        opts["cookiefile"] = ck
    return opts


def _merge_yt_opts(base: dict) -> dict:
    out = {**base}
    ex = _youtube_extractor_args()
    if ex:
        merged = dict(out.get("extractor_args") or {})
        merged.update(ex)
        out["extractor_args"] = merged
    return out


def youtube_cookie_health() -> dict:
    """Non-secret diagnostics for GET /health (debugging cookie + yt-dlp issues)."""
    browser = _yt_dlp_cookies_from_browser()
    ck = _yt_dlp_cookiefile()
    cookie_bytes: int | None = None
    if ck and Path(ck).is_file():
        cookie_bytes = Path(ck).stat().st_size
    try:
        from importlib.metadata import version as pkg_version

        ytdlp_ver = pkg_version("yt-dlp")
    except Exception:
        ytdlp_ver = getattr(yt_dlp, "__version__", None)
    return {
        "youtube_cookies": browser is not None or ck is not None,
        "cookies_from_browser": browser,
        "cookie_bytes": cookie_bytes,
        "yt_dlp_version": ytdlp_ver,
        "yt_dlp_cookies_b64_decode_failed": _b64_decode_failed,
    }


def _strip_ansi(s: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", s)


def search_youtube(query: str, limit: int = 8) -> list[dict]:
    """Return lightweight result rows (id, title, duration, url)."""
    q = query.strip()
    if len(q) < 2:
        return []
    limit = max(1, min(limit, 15))

    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "no_color": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "ignoreerrors": True,
        **yt_dlp_tls_opts(),
    }
    _apply_cookie_opts(opts)
    opts = _merge_yt_opts(opts)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{q}", download=False)

    if info is None:
        return []
    entries = info.get("entries") or []
    out: list[dict] = []
    for e in entries:
        if not e:
            continue
        vid = e.get("id")
        if not vid or not isinstance(vid, str):
            continue
        title = (e.get("title") or "Unknown").strip() or "Unknown"
        url = f"https://www.youtube.com/watch?v={vid}"
        out.append(
            {
                "id": vid,
                "title": title,
                "duration": e.get("duration"),
                "url": url,
            }
        )
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
        p
        for p in matches
        if p.suffix.lower() in (".mp3", ".m4a", ".opus", ".webm", ".ogg", ".aac", ".flac")
    ]
    if not audio:
        return None
    return audio[0]


def download_youtube_audio(url: str) -> tuple[Path, str]:
    """
    Download audio under music_cache/. Prefers MP3 via ffmpeg; falls back to raw bestaudio
    (m4a/webm) if ffmpeg/ffprobe are missing.
    """
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
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]
        else:
            ydl_opts["format"] = "bestaudio*/best"

        ydl_opts.update(yt_dlp_tls_opts())
        _apply_cookie_opts(ydl_opts)
        ydl_opts = _merge_yt_opts(ydl_opts)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise RuntimeError("Download produced no video metadata.")
                title = (info.get("title") or "track").strip() or "track"
        except Exception as e:
            last_err = e
            err_s = _strip_ansi(str(e)).lower()
            if use_postprocessor and (
                "ffmpeg" in err_s or "ffprobe" in err_s or "postprocessing" in err_s
            ):
                for p in MUSIC_DIR.glob(f"{token}.*"):
                    try:
                        p.unlink()
                    except OSError:
                        pass
                continue
            msg = _strip_ansi(str(e))
            hint = ""
            if "certificate" in msg.lower() or "ssl" in msg.lower():
                hint = (
                    "\n\nTLS: set SSL_CERT_FILE to your corporate CA PEM, or (dev only) "
                    "SOBEROHAN_INSECURE_SSL=1 — see backend/ssl_compat.py."
                )
            elif "ffmpeg" in err_s or "ffprobe" in err_s:
                hint = (
                    "\nInstall ffmpeg (e.g. brew install ffmpeg) or set FFMPEG_LOCATION "
                    "to the folder containing ffmpeg and ffprobe."
                )
            elif (
                "sign in" in err_s
                or "not a bot" in err_s
                or "cookies" in err_s
                or "bot" in err_s and "confirm" in err_s
            ):
                hint = (
                    "\n\nYouTube bot check: ensure GET /health shows youtube_cookies true, "
                    "cookie_bytes in the hundreds+, yt_dlp_cookies_b64_decode_failed false, "
                    "and upgrade yt-dlp (pip install -U yt-dlp). Try fresh Netscape cookies "
                    "from youtube.com while logged in; optional env "
                    "YT_DLP_YOUTUBE_PLAYER_CLIENTS=tv_downgraded,web_safari,android_vr,mweb. "
                    "See yt-dlp wiki: FAQ on cookies."
                )
            raise RuntimeError(msg + hint) from e

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

    msg = _strip_ansi(str(last_err)) if last_err else "unknown error"
    raise RuntimeError(
        f"{msg}\nInstall ffmpeg (e.g. brew install ffmpeg) or set FFMPEG_LOCATION."
    )
