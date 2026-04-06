"""
wordplay-backend — FastAPI server.

Endpoints:
  GET  /api/music/search — YouTube search (Wordplay deck UI)
  POST /api/music/download — download audio from a YouTube URL
  GET  /api/lyrics/search — proxy to LRCLib for synced lyrics
  GET  /api/lyrics/get — proxy to LRCLib "get" (exact track+artist lookup)
  POST /api/lyrics/transcribe — Whisper-based transcription of uploaded audio

TLS: For SSL: CERTIFICATE_VERIFY_FAILED behind a corporate proxy, set SSL_CERT_FILE to your
PEM bundle, or (dev only) SOBEROHAN_INSECURE_SSL=1 — see ssl_compat.py.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import ssl_compat

ssl_compat.apply_insecure_ssl_if_configured()

import asyncio
import logging
import tempfile

import httpx
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from music_fetch import download_youtube_audio, search_youtube, youtube_cookie_health, MUSIC_DIR

logger = logging.getLogger("wordplay")

app = FastAPI(title="wordplay-backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LRCLIB_BASE = "https://lrclib.net/api"
LRCLIB_HEADERS = {"User-Agent": "Wordplay/1.0 (https://github.com/wordplay-app)"}
LRCLIB_VERIFY = not ssl_compat.insecure_ssl_enabled()


def _lrc_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10, verify=LRCLIB_VERIFY)


@app.get("/health")
def health():
    """Liveness + cookie/yt-dlp diagnostics (no secrets)."""
    return {"status": "ok", **youtube_cookie_health()}


class MusicDownloadBody(BaseModel):
    url: str = Field(..., min_length=10, max_length=2048)


@app.get("/api/music/search")
async def music_search(
    q: str = Query("", max_length=200),
    limit: int = Query(8, ge=1, le=15),
):
    """Search YouTube for tracks (Wordplay deck UI)."""
    q = q.strip()
    if len(q) < 2:
        return {"results": []}
    try:
        results = await asyncio.to_thread(search_youtube, q, limit)
        return {"results": results}
    except Exception as e:
        raise HTTPException(502, f"Search failed: {e}") from e


@app.post("/api/music/download")
async def music_download(body: MusicDownloadBody):
    """Download audio from a YouTube URL and return the file (MP3 when ffmpeg is available)."""
    try:
        path, safe_name = await asyncio.to_thread(download_youtube_audio, body.url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Download failed: {e}") from e

    media = "audio/mpeg"
    if path.suffix.lower() == ".m4a":
        media = "audio/mp4"
    elif path.suffix.lower() == ".webm":
        media = "audio/webm"
    elif path.suffix.lower() == ".opus":
        media = "audio/opus"

    return FileResponse(
        path,
        media_type=media,
        filename=safe_name,
        content_disposition_type="attachment",
    )


GENRE_CACHE_DIR = MUSIC_DIR / "genre_instrumentals"
GENRE_CACHE_DIR.mkdir(parents=True, exist_ok=True)


class GenreDownloadBody(BaseModel):
    url: str | None = Field(None, max_length=2048)
    playlist_url: str | None = Field(None, max_length=2048)
    genre_id: str = Field(..., min_length=1, max_length=50)


def _find_cached_instrumental(genre_id: str) -> Path | None:
    for ext in (".mp3", ".m4a", ".webm", ".opus", ".ogg", ".aac", ".flac"):
        p = GENRE_CACHE_DIR / f"{genre_id}{ext}"
        if p.is_file():
            return p
    return None


def _media_type(suffix: str) -> str:
    return {".m4a": "audio/mp4", ".webm": "audio/webm", ".opus": "audio/ogg"}.get(suffix, "audio/mpeg")


def _pick_random_from_playlist(playlist_url: str) -> str:
    """Use yt-dlp to extract all video URLs from a playlist and pick one at random."""
    import random
    import yt_dlp
    from music_fetch import _apply_cookie_opts

    opts: dict = {
        "quiet": True, "no_warnings": True,
        "extract_flat": "in_playlist", "skip_download": True,
    }
    _apply_cookie_opts(opts)

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(playlist_url, download=False)
        entries = info.get("entries", [])
        if not entries:
            raise ValueError("Playlist is empty or could not be read")
        chosen = random.choice(entries)
        video_id = chosen.get("id") or chosen.get("url")
        if not video_id:
            raise ValueError("Could not extract video ID from playlist entry")
        if video_id.startswith("http"):
            return video_id
        return f"https://www.youtube.com/watch?v={video_id}"


@app.post("/api/genre/instrumental")
async def genre_instrumental(body: GenreDownloadBody):
    """Download and cache a genre instrumental track. Returns the cached audio file.
    Accepts either a direct `url` or a `playlist_url` (picks a random track).
    """
    cached = _find_cached_instrumental(body.genre_id)
    if cached:
        return FileResponse(cached, media_type=_media_type(cached.suffix),
                            filename=f"{body.genre_id}{cached.suffix}")

    dl_url = body.url
    if not dl_url and body.playlist_url:
        try:
            dl_url = await asyncio.to_thread(_pick_random_from_playlist, body.playlist_url)
            logger.info("Picked random track from playlist: %s", dl_url)
        except Exception as e:
            raise HTTPException(502, f"Failed to pick track from playlist: {e}") from e

    if not dl_url:
        raise HTTPException(400, "Provide either 'url' or 'playlist_url'")

    try:
        path, _ = await asyncio.to_thread(download_youtube_audio, dl_url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Genre instrumental download failed: {e}") from e

    import shutil
    dest = GENRE_CACHE_DIR / f"{body.genre_id}{path.suffix}"
    shutil.move(str(path), str(dest))

    return FileResponse(dest, media_type=_media_type(dest.suffix),
                        filename=f"{body.genre_id}{dest.suffix}")


@app.get("/api/genre/instrumental/{genre_id}")
async def genre_instrumental_check(genre_id: str):
    """Check if a genre instrumental is cached. Returns {cached: bool, url: string|null}."""
    for ext in (".mp3", ".m4a", ".webm", ".opus", ".ogg"):
        p = GENRE_CACHE_DIR / f"{genre_id}{ext}"
        if p.is_file():
            return {"cached": True, "genre_id": genre_id}
    return {"cached": False, "genre_id": genre_id}


@app.get("/api/genre/instrumental/{genre_id}/audio")
async def genre_instrumental_serve(genre_id: str):
    """Serve a cached genre instrumental audio file."""
    for ext in (".mp3", ".m4a", ".webm", ".opus", ".ogg"):
        p = GENRE_CACHE_DIR / f"{genre_id}{ext}"
        if p.is_file():
            media = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webm": "audio/webm"}.get(ext, "audio/mpeg")
            return FileResponse(p, media_type=media, filename=f"{genre_id}{ext}")
    raise HTTPException(404, f"No cached instrumental for genre '{genre_id}'")


@app.get("/api/lyrics/search")
async def lyrics_search(q: str = Query("", max_length=300)):
    """Proxy to LRCLib synced-lyrics search (avoids browser CORS)."""
    q = q.strip()
    if len(q) < 2:
        return JSONResponse([])
    try:
        async with _lrc_client() as client:
            resp = await client.get(
                f"{LRCLIB_BASE}/search",
                params={"q": q},
                headers=LRCLIB_HEADERS,
            )
            resp.raise_for_status()
            return JSONResponse(resp.json())
    except Exception as e:
        raise HTTPException(502, f"Lyrics search failed: {e}") from e


@app.get("/api/lyrics/get")
async def lyrics_get(
    track_name: str = Query("", max_length=300),
    artist_name: str = Query("", max_length=300),
):
    """Proxy to LRCLib exact get (track + artist). Returns null on 404."""
    track_name = track_name.strip()
    artist_name = artist_name.strip()
    if not track_name:
        return JSONResponse(None)
    try:
        async with _lrc_client() as client:
            params: dict[str, str] = {"track_name": track_name}
            if artist_name:
                params["artist_name"] = artist_name
            resp = await client.get(
                f"{LRCLIB_BASE}/get",
                params=params,
                headers=LRCLIB_HEADERS,
            )
            if resp.status_code == 404:
                return JSONResponse(None)
            resp.raise_for_status()
            return JSONResponse(resp.json())
    except httpx.HTTPStatusError:
        return JSONResponse(None)
    except Exception as e:
        raise HTTPException(502, f"Lyrics get failed: {e}") from e


# ── Whisper transcription ──────────────────────────────────────────────

_whisper_model = None
WHISPER_MODEL_SIZE = "base"


def _get_whisper_model():
    """Lazy-load the faster-whisper model (downloads ~150 MB on first call)."""
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    try:
        from faster_whisper import WhisperModel
        logger.info("Loading faster-whisper model '%s' …", WHISPER_MODEL_SIZE)
        _whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
        logger.info("Whisper model loaded.")
        return _whisper_model
    except ImportError:
        raise HTTPException(
            501,
            "faster-whisper not installed — run: pip install faster-whisper",
        )
    except Exception as e:
        raise HTTPException(502, f"Failed to load Whisper model: {e}") from e


def _transcribe_audio(path: str) -> list[dict]:
    """Run Whisper transcription and return list of {time, text} dicts."""
    model = _get_whisper_model()
    segments, info = model.transcribe(
        path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300),
    )

    lines: list[dict] = []
    for segment in segments:
        if not segment.words:
            if segment.text.strip():
                lines.append({
                    "time": round(segment.start, 2),
                    "text": segment.text.strip(),
                })
            continue

        # Group words into phrase-length lines (~4-8 words)
        buf_words: list[str] = []
        buf_start: float | None = None
        for word in segment.words:
            w = word.word.strip()
            if not w:
                continue
            if buf_start is None:
                buf_start = word.start
            buf_words.append(w)

            if len(buf_words) >= 6 or (word.end - buf_start > 3.5):
                lines.append({
                    "time": round(buf_start, 2),
                    "text": " ".join(buf_words),
                })
                buf_words = []
                buf_start = None

        if buf_words and buf_start is not None:
            lines.append({
                "time": round(buf_start, 2),
                "text": " ".join(buf_words),
            })

    return lines


@app.post("/api/lyrics/transcribe")
async def lyrics_transcribe(file: UploadFile = File(...)):
    """
    Transcribe an uploaded audio file using Whisper.
    Returns JSON array of {time: number, text: string}.
    """
    if not file.filename:
        raise HTTPException(400, "No file uploaded")

    suffix = Path(file.filename).suffix or ".wav"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            if len(content) > 50 * 1024 * 1024:
                raise HTTPException(413, "File too large (max 50 MB)")
            tmp.write(content)
            tmp_path = tmp.name

        lines = await asyncio.to_thread(_transcribe_audio, tmp_path)
        return JSONResponse(lines)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(502, f"Transcription failed: {e}") from e
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass
