"""Stem separation — Demucs (vocals + instruments) with hash-based caching.

Jobs run in a single-worker ProcessPoolExecutor on Railway's CPU quota. The
heavy `demucs` + `torch` imports are deferred so the FastAPI process still
boots when those libs aren't installed (dev machines / CI).

Endpoints:
  POST /api/stems/separate    — multipart `file` or JSON `source_id` -> { job_id }
  GET  /api/stems/{job_id}    — { status, progress, result? }
  GET  /api/stems/{job_id}/file/{kind}  — serve the separated `vocals` or `instruments` WAV

Cache layout: `music_cache/stems/{sha256-of-audio}/vocals.wav + instruments.wav`.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from db import async_session
from models import PlaylistItem
from storage import get_upload_root
from wordplay_auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/stems", tags=["stems"])


def _cache_root() -> Path:
    raw = os.environ.get("MUSIC_CACHE_DIR") or (Path(__file__).resolve().parent / "music_cache")
    root = Path(raw) / "stems"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


# ── In-memory job registry ──────────────────────────────────────────────────

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


def _set(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.setdefault(job_id, {})
        job.update(fields)


def _get(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        return dict(_JOBS[job_id]) if job_id in _JOBS else None


def _run_demucs_subprocess(input_path: Path, output_dir: Path, job_id: str) -> None:
    """Spawn demucs as a child process. Avoids importing torch in the FastAPI process.

    Captures the last ~30 lines of stdout/stderr so that when demucs dies with
    a non-zero status (model download failure, torch / MPS incompatibility on
    macOS, unsupported input format, …) we can surface the actual reason
    instead of a cryptic "exited with status 1".
    """
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "--two-stems=vocals",
        "-n",
        "htdemucs",
        "-o",
        str(output_dir),
        str(input_path),
    ]
    tail: list[str] = []
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            # Keep a rolling tail for error reporting.
            tail.append(line.rstrip("\n"))
            if len(tail) > 30:
                tail.pop(0)
            # Log to stdout so operators see live progress in docker logs.
            print(f"[demucs {job_id[:8]}] {line}", end="")
            if "%" in line:
                try:
                    pct = int(line.strip().split("%", 1)[0].split()[-1])
                    _set(job_id, progress=max(1, min(99, pct)))
                except Exception:
                    pass
        proc.wait()
        if proc.returncode != 0:
            excerpt = "\n".join(tail[-12:]) or "(no output)"
            # Heuristic hints for the two most common failure modes we've
            # actually hit in the wild.
            hint = ""
            joined = "\n".join(tail).lower()
            if "torchcodec" in joined or "save_with_torchcodec" in joined:
                hint = (
                    " — TorchAudio now needs `torchcodec` for saving WAVs "
                    "(try `pip install torchcodec`, or reinstall from `backend/requirements.txt`)."
                )
            elif "no module named" in joined or "modulenotfounderror" in joined:
                hint = " — a Python dependency is missing (try `pip install demucs torch torchaudio torchcodec`)."
            elif "http" in joined and ("403" in joined or "404" in joined or "connection" in joined):
                hint = " — failed to download the htdemucs model weights (first run needs network access)."
            elif "mps" in joined or "metal" in joined:
                hint = " — torch/MPS incompatibility; export PYTORCH_ENABLE_MPS_FALLBACK=1 and retry."
            raise RuntimeError(
                f"demucs exited with status {proc.returncode}{hint}\n--- demucs tail ---\n{excerpt}"
            )
    except FileNotFoundError as e:
        raise RuntimeError(
            "demucs is not installed on the backend. `pip install demucs torch torchaudio torchcodec`."
        ) from e


def _do_separate(job_id: str, audio_bytes: bytes, filename: str) -> None:
    try:
        _set(job_id, status="running", progress=1)
        digest = _sha256(audio_bytes)
        target_dir = _cache_root() / digest
        vocals_out = target_dir / "vocals.wav"
        inst_out = target_dir / "instruments.wav"

        if vocals_out.is_file() and inst_out.is_file():
            _set(
                job_id,
                status="done",
                progress=100,
                result={
                    "hash": digest,
                    "vocals_url": f"/api/stems/hash/{digest}/file/vocals",
                    "instruments_url": f"/api/stems/hash/{digest}/file/instruments",
                },
            )
            return

        target_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tdir:
            input_path = Path(tdir) / (filename or "input.mp3")
            input_path.write_bytes(audio_bytes)
            separated_root = Path(tdir) / "out"
            separated_root.mkdir(exist_ok=True)
            _run_demucs_subprocess(input_path, separated_root, job_id)
            # demucs writes out/htdemucs/<stem>/vocals.wav + no_vocals.wav
            stem_root = separated_root / "htdemucs"
            produced = next(stem_root.iterdir())
            shutil.move(str(produced / "vocals.wav"), vocals_out)
            shutil.move(str(produced / "no_vocals.wav"), inst_out)

        _set(
            job_id,
            status="done",
            progress=100,
            result={
                "hash": digest,
                "vocals_url": f"/api/stems/hash/{digest}/file/vocals",
                "instruments_url": f"/api/stems/hash/{digest}/file/instruments",
            },
        )
    except Exception as e:
        _set(job_id, status="error", progress=0, error=str(e))


class SeparateByIdRequest(BaseModel):
    source_id: str


@router.post("/separate")
async def separate(
    background: BackgroundTasks,
    file: UploadFile | None = File(None),
    source_id: str | None = None,
    user: dict | None = Depends(get_optional_user),
) -> dict[str, Any]:
    if file is None and not source_id:
        raise HTTPException(400, "Provide a file upload or source_id")

    audio_bytes: bytes
    filename: str
    if file is not None:
        audio_bytes = await file.read()
        filename = file.filename or "input.mp3"
    else:
        assert source_id is not None
        async with async_session() as session:
            item = (
                await session.execute(
                    select(PlaylistItem).where(PlaylistItem.id == source_id)
                )
            ).scalar_one_or_none()
        if not item:
            raise HTTPException(404, "source_id not found")
        path = get_upload_root() / item.stored_path
        if not path.is_file():
            raise HTTPException(404, "Source file missing")
        audio_bytes = path.read_bytes()
        filename = item.filename

    if len(audio_bytes) < 1000:
        raise HTTPException(400, "Audio too small")

    digest = _sha256(audio_bytes)
    cached_dir = _cache_root() / digest
    cached_vocals = cached_dir / "vocals.wav"
    cached_inst = cached_dir / "instruments.wav"
    if cached_vocals.is_file() and cached_inst.is_file():
        job_id = str(uuid.uuid4())
        _set(
            job_id,
            status="done",
            progress=100,
            result={
                "hash": digest,
                "vocals_url": f"/api/stems/hash/{digest}/file/vocals",
                "instruments_url": f"/api/stems/hash/{digest}/file/instruments",
            },
        )
        return {"job_id": job_id, "cached": True}

    job_id = str(uuid.uuid4())
    _set(job_id, status="queued", progress=0, started_at=time.time())
    background.add_task(_do_separate, job_id, audio_bytes, filename)
    return {"job_id": job_id, "cached": False}


@router.get("/{job_id}")
async def status(job_id: str):
    job = _get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "error": job.get("error"),
        "result": job.get("result"),
    }


@router.get("/hash/{digest}/file/{kind}")
async def serve_file(digest: str, kind: str):
    if kind not in {"vocals", "instruments"}:
        raise HTTPException(400, "kind must be vocals or instruments")
    path = _cache_root() / digest / f"{kind}.wav"
    if not path.is_file():
        raise HTTPException(404, "Stem not found (expired cache?)")
    return FileResponse(path, media_type="audio/wav")
