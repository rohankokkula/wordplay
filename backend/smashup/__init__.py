"""Smashup analysis service.

One content-addressed pipeline per song (sha256 of the audio bytes):

  1. 4-stem htdemucs  → vocals / drums / bass / other (mp3)
  2. faster-whisper   → word timestamps on the *vocal stem*, biased toward the
                        crate keywords (initial_prompt + hotwords)
  3. MMS forced align → snap each keyword hit to the syllable

Endpoints:
  GET  /api/smashup/health                 capabilities of this server
  POST /api/smashup/analyze                multipart file + keywords → {job_id, hash}
  GET  /api/smashup/jobs/{job_id}          poll status
  GET  /api/smashup/jobs/{job_id}/events   same, as Server-Sent Events
  GET  /api/smashup/{hash}/stems/{name}    stem audio (vocals|drums|bass|other)
  GET  /api/smashup/{hash}/words           cached words + keyword hits

Cache layout: `music_cache/smashup/{hash}/{stem}.mp3` and `words-{kwhash}.json`.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import inspect
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from whisper_model import get_whisper_model

from .align import refine_hits
from .keywords import matches

router = APIRouter(prefix="/api/smashup", tags=["smashup"])

STEMS = ("vocals", "drums", "bass", "other")
MAX_UPLOAD = 60 * 1024 * 1024

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
# CPU-bound work: one song at a time keeps Railway's quota from thrashing.
_WORK_LOCK = threading.Lock()


def cache_root() -> Path:
    raw = os.environ.get("MUSIC_CACHE_DIR") or (Path(__file__).resolve().parent.parent / "music_cache")
    root = Path(raw) / "smashup"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _kw_key(keywords: list[str]) -> str:
    norm = ",".join(sorted({k.strip().lower() for k in keywords if k.strip()}))
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


def _set(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        _JOBS.setdefault(job_id, {}).update(fields)


def _get(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        return dict(_JOBS[job_id]) if job_id in _JOBS else None


def _has(mod: str) -> bool:
    return importlib.util.find_spec(mod) is not None


def _whisper_size() -> str:
    return os.environ.get("WHISPER_MODEL_SMASHUP", "small")


def _stems_ready(d: Path) -> bool:
    return all((d / f"{s}.mp3").is_file() for s in STEMS)


def _run_demucs(input_path: Path, out_dir: Path, job_id: str) -> None:
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", "htdemucs", "--mp3", "--mp3-bitrate", "192",
        "-o", str(out_dir), str(input_path),
    ]
    tail: list[str] = []
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
    except FileNotFoundError as e:
        raise RuntimeError("demucs is not installed on the backend") from e
    assert proc.stdout is not None
    for line in proc.stdout:
        tail = (tail + [line.rstrip()])[-20:]
        if "%" in line:
            try:
                pct = int(line.strip().split("%", 1)[0].split()[-1])
                _set(job_id, progress=max(2, min(68, int(pct * 0.68))), stage="stems")
            except Exception:
                pass
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError("demucs failed:\n" + "\n".join(tail[-10:]))


def _separate(audio: Path, target: Path, job_id: str) -> None:
    with tempfile.TemporaryDirectory() as tdir:
        out = Path(tdir) / "out"
        _run_demucs(audio, out, job_id)
        produced = next((out / "htdemucs").iterdir())
        for s in STEMS:
            shutil.move(str(produced / f"{s}.mp3"), target / f"{s}.mp3")


def transcribe_words(path: Path, keywords: list[str], language: str | None) -> tuple[list[dict], str | None]:
    model = get_whisper_model(_whisper_size())
    kwargs: dict[str, Any] = dict(
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=250),
        condition_on_previous_text=False,
        initial_prompt=", ".join(keywords),
    )
    if language:
        kwargs["language"] = language
    if "hotwords" in inspect.signature(model.transcribe).parameters:
        kwargs["hotwords"] = " ".join(keywords)
    segments, info = model.transcribe(str(path), **kwargs)
    words: list[dict] = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"w": text, "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
    return words, getattr(info, "language", None)


def find_hits(words: list[dict], keywords: list[str]) -> list[dict]:
    hits = []
    for i, w in enumerate(words):
        # Compounds like "paisa-paisa" count once per word; any part may match.
        alias = next((a for part in re.split(r"[\s\-_,.!?'\"]+", w["w"]) if (a := matches(part, keywords))), None)
        if alias:
            hits.append({**w, "index": i, "alias": alias, "source": "asr"})
    return hits


def _pipeline(job_id: str, digest: str, audio: Path, keywords: list[str], language: str | None, want_stems: bool) -> None:
    target = cache_root() / digest
    target.mkdir(parents=True, exist_ok=True)
    try:
        with _WORK_LOCK:
            _set(job_id, status="running", stage="stems", progress=1)
            stems_ok = _stems_ready(target)
            stems_error = None
            if want_stems and not stems_ok and _has("demucs"):
                try:
                    _separate(audio, target, job_id)
                    stems_ok = True
                except Exception as e:  # keep going: words alone are still useful
                    stems_error = str(e)
            words_path = target / f"words-{_kw_key(keywords)}.json"
            if words_path.is_file():
                payload = json.loads(words_path.read_text())
            else:
                _set(job_id, stage="words", progress=70)
                src = target / "vocals.mp3" if stems_ok else audio
                words, lang = transcribe_words(src, keywords, language)
                hits = find_hits(words, keywords)
                _set(job_id, stage="align", progress=90)
                if stems_ok and _has("torchaudio"):
                    hits = refine_hits(target / "vocals.mp3", hits)
                payload = {"hash": digest, "language": lang, "keywords": keywords, "words": words, "hits": hits}
                words_path.write_text(json.dumps(payload))
        result = {
            **payload,
            "stems": {s: f"/api/smashup/{digest}/stems/{s}" for s in STEMS} if stems_ok else None,
            "stems_error": stems_error,
        }
        _set(job_id, status="done", stage="done", progress=100, result=result)
    except Exception as e:
        _set(job_id, status="error", error=str(e))
    finally:
        shutil.rmtree(audio.parent, ignore_errors=True)


@router.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "demucs": _has("demucs"),
        "whisper": _has("faster_whisper"),
        "align": _has("torchaudio"),
        "whisper_model": _whisper_size(),
    }


@router.post("/analyze")
async def analyze(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    keywords: str = Form(""),
    language: str | None = Form(None),
    stems: bool = Form(True),
) -> dict[str, Any]:
    data = await file.read()
    if len(data) < 1000:
        raise HTTPException(400, "Audio too small")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 60 MB)")
    kws = [k.strip() for k in keywords.split(",") if k.strip()]
    if not kws:
        raise HTTPException(400, "Provide at least one keyword")
    digest = hashlib.sha256(data).hexdigest()
    tdir = Path(tempfile.mkdtemp(prefix="smashup-"))
    audio = tdir / (Path(file.filename or "input.mp3").name or "input.mp3")
    audio.write_bytes(data)
    job_id = str(uuid.uuid4())
    _set(job_id, status="queued", stage="queued", progress=0, hash=digest, started_at=time.time())
    background.add_task(asyncio.to_thread, _pipeline, job_id, digest, audio, kws, language or None, stems)
    return {"job_id": job_id, "hash": digest}


@router.get("/jobs/{job_id}")
async def job(job_id: str) -> dict[str, Any]:
    j = _get(job_id)
    if j is None:
        raise HTTPException(404, "Unknown job")
    return j


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    if _get(job_id) is None:
        raise HTTPException(404, "Unknown job")

    async def stream():
        last = None
        while True:
            j = _get(job_id) or {"status": "error", "error": "job vanished"}
            snap = json.dumps(j)
            if snap != last:
                yield f"data: {snap}\n\n"
                last = snap
            if j.get("status") in ("done", "error"):
                return
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/{digest}/stems/{name}")
async def stem_file(digest: str, name: str) -> FileResponse:
    if name not in STEMS or not all(c in "0123456789abcdef" for c in digest) or len(digest) != 64:
        raise HTTPException(404, "Not found")
    path = cache_root() / digest / f"{name}.mp3"
    if not path.is_file():
        raise HTTPException(404, "Stem not ready")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{digest}/words")
async def words(digest: str, keywords: str = Query(...)) -> dict[str, Any]:
    if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest):
        raise HTTPException(404, "Not found")
    kws = [k.strip() for k in keywords.split(",") if k.strip()]
    path = cache_root() / digest / f"words-{_kw_key(kws)}.json"
    if not path.is_file():
        raise HTTPException(404, "Not analysed yet")
    payload = json.loads(path.read_text())
    target = cache_root() / digest
    payload["stems"] = {s: f"/api/smashup/{digest}/stems/{s}" for s in STEMS} if _stems_ready(target) else None
    return payload
