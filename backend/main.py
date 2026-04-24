"""
wordplay-backend — FastAPI server.

Endpoints:
  GET  /health
  POST /api/auth/google — Google ID-token login
  GET  /api/auth/me — current user from JWT
  GET  /api/music/search — YouTube search (gated by ALLOW_YOUTUBE_API)
  POST /api/music/download — download audio from a YouTube URL (gated)
  /api/playlist/* — per-user playlist CRUD (auth required)
  /api/community/* — wordplay wall publish/feed/stream
  GET  /api/lyrics/search — proxy to LRCLib for synced lyrics
  GET  /api/lyrics/get — proxy to LRCLib exact lookup
  POST /api/lyrics/transcribe — Whisper transcription of uploaded audio
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import asyncio
import logging
import os
import tempfile
import tomllib

import httpx
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from music_fetch import download_youtube_audio, health_check_payload, search_youtube
from wordplay_auth import GoogleLoginRequest, google_login, get_current_user
from db import init_db
from playlist import router as playlist_router
from community import router as community_router
from social import router as social_router
from stems import router as stems_router

logger = logging.getLogger("wordplay")

ALLOW_YOUTUBE_API = os.environ.get("ALLOW_YOUTUBE_API", "false").strip().lower() in ("1", "true", "yes")


def _read_version() -> str:
    try:
        with open(Path(__file__).resolve().parent / "pyproject.toml", "rb") as f:
            return tomllib.load(f)["project"]["version"]
    except Exception:
        return "0.0.0"


APP_VERSION = _read_version()

app = FastAPI(title="wordplay-backend", version=APP_VERSION)


def _cors_params() -> dict:
    """
    ``allow_origins=['*']`` breaks cross-origin requests that send ``Authorization`` with
    ``multipart/form-data`` (Wordplaylist upload): browsers require a concrete
    ``Access-Control-Allow-Origin`` echo, not ``*``. Use an explicit list or regex.
    """
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        return {
            "allow_origins": [o.strip() for o in raw.split(",") if o.strip()],
        }
    reg = os.environ.get("CORS_ORIGIN_REGEX", "").strip()
    if reg:
        return {"allow_origin_regex": reg}
    # Default: local dev + Vercel + *.rohankokkula.dev (adjust via env if needed)
    return {
        "allow_origin_regex": (
            r"^https://([a-zA-Z0-9-]+\.)*rohankokkula\.dev$"
            r"|^https://([a-zA-Z0-9-]+\.)*vercel\.app$"
            r"|^http://(localhost|127\.0\.0\.1)(:\d+)?$"
        ),
    }


app.add_middleware(
    CORSMiddleware,
    allow_methods=["*"],
    allow_headers=["*"],
    **_cors_params(),
)

app.include_router(playlist_router)
app.include_router(community_router)
app.include_router(social_router)
app.include_router(stems_router)


@app.on_event("startup")
async def _startup():
    await init_db()

LRCLIB_BASE = "https://lrclib.net/api"
LRCLIB_HEADERS = {"User-Agent": "Wordplay/1.0 (https://github.com/wordplay-app)"}


def _lrc_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10)


@app.get("/api/ping")
async def api_ping():
    """Use this to confirm the deployed service is this FastAPI app (`GET` returns JSON). If this 404s, Railway is running the wrong build or root directory."""
    return {"service": "wordplay-backend", "ok": True, "version": APP_VERSION}


@app.get("/api/version")
async def api_version():
    """Current deployed version. Exposed so the frontend can display it in Settings / footer."""
    return {"version": APP_VERSION, "name": "wordplay-backend"}


@app.get("/health")
async def health(
    quick: bool = Query(
        False,
        description="If true, only returns basic liveness (no YouTube calls).",
    ),
    force: bool = Query(
        False,
        description="If true, bypasses the short-lived cache for YouTube probes.",
    ),
):
    """
    Liveness plus optional deep checks **only when** ``ALLOW_YOUTUBE_API`` is enabled.

    When YouTube is disabled (default in production), this never contacts YouTube or yt-dlp
    — same as ``quick=1`` — so monitors can call ``/health`` without filling logs with
    extractor errors.

    With ``ALLOW_YOUTUBE_API=true`` and ``quick=false``:

    - **storage** — music cache directory is writable (needed for downloads).
    - **search** — one real `VideosSearch` query (same stack as `/api/music/search`).
    - **load** — for the first search hit, verifies stream metadata / decipher / yt-dlp
      extract (same paths as download, without saving a full file).

    Probes are cached ~90s. Use ``quick=1`` to skip deep checks even when YouTube is enabled.
    """
    if not ALLOW_YOUTUBE_API or quick:
        return {
            "status": "ok",
            "checks": {
                "mode": "quick",
                **({} if ALLOW_YOUTUBE_API else {"youtube": "disabled"}),
            },
        }
    return await asyncio.to_thread(health_check_payload, force)


# ── Auth ──────────────────────────────────────────────────────────────

@app.post("/api/auth/google")
async def auth_google(body: GoogleLoginRequest):
    return await google_login(body)


@app.get("/api/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {
        "id": user["sub"],
        "email": user.get("email"),
        "name": user.get("name"),
        "picture": user.get("picture"),
        "tier": user.get("tier"),
    }


# ── YouTube music (gated) ────────────────────────────────────────────

class MusicDownloadBody(BaseModel):
    url: str = Field(..., min_length=10, max_length=2048)


def _check_youtube_gate():
    if not ALLOW_YOUTUBE_API:
        raise HTTPException(403, "YouTube API is disabled on this server")


@app.get("/api/music/search")
async def music_search(
    q: str = Query("", max_length=200),
    limit: int = Query(8, ge=1, le=15),
):
    """Search YouTube for tracks."""
    _check_youtube_gate()
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
    """Download audio from a YouTube URL and return the file."""
    _check_youtube_gate()
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


# ── Lyrics ────────────────────────────────────────────────────────────

@app.get("/api/lyrics/search")
async def lyrics_search(q: str = Query("", max_length=300)):
    """Proxy to LRCLib synced-lyrics search."""
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
    """Proxy to LRCLib exact get (track + artist)."""
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


# ── Whisper transcription ─────────────────────────────────────────────

_whisper_model = None
WHISPER_MODEL_SIZE = "base"


def _get_whisper_model():
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
        raise HTTPException(501, "faster-whisper not installed — run: pip install faster-whisper")
    except Exception as e:
        raise HTTPException(502, f"Failed to load Whisper model: {e}") from e


def _transcribe_audio(path: str) -> list[dict]:
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
                lines.append({"time": round(segment.start, 2), "text": segment.text.strip()})
            continue

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
                lines.append({"time": round(buf_start, 2), "text": " ".join(buf_words)})
                buf_words = []
                buf_start = None

        if buf_words and buf_start is not None:
            lines.append({"time": round(buf_start, 2), "text": " ".join(buf_words)})

    return lines


@app.post("/api/lyrics/transcribe")
async def lyrics_transcribe(file: UploadFile = File(...)):
    """Transcribe uploaded audio using Whisper."""
    if not file.filename:
        raise HTTPException(400, "No file uploaded")

    tmp_path: str | None = None
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
        if tmp_path is not None:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
